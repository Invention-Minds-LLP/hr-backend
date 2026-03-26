import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

// ─── helpers ───────────────────────────────────────────────────────────────

function atStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getFinancialYear(date: Date): number {
  const month = date.getMonth() + 1;
  return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

async function getLastLedgerBalance(
  employeeId: number,
  leaveTypeId: number,
  year: number
): Promise<number> {
  const last = await (prisma.leaveLedger as any).findFirst({
    where: { employeeId, leaveTypeId, year },
    orderBy: { id: "desc" },
    select: { balanceAfter: true },
  });
  return last?.balanceAfter ?? 0;
}

// ─── PUNCH CORRECTION ──────────────────────────────────────────────────────

/**
 * POST /api/hr-corrections/punch
 * Corrects missing or incorrect punch-in / punch-out times.
 * Body: { employeeId, date, correctedIn?, correctedOut?, reason }
 */
export const correctPunch = async (req: Request, res: Response) => {
  try {
    const { employeeId, date, correctedIn, correctedOut, reason } =
      req.body as {
        employeeId: number;
        date: string;
        correctedIn?: string;
        correctedOut?: string;
        reason: string;
      };

    const performedBy: number | null = (req as any).user?.empId ?? null;

    if (!employeeId || !date || !reason) {
      return res
        .status(400)
        .json({ error: "employeeId, date, and reason are required" });
    }
    if (!correctedIn && !correctedOut) {
      return res
        .status(400)
        .json({ error: "At least one of correctedIn or correctedOut is required" });
    }

    const targetDate = atStartOfDay(new Date(date));
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: Number(employeeId), date: targetDate } },
    });

    const originalIn = existing?.checkIn ?? null;
    const originalOut = existing?.checkOut ?? null;

    const newIn = correctedIn ? new Date(correctedIn) : existing?.checkIn ?? null;
    const newOut = correctedOut ? new Date(correctedOut) : existing?.checkOut ?? null;

    // Determine correction type
    let correctionType = "FULL";
    if (correctedIn && !correctedOut) correctionType = correctedIn ? "IN_TIME" : "MISSING_IN";
    else if (!correctedIn && correctedOut) correctionType = correctedOut ? "OUT_TIME" : "MISSING_OUT";
    else correctionType = "BOTH";

    let attendance: any;
    if (existing) {
      attendance = await (prisma.attendance as any).update({
        where: { id: existing.id },
        data: {
          checkIn: newIn,
          checkOut: newOut,
          // If was ABSENT and now has a check-in, promote to PRESENT
          status:
            existing.status === "ABSENT" && newIn ? "PRESENT" : existing.status,
          isPunchCorrected: true,
        },
      });
    } else {
      attendance = await (prisma.attendance as any).create({
        data: {
          employeeId: Number(employeeId),
          date: targetDate,
          checkIn: newIn,
          checkOut: newOut,
          status: "PRESENT",
          isPunchCorrected: true,
          createdBy: performedBy,
          reason,
        },
      });
    }

    const log = await (prisma as any).punchCorrectionLog.create({
      data: {
        employeeId: Number(employeeId),
        date: targetDate,
        originalIn,
        originalOut,
        correctedIn: newIn,
        correctedOut: newOut,
        correctionType,
        reason,
        performedBy: performedBy ?? 0,
      },
    });

    await (prisma.attendance as any).update({
      where: { id: attendance.id },
      data: { punchCorrectionId: log.id },
    });

    return res.json(log);
  } catch (err) {
    console.error("correctPunch error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/hr-corrections/punch
 * Paginated list of punch corrections.
 */
export const getPunchCorrectionList = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;

    const where: any = {};
    if (employeeId) where.employeeId = employeeId;

    const [records, total] = await Promise.all([
      (prisma as any).punchCorrectionLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              Department: { select: { name: true } },
            },
          },
        },
      }),
      (prisma as any).punchCorrectionLog.count({ where }),
    ]);

    return res.json({ records, total, page, limit });
  } catch (err) {
    console.error("getPunchCorrectionList error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ─── LEAVE BALANCE ADJUSTMENT ──────────────────────────────────────────────

/**
 * POST /api/hr-corrections/leave-balance
 * Manually credit or debit a leave balance.
 * Body: { employeeId, leaveTypeId, year, adjustType ('CREDIT'|'DEBIT'), days, reason }
 */
export const adjustLeaveBalance = async (req: Request, res: Response) => {
  try {
    const { employeeId, leaveTypeId, year, adjustType, days, reason } =
      req.body as {
        employeeId: number;
        leaveTypeId: number;
        year: number;
        adjustType: "CREDIT" | "DEBIT";
        days: number;
        reason: string;
      };

    const performedBy: number | null = (req as any).user?.empId ?? null;

    if (!employeeId || !leaveTypeId || !year || !adjustType || !days || !reason) {
      return res.status(400).json({
        error: "employeeId, leaveTypeId, year, adjustType, days, and reason are required",
      });
    }
    if (!["CREDIT", "DEBIT"].includes(adjustType)) {
      return res.status(400).json({ error: "adjustType must be CREDIT or DEBIT" });
    }
    if (Number(days) <= 0) {
      return res.status(400).json({ error: "days must be greater than 0" });
    }

    const month = new Date().getMonth() + 1;

    const balance = await prisma.employeeLeaveBalance.findFirst({
      where: {
        employeeId: Number(employeeId),
        leaveTypeId: Number(leaveTypeId),
        year: Number(year),
      },
    });

    if (!balance) {
      return res.status(404).json({ error: "No leave balance record found for this employee/leave type/year" });
    }

    const balanceBefore = await getLastLedgerBalance(
      Number(employeeId),
      Number(leaveTypeId),
      Number(year)
    );

    let balanceAfter: number;

    if (adjustType === "CREDIT") {
      // Increase totalAllowed — employee gains extra days
      await prisma.employeeLeaveBalance.update({
        where: { id: balance.id },
        data: { totalAllowed: { increment: Number(days) } },
      });
      balanceAfter = balanceBefore + Number(days);

      await (prisma.leaveLedger as any).create({
        data: {
          employeeId: Number(employeeId),
          leaveTypeId: Number(leaveTypeId),
          year: Number(year),
          month,
          credit: Number(days),
          debit: 0,
          balanceAfter,
          action: "ADJUSTMENT",
          referenceType: "LEAVE_REQUEST",
          performedBy,
          source: "ADMIN",
          remarks: `Manual credit: ${reason}`,
        },
      });
    } else {
      // Increase used — treated as if days were consumed
      await prisma.employeeLeaveBalance.update({
        where: { id: balance.id },
        data: { used: { increment: Number(days) } },
      });
      balanceAfter = balanceBefore - Number(days);

      await (prisma.leaveLedger as any).create({
        data: {
          employeeId: Number(employeeId),
          leaveTypeId: Number(leaveTypeId),
          year: Number(year),
          month,
          credit: 0,
          debit: Number(days),
          balanceAfter,
          action: "ADJUSTMENT",
          referenceType: "LEAVE_REQUEST",
          performedBy,
          source: "ADMIN",
          remarks: `Manual debit: ${reason}`,
        },
      });
    }

    const result = await (prisma as any).leaveBalanceAdjustmentLog.create({
      data: {
        employeeId: Number(employeeId),
        leaveTypeId: Number(leaveTypeId),
        year: Number(year),
        adjustType,
        days: Number(days),
        balanceBefore,
        balanceAfter,
        reason,
        performedBy: performedBy ?? 0,
      },
    });

    return res.json(result);
  } catch (err) {
    console.error("adjustLeaveBalance error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/hr-corrections/leave-balance
 */
export const getLeaveBalanceAdjustmentList = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;

    const where: any = {};
    if (employeeId) where.employeeId = employeeId;

    const [records, total] = await Promise.all([
      (prisma as any).leaveBalanceAdjustmentLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              Department: { select: { name: true } },
            },
          },
          leaveType: { select: { id: true, name: true } },
        },
      }),
      (prisma as any).leaveBalanceAdjustmentLog.count({ where }),
    ]);

    return res.json({ records, total, page, limit });
  } catch (err) {
    console.error("getLeaveBalanceAdjustmentList error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ─── ATTENDANCE OVERRIDE ────────────────────────────────────────────────────

/**
 * POST /api/hr-corrections/attendance-override
 * Overrides attendance status (WFH, FIELD_DUTY, ON_DUTY, ABSENT, PRESENT).
 * Body: { employeeId, date, newStatus, reason }
 */
export const overrideAttendanceStatus = async (req: Request, res: Response) => {
  try {
    const { employeeId, date, newStatus, reason } = req.body as {
      employeeId: number;
      date: string;
      newStatus: string;
      reason: string;
    };

    const performedBy: number | null = (req as any).user?.empId ?? null;

    if (!employeeId || !date || !newStatus || !reason) {
      return res.status(400).json({
        error: "employeeId, date, newStatus, and reason are required",
      });
    }

    const validStatuses = ["PRESENT", "ABSENT", "WFH", "FIELD_DUTY", "ON_DUTY", "HALF_DAY"];
    if (!validStatuses.includes(newStatus)) {
      return res
        .status(400)
        .json({ error: `newStatus must be one of: ${validStatuses.join(", ")}` });
    }

    const targetDate = atStartOfDay(new Date(date));

    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: Number(employeeId), date: targetDate } },
    });

    const originalStatus = existing?.status ?? null;

    let attendance: any;
    if (existing) {
      attendance = await (prisma.attendance as any).update({
        where: { id: existing.id },
        data: { status: newStatus, isOverridden: true },
      });
    } else {
      attendance = await (prisma.attendance as any).create({
        data: {
          employeeId: Number(employeeId),
          date: targetDate,
          status: newStatus,
          isOverridden: true,
          createdBy: performedBy,
          reason,
        },
      });
    }

    const overrideLog = await (prisma as any).attendanceOverrideLog.create({
      data: {
        employeeId: Number(employeeId),
        date: targetDate,
        originalStatus,
        newStatus,
        reason,
        performedBy: performedBy ?? 0,
      },
    });

    await (prisma.attendance as any).update({
      where: { id: attendance.id },
      data: { overrideId: overrideLog.id },
    });

    return res.json(overrideLog);
  } catch (err) {
    console.error("overrideAttendanceStatus error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/hr-corrections/attendance-override
 */
export const getAttendanceOverrideList = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;

    const where: any = {};
    if (employeeId) where.employeeId = employeeId;

    const [records, total] = await Promise.all([
      (prisma as any).attendanceOverrideLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              Department: { select: { name: true } },
            },
          },
        },
      }),
      (prisma as any).attendanceOverrideLog.count({ where }),
    ]);

    return res.json({ records, total, page, limit });
  } catch (err) {
    console.error("getAttendanceOverrideList error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ─── PERMISSION OVERRIDE ───────────────────────────────────────────────────

/**
 * POST /api/hr-corrections/permission
 * HR grants a permission directly, bypassing the approval workflow.
 * Body: { employeeId, day, permissionType, timing, startTime?, endTime?, reason, deductBalance? }
 */
export const grantPermissionOverride = async (req: Request, res: Response) => {
  try {
    const {
      employeeId, day, permissionType, timing,
      startTime, endTime, reason, deductBalance,
    } = req.body as {
      employeeId: number;
      day: string;
      permissionType: string;
      timing: string;
      startTime?: string;
      endTime?: string;
      reason: string;
      deductBalance?: boolean;
    };

    const performedBy: number | null = (req as any).user?.empId ?? null;

    if (!employeeId || !day || !permissionType || !timing || !reason) {
      return res.status(400).json({
        error: "employeeId, day, permissionType, timing, and reason are required",
      });
    }

    const now = new Date();
    const dayDate = atStartOfDay(new Date(day));
    const year = getFinancialYear(dayDate);

    const permission = await (prisma.permissionRequest as any).create({
      data: {
        employeeId: Number(employeeId),
        day: dayDate,
        permissionType,
        timing,
        startTime: startTime ? new Date(startTime) : undefined,
        endTime: endTime ? new Date(endTime) : undefined,
        reason,
        status: "APPROVED",
        approvedBy: performedBy,
        approvedDate: now,
        hodDecision: "APPROVED",
        hodDecidedAt: now,
        hrDecision: "APPROVED",
        hrDecidedAt: now,
        inChargeDecision: "APPROVED",
        inChargeDecidedAt: now,
        isHROverride: true,
        hrOverrideReason: reason,
      },
    });

    // Optionally deduct from permission balance
    if (deductBalance) {
      const balance = await prisma.employeeLeaveBalance.findFirst({
        where: {
          employeeId: Number(employeeId),
          category: "PERMISSION",
          permissionType: permissionType as any,
          year,
        },
      });
      if (balance && !balance.isUnlimited) {
        await prisma.employeeLeaveBalance.update({
          where: { id: balance.id },
          data: { used: { increment: 1 } },
        });
      }
    }

    return res.json(permission);
  } catch (err) {
    console.error("grantPermissionOverride error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/hr-corrections/permission
 */
export const getPermissionOverrideList = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;

    const where: any = { isHROverride: true };
    if (employeeId) where.employeeId = employeeId;

    const [records, total] = await Promise.all([
      (prisma.permissionRequest as any).findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              Department: { select: { name: true } },
            },
          },
        },
      }),
      (prisma.permissionRequest as any).count({ where }),
    ]);

    return res.json({ records, total, page, limit });
  } catch (err) {
    console.error("getPermissionOverrideList error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ─── COMP-OFF MANUAL GRANT ─────────────────────────────────────────────────

/**
 * POST /api/hr-corrections/comp-off
 * HR manually grants a comp-off credit for a date the employee worked.
 * Body: { employeeId, workDate, expiryDate?, reason }
 */
export const manualCompOffGrant = async (req: Request, res: Response) => {
  try {
    const { employeeId, workDate, expiryDate, reason } = req.body as {
      employeeId: number;
      workDate: string;
      expiryDate?: string;
      reason: string;
    };

    const performedBy: number | null = (req as any).user?.empId ?? null;

    if (!employeeId || !workDate || !reason) {
      return res.status(400).json({
        error: "employeeId, workDate, and reason are required",
      });
    }

    const work = atStartOfDay(new Date(workDate));
    const expiry = expiryDate
      ? atStartOfDay(new Date(expiryDate))
      : (() => {
          const d = new Date(work);
          d.setMonth(d.getMonth() + 3);
          return d;
        })();

    const credit = await (prisma.compOffCredit as any).create({
      data: {
        employeeId: Number(employeeId),
        workDate: work,
        expiryDate: expiry,
        used: false,
        isManualGrant: true,
        grantedBy: performedBy,
        grantReason: reason,
      },
    });

    return res.json(credit);
  } catch (err) {
    console.error("manualCompOffGrant error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/hr-corrections/comp-off
 */
export const getCompOffGrantList = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;

    const where: any = { isManualGrant: true };
    if (employeeId) where.employeeId = employeeId;

    const [records, total] = await Promise.all([
      (prisma.compOffCredit as any).findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              Department: { select: { name: true } },
            },
          },
        },
      }),
      (prisma.compOffCredit as any).count({ where }),
    ]);

    return res.json({ records, total, page, limit });
  } catch (err) {
    console.error("getCompOffGrantList error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ─── OT MANUAL ENTRY ───────────────────────────────────────────────────────

/**
 * POST /api/hr-corrections/ot
 * HR manually enters overtime hours that the system missed.
 * Body: { employeeId, date, hours, scheduledEndTime?, reason }
 */
export const manualOTEntry = async (req: Request, res: Response) => {
  try {
    const { employeeId, date, hours, scheduledEndTime, reason } = req.body as {
      employeeId: number;
      date: string;
      hours: number;
      scheduledEndTime?: string;
      reason: string;
    };

    const performedBy: number | null = (req as any).user?.empId ?? null;

    if (!employeeId || !date || !hours || !reason) {
      return res.status(400).json({
        error: "employeeId, date, hours, and reason are required",
      });
    }
    if (Number(hours) <= 0) {
      return res.status(400).json({ error: "hours must be greater than 0" });
    }

    const targetDate = atStartOfDay(new Date(date));
    const minutes = Math.round(Number(hours) * 60);
    const now = new Date();

    const ot = await (prisma.overtimeApproval as any).upsert({
      where: { employeeId_date: { employeeId: Number(employeeId), date: targetDate } },
      create: {
        employeeId: Number(employeeId),
        date: targetDate,
        minutes,
        status: "APPROVED",
        approvedAt: now,
        scheduledEnd: scheduledEndTime ? new Date(scheduledEndTime) : undefined,
        managerStatus: "APPROVED",
        managerApprovedAt: now,
        manuallyEntered: true,
        manualEntryBy: performedBy,
        manualEntryReason: reason,
      },
      update: {
        minutes,
        status: "APPROVED",
        approvedAt: now,
        scheduledEnd: scheduledEndTime ? new Date(scheduledEndTime) : undefined,
        managerStatus: "APPROVED",
        managerApprovedAt: now,
        manuallyEntered: true,
        manualEntryBy: performedBy,
        manualEntryReason: reason,
      },
    });

    return res.json(ot);
  } catch (err) {
    console.error("manualOTEntry error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/hr-corrections/ot
 */
export const getOTManualEntryList = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;

    const where: any = { manuallyEntered: true };
    if (employeeId) where.employeeId = employeeId;

    const [records, total] = await Promise.all([
      (prisma.overtimeApproval as any).findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              Department: { select: { name: true } },
            },
          },
        },
      }),
      (prisma.overtimeApproval as any).count({ where }),
    ]);

    return res.json({ records, total, page, limit });
  } catch (err) {
    console.error("getOTManualEntryList error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ─── WEEK-OFF / HOLIDAY OVERRIDE ───────────────────────────────────────────

/**
 * POST /api/hr-corrections/weekoff-holiday
 * Override an employee's week-off or holiday status for a specific date.
 * overrideType: GRANT_WEEK_OFF | GRANT_HOLIDAY | MARK_WORKING
 * MARK_WORKING optionally auto-grants a comp-off credit.
 * Body: { employeeId, date, overrideType, reason, autoCompOff? }
 */
export const weekOffHolidayOverride = async (req: Request, res: Response) => {
  try {
    const { employeeId, date, overrideType, reason, autoCompOff } = req.body as {
      employeeId: number;
      date: string;
      overrideType: "GRANT_WEEK_OFF" | "GRANT_HOLIDAY" | "MARK_WORKING";
      reason: string;
      autoCompOff?: boolean;
    };

    const performedBy: number | null = (req as any).user?.empId ?? null;

    if (!employeeId || !date || !overrideType || !reason) {
      return res.status(400).json({
        error: "employeeId, date, overrideType, and reason are required",
      });
    }

    const statusMap: Record<string, string> = {
      GRANT_WEEK_OFF: "WEEK_OFF",
      GRANT_HOLIDAY: "HOLIDAY",
      MARK_WORKING: "PRESENT",
    };
    const newStatus = statusMap[overrideType];
    const targetDate = atStartOfDay(new Date(date));

    const existingAttendance = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: Number(employeeId), date: targetDate } },
    });

    const prevStatus = existingAttendance?.status ?? null;

    await (prisma.attendance as any).upsert({
      where: { employeeId_date: { employeeId: Number(employeeId), date: targetDate } },
      create: {
        employeeId: Number(employeeId),
        date: targetDate,
        status: newStatus,
        isOverridden: true,
        createdBy: performedBy,
        reason,
      },
      update: {
        status: newStatus,
        isOverridden: true,
      },
    });

    const weekOffLog = await (prisma as any).weekOffHolidayOverrideLog.create({
      data: {
        employeeId: Number(employeeId),
        date: targetDate,
        overrideType,
        prevStatus,
        newStatus,
        autoCompOff: !!autoCompOff,
        reason,
        performedBy: performedBy ?? 0,
      },
    });

    // Auto-grant comp-off when MARK_WORKING on a holiday/week-off
    if (autoCompOff && overrideType === "MARK_WORKING") {
      const expiry = new Date(targetDate);
      expiry.setMonth(expiry.getMonth() + 3);
      await (prisma.compOffCredit as any).create({
        data: {
          employeeId: Number(employeeId),
          workDate: targetDate,
          expiryDate: expiry,
          used: false,
          isManualGrant: true,
          grantedBy: performedBy,
          grantReason: `Auto-granted: ${reason}`,
        },
      });
    }

    return res.json(weekOffLog);
  } catch (err) {
    console.error("weekOffHolidayOverride error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/hr-corrections/weekoff-holiday
 */
export const getWeekOffHolidayOverrideList = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;

    const where: any = {};
    if (employeeId) where.employeeId = employeeId;

    const [records, total] = await Promise.all([
      (prisma as any).weekOffHolidayOverrideLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              Department: { select: { name: true } },
            },
          },
        },
      }),
      (prisma as any).weekOffHolidayOverrideLog.count({ where }),
    ]);

    return res.json({ records, total, page, limit });
  } catch (err) {
    console.error("getWeekOffHolidayOverrideList error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ─── APPRAISAL OVERRIDE ─────────────────────────────────────────────────────

/**
 * GET /api/hr-corrections/appraisals/search
 * Search appraisal forms by employeeId, returns forms with cycle + current scores.
 */
export const searchAppraisals = async (req: Request, res: Response) => {
  try {
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    if (!employeeId) {
      return res.status(400).json({ error: "employeeId is required" });
    }

    const forms = await prisma.appraisalForm.findMany({
      where: { employeeId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        cycle: true,
        status: true,
        overallScore: true,
        finalDecision: true,
        finalComments: true,
        createdAt: true,
      },
    });

    return res.json(forms);
  } catch (err) {
    console.error("searchAppraisals error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /api/hr-corrections/appraisals/override
 * HR overrides appraisal form fields.
 * Body: { appraisalFormId, overallScore?, finalDecision?, status?, finalComments?, reason }
 */
export const appraisalOverride = async (req: Request, res: Response) => {
  try {
    const { appraisalFormId, overallScore, finalDecision, status, finalComments, reason } =
      req.body as {
        appraisalFormId: number;
        overallScore?: number;
        finalDecision?: string;
        status?: string;
        finalComments?: string;
        reason: string;
      };

    const performedBy: number | null = (req as any).user?.empId ?? null;

    if (!appraisalFormId || !reason) {
      return res.status(400).json({ error: "appraisalFormId and reason are required" });
    }
    if (overallScore === undefined && !finalDecision && !status && !finalComments) {
      return res.status(400).json({ error: "At least one field to override is required" });
    }

    const form = await prisma.appraisalForm.findUnique({
      where: { id: Number(appraisalFormId) },
    });
    if (!form) {
      return res.status(404).json({ error: "Appraisal form not found" });
    }

    const updateData: any = {};
    if (overallScore !== undefined) updateData.overallScore = Number(overallScore);
    if (finalDecision !== undefined) updateData.finalDecision = finalDecision;
    if (status !== undefined) updateData.status = status;
    if (finalComments !== undefined) updateData.finalComments = finalComments;

    await prisma.appraisalForm.update({
      where: { id: Number(appraisalFormId) },
      data: updateData,
    });

    const appraisalLog = await (prisma as any).appraisalOverrideLog.create({
      data: {
        appraisalFormId: Number(appraisalFormId),
        employeeId: form.employeeId,
        cycle: form.cycle,
        prevOverallScore: form.overallScore,
        newOverallScore: overallScore !== undefined ? Number(overallScore) : undefined,
        prevFinalDecision: form.finalDecision,
        newFinalDecision: finalDecision ?? undefined,
        prevStatus: form.status,
        newStatus: status ?? undefined,
        prevComments: form.finalComments,
        newComments: finalComments ?? undefined,
        reason,
        performedBy: performedBy ?? 0,
      },
    });

    return res.json(appraisalLog);
  } catch (err) {
    console.error("appraisalOverride error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /api/hr-corrections/appraisals/override
 */
export const getAppraisalOverrideList = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;

    const where: any = {};
    if (employeeId) where.employeeId = employeeId;

    const [records, total] = await Promise.all([
      (prisma as any).appraisalOverrideLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              Department: { select: { name: true } },
            },
          },
        },
      }),
      (prisma as any).appraisalOverrideLog.count({ where }),
    ]);

    return res.json({ records, total, page, limit });
  } catch (err) {
    console.error("getAppraisalOverrideList error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ─── LEAVE TYPES (for dropdowns) ───────────────────────────────────────────

export const getLeaveTypes = async (_req: Request, res: Response) => {
  try {
    const types = await prisma.leaveType.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return res.json(types);
  } catch (err) {
    console.error("getLeaveTypes error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
