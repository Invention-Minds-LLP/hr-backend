"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSchedulers = startSchedulers;
const survery_controller_1 = require("../api/survey/survery.controller");
const resignation_controller_1 = require("../api/resignation/resignation.controller");
const leave_controller_1 = require("../api/leave/leave.controller");
const appraisal_controller_1 = require("../api/appraisal/appraisal.controller");
const shift_controller_1 = require("../api/shift/shift.controller");
function startSchedulers() {
    (0, survery_controller_1.initSurveyScheduler)();
    (0, resignation_controller_1.initNoticePeriodSchedular)();
    (0, leave_controller_1.initLeaveEndSchedular)();
    (0, appraisal_controller_1.initQuarterlyAppraisalScheduler)();
    (0, shift_controller_1.startShiftCron)();
}
