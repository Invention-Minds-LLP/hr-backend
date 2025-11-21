import { Request, Response } from 'express';
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const getAttendanceCalendar = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const month = req.query.month as string; // e.g. 2025-10

    if (!employeeId || !month)
      return res.status(400).json({ message: 'employeeId and month are required' });

    const start = new Date(`${month}-01T00:00:00`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const [attendance, leaves, permissions] = await Promise.all([
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
    ]);

    const result = [
      ...attendance.map(a => ({
        title: `Worked ${a.checkIn && a.checkOut
          ? Math.round((+new Date(a.checkOut) - +new Date(a.checkIn)) / 3600000)
          : 0}h`,
        start: a.date,
        type: 'attendance',
      })),
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