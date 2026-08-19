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
export const FIRST_YEAR_PERIODS: Array<{ period: PerformancePeriod; offsetMonths: number }> = [
  { period: "MONTH_1", offsetMonths: 1 },
  { period: "MONTH_3", offsetMonths: 3 },
  { period: "MONTH_6", offsetMonths: 6 },
  { period: "YEAR_1", offsetMonths: 12 },
];

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
  const start = effectiveStart(doj, pausedDays);
  const end = dayBefore(addMonths(start, 12));

  return {
    track: "FIRST_YEAR",
    cycle: `${fmtDay(start)} TO ${fmtDay(end)}`,
    startDate: start,
    endDate: end,
    periods: FIRST_YEAR_PERIODS.map(({ period, offsetMonths }) => {
      const milestoneDate = addMonths(start, offsetMonths);
      return { period, milestoneDate, reached: asOf.getTime() >= milestoneDate.getTime() };
    }),
  };
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

  const push = (start: Date, reviewDate: Date, label: string) => {
    out.push({
      track: "RECURRING",
      cycle: label,
      startDate: start,
      endDate: dayBefore(reviewDate),
      periods: [{
        period: "YEAR_1",
        milestoneDate: reviewDate,
        reached: asOf.getTime() >= reviewDate.getTime(),
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

/** Look up one plan by its cycle label — used to validate an incoming assign. */
export function findPlan(plans: CyclePlan[], cycle: string): CyclePlan | undefined {
  return plans.find((p) => p.cycle === cycle);
}
