import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { createNotification } from "../api/notifications/notifications.controller";

// ─────────────────────────────────────────────────────────────────────────────
// Employee document expiry reminders.
//
// Expiring documents (contracts, licences, registrations, visas …) were only
// visible as a count on the HR dashboard — nobody was told. The employee found
// out when someone noticed, and HR only if they opened the tile. This nudges
// the document's owner at fixed offsets before expiry and sends HR one digest
// per run listing everyone nudged.
//
// The offset is recorded on the document (expiryRemindersSent) so a daily run
// can never send the same reminder twice, even if the job runs more than once
// or the process restarts. A run that was down for days sends one catch-up
// nudge at the most urgent offset reached, not one per missed offset.
//
// Times are computed in the process timezone (TZ=Asia/Kolkata in the Dockerfile).
// ─────────────────────────────────────────────────────────────────────────────

/** Days before expiry at which the employee is nudged. */
const REMINDER_OFFSETS = [30, 15, 7, 1];

/** Employees listed individually in the HR digest before it collapses to a count. */
const HR_DIGEST_LIMIT = 15;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/**
 * HR recipients for the digest: HR managers (roleId 1) plus HR executives
 * (department 1, roleId 2), all active — the same audience as the monthly
 * late-threshold alert.
 */
async function getHrRecipientIds(): Promise<number[]> {
  const hrStaff = await prisma.employee.findMany({
    where: {
      employmentStatus: "ACTIVE",
      OR: [{ roleId: 1 }, { departmentId: 1, roleId: 2 }],
    },
    select: { id: true },
  });
  return hrStaff.map(h => h.id);
}

export async function sendDocumentExpiryReminders(
  asOf: Date = new Date(),
): Promise<{ sent: number; hrNotified: number }> {
  const today = startOfDay(asOf);
  const widest = Math.max(...REMINDER_OFFSETS);
  // today + widest, inclusive: a document expiring exactly `widest` days out is
  // in the window, anything later is not yet our problem.
  const horizon = new Date(today.getTime() + (widest + 1) * 86400000);

  const docs = await prisma.document.findMany({
    where: {
      expiryDate: { gte: today, lt: horizon },
      employee: { employmentStatus: "ACTIVE" },
    },
    select: {
      id: true,
      title: true,
      type: true,
      expiryDate: true,
      expiryRemindersSent: true,
      employeeId: true,
      employee: {
        select: {
          firstName: true,
          lastName: true,
          employeeCode: true,
          Department: { select: { name: true } },
        },
      },
    },
  });

  const digest: string[] = [];
  let sent = 0;

  for (const d of docs) {
    if (!d.expiryDate) continue;

    const daysLeft = Math.ceil((startOfDay(d.expiryDate).getTime() - today.getTime()) / 86400000);
    // The most urgent offset this document has reached — the smallest offset
    // that is still >= daysLeft. A doc 20 days out sits at the 30-day offset;
    // at 7 days left it moves to the 7-day one.
    const due = REMINDER_OFFSETS.filter(o => o >= daysLeft).sort((a, b) => a - b)[0];
    if (due === undefined) continue;

    const already = (d.expiryRemindersSent ?? "").split(",").filter(Boolean);
    if (already.includes(String(due))) continue;

    const label = d.title || d.type;
    const when = daysLeft === 0
      ? "expires today"
      : `expires on ${fmt(d.expiryDate)} — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;

    await createNotification(
      d.employeeId,
      `Your document "${label}" ${when}. Please share the renewed copy with HR before then.`,
      "📄 Document expiring",
    ).catch(() => undefined);

    // Wider offsets are marked alongside the one just sent so a catch-up run
    // does not fire them tomorrow.
    const marked = [...new Set([...already, ...REMINDER_OFFSETS.filter(o => o >= due).map(String)])];
    await prisma.document.update({
      where: { id: d.id },
      data: { expiryRemindersSent: marked.join(",") },
    });

    const name = `${d.employee.firstName} ${d.employee.lastName}`.trim();
    digest.push(
      `• ${name} (${d.employee.employeeCode})${d.employee.Department?.name ? ` — ${d.employee.Department.name}` : ""}: ` +
      `${label}, ${daysLeft === 0 ? "expires today" : `${fmt(d.expiryDate)} (${daysLeft}d)`}`,
    );
    sent++;
  }

  if (!sent) return { sent: 0, hrNotified: 0 };

  // One digest per HR recipient covering only what was nudged in THIS run, so
  // HR is not re-sent the same list every morning.
  const shown = digest.slice(0, HR_DIGEST_LIMIT);
  const overflow = digest.length - shown.length;
  const message =
    `${sent} employee document${sent === 1 ? "" : "s"} nearing expiry. ` +
    `The employee${sent === 1 ? " has" : "s have"} been notified.\n` +
    shown.join("\n") +
    (overflow > 0 ? `\n…and ${overflow} more — see Documents expiring on the dashboard.` : "");

  const hrIds = await getHrRecipientIds();
  for (const hrId of hrIds) {
    await createNotification(hrId, message, "📄 Documents expiring").catch(() => undefined);
  }

  return { sent, hrNotified: hrIds.length };
}

export function initDocumentExpiryReminderCron() {
  // Daily at 09:45 — after the 09:00 weekly-tracker, 09:15 probation and 09:30
  // comp-off jobs, so the morning notifications do not all land at once.
  cron.schedule("45 9 * * *", async () => {
    try {
      const { sent, hrNotified } = await sendDocumentExpiryReminders();
      if (sent > 0) {
        console.log(`[CRON] document expiry reminders: ${sent} employee nudge(s), HR digest to ${hrNotified}`);
      }
    } catch (e) {
      console.error("[CRON] sendDocumentExpiryReminders failed", e);
    }
  });
  console.log("🕒 Document expiry reminder cron scheduled (09:45 daily)");
}
