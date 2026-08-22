import { prisma } from '../lib/prisma';
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
async function isHoliday(date: Date) {
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
function workedMinutesOf(attendance: any): number | null {
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

  // Only for PRESENT days
  if (attendance.status !== "Present") return;

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
