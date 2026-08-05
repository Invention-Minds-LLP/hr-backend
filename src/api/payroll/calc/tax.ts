// ─────────────────────────────────────────────────────────────────────────────
//  Income-tax computation engine.
//
//  Pure functions only — no Prisma, no Express, no I/O. Everything the engine
//  needs arrives in the input object. That keeps it unit-testable without a
//  database and means the same code serves three callers that must agree:
//
//    • the monthly payroll run   (projected TDS for this month)
//    • the employee's projection screen (old vs new comparison)
//    • Form 16 at year end       (actuals, not projections)
//
//  All rates and slabs come from taxSlabs.ts — nothing is hardcoded here.
// ─────────────────────────────────────────────────────────────────────────────

import {
  RegimeRules,
  resolveTaxYear,
  fyMonthIndex,
} from './taxSlabs';

export type Regime = 'OLD' | 'NEW';

/** Statutory caps on Chapter VI-A deductions (old regime only). */
export const SECTION_CAPS: Record<string, number> = {
  '80C': 1_50_000,
  '80CCC': 1_50_000,
  '80CCD1': 1_50_000, // shares the 80C ceiling — handled in aggregation below
  '80CCD1B': 50_000, // additional NPS, over and above 80C
  '80D': 1_00_000, // self+parents, senior-citizen maximum
  '80DD': 1_25_000,
  '80DDB': 1_00_000,
  '80E': Number.MAX_SAFE_INTEGER, // education loan interest — uncapped
  '80EEA': 1_50_000,
  '80G': Number.MAX_SAFE_INTEGER, // donation limits depend on the donee
  '80GG': 60_000,
  '80TTA': 10_000,
  '80TTB': 50_000,
  '80U': 1_25_000,
  '24B': 2_00_000, // home-loan interest on self-occupied property
};

/** Sections that jointly share the single 80C ceiling of 1.5L. */
const EIGHTY_C_GROUP = ['80C', '80CCC', '80CCD1'];

/** Max set-off of house-property loss against salary income, per year. */
const HOUSE_PROPERTY_LOSS_CAP = 2_00_000;

export interface DeclaredDeduction {
  section: string;
  amount: number;
}

export interface TaxInput {
  financialYear: string;
  regime: Regime;

  /** Annual gross salary from this employer (earnings, before any deduction). */
  annualGrossSalary: number;

  /** Salary and TDS from a previous employer in the same FY. */
  previousEmployerIncome?: number;
  previousEmployerTds?: number;

  /** Non-salary income declared by the employee (bank interest etc.). */
  otherIncome?: number;

  /** Positive number. Set off against salary, capped at 2L. Old regime only. */
  housePropertyLoss?: number;

  /** Chapter VI-A declarations. Ignored entirely under the new regime. */
  deductions?: DeclaredDeduction[];

  /** HRA exemption inputs. Old regime only. */
  hra?: {
    annualBasic: number;
    annualHraReceived: number;
    annualRentPaid: number;
    metroCity: boolean;
  };

  /** Employee PF is an 80C investment; passed separately so it is never missed. */
  annualEmployeePf?: number;

  /** Professional tax paid is deductible from salary income (old regime). */
  annualProfessionalTax?: number;

  /** Age drives the old-regime basic exemption band. */
  age?: number;
}

export interface TaxBreakdown {
  regime: Regime;
  financialYear: string;

  grossSalary: number;
  previousEmployerIncome: number;
  otherIncome: number;
  hraExemption: number;
  professionalTaxDeduction: number;
  standardDeduction: number;
  housePropertyLoss: number;
  chapterViaDeductions: number;
  chapterViaBreakup: Record<string, number>;

  taxableIncome: number;
  taxBeforeRebate: number;
  rebate87A: number;
  taxAfterRebate: number;
  surcharge: number;
  cess: number;
  totalTaxLiability: number;

  previousEmployerTds: number;
  /** Liability net of TDS already deducted elsewhere. Never negative. */
  netTaxPayable: number;
}

const round0 = (n: number) => Math.round(n);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Coerce an optional/negative/NaN value to a usable non-negative number.
 *  Most TaxInput fields are optional, so this is the single guard for them. */
const positive = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;

/**
 * HRA exemption = least of:
 *   (a) actual HRA received
 *   (b) rent paid − 10% of basic
 *   (c) 50% of basic (metro) or 40% (non-metro)
 * Returns 0 when no rent is declared.
 */
export function computeHraExemption(input: {
  annualBasic: number;
  annualHraReceived: number;
  annualRentPaid: number;
  metroCity: boolean;
}): number {
  const basic = positive(input.annualBasic);
  const received = positive(input.annualHraReceived);
  const rent = positive(input.annualRentPaid);
  if (rent <= 0 || received <= 0) return 0;

  const rentOverTenPct = rent - 0.1 * basic;
  const cityLimit = (input.metroCity ? 0.5 : 0.4) * basic;

  return round0(Math.max(0, Math.min(received, rentOverTenPct, cityLimit)));
}

/**
 * Apply per-section statutory caps, then the shared 80C group ceiling.
 * Returns the total plus a per-section breakup for the projection screen.
 */
export function applyChapterViaCaps(deductions: DeclaredDeduction[]): {
  total: number;
  breakup: Record<string, number>;
} {
  // 1. Sum declarations by section.
  const bySection: Record<string, number> = {};
  for (const d of deductions) {
    const section = String(d.section || '').toUpperCase().trim();
    if (!section) continue;
    bySection[section] = (bySection[section] || 0) + positive(d.amount);
  }

  // 2. Cap each section individually.
  const capped: Record<string, number> = {};
  for (const [section, amount] of Object.entries(bySection)) {
    const cap = SECTION_CAPS[section] ?? Number.MAX_SAFE_INTEGER;
    capped[section] = Math.min(amount, cap);
  }

  // 3. 80C / 80CCC / 80CCD(1) share one 1.5L ceiling. Trim proportionally from
  //    the group rather than dropping whichever section happened to be last.
  const groupTotal = EIGHTY_C_GROUP.reduce((s, k) => s + (capped[k] || 0), 0);
  const groupCap = SECTION_CAPS['80C'];
  if (groupTotal > groupCap && groupTotal > 0) {
    const factor = groupCap / groupTotal;
    for (const k of EIGHTY_C_GROUP) {
      if (capped[k]) capped[k] = round0(capped[k] * factor);
    }
  }

  const total = Object.values(capped).reduce((s, v) => s + v, 0);
  return { total: round0(total), breakup: capped };
}

/** Slab tax on a taxable income, using the marginal bands for the regime. */
export function taxOnSlabs(taxableIncome: number, rules: RegimeRules, basicExemption?: number): number {
  let income = positive(taxableIncome);
  if (income <= 0) return 0;

  let tax = 0;
  let lower = 0;

  for (const slab of rules.slabs) {
    // The old regime raises the 0% band for senior citizens. Stretch the first
    // slab rather than rewriting the whole table.
    let upper = slab.upTo;
    if (basicExemption != null && slab.rate === 0 && upper != null && basicExemption > upper) {
      upper = basicExemption;
    }

    if (upper == null) {
      tax += (income - lower) * (slab.rate / 100);
      break;
    }
    if (income > upper) {
      tax += (upper - lower) * (slab.rate / 100);
      lower = upper;
    } else {
      tax += (income - lower) * (slab.rate / 100);
      break;
    }
  }

  return Math.max(0, tax);
}

/** Surcharge rate for a taxable income, honouring the new-regime cap. */
export function surchargeRateFor(taxableIncome: number, rules: RegimeRules): number {
  let rate = 0;
  for (const band of rules.surchargeBands) {
    if (taxableIncome > band.aboveIncome) rate = band.rate;
  }
  if (rules.surchargeCapRate != null) rate = Math.min(rate, rules.surchargeCapRate);
  return rate;
}

/**
 * Full annual liability under one regime.
 *
 * Note on marginal relief: not applied. It only bites in narrow income bands
 * just above a surcharge threshold. Flagged here rather than silently ignored —
 * add it if a client's population actually crosses 50L.
 */
export function computeAnnualTax(input: TaxInput): TaxBreakdown {
  const fy = resolveTaxYear(input.financialYear);
  const rules: RegimeRules = input.regime === 'OLD' ? fy.old : fy.new;

  const grossSalary = positive(input.annualGrossSalary);
  const prevIncome = positive(input.previousEmployerIncome);
  const otherIncome = positive(input.otherIncome);

  // ── Exemptions (old regime only) ────────────────────────────────────────────
  const hraExemption =
    rules.allowsExemptions && input.hra ? computeHraExemption(input.hra) : 0;

  const ptDeduction = rules.allowsExemptions
    ? positive(input.annualProfessionalTax)
    : 0;

  // ── Salary income after exemptions and standard deduction ───────────────────
  const salaryIncome = Math.max(
    0,
    grossSalary + prevIncome - hraExemption - ptDeduction - rules.standardDeduction,
  );

  // ── House-property loss set-off (old regime only, capped at 2L) ─────────────
  const hpLoss = rules.allowsChapterViA
    ? Math.min(positive(input.housePropertyLoss), HOUSE_PROPERTY_LOSS_CAP)
    : 0;

  // ── Chapter VI-A (old regime only). Employee PF counts under 80C. ───────────
  let chapterVia = 0;
  let chapterViaBreakup: Record<string, number> = {};
  if (rules.allowsChapterViA) {
    const declared: DeclaredDeduction[] = [...(input.deductions || [])];
    if (positive(input.annualEmployeePf) > 0) {
      declared.push({ section: '80C', amount: positive(input.annualEmployeePf) });
    }
    const capped = applyChapterViaCaps(declared);
    chapterVia = capped.total;
    chapterViaBreakup = capped.breakup;
  }

  const grossTotalIncome = salaryIncome + otherIncome;
  const taxableIncome = Math.max(0, round0(grossTotalIncome - hpLoss - chapterVia));

  // ── Slab tax ────────────────────────────────────────────────────────────────
  const age = input.age ?? 0;
  let basicExemption: number | undefined;
  if (rules.allowsChapterViA) {
    if (age >= 80) basicExemption = fy.oldRegimeSuperSeniorExemption;
    else if (age >= 60) basicExemption = fy.oldRegimeSeniorExemption;
  }

  const taxBeforeRebate = taxOnSlabs(taxableIncome, rules, basicExemption);

  // ── 87A rebate ──────────────────────────────────────────────────────────────
  const rebate87A =
    taxableIncome <= rules.rebate87AIncomeLimit
      ? Math.min(taxBeforeRebate, rules.rebate87AMaxAmount)
      : 0;

  const taxAfterRebate = Math.max(0, taxBeforeRebate - rebate87A);

  // ── Surcharge + cess ────────────────────────────────────────────────────────
  const surcharge = taxAfterRebate * (surchargeRateFor(taxableIncome, rules) / 100);
  const cess = (taxAfterRebate + surcharge) * (fy.cessRate / 100);

  const totalTaxLiability = round0(taxAfterRebate + surcharge + cess);
  const prevTds = positive(input.previousEmployerTds);
  const netTaxPayable = Math.max(0, round0(totalTaxLiability - prevTds));

  return {
    regime: input.regime,
    financialYear: fy.financialYear,
    grossSalary: round2(grossSalary),
    previousEmployerIncome: round2(prevIncome),
    otherIncome: round2(otherIncome),
    hraExemption: round2(hraExemption),
    professionalTaxDeduction: round2(ptDeduction),
    standardDeduction: rules.standardDeduction,
    housePropertyLoss: round2(hpLoss),
    chapterViaDeductions: round2(chapterVia),
    chapterViaBreakup,
    taxableIncome: round2(taxableIncome),
    taxBeforeRebate: round2(taxBeforeRebate),
    rebate87A: round2(rebate87A),
    taxAfterRebate: round2(taxAfterRebate),
    surcharge: round2(surcharge),
    cess: round2(cess),
    totalTaxLiability,
    previousEmployerTds: round2(prevTds),
    netTaxPayable,
  };
}

export interface RegimeComparison {
  old: TaxBreakdown;
  new: TaxBreakdown;
  recommended: Regime;
  saving: number;
}

/** Run both regimes off one input so the employee can compare side by side. */
export function compareRegimes(input: Omit<TaxInput, 'regime'>): RegimeComparison {
  const oldTax = computeAnnualTax({ ...input, regime: 'OLD' });
  const newTax = computeAnnualTax({ ...input, regime: 'NEW' });

  const recommended: Regime =
    newTax.totalTaxLiability <= oldTax.totalTaxLiability ? 'NEW' : 'OLD';

  return {
    old: oldTax,
    new: newTax,
    recommended,
    saving: Math.abs(oldTax.totalTaxLiability - newTax.totalTaxLiability),
  };
}

export interface MonthlyTdsInput extends TaxInput {
  /** Calendar month being processed (1–12). */
  month: number;
  /** TDS already deducted by THIS employer earlier in the same FY. */
  tdsDeductedSoFar?: number;
}

export interface MonthlyTdsResult {
  monthlyTds: number;
  annual: TaxBreakdown;
  remainingMonths: number;
  tdsDeductedSoFar: number;
  /** Liability still to be recovered across the remaining months. */
  balanceToRecover: number;
}

/**
 * TDS for one month = (annual liability − TDS already deducted) spread over the
 * months left in the financial year, current month included.
 *
 * Spreading over the *remainder* rather than a flat 1/12 is what makes a
 * mid-year joiner, a salary revision, or a late declaration self-correct: the
 * shortfall is recovered across the months that are left instead of producing a
 * March cliff.
 */
export function computeMonthlyTds(input: MonthlyTdsInput): MonthlyTdsResult {
  const annual = computeAnnualTax(input);
  const deductedSoFar = positive(input.tdsDeductedSoFar);

  // April = index 0 → 12 months remaining. March = index 11 → 1 remaining.
  const remainingMonths = Math.max(1, 12 - fyMonthIndex(input.month));

  const balanceToRecover = Math.max(0, annual.netTaxPayable - deductedSoFar);
  const monthlyTds = round2(balanceToRecover / remainingMonths);

  return {
    monthlyTds,
    annual,
    remainingMonths,
    tdsDeductedSoFar: round2(deductedSoFar),
    balanceToRecover: round2(balanceToRecover),
  };
}
