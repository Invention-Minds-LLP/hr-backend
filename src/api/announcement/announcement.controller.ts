import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { Client } from 'basic-ftp';
import fs from 'fs';
import multer from 'multer';
import { createNotification } from '../notifications/notifications.controller';
import { config } from '../../config';

const prisma = new PrismaClient();

const FTP_CONFIG = {
  host: config.ftp.host,
  user: config.ftp.user,
  password: config.ftp.pass,
  secure: config.ftp.secure,
};

const upload = multer({ dest: 'uploads/' }); // temp folder

async function uploadToFTP(localFilePath: string, remoteFilePath: string) {
  const client = new Client();
  try {
    await client.access(FTP_CONFIG);
    await client.ensureDir('/public_html/circulars');
    await client.uploadFrom(localFilePath, remoteFilePath);
  } finally {
    client.close();
  }
}

// Utility: build an Employee where-filter from stored audience JSON
function buildAudienceWhere(audienceJson?: string | null): Prisma.EmployeeWhereInput | undefined {
  if (!audienceJson) return undefined;

  try {
    let f: any = JSON.parse(audienceJson);
    if (typeof f === "string") {
      f = JSON.parse(f); // handle double-encoded JSON
    }

    const where: Prisma.EmployeeWhereInput = { employmentStatus: "ACTIVE" };

    if (f.all) {
      return where; // no extra filters (all active employees)
    }
    // if (f.departmentId?.length) {
    //   where.departmentId = { in: f.departmentId.map((d: any) => Number(d)) };
    // }
    // if (f.branchId?.length) {
    //   where.branchId = { in: f.branchId.map((b: any) => Number(b)) };
    // }
    // if (f.roleId?.length) {
    //   where.roleId = { in: f.roleId.map((r: any) => Number(r)) };
    // }
    // if (f.employeeId?.length) {
    //   where.id = { in: f.employeeId.map((e: any) => Number(e)) };
    // }
    if (Array.isArray(f.departmentId) && f.departmentId.length > 0) {
      where.departmentId = { in: f.departmentId.map(Number) };
    }

    if (Array.isArray(f.branchId) && f.branchId.length > 0) {
      where.branchId = { in: f.branchId.map(Number) };
    }

    if (Array.isArray(f.roleId) && f.roleId.length > 0) {
      where.roleId = { in: f.roleId.map(Number) };
    }

    // if (Array.isArray(f.employeeId) && f.employeeId.length > 0) {
    //   where.id = { in: f.employeeId.map(Number) };
    // }
if (f.employeeId) {
  const ids = Array.isArray(f.employeeId)
    ? f.employeeId
    : [f.employeeId];

  where.id = {
    in: ids.map((e: any) =>
      typeof e === "object" ? Number(e.id) : Number(e)
    )
  };
}




    return where;
  } catch (err) {
    console.error("Invalid audience JSON:", audienceJson);
    return undefined;
  }
}
async function generateCircularCode(): Promise<string> {
  const year = new Date().getFullYear();
  const countThisYear = await prisma.announcement.count({
    where: {
      createdAt: {
        gte: new Date(`${year}-01-01T00:00:00Z`),
        lte: new Date(`${year}-12-31T23:59:59Z`),
      },
    },
  });
  return `CIRC-${year}-${String(countThisYear + 1).padStart(3, "0")}`;
}

export async function createAnnouncement(req: Request, res: Response) {
  try {
    const { title, body, audience, startsAt, endsAt, type, isPinned, requireAck } = req.body as {
      title: string;
      body: string;
      audience?: { departmentId?: number[]; branchId?: number[] } | null;
      startsAt?: string | Date;
      endsAt?: string | Date | null;
      type?: string;
      isPinned?: boolean;
      requireAck?: boolean;
    };

    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    const circularCode = await generateCircularCode();

    const files = (req as any).files as Express.Multer.File[];
    let attachments: { name: string; url: string }[] = [];

    if (files && files.length) {
      for (const f of files) {
        const remoteFileName = `${Date.now()}-${f.originalname}`;
        const remotePath = `/public_html/circulars/${remoteFileName}`;
        await uploadToFTP(f.path, remotePath);
        const publicUrl = `https://hrproindia.in/circulars/${remoteFileName}`;

        attachments.push({ name: f.originalname, url: publicUrl });

        // cleanup local temp file
        try { fs.unlinkSync(f.path); } catch { }
      }
    }


    const created = await prisma.announcement.create({
      data: {
        circularCode,
        title,
        body,
        isPinned: req.body.isPinned === "true",
        requireAck: req.body.requireAck === "true",
        type: type || 'GENERAL',
        audience: audience ? JSON.stringify(audience) : null,
        startsAt: startsAt ? new Date(startsAt) : undefined,
        endsAt: endsAt ? new Date(endsAt) : null,
        attachments: attachments.length ? JSON.stringify(attachments) : null,
        createdBy: (req as any).user?.userId ?? 0, // adjust to your auth
      },
    });
    // ---- find target employees ----
    const where = buildAudienceWhere(
      audience ? JSON.stringify(audience) : null
    );

    const employees = await prisma.employee.findMany({
      where,
      select: { id: true }
    });

    // ---- notify all target employees ----
    for (const emp of employees) {
      await createNotification(emp.id, 'NEW_ANNOUNCEMENT');
    }

    return res.status(201).json(created);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to create announcement' });
  }
}

/** POST /announcements/:id/ack  { employeeId }  */
export async function ackAnnouncement(req: Request, res: Response) {
  try {
    const announcementId = Number(req.params.id);
    const employeeId = (req.body?.employeeId as number) ?? (req as any).user?.empId;
    if (!announcementId || !employeeId) {
      return res.status(400).json({ error: 'announcementId and employeeId are required' });
    }

    // Unique per (announcement, employee) is enforced by @@unique([announcementId, employeeId])
    await prisma.announcementAck.create({
      data: { announcementId, employeeId },
    }).catch(err => {
      // swallow unique constraint errors (already acked)
      if (err?.code !== 'P2002') throw err;
    });

    const ackCount = await prisma.announcementAck.count({ where: { announcementId } });

    return res.json({ message: 'Acknowledged', ackCount });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to acknowledge' });
  }
}
export async function listLiveForEmployee(req: Request, res: Response) {
  try {
    const user = (req as any).user; // from JWT/session
    const empId = user.empId;
    const deptId = user.deptId;
    const role = user.role;
    const branchId = user.branchId; // if available

    console.log(
      `Listing announcements for empId=${empId} deptId=${deptId} role=${role} branchId=${branchId}`
    );

    const now = new Date();

    // fetch live announcements
    const live = await prisma.announcement.findMany({
      where: {
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      orderBy: { startsAt: "desc" },
      include: {
        acks: {
          where: { employeeId: empId }, // only check if THIS employee has acked
          select: { id: true },
        },
      },
    });

    // filter by audience
    const relevant = live.filter((a) => {
      // already acknowledged → skip
      if (a.acks && a.acks.length > 0) return false;

      if (!a.audience) return true; // no filter = all employees

      let audience: any;
      try {
        audience = JSON.parse(a.audience);
        if (typeof audience === "string") {
          audience = JSON.parse(audience); // fix double encoding
        }
      } catch (err) {
        console.error(`Invalid audience JSON for announcement ${a.id}`, a.audience);
        return false;
      }

      console.log(`Announcement ${a.id} audience filter:`, audience);

      if (audience.all) return true;
      if (audience.departmentId?.some((d: any) => Number(d) === Number(deptId))) return true;
      if (audience.branchId?.some((b: any) => Number(b) === Number(branchId))) return true;
      if (audience.roleId?.some((r: any) => String(r) === String(role))) return true;
      if (audience.employeeId?.some((e: any) => Number(e) === Number(empId))) return true;

      return false;
    });

    console.log(
      `Found ${relevant.length} relevant announcements (not acked) for empId=${empId}`
    );
    console.log(relevant.map((a) => ({ id: a.id, title: a.title })));

    return res.json(relevant);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to load announcements" });
  }
}




/** GET /announcements/live -> [{ id, title, ackCount, audienceCount, ackRate }] */
export async function listLiveAnnouncementsWithStats(_req: Request, res: Response) {
  try {
    const now = new Date();

    const live = await prisma.announcement.findMany({
      where: {
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      orderBy: { startsAt: "desc" },
      select: { id: true, title: true, audience: true },
    });

    // Compute stats per announcement
    const stats = await Promise.all(
      live.map(async (a) => {
        const audienceWhere = buildAudienceWhere(a.audience);

        // count target employees
        const audienceCount = await prisma.employee.count({
          where: audienceWhere,
        });

        // count acks
        const ackCount = await prisma.announcementAck.count({
          where: { announcementId: a.id },
        });

        const ackRate = audienceCount ? ackCount / audienceCount : 0;

        return {
          id: a.id,
          title: a.title,
          ackCount,
          audienceCount,
          ackRate, // raw ratio
          ackPercent: Math.round(ackRate * 100),
        };
      })
    );

    return res.json(stats);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to load live announcements" });
  }
}

export async function listAllLiveForEmployee(req: Request, res: Response) {
  try {
    const user = (req as any).user; // from JWT/session middleware
    const empId = user.empId;
    const deptId = user.deptId;
    const role = user.role;
    const branchId = user.branchId;

    console.log(`Fetching all live announcements for empId=${empId}`);

    const now = new Date();

    // 1️⃣ Fetch all live announcements (still valid)
    const liveAnnouncements = await prisma.announcement.findMany({
      where: {
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      orderBy: { startsAt: "desc" },
      include: {
        acks: {
          where: { employeeId: empId },
          select: { id: true },
        },
      },
    });

    // 2️⃣ Filter based on audience (who should see this)
    const relevant = liveAnnouncements.filter((a) => {
      if (!a.audience) return true; // all employees can see

      let audience: any;
      try {
        audience = JSON.parse(a.audience);
        if (typeof audience === "string") {
          audience = JSON.parse(audience); // handle double JSON encoding
        }
      } catch (err) {
        console.error(`Invalid audience JSON for announcement ${a.id}`, a.audience);
        return false;
      }

      if (audience.all) return true;
      if (audience.departmentId?.some((d: any) => Number(d) === Number(deptId))) return true;
      if (audience.branchId?.some((b: any) => Number(b) === Number(branchId))) return true;
      if (audience.roleId?.some((r: any) => String(r) === String(role))) return true;
      if (audience.employeeId?.some((e: any) => Number(e) === Number(empId))) return true;

      return false;
    });

    // 3️⃣ Add acknowledgement status
    const result = relevant.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      type: a.type,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      attachments: a.attachments,
      isPinned: a.isPinned,
      requireAck: a.requireAck,
      acknowledged: a.acks && a.acks.length > 0, // 👈 flag
    }));

    console.log(`Found ${result.length} announcements for empId=${empId}`);

    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to load announcements" });
  }
}
