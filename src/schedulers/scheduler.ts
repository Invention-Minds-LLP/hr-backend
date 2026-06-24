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
import { expireStaleOffers, processReferralBonusEligibility } from "../api/recruiting/recruiting.controller";
import { runIncidentDailyTasks } from "../api/incident/incident.controller";
import { sendPendingWorkReminders } from "../api/weekly-tracker/weekly-tracker.controller";
import { initAttendanceReminderCrons } from "./attendance-reminders.scheduler";
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
