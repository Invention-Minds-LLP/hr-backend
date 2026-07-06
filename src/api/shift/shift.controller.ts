import { Request, Response } from "express";
import { PrismaClient, ShiftAssignMode } from "@prisma/client";
import cron from 'node-cron';
import * as ExcelJS from 'exceljs';
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { createNotification } from "../notifications/notifications.controller";
import { Prisma } from "@prisma/client";

const prisma = new PrismaClient();


export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // Sunday
  d.setHours(0, 0, 0, 0);
  return d;
}

type WeekOffConfig = {
  weeks: Record<number, number>; // weekIndex -> dayOfWeek
};


/* ==========================
   SHIFT TEMPLATE CONTROLLERS
   ========================== */

// Create Shift Template
export const createShiftTemplate = async (req: Request, res: Response) => {
  try {
    const { name, shiftType, startTime, endTime, departmentIds } = req.body;

    const template = await prisma.shiftTemplate.create({
      data: {
        name,
        shiftType,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        ...(Array.isArray(departmentIds)
          ? { departments: { connect: departmentIds.map((id: number) => ({ id: Number(id) })) } }
          : {}),
      },
      include: { departments: { select: { id: true, name: true } } },
    });

    res.status(201).json(template);
  } catch (error) {
    console.error("Error creating shift template:", error);
    res.status(500).json({ error: "Failed to create shift template" });
  }
};

// Get All Shift Templates
export const getShiftTemplates = async (req: Request, res: Response) => {
  try {
    const templates = await prisma.shiftTemplate.findMany({
      include: { departments: { select: { id: true, name: true } } },
    });
    // Surface department ids as a flat array for easy binding on the master form.
    res.json(templates.map(t => ({ ...t, departmentIds: t.departments.map(d => d.id) })));
  } catch (error) {
    console.error("Error fetching shift templates:", error);
    res.status(500).json({ error: "Failed to fetch shift templates" });
  }
};

// Get Single Shift Template
export const getShiftTemplateById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const template = await prisma.shiftTemplate.findUnique({
      where: { id: Number(id) }
    });

    if (!template) {
      return res.status(404).json({ error: "Shift template not found" });
    }

    res.json(template);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch shift template" });
  }
};

// Update Shift Template
export const updateShiftTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, shiftType, startTime, endTime, departmentIds } = req.body;

    const updatedTemplate = await prisma.shiftTemplate.update({
      where: { id: Number(id) },
      data: {
        name,
        shiftType,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        // `set` replaces the whole mapping with whatever the form submitted.
        ...(Array.isArray(departmentIds)
          ? { departments: { set: departmentIds.map((did: number) => ({ id: Number(did) })) } }
          : {}),
      },
      include: { departments: { select: { id: true, name: true } } },
    });

    res.json(updatedTemplate);
  } catch (error) {
    res.status(500).json({ error: "Failed to update shift template" });
  }
};

// Delete Shift Template
export const deleteShiftTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.shiftTemplate.delete({
      where: { id: Number(id) }
    });

    res.json({ message: "Shift template deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete shift template" });
  }
};

/* ==========================
   SHIFT ASSIGNMENT CONTROLLERS
   ========================== */

// Assign Shift to Employee
export const assignShift = async (req: Request, res: Response) => {
  try {
    const { employeeId, shiftId, date } = req.body;

    const assignment = await prisma.shiftAssignment.create({
      data: {
        employeeId,
        shiftId,
        date: new Date(date),
        acknowledged: false
      },
      include: {
        employee: true,
        shift: true
      }
    });

    // const employee = await  prisma.employee.update({
    //     where:{
    //         id: employeeId
    //     },
    //     data:{
    //         shiftId: shiftId
    //     }
    // })

    res.status(201).json(assignment);
  } catch (error) {
    console.error("Error assigning shift:", error);
    res.status(500).json({ error: "Failed to assign shift" });
  }
};

// Get All Shift Assignments
export const getShiftAssignments = async (req: Request, res: Response) => {
  try {
    const assignments = await prisma.shiftAssignment.findMany({
      include: {
        employee: true,
        shift: true
      }
    });

    res.json(assignments);
  } catch (error) {
    console.error("Error fetching shift assignments:", error);
    res.status(500).json({ error: "Failed to fetch shift assignments" });
  }
};

// Get Shift Assignments for a Single Employee
export const getShiftAssignmentsByEmployee = async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.params;

    const assignments = await prisma.shiftAssignment.findMany({
      where: { employeeId: Number(employeeId) },
      include: {
        shift: true
      }
    });
    console.log('Assignments for employee', employeeId, assignments);
    res.json(assignments);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch shift assignments" });
  }
};

// Update Shift Assignment (e.g., Acknowledge)
export const updateShiftAssignment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { acknowledged } = req.body;

    const updatedAssignment = await prisma.shiftAssignment.update({
      where: { id: Number(id) },
      data: { acknowledged }
    });

    res.json(updatedAssignment);
  } catch (error) {
    res.status(500).json({ error: "Failed to update shift assignment" });
  }
};

// Delete Shift Assignment
export const deleteShiftAssignment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.shiftAssignment.delete({
      where: { id: Number(id) }
    });

    res.json({ message: "Shift assignment deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete shift assignment" });
  }
};


// -------- Utils
const DAY_MS = 24 * 60 * 60 * 1000;
const mod = (n: number, m: number) => ((n % m) + m) % m;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Generate ShiftAssignment rows for an employee for a window of days,
 * based on EmployeeShiftSetting (ROTATIONAL or FIXED).
 * For ROTATIONAL, use ShiftRotationPattern + items.
 */
async function generateAssignmentsForWindow(
  employeeId: number,
  fromDate: Date,
  days: number
) {
  const setting = await prisma.employeeShiftSetting.findUnique({
    where: { employeeId },
    include: {
      rotationPattern: {
        include: {
          items: { include: { shift: true } }
        }
      }
    }
  });

  if (!setting) throw new Error('EmployeeShiftSetting not found');

  // For simplicity, delete any existing assignments in the window and recreate.
  const from = startOfDay(fromDate);
  const to = startOfDay(new Date(from.getTime() + (days - 1) * DAY_MS));

  await prisma.shiftAssignment.deleteMany({
    where: {
      employeeId,
      date: { gte: from, lte: to }
    }
  });

  const rows: {
    employeeId: number;
    shiftId: number;
    date: Date;
    acknowledged: boolean;
  }[] = [];

  if (setting.mode === ShiftAssignMode.FIXED) {
    if (!setting.fixedShiftId) throw new Error('fixedShiftId missing for FIXED mode');

    for (let i = 0; i < days; i++) {
      const date = new Date(from.getTime() + i * DAY_MS);
      rows.push({
        employeeId,
        shiftId: setting.fixedShiftId,
        date,
        acknowledged: false
      });
    }
  } else {
    // ROTATIONAL
    const pattern = setting.rotationPattern;
    if (!pattern) throw new Error('rotationPattern missing for ROTATIONAL mode');
    const items = [...pattern.items].sort((a, b) => a.dayIndex - b.dayIndex);
    if (!items.length) throw new Error('rotationPattern has no items');

    const cycle = pattern.cycleDays > 0 ? pattern.cycleDays : items.length;

    const start = startOfDay(new Date(setting.startDate));

    for (let i = 0; i < days; i++) {
      const date = new Date(from.getTime() + i * DAY_MS);
      const diffDays = Math.floor((date.getTime() - start.getTime()) / DAY_MS);
      const idx = mod(diffDays, cycle);
      const item = items.find((x) => x.dayIndex === idx) ?? items[idx];
      if (!item) throw new Error(`No rotation item for index ${idx}`);
      rows.push({
        employeeId,
        shiftId: item.shiftId,
        date,
        acknowledged: false
      });
    }
  }

  if (rows.length) {
    await prisma.shiftAssignment.createMany({ data: rows });
  }
}

// -------- Rotation patterns

export const listRotationPatterns = async (_req: Request, res: Response) => {
  try {
    const patterns = await prisma.shiftRotationPattern.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      include: {
        items: {
          orderBy: { dayIndex: 'asc' },
          include: { shift: true }
        }
      }
    });
    res.json(patterns);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch rotation patterns' });
  }
};

export const createRotationPattern = async (req: Request, res: Response) => {
  try {
    const { name, cycleDays, isActive = true } = req.body;
    const p = await prisma.shiftRotationPattern.create({
      data: { name, cycleDays, isActive }
    });
    res.status(201).json(p);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create rotation pattern' });
  }
};

export const addRotationItem = async (req: Request, res: Response) => {
  try {
    const patternId = Number(req.params.patternId);
    const { dayIndex, shiftId } = req.body;

    const item = await prisma.shiftRotationItem.create({
      data: { patternId, dayIndex, shiftId }
    });
    res.status(201).json(item);
  } catch (e: any) {
    console.error(e);
    // likely unique(dayIndex) violation
    res.status(500).json({ error: e?.meta?.cause || 'Failed to add rotation item' });
  }
};

// (Optional) bulk add items
export const addRotationItemsBulk = async (req: Request, res: Response) => {
  try {
    const patternId = Number(req.params.patternId);
    const items: { dayIndex: number; shiftId: number }[] = req.body?.items || [];

    // Up to you if you want to validate duplicates here.
    await prisma.shiftRotationItem.createMany({
      data: items.map((i) => ({ ...i, patternId })),
      skipDuplicates: true
    });

    const out = await prisma.shiftRotationItem.findMany({
      where: { patternId },
      orderBy: { dayIndex: 'asc' }
    });

    res.status(201).json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to add rotation items' });
  }
};

// -------- Assign rotational to employee

// export const assignRotational = async (req: Request, res: Response) => {
//   try {
//     const { employeeId, patternId, startDate } = req.body as {
//       employeeId: number;
//       patternId: number;
//       startDate?: string;
//     };

//     const start = startDate ? new Date(startDate) : new Date();

//     // Upsert EmployeeShiftSetting (employeeId is unique)
//     await prisma.employeeShiftSetting.upsert({
//       where: { employeeId },
//       update: {
//         mode: 'ROTATIONAL',
//         rotationPatternId: patternId,
//         fixedShiftId: null,
//         startDate: start
//       },
//       create: {
//         employeeId,
//         mode: 'ROTATIONAL',
//         rotationPatternId: patternId,
//         startDate: start
//       }
//     });

//     // Generate next 30 days of assignments
//     // await generateAssignmentsForWindow(employeeId, start, 30);

//     res.json({ ok: true });
//   } catch (e: any) {
//     console.error(e);
//     res.status(500).json({ error: e?.message || 'Failed to assign rotational' });
//   }
// };

export const assignRotational = async (req: Request, res: Response) => {
  try {
    const { employeeId, patternId, startDate } = req.body;
    const start = startDate ? new Date(startDate) : new Date();

    // Get previous setting
    const previous = await prisma.employeeShiftSetting.findUnique({
      where: { employeeId }
    });

    // Update setting
    await prisma.employeeShiftSetting.upsert({
      where: { employeeId },
      update: {
        mode: 'ROTATIONAL',
        rotationPatternId: patternId,
        fixedShiftId: null,
        startDate: start
      },
      create: {
        employeeId,
        mode: 'ROTATIONAL',
        rotationPatternId: patternId,
        startDate: start
      }
    });

    // 🔥 IMPORTANT PART
    // If switching from FIXED → ROTATIONAL
    if (previous?.mode === 'FIXED') {
      await prisma.shiftAssignment.deleteMany({
        where: {
          employeeId,
          date: { gte: startOfDay(start) }
        }
      });
    }

    res.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};


// -------- (Optional) templates

export const listShiftTemplates = async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.shiftTemplate.findMany({
      orderBy: { id: 'asc' }
    });
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch shift templates' });
  }
};

// export function startShiftCron() {
//   cron.schedule('5 0 * * *', async () => {
//     console.log('🕛 Running daily shift generation');

//     const today = new Date();
//     today.setHours(0, 0, 0, 0);


//     /* =====================================================
//        1️⃣ APPLY APPROVED SHIFT CHANGES EFFECTIVE TODAY
//        ===================================================== */
//     const pendingApprovals = await prisma.shiftApproval.findMany({
//       where: {
//         status: 'APPROVED',
//         appliedAt: null,
//         startDate: { lte: today }
//       }
//     });

//     for (const approval of pendingApprovals) {
//       await applyApprovedShift(approval);

//       await prisma.shiftApproval.update({
//         where: { id: approval.id },
//         data: { appliedAt: today }
//       });
//     }
//     const employees = await prisma.employee.findMany({
//       where: {
//         employmentStatus: {
//           in: ['ACTIVE', 'NOTICE_PERIOD'],
//         },
//         EmployeeShiftSetting: {
//           isNot: null,
//         },
//       },
//       include: {
//         EmployeeShiftSetting: true,
//       },
//     });


//     for (const emp of employees) {
//       const setting = emp.EmployeeShiftSetting!;
//       let shiftId: number | null = null;

//       // FIXED
//       if (setting.mode === 'FIXED') {
//         shiftId = setting.fixedShiftId;
//       }

//       // ROTATIONAL
//       if (setting.mode === 'ROTATIONAL') {
//         const start = startOfDay(setting.startDate);

//         // 🚫 Do not apply rotation before startDate
//         if (today < start) continue;

//         shiftId = await getRotationalShiftId(
//           setting.rotationPatternId!,
//           setting.startDate,
//           today
//         );
//       }

//       if (!shiftId) continue;

//       // 🔎 Check if assignment already exists
//       const existing = await prisma.shiftAssignment.findFirst({
//         where: {
//           employeeId: emp.id,
//           date: today
//         }
//       });

//       // ✅ Do nothing if already exists (AUTO or MANUAL)
//       if (existing) continue;

//       // ✅ Create only if missing
//       await prisma.shiftAssignment.create({
//         data: {
//           employeeId: emp.id,
//           shiftId,
//           date: today,
//           // source: 'AUTO'
//         }
//       });
//     }
//   });
// }
export function startShiftCron() {
  cron.schedule('5 0 * * *', async () => {
    console.log('🕛 Running daily fixed shift generation');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    /* =====================================================
       1️⃣ APPLY APPROVED SHIFT CHANGES EFFECTIVE TODAY
       ===================================================== */
    const pendingApprovals = await prisma.shiftApproval.findMany({
      where: {
        status: 'APPROVED',
        appliedAt: null,
        startDate: { lte: today },
      },
    });

    for (const approval of pendingApprovals) {
      await applyApprovedShift(approval);

      await prisma.shiftApproval.update({
        where: { id: approval.id },
        data: { appliedAt: today },
      });
    }

    /* =====================================================
       2️⃣ AUTO-GENERATE SHIFTS — FIXED ONLY
       ===================================================== */
    const employees = await prisma.employee.findMany({
      where: {
        employmentStatus: {
          in: ['ACTIVE', 'NOTICE_PERIOD'],
        },
        EmployeeShiftSetting: {
          is: {
            mode: 'FIXED',
          },
        },
      },
      include: {
        EmployeeShiftSetting: true,
      },
    });

    for (const emp of employees) {
      const setting = emp.EmployeeShiftSetting!;
      const shiftId = setting.fixedShiftId;

      if (!shiftId) continue;

      // 🔎 Check if assignment already exists
      const existing = await prisma.shiftAssignment.findFirst({
        where: {
          employeeId: emp.id,
          date: today,
        },
      });

      // ✅ Skip if already assigned (AUTO or MANUAL)
      if (existing) continue;

      // ✅ Create fixed shift assignment
      await prisma.shiftAssignment.create({
        data: {
          employeeId: emp.id,
          shiftId,
          date: today,
          // source: 'AUTO',
        },
      });
    }
  });

  /* =====================================================
     MONTHLY — generate the WHOLE month for FIXED employees
     Runs at 00:05 on the 1st so future dates in the month
     already have ShiftAssignment rows (used by the leave
     popup, calendars, etc.). Idempotent: existing rows
     (manual overrides / today) are skipped.
     ===================================================== */
  cron.schedule('5 0 1 * *', async () => {
    console.log('🗓️  Running monthly fixed-shift generation');
    try {
      const count = await generateFixedShiftsForMonth(new Date());
      console.log(`🗓️  Monthly fixed-shift generation created ${count} assignments`);
    } catch (e) {
      console.error('Monthly fixed-shift generation failed:', e);
    }
  });

  // Also fill the current month immediately on boot (idempotent), so we don't
  // have to wait until the 1st for future-date rows to exist.
  generateFixedShiftsForMonth(new Date())
    .then((n) => n && console.log(`🗓️  Startup fixed-shift fill created ${n} assignments`))
    .catch((e) => console.error('Startup fixed-shift fill failed:', e));
}

/**
 * Generate ShiftAssignment rows for every day of `baseDate`'s month for all
 * ACTIVE / NOTICE_PERIOD employees on a FIXED shift. Existing rows (manual
 * overrides or already-generated days) are left untouched via skipDuplicates.
 * Returns the number of rows created.
 */
export async function generateFixedShiftsForMonth(baseDate: Date): Promise<number> {
  const year = baseDate.getFullYear();
  const monthIdx = baseDate.getMonth(); // 0-based
  const monthStart = new Date(year, monthIdx, 1);
  monthStart.setHours(0, 0, 0, 0);
  const nextMonthStart = new Date(year, monthIdx + 1, 1);
  nextMonthStart.setHours(0, 0, 0, 0);
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

  const employees = await prisma.employee.findMany({
    where: {
      employmentStatus: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
      EmployeeShiftSetting: { is: { mode: 'FIXED' } },
    },
    include: { EmployeeShiftSetting: true },
  });
  if (!employees.length) return 0;

  const empIds = employees.map((e) => e.id);

  // There's no unique (employeeId, date) constraint, so skip existing rows
  // manually to avoid duplicating today's row or any manual override.
  const existing = await prisma.shiftAssignment.findMany({
    where: { employeeId: { in: empIds }, date: { gte: monthStart, lt: nextMonthStart } },
    select: { employeeId: true, date: true },
  });
  const seen = new Set(
    existing.map((r) => `${r.employeeId}|${startOfDay(r.date).getTime()}`)
  );

  const rows: { employeeId: number; shiftId: number; date: Date }[] = [];
  for (const emp of employees) {
    const shiftId = emp.EmployeeShiftSetting?.fixedShiftId;
    if (!shiftId) continue;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, monthIdx, d);
      if (seen.has(`${emp.id}|${date.getTime()}`)) continue;
      rows.push({ employeeId: emp.id, shiftId, date });
    }
  }

  if (!rows.length) return 0;

  const result = await prisma.shiftAssignment.createMany({ data: rows });
  return result.count;
}

/**
 * POST /shifts/generate-fixed-month  (optional body/query: month 1-12, year)
 * Manually generate the whole month's fixed-shift assignments on demand —
 * useful for filling the remaining days of the current month without waiting
 * for the 1st-of-month cron or a server restart. Idempotent (skips existing).
 */
export const generateFixedShiftsForMonthHandler = async (req: Request, res: Response) => {
  try {
    const month = Number(req.body?.month ?? req.query?.month); // 1-12
    const year = Number(req.body?.year ?? req.query?.year);

    let base: Date;
    if (month >= 1 && month <= 12 && year) {
      base = new Date(year, month - 1, 1);
    } else {
      base = new Date(); // current month
    }

    const created = await generateFixedShiftsForMonth(base);

    // Diagnostics — explains a `created: 0` result.
    const fixedEmployees = await prisma.employee.count({
      where: {
        employmentStatus: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
        EmployeeShiftSetting: { is: { mode: 'FIXED' } },
      },
    });
    const fixedWithShift = await prisma.employee.count({
      where: {
        employmentStatus: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
        EmployeeShiftSetting: { is: { mode: 'FIXED', fixedShiftId: { not: null } } },
      },
    });
    const rotationalEmployees = await prisma.employee.count({
      where: {
        employmentStatus: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
        EmployeeShiftSetting: { is: { mode: 'ROTATIONAL' } },
      },
    });

    return res.json({
      month: base.getMonth() + 1,
      year: base.getFullYear(),
      created,
      diagnostics: { fixedEmployees, fixedWithShift, rotationalEmployees },
      message: `Generated ${created} fixed-shift assignment(s) for ${base.getMonth() + 1}/${base.getFullYear()}.`,
    });
  } catch (error) {
    console.error('generateFixedShiftsForMonthHandler error:', error);
    return res.status(500).json({ error: 'Failed to generate fixed-shift assignments' });
  }
};



// const DAY_MS = 24 * 60 * 60 * 1000;

export async function getRotationalShiftId(
  patternId: number,
  startDate: Date,
  targetDate: Date
): Promise<number | null> {

  const pattern = await prisma.shiftRotationPattern.findUnique({
    where: { id: patternId },
    include: {
      items: {
        orderBy: { dayIndex: 'asc' }
      }
    }
  });

  if (!pattern || pattern.items.length === 0) {
    return null;
  }

  const start = startOfDay(startDate);
  const target = startOfDay(targetDate);

  const diffDays = Math.floor(
    (target.getTime() - start.getTime()) / DAY_MS
  );

  const cycleDays =
    pattern.cycleDays > 0
      ? pattern.cycleDays
      : pattern.items.length;

  const index = mod(diffDays, cycleDays);

  // Prefer exact dayIndex match
  const item =
    pattern.items.find(i => i.dayIndex === index)
    ?? pattern.items[index % pattern.items.length];

  if (!item) return null;

  return item.shiftId;
}
export const listEmployeeShifts = async (req: Request, res: Response) => {
  const { employeeId, from, to } = req.query;

  const where: any = {};

  if (employeeId) where.employeeId = Number(employeeId);
  if (from && to) {
    where.date = {
      gte: new Date(from as string),
      lte: new Date(to as string),
    };
  }

  const shifts = await prisma.shiftAssignment.findMany({
    where,
    orderBy: { date: 'desc' },
    select: {
      id: true,
      date: true,

      shift: {
        select: {
          id: true,
          name: true,
          startTime: true,
          endTime: true,
        },
      },

      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          phone: true,
          employmentType: true,
          gender: true,
          photoUrl: true,

          Department: {
            select: {
              name: true,
            },
          },

          designation: {
            select: {
              name: true,
            },
          },

          EmployeeShiftSetting: {
            select: {
              mode: true,
              fixedShiftId: true,
              rotationPatternId: true,
              startDate: true,
            },
          },
        },
      },
    },
  });

  res.json(shifts);
};

// export const updateEmployeeShift = async (req: Request, res: Response) => {
//   const { assignmentId } = req.params;
//   const { shiftId } = req.body;

//   const updated = await prisma.shiftAssignment.update({
//     where: { id: Number(assignmentId) },
//     data: {
//       shiftId,
//     }
//   });

//   res.json(updated);
// };
// export const updateEmployeeShift = async (req: Request, res: Response) => {
//   const { assignmentId } = req.params;
//   const { shiftId } = req.body; // only shiftId comes from UI

//   // get existing assignment
//   const existing = await prisma.shiftAssignment.findUnique({
//     where: { id: Number(assignmentId) },
//     include: {
//       shift: true,
//       employee: {
//         include: {
//           reportingManagerId: true,
//         },
//       },
//     },
//   });

//   if (!existing) {
//     return res.status(404).json({ message: "Assignment not found" });
//   }

//   // update shift
//   const updated = await prisma.shiftAssignment.update({
//     where: { id: Number(assignmentId) },
//     data: { shiftId },
//     include: { shift: true },
//   });

//   // notify manager
//   const managerId = existing.employee.reportingManager?.id;

//   if (managerId) {
//     await createNotification(
//       managerId,
//       `Shift updated for ${existing.employee.name}: ${existing.shift.name} → ${updated.shift.name} from ${fmtDate(existing.startDate)} to ${fmtDate(existing.endDate)}.`
//     );
//   }

//   res.json(updated);
// };
export const updateEmployeeShift = async (req: Request, res: Response) => {
  const { assignmentId } = req.params;
  const { shiftId } = req.body;

  // 1. Get existing assignment
  const existing = await prisma.shiftAssignment.findUnique({
    where: { id: Number(assignmentId) },
    include: {
      shift: true,
      employee: true, // reportingManager comes automatically
    },
  });

  if (!existing) {
    return res.status(404).json({ message: "Assignment not found" });
  }

  // 2. Update shift
  const updated = await prisma.shiftAssignment.update({
    where: { id: Number(assignmentId) },
    data: { shiftId },
    include: {
      shift: true,
    },
  });

  // 3. Notify reporting manager
  const managerId = existing.employee.reportingManager;

  // if (managerId) {
  //   await createNotification(
  //     managerId,
  //     `Shift updated for ${existing.employee.firstName} ${existing.employee.lastName}: ${existing.shift.name} → ${updated.shift.name} on ${fmtDate(existing.date)}.`
  //   );
  // }

  res.json(updated);
};


export const assignFixed = async (req: Request, res: Response) => {
  try {
    const { employeeId, shiftId, startDate } = req.body;
    const start = startDate ? new Date(startDate) : new Date();

    const previous = await prisma.employeeShiftSetting.findUnique({
      where: { employeeId }
    });

    await prisma.employeeShiftSetting.upsert({
      where: { employeeId },
      update: {
        mode: 'FIXED',
        fixedShiftId: shiftId,
        rotationPatternId: null,
        startDate: start
      },
      create: {
        employeeId,
        mode: 'FIXED',
        fixedShiftId: shiftId,
        startDate: start
      }
    });

    // 🔥 If switching from ROTATIONAL → FIXED
    if (previous?.mode === 'ROTATIONAL') {
      await prisma.shiftAssignment.deleteMany({
        where: {
          employeeId,
          date: { gte: startOfDay(start) }
        }
      });
    }

    res.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};


// export const getManagerEmployees = async (
//   req: AuthenticatedRequest,
//   res: Response
// ) => {
//   try {
//     const managerId = req.user.empId;
//     console.log(req.user)
//     console.log('getManagerEmployees for managerId:', managerId);

//     const employees = await prisma.employee.findMany({
//       where: {
//         reportingManager: managerId,
//         employmentStatus: 'ACTIVE'
//       },
//       select: {
//         id: true,
//         firstName: true,
//         lastName: true,
//         employeeCode: true,
//         phone: true,
//         employmentType: true,

//         Department: {
//           select: {
//             name: true
//           }
//         },

//         designation: {
//           select: {
//             name: true
//           }
//         },

//         EmployeeShiftSetting: {
//           select: {
//             mode: true,
//             fixedShiftId: true,
//             rotationPatternId: true,
//             startDate: true
//           }
//         }
//       }
//     });

//     res.json(employees);
//   } catch (error) {
//     console.error('getManagerEmployees error:', error);
//     res.status(500).json({ error: 'Failed to fetch manager employees' });
//   }
// };

export const getManagerEmployees = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const empId = req.user.empId;
    const roleId = req.user.roleId;

    console.log('getManagerEmployees:', { empId, roleId });

    const where: any = {
      employmentStatus: {
        in: ['ACTIVE', 'NOTICE_PERIOD'],
      },
    };

    // Reporting Manager → use reportingManager
    if (roleId === 3 || roleId === 1) {
      where.reportingManager = empId;
    }

    // In-charge → use inchargeId
    else if (roleId === 5) {
      where.inchargeId = empId;
    }

    else {
      return res.status(403).json({ error: 'Unauthorized role' });
    }

    const employees = await prisma.employee.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        phone: true,
        employmentType: true,

        Department: {
          select: { name: true }
        },

        designation: {
          select: { name: true }
        },

        EmployeeShiftSetting: {
          select: {
            mode: true,
            fixedShiftId: true,
            rotationPatternId: true,
            startDate: true
          }
        }
      }
    });

    res.json(employees);
  } catch (error) {
    console.error('getManagerEmployees error:', error);
    res.status(500).json({ error: 'Failed to fetch manager employees' });
  }
};

export const getManagerShiftTemplates = async (req: Request, res: Response) => {
  const departmentId = Number(req.query.departmentId);
  if (!departmentId) {
    return res.status(400).json({ message: 'departmentId is required' });
  }

  // Shifts are now mapped to departments (master, many-to-many) instead of the
  // old hard-coded department → shiftType switch.
  const shifts = await prisma.shiftTemplate.findMany({
    where: { departments: { some: { id: departmentId } } },
    orderBy: { name: 'asc' },
  });

  res.json(shifts);
};

export const listManagerPatterns = async (req: Request, res: Response) => {
  const patterns = await prisma.shiftRotationPattern.findMany({
    where: {
      isActive: true,
      items: {
        every: {
          shift: {
            shiftType: 'EXECUTIVE'
          }
        }
      }
    },
    include: {
      items: {
        orderBy: { dayIndex: 'asc' },
        include: {
          shift: {
            select: {
              id: true,
              name: true,
              shiftType: true,
              startTime: true,
              endTime: true
            }
          }
        }
      }
    }
  });

  res.json(patterns);
};
// export const requestShiftChange = async (req: Request, res: Response) => {
//   const { employeeId, shiftId, date } = req.body;

//   const reqShift = await prisma.shiftApproval.create({
//     data: {
//       employeeId,
//       shiftId,
//       date: new Date(date)
//     }
//   });

//   res.status(201).json(reqShift);
// };
// export const updateShiftApproval = async (req: Request, res: Response) => {
//   const { id } = req.params;
//   const { role, status } = req.body;

//   const approval = await prisma.shiftApproval.findUnique({
//     where: { id: Number(id) }
//   });
//   if (!approval) return res.status(404).json({ error: "Not found" });

//   const approved = status === "APPROVED";
//   const data: any = {};

//   if (role === "INCHARGE") {
//     data.inchargeDecision = status;
//     data.inchargeDecidedAt = new Date();
//   }

//   else if (role === "REPORTING_MANAGER") {

//     data.rmDecision = status;
//     data.rmDecidedAt = new Date();
//   }

//   else if (role === "HR_MANAGER") {
//     if (approval.rmDecision !== "APPROVED")
//       return res.status(400).json({ error: "RM first" });

//     data.hrDecision = status;
//     data.hrDecidedAt = new Date();
//     data.status = status;

//     // FINAL → CREATE SHIFT
//     if (approved) {
//       await prisma.shiftAssignment.create({
//         data: {
//           employeeId: approval.employeeId,
//           shiftId: approval.fixedShiftId ?? null,
//           startDate: approval.startDate
//         }
//       });
//     }
//   }

//   else return res.status(403).json({ error: "Unauthorized" });

//   const updated = await prisma.shiftApproval.update({
//     where: { id: Number(id) },
//     data
//   });

//   res.json(updated);
// };


export const requestShiftChange = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { employeeId, mode, shiftId, patternId, startDate } = req.body;
  const requesterId = req.user.empId;



  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      inchargeId: true,
      reportingManager: true,
      firstName: true,
      lastName: true,
    }
  });

  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  const hasIncharge = !!employee.inchargeId;

  // 🔐 Authorization
  if (hasIncharge && requesterId !== employee.inchargeId)
    return res.status(403).json({ error: 'Only incharge can request' });

  if (!hasIncharge && requesterId !== employee.reportingManager)
    return res.status(403).json({ error: 'Only reporting manager can request' });

  const approval = await prisma.shiftApproval.create({
    data: {
      employeeId,
      requestedMode: mode,
      fixedShiftId: mode === 'FIXED' ? shiftId : null,
      patternId: mode === 'ROTATIONAL' ? patternId : null,
      startDate: new Date(startDate),
      requestedBy: requesterId,
      hasIncharge
    }
  });
  const requester = await prisma.employee.findUnique({
    where: { id: requesterId },
    select: { firstName: true, lastName: true }
  });

  const requesterName = requester
    ? `${requester.firstName} ${requester.lastName}`
    : 'Concerned Authority';

  const employeeName = `${employee.firstName} ${employee.lastName}`;
  const notifyMsg = `${requesterName} requested a shift change for ${employeeName} effective from ${fmtDate(approval.startDate)}.`;

  // 🔔 Notify the next approver: in-charge raised → Reporting Manager; else HR.
  if (hasIncharge) {
    if (employee.reportingManager) {
      await createNotification(employee.reportingManager, notifyMsg, '🗓️ Shift Request');
    }
  } else {
    const hrIds = await getHRManagerId();
    for (const hid of hrIds) await createNotification(hid, notifyMsg, '🗓️ Shift Request');
  }

  res.status(201).json(approval);
};
export const approveShiftChange = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { id } = req.params;
  const { role, decision, reason } = req.body; // RM | HR
  const approverId = req.user.empId;

  const approval = await prisma.shiftApproval.findUnique({
    where: { id: Number(id) },
    include: {
      employee: {
        select: {
          reportingManager: true,
          firstName: true,
          lastName: true,
          id: true,
          inchargeId: true

        }
      }
    }
  });

  if (!approval) return res.status(404).json({ error: 'Not found' });

  const data: any = {};

  // RM approval only if incharge exists
  if (role === 'RM') {
    if (!approval.hasIncharge)
      return res.status(400).json({ error: 'RM approval not required' });

    if (approverId !== approval.employee.reportingManager)
      return res.status(403).json({ error: 'Not reporting manager' });

    data.rmDecision = decision;
    data.rmDecidedAt = new Date();
    if (decision === 'REJECTED') {
      data.rmRejectReason = reason;
    }
  }

  // HR approval (always final)
  if (role === 'HR') {
    if (approval.hasIncharge && approval.rmDecision !== 'APPROVED')
      return res.status(400).json({ error: 'RM approval pending' });

    data.hrDecision = decision;
    data.hrDecidedAt = new Date();
    data.status = decision;
    if (decision === 'REJECTED') {
      data.hrRejectReason = reason;
    }
  }

  const updated = await prisma.shiftApproval.update({
    where: { id: Number(id) },
    data
  });

  // 🔥 APPLY ONLY WHEN FINAL APPROVED
  // const fullyApproved =
  //   updated.hrDecision === 'APPROVED' &&
  //   (!updated.hasIncharge || updated.rmDecision === 'APPROVED');

  // if (fullyApproved) {
  //   await applyApprovedShift(updated);
  // }
  const today = startOfDay(new Date());
  const effectiveFrom = startOfDay(new Date(updated.startDate));

  const fullyApproved =
    updated.hrDecision === 'APPROVED' &&
    (!updated.hasIncharge || updated.rmDecision === 'APPROVED');

  if (fullyApproved) {
    if (approval.patternId) {
      await applyMonthlyPattern(approval);
    }
    await prisma.employeeShiftSetting.upsert({
      where: { employeeId: approval.employeeId },
      update: {
        mode: approval.requestedMode,
        fixedShiftId: approval.fixedShiftId,
        rotationPatternId: approval.patternId,
        startDate: approval.startDate
      },
      create: {
        employeeId: approval.employeeId,
        mode: approval.requestedMode,
        fixedShiftId: approval.fixedShiftId,
        rotationPatternId: approval.patternId,
        startDate: approval.startDate
      }
    });
    // await applyApprovedShift(updated);

    await prisma.shiftApproval.update({
      where: { id: updated.id },
      data: { appliedAt: new Date() }
    });
  }

  const who = `${approval.employee.firstName} ${approval.employee.lastName}`;

  // ---------------- NOTIFY NEXT APPROVER ----------------
  // RM approved → the request now moves to HR: notify HR, and tell the creator.
  if (role === 'RM' && decision === 'APPROVED') {
    const hrIds = await getHRManagerId();
    for (const hid of hrIds) await createNotification(hid,
      `Shift change for ${who} effective from ${fmtDate(updated.startDate)} is awaiting HR approval.`,
      '🗓️ Shift Request');

    if (updated.requestedBy) await createNotification(updated.requestedBy,
      `Your shift request for ${who} was approved by the Reporting Manager and sent to HR.`,
      '✅ Shift Request');
  }

  // ---------------- FINAL STATUS ----------------
  if (role === 'HR' && decision === 'APPROVED') {
    // Fully approved → notify the employee, their managers and the creator.
    const targets = [
      approval.employee.id,
      approval.employee.reportingManager,
      approval.employee.inchargeId,
      updated.requestedBy,
    ];
    for (const uid of [...new Set(targets.filter(Boolean))] as number[]) {
      await createNotification(uid,
        `Shift change for ${who} effective from ${fmtDate(updated.startDate)} has been approved.`,
        '✅ Shift Approved');
    }
  }

  if (decision === 'REJECTED') {
    const rejectedBy = role === 'HR' ? 'HR' : 'the Reporting Manager';
    const targets = [
      updated.requestedBy,
      approval.employee.reportingManager,
      approval.employee.inchargeId,
    ];
    for (const uid of [...new Set(targets.filter(Boolean))] as number[]) {
      await createNotification(uid,
        `Shift request for ${who} effective from ${fmtDate(updated.startDate)} was rejected by ${rejectedBy}.` +
        (reason ? ` Reason: ${reason}` : ''),
        '❌ Shift Rejected');
    }
  }

  res.json(updated);
};
// async function notifyUsers(userIds: (number | null | undefined)[], message: string) {
//   const uniqueIds = [...new Set(userIds.filter(Boolean))] as number[];
//   await Promise.all(
//     uniqueIds.map(id => createNotification(id, message))
//   );
// }

async function applyApprovedShift(approval: any) {
  await prisma.employeeShiftSetting.upsert({
    where: { employeeId: approval.employeeId },
    update: {
      mode: approval.requestedMode,
      fixedShiftId: approval.fixedShiftId,
      rotationPatternId: approval.patternId,
      startDate: approval.startDate
    },
    create: {
      employeeId: approval.employeeId,
      mode: approval.requestedMode,
      fixedShiftId: approval.fixedShiftId,
      rotationPatternId: approval.patternId,
      startDate: approval.startDate
    }
  });

  await prisma.shiftAssignment.deleteMany({
    where: {
      employeeId: approval.employeeId,
      date: { gte: startOfDay(approval.startDate) }
    }
  });

  // For FIXED changes, re-fill the rest of the start date's month so future
  // dates keep their rows (the monthly cron will cover subsequent months).
  if (approval.requestedMode === 'FIXED' && approval.fixedShiftId) {
    const from = startOfDay(approval.startDate);
    const daysInMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
    const rows: { employeeId: number; shiftId: number; date: Date }[] = [];
    for (let d = from.getDate(); d <= daysInMonth; d++) {
      rows.push({
        employeeId: approval.employeeId,
        shiftId: approval.fixedShiftId,
        date: new Date(from.getFullYear(), from.getMonth(), d),
      });
    }
    if (rows.length) {
      // Rows in this range were just deleted above, so a plain insert is safe.
      await prisma.shiftAssignment.createMany({ data: rows });
    }
  }
}
export const listApprovalsInbox = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const empId = req.user.empId;
    const roleId = req.user.roleId; // adjust based on your auth payload
    const where: any = {};

    // HR inbox: pending final decisions PLUS pending edit-requests on approved plans.
    if (roleId === 1 || (roleId === 2 && req.user.deptId === 1)) {
      where.OR = [
        // Final approval pending (HR can act when RM already approved / not required)
        { status: 'PENDING', OR: [{ hasIncharge: false }, { hasIncharge: true, rmDecision: 'APPROVED' }] },
        // Edit permission requested by the creator on an approved plan
        { editStatus: 'REQUESTED' },
      ];
    }


    // RM inbox: only when incharge exists and RM decision pending
    if (roleId === 3) {
      where.OR = [
        { hasIncharge: false },
        { hasIncharge: true, rmDecision: 'APPROVED' }
      ];

      where.OR = [
        // 1️⃣ Team members (reporting manager)
        { employee: { reportingManager: empId } },

        // 2️⃣ In-charge employees under RM
        { employee: { inchargeId: empId } },

        // 3️⃣ RM’s own requests
        { requestedBy: empId }
      ];
    }


    if (roleId === 5) {
      where.hasIncharge = true;
      where.employee = { inchargeId: empId };
    }

    const rows = await prisma.shiftApproval.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true,
            gender: true, photoUrl: true,
            inchargeId: true, reportingManager: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } }
          }
        },
        requestedByEmployee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        fixedShift: { select: { id: true, name: true, startTime: true, endTime: true, shiftType: true } },
        pattern: {
          select: {
            id: true, name: true, cycleDays: true, month: true, year: true, source: true,
            items: { orderBy: { dayIndex: 'asc' }, select: { dayIndex: true, shiftId: true } }
          }
        }
      }
    });

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch approvals inbox' });
  }
};
export const listMyShiftRequests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const empId = req.user.empId;

    const rows = await prisma.shiftApproval.findMany({
      where: { requestedBy: empId },
      orderBy: { requestedAt: 'desc' },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } }
          }
        },
        fixedShift: { select: { id: true, name: true, startTime: true, endTime: true } },
        pattern: { select: { id: true, name: true } }
      }
    });

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch my shift requests' });
  }
};
export const listEmployeeShiftRequests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);

    // Optional: restrict visibility (RM can view only their team, HR can view all, etc.)

    const rows = await prisma.shiftApproval.findMany({
      where: { employeeId },
      orderBy: { requestedAt: 'desc' },
      take: 5, // last 5 requests
      include: {
        fixedShift: { select: { id: true, name: true, startTime: true, endTime: true } },
        pattern: { select: { id: true, name: true } },
        requestedByEmployee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } }
      }
    });

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch employee shift requests' });
  }
};
export async function getHRManagerId(): Promise<number[]> {
  const hrs = await prisma.employee.findMany({
    where: {
      departmentId: 1,              // HR department
      employmentStatus: "ACTIVE"
    },
    select: { id: true }
  });

  if (!hrs.length) {
    throw new Error("No active HR users found");
  }

  return hrs.map(h => h.id);
}
export function fmtDate(date: Date | string | null | undefined): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;

  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}
const MONTH_NAMES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

function getMonthName(month: number) {
  return MONTH_NAMES[month - 1]; // month is 1-based
}

// export const requestMonthlyShift = async (
//   req: AuthenticatedRequest,
//   res: Response
// ) => {
//   const { employeeId, month, year, weekShifts } = req.body;
//   const requesterId = req.user.empId;

//   // 1️⃣ Fetch employee hierarchy
//   const employee = await prisma.employee.findUnique({
//     where: { id: employeeId },
//     select: {
//       inchargeId: true,
//       reportingManager: true,
//       firstName: true,
//       lastName: true
//     }
//   });

//   if (!employee)
//     return res.status(404).json({ error: 'Employee not found' });

//   const hasIncharge = !!employee.inchargeId;

//   // 2️⃣ Authorization (ROLE-WISE)
//   if (hasIncharge && requesterId !== employee.inchargeId) {
//     return res.status(403).json({
//       error: 'Only in-charge can request monthly shift'
//     });
//   }

//   if (!hasIncharge && requesterId !== employee.reportingManager) {
//     return res.status(403).json({
//       error: 'Only reporting manager can request monthly shift'
//     });
//   }

//   // 3️⃣ Build date range (same logic you already had)
//   const monthStart = new Date(year, month - 1, 1);
//   const monthEnd = new Date(year, month, 0);

//   const firstWeekStart = startOfWeek(monthStart);

//   const lastWeekEnd = new Date(startOfWeek(monthEnd));
//   lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);

//   const items: { dayIndex: number; shiftId: number }[] = [];
//   let index = 0;
//   let current = new Date(firstWeekStart);

//   while (current <= lastWeekEnd) {
//     const weekIndex = Math.floor(
//       (current.getTime() - firstWeekStart.getTime()) / (7 * 86400000)
//     );

//     const shiftId = weekShifts[weekIndex];
//     if (!shiftId) {
//       return res.status(400).json({
//         error: `Shift missing for week ${weekIndex + 1}`
//       });
//     }

//     items.push({ dayIndex: index, shiftId });
//     index++;
//     current.setDate(current.getDate() + 1);
//   }

//   // 4️⃣ Create rotation pattern
//   const pattern = await prisma.shiftRotationPattern.create({
//     data: {
//       name: `MONTH-${month}-${year}-EMP-${employeeId}`,
//       cycleDays: items.length,
//       source: 'MONTHLY',
//       month,
//       year
//     }
//   });

//   await prisma.shiftRotationItem.createMany({
//     data: items.map(i => ({ ...i, patternId: pattern.id }))
//   });

//   // 5️⃣ Create approval
//   const approval = await prisma.shiftApproval.create({
//     data: {
//       employeeId,
//       requestedMode: 'ROTATIONAL',
//       patternId: pattern.id,
//       startDate: monthStart, // legacy, ignored
//       requestedBy: requesterId,
//       hasIncharge
//     }
//   });

//   // 6️⃣ Notifications (NEXT APPROVER)
//   const employeeName = `${employee.firstName} ${employee.lastName}`;

//   if (hasIncharge) {
//     // In-charge → RM
//     await createNotification(
//       employee.reportingManager!,
//       `Monthly shift request raised for ${employeeName}`
//     );
//   } else {
//     // RM → HR
//     const hrIds = await getHRManagerId();
//     await Promise.all(
//       hrIds.map(id =>
//         createNotification(
//           id,
//           `Monthly shift request raised for ${employeeName}`
//         )
//       )
//     );
//   }

//   res.status(201).json({
//     message: 'Monthly shift request submitted successfully',
//     approvalId: approval.id
//   });
// };



// export async function applyMonthlyPattern(approval: any) {
//   const pattern = await prisma.shiftRotationPattern.findUnique({
//     where: { id: approval.patternId },
//     include: { items: true }
//   });

//   if (!pattern) return;

//   const monthStart = new Date(pattern.year!, (pattern.month!) - 1, 1);
//   const firstWeekStart = startOfWeek(monthStart);

//   const lastWeekEnd = new Date(
//     startOfWeek(new Date(pattern.year!, pattern.month!, 0))
//   );
//   lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);

//   await prisma.shiftAssignment.deleteMany({
//     where: {
//       employeeId: approval.employeeId,
//       date: { gte: firstWeekStart, lte: lastWeekEnd }
//     }
//   });

//   const assignments = pattern.items.map(item => ({
//     employeeId: approval.employeeId,
//     shiftId: item.shiftId,
//     date: new Date(firstWeekStart.getTime() + item.dayIndex * 86400000),
//     acknowledged: false
//   }));

//   await prisma.shiftAssignment.createMany({
//     data: assignments
//   });
// }
// export const requestMonthlyShift = async (
//   req: AuthenticatedRequest,
//   res: Response
// ) => {
//   try {
//     const { employeeId, month, year, weekShifts } = req.body;
//     const requesterId = req.user.empId;

//     /* ------------------------------------------------
//      1️⃣ Fetch employee & hierarchy
//     ------------------------------------------------ */
//     const employee = await prisma.employee.findUnique({
//       where: { id: employeeId },
//       select: {
//         inchargeId: true,
//         reportingManager: true,
//         firstName: true,
//         lastName: true
//       }
//     });

//     if (!employee) {
//       return res.status(404).json({ error: 'Employee not found' });
//     }

//     const hasIncharge = !!employee.inchargeId;

//     /* ------------------------------------------------
//      2️⃣ Authorization
//     ------------------------------------------------ */
//     if (hasIncharge && requesterId !== employee.inchargeId) {
//       return res.status(403).json({
//         error: 'Only in-charge can request monthly shift'
//       });
//     }

//     if (!hasIncharge && requesterId !== employee.reportingManager) {
//       return res.status(403).json({
//         error: 'Only reporting manager can request monthly shift'
//       });
//     }

//     /* ------------------------------------------------
//      3️⃣ Build FULL week range for the month
//     ------------------------------------------------ */
//     const monthStart = new Date(year, month - 1, 1);
//     const monthEnd = new Date(year, month, 0);

//     const firstWeekStart = startOfWeek(monthStart);
//     const lastWeekEnd = new Date(startOfWeek(monthEnd));
//     lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);

//     /* ------------------------------------------------
//      4️⃣ Build rotation items
//          - Loop WEEK by WEEK
//          - Expand DAYS only when needed
//     ------------------------------------------------ */
//     const items: { dayIndex: number; shiftId: number }[] = [];

//     let dayIndex = 0;
//     let current = new Date(firstWeekStart);

//     while (current <= lastWeekEnd) {
//       const weekIndex = Math.floor(
//         (current.getTime() - firstWeekStart.getTime()) / (7 * 86400000)
//       );

//       const shiftId = weekShifts?.[weekIndex];

//       /* --------------------------------------------
//          A️⃣ Week NOT sent from UI
//          → check if already assigned (cross-month)
//       -------------------------------------------- */
//       if (!shiftId) {
//         const existing = await prisma.shiftAssignment.findFirst({
//           where: {
//             employeeId,
//             date: {
//               gte: current,
//               lte: new Date(new Date(current).setDate(current.getDate() + 6))
//             }
//           }
//         });

//         if (existing) {
//           // ✅ Week already covered → skip
//           current.setDate(current.getDate() + 7);
//           continue;
//         }

//         // ❌ Truly missing week
//         return res.status(400).json({
//           error: `Shift missing for week ${weekIndex + 1}`
//         });
//       }

//       /* --------------------------------------------
//          B️⃣ Expand selected week into 7 days
//       -------------------------------------------- */
//       for (let d = 0; d < 7; d++) {
//         const date = new Date(current);
//         date.setDate(current.getDate() + d);

//         if (date < firstWeekStart || date > lastWeekEnd) continue;

//         items.push({
//           dayIndex,
//           shiftId
//         });

//         dayIndex++;
//       }

//       // ⏭ move to next week
//       current.setDate(current.getDate() + 7);
//     }

//     /* ------------------------------------------------
//      5️⃣ Create MONTHLY rotation pattern
//     ------------------------------------------------ */
//     const pattern = await prisma.shiftRotationPattern.create({
//       data: {
//         name: `MONTH-${month}-${year}-EMP-${employeeId}`,
//         cycleDays: items.length,
//         source: 'MONTHLY',
//         month,
//         year
//       }
//     });

//     await prisma.shiftRotationItem.createMany({
//       data: items.map(i => ({
//         ...i,
//         patternId: pattern.id
//       }))
//     });

//     /* ------------------------------------------------
//      6️⃣ Create approval
//     ------------------------------------------------ */
//     const approval = await prisma.shiftApproval.create({
//       data: {
//         employeeId,
//         requestedMode: 'ROTATIONAL',
//         patternId: pattern.id,
//         startDate: monthStart, // legacy
//         requestedBy: requesterId,
//         hasIncharge
//       }
//     });

//     /* ------------------------------------------------
//      7️⃣ Notifications
//     ------------------------------------------------ */
//     const employeeName = `${employee.firstName} ${employee.lastName}`;

//     if (hasIncharge) {
//       await createNotification(
//         employee.reportingManager!,
//         `Monthly shift request raised for ${employeeName}`
//       );
//     } else {
//       const hrIds = await getHRManagerId();
//       await Promise.all(
//         hrIds.map(id =>
//           createNotification(
//             id,
//             `Monthly shift request raised for ${employeeName}`
//           )
//         )
//       );
//     }

//     /* ------------------------------------------------
//      8️⃣ Success
//     ------------------------------------------------ */
//     return res.status(201).json({
//       message: 'Monthly shift request submitted successfully',
//       approvalId: approval.id
//     });

//   } catch (err) {
//     console.error('requestMonthlyShift error:', err);
//     return res.status(500).json({
//       error: 'Failed to submit monthly shift request'
//     });
//   }
// };
// export async function applyMonthlyPattern(approval: any) {
//   const pattern = await prisma.shiftRotationPattern.findUnique({
//     where: { id: approval.patternId },
//     include: { items: true }
//   });

//   if (!pattern) return;

//   const monthStart = new Date(pattern.year!, pattern.month! - 1, 1);
//   const firstWeekStart = startOfWeek(monthStart);

//   const lastDayIndex = Math.max(...pattern.items.map(i => i.dayIndex));
//   const lastDate = new Date(
//     firstWeekStart.getTime() + lastDayIndex * 86400000
//   );

//   // ✅ DELETE ENTIRE PATTERN RANGE
//   await prisma.shiftAssignment.deleteMany({
//     where: {
//       employeeId: approval.employeeId,
//       date: {
//         gte: firstWeekStart,
//         lte: lastDate
//       }
//     }
//   });

//   // ✅ RECREATE ALL DAYS CLEANLY
//   const assignments = pattern.items.map(item => ({
//     employeeId: approval.employeeId,
//     shiftId: item.shiftId,
//     date: new Date(
//       firstWeekStart.getTime() + item.dayIndex * 86400000
//     ),
//     acknowledged: false
//   }));

//   await prisma.shiftAssignment.createMany({ data: assignments });
// }


// export const getMonthlyShiftStatus = async (req:Request, res: Response) => {
//   const { employeeId, month, year } = req.body;

//   const pattern = await prisma.shiftRotationPattern.findFirst({
//     where: {
//       source: 'MONTHLY',
//       month,
//       year,
//       shiftApprovals: {
//         some: {
//           employeeId,
//           status: 'APPROVED'
//         }
//       }
//     },
//     include: {
//       items: {
//         orderBy: { dayIndex: 'asc' }
//       }
//     }
//   });

//   if (!pattern) {
//     return res.json({ isMonthAssigned: false });
//   }

//   // weekIndex → shiftId
//   const weekShifts: Record<number, number> = {};

//   pattern.items.forEach((item: { dayIndex: number; shiftId: number }) => {
//     const weekIndex = Math.floor(item.dayIndex / 7);

//     if (weekShifts[weekIndex] === undefined) {
//       weekShifts[weekIndex] = item.shiftId;
//     }
//   });

//   return res.json({
//     isMonthAssigned: true,
//     weekShifts
//   });
// };
export const requestMonthlyShift = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { employeeId, month, year, weekShifts, weekOffConfig, dayOverrides } = req.body;
    const requesterId = req.user.empId;

    /* -----------------------------
       1️⃣ Authorization (unchanged)
    ----------------------------- */

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        inchargeId: true,
        reportingManager: true,
        firstName: true,
        lastName: true,
        employeeCode: true
      }
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // ✅ Validate weekOffConfig
    if (weekOffConfig?.weeks) {
      for (const [weekIndex, day] of Object.entries(weekOffConfig.weeks)) {
        const weekOffDay = Number(day);

        if (
          Number.isNaN(weekOffDay) ||
          weekOffDay < 0 ||
          weekOffDay > 6
        ) {
          return res.status(400).json({
            error: `Invalid weekOffDay for week ${weekIndex}`
          });
        }
      }
    }


    const hasIncharge = !!employee.inchargeId;

    if (hasIncharge && requesterId !== employee.inchargeId) {
      return res.status(400).json({ error: 'Only in-charge can request monthly shift' });
    }

    if (!hasIncharge && requesterId !== employee.reportingManager) {
      return res.status(400).json({ error: 'Only reporting manager can request monthly shift' });
    }

    /* -----------------------------
       2️⃣ Calculate range
    ----------------------------- */

    const monthStart = new Date(year, month - 1, 1);

    /* -----------------------------
       3️⃣ Build items (week shifts + per-day overrides)
    ----------------------------- */

    const items = buildMonthlyPatternItems(month, year, weekShifts || {}, dayOverrides);

    /* -----------------------------
       4️⃣ Create pattern
    ----------------------------- */
    const monthName = getMonthName(month);
    const pattern = await prisma.shiftRotationPattern.create({
      data: {
        name: `MONTH-${monthName}-${year}-${employee.employeeCode}`,
        cycleDays: items.length,
        source: 'MONTHLY',
        month,
        year
      }
    });

    await prisma.shiftRotationItem.createMany({
      data: items.map(i => ({
        ...i,
        patternId: pattern.id
      }))
    });

    /* -----------------------------
       5️⃣ Approval (unchanged)
    ----------------------------- */

    const approval = await prisma.shiftApproval.create({
      data: {
        employeeId,
        requestedMode: 'ROTATIONAL',
        patternId: pattern.id,
        startDate: monthStart,
        requestedBy: requesterId,
        hasIncharge,
        weekOffConfig: weekOffConfig ?? null,
        month: month,
        year: year
      }
    });

    // 🔔 Notify the next approver: in-charge raised → Reporting Manager first;
    // Reporting Manager raised (no in-charge) → straight to HR.
    const who = `${employee.firstName} ${employee.lastName}`;
    if (hasIncharge && employee.reportingManager) {
      await createNotification(employee.reportingManager,
        `Monthly shift request for ${who} (${getMonthName(month)} ${year}) needs your approval.`,
        '🗓️ Shift Request');
    } else if (!hasIncharge) {
      const hrIds = await getHRManagerId();
      for (const hid of hrIds) await createNotification(hid,
        `Monthly shift request for ${who} (${getMonthName(month)} ${year}) needs HR approval.`,
        '🗓️ Shift Request');
    }

    return res.status(201).json({
      message: 'Monthly shift request submitted successfully',
      approvalId: approval.id
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to submit monthly shift request' });
  }
};

// export async function applyMonthlyPattern(approval: any) {
//   const pattern = await prisma.shiftRotationPattern.findUnique({
//     where: { id: approval.patternId },
//     include: { items: true }
//   });

//   if (!pattern || pattern.items.length === 0) return;

//   /* ------------------------------------------------
//      1️⃣ Calculate EXACT coverage range
//   ------------------------------------------------ */
//   const monthStart = new Date(pattern.year!, pattern.month! - 1, 1);
//   const firstWeekStart = startOfWeek(monthStart);

//   const coverageStart = new Date(firstWeekStart);
//   const coverageEnd = new Date(
//     firstWeekStart.getTime() +
//     (pattern.items.length - 1) * 86400000
//   );

//   console.log(coverageStart, coverageEnd, 'coverage')

//   /* ------------------------------------------------
//      2️⃣ DELETE only covered range (NOT full month)
//   ------------------------------------------------ */
//   // await prisma.shiftAssignment.deleteMany({
//   //   where: {
//   //     employeeId: approval.employeeId,
//   //     date: {
//   //       gte: coverageStart,
//   //       lte: coverageEnd
//   //     }
//   //   }
//   // });

//   // const monthStart = new Date(pattern.year!, pattern.month! - 1, 1);
// const monthEnd = new Date(pattern.year!, pattern.month!, 0);


// console.log(monthStart, monthEnd)

// await prisma.shiftAssignment.deleteMany({
//   where: {
//     employeeId: approval.employeeId,
//     date: {
//       gte: monthStart,
//       lte: monthEnd
//     }
//   }
// });


//   /* ------------------------------------------------
//      3️⃣ Re-create assignments
//   ------------------------------------------------ */
//   const assignments = pattern.items.map(item => ({
//     employeeId: approval.employeeId,
//     shiftId: item.shiftId,
//     date: new Date(
//       firstWeekStart.getTime() + item.dayIndex * 86400000
//     ),
//     acknowledged: false
//   }));

//   await prisma.shiftAssignment.createMany({
//     data: assignments
//   });
// }

export async function applyMonthlyPattern(approval: any) {
  console.log('================ APPLY MONTHLY PATTERN ================');
  console.log('Approval ID:', approval.id);
  console.log('Employee ID:', approval.employeeId);
  console.log('Pattern ID:', approval.patternId);

  const pattern = await prisma.shiftRotationPattern.findUnique({
    where: { id: approval.patternId },
    include: { items: true }
  });

  if (!pattern || pattern.items.length === 0) {
    console.log('❌ Pattern not found or empty');
    return;
  }

  console.log('Pattern:', {
    id: pattern.id,
    month: pattern.month,
    year: pattern.year,
    totalItems: pattern.items.length
  });

  const monthStart = new Date(pattern.year!, pattern.month! - 1, 1);
  const firstWeekStart = startOfWeek(monthStart);

  console.log('Month Start:', monthStart.toISOString());
  console.log('First Week Start:', firstWeekStart.toISOString());

  const dayIndexes = pattern.items.map(i => i.dayIndex).sort((a, b) => a - b);
  const minDayIndex = dayIndexes[0];
  const maxDayIndex = dayIndexes[dayIndexes.length - 1];

  console.log('DayIndexes:', dayIndexes);
  console.log('Min DayIndex:', minDayIndex);
  console.log('Max DayIndex:', maxDayIndex);

  const coverageStart = new Date(
    firstWeekStart.getTime() + minDayIndex * 86400000
  );
  const coverageEnd = new Date(
    firstWeekStart.getTime() + maxDayIndex * 86400000
  );

  console.log('Coverage Start:', coverageStart.toISOString());
  console.log('Coverage End:', coverageEnd.toISOString());

  // 🔍 SEE WHAT WILL BE DELETED
  const willDelete = await prisma.shiftAssignment.findMany({
    where: {
      employeeId: approval.employeeId,
      date: {
        gte: coverageStart,
        lte: coverageEnd
      }
    },
    select: { id: true, date: true, shiftId: true }
  });

  console.log(
    `⚠️ Assignments to be deleted (${willDelete.length}):`,
    willDelete.map(a => ({
      id: a.id,
      date: a.date.toISOString(),
      shiftId: a.shiftId
    }))
  );

  // ✅ DELETE
  await prisma.shiftAssignment.deleteMany({
    where: {
      employeeId: approval.employeeId,
      date: {
        gte: coverageStart,
        lte: coverageEnd
      }
    }
  });

  console.log('✅ Deleted assignments');

  // 🔁 CREATE NEW ASSIGNMENTS
  const assignments = pattern.items.map(item => {
    const date = new Date(
      firstWeekStart.getTime() + item.dayIndex * 86400000
    );

    console.log('Creating assignment:', {
      dayIndex: item.dayIndex,
      shiftId: item.shiftId,
      date: date.toISOString()
    });

    return {
      employeeId: approval.employeeId,
      shiftId: item.shiftId,
      date,
      acknowledged: false
    };
  });

  await prisma.shiftAssignment.createMany({ data: assignments });

  console.log(
    `✅ Created ${assignments.length} assignments`
  );
  console.log('=======================================================');
}


export const getMonthlyShiftStatus = async (req: Request, res: Response) => {
  const { employeeId, month, year } = req.body;

  // All monthly requests for this employee/month. There can be more than one
  // (each submission creates a row), so pick the one that's actually "current":
  // an active edit workflow first, then the approved plan, else the latest.
  const approvals = await prisma.shiftApproval.findMany({
    where: { employeeId: Number(employeeId), month: Number(month), year: Number(year) },
    orderBy: { requestedAt: 'desc' },
    include: { pattern: { include: { items: { orderBy: { dayIndex: 'asc' } } } } },
  });

  if (!approvals.length) {
    return res.json({ isMonthAssigned: false });
  }

  const approval =
    approvals.find(a => a.editStatus === 'REQUESTED' || a.editStatus === 'APPROVED') ||
    approvals.find(a => a.status === 'APPROVED') ||
    approvals[0];

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const firstWeekStart = startOfWeek(monthStart);

  const weekShifts: Record<number, number> = {};
  (approval.pattern?.items ?? []).forEach(item => {
    const date = new Date(firstWeekStart.getTime() + item.dayIndex * 86400000);
    if (date < monthStart || date > monthEnd) return; // ignore days outside month
    const weekIndex = Math.floor((date.getTime() - firstWeekStart.getTime()) / (7 * 86400000));
    if (weekShifts[weekIndex] === undefined) weekShifts[weekIndex] = item.shiftId;
  });

  // Per-day overrides (dates whose shift differs from their week's base shift).
  const dayOverrides = await dayOverridesFromPattern(approval.patternId, Number(month), Number(year));

  return res.json({
    isMonthAssigned: approval.status === 'APPROVED', // unchanged meaning (kept for existing callers)
    approvalId: approval.id,
    status: approval.status,
    editStatus: approval.editStatus,
    requestedBy: approval.requestedBy,
    weekShifts,
    dayOverrides,
    weekOffConfig: approval.weekOffConfig ?? null,
  });
};

export const getEmployeeDailyShiftsForRange = async (
  req: Request,
  res: Response
) => {
  try {
    const { employeeId, from, to } = req.query;

    if (!employeeId || !from || !to) {
      return res.status(400).json({
        error: 'employeeId, from and to are required'
      });
    }

    const shifts = await prisma.shiftAssignment.findMany({
      where: {
        employeeId: Number(employeeId),
        date: {
          gte: new Date(from as string),
          lte: new Date(to as string)
        }
      },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        shiftId: true,
        shift: {
          select: {
            id: true,
            name: true,
            startTime: true,
            endTime: true
          }
        }
      }
    });

    res.json(shifts);
  } catch (error) {
    console.error('getEmployeeDailyShiftsForRange error:', error);
    res.status(500).json({
      error: 'Failed to fetch daily shifts'
    });
  }
};

function parseWeekOffConfig(raw: unknown): WeekOffConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as any;
  if (!obj.weeks || typeof obj.weeks !== "object") return null;
  return obj as WeekOffConfig;
}

export const getApprovedWeekOffs = async (req: Request, res: Response) => {
  const employeeId = Number(req.query.employeeId);
  const month = Number(req.query.month); // 1–12
  const year = Number(req.query.year);

  if (!employeeId || !month || !year) {
    return res.status(400).json({ error: "employeeId, month, year required" });
  }

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  monthStart.setHours(0, 0, 0, 0);
  monthEnd.setHours(23, 59, 59, 999);

  // 🔍 Fetch ONLY approved monthly shift
  const approval = await prisma.shiftApproval.findFirst({
    where: {
      employeeId,
      month,
      year,
      status: "APPROVED",
      weekOffConfig: {
        not: Prisma.DbNull
      }
    },

  });

  console.log('getApprovedWeekOffs:', {
    employeeId,
    month,
    year,
    approval: approval ? {
      id: approval.id,
      weekOffConfig: approval.weekOffConfig
    } : null
  });

  // ✅ CASE 1: Approved monthly shift exists
  if (approval) {
    const parsed = parseWeekOffConfig(approval.weekOffConfig);
    if (!parsed) {
      return res.json({ source: "NONE", weekOffDates: [] });
    }

    const firstWeekStart = new Date(monthStart);
    firstWeekStart.setDate(monthStart.getDate() - monthStart.getDay()); // Sunday

    const dates = new Set<string>();

    Object.entries(parsed.weeks).forEach(([weekIndexStr, dayOfWeek]) => {
      const weekIndex = Number(weekIndexStr);
      const dow = Number(dayOfWeek);

      const d = new Date(firstWeekStart);
      d.setDate(firstWeekStart.getDate() + weekIndex * 7 + dow);
      d.setHours(0, 0, 0, 0);

      if (d >= monthStart && d <= monthEnd) {
        dates.add(d.toISOString().slice(0, 10));
      }
    });

    return res.json({
      source: "MONTHLY_SHIFT",
      weekOffDates: [...dates]
    });
  }

  // 🔁 CASE 2: Default Sunday week off
  const sundays: string[] = [];
  for (
    let d = new Date(monthStart);
    d <= monthEnd;
    d.setDate(d.getDate() + 1)
  ) {
    if (d.getDay() === 0) {
      sundays.push(d.toISOString().slice(0, 10));
    }
  }

  return res.json({
    source: "SUNDAY_DEFAULT",
    weekOffDates: sundays
  });
};

export const getEmployeeWeeklyShiftsForMonth = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.query.employeeId);
    const month = Number(req.query.month); // 1-12
    const year = Number(req.query.year);

    if (!employeeId || !month || !year) {
      return res.status(400).json({
        error: "employeeId, month and year are required"
      });
    }

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    const firstWeekStart = startOfWeek(monthStart);
    const lastWeekEnd = new Date(startOfWeek(monthEnd));
    lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);

    // Per-week off day (weekIndex → dayOfWeek, 0=Sun..6=Sat). When no monthly
    // week-off config is approved, default to Sunday off (→ Mon..Sat display).
    const weekOffApproval = await prisma.shiftApproval.findFirst({
      where: { employeeId, month, year, status: "APPROVED", weekOffConfig: { not: Prisma.DbNull } },
    });
    const weekOffByIndex = parseWeekOffConfig(weekOffApproval?.weekOffConfig)?.weeks ?? {};
    const offDowFor = (weekIndex: number) => weekOffByIndex[weekIndex] ?? 0;

    // 1️⃣ First check approved monthly rotational shift
    const monthlyApproval = await prisma.shiftApproval.findFirst({
      where: {
        employeeId,
        month,
        year,
        status: "APPROVED",
        requestedMode: "ROTATIONAL",
        patternId: { not: null }
      },
      include: {
        pattern: {
          include: {
            items: {
              orderBy: { dayIndex: "asc" },
              include: {
                shift: {
                  select: {
                    id: true,
                    name: true,
                    startTime: true,
                    endTime: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: {
        requestedAt: "desc"
      }
    });

    // 2️⃣ If rotational monthly approval exists → build week-wise from pattern
    if (monthlyApproval?.pattern) {
      const weekMap = new Map<number, any>();

      for (const item of monthlyApproval.pattern.items) {
        const date = new Date(firstWeekStart.getTime() + item.dayIndex * 86400000);

        if (date < monthStart || date > monthEnd) continue;

        const weekIndex = Math.floor(
          (date.getTime() - firstWeekStart.getTime()) / (7 * 86400000)
        );

        const weekStart = new Date(firstWeekStart);
        weekStart.setDate(firstWeekStart.getDate() + weekIndex * 7);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        if (!weekMap.has(weekIndex)) {
          const { fromDate, toDate, weekOff } = workWeekRange(weekStart, offDowFor(weekIndex));
          weekMap.set(weekIndex, {
            weekIndex,
            label: `Week ${weekIndex + 1}`,
            fromDate,
            toDate,
            weekOff,
            shiftId: item.shift.id,
            shiftName: item.shift.name,
            startTime: item.shift.startTime,
            endTime: item.shift.endTime
          });
        }
      }
      return res.json({
        mode: "ROTATIONAL",
        weeks: Array.from(weekMap.values()).sort((a, b) => a.weekIndex - b.weekIndex)
      });
    }

    // 3️⃣ Otherwise check employee fixed shift setting
    const setting = await prisma.employeeShiftSetting.findUnique({
      where: { employeeId },
      include: {
        fixedShift: {
          select: {
            id: true,
            name: true,
            startTime: true,
            endTime: true
          }
        }
      }
    });

    if (setting?.mode === "FIXED" && setting.fixedShift) {
      const weeks: any[] = [];

      let current = new Date(firstWeekStart);
      let weekIndex = 0;

      while (current <= lastWeekEnd) {
        const weekStart = new Date(current);
        const weekEnd = new Date(current);
        weekEnd.setDate(weekEnd.getDate() + 6);

        if (weekEnd >= monthStart && weekStart <= monthEnd) {
          const { fromDate, toDate, weekOff } = workWeekRange(weekStart, offDowFor(weekIndex));
          weeks.push({
            weekIndex,
            label: `Week ${weekIndex + 1}`,
            fromDate,
            toDate,
            weekOff,
            shiftId: setting.fixedShift.id,
            shiftName: setting.fixedShift.name,
            startTime: setting.fixedShift.startTime,
            endTime: setting.fixedShift.endTime
          });
        }

        current.setDate(current.getDate() + 7);
        weekIndex++;
      }

      return res.json({
        mode: "FIXED",
        weeks
      });
    }

    return res.json({
      mode: null,
      weeks: []
    });
  } catch (error) {
    console.error("getEmployeeWeeklyShiftsForMonth error:", error);
    return res.status(500).json({
      error: "Failed to fetch weekly shifts for month"
    });
  }
};

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Local YYYY-MM-DD (no UTC shift — toISOString() would roll an IST midnight
// back to the previous day).
function formatLocalDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// The shift weeks are anchored to Sunday (see startOfWeek); each block runs
// Sun..Sat and carries ONE off day (offDow: 0=Sun..6=Sat). The displayed range
// stays inside the block (so weeks never overlap and the shown shift always
// matches), trimming the off day only when it's at the block's edge:
//   off=Sun → Mon..Sat,  off=Sat → Sun..Fri,  mid-week off → full Sun..Sat.
// Returns local date strings (toISOString() would roll IST midnight back a day).
function workWeekRange(weekStartSunday: Date, offDow: number) {
  const fromOffset = offDow === 0 ? 1 : 0; // Sunday off → start Monday
  const toOffset = offDow === 6 ? 5 : 6;   // Saturday off → end Friday
  const from = new Date(weekStartSunday);
  from.setDate(weekStartSunday.getDate() + fromOffset);
  const to = new Date(weekStartSunday);
  to.setDate(weekStartSunday.getDate() + toOffset);
  const off = new Date(weekStartSunday);
  off.setDate(weekStartSunday.getDate() + offDow); // the off date within the block
  return { fromDate: formatLocalDate(from), toDate: formatLocalDate(to), weekOff: formatLocalDate(off) };
}

/* ============================================================================
   MONTHLY SHIFT — EDIT WORKFLOW
   • in-flight edit (creator, before the next approver acts)
   • post-approval: creator requests HR → HR approves → edit UPCOMING weeks only
   • any edit re-enters the RM → HR approval chain
   • HR "month closed" lock (org-wide) blocks all edits for that month
   ========================================================================== */

// Sunday-anchored first week of the given month.
function firstWeekStartOf(month: number, year: number): Date {
  return startOfWeek(new Date(year, month - 1, 1));
}

// A 0-based (Sunday-anchored) week is "past" only once it has fully ENDED
// (its last day is before today), so the current + future weeks stay editable.
function isPastWeek(weekIndex: number, month: number, year: number, now: Date): boolean {
  const ws = new Date(firstWeekStartOf(month, year));
  ws.setDate(ws.getDate() + weekIndex * 7 + 6); // week end (Saturday)
  return startOfDay(ws) < startOfDay(now);
}

// A single day (YYYY-MM-DD) has already passed relative to `now`.
function isPastDay(iso: string, now: Date): boolean {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return false;
  return startOfDay(d) < startOfDay(now);
}

// Expand a { weekIndex: shiftId } map into day-indexed pattern items for the month.
// dayOverrides: { 'YYYY-MM-DD': shiftId } — per-day shifts that differ from their
// week's base shift. The plan is stored per-day (ShiftRotationItem/dayIndex) so an
// override is just an item whose shiftId differs from the rest of its week.
function buildMonthlyPatternItems(
  month: number,
  year: number,
  weekShifts: Record<number, number>,
  dayOverrides?: Record<string, number>
) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const firstWeekStart = startOfWeek(monthStart);
  const lastWeekEnd = new Date(startOfWeek(monthEnd));
  lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);

  const items: { dayIndex: number; shiftId: number }[] = [];
  let current = new Date(firstWeekStart);
  while (current <= lastWeekEnd) {
    const weekIndex = Math.floor((current.getTime() - firstWeekStart.getTime()) / (7 * 86400000));
    const shiftId = weekShifts?.[weekIndex];
    if (shiftId) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(current);
        date.setDate(current.getDate() + d);
        if (date < firstWeekStart || date > lastWeekEnd) continue;
        const dayIndex = Math.floor((date.getTime() - firstWeekStart.getTime()) / 86400000);
        items.push({ dayIndex, shiftId });
      }
    }
    current.setDate(current.getDate() + 7);
  }

  // Apply single-day overrides on top of the week-derived items.
  if (dayOverrides) {
    for (const [iso, sid] of Object.entries(dayOverrides)) {
      const shiftId = Number(sid);
      if (!shiftId) continue;
      const d = new Date(`${iso}T00:00:00`);
      if (isNaN(d.getTime())) continue;
      if (d < firstWeekStart || d > lastWeekEnd) continue;
      const dayIndex = Math.round((startOfDay(d).getTime() - firstWeekStart.getTime()) / 86400000);
      const existing = items.find(i => i.dayIndex === dayIndex);
      if (existing) existing.shiftId = shiftId;
      else items.push({ dayIndex, shiftId });
    }
    items.sort((a, b) => a.dayIndex - b.dayIndex);
  }

  return items;
}

// Derive the per-day overrides back out of a stored pattern, so the UI can show
// which specific dates differ from their week's base shift. Base = first item of
// the week (matches how weekShiftsFromPattern / getMonthlyShiftStatus pick a week shift).
async function dayOverridesFromPattern(
  patternId: number | null,
  month: number,
  year: number
): Promise<Record<string, number>> {
  if (!patternId) return {};
  const items = await prisma.shiftRotationItem.findMany({
    where: { patternId },
    select: { dayIndex: true, shiftId: true },
    orderBy: { dayIndex: 'asc' },
  });
  const firstWeekStart = startOfWeek(new Date(year, month - 1, 1));
  const weekBase: Record<number, number> = {};
  for (const it of items) {
    const wi = Math.floor(it.dayIndex / 7);
    if (weekBase[wi] === undefined) weekBase[wi] = it.shiftId;
  }
  const overrides: Record<string, number> = {};
  for (const it of items) {
    const wi = Math.floor(it.dayIndex / 7);
    if (it.shiftId !== weekBase[wi]) {
      const d = new Date(firstWeekStart.getTime() + it.dayIndex * 86400000);
      overrides[isoLocalDate(d)] = it.shiftId;
    }
  }
  return overrides;
}

// Rebuild the { weekIndex: shiftId } map from an existing pattern's items.
async function weekShiftsFromPattern(patternId: number | null): Promise<Record<number, number>> {
  if (!patternId) return {};
  const items = await prisma.shiftRotationItem.findMany({
    where: { patternId },
    select: { dayIndex: true, shiftId: true },
    orderBy: { dayIndex: 'asc' },
  });
  const map: Record<number, number> = {};
  for (const it of items) {
    const wi = Math.floor(it.dayIndex / 7);
    if (map[wi] === undefined) map[wi] = it.shiftId;
  }
  return map;
}

async function isMonthLocked(month: number, year: number): Promise<boolean> {
  const lock = await prisma.shiftMonthLock.findUnique({ where: { month_year: { month, year } } });
  return !!lock;
}

async function isHrManager(empId: number): Promise<boolean> {
  const emp = await prisma.employee.findUnique({ where: { id: empId }, select: { roleId: true, departmentId: true } });
  return !!emp && (emp.roleId === 1 || (emp.departmentId === 1 && emp.roleId === 2));
}

type Editability = {
  editable: boolean;
  mode: 'INFLIGHT' | 'POSTEDIT' | null;
  canRequestEdit: boolean;
  monthLocked: boolean;
  reason?: string;
};

function computeEditability(approval: any, userId: number, monthLocked: boolean): Editability {
  const base: Editability = { editable: false, mode: null, canRequestEdit: false, monthLocked };
  if (monthLocked) return { ...base, reason: 'Month is closed by HR' };
  const isCreator = userId === approval.requestedBy;

  // Fully approved → creator asks HR for edit; editing allowed once HR grants it.
  if (approval.status === 'APPROVED') {
    if (approval.editStatus === 'APPROVED') return { ...base, editable: true, mode: 'POSTEDIT' };
    return { ...base, canRequestEdit: isCreator && approval.editStatus !== 'REQUESTED' };
  }

  // In-flight: creator can edit until the NEXT approver acts.
  //   in-charge created → until RM approves;  RM created → until HR approves.
  const nextApproverActed = approval.hasIncharge
    ? approval.rmDecision === 'APPROVED'
    : approval.hrDecision === 'APPROVED';
  if (isCreator && !nextApproverActed) return { ...base, editable: true, mode: 'INFLIGHT' };

  return { ...base, reason: isCreator ? 'Already under/after review' : 'Only the creator can edit' };
}

// GET /shift/monthly-request/:id/editability
export const getMonthlyRequestEditability = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const approval = await prisma.shiftApproval.findUnique({ where: { id } });
    if (!approval) return res.status(404).json({ error: 'Request not found' });
    const locked = approval.month && approval.year ? await isMonthLocked(approval.month, approval.year) : false;
    const e = computeEditability(approval, req.user.empId, locked);
    return res.json({ ...e, editStatus: approval.editStatus, status: approval.status });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// PUT /shift/monthly-request/:id  { weekShifts, weekOffConfig }
export const editMonthlyShiftRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user.empId;
    const { weekShifts, weekOffConfig, dayOverrides } = req.body as {
      weekShifts: Record<number, number>;
      weekOffConfig?: { weeks: Record<number, number> } | null;
      dayOverrides?: Record<string, number> | null;
    };

    const approval = await prisma.shiftApproval.findUnique({
      where: { id },
      include: { employee: { select: { reportingManager: true, inchargeId: true, firstName: true, lastName: true } } },
    });
    if (!approval) return res.status(404).json({ error: 'Request not found' });
    if (!approval.month || !approval.year) return res.status(400).json({ error: 'Not a monthly request' });

    const locked = await isMonthLocked(approval.month, approval.year);
    const e = computeEditability(approval, userId, locked);
    if (!e.editable) return res.status(400).json({ error: e.reason || 'Not editable' });

    const now = new Date();

    // POSTEDIT: keep past weeks; only upcoming weeks/days may change.
    let finalWeekShifts: Record<number, number> = { ...(weekShifts || {}) };
    let finalWeekOff: Record<number, number> = { ...((weekOffConfig?.weeks) || {}) };
    let finalDayOverrides: Record<string, number> = { ...((dayOverrides) || {}) };
    if (e.mode === 'POSTEDIT') {
      finalWeekShifts = { ...(await weekShiftsFromPattern(approval.patternId)) };
      finalWeekOff = { ...(((approval.weekOffConfig as any)?.weeks || {}) as Record<number, number>) };
      // Preserve every past-day override from the current plan; upcoming days are
      // replaced by whatever the editor submits.
      const existingOverrides = await dayOverridesFromPattern(approval.patternId, approval.month, approval.year);
      finalDayOverrides = {};
      for (const [iso, sid] of Object.entries(existingOverrides)) {
        if (isPastDay(iso, now)) finalDayOverrides[iso] = sid;
      }
      for (const k of Object.keys(weekShifts || {})) {
        const wi = Number(k);
        if (!isPastWeek(wi, approval.month, approval.year, now)) finalWeekShifts[wi] = weekShifts[wi];
      }
      for (const k of Object.keys(weekOffConfig?.weeks || {})) {
        const wi = Number(k);
        if (!isPastWeek(wi, approval.month, approval.year, now)) finalWeekOff[wi] = (weekOffConfig!.weeks as any)[wi];
      }
      for (const [iso, sid] of Object.entries(dayOverrides || {})) {
        if (!isPastDay(iso, now)) finalDayOverrides[iso] = sid;
      }
    }

    // Rebuild the rotation pattern.
    const items = buildMonthlyPatternItems(approval.month, approval.year, finalWeekShifts, finalDayOverrides);
    const pattern = await prisma.shiftRotationPattern.create({
      data: {
        name: `MONTH-${getMonthName(approval.month)}-${approval.year}-EDIT`,
        cycleDays: items.length,
        source: 'MONTHLY',
        month: approval.month,
        year: approval.year,
      },
    });
    if (items.length) {
      await prisma.shiftRotationItem.createMany({ data: items.map(i => ({ ...i, patternId: pattern.id })) });
    }

    // The editor's OWN approval level is auto-approved — no self re-approval.
    //   RM editor            → RM level auto-approved → straight to HR.
    //   in-charge/other editor (hasIncharge) → RM must review first, then HR.
    const editorIsRM = userId === approval.employee.reportingManager;
    const rmDecision: 'APPROVED' | 'PENDING' = editorIsRM ? 'APPROVED' : 'PENDING';

    await prisma.shiftApproval.update({
      where: { id },
      data: {
        patternId: pattern.id,
        weekOffConfig: { weeks: finalWeekOff },
        status: 'PENDING',
        rmDecision, rmDecidedAt: rmDecision === 'APPROVED' ? new Date() : null, rmRejectReason: null,
        hrDecision: 'PENDING', hrDecidedAt: null, hrRejectReason: null,
        appliedAt: null,
        editStatus: 'NONE', editReason: null, editRejectReason: null,
        editRequestedAt: null, editDecidedAt: null,
      },
    });

    // Notify the NEXT approver: HR when the RM level is already satisfied
    // (RM edited it, or the employee has no in-charge), else the reporting manager.
    const who = `${approval.employee.firstName} ${approval.employee.lastName}`;
    const needsHrNext = !approval.hasIncharge || rmDecision === 'APPROVED';
    if (needsHrNext) {
      const hrIds = await getHRManagerId();
      for (const hid of hrIds) await createNotification(hid,
        `Edited monthly shift request for ${who} needs HR approval.`, '🗓️ Shift Request');
    } else if (approval.employee.reportingManager) {
      await createNotification(approval.employee.reportingManager,
        `Edited monthly shift request for ${who} needs your approval.`, '🗓️ Shift Request');
    }

    return res.json({ message: 'Request updated and resubmitted for approval', approvalId: id });
  } catch (err: any) {
    console.error('editMonthlyShiftRequest error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// POST /shift/monthly-request/:id/edit-request  { reason }  — creator asks HR.
export const requestShiftEdit = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const userId = req.user.empId;
    const { reason } = req.body || {};
    const approval = await prisma.shiftApproval.findUnique({
      where: { id },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (!approval) return res.status(404).json({ error: 'Request not found' });
    if (userId !== approval.requestedBy) return res.status(403).json({ error: 'Only the creator can request an edit' });
    if (approval.status !== 'APPROVED') return res.status(400).json({ error: 'Only approved requests need an edit request' });
    if (approval.editStatus === 'REQUESTED') return res.status(400).json({ error: 'An edit request is already pending' });
    if (approval.month && approval.year && (await isMonthLocked(approval.month, approval.year)))
      return res.status(400).json({ error: 'Month is closed by HR' });

    await prisma.shiftApproval.update({
      where: { id },
      data: { editStatus: 'REQUESTED', editRequestedBy: userId, editRequestedAt: new Date(), editReason: reason || null, editRejectReason: null },
    });

    const hrIds = await getHRManagerId();
    for (const hid of hrIds) await createNotification(hid,
      `Edit requested on the approved shift plan of ${approval.employee.firstName} ${approval.employee.lastName}. Please review.`,
      '🗓️ Shift Edit Request');

    return res.json({ message: 'Edit request sent to HR' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// POST /shift/monthly-request/:id/edit-request/decide  { decision, reason }  — HR only.
export const decideShiftEditRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { decision, reason } = req.body || {};
    if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });
    if (!(await isHrManager(req.user.empId))) return res.status(403).json({ error: 'Only HR can decide edit requests' });

    const approval = await prisma.shiftApproval.findUnique({ where: { id } });
    if (!approval) return res.status(404).json({ error: 'Request not found' });
    if (approval.editStatus !== 'REQUESTED') return res.status(400).json({ error: 'No pending edit request' });

    await prisma.shiftApproval.update({
      where: { id },
      data: {
        editStatus: decision,
        editDecidedBy: req.user.empId,
        editDecidedAt: new Date(),
        editRejectReason: decision === 'REJECTED' ? (reason || null) : null,
      },
    });

    if (approval.editRequestedBy) {
      await createNotification(approval.editRequestedBy,
        decision === 'APPROVED'
          ? 'HR approved your edit request — you can now edit the upcoming weeks of that shift plan.'
          : `HR rejected your edit request${reason ? `: ${reason}` : ''}.`,
        '🗓️ Shift Edit Request');
    }
    return res.json({ message: `Edit request ${String(decision).toLowerCase()}` });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// POST /shift/month-lock  { month, year }  — HR closes the month org-wide.
export const closeShiftMonth = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = Number(req.body?.month);
    const year = Number(req.body?.year);
    if (!month || !year) return res.status(400).json({ error: 'month and year are required' });
    if (!(await isHrManager(req.user.empId))) return res.status(403).json({ error: 'Only HR can close a month' });

    const lock = await prisma.shiftMonthLock.upsert({
      where: { month_year: { month, year } },
      update: { closedBy: req.user.empId, closedAt: new Date() },
      create: { month, year, closedBy: req.user.empId },
    });
    return res.json({ message: 'Month closed', lock });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// DELETE /shift/month-lock  { month, year }  — HR reopens a closed month.
export const reopenShiftMonth = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = Number(req.body?.month ?? req.query?.month);
    const year = Number(req.body?.year ?? req.query?.year);
    if (!month || !year) return res.status(400).json({ error: 'month and year are required' });
    if (!(await isHrManager(req.user.empId))) return res.status(403).json({ error: 'Only HR can reopen a month' });

    await prisma.shiftMonthLock.deleteMany({ where: { month, year } });
    return res.json({ message: 'Month reopened' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /shift/month-lock?month&year  — is the month closed?
export const getShiftMonthLock = async (req: Request, res: Response) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!month || !year) return res.status(400).json({ error: 'month and year are required' });
    const lock = await prisma.shiftMonthLock.findUnique({ where: { month_year: { month, year } } });
    return res.json({ locked: !!lock, lock: lock || null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

/* ======================================================================
   MONTHLY SHIFT + ATTENDANCE REPORT (HR)
   Per-employee, per-day grid: assigned shift + check-in/out + timing flag
   (on-time / late-in / early-out / absent), plus week-offs & holidays.
   Exposed as JSON (on-screen preview) and colour-coded Excel export.
   ====================================================================== */

// Local date key (YYYY-MM-DD) using local getters — avoids the UTC shift that
// toISOString() introduces, so date columns line up with how attendance/shift
// rows are stored on the (IST) server.
const isoLocalDate = (d: Date): string => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// Anchor a shift's time-of-day onto a specific calendar date. Mirrors the
// existing attendance report's combineDateAndTime (local getHours/getMinutes).
const anchorTimeToDate = (base: Date, t: Date): Date => {
  const dt = new Date(base);
  const tt = new Date(t);
  dt.setHours(tt.getHours(), tt.getMinutes(), 0, 0);
  return dt;
};

const hhmm = (d: Date | null | undefined): string =>
  d ? new Date(d).toTimeString().slice(0, 5) : '';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type ReportCell = {
  day: number;
  iso: string;
  dayName: string;
  isSunday: boolean;
  type: 'WORK' | 'WEEKOFF' | 'HOLIDAY' | 'ABSENT' | 'EMPTY';
  shiftName: string | null;
  shiftType: string | null;
  checkIn: string;
  checkOut: string;
  // timing only set for WORK cells
  timing: 'ONTIME' | 'LATE' | 'EARLY' | 'LATE_EARLY' | 'NO_SHIFT' | null;
  lateMinutes: number;
  note: string | null;
};

type ReportRow = {
  employeeId: number;
  employeeCode: string | null;
  name: string;
  department: string;
  cells: ReportCell[];
  summary: {
    present: number;
    absent: number;
    late: number;
    early: number;
    lateMinutes: number;
    weekOff: number;
    holiday: number;
  };
};

type ReportData = {
  month: number;
  year: number;
  monthLabel: string;
  days: { day: number; iso: string; dayName: string; isSunday: boolean; isHoliday: boolean; holidayName: string | null }[];
  rows: ReportRow[];
};

async function buildMonthlyShiftAttendanceReport(month: number, year: number): Promise<ReportData> {
  const start = new Date(year, month - 1, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(year, month, 1);
  end.setHours(0, 0, 0, 0); // exclusive upper bound
  const daysInMonth = new Date(year, month, 0).getDate();

  // Whole-org, department-grouped (matches the existing register's active filter).
  const employees = await prisma.employee.findMany({
    where: { employmentStatus: { in: ['ACTIVE', 'NOTICE_PERIOD'] } },
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      departmentId: true,
      Department: { select: { name: true } },
    },
    orderBy: [{ departmentId: 'asc' }, { firstName: 'asc' }],
  });
  const empIds = employees.map(e => e.id);

  // Per-day shift — authoritative source (avoids the rotational items[0] bug in buildShiftMap).
  const assignments = empIds.length
    ? await prisma.shiftAssignment.findMany({
        where: { employeeId: { in: empIds }, date: { gte: start, lt: end } },
        select: {
          employeeId: true,
          date: true,
          shift: { select: { name: true, shiftType: true, startTime: true, endTime: true } },
        },
      })
    : [];
  const shiftByKey = new Map<string, (typeof assignments)[number]['shift']>();
  for (const a of assignments) shiftByKey.set(`${a.employeeId}_${isoLocalDate(a.date)}`, a.shift);

  // Actual punches.
  const attendance = empIds.length
    ? await prisma.attendance.findMany({
        where: { employeeId: { in: empIds }, date: { gte: start, lt: end } },
        select: { employeeId: true, date: true, status: true, checkIn: true, checkOut: true },
      })
    : [];
  const attByKey = new Map<string, (typeof attendance)[number]>();
  for (const a of attendance) attByKey.set(`${a.employeeId}_${isoLocalDate(a.date)}`, a);

  // Week-offs per employee (from approved monthly shift config; Sunday fallback otherwise).
  const approvals = empIds.length
    ? await prisma.shiftApproval.findMany({
        where: {
          employeeId: { in: empIds },
          month,
          year,
          status: 'APPROVED',
          weekOffConfig: { not: Prisma.DbNull },
        },
        select: { employeeId: true, weekOffConfig: true },
      })
    : [];
  const firstWeekStart = new Date(start);
  firstWeekStart.setDate(start.getDate() - start.getDay()); // Sunday anchor
  const weekOffByEmp = new Map<number, Set<string>>();
  for (const ap of approvals) {
    const parsed = parseWeekOffConfig(ap.weekOffConfig);
    if (!parsed) continue;
    const set = weekOffByEmp.get(ap.employeeId) ?? new Set<string>();
    Object.entries(parsed.weeks).forEach(([weekIndexStr, dayOfWeek]) => {
      const d = new Date(firstWeekStart);
      d.setDate(firstWeekStart.getDate() + Number(weekIndexStr) * 7 + Number(dayOfWeek));
      d.setHours(0, 0, 0, 0);
      if (d >= start && d < end) set.add(isoLocalDate(d));
    });
    weekOffByEmp.set(ap.employeeId, set);
  }

  // Holidays (global per-year calendar).
  const calendar = await prisma.holidayCalendar.findUnique({
    where: { year },
    include: { holidays: true },
  });
  const holidayNameByIso = new Map<string, string>();
  if (calendar) {
    for (const h of calendar.holidays) {
      const iso = isoLocalDate(h.date);
      if (iso >= isoLocalDate(start) && iso <= isoLocalDate(new Date(year, month - 1, daysInMonth))) {
        holidayNameByIso.set(iso, h.title);
      }
    }
  }

  // Day column metadata.
  const days = [] as ReportData['days'];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const iso = isoLocalDate(date);
    days.push({
      day: d,
      iso,
      dayName: DAY_NAMES[date.getDay()],
      isSunday: date.getDay() === 0,
      isHoliday: holidayNameByIso.has(iso),
      holidayName: holidayNameByIso.get(iso) ?? null,
    });
  }

  const rows: ReportRow[] = employees.map(emp => {
    const empWeekOff = weekOffByEmp.get(emp.id); // undefined => Sunday fallback
    const summary = { present: 0, absent: 0, late: 0, early: 0, lateMinutes: 0, weekOff: 0, holiday: 0 };

    const cells: ReportCell[] = days.map(dm => {
      const date = new Date(year, month - 1, dm.day);
      const key = `${emp.id}_${dm.iso}`;
      const shift = shiftByKey.get(key) || null;
      const att = attByKey.get(key) || null;
      const isHoliday = holidayNameByIso.has(dm.iso);
      const isWeekOff = empWeekOff ? empWeekOff.has(dm.iso) : dm.isSunday;

      const checkIn = att?.checkIn ? new Date(att.checkIn) : null;
      const checkOut = att?.checkOut ? new Date(att.checkOut) : null;

      const base: ReportCell = {
        day: dm.day,
        iso: dm.iso,
        dayName: dm.dayName,
        isSunday: dm.isSunday,
        type: 'EMPTY',
        shiftName: shift?.name ?? null,
        shiftType: shift?.shiftType ?? null,
        checkIn: hhmm(checkIn),
        checkOut: hhmm(checkOut),
        timing: null,
        lateMinutes: 0,
        note: null,
      };

      // Worked (has a check-in) — show it even on a week-off/holiday (HR wants to see it).
      if (checkIn) {
        base.type = 'WORK';
        if (shift) {
          const shiftStart = anchorTimeToDate(date, shift.startTime);
          const shiftEnd = anchorTimeToDate(date, shift.endTime);
          const late = checkIn > shiftStart;
          const early = !!checkOut && checkOut < shiftEnd;
          base.lateMinutes = late ? Math.max(0, Math.round((checkIn.getTime() - shiftStart.getTime()) / 60000)) : 0;
          base.timing = late && early ? 'LATE_EARLY' : late ? 'LATE' : early ? 'EARLY' : 'ONTIME';
          summary.present++;
          if (late) { summary.late++; summary.lateMinutes += base.lateMinutes; }
          if (early) summary.early++;
        } else {
          base.timing = 'NO_SHIFT';
          summary.present++;
        }
        if (isWeekOff) base.note = 'Worked on week-off';
        else if (isHoliday) base.note = `Worked on holiday${holidayNameByIso.get(dm.iso) ? ` (${holidayNameByIso.get(dm.iso)})` : ''}`;
        return base;
      }

      // No punch: classify the day.
      if (isHoliday) {
        base.type = 'HOLIDAY';
        base.note = holidayNameByIso.get(dm.iso) ?? 'Holiday';
        summary.holiday++;
      } else if (isWeekOff) {
        base.type = 'WEEKOFF';
        summary.weekOff++;
      } else if (shift) {
        base.type = 'ABSENT';
        summary.absent++;
      } else {
        base.type = 'EMPTY';
      }
      return base;
    });

    return {
      employeeId: emp.id,
      employeeCode: emp.employeeCode ?? null,
      name: `${emp.firstName} ${emp.lastName ?? ''}`.trim(),
      department: emp.Department?.name ?? '—',
      cells,
      summary,
    };
  });

  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });

  return { month, year, monthLabel: `${monthLabel} ${year}`, days, rows };
}

// JSON — for the on-screen preview grid.
export const getMonthlyShiftAttendanceReport = async (req: Request, res: Response) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!month || !year || month < 1 || month > 12) {
      return res.status(400).json({ error: 'valid month (1-12) and year are required' });
    }
    const data = await buildMonthlyShiftAttendanceReport(month, year);
    return res.json(data);
  } catch (err: any) {
    console.error('getMonthlyShiftAttendanceReport error:', err);
    return res.status(500).json({ error: 'Failed to build shift attendance report' });
  }
};

/* ---- Excel colour palette (ARGB) ---- */
const SHIFT_FILL: Record<string, string> = {
  MORNING: 'FFD6EAF8',
  EVENING: 'FFFDEBD0',
  NIGHT: 'FFE8DAEF',
  NURSING: 'FFD1F2EB',
  EXECUTIVE: 'FFD5F5E3',
  FLEXIBLE: 'FFFCF3CF',
  REPORTING_MANAGER: 'FFD6DBDF',
  MOD: 'FFF9E79F',
};
const SHIFT_FILL_DEFAULT = 'FFF4F6F7';
const WEEKOFF_FILL = 'FFD5D8DC';
const HOLIDAY_FILL = 'FFAED6F1';
const ABSENT_FILL = 'FFF5B7B1';
const EMPTY_FILL = 'FFFFFFFF';
const TXT_GREEN = 'FF1E8449';
const TXT_RED = 'FFC0392B';
const TXT_DARK = 'FF212F3D';
const TXT_MUTED = 'FF7B7D7D';
const HEADER_FILL = 'FF1F3A5F';
const SUN_HEADER_FILL = 'FFA93226';
const HOL_HEADER_FILL = 'FF2874A6';

const shiftShort = (name: string | null, type: string | null): string => {
  if (name) return name.length > 10 ? name.slice(0, 10) : name;
  if (type) return type;
  return '—';
};

function styleReportCell(cell: ExcelJS.Cell, c: ReportCell) {
  cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFD5D8DC' } },
    left: { style: 'thin', color: { argb: 'FFD5D8DC' } },
    bottom: { style: 'thin', color: { argb: 'FFD5D8DC' } },
    right: { style: 'thin', color: { argb: 'FFD5D8DC' } },
  };

  if (c.type === 'WEEKOFF') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WEEKOFF_FILL } };
    cell.value = { richText: [{ text: 'WO', font: { bold: true, size: 8, color: { argb: TXT_MUTED } } }] };
    return;
  }
  if (c.type === 'HOLIDAY') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HOLIDAY_FILL } };
    cell.value = { richText: [{ text: 'H', font: { bold: true, size: 8, color: { argb: HOL_HEADER_FILL } } }] };
    return;
  }
  if (c.type === 'ABSENT') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ABSENT_FILL } };
    cell.value = { richText: [{ text: 'A', font: { bold: true, size: 8, color: { argb: TXT_RED } } }] };
    return;
  }
  if (c.type === 'EMPTY') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EMPTY_FILL } };
    cell.value = '';
    return;
  }

  // WORK cell — fill by shift, colour In/Out text by timing.
  const fill = c.shiftType ? SHIFT_FILL[c.shiftType] ?? SHIFT_FILL_DEFAULT : SHIFT_FILL_DEFAULT;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };

  const late = c.timing === 'LATE' || c.timing === 'LATE_EARLY';
  const early = c.timing === 'EARLY' || c.timing === 'LATE_EARLY';
  const inColor = late ? TXT_RED : TXT_GREEN;
  const outColor = early ? TXT_RED : TXT_GREEN;

  const rich: ExcelJS.RichText[] = [
    { text: `${shiftShort(c.shiftName, c.shiftType)}\n`, font: { bold: true, size: 8, color: { argb: TXT_DARK } } },
  ];
  rich.push({ text: `In ${c.checkIn || '--'}\n`, font: { size: 8, color: { argb: c.checkIn ? inColor : TXT_MUTED } } });
  rich.push({ text: `Out ${c.checkOut || '--'}`, font: { size: 8, color: { argb: c.checkOut ? outColor : TXT_MUTED } } });
  cell.value = { richText: rich };
}

// Excel — colour-coded workbook streamed to the client.
export const exportMonthlyShiftAttendanceReport = async (req: Request, res: Response) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!month || !year || month < 1 || month > 12) {
      return res.status(400).json({ error: 'valid month (1-12) and year are required' });
    }

    const data = await buildMonthlyShiftAttendanceReport(month, year);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(data.monthLabel, {
      views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }],
    });

    const FIXED = 3; // Employee, Code, Department
    const dayCount = data.days.length;
    const SUMMARY = ['Present', 'Absent', 'Late', 'Early', 'Late Min', 'W-Off', 'Holiday'];
    const totalCols = FIXED + dayCount + SUMMARY.length;

    // Column widths.
    sheet.getColumn(1).width = 24;
    sheet.getColumn(2).width = 12;
    sheet.getColumn(3).width = 16;
    for (let i = 0; i < dayCount; i++) sheet.getColumn(FIXED + 1 + i).width = 9;
    for (let i = 0; i < SUMMARY.length; i++) sheet.getColumn(FIXED + dayCount + 1 + i).width = 8;

    // Row 1: title.
    sheet.mergeCells(1, 1, 1, totalCols);
    const title = sheet.getCell(1, 1);
    title.value = `Shift & Attendance Report  —  ${data.monthLabel}`;
    title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    sheet.getRow(1).height = 26;

    // Rows 2-3: header (fixed cols merged vertically; date number over day name).
    const headerFont: Partial<ExcelJS.Font> = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    const fixedLabels = ['Employee', 'Code', 'Department'];
    fixedLabels.forEach((label, i) => {
      sheet.mergeCells(2, i + 1, 3, i + 1);
      const cell = sheet.getCell(2, i + 1);
      cell.value = label;
      cell.font = headerFont;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    });

    data.days.forEach((d, i) => {
      const col = FIXED + 1 + i;
      const headFill = d.isHoliday ? HOL_HEADER_FILL : d.isSunday ? SUN_HEADER_FILL : HEADER_FILL;
      const numCell = sheet.getCell(2, col);
      numCell.value = d.day;
      numCell.font = headerFont;
      numCell.alignment = { vertical: 'middle', horizontal: 'center' };
      numCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headFill } };
      const dayCell = sheet.getCell(3, col);
      dayCell.value = d.dayName;
      dayCell.font = { size: 8, color: { argb: 'FFFFFFFF' } };
      dayCell.alignment = { vertical: 'middle', horizontal: 'center' };
      dayCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headFill } };
    });

    SUMMARY.forEach((label, i) => {
      const col = FIXED + dayCount + 1 + i;
      sheet.mergeCells(2, col, 3, col);
      const cell = sheet.getCell(2, col);
      cell.value = label;
      cell.font = headerFont;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    });
    sheet.getRow(2).height = 18;
    sheet.getRow(3).height = 14;

    // Data rows.
    let r = 4;
    let lastDept: string | null = null;
    for (const row of data.rows) {
      // Department band.
      if (row.department !== lastDept) {
        sheet.mergeCells(r, 1, r, totalCols);
        const band = sheet.getCell(r, 1);
        band.value = row.department;
        band.font = { bold: true, size: 10, color: { argb: TXT_DARK } };
        band.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        band.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF5FB' } };
        sheet.getRow(r).height = 16;
        lastDept = row.department;
        r++;
      }

      const nameCell = sheet.getCell(r, 1);
      nameCell.value = row.name;
      nameCell.font = { size: 9, color: { argb: TXT_DARK } };
      nameCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
      const codeCell = sheet.getCell(r, 2);
      codeCell.value = row.employeeCode ?? '';
      codeCell.font = { size: 9, color: { argb: TXT_MUTED } };
      codeCell.alignment = { vertical: 'middle', horizontal: 'center' };
      const deptCell = sheet.getCell(r, 3);
      deptCell.value = row.department;
      deptCell.font = { size: 8, color: { argb: TXT_MUTED } };
      deptCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };

      row.cells.forEach((c, i) => styleReportCell(sheet.getCell(r, FIXED + 1 + i), c));

      const s = row.summary;
      const sums = [s.present, s.absent, s.late, s.early, s.lateMinutes, s.weekOff, s.holiday];
      sums.forEach((val, i) => {
        const cell = sheet.getCell(r, FIXED + dayCount + 1 + i);
        cell.value = val;
        cell.font = { size: 9, bold: i === 1 && val > 0, color: { argb: i === 1 && val > 0 ? TXT_RED : TXT_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      sheet.getRow(r).height = 34;
      r++;
    }

    // Legend sheet.
    const legend = workbook.addWorksheet('Legend');
    legend.getColumn(1).width = 22;
    legend.getColumn(2).width = 44;
    const addLegend = (rowIdx: number, label: string, fill: string, desc: string, textArgb?: string) => {
      const a = legend.getCell(rowIdx, 1);
      a.value = label;
      a.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      a.font = { bold: true, size: 9, color: { argb: textArgb ?? TXT_DARK } };
      a.alignment = { vertical: 'middle', horizontal: 'center' };
      a.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      const b = legend.getCell(rowIdx, 2);
      b.value = desc;
      b.font = { size: 9, color: { argb: TXT_DARK } };
      b.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    };
    legend.getCell(1, 1).value = 'Legend';
    legend.getCell(1, 1).font = { bold: true, size: 13, color: { argb: TXT_DARK } };
    let lr = 3;
    legend.getCell(lr, 1).value = 'Cell fill = shift';
    legend.getCell(lr, 1).font = { bold: true, size: 10 };
    lr++;
    Object.entries(SHIFT_FILL).forEach(([type, fill]) => addLegend(lr++, type, fill, `${type} shift`));
    addLegend(lr++, 'Other', SHIFT_FILL_DEFAULT, 'Shift with no mapped colour');
    lr++;
    legend.getCell(lr, 1).value = 'Day status';
    legend.getCell(lr, 1).font = { bold: true, size: 10 };
    lr++;
    addLegend(lr++, 'WO', WEEKOFF_FILL, 'Week off', TXT_MUTED);
    addLegend(lr++, 'H', HOLIDAY_FILL, 'Holiday (no attendance)', HOL_HEADER_FILL);
    addLegend(lr++, 'A', ABSENT_FILL, 'Absent — shift assigned but no check-in', TXT_RED);
    lr++;
    legend.getCell(lr, 1).value = 'Timing (In / Out text colour)';
    legend.getCell(lr, 1).font = { bold: true, size: 10 };
    lr++;
    const g = legend.getCell(lr, 1); g.value = 'Green'; g.font = { bold: true, size: 9, color: { argb: TXT_GREEN } };
    legend.getCell(lr, 2).value = 'On time — check-in ≤ shift start / check-out ≥ shift end';
    lr++;
    const rd = legend.getCell(lr, 1); rd.value = 'Red'; rd.font = { bold: true, size: 9, color: { argb: TXT_RED } };
    legend.getCell(lr, 2).value = 'Late login (In) or early logout (Out)';

    const fileName = `shift-attendance-${data.monthLabel.replace(/\s+/g, '-').toLowerCase()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error('exportMonthlyShiftAttendanceReport error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to export shift attendance report' });
  }
};

/* ======================================================================
   SHIFT ADHERENCE REPORT (HR / salary input — NOT linked to payroll)
   Per employee, per day: the shift we ALLOTTED vs the shift they actually
   came for (nearest shift to their check-in) and whether it matched.
   ====================================================================== */

// Nearest shift template to a check-in, by circular time-of-day distance of
// start times. Uses local getters to match how shift times are stored/compared.
function nearestShiftByStart(
  templates: { id: number; name: string; shiftType: string; startTime: Date }[],
  checkIn: Date
): { id: number; name: string; shiftType: string } | null {
  if (!templates.length) return null;
  const mins = checkIn.getHours() * 60 + checkIn.getMinutes();
  let best: any = null;
  let bestDiff = Infinity;
  for (const s of templates) {
    const st = new Date(s.startTime);
    const sm = st.getHours() * 60 + st.getMinutes();
    let d = Math.abs(mins - sm);
    d = Math.min(d, 1440 - d); // wrap around midnight
    if (d < bestDiff) { bestDiff = d; best = s; }
  }
  return best ? { id: best.id, name: best.name, shiftType: best.shiftType } : null;
}

type AdherenceCell = {
  day: number;
  iso: string;
  dayName: string;
  isSunday: boolean;
  type: 'MATCH' | 'MISMATCH' | 'NO_SHIFT' | 'WEEKOFF' | 'HOLIDAY' | 'ABSENT' | 'EMPTY';
  allottedName: string | null;
  allottedType: string | null;
  workedName: string | null;
  workedType: string | null;
  checkIn: string;
  note: string | null;
};

type AdherenceRow = {
  employeeId: number;
  employeeCode: string | null;
  name: string;
  department: string;
  cells: AdherenceCell[];
  summary: { present: number; matched: number; mismatched: number; absent: number; weekOff: number; holiday: number };
  workedByType: Record<string, number>;
};

type AdherenceData = {
  month: number;
  year: number;
  monthLabel: string;
  days: { day: number; iso: string; dayName: string; isSunday: boolean; isHoliday: boolean; holidayName: string | null }[];
  rows: AdherenceRow[];
  shiftTypes: string[];
};

async function buildShiftAdherenceReport(month: number, year: number): Promise<AdherenceData> {
  const start = new Date(year, month - 1, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(year, month, 1);
  end.setHours(0, 0, 0, 0);
  const daysInMonth = new Date(year, month, 0).getDate();

  const employees = await prisma.employee.findMany({
    where: { employmentStatus: { in: ['ACTIVE', 'NOTICE_PERIOD'] } },
    select: {
      id: true, employeeCode: true, firstName: true, lastName: true,
      departmentId: true, Department: { select: { name: true } },
    },
    orderBy: [{ departmentId: 'asc' }, { firstName: 'asc' }],
  });
  const empIds = employees.map(e => e.id);

  const assignments = empIds.length
    ? await prisma.shiftAssignment.findMany({
        where: { employeeId: { in: empIds }, date: { gte: start, lt: end } },
        select: { employeeId: true, date: true, shift: { select: { id: true, name: true, shiftType: true } } },
      })
    : [];
  const allottedByKey = new Map<string, { id: number; name: string; shiftType: string }>();
  for (const a of assignments) if (a.shift) allottedByKey.set(`${a.employeeId}_${isoLocalDate(a.date)}`, a.shift);

  const attendance = empIds.length
    ? await prisma.attendance.findMany({
        where: { employeeId: { in: empIds }, date: { gte: start, lt: end } },
        select: { employeeId: true, date: true, checkIn: true },
      })
    : [];
  const attByKey = new Map<string, (typeof attendance)[number]>();
  for (const a of attendance) attByKey.set(`${a.employeeId}_${isoLocalDate(a.date)}`, a);

  // Shift templates for nearest-match, grouped by department (fallback: all).
  const templates = await prisma.shiftTemplate.findMany({
    select: { id: true, name: true, shiftType: true, startTime: true, departments: { select: { id: true } } },
  });
  const templatesByDept = new Map<number, typeof templates>();
  for (const t of templates) {
    for (const d of t.departments) {
      const arr = templatesByDept.get(d.id) ?? [];
      arr.push(t);
      templatesByDept.set(d.id, arr);
    }
  }

  // Week-offs per employee (approved monthly config; Sunday fallback).
  const approvals = empIds.length
    ? await prisma.shiftApproval.findMany({
        where: { employeeId: { in: empIds }, month, year, status: 'APPROVED', weekOffConfig: { not: Prisma.DbNull } },
        select: { employeeId: true, weekOffConfig: true },
      })
    : [];
  const firstWeekStart = new Date(start);
  firstWeekStart.setDate(start.getDate() - start.getDay());
  const weekOffByEmp = new Map<number, Set<string>>();
  for (const ap of approvals) {
    const parsed = parseWeekOffConfig(ap.weekOffConfig);
    if (!parsed) continue;
    const set = weekOffByEmp.get(ap.employeeId) ?? new Set<string>();
    Object.entries(parsed.weeks).forEach(([wi, dow]) => {
      const d = new Date(firstWeekStart);
      d.setDate(firstWeekStart.getDate() + Number(wi) * 7 + Number(dow));
      d.setHours(0, 0, 0, 0);
      if (d >= start && d < end) set.add(isoLocalDate(d));
    });
    weekOffByEmp.set(ap.employeeId, set);
  }

  const calendar = await prisma.holidayCalendar.findUnique({ where: { year }, include: { holidays: true } });
  const holidayNameByIso = new Map<string, string>();
  if (calendar) for (const h of calendar.holidays) {
    const iso = isoLocalDate(h.date);
    if (iso >= isoLocalDate(start) && iso <= isoLocalDate(new Date(year, month - 1, daysInMonth))) {
      holidayNameByIso.set(iso, h.title);
    }
  }

  const days: AdherenceData['days'] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const iso = isoLocalDate(date);
    days.push({
      day: d, iso, dayName: DAY_NAMES[date.getDay()], isSunday: date.getDay() === 0,
      isHoliday: holidayNameByIso.has(iso), holidayName: holidayNameByIso.get(iso) ?? null,
    });
  }

  const shiftTypeSet = new Set<string>();

  const rows: AdherenceRow[] = employees.map(emp => {
    const empWeekOff = weekOffByEmp.get(emp.id);
    const deptTemplates = (emp.departmentId && templatesByDept.get(emp.departmentId)?.length)
      ? templatesByDept.get(emp.departmentId)! : templates;
    const summary = { present: 0, matched: 0, mismatched: 0, absent: 0, weekOff: 0, holiday: 0 };
    const workedByType: Record<string, number> = {};

    const cells: AdherenceCell[] = days.map(dm => {
      const key = `${emp.id}_${dm.iso}`;
      const allotted = allottedByKey.get(key) || null;
      const att = attByKey.get(key) || null;
      const checkIn = att?.checkIn ? new Date(att.checkIn) : null;
      const isHoliday = holidayNameByIso.has(dm.iso);
      const isWeekOff = empWeekOff ? empWeekOff.has(dm.iso) : dm.isSunday;

      const base: AdherenceCell = {
        day: dm.day, iso: dm.iso, dayName: dm.dayName, isSunday: dm.isSunday,
        type: 'EMPTY',
        allottedName: allotted?.name ?? null, allottedType: allotted?.shiftType ?? null,
        workedName: null, workedType: null,
        checkIn: hhmm(checkIn), note: null,
      };

      if (checkIn) {
        const worked = nearestShiftByStart(deptTemplates as any, checkIn);
        base.workedName = worked?.name ?? null;
        base.workedType = worked?.shiftType ?? null;
        if (worked?.shiftType) { workedByType[worked.shiftType] = (workedByType[worked.shiftType] || 0) + 1; shiftTypeSet.add(worked.shiftType); }
        summary.present++;

        if (!allotted) {
          base.type = 'NO_SHIFT';
          base.note = 'No allotted shift to compare';
        } else if (worked && worked.id === allotted.id) {
          base.type = 'MATCH';
          summary.matched++;
        } else {
          base.type = 'MISMATCH';
          summary.mismatched++;
          base.note = `Allotted ${allotted.name}, came for ${worked?.name ?? '—'}`;
        }
        return base;
      }

      // No check-in
      if (isHoliday) { base.type = 'HOLIDAY'; base.note = holidayNameByIso.get(dm.iso) ?? 'Holiday'; summary.holiday++; }
      else if (isWeekOff) { base.type = 'WEEKOFF'; summary.weekOff++; }
      else if (allotted) { base.type = 'ABSENT'; summary.absent++; }
      else base.type = 'EMPTY';
      return base;
    });

    return {
      employeeId: emp.id,
      employeeCode: emp.employeeCode ?? null,
      name: `${emp.firstName} ${emp.lastName ?? ''}`.trim(),
      department: emp.Department?.name ?? '—',
      cells, summary, workedByType,
    };
  });

  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });
  return { month, year, monthLabel: `${monthLabel} ${year}`, days, rows, shiftTypes: [...shiftTypeSet].sort() };
}

// JSON — on-screen preview.
export const getShiftAdherenceReport = async (req: Request, res: Response) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!month || !year || month < 1 || month > 12) {
      return res.status(400).json({ error: 'valid month (1-12) and year are required' });
    }
    const data = await buildShiftAdherenceReport(month, year);
    return res.json(data);
  } catch (err: any) {
    console.error('getShiftAdherenceReport error:', err);
    return res.status(500).json({ error: 'Failed to build shift adherence report' });
  }
};

const MATCH_FILL = 'FFD5F5E3';
const MISMATCH_FILL = 'FFFDEBD0';
const NOSHIFT_FILL = 'FFF4F6F7';

// Excel — colour-coded adherence grid + a salary-input "Worked-shift days" sheet.
export const exportShiftAdherenceReport = async (req: Request, res: Response) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!month || !year || month < 1 || month > 12) {
      return res.status(400).json({ error: 'valid month (1-12) and year are required' });
    }

    const data = await buildShiftAdherenceReport(month, year);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`Adherence ${data.monthLabel}`.slice(0, 31), {
      views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }],
    });

    const FIXED = 3;
    const dayCount = data.days.length;
    const SUMMARY = ['Present', 'Match', 'Mismatch', 'Absent', 'W-Off', 'Holiday'];
    const totalCols = FIXED + dayCount + SUMMARY.length;

    sheet.getColumn(1).width = 24;
    sheet.getColumn(2).width = 12;
    sheet.getColumn(3).width = 16;
    for (let i = 0; i < dayCount; i++) sheet.getColumn(FIXED + 1 + i).width = 10;
    for (let i = 0; i < SUMMARY.length; i++) sheet.getColumn(FIXED + dayCount + 1 + i).width = 8;

    sheet.mergeCells(1, 1, 1, totalCols);
    const title = sheet.getCell(1, 1);
    title.value = `Shift Adherence Report  —  ${data.monthLabel}   (allotted vs actual shift)`;
    title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    sheet.getRow(1).height = 26;

    const headerFont: Partial<ExcelJS.Font> = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    ['Employee', 'Code', 'Department'].forEach((label, i) => {
      sheet.mergeCells(2, i + 1, 3, i + 1);
      const cell = sheet.getCell(2, i + 1);
      cell.value = label; cell.font = headerFont;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    });
    data.days.forEach((d, i) => {
      const col = FIXED + 1 + i;
      const headFill = d.isHoliday ? HOL_HEADER_FILL : d.isSunday ? SUN_HEADER_FILL : HEADER_FILL;
      const numCell = sheet.getCell(2, col);
      numCell.value = d.day; numCell.font = headerFont;
      numCell.alignment = { vertical: 'middle', horizontal: 'center' };
      numCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headFill } };
      const dayCell = sheet.getCell(3, col);
      dayCell.value = d.dayName; dayCell.font = { size: 8, color: { argb: 'FFFFFFFF' } };
      dayCell.alignment = { vertical: 'middle', horizontal: 'center' };
      dayCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headFill } };
    });
    SUMMARY.forEach((label, i) => {
      const col = FIXED + dayCount + 1 + i;
      sheet.mergeCells(2, col, 3, col);
      const cell = sheet.getCell(2, col);
      cell.value = label; cell.font = headerFont;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    });
    sheet.getRow(2).height = 18;
    sheet.getRow(3).height = 14;

    const thin = () => ({
      top: { style: 'thin' as const, color: { argb: 'FFD5D8DC' } },
      left: { style: 'thin' as const, color: { argb: 'FFD5D8DC' } },
      bottom: { style: 'thin' as const, color: { argb: 'FFD5D8DC' } },
      right: { style: 'thin' as const, color: { argb: 'FFD5D8DC' } },
    });

    let r = 4;
    let lastDept: string | null = null;
    for (const row of data.rows) {
      if (row.department !== lastDept) {
        sheet.mergeCells(r, 1, r, totalCols);
        const band = sheet.getCell(r, 1);
        band.value = row.department;
        band.font = { bold: true, size: 10, color: { argb: TXT_DARK } };
        band.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        band.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF5FB' } };
        lastDept = row.department;
        r++;
      }

      sheet.getCell(r, 1).value = row.name;
      sheet.getCell(r, 1).font = { size: 9, color: { argb: TXT_DARK } };
      sheet.getCell(r, 1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
      sheet.getCell(r, 2).value = row.employeeCode ?? '';
      sheet.getCell(r, 2).font = { size: 9, color: { argb: TXT_MUTED } };
      sheet.getCell(r, 2).alignment = { vertical: 'middle', horizontal: 'center' };
      sheet.getCell(r, 3).value = row.department;
      sheet.getCell(r, 3).font = { size: 8, color: { argb: TXT_MUTED } };
      sheet.getCell(r, 3).alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };

      row.cells.forEach((c, i) => {
        const cell = sheet.getCell(r, FIXED + 1 + i);
        cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
        cell.border = thin();
        if (c.type === 'WEEKOFF') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WEEKOFF_FILL } };
          cell.value = { richText: [{ text: 'WO', font: { bold: true, size: 8, color: { argb: TXT_MUTED } } }] };
        } else if (c.type === 'HOLIDAY') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HOLIDAY_FILL } };
          cell.value = { richText: [{ text: 'H', font: { bold: true, size: 8, color: { argb: HOL_HEADER_FILL } } }] };
        } else if (c.type === 'ABSENT') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ABSENT_FILL } };
          cell.value = { richText: [{ text: 'A', font: { bold: true, size: 8, color: { argb: TXT_RED } } }] };
        } else if (c.type === 'MATCH') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MATCH_FILL } };
          cell.value = { richText: [{ text: `${shiftShort(c.allottedName, c.allottedType)} ✓`, font: { bold: true, size: 8, color: { argb: TXT_GREEN } } }] };
        } else if (c.type === 'MISMATCH') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MISMATCH_FILL } };
          cell.value = { richText: [
            { text: `${shiftShort(c.allottedName, c.allottedType)}\n`, font: { size: 8, color: { argb: TXT_DARK } } },
            { text: `→ ${shiftShort(c.workedName, c.workedType)}`, font: { bold: true, size: 8, color: { argb: TXT_RED } } },
          ] };
        } else if (c.type === 'NO_SHIFT') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NOSHIFT_FILL } };
          cell.value = { richText: [{ text: `? ${shiftShort(c.workedName, c.workedType)}`, font: { size: 8, color: { argb: TXT_MUTED } } }] };
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EMPTY_FILL } };
          cell.value = '';
        }
      });

      const s = row.summary;
      [s.present, s.matched, s.mismatched, s.absent, s.weekOff, s.holiday].forEach((val, i) => {
        const cell = sheet.getCell(r, FIXED + dayCount + 1 + i);
        cell.value = val;
        const isMismatch = i === 2 && val > 0;
        cell.font = { size: 9, bold: isMismatch, color: { argb: isMismatch ? TXT_RED : TXT_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      sheet.getRow(r).height = 30;
      r++;
    }

    // Salary-input sheet: days each employee actually worked per shift type.
    const salary = workbook.addWorksheet('Worked-shift days');
    salary.getColumn(1).width = 24;
    salary.getColumn(2).width = 12;
    salary.getColumn(3).width = 16;
    const types = data.shiftTypes;
    types.forEach((t, i) => (salary.getColumn(4 + i).width = 12));
    const salHeader = ['Employee', 'Code', 'Department', ...types];
    salHeader.forEach((label, i) => {
      const cell = salary.getCell(1, i + 1);
      cell.value = label;
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: i < 3 ? 'left' : 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    });
    let sr = 2;
    for (const row of data.rows) {
      salary.getCell(sr, 1).value = row.name;
      salary.getCell(sr, 2).value = row.employeeCode ?? '';
      salary.getCell(sr, 3).value = row.department;
      types.forEach((t, i) => {
        const cell = salary.getCell(sr, 4 + i);
        cell.value = row.workedByType[t] || 0;
        cell.alignment = { horizontal: 'center' };
      });
      sr++;
    }

    // Legend sheet.
    const legend = workbook.addWorksheet('Legend');
    legend.getColumn(1).width = 16;
    legend.getColumn(2).width = 52;
    const addLegend = (rowIdx: number, label: string, fill: string, desc: string, argb?: string) => {
      const a = legend.getCell(rowIdx, 1);
      a.value = label;
      a.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      a.font = { bold: true, size: 9, color: { argb: argb ?? TXT_DARK } };
      a.alignment = { vertical: 'middle', horizontal: 'center' };
      a.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      legend.getCell(rowIdx, 2).value = desc;
      legend.getCell(rowIdx, 2).font = { size: 9, color: { argb: TXT_DARK } };
      legend.getCell(rowIdx, 2).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    };
    legend.getCell(1, 1).value = 'Legend';
    legend.getCell(1, 1).font = { bold: true, size: 13 };
    addLegend(3, 'Shift ✓', MATCH_FILL, 'Came for the shift they were allotted', TXT_GREEN);
    addLegend(4, 'A → B', MISMATCH_FILL, 'Mismatch — allotted A but came for B (bottom, red)', TXT_RED);
    addLegend(5, '? B', NOSHIFT_FILL, 'Worked but no shift was allotted to compare', TXT_MUTED);
    addLegend(6, 'A', ABSENT_FILL, 'Absent — shift allotted, no check-in', TXT_RED);
    addLegend(7, 'WO', WEEKOFF_FILL, 'Week off', TXT_MUTED);
    addLegend(8, 'H', HOLIDAY_FILL, 'Holiday', HOL_HEADER_FILL);
    legend.getCell(10, 1).value = 'Sheet "Worked-shift days" = days each employee actually worked per shift type (salary input).';
    legend.getCell(10, 1).font = { italic: true, size: 9, color: { argb: TXT_DARK } };

    const fileName = `shift-adherence-${data.monthLabel.replace(/\s+/g, '-').toLowerCase()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    console.error('exportShiftAdherenceReport error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to export shift adherence report' });
  }
};