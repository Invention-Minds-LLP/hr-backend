// ─────────────────────────────────────────────────────────────────────────────
//  Statutory computation — PF, ESI, PT, LWF, gratuity, bonus, leave encashment.
//
//  Pure functions. Every rate arrives via a StatutoryConfig-shaped object, so
//  changing a slab is a DB edit, not a deploy. This replaces the hardcoded
//  rates that used to sit inline in payroll.controller.ts.
//
//  Deductions vs provisions — the distinction matters and is easy to get wrong:
//    • DEDUCTION  reduces the employee's net pay (PF employee, ESI employee,
//                 PT, LWF employee, TDS).
//    • PROVISION  is an employer cost accrued for the books (gratuity, bonus,
//                 leave encashment, PF employer, admin charges, EDLI). It never
//                 touches net pay.
// ─────────────────────────────────────────────────────────────────────────────

export interface StatutoryRates {
  pfEnabled: boolean;
  pfEmployeeRate: number;
  pfEmployerRate: number;
  pfWageCeiling: number;
  pfCapAtCeiling: boolean;
  pfAdminChargeRate: number;
  edliRate: number;
  epsRate: number;

  esiEnabled: boolean;
  esiEmployeeRate: number;
  esiEmployerRate: number;
  esiWageLimit: number;

  ptEnabled: boolean;
  ptState?: string | null;
  ptSlabs?: unknown;

  lwfEnabled: boolean;
  lwfEmployeeAmount: number;
  lwfEmployerAmount: number;
  lwfFrequency: string;
  lwfDeductionMonths?: unknown;

  gratuityEnabled: boolean;
  gratuityRate: number;

  bonusEnabled: boolean;
  bonusRate: number;
  bonusEligibilityWage: number;
  bonusCalculationCap: number;

  leaveEncashEnabled: boolean;
  leaveEncashDaysYear: number;
}

export interface PtSlab {
  upTo: number | null;
  amount: number;
  /** Maharashtra-style February differential. Optional. */
  februaryAmount?: number;
}

/** Applied when a company has no ptSlabs configured. Matches the previous
 *  hardcoded behaviour in payroll.controller.ts so nothing changes silently. */
export const DEFAULT_PT_SLABS: PtSlab[] = [
  { upTo: 15000, amount: 0 },
  { upTo: 20000, amount: 150 },
  { upTo: null, amount: 200 },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const positive = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Employee-level switches from SalaryStructure — an employee can be exempt
 *  even when the company has the component enabled. */
export interface EmployeeStatutoryFlags {
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptApplicable: boolean;
}

export interface StatutoryInput {
  rates: StatutoryRates;
  flags: EmployeeStatutoryFlags;
  /** Earned basic for the month (already prorated for LOP). */
  earnedBasic: number;
  /** Earned gross for the month (already prorated for LOP). */
  earnedGross: number;
  /** Full-month gross before proration — ESI/bonus eligibility tests use this. */
  fullMonthGross: number;
  /** Full-month basic before proration — bonus eligibility uses this. */
  fullMonthBasic: number;
  /** Calendar month 1–12, for LWF frequency and the PT February differential. */
  month: number;
}

export interface StatutoryResult {
  pfWage: number;
  pfEmployee: number;
  pfEmployer: number;
  epsEmployer: number;
  pfAdminCharges: number;
  edliCharges: number;

  esiEmployee: number;
  esiEmployer: number;

  professionalTax: number;

  lwfEmployee: number;
  lwfEmployer: number;

  gratuityProvision: number;
  bonusProvision: number;
  leaveEncashProvision: number;

  /** Sum of the components that reduce net pay. Excludes TDS — the caller adds
   *  that, because TDS depends on the tax engine, not on this module. */
  totalEmployeeDeductions: number;
  /** Sum of employer-side cost. Never touches net pay. */
  totalEmployerCost: number;
}

/** PF wage = earned basic, optionally restricted to the statutory ceiling. */
export function pfWageFor(earnedBasic: number, rates: StatutoryRates): number {
  const basic = positive(earnedBasic);
  return rates.pfCapAtCeiling ? Math.min(basic, positive(rates.pfWageCeiling)) : basic;
}

/** Professional tax for a month, from the configured slabs. */
export function professionalTaxFor(
  monthlyGross: number,
  slabs: PtSlab[] | null | undefined,
  month: number,
): number {
  const table = Array.isArray(slabs) && slabs.length ? slabs : DEFAULT_PT_SLABS;
  const gross = positive(monthlyGross);

  for (const slab of table) {
    if (slab.upTo == null || gross < slab.upTo) {
      // February differential, where the state levies a higher final instalment.
      if (month === 2 && typeof slab.februaryAmount === 'number') {
        return positive(slab.februaryAmount);
      }
      return positive(slab.amount);
    }
  }
  return 0;
}

/**
 * Is LWF collected in this month?
 * MONTHLY  → every month.
 * Otherwise → only in the configured collection months. If none are configured
 * we fall back to June/December (half-yearly) or December (yearly) rather than
 * silently deducting nothing.
 */
export function isLwfMonth(
  month: number,
  frequency: string,
  configuredMonths: unknown,
): boolean {
  const freq = String(frequency || 'MONTHLY').toUpperCase();
  if (freq === 'MONTHLY') return true;

  const months = Array.isArray(configuredMonths)
    ? (configuredMonths as unknown[]).map((m) => Number(m)).filter((m) => m >= 1 && m <= 12)
    : [];

  if (months.length) return months.includes(month);
  if (freq === 'HALF_YEARLY') return month === 6 || month === 12;
  if (freq === 'YEARLY') return month === 12;
  return false;
}

/** All statutory components for one employee for one month. */
export function computeStatutory(input: StatutoryInput): StatutoryResult {
  const { rates, flags, month } = input;

  const earnedBasic = positive(input.earnedBasic);
  const earnedGross = positive(input.earnedGross);
  const fullMonthGross = positive(input.fullMonthGross);
  const fullMonthBasic = positive(input.fullMonthBasic);

  // ── Provident Fund ──────────────────────────────────────────────────────────
  const pfOn = rates.pfEnabled && flags.pfApplicable;
  const pfWage = pfOn ? pfWageFor(earnedBasic, rates) : 0;

  const pfEmployee = pfOn ? round2(pfWage * (rates.pfEmployeeRate / 100)) : 0;
  const pfEmployerTotal = pfOn ? round2(pfWage * (rates.pfEmployerRate / 100)) : 0;

  // The employer 12% splits: 8.33% to the pension fund, but only on wage up to
  // the ceiling; the balance stays in PF. Needed for the ECR file.
  const epsWage = Math.min(pfWage, positive(rates.pfWageCeiling));
  const epsEmployer = pfOn ? round2(epsWage * (rates.epsRate / 100)) : 0;
  const pfEmployer = round2(Math.max(0, pfEmployerTotal - epsEmployer));

  const pfAdminCharges = pfOn ? round2(pfWage * (rates.pfAdminChargeRate / 100)) : 0;
  const edliCharges = pfOn ? round2(epsWage * (rates.edliRate / 100)) : 0;

  // ── ESI ─────────────────────────────────────────────────────────────────────
  // Eligibility is tested on the full-month gross: an employee who dips below
  // the limit only because of unpaid leave does not become ESI-eligible.
  const esiOn =
    rates.esiEnabled && flags.esiApplicable && fullMonthGross <= positive(rates.esiWageLimit);

  const esiEmployee = esiOn ? round2(earnedGross * (rates.esiEmployeeRate / 100)) : 0;
  const esiEmployer = esiOn ? round2(earnedGross * (rates.esiEmployerRate / 100)) : 0;

  // ── Professional Tax ────────────────────────────────────────────────────────
  const professionalTax =
    rates.ptEnabled && flags.ptApplicable
      ? professionalTaxFor(earnedGross, rates.ptSlabs as PtSlab[] | null, month)
      : 0;

  // ── Labour Welfare Fund ─────────────────────────────────────────────────────
  const lwfDue =
    rates.lwfEnabled && isLwfMonth(month, rates.lwfFrequency, rates.lwfDeductionMonths);
  const lwfEmployee = lwfDue ? round2(positive(rates.lwfEmployeeAmount)) : 0;
  const lwfEmployer = lwfDue ? round2(positive(rates.lwfEmployerAmount)) : 0;

  // ── Employer provisions (not deductions) ────────────────────────────────────
  const gratuityProvision = rates.gratuityEnabled
    ? round2(earnedBasic * (rates.gratuityRate / 100))
    : 0;

  // Statutory bonus: eligible if full-month wage is within the eligibility
  // limit; computed on the lower of actual wage and the calculation cap.
  let bonusProvision = 0;
  if (rates.bonusEnabled && fullMonthBasic <= positive(rates.bonusEligibilityWage)) {
    const bonusWage = Math.min(earnedBasic, positive(rates.bonusCalculationCap));
    bonusProvision = round2(bonusWage * (rates.bonusRate / 100));
  }

  // Leave encashment accrual: (days per year / 12) valued at a day of basic.
  let leaveEncashProvision = 0;
  if (rates.leaveEncashEnabled && positive(rates.leaveEncashDaysYear) > 0) {
    const perDayBasic = fullMonthBasic / 30;
    leaveEncashProvision = round2((positive(rates.leaveEncashDaysYear) / 12) * perDayBasic);
  }

  const totalEmployeeDeductions = round2(
    pfEmployee + esiEmployee + professionalTax + lwfEmployee,
  );

  const totalEmployerCost = round2(
    pfEmployer +
      epsEmployer +
      pfAdminCharges +
      edliCharges +
      esiEmployer +
      lwfEmployer +
      gratuityProvision +
      bonusProvision +
      leaveEncashProvision,
  );

  return {
    pfWage: round2(pfWage),
    pfEmployee,
    pfEmployer,
    epsEmployer,
    pfAdminCharges,
    edliCharges,
    esiEmployee,
    esiEmployer,
    professionalTax,
    lwfEmployee,
    lwfEmployer,
    gratuityProvision,
    bonusProvision,
    leaveEncashProvision,
    totalEmployeeDeductions,
    totalEmployerCost,
  };
}

/** Fallback rates matching the pre-Phase-1 hardcoded behaviour. Used when a
 *  company has no StatutoryConfig row yet, so payroll never hard-fails on a
 *  missing config — it just reproduces what the system did before. */
export const LEGACY_DEFAULT_RATES: StatutoryRates = {
  pfEnabled: true,
  pfEmployeeRate: 12,
  pfEmployerRate: 12,
  pfWageCeiling: 15000,
  pfCapAtCeiling: false,
  pfAdminChargeRate: 0.5,
  edliRate: 0.5,
  epsRate: 8.33,

  esiEnabled: true,
  esiEmployeeRate: 0.75,
  esiEmployerRate: 3.25,
  esiWageLimit: 21000,

  ptEnabled: true,
  ptState: null,
  ptSlabs: null,

  // Off by default — a company must opt in with its state's amounts, otherwise
  // we would start deducting money nobody configured.
  lwfEnabled: false,
  lwfEmployeeAmount: 0,
  lwfEmployerAmount: 0,
  lwfFrequency: 'MONTHLY',
  lwfDeductionMonths: null,

  gratuityEnabled: true,
  gratuityRate: 4.81,

  bonusEnabled: true,
  bonusRate: 8.33,
  bonusEligibilityWage: 21000,
  bonusCalculationCap: 7000,

  leaveEncashEnabled: false,
  leaveEncashDaysYear: 0,
};
