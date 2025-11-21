"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const attendance_controller_1 = require("./attendance.controller");
const router = (0, express_1.Router)();
//  GET /api/attendance-calendar/:employeeId?month=YYYY-MM
router.get('/:employeeId', attendance_controller_1.getAttendanceCalendar);
exports.default = router;
