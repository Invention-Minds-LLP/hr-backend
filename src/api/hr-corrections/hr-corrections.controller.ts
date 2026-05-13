import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import {
  countWorkingDays, getTouchedMonths, insertLedgerTx, getLastLedgerBalanceTx,
  getCalendarYear, computeTotalUsed,
} from "../leave/leave.controller";
import { createNotification } from "../notifications/notifications.controller";
// NOTE: hr-corrections has its own local getFinancialYear() — reuse that.

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

/**
 * Notify the employee about an HR correction. Employee-only — supervisors are
 * intentionally NOT notified for corrections. Non-fatal: a failed notification
 * never breaks the correction.
 */
async function notifyCorrection(employeeId: number, employeeMessage: string): Promise<void> {
  try {
    await createNotification(employeeId, employeeMessage);
  } catch (err) {
    console.error("[notifyCorrection] failed:", err);
  }
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

    // Notify the employee (their punch record changed).
    await notifyCorrection(
      Number(employeeId),
      `🕒 Your punch record for ${targetDate.toLocaleDateString('en-IN')} was corrected by HR. Reason: ${reason}`,
    );

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

    // Notify the employee — their leave balance changed.
    const ltName = (await prisma.leaveType.findUnique({ where: { id: Number(leaveTypeId) }, select: { name: true } }))?.name ?? 'leave';
    const verb = adjustType === 'CREDIT' ? 'credited' : 'debited';
    await notifyCorrection(
      Number(employeeId),
      `📊 Your ${ltName} balance was ${verb} by ${days} day(s) by HR (FY ${year}). Reason: ${reason}`,
    );

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

    // Notify the employee — attendance status changed.
    const dLabel = targetDate.toLocaleDateString('en-IN');
    await notifyCorrection(
      Number(employeeId),
      `✏️ Your attendance for ${dLabel} was changed to ${newStatus} by HR${originalStatus ? ` (was ${originalStatus})` : ''}. Reason: ${reason}`,
    );

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

    // Notify the employee — a permission was granted.
    const dLabel = dayDate.toLocaleDateString('en-IN');
    await notifyCorrection(
      Number(employeeId),
      `🟢 HR granted you a ${permissionType} permission for ${dLabel}${startTime && endTime ? ` (${new Date(startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}–${new Date(endTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })})` : ''}. Reason: ${reason}`,
    );

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

    // Notify the employee — they gained a comp-off credit (with an expiry).
    await notifyCorrection(
      Number(employeeId),
      `🎁 HR granted you a comp-off credit for working on ${work.toLocaleDateString('en-IN')}. Use it before ${expiry.toLocaleDateString('en-IN')}. Reason: ${reason}`,
    );

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

    // Notify the employee — OT was recorded (affects pay).
    const dLabel = targetDate.toLocaleDateString('en-IN');
    await notifyCorrection(
      Number(employeeId),
      `⏱️ HR recorded ${hours} hour(s) of overtime for you on ${dLabel}. Reason: ${reason}`,
    );

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

    // Notify the employee — their day's classification changed.
    const dLabel = targetDate.toLocaleDateString('en-IN');
    const human: Record<string, string> = {
      GRANT_WEEK_OFF: 'a week-off', GRANT_HOLIDAY: 'a holiday', MARK_WORKING: 'a working day',
    };
    await notifyCorrection(
      Number(employeeId),
      `📆 HR marked ${dLabel} as ${human[overrideType]} for you${overrideType === 'MARK_WORKING' && autoCompOff ? ' (a comp-off credit was added)' : ''}. Reason: ${reason}`,
    );

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

/* ════════════════════════════════════════════════════════════════════
   APPLY LEAVE ON BEHALF OF AN EMPLOYEE (HR override)
   POST /api/hr-corrections/leave-apply
   Body: { employeeId, leaveTypeId, startDate, endDate, reason,
           isHalfDay?, halfDaySession?, force? }
   ────────────────────────────────────────────────────────────────────
   HR raises a leave request for an employee and it goes straight to
   APPROVED with the balance deducted + ledger debit written — same end
   state as a normally-approved leave, but bypassing the per-application
   caps / weekly-one-type / sandwich-block rules (it's an override tool).
   Insufficient balance is blocked unless `force: true` (then it goes
   negative and is recorded).
   ════════════════════════════════════════════════════════════════════ */
export const applyLeaveOnBehalf = async (req: any, res: Response) => {
  try {
    const hrUserId = Number(req.user?.empId ?? req.user?.userId);
    // HR / HR-Manager / Admin only
    const role = String(req.user?.role ?? '').toUpperCase();
    const roleId = Number(req.user?.roleId);
    const isHR = ['HR', 'HR_MANAGER', 'ADMIN'].includes(role) || roleId === 1;
    if (!isHR) {
      return res.status(403).json({ error: "Only HR can apply leave on behalf of an employee." });
    }

    const {
      employeeId, leaveTypeId, startDate, endDate, reason,
      isHalfDay, halfDaySession, force,
    } = req.body || {};

    if (!employeeId || !leaveTypeId || !startDate || !endDate || !reason?.trim()) {
      return res.status(400).json({
        error: "employeeId, leaveTypeId, startDate, endDate and reason are required",
      });
    }

    const start = new Date(startDate);
    const end   = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: "Invalid startDate / endDate" });
    }
    if (end < start) return res.status(400).json({ error: "endDate cannot be before startDate" });
    if (isHalfDay && start.toDateString() !== end.toDateString()) {
      return res.status(400).json({ error: "Half-day must be a single date" });
    }
    if (isHalfDay && !halfDaySession) {
      return res.status(400).json({ error: "halfDaySession is required for a half-day" });
    }

    const [employee, lt] = await Promise.all([
      prisma.employee.findUnique({ where: { id: Number(employeeId) }, select: { id: true, firstName: true, lastName: true, employeeCode: true } }),
      prisma.leaveType.findUnique({ where: { id: Number(leaveTypeId) } }),
    ]);
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    if (!lt)       return res.status(400).json({ error: "Invalid leave type" });

    const year = getFinancialYear(start);
    // EL counts week-offs inside the range (sandwich rule); other types don't.
    const requestedUnits = isHalfDay
      ? 0.5
      : await countWorkingDays(Number(employeeId), start, end, { includeWeekOffs: lt.name === 'EL' });

    if (requestedUnits <= 0) {
      return res.status(400).json({ error: "Selected range contains no leave days (only holidays / week-offs)." });
    }

    // RH / CO don't have a normal balance row — keep it simple: allow without
    // a balance check (the corrections module is an override; CO/RH balances
    // are managed elsewhere). For all other types, enforce balance unless force.
    const SKIP_BALANCE_TYPES = ['RH', 'CO'];
    const balance = SKIP_BALANCE_TYPES.includes(lt.name)
      ? null
      : await prisma.employeeLeaveBalance.findFirst({
          where: { employeeId: Number(employeeId), leaveTypeId: Number(leaveTypeId), year, category: "LEAVE" },
        });

    if (!SKIP_BALANCE_TYPES.includes(lt.name)) {
      if (!balance) {
        return res.status(400).json({ error: `Leave balance not configured for ${employee.firstName} ${employee.lastName} (${lt.name}, ${year}).` });
      }
      const usedBefore = computeTotalUsed(balance);
      const remaining  = (balance.totalAllowed ?? 0) - usedBefore;
      if (requestedUnits > remaining && !force) {
        return res.status(400).json({
          error: `Insufficient ${lt.name} balance — available ${remaining}, requested ${requestedUnits}. `
               + `Re-submit with "allow negative balance" if this is intentional.`,
          available: remaining, requested: requestedUnits,
        });
      }
    }

    const now = new Date();
    const created = await prisma.$transaction(async (tx) => {
      // 1) Create the leave request, already APPROVED, all levels stamped.
      const leave = await tx.leaveRequest.create({
        data: {
          employeeId: Number(employeeId),
          leaveTypeId: Number(leaveTypeId),
          startDate: start,
          endDate: end,
          reason: reason.trim(),
          status: 'APPROVED',
          isHalfDay: !!isHalfDay,
          halfDaySession: isHalfDay ? halfDaySession : null,
          approvedBy: hrUserId,
          approvedDate: now,
          hodDecision: 'APPROVED', hodDecidedAt: now, hodNote: 'Auto-approved (HR applied on behalf)',
          hrDecision:  'APPROVED', hrDecidedAt:  now, hrNote:  reason.trim(),
          inChargeDecision: 'APPROVED', inChargeDecidedAt: now, inChargeNote: 'Auto-approved (HR applied on behalf)',
          appliedByHr: true,
          appliedByHrId: hrUserId,
        },
        include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } }, leaveType: { select: { name: true } } },
      });

      // 2) Deduct balance (skip for RH / CO).
      if (!SKIP_BALANCE_TYPES.includes(lt.name)) {
        if (isHalfDay) {
          await tx.employeeLeaveBalance.updateMany({
            where: { employeeId: Number(employeeId), leaveTypeId: Number(leaveTypeId), year },
            data: { halfDayUsed: { increment: 1 } },
          });
        } else {
          await tx.employeeLeaveBalance.updateMany({
            where: { employeeId: Number(employeeId), leaveTypeId: Number(leaveTypeId), year },
            data: { used: { increment: requestedUnits } },
          });
        }

        // 3) Ledger DEBIT entries per touched month — mirrors the normal approval path.
        const touched = getTouchedMonths(start, end);
        touched.sort((a, b) => a.year - b.year || a.month - b.month);
        let runningBalance = await getLastLedgerBalanceTx(tx as any, Number(employeeId), Number(leaveTypeId), year);

        for (const m of touched) {
          const calYear = getCalendarYear(m.year, m.month);
          const monthStart = new Date(calYear, m.month - 1, 1);
          const monthEnd   = new Date(calYear, m.month, 0);
          const from = start > monthStart ? start : monthStart;
          const to   = end   < monthEnd   ? end   : monthEnd;
          const days = isHalfDay ? 0.5 : await countWorkingDays(Number(employeeId), from, to, { includeWeekOffs: lt.name === 'EL' });
          if (days <= 0) continue;
          runningBalance -= days;
          await insertLedgerTx(tx as any, {
            employeeId: Number(employeeId),
            leaveTypeId: Number(leaveTypeId),
            year: m.year,
            month: m.month,
            debit: days,
            credit: 0,
            balanceAfter: runningBalance,
            action: "DEBIT",
            referenceType: "LEAVE_REQUEST",
            referenceId: leave.id,
            performedBy: hrUserId,
            source: "ADMIN",
            remarks: `HR-applied leave (${lt.name})${force ? ' [forced — negative balance]' : ''}: ${reason.trim().slice(0, 120)}`,
          });
          // half-day spans a single month, so break after the first
          if (isHalfDay) break;
        }
      }

      return leave;
    }, { timeout: 15000 });

    // ── Notification (employee only — supervisors are not notified for
    //    HR corrections / HR-applied leave; failures don't roll back). ──
    try {
      const typeName = lt.name;
      const range = isHalfDay
        ? `${start.toLocaleDateString('en-IN')} (${halfDaySession === 'FIRST_HALF' ? '1st half' : '2nd half'})`
        : `${start.toLocaleDateString('en-IN')} – ${end.toLocaleDateString('en-IN')}`;
      await createNotification(
        Number(employeeId),
        `📝 HR has applied ${requestedUnits} day(s) of ${typeName} leave on your behalf for ${range}. Reason: ${reason.trim()}`,
      );
    } catch (notifyErr) {
      console.error("[applyLeaveOnBehalf notify] failed:", notifyErr);
    }

    return res.status(201).json({
      message: "Leave applied and approved on behalf of the employee.",
      data: created,
      requestedUnits,
    });
  } catch (err: any) {
    console.error("applyLeaveOnBehalf error:", err);
    return res.status(500).json({ error: err?.message || "Failed to apply leave on behalf" });
  }
};

/** GET /api/hr-corrections/leave-apply — list of HR-applied leaves (history). */
export const getHrAppliedLeaveList = async (req: Request, res: Response) => {
  try {
    const { employeeId, page = "1", pageSize = "25" } = req.query as any;
    const where: any = { appliedByHr: true };
    if (employeeId) where.employeeId = Number(employeeId);

    const take = Math.min(100, Number(pageSize) || 25);
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;

    const [rows, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take, skip,
        include: {
          employee:  { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          leaveType: { select: { id: true, name: true } },
        },
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    return res.json({ total, rows });
  } catch (err: any) {
    console.error("getHrAppliedLeaveList error:", err);
    return res.status(500).json({ error: err?.message || "Failed to load HR-applied leaves" });
  }
};
