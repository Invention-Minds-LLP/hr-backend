import { Request, Response } from "express";
import { PrismaClient, ShiftAssignMode } from "@prisma/client";
import cron from 'node-cron';
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
    const { name, shiftType, startTime, endTime } = req.body;

    const template = await prisma.shiftTemplate.create({
      data: {
        name,
        shiftType,
        startTime: new Date(startTime),
        endTime: new Date(endTime)
      }
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
    const templates = await prisma.shiftTemplate.findMany();
    res.json(templates);
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
    const { name, shiftType, startTime, endTime } = req.body;

    const updatedTemplate = await prisma.shiftTemplate.update({
      where: { id: Number(id) },
      data: {
        name,
        shiftType,
        startTime: new Date(startTime),
        endTime: new Date(endTime)
      }
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
    return res.json({
      month: base.getMonth() + 1,
      year: base.getFullYear(),
      created,
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

  const shiftType = getShiftTypeByDepartment(departmentId);

  const shifts = await prisma.shiftTemplate.findMany({
    where: {
      shiftType: shiftType
    },
    orderBy: { name: 'asc' }
  });

  res.json(shifts);
};
const getShiftTypeByDepartment = (deptId: number) => {
  switch (deptId) {
    case 9:
      return 'NURSING';
    case 4:
      return 'MOD';
    case 1:
      return 'REPORTING_MANAGER';
    default:
      return 'EXECUTIVE';
  }
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
  let notifyTo: number | null = null;

  if (hasIncharge) {
    // Incharge raised → notify Reporting Manager
    notifyTo = employee.reportingManager;
  } else {
    // Reporting Manager raised → notify HR
    // Reporting Manager raised → notify ALL HR
    const hrIds = await getHRManagerId();

    // await Promise.all(
    //   hrIds.map(id =>
    //     createNotification(
    //       id,
    //       `${requesterName} has requested a shift change for ${employeeName} effective from ${fmtDate(
    //         approval.startDate
    //       )}.`
    //     )
    //   )
    // );
  }

  const requester = await prisma.employee.findUnique({
    where: { id: requesterId },
    select: { firstName: true, lastName: true }
  });

  const requesterName = requester
    ? `${requester.firstName} ${requester.lastName}`
    : 'Concerned Authority';

  const employeeName = `${employee.firstName} ${employee.lastName}`;

  // if (notifyTo) {
  //   await createNotification(
  //     notifyTo,
  //     `${requesterName} has requested a shift change for ${employeeName} effective from ${fmtDate(
  //       approval.startDate
  //     )}.`
  //   );
  // }

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

  // ---------------- NOTIFY EMPLOYEE ----------------

  // ---------------- NOTIFY NEXT APPROVER ----------------
  if (role === 'RM' && decision === 'APPROVED') {
    // 1️⃣ Notify ALL HR users
    const hrIds = await getHRManagerId();

    // await notifyUsers(
    //   hrIds,
    //   `Shift change request for ${approval.employee.firstName} ${approval.employee.lastName} is awaiting HR approval.`
    // );

    // 2️⃣ Notify requester (Incharge or RM who raised it)
    // await createNotification(
    //   updated.requestedBy,
    //   `Your shift change request for ${approval.employee.firstName} ${approval.employee.lastName
    //   } effective from ${fmtDate(updated.startDate)} has been approved by the Reporting Manager.`
    // );
  }

  // ---------------- FINAL STATUS ----------------
  const isFinalApproved =
    updated.hrDecision === 'APPROVED' &&
    (!updated.hasIncharge || updated.rmDecision === 'APPROVED');

  const msg = `Shift change for ${approval.employee.firstName} ${approval.employee.lastName
    } effective from ${fmtDate(updated.startDate)} has been ${updated.status}.`;

  if (role === 'HR' && decision === 'APPROVED') {
    // await notifyUsers(
    //   [
    //     approval.employee.id,          // Employee
    //     approval.employee.reportingManager,
    //     approval.employee.inchargeId
    //   ],
    //   msg
    // );
  }
  if (decision === 'REJECTED') {
    // await notifyUsers(
    //   [
    //     approval.employee.reportingManager,
    //     approval.employee.inchargeId
    //   ],
    //   `Shift change request for ${approval.employee.firstName} ${approval.employee.lastName
    //   } effective from ${fmtDate(updated.startDate)} was rejected.`
    // );
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

    // HR inbox: pending final decisions
    if (roleId === 1 || (roleId === 2 && req.user.deptId === 1)) {
      where.status = 'PENDING';
      // HR can approve:
      // - if hasIncharge=false (RM not required)
      // - or hasIncharge=true AND rmDecision=APPROVED
      where.OR = [
        { hasIncharge: false },
        { hasIncharge: true, rmDecision: 'APPROVED' }
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
    const { employeeId, month, year, weekShifts, weekOffConfig } = req.body;
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
    const monthEnd = new Date(year, month, 0);

    const firstWeekStart = startOfWeek(monthStart);
    const lastWeekEnd = new Date(startOfWeek(monthEnd));
    lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);

    /* -----------------------------
       3️⃣ Build items (FIXED)
    ----------------------------- */

    const items: { dayIndex: number; shiftId: number }[] = [];

    let current = new Date(firstWeekStart);

    while (current <= lastWeekEnd) {
      const weekIndex = Math.floor(
        (current.getTime() - firstWeekStart.getTime()) / (7 * 86400000)
      );

      const shiftId = weekShifts?.[weekIndex];

      if (!shiftId) {
        // skip locked / past weeks
        current.setDate(current.getDate() + 7);
        continue;
      }

      // ✅ EXPAND WEEK → dayIndex FROM DATE
      for (let d = 0; d < 7; d++) {
        const date = new Date(current);
        date.setDate(current.getDate() + d);

        if (date < firstWeekStart || date > lastWeekEnd) continue;

        const dayIndex = Math.floor(
          (date.getTime() - firstWeekStart.getTime()) / 86400000
        );

        items.push({
          dayIndex,
          shiftId
        });
      }

      current.setDate(current.getDate() + 7);
    }

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

  // const pattern = await prisma.shiftRotationPattern.findFirst({
  //   where: {
  //     source: 'MONTHLY',
  //     month,
  //     year,
  //     shiftApprovals: {
  //       some: {
  //         employeeId,
  //         status: 'APPROVED'
  //       }
  //     }
  //   },
  //   include: {
  //     items: { orderBy: { dayIndex: 'asc' } }
  //   }
  // });
  const pattern = await prisma.shiftRotationPattern.findFirst({
    where: {
      source: 'MONTHLY',
      month,
      year,
      shiftApprovals: {
        some: {
          employeeId,
          status: 'APPROVED'
        }
      }
    },
    include: {
      items: { orderBy: { dayIndex: 'asc' } },
      shiftApprovals: {
        where: {
          employeeId,
          status: 'APPROVED'
        },
        select: {
          weekOffConfig: true
        }
      }
    }
  });


  if (!pattern) {
    return res.json({ isMonthAssigned: false });
  }

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const firstWeekStart = startOfWeek(monthStart);

  const weekShifts: Record<number, number> = {};

  const weekOffConfig =
    pattern.shiftApprovals?.[0]?.weekOffConfig ?? null;


  pattern.items.forEach(item => {
    const date = new Date(
      firstWeekStart.getTime() + item.dayIndex * 86400000
    );

    // ❌ ignore days outside month
    if (date < monthStart || date > monthEnd) return;

    const weekIndex = Math.floor(
      (date.getTime() - firstWeekStart.getTime()) / (7 * 86400000)
    );

    if (weekShifts[weekIndex] === undefined) {
      weekShifts[weekIndex] = item.shiftId;
    }
  });

  return res.json({
    isMonthAssigned: true,
    weekShifts,
    weekOffConfig
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
          weekMap.set(weekIndex, {
            weekIndex,
            label: `Week ${weekIndex + 1}`,
            fromDate: formatDate(weekStart),
            toDate: formatDate(weekEnd),
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
          weeks.push({
            weekIndex,
            label: `Week ${weekIndex + 1}`,
            fromDate: formatDate(weekStart),
            toDate: formatDate(weekEnd),
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