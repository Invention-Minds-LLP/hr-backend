import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { createNotification } from '../api/notifications/notifications.controller';
import { openDueEvaluations } from '../api/probation/probation.controller';
import { REMINDER_OFFSETS } from '../lib/probation';

// ─────────────────────────────────────────────────────────────────────────────
// Probation evaluation cron.
//
// Two jobs in one daily pass:
//   1. Open a PENDING_MANAGER evaluation for everyone whose probation window has
//      closed — the initial six-month review and, after HR grants an extension,
//      the re-evaluation on the next review date.
//   2. Chase managers who have not filled the form in.
//
// Reminder offsets are recorded on the evaluation (remindersSent) so a re-run,
// a restart, or two workers can never double-notify — the same idempotency
// trick as CompOffCredit.expiryRemindersSent.
//
// Times are in the process timezone (TZ=Asia/Kolkata in the Dockerfile).
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export async function sendProbationReminders(asOf: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0;

  const pending = await prisma.probationEvaluation.findMany({
    where: { status: 'PENDING_MANAGER', managerId: { not: null } },
    select: {
      id: true,
      managerId: true,
      dueDate: true,
      round: true,
      remindersSent: true,
      employee: { select: { firstName: true, lastName: true } },
    },
  });

  for (const ev of pending) {
    const overdueDays = Math.floor((asOf.getTime() - new Date(ev.dueDate).getTime()) / 86400000);
    // The largest offset already passed is the one to send — a job that was
    // down for a week sends one catch-up nudge, not four.
    const due = REMINDER_OFFSETS.filter((o) => overdueDays >= o).sort((a, b) => b - a)[0];
    if (due === undefined) continue;

    const already = (ev.remindersSent ?? '').split(',').filter(Boolean);
    if (already.includes(String(due))) continue;

    const name = `${ev.employee?.firstName ?? ''} ${ev.employee?.lastName ?? ''}`.trim();
    await createNotification(
      ev.managerId!,
      `Reminder: the Probation Evaluation for ${name} was due on ${fmt(ev.dueDate)} ` +
        `and is ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue. Please complete the form.`,
      '📋 Probation Evaluation',
    ).catch(() => undefined);

    // Older offsets are marked alongside the one just sent so a catch-up run
    // does not fire them tomorrow.
    const marked = [...new Set([...already, ...REMINDER_OFFSETS.filter((o) => o <= due).map(String)])];
    await prisma.probationEvaluation.update({
      where: { id: ev.id },
      data: { remindersSent: marked.join(',') },
    });
    sent++;
  }

  return { sent };
}

export function initProbationEvaluationCron() {
  // Daily at 09:15 — between the 09:00 weekly-tracker digest and the 09:30
  // comp-off/interview jobs, so the morning notifications do not all land at once.
  cron.schedule('15 9 * * *', async () => {
    try {
      const opened = await openDueEvaluations();
      if (opened.opened > 0) {
        console.log(
          `[CRON] probation evaluations: opened=${opened.opened} (unassigned=${opened.unassigned})`,
        );
      }
    } catch (e) {
      console.error('[CRON] openDueEvaluations failed', e);
    }

    try {
      const { sent } = await sendProbationReminders();
      if (sent > 0) console.log(`[CRON] probation evaluation reminders: ${sent} sent`);
    } catch (e) {
      console.error('[CRON] sendProbationReminders failed', e);
    }
  });
  console.log('🕒 Probation evaluation cron scheduled (09:15 daily)');
}
