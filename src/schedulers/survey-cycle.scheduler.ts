import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { createNotification } from "../api/notifications/notifications.controller";

// ─────────────────────────────────────────────────────────────────────────────
// Employee Satisfaction Survey — cycle engine.
//
// Replaces the old per-employee anniversary schedule (survey due 6 months after
// each employee's joining date, so everyone was on their own clock). The client
// asked for a fixed org-wide window instead: 1–5 Sep 2026, repeating every six
// months, with employees who joined in the 15 days before the start date left
// out of that cycle.
//
// A cycle walks SCHEDULED → OPEN → CLOSED:
//   open   — on startDate, assign a DRAFT survey to every eligible employee
//   remind — daily inside the window, nudge whoever is still DRAFT
//   close  — after endDate, mark unsubmitted as EXPIRED and schedule the next
//            cycle `recurrenceMonths` out, so the repeat is self-sustaining.
//
// Every step is idempotent: re-running the tick on the same day is a no-op, and
// a missed run catches up (the queries are driven by dates and status, never by
// "did it run yesterday"). @@unique([cycleId, employeeId]) is the backstop
// against double-assignment.
//
// Times are computed in the process timezone (TZ=Asia/Kolkata in the Dockerfile).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `notify: false` runs the state machine without sending anything. Only for
 * dry-run/test tooling — the real cron always notifies.
 */
export type CycleRunOptions = { notify?: boolean };

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * Same calendar day N months out, clamped to the month's last day so a cycle
 * starting 31 Aug rolls to 28/29 Feb rather than overflowing into March.
 */
function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  const day = x.getDate();
  x.setMonth(x.getMonth() + months);
  if (x.getDate() < day) x.setDate(0);
  return x;
}

const fmt = (d: Date) => new Date(d).toLocaleDateString("en-IN");

function cycleNameFor(startDate: Date): string {
  const label = startDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  return `Employee Satisfaction Survey — ${label}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Eligibility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Employees who may be assigned this cycle: ACTIVE, and joined on or before
 * (startDate − exclusionDays).
 *
 * Boundary: someone who joined exactly `exclusionDays` before the start date is
 * treated as ELIGIBLE — they have had the full 15 days. Flip `lte` to `lt` if
 * the client wants that person excluded too.
 */
async function eligibleEmployees(startDate: Date, exclusionDays: number) {
  const cutoff = new Date(startOfDay(startDate).getTime() - exclusionDays * 86400000);
  return prisma.employee.findMany({
    where: {
      employmentStatus: "ACTIVE",
      dateOfJoining: { lte: endOfDay(cutoff) },
    },
    select: { id: true, firstName: true, lastName: true },
  });
}

/** ACTIVE employees left out of this cycle purely by the joining-date rule. */
export async function excludedEmployees(startDate: Date, exclusionDays: number) {
  const cutoff = new Date(startOfDay(startDate).getTime() - exclusionDays * 86400000);
  return prisma.employee.findMany({
    where: {
      employmentStatus: "ACTIVE",
      dateOfJoining: { gt: endOfDay(cutoff) },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      dateOfJoining: true,
      Department: { select: { id: true, name: true } },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — open cycles whose start date has arrived
// ─────────────────────────────────────────────────────────────────────────────

export async function openDueCycles(
  opts: CycleRunOptions = {},
): Promise<{ opened: number; assigned: number }> {
  const notify = opts.notify !== false;
  const today = new Date();
  const due = await prisma.surveyCycle.findMany({
    where: { status: "SCHEDULED", startDate: { lte: endOfDay(today) } },
    orderBy: { startDate: "asc" },
  });

  let opened = 0;
  let assigned = 0;

  for (const cycle of due) {
    // Window already gone by (server was down for the whole cycle). Don't
    // assign retroactively — closeFinishedCycles() will retire it.
    if (endOfDay(cycle.endDate) < startOfDay(today)) continue;

    const eligible = await eligibleEmployees(cycle.startDate, cycle.exclusionDays);
    const excluded = await excludedEmployees(cycle.startDate, cycle.exclusionDays);

    if (!eligible.length) {
      console.warn(`[SURVEY] cycle ${cycle.id} "${cycle.name}" has no eligible employees`);
    }

    // Assignment + status flip together; notifications stay outside the
    // transaction (remote DB is slow — see the timeout below).
    await prisma.$transaction(
      async (tx) => {
        if (eligible.length) {
          await tx.employeeSurvey.createMany({
            data: eligible.map((e) => ({
              employeeId: e.id,
              cycleId: cycle.id,
              date: cycle.startDate,
              status: "DRAFT",
            })),
            skipDuplicates: true,
          });
        }
        await tx.surveyCycle.update({
          where: { id: cycle.id },
          data: { status: "OPEN" },
        });
      },
      { maxWait: 20000, timeout: 120000 },
    );

    opened++;
    assigned += eligible.length;
    console.log(
      `[SURVEY] opened cycle ${cycle.id} "${cycle.name}" — ` +
      `${eligible.length} assigned, ${excluded.length} excluded (joined within ${cycle.exclusionDays} days)`,
    );

    if (notify) {
      for (const e of eligible) {
        await createNotification(
          e.id,
          `${e.firstName} ${e.lastName}, the ${cycle.name} is now open. ` +
          `Please complete it on or before ${fmt(cycle.endDate)}.`,
          "Employee survey open",
        ).catch(() => undefined);
      }

      await notifyHR(
        `${cycle.name} has opened — assigned to ${eligible.length} employee(s), ` +
        `${excluded.length} excluded as recent joiners. Closes ${fmt(cycle.endDate)}.`,
        "Survey cycle opened",
      );
    }
  }

  return { opened, assigned };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — nudge whoever is still pending inside an open window
// ─────────────────────────────────────────────────────────────────────────────

export async function sendCycleReminders(
  opts: CycleRunOptions = {},
): Promise<{ sent: number }> {
  if (opts.notify === false) return { sent: 0 };
  const today = startOfDay(new Date());
  const open = await prisma.surveyCycle.findMany({ where: { status: "OPEN" } });

  let sent = 0;
  for (const cycle of open) {
    // On the opening day the assignment notice already went out.
    if (today <= startOfDay(cycle.startDate)) continue;

    const drafts = await prisma.employeeSurvey.findMany({
      where: { cycleId: cycle.id, status: "DRAFT" },
      select: { employeeId: true },
    });

    const daysLeft = Math.max(
      0,
      Math.round((startOfDay(cycle.endDate).getTime() - today.getTime()) / 86400000),
    );

    for (const d of drafts) {
      await createNotification(
        d.employeeId,
        `Reminder: your ${cycle.name} is still pending. ` +
        (daysLeft > 0
          ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left — it closes on ${fmt(cycle.endDate)}.`
          : `Today (${fmt(cycle.endDate)}) is the last day to submit.`),
        "Survey pending",
      ).catch(() => undefined);
      sent++;
    }
  }

  return { sent };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — close finished cycles and schedule the next one
// ─────────────────────────────────────────────────────────────────────────────

export async function closeFinishedCycles(
  opts: CycleRunOptions = {},
): Promise<{ closed: number; expired: number }> {
  const notify = opts.notify !== false;
  const today = startOfDay(new Date());
  const finished = await prisma.surveyCycle.findMany({
    where: { status: { in: ["OPEN", "SCHEDULED"] }, endDate: { lt: today } },
    orderBy: { endDate: "asc" },
  });

  let closed = 0;
  let expired = 0;

  for (const cycle of finished) {
    if (cycle.status === "SCHEDULED") {
      console.error(
        `[SURVEY] cycle ${cycle.id} "${cycle.name}" ended without ever opening ` +
        `(${fmt(cycle.startDate)}–${fmt(cycle.endDate)}) — closing unused. Was the scheduler down?`,
      );
    }

    const lapsed = await prisma.employeeSurvey.updateMany({
      where: { cycleId: cycle.id, status: "DRAFT" },
      data: { status: "EXPIRED" },
    });
    const submitted = await prisma.employeeSurvey.count({
      where: { cycleId: cycle.id, status: "SUBMITTED" },
    });

    await prisma.surveyCycle.update({
      where: { id: cycle.id },
      data: { status: "CLOSED" },
    });

    closed++;
    expired += lapsed.count;

    const total = submitted + lapsed.count;
    const pct = total ? Math.round((submitted / total) * 100) : 0;
    console.log(
      `[SURVEY] closed cycle ${cycle.id} "${cycle.name}" — ` +
      `${submitted}/${total} submitted (${pct}%), ${lapsed.count} expired`,
    );

    const next = await ensureNextCycle(cycle);

    if (notify) {
      await notifyHR(
        `${cycle.name} has closed — ${submitted} of ${total} submitted (${pct}%), ` +
        `${lapsed.count} did not respond.` +
        (next ? ` Next cycle scheduled for ${fmt(next.startDate)}–${fmt(next.endDate)}.` : ""),
        "Survey cycle closed",
      );
    }
  }

  return { closed, expired };
}

/**
 * Create the follow-on cycle `recurrenceMonths` after this one, keeping the same
 * window length, exclusion rule and cadence. Skips silently if a cycle already
 * starts on that day, so re-running never stacks duplicates.
 */
export async function ensureNextCycle(cycle: {
  startDate: Date;
  endDate: Date;
  exclusionDays: number;
  recurrenceMonths: number;
}) {
  if (!cycle.recurrenceMonths || cycle.recurrenceMonths <= 0) return null;

  const startDate = startOfDay(addMonths(cycle.startDate, cycle.recurrenceMonths));
  const endDate = endOfDay(addMonths(cycle.endDate, cycle.recurrenceMonths));

  const existing = await prisma.surveyCycle.findFirst({
    where: { startDate: { gte: startDate, lte: endOfDay(startDate) } },
  });
  if (existing) return null;

  return prisma.surveyCycle.create({
    data: {
      name: cycleNameFor(startDate),
      startDate,
      endDate,
      status: "SCHEDULED",
      exclusionDays: cycle.exclusionDays,
      recurrenceMonths: cycle.recurrenceMonths,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/** HR department is deptId 1 — same convention the survey controller uses. */
async function notifyHR(message: string, title: string) {
  const hrs = await prisma.employee.findMany({
    where: { departmentId: 1, employmentStatus: "ACTIVE" },
    select: { id: true },
  });
  for (const hr of hrs) {
    await createNotification(hr.id, message, title).catch(() => undefined);
  }
}

/** One full pass. Exported so it can be triggered manually or from a test. */
export async function runSurveyCycleTick(opts: CycleRunOptions = {}) {
  const o = await openDueCycles(opts);
  const r = await sendCycleReminders(opts);
  const c = await closeFinishedCycles(opts);
  return { ...o, ...r, ...c };
}

export function initSurveyCycleScheduler() {
  // 08:00 daily — a cycle opens at the start of business, and the reminder
  // lands early enough that the employee can still act on it that day.
  cron.schedule("0 8 * * *", async () => {
    try {
      const s = await runSurveyCycleTick();
      if (s.opened || s.sent || s.closed) {
        console.log(
          `[CRON] survey cycles: ${s.opened} opened, ${s.assigned} assigned, ` +
          `${s.sent} reminders, ${s.closed} closed, ${s.expired} expired`,
        );
      }
    } catch (e) {
      console.error("[CRON] runSurveyCycleTick failed", e);
    }
  });
  console.log("🕒 Survey cycle scheduler started (08:00 daily)");
}
