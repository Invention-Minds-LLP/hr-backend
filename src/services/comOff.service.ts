import { prisma } from '../lib/prisma';
import { normalizeAttendanceStatus } from '../lib/attendanceStatus';
import { createNotification } from '../api/notifications/notifications.controller';


function stripTime(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getWeekOfMonth(date: Date): number {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const offset = firstDay.getDay(); // weekday of 1st day
  return Math.ceil((date.getDate() + offset) / 7);
}


// Only a MANDATORY holiday earns a comp-off. An optional holiday (RH) is a
// normal working day that the employee may choose to take off — working it is
// what everyone else is doing, so it compensates nothing.
export async function isHoliday(date: Date) {
  const holiday = await prisma.holiday.findFirst({
    where: {
      date: stripTime(date),
      isOptional: false
    }
  });
  return !!holiday;
}

// function isWeeklyOff(date: Date) {
//   // Sunday as default weekly off
//   return date.getDay() === 0;
// }
export async function isWeeklyOff(employeeId: number, date: Date) {
  const approval = await prisma.shiftApproval.findFirst({
    where: {
      employeeId,
      status: "APPROVED",
    },
    orderBy: {
      requestedAt: "desc",
    },
    select: {
      weekOffConfig: true,
    },
  });

  // fallback: Sunday
  if (!approval || !approval.weekOffConfig) {
    return date.getDay() === 0;
  }

  const config: any = approval.weekOffConfig;

  // Rotational weekly off logic
  if (config.weeks) {
    const weekNumber = getWeekOfMonth(date) - 1;
    const offDay = config.weeks[weekNumber];
    console.log(`Rotational Weekly Off - Week ${weekNumber}: Off Day ${offDay}`);

    if (offDay !== undefined) {
      return date.getDay() === offDay;
    }
  }

  // fallback
  return date.getDay() === 0;
}


// export async function generateCompOffIfEligible(attendance: any) {
//   const date = stripTime(new Date(attendance.date));
//   const employeeId = attendance.employeeId;

//   // Only for PRESENT days
//   if (attendance.status !== "PRESENT") return;

//   const holiday = await isHoliday(date);
//   const weeklyOff = isWeeklyOff(date);

//   if (!holiday && !weeklyOff) return;

//   const expiry = new Date(date);
//   expiry.setDate(expiry.getDate() + 30);

// const existing = await prisma.compOffCredit.findFirst({
//   where: {
//     employeeId,
//     workDate: date,
//     used: false
//   }
// });

// if (!existing) {
//   await prisma.compOffCredit.create({
//     data: {
//       employeeId,
//       workDate: date,
//       expiryDate: expiry
//     }
//   });
// }

// }

/** Days a credit stays usable, counted from the day that was worked. */
export const COMP_OFF_VALIDITY_DAYS = 30;

/**
 * When a credit for `workDate` lapses. Every path that issues a comp-off credit
 * must use this — the approval flow, HR's direct grant, the comp-off register
 * and the week-off override all used to set their own, and three of them
 * defaulted to three months, so an HR-granted credit outlived an earned one by
 * 3x for the same day's work.
 *
 * Counted from the day worked, not the day approved, so a slow approval cannot
 * silently stretch the entitlement.
 */
export function compOffExpiryFor(workDate: Date): Date {
  const e = stripTime(workDate);
  e.setDate(e.getDate() + COMP_OFF_VALIDITY_DAYS);
  return e;
}

/**
 * How many comp-offs an employee may earn in a calendar month.
 *
 * HR's direct grant (hr-corrections → manualCompOffGrant) is deliberately
 * exempt: it is the emergency route, it already demands a reason and stamps
 * isManualGrant/grantedBy, so an exception is visible as an exception.
 */
export const MAX_COMP_OFF_PER_MONTH = 2;

/**
 * What the employee has already spent of the month's entitlement, counted on
 * the month of the day WORKED rather than the day approved — a claim approved
 * late belongs to the month it was earned in, not the month HR got to it.
 *
 * Counts claims still in flight alongside credits already issued. Counting only
 * credits would let someone stack five pending claims and have them all land at
 * once. Rejected and withdrawn claims release their slot.
 */
export async function compOffMonthUsage(employeeId: number, date: Date) {
  const d = stripTime(date);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
  const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

  const [requests, credits] = await Promise.all([
    prisma.compOffRequest.findMany({
      where: {
        employeeId,
        workDate: { gte: monthStart, lte: monthEnd },
        status: { notIn: ["REJECTED", "WITHDRAWN"] },
      },
      select: { id: true, workDate: true, status: true, source: true },
      orderBy: { workDate: "asc" },
    }),
    prisma.compOffCredit.findMany({
      where: { employeeId, workDate: { gte: monthStart, lte: monthEnd } },
      select: { id: true, workDate: true, isManualGrant: true, requestId: true },
      orderBy: { workDate: "asc" },
    }),
  ]);

  // A credit issued from a request is the same entitlement as the request that
  // produced it — counting both would charge the employee twice for one day.
  const requestDays = new Set(requests.map(r => stripTime(r.workDate).getTime()));
  const standaloneCredits = credits.filter(c => !requestDays.has(stripTime(c.workDate).getTime()));

  const used = requests.length + standaloneCredits.length;

  return {
    monthStart,
    monthEnd,
    used,
    remaining: Math.max(0, MAX_COMP_OFF_PER_MONTH - used),
    max: MAX_COMP_OFF_PER_MONTH,
    requests,
    standaloneCredits,
  };
}

/**
 * Scheduled minutes for the employee's shift on `date`: the per-date
 * ShiftAssignment first, then their FIXED shift — the same resolution order as
 * attendance-reminders.scheduler.ts:resolveShiftEnd. A holiday or week-off
 * usually has no assignment, which is exactly when this is asked.
 *
 * Returns null when neither exists: we then cannot say whether a full shift was
 * worked, and refuse to guess.
 *
 * Shift times are stored as DateTime whose UTC hours carry the IST wall-clock
 * (17:30Z == 5:30 PM IST), hence the getUTC* parts.
 */
export async function getShiftMinutes(employeeId: number, date: Date): Promise<number | null> {
  const dayStart = stripTime(date);
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  const assignment = await prisma.shiftAssignment.findFirst({
    where: { employeeId, date: { gte: dayStart, lt: dayEnd } },
    include: { shift: true },
  });
  let shift: { startTime: Date; endTime: Date } | null = assignment?.shift ?? null;

  if (!shift) {
    const setting = await prisma.employeeShiftSetting.findUnique({
      where: { employeeId },
      include: { fixedShift: true },
    });
    shift = setting?.fixedShift ?? null;
  }

  if (!shift?.startTime || !shift?.endTime) return null;

  const start = new Date(shift.startTime).getUTCHours() * 60 + new Date(shift.startTime).getUTCMinutes();
  const end = new Date(shift.endTime).getUTCHours() * 60 + new Date(shift.endTime).getUTCMinutes();

  // Night shifts wrap past midnight.
  return end > start ? end - start : 24 * 60 - start + end;
}

/** Minutes between the punches. Null when the day is still open. */
export function workedMinutesOf(attendance: any): number | null {
  if (!attendance?.checkIn || !attendance?.checkOut) return null;
  const mins = Math.round(
    (new Date(attendance.checkOut).getTime() - new Date(attendance.checkIn).getTime()) / 60000,
  );
  return mins > 0 ? mins : null;
}

/**
 * Raises a comp-off REQUEST for a holiday/week-off that was worked in full.
 *
 * It deliberately does not create the credit: the credit is issued only after
 * the reporting manager and then HR approve (see comp-off-request.controller).
 * Auto-crediting is what made the entitlement disputable — HR could not tell an
 * earned credit from one the system invented.
 */
export async function generateCompOffIfEligible(attendance: any) {
  const date = stripTime(new Date(attendance.date));
  const employeeId = attendance.employeeId;

  console.log(`Checking comp off eligibility for Employee ${employeeId} on ${date.toDateString()} with status ${attendance.status}`);

  // Only for PRESENT days. Matching "Present" raw skipped every day written by
  // the force-present and HR-correction paths, which store 'PRESENT' — those
  // are exactly the holiday/week-off days a comp-off is owed for.
  if (normalizeAttendanceStatus(attendance.status) !== "PRESENT") return;

  const holiday = await isHoliday(date);
  const weeklyOff = await isWeeklyOff(employeeId, date);

  console.log(`Is Holiday: ${holiday}, Is Weekly Off: ${weeklyOff}`);

  // Not eligible
  if (!holiday && !weeklyOff) return;

  // Already claimed, already credited, or already refused — never raise twice.
  const [existingRequest, existingCredit] = await Promise.all([
    prisma.compOffRequest.findFirst({ where: { employeeId, workDate: date } }),
    prisma.compOffCredit.findFirst({ where: { employeeId, workDate: date } }),
  ]);
  if (existingRequest || existingCredit) return;

  // A comp-off is earned by working the shift, not by punching in on an off-day.
  const worked = workedMinutesOf(attendance);
  if (worked === null) {
    console.log(`Comp off skipped for ${employeeId} on ${date.toDateString()}: day not closed (no check-out)`);
    return;
  }

  const shiftMinutes = await getShiftMinutes(employeeId, date);
  if (shiftMinutes === null) {
    console.log(`Comp off skipped for ${employeeId} on ${date.toDateString()}: no shift assignment to measure against`);
    return;
  }

  if (worked < shiftMinutes) {
    console.log(
      `Comp off skipped for ${employeeId} on ${date.toDateString()}: worked ${worked}m of ${shiftMinutes}m shift`,
    );
    return;
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { firstName: true, lastName: true, reportingManager: true },
  });

  // Monthly entitlement. Told to the employee rather than dropped in silence —
  // otherwise they work a Sunday, nothing appears, and nobody can say why.
  const usage = await compOffMonthUsage(employeeId, date);
  if (usage.remaining <= 0) {
    console.log(
      `Comp off skipped for ${employeeId} on ${date.toDateString()}: ` +
      `${usage.used} of ${usage.max} already used this month`,
    );
    await createNotification(
      employeeId,
      `You worked ${date.toLocaleDateString("en-IN")}, but you have already earned ` +
      `${usage.used} of ${usage.max} comp-offs this month, so no further claim was raised. ` +
      `If this was an emergency, ask HR to grant it directly.`,
      "Comp-off limit reached",
    ).catch(() => undefined);
    return;
  }

  const request = await prisma.compOffRequest.create({
    data: {
      employeeId,
      workDate: date,
      source: "AUTO",
      qualifier: holiday ? "HOLIDAY" : "WEEK_OFF",
      workedMinutes: worked,
      shiftMinutes,
      status: "PENDING_MANAGER",
      managerId: employee?.reportingManager ?? null,
    },
  });

  if (employee?.reportingManager) {
    await createNotification(
      employee.reportingManager,
      `${employee.firstName} ${employee.lastName} worked ${(worked / 60).toFixed(1)}h on ` +
      `${date.toLocaleDateString("en-IN")} (${holiday ? "holiday" : "week-off"}) and has a comp-off ` +
      `awaiting your approval.`,
      "Comp-off request",
    ).catch(() => undefined);
  } else {
    console.warn(`Comp off request #${request.id} has no reporting manager to notify (emp ${employeeId})`);
  }
}
