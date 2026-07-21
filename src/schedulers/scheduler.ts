import { initSurveyScheduler } from "../api/survey/survery.controller";
import { initNoticePeriodSchedular } from "../api/resignation/resignation.controller";
import { initLeaveEndScheduler } from "../api/leave/leave.controller";
import { initQuarterlyAppraisalScheduler, sendAppraisalCountReminders } from "../api/appraisal/appraisal.controller";
import { startShiftCron } from "../api/shift/shift.controller";
import cron from 'node-cron';
import { runBiometricSync } from "../api/biometric/biometric.controller";
import { initFinancialYearRolloverCron, initELAccrualCron, initNewJoineeLeaveAllocationCron } from "../api/leave/leave.controller";
import { initAppraisalAutoDraftCron } from "../api/appraisal/appraisal-v2.controller";
import { initDirectorySyncCron } from "./directory-sync.scheduler";
import { expireStaleOffers, processReferralBonusEligibility, remindOverdueInterviewFeedback } from "../api/recruiting/recruiting.controller";
import { runIncidentDailyTasks } from "../api/incident/incident.controller";
import { sendPendingWorkReminders, sendWeeklyReportSubmissionReminders } from "../api/weekly-tracker/weekly-tracker.controller";
import { sendSelfRatingSubmissionReminders } from "../api/weekly-rating/weekly-rating.controller";
import { runMonthlyLateThresholdCheck } from "../api/attendance/late-threshold.controller";
import { initAttendanceReminderCrons } from "./attendance-reminders.scheduler";
import { flushSecurityAlerts } from "../lib/securityAlert";
import { config } from "../config";
import { prisma } from "../lib/prisma";
// import { sendInternshipEndReminders } from "../api/internship/internship.controller";

export async function startSchedulers() {
  initSurveyScheduler();
  initNoticePeriodSchedular();
  initLeaveEndScheduler();
  // initQuarterlyAppraisalScheduler();
  initAppraisalAutoDraftCron();
  startShiftCron();
  // sendAppraisalCountReminders();
  startAttendanceScheduler();
  // await runBiometricBackfill();

  initELAccrualCron();
  initFinancialYearRolloverCron();
  initNewJoineeLeaveAllocationCron();

  initDirectorySyncCron();
  initAttendanceReminderCrons();

  // Every 5 min — flush the security alert buffer. Sends ONE aggregated email
  // per IP/rule group of flagged API requests (anonymous hits on sensitive
  // routes, 401/403, brute force) accumulated since the last flush.
  if (config.security.accessLogEnabled) {
    cron.schedule("*/5 * * * *", async () => {
      try {
        const r = await flushSecurityAlerts();
        if (r.events > 0) console.log(`[CRON] security alerts: ${r.events} flagged request(s), emailed=${r.sent}`);
      } catch (e) {
        console.error("[CRON] flushSecurityAlerts failed", e);
      }
    });

    // Daily at 03:30 — prune ApiAccessLog rows older than the retention window
    // so the table doesn't grow unbounded.
    cron.schedule("30 3 * * *", async () => {
      try {
        const cutoff = new Date(Date.now() - config.security.retentionDays * 24 * 60 * 60 * 1000);
        const r = await prisma.apiAccessLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
        if (r.count > 0) console.log(`[CRON] pruned ${r.count} ApiAccessLog row(s) older than ${config.security.retentionDays}d`);
      } catch (e) {
        console.error("[CRON] ApiAccessLog prune failed", e);
      }
    });
  }

  // Daily at 02:00 — flip any unsigned offers past their proposedJoinAt to EXPIRED
  cron.schedule("0 2 * * *", async () => {
    try {
      const r = await expireStaleOffers();
      if (r.expired > 0) console.log(`[CRON] auto-expired ${r.expired} stale offers`);
    } catch (e) {
      console.error("[CRON] expireStaleOffers failed", e);
    }
  });

  // Daily at 02:30 — advance referral-bonus lifecycle
  // (PENDING_JOIN → PENDING_PROBATION → ELIGIBLE based on probation window)
  cron.schedule("30 2 * * *", async () => {
    try {
      const r = await processReferralBonusEligibility();
      if (r.joined || r.eligible) {
        console.log(`[CRON] referral-bonus: joined→probation=${r.joined}, probation→eligible=${r.eligible}`);
      }
    } catch (e) {
      console.error("[CRON] processReferralBonusEligibility failed", e);
    }
  });

  // Daily at 09:30 — nudge panel members who still owe overdue interview feedback
  cron.schedule("30 9 * * *", async () => {
    try {
      const r = await remindOverdueInterviewFeedback();
      if (r.reminders > 0) {
        console.log(`[CRON] interview-feedback reminders: ${r.interviews} interview(s), ${r.reminders} reminder(s)`);
      }
    } catch (e) {
      console.error("[CRON] remindOverdueInterviewFeedback failed", e);
    }
  });

  // Daily at 09:00 — remind employees (and their incharge/manager + HR digest)
  // about pending NOT_STARTED / IN_PROGRESS weekly tasks (overdue flagged).
  cron.schedule("0 9 * * *", async () => {
    try {
      const r = await sendPendingWorkReminders();
      if (r.employees > 0) console.log(`[CRON] weekly-tracker reminders: ${r.employees} employee(s), ${r.tasks} pending task(s)`);
    } catch (e) {
      console.error("[CRON] sendPendingWorkReminders failed", e);
    }
  });

  // Daily at 03:00 — incident SLA escalation + mandatory-reporting nudges.
  // Picks up incidents that breached their dueDate and bumps severity +
  // notifies HR/Mgmt + assignee. Also nudges anyone responsible for an
  // incident flagged for external authority reporting.
  cron.schedule("0 3 * * *", async () => {
    try {
      const r = await runIncidentDailyTasks();
      if (r.escalated || r.nudged) {
        console.log(`[CRON] incident daily: escalated=${r.escalated}, nudged=${r.nudged}`);
      }
    } catch (e) {
      console.error("[CRON] runIncidentDailyTasks failed", e);
    }
  });

  // Saturdays at 17:00 IST — remind employees who haven't submitted this week's
  // weekly performance report and/or weekly self rating.
  cron.schedule("0 17 * * 6", async () => {
    try {
      const tracker = await sendWeeklyReportSubmissionReminders();
      const rating = await sendSelfRatingSubmissionReminders();
      console.log(`[CRON] weekly submission reminders: tracker=${tracker.notified}, selfRating=${rating.notified}`);
    } catch (e) {
      console.error("[CRON] weekly submission reminders failed", e);
    }
  });

  // Daily at 10:00 IST — alert any employee whose cumulative late minutes this
  // month crossed the limit, plus HR and their reporting manager (once per
  // employee per month). Runs in the morning (not late at night) so the alert
  // arrives during work hours; the prior day's attendance is already synced.
  cron.schedule("0 10 * * *", async () => {
    try {
      const r = await runMonthlyLateThresholdCheck();
      if (r.notified > 0) console.log(`[CRON] monthly late threshold: ${r.notified} employee(s) alerted`);
    } catch (e) {
      console.error("[CRON] runMonthlyLateThresholdCheck failed", e);
    }
  });

  // Daily at 08:00 — nudge mentor + HR about internships ending soon, and HR
  // about overdue ones still marked Active (no status change; HR completes to
  // issue the certificate).
  // cron.schedule("0 8 * * *", async () => {
  //   try {
  //     const r = await sendInternshipEndReminders();
  //     if (r.endingSoon || r.overdue) {
  //       console.log(`[CRON] internship reminders: endingSoon=${r.endingSoon}, overdue=${r.overdue}`);
  //     }
  //   } catch (e) {
  //     console.error("[CRON] sendInternshipEndReminders failed", e);
  //   }
  // });
}
const schedules = [
  // 00
  // '* * * * *',
  // 06
  '02 6 * * *',
  '20 6 * * *',

  // 07
  '02 7 * * *',
  '20 7 * * *',

  // 08
  '02 8 * * *',
  '20 8 * * *',

  // 09
  '02 9 * * *',
  '20 9 * * *',

  // 10
  '02 10 * * *',
  '20 10 * * *',

  // 11
  '02 11 * * *',
  '20 11 * * *',

  // 12
  '02 12 * * *',
  '30 12 * * *',

  // 14
  '02 14 * * *',
  '20 14 * * *',

  // 16
  '02 16 * * *',
  '20 16 * * *',

  // 17
  '02 17 * * *',
  '20 17 * * *',

  // 18
  '02 18 * * *',
  '20 18 * * *',

  // 20 (FINAL RUNS)
  '02 20 * * *',
  '20 20 * * *',

  '02 21 * * *',
  '20 21 * * *',


  //22
  '0 22 * * *',



];


export function startAttendanceScheduler() {
  for (const schedule of schedules) {
    cron.schedule(schedule, async () => {
      const isFinalRun = schedule === '0 22 * * *';

      console.log(
        `[CRON] Attendance sync triggered | ${schedule} | Final: ${isFinalRun}`
      );

      try {
        await runBiometricSync(isFinalRun);
      } catch (err) {
        console.error('[CRON] Attendance sync failed', err);
      }
    });
  }
}
async function runBiometricBackfill() {
  const dates = [
    new Date('2026-02-03'),
    // new Date('2026-01-27'),
  ];

  for (const date of dates) {
    console.log(`🚀 Running biometric sync for ${date.toDateString()}`);
    // await runBiometricSync(date, true); // final run
  }

  console.log('✅ Backfill completed for all dates');
}
