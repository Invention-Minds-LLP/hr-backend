import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { createNotification } from "../api/notifications/notifications.controller";

// ─────────────────────────────────────────────────────────────────────────────
// Comp-off expiry reminders.
//
// A credit is valid for 30 days from the day that was worked. Employees were
// losing them silently — nothing told them the clock was running. This nudges
// the owner of every unused credit at fixed offsets before it lapses.
//
// Each offset is recorded on the credit (expiryRemindersSent) so a daily run
// can never send the same reminder twice, even if the job runs more than once
// or the process restarts.
//
// Times are computed in the process timezone (TZ=Asia/Kolkata in the Dockerfile).
// ─────────────────────────────────────────────────────────────────────────────

/** Days before expiry at which the employee is nudged. */
const REMINDER_OFFSETS = [7, 3, 1];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const fmt = (d: Date) => new Date(d).toLocaleDateString("en-IN");

export async function sendCompOffExpiryReminders(): Promise<{ sent: number }> {
  const today = startOfDay(new Date());
  let sent = 0;

  for (const offset of REMINDER_OFFSETS) {
    const target = new Date(today.getTime() + offset * 86400000);
    const targetEnd = new Date(target.getTime() + 86400000);

    const credits = await prisma.compOffCredit.findMany({
      where: {
        used: false,
        expiryDate: { gte: target, lt: targetEnd },
      },
      select: { id: true, employeeId: true, workDate: true, expiryDate: true, expiryRemindersSent: true },
    });

    for (const c of credits) {
      const already = (c.expiryRemindersSent ?? "").split(",").filter(Boolean);
      if (already.includes(String(offset))) continue;

      await createNotification(
        c.employeeId,
        `Your comp-off earned on ${fmt(c.workDate)} expires on ${fmt(c.expiryDate)} ` +
        `— ${offset} day${offset === 1 ? "" : "s"} left. Apply for CO leave before then or it will lapse.`,
        "Comp-off expiring",
      ).catch(() => undefined);

      await prisma.compOffCredit.update({
        where: { id: c.id },
        data: { expiryRemindersSent: [...already, String(offset)].join(",") },
      });
      sent++;
    }
  }

  return { sent };
}

export function initCompOffExpiryReminderCron() {
  // Daily at 09:30 — early enough that an employee can still act on it.
  cron.schedule("30 9 * * *", async () => {
    try {
      const { sent } = await sendCompOffExpiryReminders();
      if (sent > 0) console.log(`[CRON] comp-off expiry reminders: ${sent} sent`);
    } catch (e) {
      console.error("[CRON] sendCompOffExpiryReminders failed", e);
    }
  });
  console.log("🕒 Comp-off expiry reminder cron scheduled (09:30 daily)");
}
