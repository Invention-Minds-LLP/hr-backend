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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.remindMissingCheckIn = remindMissingCheckIn;
exports.remindMissingCheckOut = remindMissingCheckOut;
exports.initAttendanceReminderCrons = initAttendanceReminderCrons;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = require("../lib/prisma");
const notifications_controller_1 = require("../api/notifications/notifications.controller");
const comOff_service_1 = require("../services/comOff.service");
// ─────────────────────────────────────────────────────────────────────────────
// Attendance reminders (IM only — gated by ATTENDANCE_REMINDERS env flag)
//   1) 13:00 daily  — remind employees who haven't checked in (and aren't on
//      approved leave / week-off) for the day.
//   2) every 15 min — remind employees who checked in but haven't checked out
//      once it's 15 min past their shift end ("attendance won't be counted").
//
// Times are computed in the process timezone (TZ=Asia/Kolkata in the Dockerfile).
// Shift times are stored as DateTime where the UTC hours represent the IST
// wall-clock (e.g. 17:30Z == 5:30 PM IST), so shift-end is built with UTC parts.
// ─────────────────────────────────────────────────────────────────────────────
const CHECKOUT_MARKER = "attendance won't be counted";
function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
// Build the real shift-end instant for a given work date (handles overnight shifts).
// Mirrors biometric.controller.ts:combineShiftEnd.
function combineShiftEnd(day, start, end) {
    const dayIst = new Date(day.getTime() + 5.5 * 3600000);
    const result = new Date(Date.UTC(dayIst.getUTCFullYear(), dayIst.getUTCMonth(), dayIst.getUTCDate(), end.getUTCHours(), end.getUTCMinutes(), end.getUTCSeconds()));
    const endMins = end.getUTCHours() * 60 + end.getUTCMinutes();
    const startMins = start.getUTCHours() * 60 + start.getUTCMinutes();
    if (endMins < startMins)
        result.setUTCDate(result.getUTCDate() + 1); // overnight
    return result;
}
// Resolve an employee's shift (start/end templates) for a given work date.
// Per-date ShiftAssignment first, then the employee's FIXED shift as fallback.
function resolveShiftEnd(employeeId, workDate) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const assignment = yield prisma_1.prisma.shiftAssignment.findFirst({
            where: { employeeId, date: { gte: startOfDay(workDate), lt: new Date(startOfDay(workDate).getTime() + 86400000) } },
            include: { shift: true },
        });
        let shift = (_a = assignment === null || assignment === void 0 ? void 0 : assignment.shift) !== null && _a !== void 0 ? _a : null;
        if (!shift) {
            const setting = yield prisma_1.prisma.employeeShiftSetting.findUnique({
                where: { employeeId },
                include: { fixedShift: true },
            });
            shift = (_b = setting === null || setting === void 0 ? void 0 : setting.fixedShift) !== null && _b !== void 0 ? _b : null;
        }
        if (!(shift === null || shift === void 0 ? void 0 : shift.startTime) || !(shift === null || shift === void 0 ? void 0 : shift.endTime))
            return null;
        return combineShiftEnd(workDate, new Date(shift.startTime), new Date(shift.endTime));
    });
}
function hasApprovedLeaveToday(employeeId, dayStart, dayEnd) {
    return __awaiter(this, void 0, void 0, function* () {
        const leave = yield prisma_1.prisma.leaveRequest.findFirst({
            where: {
                employeeId,
                status: "APPROVED",
                startDate: { lte: dayEnd },
                endDate: { gte: dayStart },
            },
            select: { id: true },
        });
        return !!leave;
    });
}
// ── Job 1: missing check-in (runs once at 13:00) ────────────────────────────
function remindMissingCheckIn() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const dayStart = startOfDay(now);
        const dayEnd = new Date(dayStart.getTime() + 86400000);
        const employees = yield prisma_1.prisma.employee.findMany({
            where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } },
            select: { id: true },
        });
        let sent = 0;
        for (const e of employees) {
            try {
                if (yield (0, comOff_service_1.isWeeklyOff)(e.id, dayStart))
                    continue;
                if (yield hasApprovedLeaveToday(e.id, dayStart, dayEnd))
                    continue;
                const att = yield prisma_1.prisma.attendance.findFirst({
                    where: { employeeId: e.id, date: { gte: dayStart, lt: dayEnd } },
                    select: { checkIn: true },
                });
                if (att === null || att === void 0 ? void 0 : att.checkIn)
                    continue;
                yield (0, notifications_controller_1.createNotification)(e.id, "You haven't checked in today. Please check in, or apply for leave if you are not working today.");
                sent++;
            }
            catch (err) {
                console.error(`[attendance-reminders] check-in reminder failed for emp ${e.id}`, err);
            }
        }
        return { candidates: employees.length, sent };
    });
}
// ── Job 2: missing check-out (runs every 15 min) ────────────────────────────
function remindMissingCheckOut() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const dayStart = startOfDay(now);
        // Look back one extra day so overnight shifts that started "yesterday" are caught.
        const windowStart = new Date(dayStart.getTime() - 86400000);
        // Open attendances: checked in, not checked out.
        const open = yield prisma_1.prisma.attendance.findMany({
            where: {
                date: { gte: windowStart },
                checkIn: { not: null },
                checkOut: null,
            },
            select: { employeeId: true, date: true },
        });
        let sent = 0;
        for (const att of open) {
            try {
                const shiftEnd = yield resolveShiftEnd(att.employeeId, new Date(att.date));
                if (!shiftEnd)
                    continue; // can't determine shift end — skip rather than spam
                // Only after shift end + 15 minutes.
                if (now.getTime() < shiftEnd.getTime() + 15 * 60000)
                    continue;
                // De-dupe: one check-out reminder per employee per day.
                const already = yield prisma_1.prisma.notification.findFirst({
                    where: {
                        employeeId: att.employeeId,
                        createdAt: { gte: dayStart },
                        message: { contains: CHECKOUT_MARKER },
                    },
                    select: { id: true },
                });
                if (already)
                    continue;
                yield (0, notifications_controller_1.createNotification)(att.employeeId, `You haven't checked out after your shift. If you don't check out, this ${CHECKOUT_MARKER}.`);
                sent++;
            }
            catch (err) {
                console.error(`[attendance-reminders] check-out reminder failed for emp ${att.employeeId}`, err);
            }
        }
        return { open: open.length, sent };
    });
}
// ── Registration (gated by env flag so only the IM deployment runs it) ──────
function initAttendanceReminderCrons() {
    const enabled = ["true", "1", "yes"].includes((process.env.ATTENDANCE_REMINDERS || "").toLowerCase());
    if (!enabled) {
        console.log("[attendance-reminders] disabled (set ATTENDANCE_REMINDERS=true to enable)");
        return;
    }
    // 13:00 daily — missing check-in.
    node_cron_1.default.schedule("0 13 * * *", () => __awaiter(this, void 0, void 0, function* () {
        try {
            const r = yield remindMissingCheckIn();
            console.log(`[CRON] check-in reminders: ${r.sent}/${r.candidates}`);
        }
        catch (e) {
            console.error("[CRON] remindMissingCheckIn failed", e);
        }
    }));
    // Every 15 minutes — missing check-out (15 min past each person's shift end).
    node_cron_1.default.schedule("*/15 * * * *", () => __awaiter(this, void 0, void 0, function* () {
        try {
            const r = yield remindMissingCheckOut();
            if (r.sent > 0)
                console.log(`[CRON] check-out reminders: ${r.sent} sent (${r.open} open)`);
        }
        catch (e) {
            console.error("[CRON] remindMissingCheckOut failed", e);
        }
    }));
    console.log("[attendance-reminders] crons registered (check-in 13:00, check-out every 15m)");
}
