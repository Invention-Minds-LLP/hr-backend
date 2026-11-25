import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { Prisma } from "@prisma/client";
import { HOD_ROLE_ID, HR_ROLE_ID, headedDepartmentIds } from "../../lib/departmentHeads";
import { withEmployeeScope } from "../../lib/dataScope";
import { MGMT_DASHBOARD_EMPID_ALLOWLIST } from "../../lib/permissions";
import fs from "fs";
import path from "path";
import formidable, { File as FormidableFile } from "formidable";
// Legacy FTP upload (kept for reference / fallback). Files now go to local disk.
// import { Client } from "basic-ftp";
import { saveLocal, publicUrl } from "../../lib/fileStorage";
import { config } from "../../config";



export function calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371000; // meters
    const toRad = (x: number) => (x * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Session id from a body/param value (apps may send it as a string). null when not a positive integer. */
function toSessionId(v: unknown): number | null {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/** Optional numeric field (accuracy / speed): a finite number or null. */
function optionalNumber(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}


/**
 * Get tracking status
 */
export const getGeoTrackingStatus = async (req: AuthenticatedRequest, res: Response) => {
    const empId = req.user.empId;

    const employee = await prisma.employee.findUnique({
        where: { id: empId },
        select: {
            geoTrackingEnabled: true,
            geoTrackingConsent: true
        }
    });

    res.json(employee);
};

/**
 * Update consent
 */
export const updateGeoConsent = async (req: AuthenticatedRequest, res: Response) => {
    const empId = req.user.empId;
    const { consent } = req.body;

    await prisma.employee.update({
        where: { id: empId },
        data: {
            geoTrackingConsent: consent,
            geoTrackingConsentAt: consent ? new Date() : null
        }
    });

    res.json({ message: "Consent updated" });
};



/**
 * Add location point
 */
// A point is kept when EITHER condition holds:
//   • moved >= MIN_POINT_DISTANCE_M from the last point  → captures the route
//     shape while moving (a pure time throttle dropped most movement points), or
//   • MAX_IDLE_MS elapsed since the last point           → a heartbeat while
//     stationary, so presence at a site is still logged.
// Volume stays bounded: ~1 point / 20 m while moving, ~1 / min while idle.
const MIN_POINT_DISTANCE_M = 20;
const MAX_IDLE_MS = 60000; // 60s

export const addLocationPoint = async (req: AuthenticatedRequest, res: Response) => {
    const empId = Number(req.user?.empId ?? 0);
    const sessionId = toSessionId(req.body?.sessionId);
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const accuracy = optionalNumber(req.body?.accuracy);
    const speed = optionalNumber(req.body?.speed);
    const { recordedAt } = req.body ?? {};

    if (!sessionId) {
        return res.status(400).json({ message: "Invalid session" });
    }
    if (
        !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    ) {
        return res.status(400).json({ message: "Invalid coordinates" });
    }

    // Use the device's GPS fix time when supplied; fall back to server time.
    // Without this, buffered points flushed in a batch all get the same insert
    // timestamp (and out of order), which breaks route ordering and end-location.
    const parsed = recordedAt != null ? new Date(recordedAt) : null;
    const pointTime = parsed && !isNaN(parsed.getTime()) ? parsed : new Date();

    const session = await prisma.locationSession.findUnique({
        where: { id: sessionId }
    });

    if (!session || session.status !== "ACTIVE") {
        return res.status(400).json({ message: "Invalid session" });
    }

    // Only the session's own employee may add points to it.
    if (session.employeeId !== empId) {
        return res.status(403).json({ message: "Forbidden: not your session" });
    }

    const lastPoint = await prisma.locationPoint.findFirst({
        where: { sessionId },
        orderBy: { recordedAt: "desc" }
    });

    let distance = 0;

    if (lastPoint) {
        distance = calculateDistance(
            lastPoint.latitude,
            lastPoint.longitude,
            latitude,
            longitude
        );

        // Compare against the device fix time so this works for both live
        // points and buffered batches.
        const timeDiff =
            pointTime.getTime() - new Date(lastPoint.recordedAt).getTime();

        // Keep if the device moved enough OR enough time has passed; otherwise
        // it's a near-duplicate of the last point — skip it.
        if (distance < MIN_POINT_DISTANCE_M && timeDiff < MAX_IDLE_MS) {
          return res.json({ skipped: true });
        }
    }

    await prisma.locationPoint.create({
        data: {
            sessionId,
            latitude,
            longitude,
            accuracy,
            speed,
            recordedAt: pointTime
        }
    });

    await prisma.locationSession.update({
        where: { id: sessionId },
        data: {
            totalDistance: {
                increment: distance
            },
            totalPoints: {
                increment: 1
            }
        }
    });

    res.json({ success: true });
};



export const getEmployeeSessions = async (req: Request, res: Response) => {
    const employeeId = Number(req.params.employeeId);
    const date = new Date(req.query.date as string);

    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const sessions = await prisma.locationSession.findMany({
        where: {
            employeeId,
            startedAt: {
                gte: start,
                lte: end
            }
        },
        orderBy: { startedAt: "asc" }
    });

    res.json(sessions);
};

export const getSessionPoints = async (req: Request, res: Response) => {
    const sessionId = Number(req.params.sessionId);

    const points = await prisma.locationPoint.findMany({
        where: { sessionId },
        orderBy: { recordedAt: "asc" }
    });

    res.json(points);
};


export const createLocationSession = async (
    req: AuthenticatedRequest,
    res: Response
) => {
    console.log(req.user)
    const empId = req.user.empId;
    const { name } = req.body;

    const session = await prisma.locationSession.create({
        data: {
            employeeId: empId,
            name,
            status: "CREATED"
        }
    });

    res.json(session);
};

export const getMySessions = async (
    req: AuthenticatedRequest,
    res: Response
) => {
    const empId = req.user.empId;

    const sessions = await prisma.locationSession.findMany({
        where: { employeeId: empId },
        orderBy: { createdAt: "desc" },
        include:{
            _count:{
                select:{
                    photos: true
                }
            }
        }
    });

    res.json(sessions);
};
export const startLocationSession = async (
    req: AuthenticatedRequest,
    res: Response
) => {
    const empId = req.user.empId;
    const sessionId = toSessionId(req.body?.sessionId);
    if (!sessionId) {
        return res.status(400).json({ message: "Invalid session" });
    }

    const session = await prisma.locationSession.findFirst({
        where: {
            id: sessionId,
            employeeId: empId
        }
    });

    if (!session) {
        return res.status(404).json({ message: "Session not found" });
    }

    if (session.status === "ACTIVE") {
        return res.json({ sessionId: session.id });
    }

    const updated = await prisma.locationSession.update({
        where: { id: sessionId },
        data: {
            status: "ACTIVE",
            startedAt: new Date()
        }
    });

    res.json({ sessionId: updated.id });
};
export const endLocationSession = async (
    req: AuthenticatedRequest,
    res: Response
) => {
    const empId = req.user.empId;
    const sessionId = toSessionId(req.body?.sessionId);
    if (!sessionId) {
        return res.status(400).json({ message: "Invalid session" });
    }

    const session = await prisma.locationSession.findFirst({
        where: {
            id: sessionId,
            employeeId: empId
        }
    });

    if (!session) {
        return res.status(404).json({ message: "Session not found" });
    }

    await prisma.locationSession.update({
        where: { id: sessionId },
        data: {
            status: "COMPLETED",
            endedAt: new Date()
        }
    });

    res.json({ message: "Session ended" });
};


// Legacy FTP credentials — no longer used now that uploads are stored locally.
// const FTP_CONFIG = {
//     host: config.ftp.host,
//     user: config.ftp.user,
//     password: config.ftp.pass,
//     secure: config.ftp.secure,
// };

async function uploadToFTP(localFilePath: string, remotePath: string): Promise<void> {
    // Local disk storage (current). remotePath is a legacy
    // "/public_html/session-photos/<file>" path; saveLocal stores it under UPLOADS_DIR.
    await saveLocal(localFilePath, remotePath);

    // ── Legacy FTP upload (kept for reference / fallback) ─────────────────────
    // const client = new Client();
    // client.ftp.verbose = false;
    //
    // try {
    //     await client.access(FTP_CONFIG);
    //     await client.ensureDir("/public_html/session-photos");
    //     await client.uploadFrom(localFilePath, remotePath);
    // } finally {
    //     await client.close();
    // }
}

export const uploadSessionPhotos = async (req: AuthenticatedRequest, res: Response) => {
    const empId = req.user.empId;
    const sessionId = Number(req.params.sessionId);

    // Ensure session belongs to employee
    const session = await prisma.locationSession.findFirst({
        where: { id: sessionId, employeeId: empId },
        select: { id: true, status: true }
    });

    if (!session) return res.status(404).json({ message: "Session not found" });

    const form = formidable({
        multiples: true,
        keepExtensions: true,
        maxFileSize: 15 * 1024 * 1024, // 15MB each
        filter: (part) => {
            // accept only images
            return part.mimetype?.startsWith("image/") ?? false;
        },
    });

    form.parse(req, async (err, fields, files) => {
        if (err) return res.status(400).json({ message: "Upload failed", error: String(err) });

        const fileField = (files.photos ?? files.photo) as FormidableFile | FormidableFile[] | undefined;

        if (!fileField) return res.status(400).json({ message: "No photos uploaded (field: photos)" });

        const photoFiles = Array.isArray(fileField) ? fileField : [fileField];

        const created: { id: number; url: string }[] = [];

        const latitude = fields.latitude
            ? Number(Array.isArray(fields.latitude) ? fields.latitude[0] : fields.latitude)
            : null;

        const longitude = fields.longitude
            ? Number(Array.isArray(fields.longitude) ? fields.longitude[0] : fields.longitude)
            : null;



        for (const f of photoFiles) {
            const localPath = f.filepath;

            const ext = path.extname(f.originalFilename || "").toLowerCase() || ".jpg";
            const safeName = `${sessionId}_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;

            const remotePath = `/public_html/session-photos/${safeName}`;
            // const publicUrl = `https://hrproindia.in/session-photos/${safeName}`; // legacy FTP URL
            const fileUrl = publicUrl(remotePath);

            try {
                await uploadToFTP(localPath, remotePath);

                const row = await prisma.locationSessionPhoto.create({
                    data: {
                        sessionId,
                        url: fileUrl,
                        fileName: safeName,
                        capturedBy: empId,
                        capturedAt: new Date(),
                        longitude,
                        latitude
                    },
                    select: { id: true, url: true }
                });

                created.push(row);
            } finally {
                // cleanup temp file
                try { fs.unlinkSync(localPath); } catch { }
            }
        }

        return res.json({ success: true, photos: created });
    });
};
export const getSessionPhotos = async (req: AuthenticatedRequest, res: Response) => {
    const empId = req.user.empId;
    const sessionId = Number(req.params.sessionId);

    const session = await prisma.locationSession.findFirst({
        where: { id: sessionId, employeeId: empId },
        select: { id: true }
    });

    if (!session) return res.status(404).json({ message: "Session not found" });

    const photos = await prisma.locationSessionPhoto.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        select: { id: true, url: true, createdAt: true }
    });

    res.json(photos);
};
export const updateSessionName = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const empId = req.user.empId;
  const sessionId = toSessionId(req.body?.sessionId);
  const { name } = req.body ?? {};
  if (!sessionId) {
    return res.status(400).json({ message: "Invalid session" });
  }

  const session = await prisma.locationSession.findFirst({
    where: {
      id: sessionId,
      employeeId: empId
    }
  });

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  // allow edit only within 1 day
  const oneDay = 24 * 60 * 60 * 1000;
  const createdTime = new Date(session.createdAt).getTime();

  if (Date.now() - createdTime > oneDay) {
    return res.status(400).json({
      message: "Session name can only be edited within 1 day"
    });
  }

  const updated = await prisma.locationSession.update({
    where: { id: sessionId },
    data: { name }
  });

  res.json(updated);
};
export const getManagerTeamSessions = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const viewerId = Number(req.user?.empId ?? 0);
  if (!viewerId) return res.status(401).json({ message: "Unauthorized" });

  const me = await prisma.employee.findUnique({
    where: { id: viewerId },
    select: { roleId: true, departmentId: true },
  });
  if (!me) return res.status(401).json({ message: "Unauthorized" });

  // Who sees whose field sessions (same rule as weekly reports):
  //  - HR (HR Manager role or HR department) and Management: every employee in their
  //    data scope who uses tracking (has sessions or tracking switched on);
  //  - everyone else: their direct reports, the team they are in-charge of and, for
  //    HODs, the departments they head. (Previously only direct reports, so HR saw
  //    nothing for employees who don't report to them.)
  const isHR = me.roleId === HR_ROLE_ID || me.departmentId === 1;
  const isMgmt = me.roleId === 4 || MGMT_DASHBOARD_EMPID_ALLOWLIST.includes(viewerId);

  let where: Prisma.EmployeeWhereInput;
  if (isHR || isMgmt) {
    where = (await withEmployeeScope(viewerId, {
      OR: [{ locationSessions: { some: {} } }, { geoTrackingEnabled: true }],
    })) as Prisma.EmployeeWhereInput;
  } else {
    const team: Prisma.EmployeeWhereInput[] = [{ reportingManager: viewerId }, { inchargeId: viewerId }];
    if (me.roleId === HOD_ROLE_ID) {
      const depts = await headedDepartmentIds(viewerId);
      if (depts.length) team.push({ departmentId: { in: depts } });
    }
    where = { OR: team, id: { not: viewerId } };
  }

  const employees = await prisma.employee.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      photoUrl: true,
      locationSessions: {
        orderBy: { createdAt: "desc" },
        include: {
          // Chronological order — points can be inserted out of order when the
          // app flushes offline-queued points after newer live ones.
          locations: { orderBy: { recordedAt: "asc" } },
          photos: true
        }
      }
    }
  });

  res.json(employees);
};
