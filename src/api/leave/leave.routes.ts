import { Router } from "express";
import { createLeaveRequest, createLeaveType, getLeaveDashboard, getLeaveRequests, getLeaveTypes, getWhoIsOnLeaveBuckets, getWhoIsOnLeaveToday, updateLeaveStatus } from "./leave.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/",authenticateToken, createLeaveRequest);
router.get("/",authenticateToken, getLeaveRequests);
router.post("/types",authenticateToken, createLeaveType);
router.get("/types",authenticateToken, getLeaveTypes);
router.patch("/:id/status",authenticateToken, updateLeaveStatus);
router.get('/:id/dashboard',authenticateToken, getLeaveDashboard);
router.get('/leave-today',authenticateToken, getWhoIsOnLeaveBuckets);


export default router;
