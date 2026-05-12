import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  correctPunch,
  getPunchCorrectionList,
  adjustLeaveBalance,
  getLeaveBalanceAdjustmentList,
  overrideAttendanceStatus,
  getAttendanceOverrideList,
  grantPermissionOverride,
  getPermissionOverrideList,
  manualCompOffGrant,
  getCompOffGrantList,
  manualOTEntry,
  getOTManualEntryList,
  weekOffHolidayOverride,
  getWeekOffHolidayOverrideList,
  searchAppraisals,
  appraisalOverride,
  getAppraisalOverrideList,
  getLeaveTypes,
  applyLeaveOnBehalf,
  getHrAppliedLeaveList,
} from "./hr-corrections.controller";

const router = Router();

// Punch Correction
router.post("/punch", authenticateToken, correctPunch);
router.get("/punch", authenticateToken, getPunchCorrectionList);

// Leave Balance Adjustment
router.post("/leave-balance", authenticateToken, adjustLeaveBalance);
router.get("/leave-balance", authenticateToken, getLeaveBalanceAdjustmentList);

// Apply Leave on behalf of an employee (HR override — auto-approved + deducted)
router.post("/leave-apply", authenticateToken, applyLeaveOnBehalf);
router.get("/leave-apply", authenticateToken, getHrAppliedLeaveList);

// Attendance Override
router.post("/attendance-override", authenticateToken, overrideAttendanceStatus);
router.get("/attendance-override", authenticateToken, getAttendanceOverrideList);

// Permission Override
router.post("/permission", authenticateToken, grantPermissionOverride);
router.get("/permission", authenticateToken, getPermissionOverrideList);

// Comp-Off Manual Grant
router.post("/comp-off", authenticateToken, manualCompOffGrant);
router.get("/comp-off", authenticateToken, getCompOffGrantList);

// OT Manual Entry
router.post("/ot", authenticateToken, manualOTEntry);
router.get("/ot", authenticateToken, getOTManualEntryList);

// Week-off / Holiday Override
router.post("/weekoff-holiday", authenticateToken, weekOffHolidayOverride);
router.get("/weekoff-holiday", authenticateToken, getWeekOffHolidayOverrideList);

// Appraisal Override
router.get("/appraisals/search", authenticateToken, searchAppraisals);
router.post("/appraisals/override", authenticateToken, appraisalOverride);
router.get("/appraisals/override", authenticateToken, getAppraisalOverrideList);

// Helpers
router.get("/leave-types", authenticateToken, getLeaveTypes);

export default router;
