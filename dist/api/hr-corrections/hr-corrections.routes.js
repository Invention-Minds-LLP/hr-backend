"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const hr_corrections_controller_1 = require("./hr-corrections.controller");
const router = (0, express_1.Router)();
// Punch Correction
router.post("/punch", authMiddleware_1.authenticateToken, hr_corrections_controller_1.correctPunch);
router.get("/punch", authMiddleware_1.authenticateToken, hr_corrections_controller_1.getPunchCorrectionList);
// Leave Balance Adjustment
router.post("/leave-balance", authMiddleware_1.authenticateToken, hr_corrections_controller_1.adjustLeaveBalance);
router.get("/leave-balance", authMiddleware_1.authenticateToken, hr_corrections_controller_1.getLeaveBalanceAdjustmentList);
// Apply Leave on behalf of an employee (HR override — auto-approved + deducted)
router.post("/leave-apply", authMiddleware_1.authenticateToken, hr_corrections_controller_1.applyLeaveOnBehalf);
router.get("/leave-apply", authMiddleware_1.authenticateToken, hr_corrections_controller_1.getHrAppliedLeaveList);
// Attendance Override
router.post("/attendance-override", authMiddleware_1.authenticateToken, hr_corrections_controller_1.overrideAttendanceStatus);
router.get("/attendance-override", authMiddleware_1.authenticateToken, hr_corrections_controller_1.getAttendanceOverrideList);
// Permission Override
router.post("/permission", authMiddleware_1.authenticateToken, hr_corrections_controller_1.grantPermissionOverride);
router.get("/permission", authMiddleware_1.authenticateToken, hr_corrections_controller_1.getPermissionOverrideList);
// Comp-Off Manual Grant
router.post("/comp-off", authMiddleware_1.authenticateToken, hr_corrections_controller_1.manualCompOffGrant);
router.get("/comp-off", authMiddleware_1.authenticateToken, hr_corrections_controller_1.getCompOffGrantList);
// OT Manual Entry
router.post("/ot", authMiddleware_1.authenticateToken, hr_corrections_controller_1.manualOTEntry);
router.get("/ot", authMiddleware_1.authenticateToken, hr_corrections_controller_1.getOTManualEntryList);
// Week-off / Holiday Override
router.post("/weekoff-holiday", authMiddleware_1.authenticateToken, hr_corrections_controller_1.weekOffHolidayOverride);
router.get("/weekoff-holiday", authMiddleware_1.authenticateToken, hr_corrections_controller_1.getWeekOffHolidayOverrideList);
// Appraisal Override
router.get("/appraisals/search", authMiddleware_1.authenticateToken, hr_corrections_controller_1.searchAppraisals);
router.post("/appraisals/override", authMiddleware_1.authenticateToken, hr_corrections_controller_1.appraisalOverride);
router.get("/appraisals/override", authMiddleware_1.authenticateToken, hr_corrections_controller_1.getAppraisalOverrideList);
// Helpers
router.get("/leave-types", authMiddleware_1.authenticateToken, hr_corrections_controller_1.getLeaveTypes);
exports.default = router;
