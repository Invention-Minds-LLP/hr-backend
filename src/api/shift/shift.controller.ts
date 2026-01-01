import { Request, Response } from "express";
import { PrismaClient, ShiftAssignMode } from "@prisma/client";
import cron from 'node-cron';
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

const prisma = new PrismaClient();

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

export function startShiftCron() {
  cron.schedule('5 0 * * *', async () => {
    console.log('🕛 Running daily shift generation');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const employees = await prisma.employee.findMany({
      where: {
        employmentStatus: {
          in: ['ACTIVE', 'NOTICE_PERIOD'],
        },
        EmployeeShiftSetting: {
          isNot: null,
        },
      },
      include: {
        EmployeeShiftSetting: true,
      },
    });


    for (const emp of employees) {
      const setting = emp.EmployeeShiftSetting!;
      let shiftId: number | null = null;

      // FIXED
      if (setting.mode === 'FIXED') {
        shiftId = setting.fixedShiftId;
      }

      // ROTATIONAL
      if (setting.mode === 'ROTATIONAL') {
        shiftId = await getRotationalShiftId(
          setting.rotationPatternId!,
          setting.startDate,
          today
        );
      }

      if (!shiftId) continue;

      // 🔎 Check if assignment already exists
      const existing = await prisma.shiftAssignment.findFirst({
        where: {
          employeeId: emp.id,
          date: today
        }
      });

      // ✅ Do nothing if already exists (AUTO or MANUAL)
      if (existing) continue;

      // ✅ Create only if missing
      await prisma.shiftAssignment.create({
        data: {
          employeeId: emp.id,
          shiftId,
          date: today,
          // source: 'AUTO'
        }
      });
    }
  });
}



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

export const updateEmployeeShift = async (req: Request, res: Response) => {
  const { assignmentId } = req.params;
  const { shiftId } = req.body;

  const updated = await prisma.shiftAssignment.update({
    where: { id: Number(assignmentId) },
    data: {
      shiftId,
    }
  });

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


export const getManagerEmployees = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const managerId = req.user.empId;
    console.log(req.user)
    console.log('getManagerEmployees for managerId:', managerId);

    const employees = await prisma.employee.findMany({
      where: {
        reportingManager: managerId,
        employmentStatus: 'ACTIVE'
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        phone: true,
        employmentType: true,

        Department: {
          select: {
            name: true
          }
        },

        designation: {
          select: {
            name: true
          }
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
  const shifts = await prisma.shiftTemplate.findMany({
    where: {
      shiftType: 'EXECUTIVE'
    },
    orderBy: { name: 'asc' }
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
        include: { shift: true }
      }
    }
  });

  res.json(patterns);
};
