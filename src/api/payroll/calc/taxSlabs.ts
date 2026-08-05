// ─────────────────────────────────────────────────────────────────────────────
//  Income-tax slab data, keyed by financial year.
//
//  ⚠️  RATES MUST BE VERIFIED AGAINST THE CURRENT FINANCE ACT BEFORE GO-LIVE.
//      Slabs, the standard deduction and the 87A rebate threshold are changed
//      by the Union Budget most years. They are isolated in this one file so a
//      change is a single edit here — nothing else in the tax engine hardcodes
//      a rate.
//
//      To add a new financial year: copy the most recent entry, adjust, and add
//      it to FY_TAX_DATA. `resolveTaxYear()` falls back to the newest entry that
//      is <= the requested FY, so an un-added future year keeps computing on the
//      last known rules rather than throwing mid-payroll.
// ─────────────────────────────────────────────────────────────────────────────

export interface TaxSlab {
  /** Upper bound of this slab, inclusive. null = open-ended top slab. */
  upTo: number | null;
  /** Marginal rate applied to the portion of income falling in this slab. */
  rate: number;
}

export interface SurchargeBand {
  aboveIncome: number;
  rate: number;
}

export interface RegimeRules {
  slabs: TaxSlab[];
  standardDeduction: number;
  /** Taxable income at or below this gets the 87A rebate. */
  rebate87AIncomeLimit: number;
  /** Maximum rebate amount under 87A. */
  rebate87AMaxAmount: number;
  surchargeBands: SurchargeBand[];
  /** Surcharge is capped at this rate regardless of band (new regime cap). */
  surchargeCapRate: number | null;
  /** Chapter VI-A deductions (80C etc.) are only allowed in the old regime. */
  allowsChapterViA: boolean;
  /** HRA / LTA exemptions are only allowed in the old regime. */
  allowsExemptions: boolean;
}

export interface FinancialYearTaxData {
  financialYear: string;
  cessRate: number;
  old: RegimeRules;
  new: RegimeRules;
  /** Old-regime basic exemption is age-banded; new regime is not. */
  oldRegimeSeniorExemption: number;
  oldRegimeSuperSeniorExemption: number;
}

const COMMON_SURCHARGE_BANDS: SurchargeBand[] = [
  { aboveIncome: 50_00_000, rate: 10 },
  { aboveIncome: 1_00_00_000, rate: 15 },
  { aboveIncome: 2_00_00_000, rate: 25 },
  { aboveIncome: 5_00_00_000, rate: 37 },
];

const FY_2025_26: FinancialYearTaxData = {
  financialYear: '2025-26',
  cessRate: 4,
  oldRegimeSeniorExemption: 3_00_000,
  oldRegimeSuperSeniorExemption: 5_00_000,

  old: {
    slabs: [
      { upTo: 2_50_000, rate: 0 },
      { upTo: 5_00_000, rate: 5 },
      { upTo: 10_00_000, rate: 20 },
      { upTo: null, rate: 30 },
    ],
    standardDeduction: 50_000,
    rebate87AIncomeLimit: 5_00_000,
    rebate87AMaxAmount: 12_500,
    surchargeBands: COMMON_SURCHARGE_BANDS,
    surchargeCapRate: null,
    allowsChapterViA: true,
    allowsExemptions: true,
  },

  new: {
    slabs: [
      { upTo: 4_00_000, rate: 0 },
      { upTo: 8_00_000, rate: 5 },
      { upTo: 12_00_000, rate: 10 },
      { upTo: 16_00_000, rate: 15 },
      { upTo: 20_00_000, rate: 20 },
      { upTo: 24_00_000, rate: 25 },
      { upTo: null, rate: 30 },
    ],
    standardDeduction: 75_000,
    rebate87AIncomeLimit: 12_00_000,
    rebate87AMaxAmount: 60_000,
    surchargeBands: COMMON_SURCHARGE_BANDS,
    // New regime caps surcharge at 25% — the 37% band does not apply.
    surchargeCapRate: 25,
    allowsChapterViA: false,
    allowsExemptions: false,
  },
};

// FY 2026-27 carries forward FY 2025-26 rules until the finance team confirms
// the current Finance Act. Overriding a value here is the only change needed
// once confirmed.
const FY_2026_27: FinancialYearTaxData = {
  ...FY_2025_26,
  financialYear: '2026-27',
};

/** Newest last — resolveTaxYear() scans backwards. */
export const FY_TAX_DATA: FinancialYearTaxData[] = [FY_2025_26, FY_2026_27];

/** "2026-27" → 2026. Returns NaN for a malformed label. */
export function fyStartYear(financialYear: string): number {
  return parseInt(String(financialYear).slice(0, 4), 10);
}

/**
 * Financial year label for a given calendar month/year.
 * Indian FY runs April–March, so Jan–Mar belong to the previous start year.
 */
export function financialYearFor(month: number, year: number): string {
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Index (0–11) of a calendar month within the financial year. April = 0. */
export function fyMonthIndex(month: number): number {
  return (month - 4 + 12) % 12;
}

/**
 * Rules for a financial year. Falls back to the newest entry not later than the
 * requested year, so an unrecognised future FY keeps working on the last known
 * rules instead of throwing in the middle of a payroll run.
 */
export function resolveTaxYear(financialYear: string): FinancialYearTaxData {
  const want = fyStartYear(financialYear);
  if (Number.isNaN(want)) return FY_TAX_DATA[FY_TAX_DATA.length - 1];

  let best = FY_TAX_DATA[0];
  for (const entry of FY_TAX_DATA) {
    const start = fyStartYear(entry.financialYear);
    if (start <= want && start >= fyStartYear(best.financialYear)) best = entry;
  }
  return best;
}
