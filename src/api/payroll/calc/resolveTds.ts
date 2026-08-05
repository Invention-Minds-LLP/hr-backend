// ─────────────────────────────────────────────────────────────────────────────
//  Turns an employee's stored tax situation into a TDS figure for one month.
//
//  The projection deliberately mixes actuals and estimates:
//    • months already paid in this FY  → actual payslip gross and actual TDS
//    • the current + remaining months  → projected from the salary structure
//
//  Using actuals for elapsed months is what makes the figure self-correcting.
//  A mid-year revision, a bonus month, or a declaration approved in December
//  changes the annual estimate, and the shortfall is recovered over the months
//  that remain rather than landing entirely in March.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../../../lib/prisma';
import {
  computeMonthlyTds,
  compareRegimes,
  DeclaredDeduction,
  MonthlyTdsResult,
  Regime,
  RegimeComparison,
} from './tax';
import { financialYearFor, fyMonthIndex } from './taxSlabs';

export interface TaxContext {
  employeeId: number;
  financialYear: string;
  regime: Regime;
  autoComputeTds: boolean;
  annualGrossSalary: number;
  annualBasic: number;
  annualHra: number;
  annualEmployeePf: number;
  annualProfessionalTax: number;
  tdsDeductedSoFar: number;
  deductions: DeclaredDeduction[];
  rentPaidAnnual: number;
  metroCity: boolean;
  previousEmployerIncome: number;
  previousEmployerTds: number;
  otherIncome: number;
  housePropertyLoss: number;
  age: number;
}

function ageFrom(dob?: Date | null): number {
  if (!dob) return 0;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

/**
 * Assemble everything the tax engine needs for one employee in one FY.
 *
 * `month`/`year` identify the payroll month being processed; months strictly
 * before it in the same FY are treated as actuals.
 */
export async function buildTaxContext(
  employeeId: number,
  month: number,
  year: number,
): Promise<TaxContext | null> {
  const financialYear = financialYearFor(month, year);

  const [sal, employee, profile, declaration] = await Promise.all([
    (prisma as any).salaryStructure.findUnique({ where: { employeeId } }),
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { dob: true },
    }),
    (prisma as any).employeeTaxProfile.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
    }),
    (prisma as any).taxDeclaration.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
      include: { items: true },
    }),
  ]);

  if (!sal) return null;

  const monthlyGross =
    sal.basic + sal.hra + sal.medicalAllowance + sal.travelAllowance +
    sal.specialAllowance + sal.otherAllowances;

  // ── Actuals for FY months already processed ─────────────────────────────────
  // The FY spans two calendar years: Apr–Dec of the start year, Jan–Mar of the
  // next. Fetch both halves and keep the ones before the current payroll month.
  const fyStart = month >= 4 ? year : year - 1;
  const paidSlips = await (prisma as any).payslip.findMany({
    where: {
      employeeId,
      OR: [
        { year: fyStart, month: { gte: 4 } },
        { year: fyStart + 1, month: { lte: 3 } },
      ],
    },
    select: {
      month: true, year: true, grossEarnings: true, overtimePay: true,
      tds: true, pfEmployee: true, professionalTax: true,
      variableIncentive: true, salaryRevisionArrear: true, otherAddition: true,
    },
  });

  const currentIndex = fyMonthIndex(month);
  const elapsed = paidSlips.filter((p: any) => fyMonthIndex(p.month) < currentIndex);

  let actualGross = 0;
  let actualTds = 0;
  let actualPf = 0;
  let actualPt = 0;
  for (const p of elapsed) {
    actualGross +=
      (p.grossEarnings || 0) + (p.overtimePay || 0) + (p.variableIncentive || 0) +
      (p.salaryRevisionArrear || 0) + (p.otherAddition || 0);
    actualTds += p.tds || 0;
    actualPf += p.pfEmployee || 0;
    actualPt += p.professionalTax || 0;
  }

  // ── Projection for the current + remaining months ───────────────────────────
  const remainingMonths = 12 - currentIndex; // includes the current month
  const projectedGross = monthlyGross * remainingMonths;
  const projectedPf = (sal.pfApplicable ? sal.basic * 0.12 : 0) * remainingMonths;

  // ── Approved declarations (fall back to declared before HR review) ──────────
  const deductions: DeclaredDeduction[] = [];
  if (declaration?.items?.length) {
    const reviewed = declaration.status === 'APPROVED' ||
                     declaration.status === 'PARTIALLY_APPROVED';
    for (const item of declaration.items) {
      const amount = reviewed ? item.approvedAmount : item.declaredAmount;
      if (amount > 0) deductions.push({ section: item.section, amount });
    }
  }

  return {
    employeeId,
    financialYear,
    regime: (profile?.regime as Regime) || 'NEW',
    autoComputeTds: profile ? profile.autoComputeTds !== false : true,
    annualGrossSalary: actualGross + projectedGross,
    annualBasic: sal.basic * 12,
    annualHra: sal.hra * 12,
    annualEmployeePf: actualPf + projectedPf,
    // PT for the remaining months is not yet known; the elapsed actual is a
    // close enough basis and is the conservative direction (understates the
    // deduction slightly rather than overstating it).
    annualProfessionalTax: actualPt,
    tdsDeductedSoFar: actualTds,
    deductions,
    rentPaidAnnual: profile?.rentPaidAnnual || 0,
    metroCity: profile?.metroCity || false,
    previousEmployerIncome: profile?.previousEmployerIncome || 0,
    previousEmployerTds: profile?.previousEmployerTds || 0,
    otherIncome: profile?.otherIncome || 0,
    housePropertyLoss: profile?.housePropertyLoss || 0,
    age: ageFrom(employee?.dob),
  };
}

/** Map a context onto the tax engine's input shape. */
function toTaxInput(ctx: TaxContext) {
  return {
    financialYear: ctx.financialYear,
    annualGrossSalary: ctx.annualGrossSalary,
    previousEmployerIncome: ctx.previousEmployerIncome,
    previousEmployerTds: ctx.previousEmployerTds,
    otherIncome: ctx.otherIncome,
    housePropertyLoss: ctx.housePropertyLoss,
    deductions: ctx.deductions,
    annualEmployeePf: ctx.annualEmployeePf,
    annualProfessionalTax: ctx.annualProfessionalTax,
    age: ctx.age,
    hra: {
      annualBasic: ctx.annualBasic,
      annualHraReceived: ctx.annualHra,
      annualRentPaid: ctx.rentPaidAnnual,
      metroCity: ctx.metroCity,
    },
  };
}

export interface ResolvedTds {
  tds: number;
  mode: 'AUTO' | 'MANUAL';
  regime: Regime;
  financialYear: string;
  detail: MonthlyTdsResult | null;
}

/**
 * TDS for one employee for one month.
 *
 * Returns MANUAL (SalaryStructure.tdsMonthly, unchanged) when the employee has
 * opted out of auto-computation or has no salary structure — so switching a
 * client onto the engine is opt-in per employee, not a big-bang cutover.
 */
export async function resolveMonthlyTds(
  employeeId: number,
  month: number,
  year: number,
  fallbackTds: number,
): Promise<ResolvedTds> {
  const ctx = await buildTaxContext(employeeId, month, year);

  if (!ctx || !ctx.autoComputeTds) {
    return {
      tds: fallbackTds || 0,
      mode: 'MANUAL',
      regime: ctx?.regime || 'NEW',
      financialYear: ctx?.financialYear || financialYearFor(month, year),
      detail: null,
    };
  }

  const detail = computeMonthlyTds({
    ...toTaxInput(ctx),
    regime: ctx.regime,
    month,
    tdsDeductedSoFar: ctx.tdsDeductedSoFar,
  });

  return {
    tds: detail.monthlyTds,
    mode: 'AUTO',
    regime: ctx.regime,
    financialYear: ctx.financialYear,
    detail,
  };
}

/** Old-vs-new comparison for the employee-facing projection screen. */
export async function projectRegimeComparison(
  employeeId: number,
  month: number,
  year: number,
): Promise<{ context: TaxContext; comparison: RegimeComparison } | null> {
  const ctx = await buildTaxContext(employeeId, month, year);
  if (!ctx) return null;
  return { context: ctx, comparison: compareRegimes(toTaxInput(ctx)) };
}
