import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { generateCompOffIfEligible } from "../../services/comOff.service";
import { autoCancelLeaveIfPresent, runOtAndLateLoginForDate } from "../biometric/biometric.controller";

/**
 * POST /api/mobile-attendance/punch
 * Record a check-in or check-out punch with photo + GPS
 */
export const recordPunch = async (req: Request, res: Response) => {
  try {
    const { employeeId, type, activityType, latitude, longitude, address, photoUrl, notes } = req.body;

    if (!employeeId || !type || !activityType || latitude == null || longitude == null) {
      return res.status(400).json({ message: "employeeId, type, activityType, latitude, and longitude are required" });
    }

    if (!["CHECK_IN", "CHECK_OUT"].includes(type)) {
      return res.status(400).json({ message: "type must be CHECK_IN or CHECK_OUT" });
    }

    if (!["OFFICE", "CLIENT_VISIT", "FIELD_WORK"].includes(activityType)) {
      return res.status(400).json({ message: "activityType must be OFFICE, CLIENT_VISIT, or FIELD_WORK" });
    }

    const now = new Date();

    // Create the punch record
    const punch = await prisma.attendancePunch.create({
      data: {
        employeeId: Number(employeeId),
        type,
        activityType,
        timestamp: now,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        address: address || null,
        photoUrl: photoUrl || null,
        notes: notes || null,
      },
    });

    // If this is a CHECK_IN, upsert the daily Attendance record
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (type === "CHECK_IN") {
      const existing = await prisma.attendance.findUnique({
        where: { employeeId_date: { employeeId: Number(employeeId), date: todayStart } },
      });

      if (!existing) {
        await prisma.attendance.create({
          data: {
            employeeId: Number(employeeId),
            date: todayStart,
            status: "PRESENT",
            checkIn: now,
          },
        });
      }

      // Mirror biometric: cancel any approved/pending leave for today
      try {
        await autoCancelLeaveIfPresent(Number(employeeId), todayStart);
      } catch (e) {
        console.error("[mobile-punch] autoCancelLeaveIfPresent failed", e);
      }

      // Compute late-login now (OT skipped here because checkOut isn't set yet)
      try {
        await runOtAndLateLoginForDate(todayStart);
      } catch (e) {
        console.error("[mobile-punch] runOtAndLateLoginForDate (CHECK_IN) failed", e);
      }
    }

    // If this is a CHECK_OUT, update the daily Attendance record's checkOut
    if (type === "CHECK_OUT") {
      await prisma.attendance.updateMany({
        where: { employeeId: Number(employeeId), date: todayStart },
        data: { checkOut: now },
      });

      // Mirror biometric downstream: comp-off + late/OT (TEMP_DEPT_SHIFT path)
      const updated = await prisma.attendance.findUnique({
        where: { employeeId_date: { employeeId: Number(employeeId), date: todayStart } },
      });
      if (updated) {
        try {
          await generateCompOffIfEligible(updated);
        } catch (e) {
          console.error("[mobile-punch] generateCompOffIfEligible failed", e);
        }
      }
      try {
        await runOtAndLateLoginForDate(todayStart);
      } catch (e) {
        console.error("[mobile-punch] runOtAndLateLoginForDate failed", e);
      }
    }

    return res.status(201).json({ message: "Punch recorded successfully", punch });
  } catch (error: any) {
    console.error("Error recording punch:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

/**
 * GET /api/mobile-attendance/today/:employeeId
 * Get all punches for today
 */
export const getTodayPunches = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    if (!employeeId) return res.status(400).json({ message: "employeeId is required" });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const punches = await prisma.attendancePunch.findMany({
      where: {
        employeeId,
        timestamp: { gte: todayStart, lt: todayEnd },
      },
      orderBy: { timestamp: "asc" },
    });

    // Also get the daily attendance record
    const attendance = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: todayStart } },
    });

    return res.json({ punches, attendance });
  } catch (error: any) {
    console.error("Error fetching today punches:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

/**
 * GET /api/mobile-attendance/history/:employeeId?start=&end=
 * Get punch history for a date range
 */
export const getPunchHistory = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const start = req.query.start as string;
    const end = req.query.end as string;

    if (!employeeId) return res.status(400).json({ message: "employeeId is required" });

    const where: any = { employeeId };
    if (start && end) {
      where.timestamp = { gte: new Date(start), lte: new Date(end) };
    }

    const punches = await prisma.attendancePunch.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: 100,
    });

    return res.json(punches);
  } catch (error: any) {
    console.error("Error fetching punch history:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
};
