// ─────────────────────────────────────────────────────────────────────────────
//  Payroll cut-off checks.
//
//  The problem this exists for: payroll is prepared around the 25th, and an
//  employee applying for leave on the 28th for the 20th is asking HR to change
//  a payslip that has already been calculated — sometimes already paid. Nobody
//  finds out until the register stops tying out.
//
//  Rather than block the application (people are genuinely ill on the 28th),
//  this tells everyone the truth up front: the leave is accepted, but it will be
//  adjusted in NEXT month's payroll, not this one.
//
//  Three escalating states:
//    OPEN      — the month's payroll has not been touched. Nothing to say.
//    CUTOFF    — past the company's cut-off day, payroll not yet generated.
//    PROCESSED — a payroll run exists for that month (draft, published, locked).
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from './prisma';
import { resolveCompanyId } from './company';

export type CutoffState = 'OPEN' | 'CUTOFF' | 'PROCESSED';

export interface CutoffCheck {
  state: CutoffState;
  /** True when the employee should be shown a warning before submitting. */
  warn: boolean;
  /** True when payroll for that month is already final (published or locked). */
  locked: boolean;
  title: string;
  message: string;
  /** Which payroll month the adjustment will actually land in. */
  adjustmentMonth: string | null;
  affectedMonths: Array<{
    month: number;
    year: number;
    runStatus: string | null;
    lockedAt: string | null;
  }>;
  cutoffDay: number;
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** Every (month, year) a date range touches. */
function monthsBetween(start: Date, end: Date): Array<{ month: number; year: number }> {
  const out: Array<{ month: number; year: number }> = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= last) {
    out.push({ month: cur.getMonth() + 1, year: cur.getFullYear() });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

function nextMonthLabel(month: number, year: number): string {
  const m = month === 12 ? 1 : month + 1;
  const y = month === 12 ? year + 1 : year;
  return `${MONTHS[m]} ${y}`;
}

/**
 * Would applying for this period land after payroll was cut?
 *
 * `asOf` is injectable so the check is testable and so a back-dated HR entry can
 * be evaluated against the date it is really being made.
 */
export async function checkPayrollCutoff(input: {
  employeeId: number;
  startDate: Date;
  endDate: Date;
  asOf?: Date;
}): Promise<CutoffCheck> {
  const p: any = prisma;
  const now = input.asOf ?? new Date();

  const companyId = await resolveCompanyId(input.employeeId);
  const company = await p.company.findUnique({
    where: { id: companyId },
    select: { payrollCutoffDay: true },
  });
  const cutoffDay = company?.payrollCutoffDay ?? 25;

  const touched = monthsBetween(input.startDate, input.endDate);

  // Any payroll run covering those months, whatever its status.
  const runs = await p.payrollRun.findMany({
    where: {
      companyId,
      OR: touched.map((t) => ({ month: t.month, year: t.year })),
    },
    select: { month: true, year: true, status: true, lockedAt: true },
  });

  const affectedMonths = touched.map((t) => {
    const run = runs.find((r: any) => r.month === t.month && r.year === t.year);
    return {
      month: t.month,
      year: t.year,
      runStatus: run?.status ?? null,
      lockedAt: run?.lockedAt ? new Date(run.lockedAt).toISOString() : null,
    };
  });

  const processed = affectedMonths.filter((m) => m.runStatus);
  const locked = affectedMonths.some((m) => m.lockedAt || m.runStatus === 'PUBLISHED');

  // ── Payroll already run for a month this leave touches ────────────────────
  if (processed.length) {
    const first = processed[0];
    const label = `${MONTHS[first.month]} ${first.year}`;
    return {
      state: 'PROCESSED',
      warn: true,
      locked,
      title: locked
        ? `${label} payroll has already been published`
        : `${label} payroll has already been prepared`,
      message: locked
        ? `Payroll for ${label} is already published, so this leave cannot change that payslip. ` +
          `It will be recorded and adjusted in ${nextMonthLabel(first.month, first.year)} payroll instead.`
        : `A payroll run for ${label} already exists. If it is not regenerated before publishing, ` +
          `this leave will be adjusted in ${nextMonthLabel(first.month, first.year)} payroll instead.`,
      adjustmentMonth: nextMonthLabel(first.month, first.year),
      affectedMonths,
      cutoffDay,
    };
  }

  // ── Past the cut-off for the current month ────────────────────────────────
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const pastCutoff = now.getDate() >= cutoffDay;

  const touchesCurrent = touched.some(
    (t) => t.month === currentMonth && t.year === currentYear,
  );

  if (pastCutoff && touchesCurrent) {
    const label = `${MONTHS[currentMonth]} ${currentYear}`;
    return {
      state: 'CUTOFF',
      warn: true,
      locked: false,
      title: `Past the payroll cut-off for ${label}`,
      message:
        `Payroll for ${label} is prepared from the ${cutoffDay}${ordinal(cutoffDay)}. ` +
        `Your application is still accepted, but if payroll has already been calculated it will be ` +
        `adjusted in ${nextMonthLabel(currentMonth, currentYear)} instead of this month.`,
      adjustmentMonth: nextMonthLabel(currentMonth, currentYear),
      affectedMonths,
      cutoffDay,
    };
  }

  return {
    state: 'OPEN',
    warn: false,
    locked: false,
    title: '',
    message: '',
    adjustmentMonth: null,
    affectedMonths,
    cutoffDay,
  };
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}
