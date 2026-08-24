// ─────────────────────────────────────────────────────────────────────────────
//  Earned Leave application rules (client policy, confirmed Aug 2026).
//
//   • An employee may only apply for EL while holding at least 28 days.
//   • A minimum of 25 days must remain in the account at all times, until the
//     last working day — so an application that would drop the balance below 25
//     is refused.
//   • An application must be between 3 and 7 days.
//
//  The three numbers are consistent by design: 28 to apply, minimum 3 per
//  request, 25 retained. They are held here rather than in LeavePolicy because
//  the policy table has no column for a retained-balance floor, and adding one
//  would not make it configurable in the UI anyway.
//
//  Kept in lib/ alongside leaveLop so the controller and the pre-flight check
//  enforce and describe exactly the same rule. The arithmetic is pure, so it is
//  testable without a database.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from './prisma';
import { leaveDuration } from './leaveLop';

export const EL_MIN_BALANCE_TO_APPLY = 28;
export const EL_MIN_BALANCE_RETAINED = 25;
export const EL_MIN_DAYS_PER_REQUEST = 3;
export const EL_MAX_DAYS_PER_REQUEST = 7;
/** Applications per FINANCIAL year, not per calendar year — EL balances are
 *  already keyed by financial year, so anything else would let the count and
 *  the balance disagree about which year a March request belongs to. */
export const EL_MAX_REQUESTS_PER_YEAR = 3;

export interface ELRuleResult {
  ok: boolean;
  /** Employee-facing refusal text; null when ok. */
  error: string | null;
  /** Which rule refused it — for logging and for the UI to badge. */
  code: 'MIN_DAYS' | 'MAX_DAYS' | 'MAX_REQUESTS' | 'MIN_BALANCE' | 'RETAINED_BALANCE' | null;
}

const OK: ELRuleResult = { ok: true, error: null, code: null };
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Pure rule check for an EL application.
 *
 * @param availableBalance days available now, already net of anything held by
 *                         pending applications (use Infinity for unlimited)
 * @param requestedUnits   days being applied for
 * @param requestsThisYear EL applications already made this financial year
 */
export function checkELApplication(
  availableBalance: number,
  requestedUnits: number,
  requestsThisYear = 0,
): ELRuleResult {
  if (requestedUnits < EL_MIN_DAYS_PER_REQUEST) {
    return {
      ok: false,
      code: 'MIN_DAYS',
      error: `Earned Leave must be applied for a minimum of ${EL_MIN_DAYS_PER_REQUEST} days at a time.`,
    };
  }

  if (requestedUnits > EL_MAX_DAYS_PER_REQUEST) {
    return {
      ok: false,
      code: 'MAX_DAYS',
      error: `Earned Leave cannot exceed ${EL_MAX_DAYS_PER_REQUEST} days in a single application.`,
    };
  }

  // Checked ahead of the balance floors: having used the year's allowance is an
  // absolute stop until April, whereas a balance shortfall resolves as the
  // employee accrues. Telling them the balance is short would be misleading.
  if (requestsThisYear >= EL_MAX_REQUESTS_PER_YEAR) {
    return {
      ok: false,
      code: 'MAX_REQUESTS',
      error:
        `Earned Leave can be applied for a maximum of ${EL_MAX_REQUESTS_PER_YEAR} times in a financial year. ` +
        `You have already applied ${requestsThisYear} time(s).`,
    };
  }

  if (availableBalance < EL_MIN_BALANCE_TO_APPLY) {
    return {
      ok: false,
      code: 'MIN_BALANCE',
      error:
        `You need at least ${EL_MIN_BALANCE_TO_APPLY} Earned Leave days to apply. ` +
        `Your available balance is ${round2(availableBalance)} day(s).`,
    };
  }

  const remaining = round2(availableBalance - requestedUnits);
  if (remaining < EL_MIN_BALANCE_RETAINED) {
    return {
      ok: false,
      code: 'RETAINED_BALANCE',
      error:
        `This application would leave you with ${remaining} Earned Leave day(s). ` +
        `A minimum balance of ${EL_MIN_BALANCE_RETAINED} days must be retained at all times.`,
    };
  }

  return OK;
}

/**
 * Financial year (April–March) of a stored timestamp.
 *
 * Read in IST rather than server-local time: leave dates are stored both at UTC
 * midnight and at IST midnight (18:30Z the previous day), so on a UTC-timezone
 * server a request saved as 2026-03-31T18:30Z — 1 April in IST — would other-
 * wise be attributed to the previous financial year.
 *
 * Duplicated from the controllers rather than imported, so lib does not depend
 * on the API layer.
 */
function financialYearOf(date: Date): number {
  const ist = new Date(date.getTime() + 330 * 60 * 1000);
  const month = ist.getUTCMonth() + 1;
  return month >= 4 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
}

/**
 * EL applications already made in a financial year.
 *
 * Only PENDING and APPROVED requests consume one of the three. A REJECTED or
 * CANCELLED application must not burn an entitlement the employee never took —
 * otherwise a manager declining a request costs them a slot for the year.
 *
 * Counted by the financial year the leave STARTS in, matching how the balance
 * row is selected, so a March request draws on the same year in both checks.
 */
export async function getELRequestCountForYear(
  employeeId: number,
  financialYear: number,
  /** Ignore this request when re-checking an existing one. */
  excludeRequestId?: number,
): Promise<number> {
  const el = await prisma.leaveType.findFirst({
    where: { name: 'EL' },
    select: { id: true },
  });
  if (!el) return 0;

  const rows = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      leaveTypeId: el.id,
      status: { in: ['PENDING', 'APPROVED'] },
      ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
    },
    select: { startDate: true },
  });

  return rows.filter((r) => financialYearOf(new Date(r.startDate)) === financialYear).length;
}

/**
 * EL days actually available to spend, for the financial year a request starts
 * in. Days locked up by PENDING applications are subtracted: the balance is only
 * debited at approval, so without this an employee could submit two applications
 * that each pass the floor and together breach it.
 *
 * Returns Infinity for an unlimited entitlement, and 0 when no balance row
 * exists (nothing has been allocated).
 */
export async function getELAvailableBalance(
  employeeId: number,
  financialYear: number,
  /** Ignore this request when re-checking an existing one. */
  excludeRequestId?: number,
): Promise<number> {
  const el = await prisma.leaveType.findFirst({
    where: { name: 'EL' },
    select: { id: true },
  });
  if (!el) return 0;

  const row = await prisma.employeeLeaveBalance.findFirst({
    where: { employeeId, leaveTypeId: el.id, year: financialYear },
    select: { totalAllowed: true, used: true, halfDayUsed: true, isUnlimited: true },
  });

  if (row?.isUnlimited) return Infinity;

  const used = (row?.used ?? 0) + (row?.halfDayUsed ?? 0) * 0.5;
  const balance = (row?.totalAllowed ?? 0) - used;

  const pendingRows = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      leaveTypeId: el.id,
      status: 'PENDING',
      ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
    },
    select: { startDate: true, endDate: true, isHalfDay: true },
  });

  const pending = pendingRows
    .filter((r) => financialYearOf(new Date(r.startDate)) === financialYear)
    .reduce((sum, r) => sum + leaveDuration(r.startDate, r.endDate, r.isHalfDay ?? false), 0);

  return round2(Math.max(0, balance - pending));
}
