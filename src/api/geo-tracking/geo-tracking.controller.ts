import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import fs from "fs";
import path from "path";
import formidable, { File as FormidableFile } from "formidable";
import { Client } from "basic-ftp";



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
export const addLocationPoint = async (req: Request, res: Response) => {
    const { sessionId, latitude, longitude, accuracy, speed } = req.body;

    const session = await prisma.locationSession.findUnique({
        where: { id: sessionId }
    });

    if (!session || session.status !== "ACTIVE") {
        return res.status(400).json({ message: "Invalid session" });
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

        const timeDiff =
            Date.now() - new Date(lastPoint.recordedAt).getTime();

        // skip noisy point
        if (timeDiff < 300000) {
          return res.json({ skipped: true });
        }
    }

    await prisma.locationPoint.create({
        data: {
            sessionId,
            latitude,
            longitude,
            accuracy,
            speed
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
    const { sessionId } = req.body;

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
    const { sessionId } = req.body;

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


const FTP_CONFIG = {
    host: process.env.FTP_HOST!,
    user: process.env.FTP_USER!,
    password: process.env.FTP_PASS!,
    secure: false,
};

async function uploadToFTP(localFilePath: string, remotePath: string): Promise<void> {
    const client = new Client();
    client.ftp.verbose = false;

    try {
        await client.access(FTP_CONFIG);
        await client.ensureDir("/public_html/session-photos");
        await client.uploadFrom(localFilePath, remotePath);
    } finally {
        await client.close();
    }
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
            const publicUrl = `https://hrproindia.in/session-photos/${safeName}`;

            try {
                await uploadToFTP(localPath, remotePath);

                const row = await prisma.locationSessionPhoto.create({
                    data: {
                        sessionId,
                        url: publicUrl,
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
  const { sessionId, name } = req.body;

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
  const managerId = req.user.empId;

  const employees = await prisma.employee.findMany({
    where: {
      reportingManager: managerId
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      photoUrl: true,
      locationSessions: {
        orderBy: { createdAt: "desc" },
        include: {
          locations: true,
          photos: true
        }
      }
    }
  });

  res.json(employees);
};
