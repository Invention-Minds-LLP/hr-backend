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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const leave_controller_1 = require("./leave.controller");
const biometric_controller_1 = require("../biometric/biometric.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
router.post("/", authMiddleware_1.authenticateToken, leave_controller_1.createLeaveRequest);
router.get("/", authMiddleware_1.authenticateToken, leave_controller_1.getLeaveRequests);
router.post("/types", authMiddleware_1.authenticateToken, leave_controller_1.createLeaveType);
router.get("/types", authMiddleware_1.authenticateToken, leave_controller_1.getLeaveTypes);
router.post("/leave-balances", leave_controller_1.createLeaveBalances);
router.post("/:leaveId/prescription", leave_controller_1.uploadPrescription);
router.get('/casual/monthly-usage', authMiddleware_1.authenticateToken, leave_controller_1.getMonthlyCasualUsage);
router.get("/comp-off/credits", leave_controller_1.getCompOffCredits);
router.put("/update-leave-type/:id", leave_controller_1.updateLeaveType);
router.patch("/:id/status", authMiddleware_1.authenticateToken, leave_controller_1.updateLeaveStatus);
// Edit / cancel a pending leave (only allowed when no approver has acted)
router.put("/:id", authMiddleware_1.authenticateToken, leave_controller_1.updateLeaveRequest);
router.patch("/:id/cancel", authMiddleware_1.authenticateToken, leave_controller_1.cancelLeaveRequest);
router.get('/:id/dashboard', authMiddleware_1.authenticateToken, leave_controller_1.getLeaveDashboard);
router.get('/leave-today', authMiddleware_1.authenticateToken, leave_controller_1.getWhoIsOnLeaveBuckets);
router.get('/blocked/:employeeId', authMiddleware_1.authenticateToken, leave_controller_1.getBlockedDates);
router.get('/balance/:employeeId', authMiddleware_1.authenticateToken, leave_controller_1.getLeaveBalance);
router.post("/admin/fy-rollover", leave_controller_1.triggerFYRollover);
router.post("/admin/fy-rollover-purge", leave_controller_1.purgeAndRerunFYRollover);
router.post("/admin/el-accrual", leave_controller_1.triggerELAccrual);
// Test endpoint for auto-cancel leave
router.post("/admin/test-auto-cancel", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, date } = req.body;
        if (!employeeId || !date)
            return res.status(400).json({ error: "employeeId and date required" });
        yield (0, biometric_controller_1.autoCancelLeaveIfPresent)(Number(employeeId), new Date(date));
        return res.json({ message: "Auto-cancel check completed", employeeId, date });
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
}));
exports.default = router;
