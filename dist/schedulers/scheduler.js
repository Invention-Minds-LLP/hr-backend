"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSchedulers = startSchedulers;
exports.startAttendanceScheduler = startAttendanceScheduler;
const survery_controller_1 = require("../api/survey/survery.controller");
const resignation_controller_1 = require("../api/resignation/resignation.controller");
const leave_controller_1 = require("../api/leave/leave.controller");
const shift_controller_1 = require("../api/shift/shift.controller");
const node_cron_1 = __importDefault(require("node-cron"));
const biometric_controller_1 = require("../api/biometric/biometric.controller");
const leave_controller_2 = require("../api/leave/leave.controller");
const appraisal_v2_controller_1 = require("../api/appraisal/appraisal-v2.controller");
const directory_sync_scheduler_1 = require("./directory-sync.scheduler");
const recruiting_controller_1 = require("../api/recruiting/recruiting.controller");
const incident_controller_1 = require("../api/incident/incident.controller");
function startSchedulers() {
    return __awaiter(this, void 0, void 0, function* () {
        (0, survery_controller_1.initSurveyScheduler)();
        (0, resignation_controller_1.initNoticePeriodSchedular)();
        (0, leave_controller_1.initLeaveEndScheduler)();
        // initQuarterlyAppraisalScheduler();
        (0, appraisal_v2_controller_1.initAppraisalAutoDraftCron)();
        (0, shift_controller_1.startShiftCron)();
        // sendAppraisalCountReminders();
        startAttendanceScheduler();
        // await runBiometricBackfill();
        (0, leave_controller_2.initELAccrualCron)();
        (0, leave_controller_2.initFinancialYearRolloverCron)();
        (0, leave_controller_2.initNewJoineeLeaveAllocationCron)();
        (0, directory_sync_scheduler_1.initDirectorySyncCron)();
        // Daily at 02:00 — flip any unsigned offers past their proposedJoinAt to EXPIRED
        node_cron_1.default.schedule("0 2 * * *", () => __awaiter(this, void 0, void 0, function* () {
            try {
                const r = yield (0, recruiting_controller_1.expireStaleOffers)();
                if (r.expired > 0)
                    console.log(`[CRON] auto-expired ${r.expired} stale offers`);
            }
            catch (e) {
                console.error("[CRON] expireStaleOffers failed", e);
            }
        }));
        // Daily at 02:30 — advance referral-bonus lifecycle
        // (PENDING_JOIN → PENDING_PROBATION → ELIGIBLE based on probation window)
        node_cron_1.default.schedule("30 2 * * *", () => __awaiter(this, void 0, void 0, function* () {
            try {
                const r = yield (0, recruiting_controller_1.processReferralBonusEligibility)();
                if (r.joined || r.eligible) {
                    console.log(`[CRON] referral-bonus: joined→probation=${r.joined}, probation→eligible=${r.eligible}`);
                }
            }
            catch (e) {
                console.error("[CRON] processReferralBonusEligibility failed", e);
            }
        }));
        // Daily at 03:00 — incident SLA escalation + mandatory-reporting nudges.
        // Picks up incidents that breached their dueDate and bumps severity +
        // notifies HR/Mgmt + assignee. Also nudges anyone responsible for an
        // incident flagged for external authority reporting.
        node_cron_1.default.schedule("0 3 * * *", () => __awaiter(this, void 0, void 0, function* () {
            try {
                const r = yield (0, incident_controller_1.runIncidentDailyTasks)();
                if (r.escalated || r.nudged) {
                    console.log(`[CRON] incident daily: escalated=${r.escalated}, nudged=${r.nudged}`);
                }
            }
            catch (e) {
                console.error("[CRON] runIncidentDailyTasks failed", e);
            }
        }));
    });
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
    '02 21 * * *',
    '20 21 * * *',
    //22
    '0 22 * * *',
];
function startAttendanceScheduler() {
    for (const schedule of schedules) {
        node_cron_1.default.schedule(schedule, () => __awaiter(this, void 0, void 0, function* () {
            const isFinalRun = schedule === '0 22 * * *';
            console.log(`[CRON] Attendance sync triggered | ${schedule} | Final: ${isFinalRun}`);
            try {
                yield (0, biometric_controller_1.runBiometricSync)(isFinalRun);
            }
            catch (err) {
                console.error('[CRON] Attendance sync failed', err);
            }
        }));
    }
}
function runBiometricBackfill() {
    return __awaiter(this, void 0, void 0, function* () {
        const dates = [
            new Date('2026-02-03'),
            // new Date('2026-01-27'),
        ];
        for (const date of dates) {
            console.log(`🚀 Running biometric sync for ${date.toDateString()}`);
            // await runBiometricSync(date, true); // final run
        }
        console.log('✅ Backfill completed for all dates');
    });
}
