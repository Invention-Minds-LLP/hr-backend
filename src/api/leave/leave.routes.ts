import { Router } from "express";
import { createLeaveRequest, createLeaveType, getLeaveDashboard, getLeaveRequests, getLeaveTypes, getWhoIsOnLeaveBuckets, getWhoIsOnLeaveToday, updateLeaveStatus } from "./leave.controller";

const router = Router();

router.post("/", createLeaveRequest);
router.get("/", getLeaveRequests);
router.post("/types", createLeaveType);
router.get("/types", getLeaveTypes);
router.patch("/:id/status", updateLeaveStatus);
router.get('/:id/dashboard', getLeaveDashboard);
router.get('/leave-today', getWhoIsOnLeaveBuckets);


export default router;
