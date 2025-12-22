import { Router } from "express";
import { createLeaveBalances, createLeaveRequest, createLeaveType, getBlockedDates, getLeaveBalance, getLeaveDashboard, getLeaveRequests, getLeaveTypes, getWhoIsOnLeaveBuckets, getWhoIsOnLeaveToday, updateLeaveStatus, updateLeaveType } from "./leave.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/",authenticateToken, createLeaveRequest);
router.get("/",authenticateToken, getLeaveRequests);
router.post("/types",authenticateToken, createLeaveType);
router.get("/types",authenticateToken, getLeaveTypes);
router.post("/leave-balances", createLeaveBalances);

router.put("/update-leave-type/:id", updateLeaveType);
router.patch("/:id/status",authenticateToken, updateLeaveStatus);
router.get('/:id/dashboard',authenticateToken, getLeaveDashboard);
router.get('/leave-today',authenticateToken, getWhoIsOnLeaveBuckets);
router.get('/blocked/:employeeId', authenticateToken, getBlockedDates);
router.get('/balance/:employeeId', authenticateToken, getLeaveBalance);


export default router;
