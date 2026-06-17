import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { createNotification } from "../api/notifications/notifications.controller";
import { isWeeklyOff } from "../services/comOff.service";

// ─────────────────────────────────────────────────────────────────────────────
// Attendance reminders (IM only — gated by ATTENDANCE_REMINDERS env flag)
//   1) 13:00 daily  — remind employees who haven't checked in (and aren't on
//      approved leave / week-off) for the day.
//   2) every 15 min — remind employees who checked in but haven't checked out
//      once it's 15 min past their shift end ("attendance won't be counted").
//
// Times are computed in the process timezone (TZ=Asia/Kolkata in the Dockerfile).
// Shift times are stored as DateTime where the UTC hours represent the IST
// wall-clock (e.g. 17:30Z == 5:30 PM IST), so shift-end is built with UTC parts.
// ─────────────────────────────────────────────────────────────────────────────

const CHECKOUT_MARKER = "attendance won't be counted";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Build the real shift-end instant for a given work date (handles overnight shifts).
// Mirrors biometric.controller.ts:combineShiftEnd.
function combineShiftEnd(day: Date, start: Date, end: Date): Date {
  const dayIst = new Date(day.getTime() + 5.5 * 3600000);
  const result = new Date(Date.UTC(
    dayIst.getUTCFullYear(),
    dayIst.getUTCMonth(),
    dayIst.getUTCDate(),
    end.getUTCHours(),
    end.getUTCMinutes(),
    end.getUTCSeconds(),
  ));
  const endMins = end.getUTCHours() * 60 + end.getUTCMinutes();
  const startMins = start.getUTCHours() * 60 + start.getUTCMinutes();
  if (endMins < startMins) result.setUTCDate(result.getUTCDate() + 1); // overnight
  return result;
}

// Resolve an employee's shift (start/end templates) for a given work date.
// Per-date ShiftAssignment first, then the employee's FIXED shift as fallback.
async function resolveShiftEnd(employeeId: number, workDate: Date): Promise<Date | null> {
  const assignment = await prisma.shiftAssignment.findFirst({
    where: { employeeId, date: { gte: startOfDay(workDate), lt: new Date(startOfDay(workDate).getTime() + 86400000) } },
    include: { shift: true },
  });
  let shift = assignment?.shift ?? null;

  if (!shift) {
    const setting = await prisma.employeeShiftSetting.findUnique({
      where: { employeeId },
      include: { fixedShift: true },
    });
    shift = setting?.fixedShift ?? null;
  }

  if (!shift?.startTime || !shift?.endTime) return null;
  return combineShiftEnd(workDate, new Date(shift.startTime), new Date(shift.endTime));
}

async function hasApprovedLeaveToday(employeeId: number, dayStart: Date, dayEnd: Date): Promise<boolean> {
  const leave = await prisma.leaveRequest.findFirst({
    where: {
      employeeId,
      status: "APPROVED",
      startDate: { lte: dayEnd },
      endDate: { gte: dayStart },
    },
    select: { id: true },
  });
  return !!leave;
}

// ── Job 1: missing check-in (runs once at 13:00) ────────────────────────────
export async function remindMissingCheckIn() {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  const employees = await prisma.employee.findMany({
    where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } },
    select: { id: true },
  });

  let sent = 0;
  for (const e of employees) {
    try {
      if (await isWeeklyOff(e.id, dayStart)) continue;
      if (await hasApprovedLeaveToday(e.id, dayStart, dayEnd)) continue;

      const att = await prisma.attendance.findFirst({
        where: { employeeId: e.id, date: { gte: dayStart, lt: dayEnd } },
        select: { checkIn: true },
      });
      if (att?.checkIn) continue;

      await createNotification(
        e.id,
        "You haven't checked in today. Please check in, or apply for leave if you are not working today.",
      );
      sent++;
    } catch (err) {
      console.error(`[attendance-reminders] check-in reminder failed for emp ${e.id}`, err);
    }
  }
  return { candidates: employees.length, sent };
}

// ── Job 2: missing check-out (runs every 15 min) ────────────────────────────
export async function remindMissingCheckOut() {
  const now = new Date();
  const dayStart = startOfDay(now);
  // Look back one extra day so overnight shifts that started "yesterday" are caught.
  const windowStart = new Date(dayStart.getTime() - 86400000);

  // Open attendances: checked in, not checked out.
  const open = await prisma.attendance.findMany({
    where: {
      date: { gte: windowStart },
      checkIn: { not: null },
      checkOut: null,
    },
    select: { employeeId: true, date: true },
  });

  let sent = 0;
  for (const att of open) {
    try {
      const shiftEnd = await resolveShiftEnd(att.employeeId, new Date(att.date));
      if (!shiftEnd) continue; // can't determine shift end — skip rather than spam

      // Only after shift end + 15 minutes.
      if (now.getTime() < shiftEnd.getTime() + 15 * 60000) continue;

      // De-dupe: one check-out reminder per employee per day.
      const already = await prisma.notification.findFirst({
        where: {
          employeeId: att.employeeId,
          createdAt: { gte: dayStart },
          message: { contains: CHECKOUT_MARKER },
        },
        select: { id: true },
      });
      if (already) continue;

      await createNotification(
        att.employeeId,
        `You haven't checked out after your shift. If you don't check out, this ${CHECKOUT_MARKER}.`,
      );
      sent++;
    } catch (err) {
      console.error(`[attendance-reminders] check-out reminder failed for emp ${att.employeeId}`, err);
    }
  }
  return { open: open.length, sent };
}

// ── Registration (gated by env flag so only the IM deployment runs it) ──────
export function initAttendanceReminderCrons() {
  const enabled = ["true", "1", "yes"].includes((process.env.ATTENDANCE_REMINDERS || "").toLowerCase());
  if (!enabled) {
    console.log("[attendance-reminders] disabled (set ATTENDANCE_REMINDERS=true to enable)");
    return;
  }

  // 13:00 daily — missing check-in.
  cron.schedule("0 13 * * *", async () => {
    try {
      const r = await remindMissingCheckIn();
      console.log(`[CRON] check-in reminders: ${r.sent}/${r.candidates}`);
    } catch (e) {
      console.error("[CRON] remindMissingCheckIn failed", e);
    }
  });

  // Every 15 minutes — missing check-out (15 min past each person's shift end).
  cron.schedule("*/15 * * * *", async () => {
    try {
      const r = await remindMissingCheckOut();
      if (r.sent > 0) console.log(`[CRON] check-out reminders: ${r.sent} sent (${r.open} open)`);
    } catch (e) {
      console.error("[CRON] remindMissingCheckOut failed", e);
    }
  });

  console.log("[attendance-reminders] crons registered (check-in 13:00, check-out every 15m)");
}
