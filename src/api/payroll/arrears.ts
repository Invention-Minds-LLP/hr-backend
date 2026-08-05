// ─────────────────────────────────────────────────────────────────────────────
//  Retrospective salary revision → arrears.
//
//  SalaryRevision stores only previousCtc / newCtc, not the component breakdown,
//  so an arrear cannot be reconstructed from that row alone. Instead:
//
//    for each already-published month on or after the revision's effectiveFrom:
//        should_have_earned = current structure, prorated by that month's own
//                             workingDays / lopDays
//        arrear_for_month   = should_have_earned − grossEarnings actually paid
//
//  Deriving from the payslip's own attendance rather than recomputing attendance
//  matters: the employee's LOP for March is a settled fact, and re-deriving it
//  months later could shift with subsequent attendance corrections.
//
//  Statutory top-up rides along — PF and ESI are due on the arrear too, and
//  forgetting that is the classic way an arrears run fails an audit.
//
//  A SalaryArrear row records what was computed so the same period is never paid
//  twice; `status` moves PENDING → APPLIED when a payroll run carries it.
// ─────────────────────────────────────────────────────────────────────────────

import { Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { currentEmployeeId } from '../../lib/currentUser';
import { resolveCompanyId } from '../../lib/company';
import { resolveStatutoryRates } from './calc/resolveStatutory';
import { computeStatutory } from './calc/statutory';
import { MONTHS } from './templates/engine';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Chronological key so month/year pairs can be compared as one number. */
const ordinal = (month: number, year: number) => year * 12 + (month - 1);

/**
 * Gross arrear for a single month — the pure core of the engine, extracted so
 * it can be unit-tested without a database.
 *
 * Prorates the revised full-month gross by the days that month actually paid,
 * then diffs against what was paid. Returns 0 when the revised figure is lower:
 * an arrears run pays money out, it never claws it back.
 */
export function arrearForMonth(
  revisedFullGross: number,
  workingDays: number,
  lopDays: number,
  paidGross: number,
): number {
  if (!workingDays || workingDays <= 0) return 0;
  const daysPaid = Math.max(0, workingDays - (lopDays || 0));
  const revisedGross = round2(revisedFullGross / workingDays * daysPaid);
  return Math.max(0, round2(revisedGross - (paidGross || 0)));
}

export interface ArrearMonthDetail {
  month: number;
  year: number;
  payslipId: number;
  workingDays: number;
  lopDays: number;
  paidGross: number;
  revisedGross: number;
  grossDiff: number;
  pfDiff: number;
  esiDiff: number;
}

export interface ArrearComputation {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  fromMonth: number;
  fromYear: number;
  toMonth: number;
  toYear: number;
  grossArrear: number;
  pfArrear: number;
  esiArrear: number;
  totalArrear: number;
  months: ArrearMonthDetail[];
  skippedMonths: Array<{ month: number; year: number; reason: string }>;
}

/**
 * Compute the arrear owed to one employee for published months on or after
 * `effectiveFrom`. Returns null when nothing is owed.
 */
export async function computeArrearFor(
  employeeId: number,
  effectiveFrom: Date,
): Promise<ArrearComputation | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, firstName: true, lastName: true, employeeCode: true, companyId: true } as any,
  });
  if (!employee) return null;

  const sal = await (prisma as any).salaryStructure.findUnique({ where: { employeeId } });
  if (!sal) return null;

  const companyId = (employee as any).companyId ?? (await resolveCompanyId(employeeId));

  const fromOrdinal = ordinal(effectiveFrom.getMonth() + 1, effectiveFrom.getFullYear());

  // Published payslips only — a draft run has not paid anyone anything.
  const payslips = await (prisma as any).payslip.findMany({
    where: { employeeId, payrollRun: { status: 'PUBLISHED' } },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  // Periods already settled by an earlier arrear must not be paid again.
  const settled = await (prisma as any).salaryArrear.findMany({
    where: { employeeId, status: { in: ['PENDING', 'APPLIED'] } },
    select: { fromMonth: true, fromYear: true, toMonth: true, toYear: true },
  });
  const isSettled = (m: number, y: number) =>
    settled.some((s: any) =>
      ordinal(m, y) >= ordinal(s.fromMonth, s.fromYear) &&
      ordinal(m, y) <= ordinal(s.toMonth, s.toYear));

  const revisedFullGross = round2(
    sal.basic + sal.hra + sal.medicalAllowance + sal.travelAllowance +
    sal.specialAllowance + sal.otherAllowances,
  );

  const months: ArrearMonthDetail[] = [];
  const skippedMonths: ArrearComputation['skippedMonths'] = [];

  for (const p of payslips) {
    if (ordinal(p.month, p.year) < fromOrdinal) continue;

    if (isSettled(p.month, p.year)) {
      skippedMonths.push({ month: p.month, year: p.year, reason: 'Already covered by an existing arrear' });
      continue;
    }
    if (!p.workingDays) {
      skippedMonths.push({ month: p.month, year: p.year, reason: 'Payslip has no working days recorded' });
      continue;
    }

    const daysPaid = Math.max(0, p.workingDays - (p.lopDays || 0));
    const revisedGross = round2(revisedFullGross / p.workingDays * daysPaid);
    const grossDiff = arrearForMonth(
      revisedFullGross, p.workingDays, p.lopDays || 0, p.grossEarnings || 0,
    );

    // arrearForMonth floors at zero. A raw negative means the structure went
    // DOWN since; recovering that through an arrears run would be a deduction
    // the employee never agreed to, so it is reported, not applied.
    if (grossDiff <= 0) {
      const raw = round2(revisedGross - (p.grossEarnings || 0));
      if (raw < 0) {
        skippedMonths.push({
          month: p.month, year: p.year,
          reason: `Current structure pays ${Math.abs(raw).toFixed(2)} less than what was paid — no arrear due`,
        });
      }
      continue;
    }

    // Statutory on the difference: recompute the month at the revised structure
    // and diff against what the payslip already deducted.
    const { rates } = await resolveStatutoryRates(companyId, p.month, p.year);
    const revisedBasic = round2(sal.basic / p.workingDays * daysPaid);

    const revised = computeStatutory({
      rates,
      flags: {
        pfApplicable: !!sal.pfApplicable,
        esiApplicable: !!sal.esiApplicable,
        ptApplicable: !!sal.ptApplicable,
      },
      earnedBasic: revisedBasic,
      earnedGross: revisedGross,
      fullMonthGross: revisedFullGross,
      fullMonthBasic: sal.basic,
      month: p.month,
    });

    const pfDiff = round2(Math.max(0, revised.pfEmployee - (p.pfEmployee || 0)));
    const esiDiff = round2(Math.max(0, revised.esiEmployee - (p.esiEmployee || 0)));

    months.push({
      month: p.month, year: p.year, payslipId: p.id,
      workingDays: p.workingDays, lopDays: p.lopDays || 0,
      paidGross: p.grossEarnings || 0,
      revisedGross, grossDiff, pfDiff, esiDiff,
    });
  }

  if (!months.length) return null;

  const grossArrear = round2(months.reduce((s, m) => s + m.grossDiff, 0));
  const pfArrear = round2(months.reduce((s, m) => s + m.pfDiff, 0));
  const esiArrear = round2(months.reduce((s, m) => s + m.esiDiff, 0));

  const first = months[0];
  const last = months[months.length - 1];

  return {
    employeeId,
    employeeCode: (employee as any).employeeCode,
    employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
    fromMonth: first.month, fromYear: first.year,
    toMonth: last.month, toYear: last.year,
    grossArrear, pfArrear, esiArrear,
    // Net addition to pay: the gross owed, less the extra statutory that must be
    // withheld from it.
    totalArrear: round2(grossArrear - pfArrear - esiArrear),
    months, skippedMonths,
  };
}

/**
 * GET /api/payroll/arrears/preview
 * Dry run across every employee with a salary revision — nothing is written.
 */
export const previewArrears = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = Number(req.query.employeeId) || null;
    const since = req.query.since ? new Date(String(req.query.since)) : null;

    // Latest revision per employee; that is the structure now in force, and the
    // one the current SalaryStructure reflects.
    const revisions = await (prisma as any).salaryRevision.findMany({
      where: {
        ...(employeeId ? { employeeId } : {}),
        ...(since && !Number.isNaN(since.getTime()) ? { effectiveFrom: { gte: since } } : {}),
      },
      orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'desc' }],
    });

    const latestByEmployee = new Map<number, any>();
    for (const rev of revisions) {
      if (!latestByEmployee.has(rev.employeeId)) latestByEmployee.set(rev.employeeId, rev);
    }

    const results: ArrearComputation[] = [];
    for (const [empId, rev] of latestByEmployee) {
      const computed = await computeArrearFor(empId, new Date(rev.effectiveFrom));
      if (computed) results.push(computed);
    }

    res.json({
      count: results.length,
      totalArrear: round2(results.reduce((s, r) => s + r.totalArrear, 0)),
      totalGross: round2(results.reduce((s, r) => s + r.grossArrear, 0)),
      results,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/payroll/arrears/generate
 * Persist PENDING arrears for the given employees (or all with revisions).
 * Idempotent by period: computeArrearFor already skips settled months.
 */
export const generateArrears = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const requested: number[] = Array.isArray(req.body?.employeeIds)
      ? req.body.employeeIds.map(Number).filter(Boolean)
      : [];
    const reason = req.body?.reason ? String(req.body.reason) : null;
    const computedBy = currentEmployeeId(req);

    const revisions = await (prisma as any).salaryRevision.findMany({
      where: requested.length ? { employeeId: { in: requested } } : {},
      orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'desc' }],
    });

    const latestByEmployee = new Map<number, any>();
    for (const rev of revisions) {
      if (!latestByEmployee.has(rev.employeeId)) latestByEmployee.set(rev.employeeId, rev);
    }

    const created: any[] = [];
    for (const [empId, rev] of latestByEmployee) {
      const computed = await computeArrearFor(empId, new Date(rev.effectiveFrom));
      if (!computed) continue;

      const companyId = await resolveCompanyId(empId);
      const row = await (prisma as any).salaryArrear.create({
        data: {
          employeeId: empId,
          companyId,
          fromMonth: computed.fromMonth, fromYear: computed.fromYear,
          toMonth: computed.toMonth, toYear: computed.toYear,
          grossArrear: computed.grossArrear,
          pfArrear: computed.pfArrear,
          esiArrear: computed.esiArrear,
          totalArrear: computed.totalArrear,
          detail: computed.months as any,
          reason,
          computedBy,
          status: 'PENDING',
        },
      });
      created.push(row);
    }

    res.status(201).json({ created: created.length, arrears: created });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** GET /api/payroll/arrears — list, optionally by status. */
export const listArrears = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const rows = await (prisma as any).salaryArrear.findMany({
      where: { ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/payroll/arrears/apply
 * Push PENDING arrears into a DRAFT payroll run by adding to each employee's
 * `salaryRevisionArrear` column, then recomputing that payslip's totals.
 */
export const applyArrearsToRun = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = Number(req.body?.payrollRunId);
    const arrearIds: number[] = Array.isArray(req.body?.arrearIds)
      ? req.body.arrearIds.map(Number).filter(Boolean)
      : [];

    if (!runId) return res.status(400).json({ message: 'payrollRunId is required' });

    const run = await (prisma as any).payrollRun.findUnique({ where: { id: runId } });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });
    if (run.status === 'PUBLISHED') {
      return res.status(409).json({ message: 'Cannot add arrears to a published run' });
    }
    if (run.lockedAt) {
      return res.status(409).json({ message: 'This payroll month is locked' });
    }

    const arrears = await (prisma as any).salaryArrear.findMany({
      where: { status: 'PENDING', ...(arrearIds.length ? { id: { in: arrearIds } } : {}) },
    });

    const applied: number[] = [];
    const skipped: Array<{ arrearId: number; reason: string }> = [];

    for (const arrear of arrears) {
      const payslip = await (prisma as any).payslip.findFirst({
        where: { payrollRunId: runId, employeeId: arrear.employeeId },
      });
      if (!payslip) {
        skipped.push({ arrearId: arrear.id, reason: 'Employee has no payslip in this run' });
        continue;
      }

      const newArrearAmount = round2((payslip.salaryRevisionArrear || 0) + arrear.grossArrear);
      const extraStatutory = round2(arrear.pfArrear + arrear.esiArrear);

      const totalDeductions = round2((payslip.totalDeductions || 0) + extraStatutory);
      const netPay = round2(
        (payslip.netPay || 0) + arrear.grossArrear - extraStatutory,
      );

      await prisma.$transaction(
        async (tx: any) => {
          await tx.payslip.update({
            where: { id: payslip.id },
            data: {
              salaryRevisionArrear: newArrearAmount,
              pfEmployee: round2((payslip.pfEmployee || 0) + arrear.pfArrear),
              esiEmployee: round2((payslip.esiEmployee || 0) + arrear.esiArrear),
              totalDeductions,
              netPay,
            },
          });
          await tx.salaryArrear.update({
            where: { id: arrear.id },
            data: { status: 'APPLIED', appliedPayslipId: payslip.id, appliedAt: new Date() },
          });
        },
        { maxWait: 15000, timeout: 30000 },
      );

      applied.push(arrear.id);
    }

    res.json({ runId, applied: applied.length, skipped });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** PATCH /api/payroll/arrears/:id/cancel — discard a pending arrear. */
export const cancelArrear = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const arrear = await (prisma as any).salaryArrear.findUnique({ where: { id } });
    if (!arrear) return res.status(404).json({ message: 'Arrear not found' });
    if (arrear.status === 'APPLIED') {
      return res.status(409).json({
        message: 'This arrear has already been paid out and cannot be cancelled',
      });
    }

    const updated = await (prisma as any).salaryArrear.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** Human-readable period label, e.g. "Apr 2026 – Jul 2026". */
export function arrearPeriodLabel(a: {
  fromMonth: number; fromYear: number; toMonth: number; toYear: number;
}): string {
  const from = `${MONTHS[a.fromMonth]} ${a.fromYear}`;
  const to = `${MONTHS[a.toMonth]} ${a.toYear}`;
  return from === to ? from : `${from} – ${to}`;
}
