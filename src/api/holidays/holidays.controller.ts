import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Create holiday calendar for a year
 * POST /api/holidays/calendar
 */
export const createHolidayCalendar = async (req: Request, res: Response) => {
  try {
    const { year, name } = req.body;

    if (!year || !name) {
      return res.status(400).json({ message: "Year and name are required" });
    }

    const calendar = await prisma.holidayCalendar.create({
      data: { year, name }
    });

    res.status(201).json(calendar);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Add holiday to calendar
 * POST /api/holidays/calendar/:calendarId
 */
export const addHoliday = async (req: Request, res: Response) => {
  try {
    const { calendarId } = req.params;
    const { title, date, description, isOptional, branchId } = req.body;

    if (!title || !date) {
      return res.status(400).json({ message: "Title and date are required" });
    }

    const holiday = await prisma.holiday.create({
      data: {
        calendarId: Number(calendarId),
        title,
        date: new Date(date),
        description,
        isOptional: isOptional ?? false,
        // Null = org-wide holiday; set = only that branch's regional holiday.
        branchId: branchId ? Number(branchId) : null
      }
    });

    res.status(201).json(holiday);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Get holidays by year
 * GET /api/holidays/calendar/:year
 */
export const getHolidaysByYear = async (req: Request, res: Response) => {
  try {
    const { year } = req.params;
    // Optional: an employee-facing caller passes their own branchId to get
    // org-wide holidays plus their branch's regional ones. Omitted (the
    // masters admin screen) returns every holiday across every branch, since
    // that screen manages the whole org's calendars.
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;

    const calendar = await prisma.holidayCalendar.findUnique({
      where: { year: Number(year) },
      include: {
        holidays: {
          where: branchId !== undefined
            ? { OR: [{ branchId: null }, { branchId }] }
            : undefined,
          orderBy: { date: "asc" }
        }
      }
    });

    if (!calendar) {
      return res.status(404).json({ message: "Holiday calendar not found" });
    }

    res.json(calendar);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Update holiday
 * PUT /api/holidays/holiday/:id
 */
export const updateHoliday = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const holiday = await prisma.holiday.update({
      where: { id: Number(id) },
      data: req.body
    });

    res.json(holiday);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Delete holiday
 * DELETE /api/holidays/holiday/:id
 */
export const deleteHoliday = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.holiday.delete({
      where: { id: Number(id) }
    });

    res.json({ message: "Holiday deleted successfully" });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};
