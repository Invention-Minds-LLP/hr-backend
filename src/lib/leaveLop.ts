// ─────────────────────────────────────────────────────────────────────────────
//  Loss-of-pay resolution for a leave request.
//
//  THE PROBLEM THIS FIXES
//  LOP existed in two places that could disagree:
//    • a leave TYPE named "LOP" that employees pick from a dropdown, and
//    • `LeaveRequest.lopUnits`, which is what payroll actually reads.
//  A request could sit on the LOP type with lopUnits = 0 and be paid in full.
//  One live row was doing exactly that.
//
//  THE RULE (option A)
//  A leave type flagged `isLop` is unpaid by definition. Choosing it forces the
//  entire duration into lopUnits, whatever the balance says. For every other
//  type the existing behaviour stands: paid up to the available balance, and the
//  overflow becomes LOP.
//
//  Everything here is pure except `resolveLopForRequest`, so the arithmetic can
//  be tested without a database.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from './prisma';

export interface LopSplit {
  paidUnits: number;
  lopUnits: number;
  /** Why it split this way — surfaced to the employee and stored on the audit. */
  reason: string;
  /** True when the type itself is unpaid, rather than the balance running out. */
  forcedByType: boolean;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Whole/half days between two dates, inclusive. */
export function leaveDuration(startDate: Date, endDate: Date, isHalfDay = false): number {
  if (isHalfDay) return 0.5;
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  return Math.max(0, Math.round(ms / 86400000) + 1);
}

/**
 * Split a leave duration into paid and unpaid units.
 *
 * @param duration       total days being applied for
 * @param availableBalance days left in the employee's balance for this type
 * @param typeIsLop      the leave type is flagged unpaid
 */
export function splitPaidAndLop(
  duration: number,
  availableBalance: number,
  typeIsLop: boolean,
): LopSplit {
  const total = round2(Math.max(0, duration));

  if (typeIsLop) {
    return {
      paidUnits: 0,
      lopUnits: total,
      reason: 'This leave type is loss of pay, so the full duration is unpaid.',
      forcedByType: true,
    };
  }

  const balance = round2(Math.max(0, availableBalance));
  const paid = round2(Math.min(total, balance));
  const lop = round2(total - paid);

  return {
    paidUnits: paid,
    lopUnits: lop,
    reason: lop > 0
      ? `Balance covers ${paid} day(s); the remaining ${lop} day(s) are unpaid.`
      : 'Fully covered by the available leave balance.',
    forcedByType: false,
  };
}

/**
 * Resolve the split for a request against live balances.
 * Returns null when the leave type cannot be found.
 */
export async function resolveLopForRequest(input: {
  employeeId: number;
  leaveTypeId: number;
  startDate: Date;
  endDate: Date;
  isHalfDay?: boolean;
  /** Exclude this request from the balance calculation when re-resolving. */
  excludeRequestId?: number;
}): Promise<LopSplit | null> {
  const p: any = prisma;

  const leaveType = await prisma.leaveType.findUnique({
    where: { id: input.leaveTypeId },
    select: { id: true, name: true, isLop: true } as any,
  });
  if (!leaveType) return null;

  const duration = leaveDuration(input.startDate, input.endDate, input.isHalfDay);

  // An unpaid type short-circuits — no balance lookup needed, and none should
  // be deducted.
  if ((leaveType as any).isLop) {
    return splitPaidAndLop(duration, 0, true);
  }

  // Balances are held per calendar year, keyed on the leave's START year — a
  // request spanning 31 Dec to 2 Jan draws on the year it began in, which is how
  // the accrual ledger already treats it.
  const year = new Date(input.startDate).getFullYear();

  const balanceRow = await p.employeeLeaveBalance.findFirst({
    where: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, year },
  });

  // An unlimited entitlement is never LOP.
  if (balanceRow?.isUnlimited) {
    return {
      paidUnits: round2(duration),
      lopUnits: 0,
      reason: 'This leave type has an unlimited entitlement.',
      forcedByType: false,
    };
  }

  // No balance row means nothing has been allocated, so the leave is unpaid.
  // Defaulting to "unlimited" here would silently pay for leave nobody holds.
  const available = round2(
    Math.max(0, (balanceRow?.totalAllowed ?? 0) - (balanceRow?.used ?? 0)),
  );

  return splitPaidAndLop(duration, available, false);
}

/**
 * One-off repair for rows that predate the rule: a request on an unpaid type
 * that still has lopUnits = 0 is being paid when it should not be.
 */
export async function backfillLopTypeRequests(dryRun = true): Promise<{
  scanned: number;
  corrected: number;
  rows: Array<{ id: number; employeeId: number; days: number; wasPaid: number }>;
}> {
  const lopTypes = await prisma.leaveType.findMany({
    where: { isLop: true } as any,
    select: { id: true },
  });
  if (!lopTypes.length) return { scanned: 0, corrected: 0, rows: [] };

  const suspect = await prisma.leaveRequest.findMany({
    where: {
      leaveTypeId: { in: lopTypes.map((t) => t.id) },
      lopUnits: 0,
    },
  });

  const rows: Array<{ id: number; employeeId: number; days: number; wasPaid: number }> = [];

  for (const req of suspect) {
    const days = leaveDuration(req.startDate, req.endDate, req.isHalfDay ?? false);
    rows.push({ id: req.id, employeeId: req.employeeId, days, wasPaid: req.paidUnits });

    if (!dryRun) {
      await prisma.leaveRequest.update({
        where: { id: req.id },
        data: { lopUnits: days, paidUnits: 0 },
      });
    }
  }

  return { scanned: suspect.length, corrected: dryRun ? 0 : rows.length, rows };
}
