import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// Utility: build an Employee where-filter from stored audience JSON
function buildAudienceWhere(audienceJson?: string | null): Prisma.EmployeeWhereInput | undefined {
  if (!audienceJson) return undefined;
  try {
    const f = JSON.parse(audienceJson) as { departmentId?: number[]; branchId?: number[] };
    const where: Prisma.EmployeeWhereInput = {};
    if (f.departmentId?.length) where.departmentId = { in: f.departmentId };
    if (f.branchId?.length) where.branchId = { in: f.branchId };
    return Object.keys(where).length ? where : undefined;
  } catch {
    return undefined;
  }
}

export async function createAnnouncement(req: Request, res: Response) {
  try {
    const { title, body, audience, startsAt, endsAt } = req.body as {
      title: string;
      body: string;
      audience?: { departmentId?: number[]; branchId?: number[] } | null;
      startsAt?: string | Date;
      endsAt?: string | Date | null;
    };

    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    const created = await prisma.announcement.create({
      data: {
        title,
        body,
        audience: audience ? JSON.stringify(audience) : null,
        startsAt: startsAt ? new Date(startsAt) : undefined,
        endsAt: endsAt ? new Date(endsAt) : null,
        createdBy: (req as any).user?.userId ?? 0, // adjust to your auth
      },
    });

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

/** GET /announcements/live -> [{ id, title, ackCount, audienceCount, ackRate }] */
export async function listLiveAnnouncementsWithStats(_req: Request, res: Response) {
  try {
    const now = new Date();
    const live = await prisma.announcement.findMany({
      where: { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      select: { id: true, title: true, audience: true },
      orderBy: { startsAt: 'desc' },
    });

    // Compute stats per announcement (no need to pull all acks)
    const stats = await Promise.all(
      live.map(async (a) => {
        const audienceWhere = buildAudienceWhere(a.audience);

        // audience = employees that match filter; default: all ACTIVE employees
        const audienceCount = await prisma.employee.count({
          where: {
            employmentStatus: 'ACTIVE',
            ...(audienceWhere || {}),
          },
        });

        const ackCount = await prisma.announcementAck.count({
          where: { announcementId: a.id },
        });

        const ackRate = audienceCount ? ackCount / audienceCount : 0;
        return {
          id: a.id,
          title: a.title,
          ackCount,
          audienceCount,
          ackRate,          // 0..1
          ackPercent: Math.round(ackRate * 100),
        };
      })
    );

    return res.json(stats);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to load live announcements' });
  }
}
