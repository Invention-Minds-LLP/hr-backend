// ─────────────────────────────────────────────────────────────────────────────
//  Payroll attendance calendar.
//
//  Answers the question the approval screen was not answering: "you are telling
//  me this person had 3 LOP days — which days, and why?"
//
//  Builds a day-by-day picture of the payroll month from every source that
//  feeds it: attendance punches, shift timings, leave, holidays, overtime,
//  late-login logs and permission requests. Nothing here recomputes payroll —
//  it EXPLAINS the payslip that was computed, which is what an approver needs.
//
//  ── On late-login approval ──────────────────────────────────────────────────
//  LateLoginLog has no approval column. In this system a late arrival is
//  condoned by an approved PermissionRequest covering that day, so the two are
//  joined here. A late mark with no covering permission is shown as unapproved,
//  which is the honest reading rather than assuming leniency.
//
//  ── On early logout ─────────────────────────────────────────────────────────
//  Nothing records it. It is derived: check-out earlier than the shift end by
//  more than the grace period. Derived rather than stored means it always
//  reflects the current shift assignment.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../../../lib/prisma';

/** Minutes of slack before a late arrival or early departure is flagged. */
export const LATE_GRACE_MINUTES = 10;
export const EARLY_GRACE_MINUTES = 10;

const IST = 'Asia/Kolkata';

/** YYYY-MM-DD in IST, so day boundaries match the working day, not UTC. */
export function istDateKey(d: Date | string): string {
  const date = new Date(d);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** HH:MM in IST, or null. */
function istTime(d?: Date | string | null): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(d));
}

/** Minutes since IST midnight — lets a punch be compared to a shift time
 *  regardless of the date each is stored against. */
function istMinutes(d?: Date | string | null): number | null {
  const t = istTime(d);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export interface CalendarDay {
  date: string;
  day: number;
  weekday: string;
  isWeekend: boolean;

  /** Attendance status as stored: PRESENT, ABSENT, LEAVE, WEEK_OFF, HOLIDAY, … */
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  workedMinutes: number | null;

  shiftName: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;

  lateMinutes: number;
  lateApproved: boolean;
  lateApprovalNote: string | null;

  earlyMinutes: number;

  otMinutes: number;
  otStatus: string | null;
  otApproved: boolean;

  leaveType: string | null;
  leaveStatus: string | null;
  isHalfDay: boolean;
  leaveIsLop: boolean;
  /// Did the employee actually apply for this day off?
  leaveApplied: boolean;
  /// Applied but not yet decided — counts as unpaid until it is.
  leavePending: boolean;

  holidayName: string | null;

  /** How this day was treated in payroll: paid, unpaid or half. */
  payTreatment: 'PAID' | 'LOP' | 'HALF' | 'NOT_APPLICABLE';

  /** HR interventions, so an approver can see a day was touched by hand. */
  isForcedPresent: boolean;
  isPunchCorrected: boolean;
  isOverridden: boolean;
  source: string | null;
  remarks: string | null;
}

export interface CalendarSummary {
  totalDays: number;
  workingDays: number;
  presentDays: number;
  weekOffDays: number;
  holidayDays: number;
  leaveDays: number;
  paidLeaveDays: number;
  lopDays: number;

  // ── Applied vs not applied ─────────────────────────────────────────────────
  // "Leave: 5" was ambiguous — it hid whether the employee actually applied.
  // A day off with an approved request is a different conversation from a day
  // the employee simply did not turn up, and only the second one is a problem.
  /// Days covered by an APPROVED leave request.
  leaveAppliedApproved: number;
  /// Days covered by a request still awaiting approval — unpaid until decided.
  leaveAppliedPending: number;
  /// Absent with no leave request at all. Always unpaid.
  absentNotApplied: number;
  /// Approved-leave days that are unpaid because balance ran out, or because
  /// the leave type is itself loss of pay.
  leaveUnpaidDays: number;
  halfDays: number;
  wfhDays: number;
  compOffDays: number;
  absentDays: number;

  lateCount: number;
  lateMinutesTotal: number;
  lateApprovedCount: number;
  lateUnapprovedCount: number;

  earlyCount: number;
  earlyMinutesTotal: number;

  otMinutesTotal: number;
  otApprovedMinutes: number;
  otPendingMinutes: number;

  forcedPresentCount: number;
  punchCorrectedCount: number;
  overriddenCount: number;
  missingPunchCount: number;
}

export interface EmployeeCalendar {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  department: string | null;
  designation: string | null;
  month: number;
  year: number;
  days: CalendarDay[];
  summary: CalendarSummary;
  /** Things an approver should look at before signing off. */
  exceptions: string[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Build one employee's calendar for a payroll month.
 *
 * Every source is fetched for the whole month in one query each, rather than
 * per day — 31 days × 6 lookups per employee would be 186 round trips against
 * a remote database for a single row of the approval screen.
 */
export async function buildEmployeeCalendar(
  employeeId: number,
  month: number,
  year: number,
): Promise<EmployeeCalendar | null> {
  const p: any = prisma;

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      Department: { select: { name: true } },
      designation: { select: { name: true } },
    },
  });
  if (!employee) return null;

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  const daysInMonth = new Date(year, month, 0).getDate();

  const [attendance, leaves, otRecords, lateLogs, permissions, shiftAssignments, shiftSetting, holidays] =
    await Promise.all([
      prisma.attendance.findMany({ where: { employeeId, date: { gte: start, lte: end } } }),
      prisma.leaveRequest.findMany({
        where: {
          employeeId,
          startDate: { lte: end },
          endDate: { gte: start },
          status: { in: ['APPROVED', 'PENDING'] as any },
        },
        include: { leaveType: { select: { name: true } } } as any,
      }),
      p.overtimeApproval.findMany({ where: { employeeId, date: { gte: start, lte: end } } }),
      p.lateLoginLog.findMany({ where: { employeeId, date: { gte: start, lte: end } } }),
      p.permissionRequest.findMany({
        where: { employeeId, day: { gte: start, lte: end } },
      }),
      p.shiftAssignment.findMany({
        where: { employeeId, date: { gte: start, lte: end } },
        include: { shift: true },
      }),
      p.employeeShiftSetting.findUnique({
        where: { employeeId },
        include: { fixedShift: true },
      }),
      p.holiday.findMany({ where: { date: { gte: start, lte: end } } }),
    ]);

  // Index everything by IST date key so the day loop is pure lookups.
  const byDate = <T extends { date?: any; day?: any }>(rows: T[], field: 'date' | 'day' = 'date') => {
    const m = new Map<string, T>();
    for (const r of rows) {
      const value = (r as any)[field];
      if (value) m.set(istDateKey(value), r);
    }
    return m;
  };

  const attMap = byDate(attendance as any);
  const otMap = byDate(otRecords);
  const lateMap = byDate(lateLogs);
  const shiftMap = byDate(shiftAssignments);
  const holidayMap = byDate(holidays);

  // Permissions can be many per day; keep them all so an approved one wins.
  const permMap = new Map<string, any[]>();
  for (const perm of permissions) {
    const key = istDateKey(perm.day);
    if (!permMap.has(key)) permMap.set(key, []);
    permMap.get(key)!.push(perm);
  }

  const days: CalendarDay[] = [];
  const exceptions: string[] = [];

  const summary: CalendarSummary = {
    totalDays: daysInMonth, workingDays: 0, presentDays: 0, weekOffDays: 0,
    holidayDays: 0, leaveDays: 0, paidLeaveDays: 0, lopDays: 0,
    leaveAppliedApproved: 0, leaveAppliedPending: 0, absentNotApplied: 0,
    leaveUnpaidDays: 0, halfDays: 0,
    wfhDays: 0, compOffDays: 0, absentDays: 0,
    lateCount: 0, lateMinutesTotal: 0, lateApprovedCount: 0, lateUnapprovedCount: 0,
    earlyCount: 0, earlyMinutesTotal: 0,
    otMinutesTotal: 0, otApprovedMinutes: 0, otPendingMinutes: 0,
    forcedPresentCount: 0, punchCorrectedCount: 0, overriddenCount: 0, missingPunchCount: 0,
  };

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d);
    const key = istDateKey(new Date(Date.UTC(year, month - 1, d, 6, 0, 0)));
    const weekdayIdx = dateObj.getDay();

    const att: any = attMap.get(key);
    const ot: any = otMap.get(key);
    const late: any = lateMap.get(key);
    const holiday: any = holidayMap.get(key);
    const shiftAssign: any = shiftMap.get(key);

    // Shift for the day: an explicit assignment wins, else the fixed shift.
    const shift = shiftAssign?.shift ?? shiftSetting?.fixedShift ?? null;
    const shiftStartMin = istMinutes(shift?.startTime);
    const shiftEndMin = istMinutes(shift?.endTime);

    // Leave covering this day.
    const leave = leaves.find((l: any) => {
      const s = istDateKey(l.startDate);
      const e = istDateKey(l.endDate);
      return key >= s && key <= e;
    }) as any;

    const checkInMin = istMinutes(att?.checkIn);
    const checkOutMin = istMinutes(att?.checkOut);

    // ── Late ────────────────────────────────────────────────────────────────
    // Prefer the recorded log; fall back to deriving it from the shift, so a
    // day the late-login cron missed still shows up.
    let lateMinutes = late?.lateMinutes ?? 0;
    if (!lateMinutes && checkInMin != null && shiftStartMin != null) {
      const derived = checkInMin - shiftStartMin;
      if (derived > LATE_GRACE_MINUTES) lateMinutes = derived;
    }

    // Condoned by an approved permission covering the day.
    const dayPerms = permMap.get(key) || [];
    const approvingPerm = dayPerms.find(
      (pr: any) => pr.status === 'APPROVED' || pr.hrDecision === 'APPROVED' || pr.hodDecision === 'APPROVED',
    );
    const lateApproved = lateMinutes > 0 && !!approvingPerm;
    const lateApprovalNote = approvingPerm
      ? `${approvingPerm.permissionType || 'Permission'} approved${approvingPerm.reason ? ` — ${approvingPerm.reason}` : ''}`
      : null;

    // ── Early departure ─────────────────────────────────────────────────────
    let earlyMinutes = 0;
    if (checkOutMin != null && shiftEndMin != null) {
      // A night shift ends past midnight; a checkout "before" the end in
      // clock terms is actually the next morning, so ignore that case.
      const overnight = shiftEndMin < (shiftStartMin ?? 0);
      if (!overnight) {
        const diff = shiftEndMin - checkOutMin;
        if (diff > EARLY_GRACE_MINUTES) earlyMinutes = diff;
      }
    }

    const workedMinutes =
      checkInMin != null && checkOutMin != null
        ? (checkOutMin >= checkInMin ? checkOutMin - checkInMin : 24 * 60 - checkInMin + checkOutMin)
        : null;

    // ── Pay treatment ───────────────────────────────────────────────────────
    // Attendance.status is a free-text column and the live data contains BOTH
    // "Present" and "PRESENT" for the same meaning. Comparing raw put mixed-case
    // days into NOT_APPLICABLE, i.e. silently unpaid. Normalise before every
    // comparison; `status` below is always upper-case.
    // An approved request means the day was properly applied for; a pending one
    // is applied but undecided, so it stays unpaid until someone acts.
    const leaveApplied = !!leave && String(leave.status).toUpperCase() === 'APPROVED';
    const leavePending = !!leave && String(leave.status).toUpperCase() === 'PENDING';

    const rawStatus: string | null = att?.status ?? null;
    const status = rawStatus ? String(rawStatus).toUpperCase().replace(/[\s-]+/g, '_') : null;
    const leaveIsLop = !!leave && (leave.lopUnits ?? 0) > 0;

    let payTreatment: CalendarDay['payTreatment'] = 'NOT_APPLICABLE';
    if (status === 'PRESENT' || status === 'WFH' || status === 'COMP_OFF') payTreatment = 'PAID';
    else if (status === 'WEEK_OFF' || status === 'HOLIDAY') payTreatment = 'PAID';
    else if (status === 'HALF_DAY') payTreatment = 'HALF';
    else if (status === 'LEAVE') payTreatment = leaveIsLop ? 'LOP' : 'PAID';
    else if (status === 'ABSENT') payTreatment = 'LOP';
    else if (!status) payTreatment = weekdayIdx === 0 ? 'PAID' : 'LOP';

    // ── Roll up ─────────────────────────────────────────────────────────────
    const isWeekOff = status === 'WEEK_OFF' || (!status && weekdayIdx === 0);
    if (!isWeekOff && status !== 'HOLIDAY') summary.workingDays++;

    if (status === 'PRESENT') summary.presentDays++;
    if (status === 'HALF_DAY') summary.halfDays++;
    if (status === 'WFH') summary.wfhDays++;
    if (status === 'COMP_OFF') summary.compOffDays++;
    if (status === 'ABSENT') summary.absentDays++;
    if (isWeekOff) summary.weekOffDays++;
    if (status === 'HOLIDAY' || holiday) summary.holidayDays++;
    if (status === 'LEAVE') {
      summary.leaveDays++;
      if (leaveIsLop) summary.lopDays++; else summary.paidLeaveDays++;

      // Applied vs not, and approved vs still pending.
      if (leavePending) {
        summary.leaveAppliedPending++;
        summary.leaveUnpaidDays++;
      } else if (leaveApplied) {
        summary.leaveAppliedApproved++;
        if (leaveIsLop) summary.leaveUnpaidDays++;
      } else {
        // Marked LEAVE but no request backs it — a data problem worth surfacing.
        summary.absentNotApplied++;
        summary.leaveUnpaidDays++;
      }
    }
    if (payTreatment === 'LOP' && status !== 'LEAVE') summary.lopDays++;
    // Absent with nothing applied for is the case HR actually chases.
    if (status === 'ABSENT') summary.absentNotApplied++;

    if (lateMinutes > 0) {
      summary.lateCount++;
      summary.lateMinutesTotal += lateMinutes;
      if (lateApproved) summary.lateApprovedCount++; else summary.lateUnapprovedCount++;
    }
    if (earlyMinutes > 0) {
      summary.earlyCount++;
      summary.earlyMinutesTotal += earlyMinutes;
    }

    const otMinutes = ot?.minutes ?? 0;
    const otApproved = ot?.status === 'APPROVED' || ot?.managerStatus === 'APPROVED';
    if (otMinutes > 0) {
      summary.otMinutesTotal += otMinutes;
      if (otApproved) summary.otApprovedMinutes += otMinutes;
      else summary.otPendingMinutes += otMinutes;
    }

    if (att?.isForcedPresent) summary.forcedPresentCount++;
    if (att?.isPunchCorrected) summary.punchCorrectedCount++;
    if (att?.isOverridden) summary.overriddenCount++;

    // A present day with only one punch is a data problem, not a work pattern.
    const missingPunch = !!status && status === 'PRESENT' && (!att?.checkIn || !att?.checkOut);
    if (missingPunch) summary.missingPunchCount++;

    days.push({
      date: key,
      day: d,
      weekday: WEEKDAYS[weekdayIdx],
      isWeekend: weekdayIdx === 0,
      // Return the normalised value so the UI never has to handle both casings.
      status,
      checkIn: istTime(att?.checkIn),
      checkOut: istTime(att?.checkOut),
      workedMinutes,
      shiftName: shift?.name ?? null,
      shiftStart: istTime(shift?.startTime),
      shiftEnd: istTime(shift?.endTime),
      lateMinutes,
      lateApproved,
      lateApprovalNote,
      earlyMinutes,
      otMinutes,
      otStatus: ot?.status ?? null,
      otApproved,
      leaveType: leave?.leaveType?.name ?? null,
      leaveStatus: leave?.status ?? null,
      isHalfDay: !!leave?.isHalfDay || status === 'HALF_DAY',
      leaveIsLop,
      leaveApplied,
      leavePending,
      holidayName: holiday?.title ?? null,
      payTreatment,
      isForcedPresent: !!att?.isForcedPresent,
      isPunchCorrected: !!att?.isPunchCorrected,
      isOverridden: !!att?.isOverridden,
      source: att?.source ?? null,
      remarks: att?.reason ?? null,
    });
  }

  // ── Exceptions worth an approver's attention ──────────────────────────────
  if (summary.missingPunchCount) {
    exceptions.push(`${summary.missingPunchCount} day(s) marked present with only one punch recorded.`);
  }
  if (summary.lateUnapprovedCount) {
    exceptions.push(`${summary.lateUnapprovedCount} unapproved late arrival(s), ${summary.lateMinutesTotal} minutes total.`);
  }
  if (summary.otPendingMinutes) {
    exceptions.push(`${summary.otPendingMinutes} minutes of overtime are still unapproved and will not be paid.`);
  }
  if (summary.forcedPresentCount) {
    exceptions.push(`${summary.forcedPresentCount} day(s) were force-marked present by HR.`);
  }
  if (summary.punchCorrectedCount) {
    exceptions.push(`${summary.punchCorrectedCount} day(s) had punches corrected manually.`);
  }
  if (summary.overriddenCount) {
    exceptions.push(`${summary.overriddenCount} day(s) had attendance overridden.`);
  }
  if (summary.absentDays) {
    exceptions.push(`${summary.absentDays} absent day(s) with no leave applied — these are unpaid.`);
  }
  if (summary.leaveAppliedPending) {
    exceptions.push(
      `${summary.leaveAppliedPending} leave day(s) are still awaiting approval. They are treated as ` +
      `unpaid until decided — approve or reject before publishing.`,
    );
  }

  return {
    employeeId,
    employeeCode: (employee as any).employeeCode,
    employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
    department: (employee as any).Department?.name ?? null,
    designation: (employee as any).designation?.name ?? null,
    month,
    year,
    days,
    summary,
    exceptions,
  };
}
