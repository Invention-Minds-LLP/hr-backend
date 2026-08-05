// ─────────────────────────────────────────────────────────────────────────────
//  Salary structure templates — percentage split of monthly gross.
//
//  Pure functions, no Prisma. Three ways in, one way out:
//
//    GROSS → components          direct multiply
//    CTC   → gross → components  closed-form algebra, exact
//    NET   → gross → components  bisection, because net(gross) has slab cliffs
//
//  ── Why rounding needs a balancing component ────────────────────────────────
//  Take gross 45,001 split 50/20/5/5/20. Rounded independently the parts come
//  to 45,000.99 — a paisa short. Do that across 250 employees every month and
//  the payroll register stops tying out to the bank file. So one component is
//  nominated to absorb the remainder: it receives gross minus the sum of every
//  other rounded component. The parts then always re-add to the whole exactly.
//
//  ── Why NET cannot always be hit exactly ────────────────────────────────────
//  net(gross) = gross − PF(basic) − ESI(gross) − PT(gross) [− TDS].
//  ESI switches off entirely above the wage limit and PT moves in steps, so
//  net(gross) is a step function with jumps. Around a jump there is a band of
//  net values no gross produces. The solver returns the closest achievable
//  figure and reports the variance rather than silently rounding — a payroll
//  system that quietly misses the number it was asked for is worse than one
//  that says it cannot.
// ─────────────────────────────────────────────────────────────────────────────

import { StatutoryRates, professionalTaxFor, pfWageFor, PtSlab } from './statutory';

/** SalaryStructure columns a template may drive. */
export const PERCENTAGE_KEYS = [
  'basic', 'hra', 'medicalAllowance', 'travelAllowance', 'specialAllowance', 'otherAllowances',
] as const;

export const FIXED_KEYS = ['lta', 'mobileInternet', 'mealFuel'] as const;

export type PercentageKey = typeof PERCENTAGE_KEYS[number];
export type FixedKey = typeof FIXED_KEYS[number];

export interface TemplateComponent {
  key: string;
  label?: string;
  percentage: number;
  isFixed: boolean;
  fixedAmount: number;
  isBalancing: boolean;
  orderNo?: number;
}

export interface TemplateLike {
  components: TemplateComponent[];
  pfApplicable?: boolean;
  esiApplicable?: boolean;
  ptApplicable?: boolean;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const positive = (n: unknown) =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;

// ─── validation ──────────────────────────────────────────────────────────────

export interface TemplateValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalPercentage: number;
  totalFixed: number;
}

/**
 * A template is only usable if its percentage components total exactly 100 and
 * exactly one of them is the balancing component.
 *
 * The 0.001 tolerance is for float representation only (50.1 + 49.9 is not
 * exactly 100 in binary), not a licence to be approximately right.
 */
export function validateTemplate(components: TemplateComponent[]): TemplateValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const pct = components.filter((c) => !c.isFixed);
  const fixed = components.filter((c) => c.isFixed);

  const totalPercentage = round2(pct.reduce((s, c) => s + positive(c.percentage), 0));
  const totalFixed = round2(fixed.reduce((s, c) => s + positive(c.fixedAmount), 0));

  if (!pct.length) {
    errors.push('Add at least one percentage component — a template of only fixed amounts cannot scale to a gross.');
  }

  if (Math.abs(totalPercentage - 100) > 0.001) {
    errors.push(
      `Percentage components total ${totalPercentage}%, not 100%. ` +
      `${totalPercentage > 100 ? 'Reduce' : 'Increase'} by ${round2(Math.abs(100 - totalPercentage))}%.`,
    );
  }

  const balancing = pct.filter((c) => c.isBalancing);
  if (balancing.length === 0) {
    errors.push('Mark one component as the balancing component — it absorbs rounding so the parts always add up to the gross.');
  } else if (balancing.length > 1) {
    errors.push(`Only one component can be the balancing component; ${balancing.length} are marked.`);
  }

  for (const c of pct) {
    if (c.percentage < 0) errors.push(`${c.key}: percentage cannot be negative.`);
    if (!PERCENTAGE_KEYS.includes(c.key as PercentageKey)) {
      errors.push(`${c.key} is not a valid percentage component.`);
    }
  }
  for (const c of fixed) {
    if (c.fixedAmount < 0) errors.push(`${c.key}: fixed amount cannot be negative.`);
    if (!FIXED_KEYS.includes(c.key as FixedKey)) {
      errors.push(`${c.key} is not a valid fixed component.`);
    }
  }

  const keys = components.map((c) => c.key);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length) errors.push(`Duplicate component(s): ${[...new Set(dupes)].join(', ')}.`);

  const basic = pct.find((c) => c.key === 'basic');
  if (!basic) {
    errors.push('A template must include Basic — PF, gratuity and bonus are all computed on it.');
  } else {
    // Not illegal, but a very low basic is the classic way to under-fund PF and
    // gratuity, and it draws regulatory attention. Warn, do not block.
    if (basic.percentage < 40) {
      warnings.push(
        `Basic is ${basic.percentage}% of gross. Below 40% is often questioned, since PF and gratuity are computed on it.`,
      );
    }
    if (basic.isBalancing) {
      warnings.push('Basic is the balancing component, so it will absorb rounding. Most payrolls balance on Special Allowance instead, to keep Basic a clean percentage.');
    }
  }

  return { valid: errors.length === 0, errors, warnings, totalPercentage, totalFixed };
}

// ─── gross → components ──────────────────────────────────────────────────────

export interface ResolvedComponents {
  basic: number;
  hra: number;
  medicalAllowance: number;
  travelAllowance: number;
  specialAllowance: number;
  otherAllowances: number;
  lta: number;
  mobileInternet: number;
  mealFuel: number;
  /** Sum of the percentage components. Equals the requested gross exactly. */
  monthlyGross: number;
  /** Sum of the fixed add-ons, which sit outside the gross. */
  monthlyFixed: number;
}

const EMPTY: ResolvedComponents = {
  basic: 0, hra: 0, medicalAllowance: 0, travelAllowance: 0,
  specialAllowance: 0, otherAllowances: 0,
  lta: 0, mobileInternet: 0, mealFuel: 0,
  monthlyGross: 0, monthlyFixed: 0,
};

/**
 * Split a gross across the template's components.
 * The balancing component absorbs the rounding remainder, so
 * sum(percentage components) === gross to the paisa.
 */
export function componentsFromGross(
  template: TemplateLike,
  monthlyGross: number,
): ResolvedComponents {
  const gross = positive(monthlyGross);
  const out: ResolvedComponents = { ...EMPTY };

  const pct = template.components.filter((c) => !c.isFixed);
  const fixed = template.components.filter((c) => c.isFixed);

  let allocated = 0;
  let balancingKey: string | null = null;

  for (const c of pct) {
    if (c.isBalancing) { balancingKey = c.key; continue; }
    const value = round2(gross * (positive(c.percentage) / 100));
    (out as any)[c.key] = value;
    allocated = round2(allocated + value);
  }

  if (balancingKey) {
    // Whatever is left, to the paisa. Never negative — a template whose other
    // components exceed 100% would otherwise produce a negative allowance.
    (out as any)[balancingKey] = Math.max(0, round2(gross - allocated));
  }

  for (const c of fixed) {
    const value = round2(positive(c.fixedAmount));
    (out as any)[c.key] = value;
    out.monthlyFixed = round2(out.monthlyFixed + value);
  }

  out.monthlyGross = round2(
    out.basic + out.hra + out.medicalAllowance + out.travelAllowance +
    out.specialAllowance + out.otherAllowances,
  );

  return out;
}

// ─── CTC → gross ─────────────────────────────────────────────────────────────

/**
 * Monthly CTC, using the same definition as the payroll working sheet:
 *   gross + employer PF + the fixed add-ons.
 *
 * Employer PF is a function of basic, which is itself a percentage of gross —
 * so CTC is linear in gross and inverts exactly, with no iteration.
 */
export function ctcFromGross(
  template: TemplateLike,
  monthlyGross: number,
  rates: StatutoryRates,
): number {
  const parts = componentsFromGross(template, monthlyGross);
  const pfEmployer = employerPfOn(parts.basic, template, rates);
  return round2(parts.monthlyGross + pfEmployer + parts.monthlyFixed);
}

function employerPfOn(basic: number, template: TemplateLike, rates: StatutoryRates): number {
  if (!rates.pfEnabled || template.pfApplicable === false) return 0;
  const wage = pfWageFor(basic, rates);
  return round2(wage * (rates.pfEmployerRate / 100));
}

/**
 * Invert CTC to gross.
 *
 * CTC = gross + pfEmployerRate% × (basicPct% × gross) + fixed
 *     = gross × (1 + pfRate × basicPct) + fixed
 * ⇒ gross = (CTC − fixed) / (1 + pfRate × basicPct)
 *
 * Exact — unless the PF wage ceiling binds, in which case employer PF stops
 * scaling with gross and the relationship changes slope. That case is detected
 * and re-solved against the capped constant.
 */
export function grossFromCtc(
  template: TemplateLike,
  monthlyCtc: number,
  rates: StatutoryRates,
): number {
  const ctc = positive(monthlyCtc);

  const fixed = round2(
    template.components.filter((c) => c.isFixed)
      .reduce((s, c) => s + positive(c.fixedAmount), 0),
  );

  const basicPct = positive(
    template.components.find((c) => c.key === 'basic' && !c.isFixed)?.percentage,
  ) / 100;

  const pfOn = rates.pfEnabled && template.pfApplicable !== false;
  const pfRate = pfOn ? rates.pfEmployerRate / 100 : 0;

  // Uncapped: employer PF scales with gross.
  const uncappedGross = round2((ctc - fixed) / (1 + pfRate * basicPct));

  if (!pfOn || !rates.pfCapAtCeiling) return Math.max(0, uncappedGross);

  // Capped: if basic at this gross is above the ceiling, employer PF is a flat
  // amount and gross is simply CTC − fixed − thatFlatAmount.
  const basicAtUncapped = uncappedGross * basicPct;
  if (basicAtUncapped <= rates.pfWageCeiling) return Math.max(0, uncappedGross);

  const cappedPf = round2(rates.pfWageCeiling * pfRate);
  return Math.max(0, round2(ctc - fixed - cappedPf));
}

// ─── NET → gross ─────────────────────────────────────────────────────────────

export interface NetOptions {
  /** Flat monthly TDS to subtract. Structures are usually defined pre-tax, so
   *  this defaults to 0 and the resulting "net" is take-home before income tax. */
  monthlyTds?: number;
  /** Include TDS in the net definition at all. */
  includeTds?: boolean;
  /** Calendar month, for the February professional-tax differential. */
  month?: number;
}

/** Statutory employee deductions at a given gross. */
export function employeeDeductionsAt(
  template: TemplateLike,
  monthlyGross: number,
  rates: StatutoryRates,
  opts: NetOptions = {},
): { pf: number; esi: number; pt: number; lwf: number; tds: number; total: number } {
  const parts = componentsFromGross(template, monthlyGross);
  const gross = parts.monthlyGross;

  const pfOn = rates.pfEnabled && template.pfApplicable !== false;
  const pf = pfOn ? round2(pfWageFor(parts.basic, rates) * (rates.pfEmployeeRate / 100)) : 0;

  const esiOn = rates.esiEnabled && template.esiApplicable !== false && gross <= rates.esiWageLimit;
  const esi = esiOn ? round2(gross * (rates.esiEmployeeRate / 100)) : 0;

  const pt = rates.ptEnabled && template.ptApplicable !== false
    ? professionalTaxFor(gross, rates.ptSlabs as PtSlab[] | null, opts.month ?? 6)
    : 0;

  // LWF is periodic, not monthly, so it is deliberately excluded from a
  // structure's notion of monthly net. Including it would make eleven months
  // wrong to make one month right.
  const lwf = 0;

  const tds = opts.includeTds ? positive(opts.monthlyTds) : 0;

  return { pf, esi, pt, lwf, tds, total: round2(pf + esi + pt + lwf + tds) };
}

export function netFromGross(
  template: TemplateLike,
  monthlyGross: number,
  rates: StatutoryRates,
  opts: NetOptions = {},
): number {
  const parts = componentsFromGross(template, monthlyGross);
  const ded = employeeDeductionsAt(template, monthlyGross, rates, opts);
  // Fixed add-ons are paid out too, so they count toward take-home.
  return round2(parts.monthlyGross + parts.monthlyFixed - ded.total);
}

export interface NetSolveResult {
  monthlyGross: number;
  achievedNet: number;
  requestedNet: number;
  /** achieved − requested. Non-zero means the exact net is unreachable. */
  variance: number;
  exact: boolean;
  iterations: number;
  note?: string;
}

/**
 * Solve for the gross that yields a target take-home.
 *
 * net(gross) is NOT monotonic. It rises with gross overall, but at a statutory
 * slab boundary it jumps DOWNWARD, because the deduction steps up faster than
 * the gross did:
 *
 *     gross 19,999 → PT 150 → net 17,449.12
 *     gross 20,000 → PT 200 → net 17,400.00     ← net falls as gross rises
 *
 * Bisection alone assumes monotonicity and converges to the wrong branch in
 * that window. So this is two stages: bisection to get close, then an exhaustive
 * integer scan over a band wider than any single slab jump. The scan is what
 * makes the answer correct near a boundary; the bisection just makes the scan
 * small enough to be cheap.
 */
/** Widest gross window a single statutory step can displace the answer by.
 *  The largest jumps in play are the PT slab (≤300) and the ESI cut-off
 *  (~0.75% of the wage limit). 600 clears both with room to spare. */
const NET_SCAN_WINDOW = 600;
export function grossFromNet(
  template: TemplateLike,
  targetNet: number,
  rates: StatutoryRates,
  opts: NetOptions = {},
): NetSolveResult {
  const target = positive(targetNet);

  const fixed = round2(
    template.components.filter((c) => c.isFixed)
      .reduce((s, c) => s + positive(c.fixedAmount), 0),
  );

  if (target <= 0) {
    return { monthlyGross: 0, achievedNet: 0, requestedNet: 0, variance: 0, exact: true, iterations: 0 };
  }

  // Take-home already includes the fixed add-ons, so the gross needed is at
  // most the target and at least target − fixed. Widen generously; deductions
  // never exceed ~25% of gross for a structure like this.
  let lo = Math.max(0, target - fixed) * 0.5;
  let hi = Math.max(target * 2, target - fixed + 100000);

  // Guarantee the bracket actually contains the answer before bisecting.
  let guard = 0;
  while (netFromGross(template, hi, rates, opts) < target && guard++ < 40) hi *= 1.5;

  let iterations = 0;
  let mid = lo;
  // 80 halvings takes a 10-lakh bracket well below a paisa; the loop exits on
  // precision long before that in practice.
  for (; iterations < 80; iterations++) {
    mid = (lo + hi) / 2;
    const net = netFromGross(template, mid, rates, opts);
    if (Math.abs(net - target) < 0.005) break;
    if (net < target) lo = mid; else hi = mid;
    if (hi - lo < 0.0001) break;
  }

  // Stage two: exhaustive whole-rupee scan around the bisection result.
  //
  // Two jobs at once. It settles on a whole-rupee gross (HR types round numbers,
  // and 45,000.37 has no place on an offer letter), and it corrects the branch
  // when bisection landed on the wrong side of a downward jump. Ties break
  // toward the LOWER gross, so the employer never overpays to hit a net.
  const centre = Math.round(mid);
  const from = Math.max(0, centre - NET_SCAN_WINDOW);
  const to = centre + NET_SCAN_WINDOW;

  let best = centre;
  let bestDiff = Infinity;
  for (let g = from; g <= to; g++) {
    const diff = Math.abs(netFromGross(template, g, rates, opts) - target);
    if (diff < bestDiff - 1e-9) { bestDiff = diff; best = g; }
  }

  const achievedNet = netFromGross(template, best, rates, opts);
  const variance = round2(achievedNet - target);
  const exact = Math.abs(variance) < 0.01;

  let note: string | undefined;
  if (!exact) {
    note =
      `The exact net of ${target.toFixed(2)} is not reachable: statutory deductions move in steps ` +
      `(ESI cuts off above ${rates.esiWageLimit}, professional tax changes by slab), so some net ` +
      `values have no corresponding gross. Closest achievable is ${achievedNet.toFixed(2)} ` +
      `(${variance > 0 ? '+' : ''}${variance.toFixed(2)}).`;
  }

  return {
    monthlyGross: round2(best),
    achievedNet,
    requestedNet: round2(target),
    variance,
    exact,
    iterations,
    note,
  };
}

// ─── one entry point ─────────────────────────────────────────────────────────

export type InputMode = 'GROSS' | 'CTC' | 'NET';

export interface ApplyResult {
  inputMode: InputMode;
  inputAmount: number;
  components: ResolvedComponents;
  monthlyGross: number;
  monthlyCtc: number;
  monthlyNet: number;
  deductions: { pf: number; esi: number; pt: number; lwf: number; tds: number; total: number };
  employerPf: number;
  netSolve?: NetSolveResult;
}

/** Resolve a template plus one figure into a full structure. */
export function applyTemplate(
  template: TemplateLike,
  inputMode: InputMode,
  inputAmount: number,
  rates: StatutoryRates,
  opts: NetOptions = {},
): ApplyResult {
  let monthlyGross: number;
  let netSolve: NetSolveResult | undefined;

  if (inputMode === 'GROSS') {
    monthlyGross = positive(inputAmount);
  } else if (inputMode === 'CTC') {
    monthlyGross = grossFromCtc(template, inputAmount, rates);
  } else {
    netSolve = grossFromNet(template, inputAmount, rates, opts);
    monthlyGross = netSolve.monthlyGross;
  }

  const components = componentsFromGross(template, monthlyGross);
  const deductions = employeeDeductionsAt(template, monthlyGross, rates, opts);
  const employerPf = employerPfOn(components.basic, template, rates);

  return {
    inputMode,
    inputAmount: round2(positive(inputAmount)),
    components,
    monthlyGross: components.monthlyGross,
    monthlyCtc: round2(components.monthlyGross + employerPf + components.monthlyFixed),
    monthlyNet: round2(components.monthlyGross + components.monthlyFixed - deductions.total),
    deductions,
    employerPf,
    netSolve,
  };
}

/** Sensible starting point for a new template — a conventional Indian split. */
export const DEFAULT_COMPONENTS: TemplateComponent[] = [
  { key: 'basic',            label: 'Basic',             percentage: 50, isFixed: false, fixedAmount: 0, isBalancing: false, orderNo: 1 },
  { key: 'hra',              label: 'House Rent Allowance', percentage: 20, isFixed: false, fixedAmount: 0, isBalancing: false, orderNo: 2 },
  { key: 'medicalAllowance', label: 'Medical Allowance', percentage: 5,  isFixed: false, fixedAmount: 0, isBalancing: false, orderNo: 3 },
  { key: 'travelAllowance',  label: 'Conveyance',        percentage: 5,  isFixed: false, fixedAmount: 0, isBalancing: false, orderNo: 4 },
  { key: 'specialAllowance', label: 'Special Allowance', percentage: 20, isFixed: false, fixedAmount: 0, isBalancing: true,  orderNo: 5 },
];
