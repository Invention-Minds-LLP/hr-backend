"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const attendance_controller_1 = require("./attendance.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
//  GET /api/attendance-calendar/:employeeId?month=YYYY-MM
router.get('/:employeeId', authMiddleware_1.authenticateToken, attendance_controller_1.getAttendanceCalendar);
router.get("/", authMiddleware_1.authenticateToken, attendance_controller_1.getWeeklyAttendance);
router.post("/approve", authMiddleware_1.authenticateToken, attendance_controller_1.approveAttendance);
exports.default = router;
