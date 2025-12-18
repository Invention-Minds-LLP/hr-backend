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
exports.approveAttendance = exports.getWeeklyAttendance = exports.getAttendanceCalendar = void 0;
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const getAttendanceCalendar = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        const month = req.query.month; // e.g. 2025-10
        if (!employeeId || !month)
            return res.status(400).json({ message: 'employeeId and month are required' });
        const start = new Date(`${month}-01T00:00:00`);
        const end = new Date(start);
        end.setMonth(end.getMonth() + 1);
        const [attendance, leaves, permissions, shiftSettings] = yield Promise.all([
            prisma_1.prisma.attendance.findMany({
                where: { employeeId, date: { gte: start, lt: end } },
            }),
            prisma_1.prisma.leaveRequest.findMany({
                where: {
                    employeeId,
                    status: 'APPROVED',
                    OR: [
                        { startDate: { gte: start, lt: end } },
                        { endDate: { gte: start, lt: end } },
                    ],
                },
                include: { leaveType: true },
            }),
            prisma_1.prisma.permissionRequest.findMany({
                where: {
                    employeeId,
                    status: 'APPROVED',
                    day: { gte: start, lt: end },
                },
            }),
            prisma_1.prisma.employeeShiftSetting.findMany({
                where: { employeeId },
                include: {
                    fixedShift: true,
                    rotationPattern: {
                        include: {
                            items: { include: { shift: true } }
                        }
                    }
                }
            })
        ]);
        // console.log('Attendance records:', attendance);
        const shiftMap = buildShiftMap(shiftSettings, start);
        const result = [
            ...attendance.map(a => {
                const checkIn = a.checkIn ? new Date(a.checkIn) : null;
                const checkOut = a.checkOut ? new Date(a.checkOut) : null;
                const shift = shiftMap.get(a.employeeId);
                const shiftStart = (shift === null || shift === void 0 ? void 0 : shift.start) || null;
                const shiftEnd = (shift === null || shift === void 0 ? void 0 : shift.end) || null;
                // ------ WORKING HOURS ------
                const hours = checkIn && checkOut ? Math.round(((checkOut.getTime() - checkIn.getTime())) / 3600000) : 0;
                // ------ FLAGS ------
                let flag = null;
                // Late login
                if (checkIn && shiftStart && checkIn > shiftStart) {
                    flag = "late-login";
                }
                // Early logout
                if (checkOut && shiftEnd && checkOut < shiftEnd) {
                    flag = flag ? `${flag},early-logout` : "early-logout";
                }
                // Half day
                if (hours > 0 && hours < 4) {
                    flag = "half-day";
                }
                // ----- Determine finalStatus -----
                let finalStatus = a.status; // Present / Absent from DB
                if (flag) { // late login, early logout, half day
                    if (!a.attendanceApproval) {
                        finalStatus = 'PendingApproval';
                    }
                    else if (a.attendanceApproval === 'APPROVED') {
                        finalStatus = 'Present';
                    }
                    else if (a.attendanceApproval === 'REJECTED') {
                        finalStatus = 'Absent';
                    }
                }
                return {
                    title: `Worked ${hours}h`,
                    start: a.date,
                    type: 'attendance',
                    status: a.status,
                    checkIn: a.checkIn,
                    checkOut: a.checkOut,
                    hours,
                    shiftStart,
                    shiftEnd,
                    flag,
                    finalStatus, // ⭐ THIS is your computed attendance status
                    needsApproval: !!flag && a.attendanceApproval === null,
                    attendanceApproval: a.attendanceApproval,
                    approvedBy: a.approvedBy,
                    approvedAt: a.approvedAt,
                    attendanceId: a.id,
                };
            }),
            ...leaves.map(l => {
                var _a, _b;
                return ({
                    title: `Leave (${(_b = (_a = l.leaveType) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : 'Unknown'})`,
                    start: l.startDate,
                    end: l.endDate,
                    type: 'leave',
                });
            }),
            ...permissions.map(p => {
                var _a;
                return ({
                    title: `Permission ${(_a = p.timing) !== null && _a !== void 0 ? _a : ''}`,
                    start: p.day,
                    type: 'permission',
                });
            }),
        ];
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err });
    }
});
exports.getAttendanceCalendar = getAttendanceCalendar;
const getWeeklyAttendance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, start, end } = req.query;
        if (!employeeId || !start || !end) {
            return res.status(400).json({ message: "Missing parameters" });
        }
        const startDate = new Date(start);
        const endDate = new Date(end);
        const attendance = yield prisma_1.prisma.attendance.findMany({
            where: {
                employeeId: Number(employeeId),
                date: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            orderBy: { date: 'asc' },
        });
        res.json(attendance);
    }
    catch (error) {
        console.error("Error fetching attendance:", error);
        res.status(500).json({ message: "Server error" });
    }
});
exports.getWeeklyAttendance = getWeeklyAttendance;
function buildShiftMap(settings, monthStart) {
    var _a, _b, _c, _d;
    const map = new Map();
    for (const s of settings) {
        // FIXED SHIFT
        if (s.mode === 'FIXED' && ((_a = s.fixedShift) === null || _a === void 0 ? void 0 : _a.startTime) && ((_b = s.fixedShift) === null || _b === void 0 ? void 0 : _b.endTime)) {
            map.set(s.employeeId, {
                start: combineDateAndTime(monthStart, s.fixedShift.startTime),
                end: combineDateAndTime(monthStart, s.fixedShift.endTime)
            });
        }
        // ROTATIONAL SHIFT
        else if (s.mode === 'ROTATIONAL' && ((_d = (_c = s.rotationPattern) === null || _c === void 0 ? void 0 : _c.items) === null || _d === void 0 ? void 0 : _d.length)) {
            // take first rotation (or you can calculate based on date index later)
            const shiftObj = s.rotationPattern.items[0].shift;
            if ((shiftObj === null || shiftObj === void 0 ? void 0 : shiftObj.startTime) && (shiftObj === null || shiftObj === void 0 ? void 0 : shiftObj.endTime)) {
                map.set(s.employeeId, {
                    start: combineDateAndTime(monthStart, shiftObj.startTime),
                    end: combineDateAndTime(monthStart, shiftObj.endTime)
                });
            }
        }
    }
    return map;
}
function combineDateAndTime(base, t) {
    const dt = new Date(base);
    const tt = new Date(t);
    dt.setHours(tt.getHours(), tt.getMinutes(), 0, 0);
    return dt;
}
const approveAttendance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { attendanceId, decision, hrId, rejectReason } = req.body;
        if (!attendanceId || !decision || !hrId)
            return res.status(400).json({ message: "Missing required fields" });
        const updateData = {
            attendanceApproval: decision,
            approvedBy: hrId,
            approvedAt: new Date(),
        };
        // Only save reason if rejected
        if (decision === 'REJECTED') {
            updateData.reason = rejectReason || "No reason provided";
        }
        const record = yield prisma_1.prisma.attendance.update({
            where: { id: attendanceId },
            data: updateData
        });
        res.json({
            message: "Attendance updated successfully",
            updated: record
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err });
    }
});
exports.approveAttendance = approveAttendance;
