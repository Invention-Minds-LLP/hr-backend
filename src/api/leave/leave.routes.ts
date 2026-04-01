import { Router } from "express";
import { createLeaveBalances, createLeaveRequest, createLeaveType, getBlockedDates, getCompOffCredits, getLeaveBalance, getLeaveDashboard, getLeaveRequests, getLeaveTypes, getMonthlyCasualUsage, getWhoIsOnLeaveBuckets, getWhoIsOnLeaveToday, updateLeaveStatus, updateLeaveType, uploadPrescription, triggerFYRollover, purgeAndRerunFYRollover, triggerELAccrual } from "./leave.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/",authenticateToken, createLeaveRequest);
router.get("/",authenticateToken, getLeaveRequests);
router.post("/types",authenticateToken, createLeaveType);
router.get("/types",authenticateToken, getLeaveTypes);
router.post("/leave-balances", createLeaveBalances);
router.post(
  "/:leaveId/prescription",
  uploadPrescription
);
router.get(
  '/casual/monthly-usage',
  authenticateToken,
  getMonthlyCasualUsage
);
router.get("/comp-off/credits", getCompOffCredits);
router.put("/update-leave-type/:id", updateLeaveType);
router.patch("/:id/status",authenticateToken, updateLeaveStatus);
router.get('/:id/dashboard',authenticateToken, getLeaveDashboard);
router.get('/leave-today',authenticateToken, getWhoIsOnLeaveBuckets);
router.get('/blocked/:employeeId', authenticateToken, getBlockedDates);
router.get('/balance/:employeeId', authenticateToken, getLeaveBalance);


router.post("/admin/fy-rollover", triggerFYRollover);
router.post("/admin/fy-rollover-purge", purgeAndRerunFYRollover);
router.post("/admin/el-accrual", triggerELAccrual);

export default router;
