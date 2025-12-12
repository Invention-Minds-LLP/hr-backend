import { Request, Response } from 'express';
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();

import { prisma } from "../../lib/prisma";

export const getAttendanceCalendar = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const month = req.query.month as string; // e.g. 2025-10

    if (!employeeId || !month)
      return res.status(400).json({ message: 'employeeId and month are required' });

    const start = new Date(`${month}-01T00:00:00`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const [attendance, leaves, permissions, shiftSettings] = await Promise.all([
      prisma.attendance.findMany({
        where: { employeeId, date: { gte: start, lt: end } },
      }),
      prisma.leaveRequest.findMany({
        where: {
          employeeId,
          status: 'APPROVED',
          OR: [
            { startDate: { gte: start, lt: end } },
            { endDate: { gte: start, lt: end } },
          ],
        },
        include: { leaveType: true },
      }),
      prisma.permissionRequest.findMany({
        where: {
          employeeId,
          status: 'APPROVED',
          day: { gte: start, lt: end },
        },
      }),
      prisma.employeeShiftSetting.findMany({
        where: { employeeId },
        include: {
          fixedShift: true,
          rotationPattern: {
            include: {
              items: { include: { shift: true } }
            }
          }
        }
      })
    ]);

    // console.log('Attendance records:', attendance);
    const shiftMap = buildShiftMap(shiftSettings, start);


    const result = [
      ...attendance.map(a => {
        const checkIn = a.checkIn ? new Date(a.checkIn) : null;
        const checkOut = a.checkOut ? new Date(a.checkOut) : null;

        const shift = shiftMap.get(a.employeeId);
        const shiftStart = shift?.start || null;
        const shiftEnd = shift?.end || null;

        // ------ WORKING HOURS ------
        const hours = checkIn && checkOut ? Math.round(((checkOut.getTime() - checkIn.getTime())) / 3600000) : 0;

        // ------ FLAGS ------
        let flag = null;

        // Late login
        if (checkIn && shiftStart && checkIn > shiftStart) {
          flag = "late-login";
        }

        // Early logout
        if (checkOut && shiftEnd && checkOut < shiftEnd) {
          flag = flag ? `${flag},early-logout` : "early-logout";
        }

        // Half day
        if (hours > 0 && hours < 4) {
          flag = "half-day";
        }
        // ----- Determine finalStatus -----
        let finalStatus = a.status;  // Present / Absent from DB

        if (flag) {   // late login, early logout, half day
          if (!a.attendanceApproval) {
            finalStatus = 'PendingApproval';
          }
          else if (a.attendanceApproval === 'APPROVED') {
            finalStatus = 'Present';
          }
          else if (a.attendanceApproval === 'REJECTED') {
            finalStatus = 'Absent';
          }
        }
        return {
          title: `Worked ${hours}h`,
          start: a.date,
          type: 'attendance',
          status: a.status,
          checkIn: a.checkIn,
          checkOut: a.checkOut,
          hours,
          shiftStart,
          shiftEnd,
          flag,
          finalStatus,   // ⭐ THIS is your computed attendance status
          needsApproval: !!flag && a.attendanceApproval === null,
          attendanceApproval: a.attendanceApproval,
          approvedBy: a.approvedBy,
          approvedAt: a.approvedAt,
          attendanceId: a.id,
        };
      }),


      ...leaves.map(l => ({
        title: `Leave (${l.leaveType?.name ?? 'Unknown'})`,
        start: l.startDate,
        end: l.endDate,
        type: 'leave',
      })),
      ...permissions.map(p => ({
        title: `Permission ${p.timing ?? ''}`,
        start: p.day,
        type: 'permission',
      })),
    ];

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err });
  }
};
export const getWeeklyAttendance = async (req: Request, res: Response) => {
  try {
    const { employeeId, start, end } = req.query;

    if (!employeeId || !start || !end) {
      return res.status(400).json({ message: "Missing parameters" });
    }

    const startDate = new Date(start as string);
    const endDate = new Date(end as string);

    const attendance = await prisma.attendance.findMany({
      where: {
        employeeId: Number(employeeId),
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { date: 'asc' },
    });

    res.json(attendance);
  } catch (error) {
    console.error("Error fetching attendance:", error);
    res.status(500).json({ message: "Server error" });
  }
};

function buildShiftMap(settings: any[], monthStart: Date) {
  const map = new Map<number, { start: Date, end: Date }>();

  for (const s of settings) {

    // FIXED SHIFT
    if (s.mode === 'FIXED' && s.fixedShift?.startTime && s.fixedShift?.endTime) {
      map.set(s.employeeId, {
        start: combineDateAndTime(monthStart, s.fixedShift.startTime),
        end: combineDateAndTime(monthStart, s.fixedShift.endTime)
      });
    }

    // ROTATIONAL SHIFT
    else if (s.mode === 'ROTATIONAL' && s.rotationPattern?.items?.length) {

      // take first rotation (or you can calculate based on date index later)
      const shiftObj = s.rotationPattern.items[0].shift;

      if (shiftObj?.startTime && shiftObj?.endTime) {
        map.set(s.employeeId, {
          start: combineDateAndTime(monthStart, shiftObj.startTime),
          end: combineDateAndTime(monthStart, shiftObj.endTime)
        });
      }
    }
  }
  return map;
}

function combineDateAndTime(base: Date, t: Date) {
  const dt = new Date(base);
  const tt = new Date(t);
  dt.setHours(tt.getHours(), tt.getMinutes(), 0, 0);
  return dt;
}
export const approveAttendance = async (req: Request, res: Response) => {
  try {
    const { attendanceId, decision, hrId, rejectReason } = req.body;

    if (!attendanceId || !decision || !hrId)
      return res.status(400).json({ message: "Missing required fields" });

    const updateData: any = {
      attendanceApproval: decision,
      approvedBy: hrId,
      approvedAt: new Date(),
    };

    // Only save reason if rejected
    if (decision === 'REJECTED') {
      updateData.reason = rejectReason || "No reason provided";
    }

    const record = await prisma.attendance.update({
      where: { id: attendanceId },
      data: updateData
    });

    res.json({
      message: "Attendance updated successfully",
      updated: record
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err });
  }
};

