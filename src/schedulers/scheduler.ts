import { initSurveyScheduler } from "../api/survey/survery.controller";
import { initNoticePeriodSchedular } from "../api/resignation/resignation.controller";
import { initLeaveEndSchedular } from "../api/leave/leave.controller";
import { initQuarterlyAppraisalScheduler } from "../api/appraisal/appraisal.controller";
import { startShiftCron } from "../api/shift/shift.controller";
import cron from 'node-cron';
import { runBiometricSync } from "../api/biometric/biometric.controller";

export async function startSchedulers() {
  initSurveyScheduler();
  initNoticePeriodSchedular();
  initLeaveEndSchedular();
  initQuarterlyAppraisalScheduler();
  startShiftCron();
  startAttendanceScheduler();
  // await runBiometricBackfill();
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
  '20 12 * * *',

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

  //21
  '* 21 * * *',

];


export function startAttendanceScheduler() {
  for (const schedule of schedules) {
    cron.schedule(schedule, async () => {
      const isFinalRun = schedule === '* 21 * * *';

      console.log(
        `[CRON] Attendance sync triggered | ${schedule} | Final: ${isFinalRun}`
      );

      try {
        // await runBiometricSync(isFinalRun);
      } catch (err) {
        console.error('[CRON] Attendance sync failed', err);
      }
    });
  }
}
async function runBiometricBackfill() {
  const dates = [
    new Date('2026-01-07'),
    new Date('2026-01-08'),
    new Date('2026-01-09'),
  ];

  for (const date of dates) {
    console.log(`🚀 Running biometric sync for ${date.toDateString()}`);
    await runBiometricSync(date, true); // final run
  }

  console.log('✅ Backfill completed for all dates');
}
