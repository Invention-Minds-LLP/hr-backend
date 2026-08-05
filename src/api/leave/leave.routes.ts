import { Router } from "express";
import { createLeaveBalances, createLeaveRequest, createLeaveType, getBlockedDates, getCompOffCredits, getLeaveBalance, getLeaveDashboard, getLeaveRequests, getLeaveTypes, getMonthlyCasualUsage, getWhoIsOnLeaveBuckets, getWhoIsOnLeaveToday, updateLeaveStatus, updateLeaveType, uploadPrescription, triggerFYRollover, purgeAndRerunFYRollover, triggerELAccrual, updateLeaveRequest, cancelLeaveRequest } from "./leave.controller";
import { autoCancelLeaveIfPresent } from "../biometric/biometric.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

import { precheckLeave } from "./leavePrecheck.controller";

// Read-only pre-flight: tells the employee what will be unpaid and whether
// payroll for those dates has already been run, BEFORE they submit.
router.post("/precheck", authenticateToken, precheckLeave);

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
// Edit / cancel a pending leave (only allowed when no approver has acted)
router.put("/:id", authenticateToken, updateLeaveRequest);
router.patch("/:id/cancel", authenticateToken, cancelLeaveRequest);
router.get('/:id/dashboard',authenticateToken, getLeaveDashboard);
router.get('/leave-today',authenticateToken, getWhoIsOnLeaveBuckets);
router.get('/blocked/:employeeId', authenticateToken, getBlockedDates);
router.get('/balance/:employeeId', authenticateToken, getLeaveBalance);


router.post("/admin/fy-rollover", triggerFYRollover);
router.post("/admin/fy-rollover-purge", purgeAndRerunFYRollover);
router.post("/admin/el-accrual", triggerELAccrual);

// Test endpoint for auto-cancel leave
router.post("/admin/test-auto-cancel", async (req, res) => {
  try {
    const { employeeId, date } = req.body;
    if (!employeeId || !date) return res.status(400).json({ error: "employeeId and date required" });
    await autoCancelLeaveIfPresent(Number(employeeId), new Date(date));
    return res.json({ message: "Auto-cancel check completed", employeeId, date });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
