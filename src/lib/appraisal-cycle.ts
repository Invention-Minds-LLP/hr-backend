/**
 * Appraisal-cycle engine — the single source of truth for "how long has this
 * employee actually been here" and "which cycles/periods apply to them".
 *
 * Two independent tracks:
 *
 *   FIRST_YEAR  Every employee, every department, regardless of the department's
 *               appraisal-cycle config. Four milestones measured from DOJ
 *               (1 / 3 / 6 / 12 months), all inside ONE cycle so a joiner's first
 *               year is never split across two reporting years.
 *
 *   RECURRING   Starts after the first year. One review per cycle, no probation
 *               milestones. Driven by the department's appraisalCycleBasis /
 *               appraisalPeriodMonths / appraisalCalendarMonth (already on the
 *               Department model — nothing new was added for this).
 *
 * Convention throughout: a period is reviewed AFTER it closes. A cycle's
 * milestone date is therefore the day after its end date — the first day the
 * form can legitimately be filled in.
 */

export type CycleTrack = "FIRST_YEAR" | "RECURRING";
export type PerformancePeriod = "MONTH_1" | "MONTH_3" | "MONTH_6" | "YEAR_1";

export interface CyclePeriod {
  period: PerformancePeriod;
  milestoneDate: Date;
  /** True once the milestone has passed — i.e. the period may be filled in. */
  reached: boolean;
  /**
   * What to show the user. Recurring reviews are all STORED as YEAR_1 (the
   * cycle says which year it is, which is what avoids an enum ceiling at
   * YEAR_2) — but a review of someone's second year must not be labelled
   * "1 Year". Always display this rather than the raw period.
   */
  label: string;
}

export interface CyclePlan {
  track: CycleTrack;
  cycle: string;
  startDate: Date;
  endDate: Date;
  periods: CyclePeriod[];
}

/** The three fields already present on Department. */
export interface DeptCycleConfig {
  appraisalCycleBasis?: string | null;
  appraisalPeriodMonths?: number | null;
  appraisalCalendarMonth?: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** The four first-year milestones and their offset from the (effective) DOJ. */
export const FIRST_YEAR_PERIODS: Array<{ period: PerformancePeriod; offsetMonths: number; label: string }> = [
  { period: "MONTH_1", offsetMonths: 1, label: "1st Month" },
  { period: "MONTH_3", offsetMonths: 3, label: "3rd Month" },
  { period: "MONTH_6", offsetMonths: 6, label: "6th Month" },
  { period: "YEAR_1", offsetMonths: 12, label: "1 Year" },
];

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th", 22 -> "22nd". */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * Which year of service a recurring review covers. The first year belongs to the
 * FIRST_YEAR track, so recurring reviews start at year 2 — a review dated on the
 * second anniversary is the "2nd Year" review, not "1 Year".
 */
export function serviceYearAt(doj: Date, reviewDate: Date): number {
  return Math.max(2, Math.ceil(completedMonths(doj, reviewDate) / 12));
}

/**
 * Add months without JS's end-of-month overflow — plain setMonth turns
 * 31-Jan + 1 month into 3-Mar. Clamps to the last valid day instead.
 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/**
 * Whole months completed between two dates, anniversary-accurate.
 *
 * The calendar-only form used elsewhere — (yr diff)*12 + (month diff) — ignores
 * the day entirely, so a 25-Aug joiner "completed 12 months" on 1 August, three
 * weeks early. Decrementing when the day-of-month hasn't been reached fixes it.
 */
export function completedMonths(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) {
    // A 31st-of-month joiner completes the month on the 28th/30th when the
    // target month is shorter — the same clamping addMonths() applies, so the
    // two stay consistent.
    const lastDayOfTo = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate();
    if (to.getDate() !== lastDayOfTo) months--;
  }
  return Math.max(0, months);
}

/**
 * DOJ shifted forward by any paused days, so a maternity/medical pause delays
 * every downstream milestone by exactly the paused duration.
 */
export function effectiveStart(doj: Date, pausedDays = 0): Date {
  if (!pausedDays) return new Date(doj.getTime());
  const d = new Date(doj.getTime());
  d.setDate(d.getDate() + Math.round(pausedDays));
  return d;
}

function fmtDay(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}-${MONTH_NAMES[d.getMonth()]}-${d.getFullYear()}`;
}

function fmtMonth(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]}-${d.getFullYear()}`;
}

function dayBefore(d: Date): Date {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() - 1);
  return out;
}

function normaliseConfig(cfg?: DeptCycleConfig | null) {
  const basis = cfg?.appraisalCycleBasis === "CALENDAR" ? "CALENDAR" : "DOJ";
  const periodMonths = Number(cfg?.appraisalPeriodMonths) === 6 ? 6 : 12;
  const raw = Number(cfg?.appraisalCalendarMonth);
  // Anchor defaults to April (Indian financial year) when CALENDAR is selected
  // but no month was configured.
  const calendarMonth = raw >= 1 && raw <= 12 ? raw : 4;
  return { basis, periodMonths, calendarMonth };
}

/**
 * The first-year track. Identical for every employee in every department —
 * the department's cycle config plays no part in probation.
 */
export function firstYearPlan(doj: Date, pausedDays = 0, asOf: Date = new Date()): CyclePlan {
  // The LABEL comes from the raw joining date and never moves. It is stored on
  // every summary row, so deriving it from paused days would rename the cycle
  // the moment a pause is recorded — orphaning rows already assigned under the
  // old label (the guard and the form both match rows by this string).
  const labelStart = new Date(doj.getTime());
  const labelEnd = dayBefore(addMonths(labelStart, 12));

  // The SCHEDULE does shift: a pause delays each review, it doesn't rename the
  // employee's first year.
  const scheduleStart = effectiveStart(doj, pausedDays);

  return {
    track: "FIRST_YEAR",
    cycle: `${fmtDay(labelStart)} TO ${fmtDay(labelEnd)}`,
    startDate: labelStart,
    endDate: labelEnd,
    periods: FIRST_YEAR_PERIODS.map(({ period, offsetMonths, label }) => {
      const milestoneDate = addMonths(scheduleStart, offsetMonths);
      return { period, milestoneDate, reached: asOf.getTime() >= milestoneDate.getTime(), label };
    }),
  };
}

/**
 * Milestone for one period computed straight from the joining date, used when a
 * row's stored cycle matches no derived plan — legacy labels, or rows orphaned
 * by a department switching its cycle basis.
 *
 * Deliberately conservative: it only knows the first-year offsets, so an
 * employee past their first year is never blocked by it. It exists to catch
 * genuinely premature fills, not to police every row.
 */
export function fallbackMilestone(doj: Date, period: string, pausedDays = 0): Date | null {
  const spec = FIRST_YEAR_PERIODS.find((p) => p.period === period);
  if (!spec) return null;
  return addMonths(effectiveStart(doj, pausedDays), spec.offsetMonths);
}

/** All first-year fallback milestones as a period -> date map. */
export function fallbackMilestones(doj: Date, pausedDays = 0): Record<string, Date> {
  const out: Record<string, Date> = {};
  for (const { period, offsetMonths } of FIRST_YEAR_PERIODS) {
    out[period] = addMonths(effectiveStart(doj, pausedDays), offsetMonths);
  }
  return out;
}

/**
 * The recurring track — annual (or half-yearly) reviews from year two onward.
 * No probation milestones: each cycle carries a single review, recorded under
 * YEAR_1 because the cycle label already says which year it belongs to.
 *
 * `lookAheadDays` lets HR see and prepare the next cycle slightly before its
 * milestone lands; the milestone's own `reached` flag still gates filling it.
 */
export function recurringPlans(
  doj: Date,
  cfg?: DeptCycleConfig | null,
  asOf: Date = new Date(),
  lookAheadDays = 90,
): CyclePlan[] {
  const { basis, periodMonths, calendarMonth } = normaliseConfig(cfg);
  const horizon = new Date(asOf.getTime() + lookAheadDays * MS_PER_DAY);
  const out: CyclePlan[] = [];

  const push = (start: Date, reviewDate: Date, cycleLabel: string) => {
    out.push({
      track: "RECURRING",
      cycle: cycleLabel,
      startDate: start,
      endDate: dayBefore(reviewDate),
      periods: [{
        // Stored as YEAR_1 whatever the year — the cycle identifies which one.
        // The label is what the user sees, so a second-year review reads
        // "2nd Year" rather than "1 Year".
        period: "YEAR_1",
        milestoneDate: reviewDate,
        reached: asOf.getTime() >= reviewDate.getTime(),
        label: `${ordinal(serviceYearAt(doj, reviewDate))} Year`,
      }],
    });
  };

  if (basis === "DOJ") {
    // Cycles run back-to-back from the end of the first year, each reviewed at
    // its own end. offset is measured in months from the DOJ.
    for (let offset = 12; out.length < 60; offset += periodMonths) {
      const start = addMonths(doj, offset);
      const reviewDate = addMonths(doj, offset + periodMonths);
      if (reviewDate.getTime() > horizon.getTime()) break;
      push(start, reviewDate, `${fmtDay(start)} TO ${fmtDay(dayBefore(reviewDate))}`);
    }
    return out;
  }

  // CALENDAR: reviews land in fixed month(s) shared by the whole department.
  // Half-yearly adds a second window six months after the anchor, matching the
  // "April & October" convention already shown in Settings -> Masters.
  const windowMonths = periodMonths === 6
    ? [calendarMonth, ((calendarMonth - 1 + 6) % 12) + 1]
    : [calendarMonth];

  for (let year = doj.getFullYear(); year <= horizon.getFullYear() + 1; year++) {
    for (const month of windowMonths) {
      const reviewDate = new Date(year, month - 1, 1);
      if (reviewDate.getTime() > horizon.getTime()) continue;
      // The first year is owned by the FIRST_YEAR track, so recurring reviews
      // only begin once twelve months are genuinely complete.
      if (completedMonths(doj, reviewDate) < 12) continue;
      const start = addMonths(reviewDate, -periodMonths);
      push(start, reviewDate, `${fmtMonth(start)} TO ${fmtMonth(dayBefore(reviewDate))}`);
    }
  }

  out.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  return out;
}

/**
 * Everything assignable for one employee: the first-year track plus any
 * recurring cycles that have arrived (or are within the look-ahead window).
 */
export function resolveCyclesForEmployee(
  doj: Date,
  cfg?: DeptCycleConfig | null,
  pausedDays = 0,
  asOf: Date = new Date(),
): CyclePlan[] {
  return [firstYearPlan(doj, pausedDays, asOf), ...recurringPlans(doj, cfg, asOf)];
}

/**
 * Pull the end date out of a derived cycle label. DOJ-basis labels are
 * "09-JAN-2026"-style and parse exactly; calendar labels are month-only, so the
 * first of that month is close enough to place the service year.
 */
export function cycleEndDate(cycle: string): Date | null {
  const tail = cycle.split(" TO ")[1]?.trim();
  if (!tail) return null;
  const dmy = tail.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/);
  if (dmy) {
    const m = MONTH_NAMES.indexOf(dmy[2]);
    return m < 0 ? null : new Date(Number(dmy[3]), m, Number(dmy[1]));
  }
  const my = tail.match(/^([A-Z]{3})-(\d{4})$/);
  if (my) {
    const m = MONTH_NAMES.indexOf(my[1]);
    return m < 0 ? null : new Date(Number(my[2]), m, 1);
  }
  return null;
}

/**
 * Display label for a stored (cycle, period) pair.
 *
 * Probation periods are fixed. YEAR_1 is ambiguous on its own — it is the store
 * value for every annual review — so it reads "1 Year" only inside the
 * employee's first-year cycle, and "2nd Year", "3rd Year" and so on elsewhere,
 * worked out from the cycle's end date.
 */
export function labelForCyclePeriod(doj: Date | null, cycle: string, period: string): string {
  const fixed = FIRST_YEAR_PERIODS.find((p) => p.period === period);
  if (fixed && period !== "YEAR_1") return fixed.label;
  if (period === "YEAR_2") return "2nd Year";
  if (!doj) return fixed?.label ?? period;

  if (cycle === firstYearPlan(doj).cycle) return "1 Year";

  const end = cycleEndDate(cycle);
  if (!end) return "Annual Review";
  return `${ordinal(serviceYearAt(doj, end))} Year`;
}

/** True when this cycle is the employee's first-year cycle. */
export function isFirstYearCycle(doj: Date | null, cycle: string): boolean {
  return !!doj && cycle === firstYearPlan(doj).cycle;
}

/** Look up one plan by its cycle label — used to validate an incoming assign. */
export function findPlan(plans: CyclePlan[], cycle: string): CyclePlan | undefined {
  return plans.find((p) => p.cycle === cycle);
}
