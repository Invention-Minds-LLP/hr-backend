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
exports.getHrAppliedLeaveList = exports.applyLeaveOnBehalf = exports.getLeaveTypes = exports.getAppraisalOverrideList = exports.appraisalOverride = exports.searchAppraisals = exports.getWeekOffHolidayOverrideList = exports.weekOffHolidayOverride = exports.getOTManualEntryList = exports.manualOTEntry = exports.getCompOffGrantList = exports.manualCompOffGrant = exports.getPermissionOverrideList = exports.grantPermissionOverride = exports.getAttendanceOverrideList = exports.overrideAttendanceStatus = exports.getLeaveBalanceAdjustmentList = exports.adjustLeaveBalance = exports.getPunchCorrectionList = exports.correctPunch = void 0;
const prisma_1 = require("../../lib/prisma");
const leave_controller_1 = require("../leave/leave.controller");
const notifications_controller_1 = require("../notifications/notifications.controller");
// NOTE: hr-corrections has its own local getFinancialYear() — reuse that.
// ─── helpers ───────────────────────────────────────────────────────────────
function atStartOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}
function getFinancialYear(date) {
    const month = date.getMonth() + 1;
    return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}
function getLastLedgerBalance(employeeId, leaveTypeId, year) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const last = yield prisma_1.prisma.leaveLedger.findFirst({
            where: { employeeId, leaveTypeId, year },
            orderBy: { id: "desc" },
            select: { balanceAfter: true },
        });
        return (_a = last === null || last === void 0 ? void 0 : last.balanceAfter) !== null && _a !== void 0 ? _a : 0;
    });
}
/**
 * Notify the employee about an HR correction. Employee-only — supervisors are
 * intentionally NOT notified for corrections. Non-fatal: a failed notification
 * never breaks the correction.
 */
function notifyCorrection(employeeId, employeeMessage) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield (0, notifications_controller_1.createNotification)(employeeId, employeeMessage);
        }
        catch (err) {
            console.error("[notifyCorrection] failed:", err);
        }
    });
}
// ─── PUNCH CORRECTION ──────────────────────────────────────────────────────
/**
 * POST /api/hr-corrections/punch
 * Corrects missing or incorrect punch-in / punch-out times.
 * Body: { employeeId, date, correctedIn?, correctedOut?, reason }
 */
const correctPunch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const { employeeId, date, correctedIn, correctedOut, reason } = req.body;
        const performedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        if (!employeeId || !date || !reason) {
            return res
                .status(400)
                .json({ error: "employeeId, date, and reason are required" });
        }
        if (!correctedIn && !correctedOut) {
            return res
                .status(400)
                .json({ error: "At least one of correctedIn or correctedOut is required" });
        }
        const targetDate = atStartOfDay(new Date(date));
        const dayEnd = new Date(targetDate);
        dayEnd.setHours(23, 59, 59, 999);
        const existing = yield prisma_1.prisma.attendance.findUnique({
            where: { employeeId_date: { employeeId: Number(employeeId), date: targetDate } },
        });
        const originalIn = (_c = existing === null || existing === void 0 ? void 0 : existing.checkIn) !== null && _c !== void 0 ? _c : null;
        const originalOut = (_d = existing === null || existing === void 0 ? void 0 : existing.checkOut) !== null && _d !== void 0 ? _d : null;
        const newIn = correctedIn ? new Date(correctedIn) : (_e = existing === null || existing === void 0 ? void 0 : existing.checkIn) !== null && _e !== void 0 ? _e : null;
        const newOut = correctedOut ? new Date(correctedOut) : (_f = existing === null || existing === void 0 ? void 0 : existing.checkOut) !== null && _f !== void 0 ? _f : null;
        // Determine correction type
        let correctionType = "FULL";
        if (correctedIn && !correctedOut)
            correctionType = correctedIn ? "IN_TIME" : "MISSING_IN";
        else if (!correctedIn && correctedOut)
            correctionType = correctedOut ? "OUT_TIME" : "MISSING_OUT";
        else
            correctionType = "BOTH";
        let attendance;
        if (existing) {
            attendance = yield prisma_1.prisma.attendance.update({
                where: { id: existing.id },
                data: {
                    checkIn: newIn,
                    checkOut: newOut,
                    // If was ABSENT and now has a check-in, promote to PRESENT
                    status: existing.status === "ABSENT" && newIn ? "PRESENT" : existing.status,
                    isPunchCorrected: true,
                },
            });
        }
        else {
            attendance = yield prisma_1.prisma.attendance.create({
                data: {
                    employeeId: Number(employeeId),
                    date: targetDate,
                    checkIn: newIn,
                    checkOut: newOut,
                    status: "PRESENT",
                    isPunchCorrected: true,
                    createdBy: performedBy,
                    reason,
                },
            });
        }
        const log = yield prisma_1.prisma.punchCorrectionLog.create({
            data: {
                employeeId: Number(employeeId),
                date: targetDate,
                originalIn,
                originalOut,
                correctedIn: newIn,
                correctedOut: newOut,
                correctionType,
                reason,
                performedBy: performedBy !== null && performedBy !== void 0 ? performedBy : 0,
            },
        });
        yield prisma_1.prisma.attendance.update({
            where: { id: attendance.id },
            data: { punchCorrectionId: log.id },
        });
        // Notify the employee (their punch record changed).
        yield notifyCorrection(Number(employeeId), `🕒 Your punch record for ${targetDate.toLocaleDateString('en-IN')} was corrected by HR. Reason: ${reason}`);
        return res.json(log);
    }
    catch (err) {
        console.error("correctPunch error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.correctPunch = correctPunch;
/**
 * GET /api/hr-corrections/punch
 * Paginated list of punch corrections.
 */
const getPunchCorrectionList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const skip = (page - 1) * limit;
        const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
        const where = {};
        if (employeeId)
            where.employeeId = employeeId;
        const [records, total] = yield Promise.all([
            prisma_1.prisma.punchCorrectionLog.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: "desc" },
                include: {
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            Department: { select: { name: true } },
                        },
                    },
                },
            }),
            prisma_1.prisma.punchCorrectionLog.count({ where }),
        ]);
        return res.json({ records, total, page, limit });
    }
    catch (err) {
        console.error("getPunchCorrectionList error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.getPunchCorrectionList = getPunchCorrectionList;
// ─── LEAVE BALANCE ADJUSTMENT ──────────────────────────────────────────────
/**
 * POST /api/hr-corrections/leave-balance
 * Manually credit or debit a leave balance.
 * Body: { employeeId, leaveTypeId, year, adjustType ('CREDIT'|'DEBIT'), days, reason }
 */
const adjustLeaveBalance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { employeeId, leaveTypeId, year, adjustType, days, reason } = req.body;
        const performedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        if (!employeeId || !leaveTypeId || !year || !adjustType || !days || !reason) {
            return res.status(400).json({
                error: "employeeId, leaveTypeId, year, adjustType, days, and reason are required",
            });
        }
        if (!["CREDIT", "DEBIT"].includes(adjustType)) {
            return res.status(400).json({ error: "adjustType must be CREDIT or DEBIT" });
        }
        if (Number(days) <= 0) {
            return res.status(400).json({ error: "days must be greater than 0" });
        }
        const month = new Date().getMonth() + 1;
        const balance = yield prisma_1.prisma.employeeLeaveBalance.findFirst({
            where: {
                employeeId: Number(employeeId),
                leaveTypeId: Number(leaveTypeId),
                year: Number(year),
            },
        });
        if (!balance) {
            return res.status(404).json({ error: "No leave balance record found for this employee/leave type/year" });
        }
        const balanceBefore = yield getLastLedgerBalance(Number(employeeId), Number(leaveTypeId), Number(year));
        let balanceAfter;
        if (adjustType === "CREDIT") {
            // Increase totalAllowed — employee gains extra days
            yield prisma_1.prisma.employeeLeaveBalance.update({
                where: { id: balance.id },
                data: { totalAllowed: { increment: Number(days) } },
            });
            balanceAfter = balanceBefore + Number(days);
            yield prisma_1.prisma.leaveLedger.create({
                data: {
                    employeeId: Number(employeeId),
                    leaveTypeId: Number(leaveTypeId),
                    year: Number(year),
                    month,
                    credit: Number(days),
                    debit: 0,
                    balanceAfter,
                    action: "ADJUSTMENT",
                    referenceType: "LEAVE_REQUEST",
                    performedBy,
                    source: "ADMIN",
                    remarks: `Manual credit: ${reason}`,
                },
            });
        }
        else {
            // Increase used — treated as if days were consumed
            yield prisma_1.prisma.employeeLeaveBalance.update({
                where: { id: balance.id },
                data: { used: { increment: Number(days) } },
            });
            balanceAfter = balanceBefore - Number(days);
            yield prisma_1.prisma.leaveLedger.create({
                data: {
                    employeeId: Number(employeeId),
                    leaveTypeId: Number(leaveTypeId),
                    year: Number(year),
                    month,
                    credit: 0,
                    debit: Number(days),
                    balanceAfter,
                    action: "ADJUSTMENT",
                    referenceType: "LEAVE_REQUEST",
                    performedBy,
                    source: "ADMIN",
                    remarks: `Manual debit: ${reason}`,
                },
            });
        }
        const result = yield prisma_1.prisma.leaveBalanceAdjustmentLog.create({
            data: {
                employeeId: Number(employeeId),
                leaveTypeId: Number(leaveTypeId),
                year: Number(year),
                adjustType,
                days: Number(days),
                balanceBefore,
                balanceAfter,
                reason,
                performedBy: performedBy !== null && performedBy !== void 0 ? performedBy : 0,
            },
        });
        // Notify the employee — their leave balance changed.
        const ltName = (_d = (_c = (yield prisma_1.prisma.leaveType.findUnique({ where: { id: Number(leaveTypeId) }, select: { name: true } }))) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : 'leave';
        const verb = adjustType === 'CREDIT' ? 'credited' : 'debited';
        yield notifyCorrection(Number(employeeId), `📊 Your ${ltName} balance was ${verb} by ${days} day(s) by HR (FY ${year}). Reason: ${reason}`);
        return res.json(result);
    }
    catch (err) {
        console.error("adjustLeaveBalance error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.adjustLeaveBalance = adjustLeaveBalance;
/**
 * GET /api/hr-corrections/leave-balance
 */
const getLeaveBalanceAdjustmentList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const skip = (page - 1) * limit;
        const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
        const where = {};
        if (employeeId)
            where.employeeId = employeeId;
        const [records, total] = yield Promise.all([
            prisma_1.prisma.leaveBalanceAdjustmentLog.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: "desc" },
                include: {
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            Department: { select: { name: true } },
                        },
                    },
                    leaveType: { select: { id: true, name: true } },
                },
            }),
            prisma_1.prisma.leaveBalanceAdjustmentLog.count({ where }),
        ]);
        return res.json({ records, total, page, limit });
    }
    catch (err) {
        console.error("getLeaveBalanceAdjustmentList error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.getLeaveBalanceAdjustmentList = getLeaveBalanceAdjustmentList;
// ─── ATTENDANCE OVERRIDE ────────────────────────────────────────────────────
/**
 * POST /api/hr-corrections/attendance-override
 * Overrides attendance status (WFH, FIELD_DUTY, ON_DUTY, ABSENT, PRESENT).
 * Body: { employeeId, date, newStatus, reason }
 */
const overrideAttendanceStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { employeeId, date, newStatus, reason } = req.body;
        const performedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        if (!employeeId || !date || !newStatus || !reason) {
            return res.status(400).json({
                error: "employeeId, date, newStatus, and reason are required",
            });
        }
        const validStatuses = ["PRESENT", "ABSENT", "WFH", "FIELD_DUTY", "ON_DUTY", "HALF_DAY"];
        if (!validStatuses.includes(newStatus)) {
            return res
                .status(400)
                .json({ error: `newStatus must be one of: ${validStatuses.join(", ")}` });
        }
        const targetDate = atStartOfDay(new Date(date));
        const existing = yield prisma_1.prisma.attendance.findUnique({
            where: { employeeId_date: { employeeId: Number(employeeId), date: targetDate } },
        });
        const originalStatus = (_c = existing === null || existing === void 0 ? void 0 : existing.status) !== null && _c !== void 0 ? _c : null;
        let attendance;
        if (existing) {
            attendance = yield prisma_1.prisma.attendance.update({
                where: { id: existing.id },
                data: { status: newStatus, isOverridden: true },
            });
        }
        else {
            attendance = yield prisma_1.prisma.attendance.create({
                data: {
                    employeeId: Number(employeeId),
                    date: targetDate,
                    status: newStatus,
                    isOverridden: true,
                    createdBy: performedBy,
                    reason,
                },
            });
        }
        const overrideLog = yield prisma_1.prisma.attendanceOverrideLog.create({
            data: {
                employeeId: Number(employeeId),
                date: targetDate,
                originalStatus,
                newStatus,
                reason,
                performedBy: performedBy !== null && performedBy !== void 0 ? performedBy : 0,
            },
        });
        yield prisma_1.prisma.attendance.update({
            where: { id: attendance.id },
            data: { overrideId: overrideLog.id },
        });
        // Notify the employee — attendance status changed.
        const dLabel = targetDate.toLocaleDateString('en-IN');
        yield notifyCorrection(Number(employeeId), `✏️ Your attendance for ${dLabel} was changed to ${newStatus} by HR${originalStatus ? ` (was ${originalStatus})` : ''}. Reason: ${reason}`);
        return res.json(overrideLog);
    }
    catch (err) {
        console.error("overrideAttendanceStatus error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.overrideAttendanceStatus = overrideAttendanceStatus;
/**
 * GET /api/hr-corrections/attendance-override
 */
const getAttendanceOverrideList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const skip = (page - 1) * limit;
        const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
        const where = {};
        if (employeeId)
            where.employeeId = employeeId;
        const [records, total] = yield Promise.all([
            prisma_1.prisma.attendanceOverrideLog.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: "desc" },
                include: {
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            Department: { select: { name: true } },
                        },
                    },
                },
            }),
            prisma_1.prisma.attendanceOverrideLog.count({ where }),
        ]);
        return res.json({ records, total, page, limit });
    }
    catch (err) {
        console.error("getAttendanceOverrideList error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.getAttendanceOverrideList = getAttendanceOverrideList;
// ─── PERMISSION OVERRIDE ───────────────────────────────────────────────────
/**
 * POST /api/hr-corrections/permission
 * HR grants a permission directly, bypassing the approval workflow.
 * Body: { employeeId, day, permissionType, timing, startTime?, endTime?, reason, deductBalance? }
 */
const grantPermissionOverride = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { employeeId, day, permissionType, timing, startTime, endTime, reason, deductBalance, } = req.body;
        const performedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        if (!employeeId || !day || !permissionType || !timing || !reason) {
            return res.status(400).json({
                error: "employeeId, day, permissionType, timing, and reason are required",
            });
        }
        const now = new Date();
        const dayDate = atStartOfDay(new Date(day));
        const year = getFinancialYear(dayDate);
        const permission = yield prisma_1.prisma.permissionRequest.create({
            data: {
                employeeId: Number(employeeId),
                day: dayDate,
                permissionType,
                timing,
                startTime: startTime ? new Date(startTime) : undefined,
                endTime: endTime ? new Date(endTime) : undefined,
                reason,
                status: "APPROVED",
                approvedBy: performedBy,
                approvedDate: now,
                hodDecision: "APPROVED",
                hodDecidedAt: now,
                hrDecision: "APPROVED",
                hrDecidedAt: now,
                inChargeDecision: "APPROVED",
                inChargeDecidedAt: now,
                isHROverride: true,
                hrOverrideReason: reason,
            },
        });
        // Optionally deduct from permission balance
        if (deductBalance) {
            const balance = yield prisma_1.prisma.employeeLeaveBalance.findFirst({
                where: {
                    employeeId: Number(employeeId),
                    category: "PERMISSION",
                    permissionType: permissionType,
                    year,
                },
            });
            if (balance && !balance.isUnlimited) {
                yield prisma_1.prisma.employeeLeaveBalance.update({
                    where: { id: balance.id },
                    data: { used: { increment: 1 } },
                });
            }
        }
        // Notify the employee — a permission was granted.
        const dLabel = dayDate.toLocaleDateString('en-IN');
        yield notifyCorrection(Number(employeeId), `🟢 HR granted you a ${permissionType} permission for ${dLabel}${startTime && endTime ? ` (${new Date(startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}–${new Date(endTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })})` : ''}. Reason: ${reason}`);
        return res.json(permission);
    }
    catch (err) {
        console.error("grantPermissionOverride error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.grantPermissionOverride = grantPermissionOverride;
/**
 * GET /api/hr-corrections/permission
 */
const getPermissionOverrideList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const skip = (page - 1) * limit;
        const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
        const where = { isHROverride: true };
        if (employeeId)
            where.employeeId = employeeId;
        const [records, total] = yield Promise.all([
            prisma_1.prisma.permissionRequest.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: "desc" },
                include: {
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            Department: { select: { name: true } },
                        },
                    },
                },
            }),
            prisma_1.prisma.permissionRequest.count({ where }),
        ]);
        return res.json({ records, total, page, limit });
    }
    catch (err) {
        console.error("getPermissionOverrideList error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.getPermissionOverrideList = getPermissionOverrideList;
// ─── COMP-OFF MANUAL GRANT ─────────────────────────────────────────────────
/**
 * POST /api/hr-corrections/comp-off
 * HR manually grants a comp-off credit for a date the employee worked.
 * Body: { employeeId, workDate, expiryDate?, reason }
 */
const manualCompOffGrant = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { employeeId, workDate, expiryDate, reason } = req.body;
        const performedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        if (!employeeId || !workDate || !reason) {
            return res.status(400).json({
                error: "employeeId, workDate, and reason are required",
            });
        }
        const work = atStartOfDay(new Date(workDate));
        const expiry = expiryDate
            ? atStartOfDay(new Date(expiryDate))
            : (() => {
                const d = new Date(work);
                d.setMonth(d.getMonth() + 3);
                return d;
            })();
        const credit = yield prisma_1.prisma.compOffCredit.create({
            data: {
                employeeId: Number(employeeId),
                workDate: work,
                expiryDate: expiry,
                used: false,
                isManualGrant: true,
                grantedBy: performedBy,
                grantReason: reason,
            },
        });
        // Notify the employee — they gained a comp-off credit (with an expiry).
        yield notifyCorrection(Number(employeeId), `🎁 HR granted you a comp-off credit for working on ${work.toLocaleDateString('en-IN')}. Use it before ${expiry.toLocaleDateString('en-IN')}. Reason: ${reason}`);
        return res.json(credit);
    }
    catch (err) {
        console.error("manualCompOffGrant error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.manualCompOffGrant = manualCompOffGrant;
/**
 * GET /api/hr-corrections/comp-off
 */
const getCompOffGrantList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const skip = (page - 1) * limit;
        const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
        const where = { isManualGrant: true };
        if (employeeId)
            where.employeeId = employeeId;
        const [records, total] = yield Promise.all([
            prisma_1.prisma.compOffCredit.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: "desc" },
                include: {
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            Department: { select: { name: true } },
                        },
                    },
                },
            }),
            prisma_1.prisma.compOffCredit.count({ where }),
        ]);
        return res.json({ records, total, page, limit });
    }
    catch (err) {
        console.error("getCompOffGrantList error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.getCompOffGrantList = getCompOffGrantList;
// ─── OT MANUAL ENTRY ───────────────────────────────────────────────────────
/**
 * POST /api/hr-corrections/ot
 * HR manually enters overtime hours that the system missed.
 * Body: { employeeId, date, hours, scheduledEndTime?, reason }
 */
const manualOTEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { employeeId, date, hours, scheduledEndTime, reason } = req.body;
        const performedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        if (!employeeId || !date || !hours || !reason) {
            return res.status(400).json({
                error: "employeeId, date, hours, and reason are required",
            });
        }
        if (Number(hours) <= 0) {
            return res.status(400).json({ error: "hours must be greater than 0" });
        }
        const targetDate = atStartOfDay(new Date(date));
        const minutes = Math.round(Number(hours) * 60);
        const now = new Date();
        const ot = yield prisma_1.prisma.overtimeApproval.upsert({
            where: { employeeId_date: { employeeId: Number(employeeId), date: targetDate } },
            create: {
                employeeId: Number(employeeId),
                date: targetDate,
                minutes,
                status: "APPROVED",
                approvedAt: now,
                scheduledEnd: scheduledEndTime ? new Date(scheduledEndTime) : undefined,
                managerStatus: "APPROVED",
                managerApprovedAt: now,
                manuallyEntered: true,
                manualEntryBy: performedBy,
                manualEntryReason: reason,
            },
            update: {
                minutes,
                status: "APPROVED",
                approvedAt: now,
                scheduledEnd: scheduledEndTime ? new Date(scheduledEndTime) : undefined,
                managerStatus: "APPROVED",
                managerApprovedAt: now,
                manuallyEntered: true,
                manualEntryBy: performedBy,
                manualEntryReason: reason,
            },
        });
        // Notify the employee — OT was recorded (affects pay).
        const dLabel = targetDate.toLocaleDateString('en-IN');
        yield notifyCorrection(Number(employeeId), `⏱️ HR recorded ${hours} hour(s) of overtime for you on ${dLabel}. Reason: ${reason}`);
        return res.json(ot);
    }
    catch (err) {
        console.error("manualOTEntry error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.manualOTEntry = manualOTEntry;
/**
 * GET /api/hr-corrections/ot
 */
const getOTManualEntryList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const skip = (page - 1) * limit;
        const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
        const where = { manuallyEntered: true };
        if (employeeId)
            where.employeeId = employeeId;
        const [records, total] = yield Promise.all([
            prisma_1.prisma.overtimeApproval.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: "desc" },
                include: {
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            Department: { select: { name: true } },
                        },
                    },
                },
            }),
            prisma_1.prisma.overtimeApproval.count({ where }),
        ]);
        return res.json({ records, total, page, limit });
    }
    catch (err) {
        console.error("getOTManualEntryList error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.getOTManualEntryList = getOTManualEntryList;
// ─── WEEK-OFF / HOLIDAY OVERRIDE ───────────────────────────────────────────
/**
 * POST /api/hr-corrections/weekoff-holiday
 * Override an employee's week-off or holiday status for a specific date.
 * overrideType: GRANT_WEEK_OFF | GRANT_HOLIDAY | MARK_WORKING
 * MARK_WORKING optionally auto-grants a comp-off credit.
 * Body: { employeeId, date, overrideType, reason, autoCompOff? }
 */
const weekOffHolidayOverride = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { employeeId, date, overrideType, reason, autoCompOff } = req.body;
        const performedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        if (!employeeId || !date || !overrideType || !reason) {
            return res.status(400).json({
                error: "employeeId, date, overrideType, and reason are required",
            });
        }
        const statusMap = {
            GRANT_WEEK_OFF: "WEEK_OFF",
            GRANT_HOLIDAY: "HOLIDAY",
            MARK_WORKING: "PRESENT",
        };
        const newStatus = statusMap[overrideType];
        const targetDate = atStartOfDay(new Date(date));
        const existingAttendance = yield prisma_1.prisma.attendance.findUnique({
            where: { employeeId_date: { employeeId: Number(employeeId), date: targetDate } },
        });
        const prevStatus = (_c = existingAttendance === null || existingAttendance === void 0 ? void 0 : existingAttendance.status) !== null && _c !== void 0 ? _c : null;
        yield prisma_1.prisma.attendance.upsert({
            where: { employeeId_date: { employeeId: Number(employeeId), date: targetDate } },
            create: {
                employeeId: Number(employeeId),
                date: targetDate,
                status: newStatus,
                isOverridden: true,
                createdBy: performedBy,
                reason,
            },
            update: {
                status: newStatus,
                isOverridden: true,
            },
        });
        const weekOffLog = yield prisma_1.prisma.weekOffHolidayOverrideLog.create({
            data: {
                employeeId: Number(employeeId),
                date: targetDate,
                overrideType,
                prevStatus,
                newStatus,
                autoCompOff: !!autoCompOff,
                reason,
                performedBy: performedBy !== null && performedBy !== void 0 ? performedBy : 0,
            },
        });
        // Auto-grant comp-off when MARK_WORKING on a holiday/week-off
        if (autoCompOff && overrideType === "MARK_WORKING") {
            const expiry = new Date(targetDate);
            expiry.setMonth(expiry.getMonth() + 3);
            yield prisma_1.prisma.compOffCredit.create({
                data: {
                    employeeId: Number(employeeId),
                    workDate: targetDate,
                    expiryDate: expiry,
                    used: false,
                    isManualGrant: true,
                    grantedBy: performedBy,
                    grantReason: `Auto-granted: ${reason}`,
                },
            });
        }
        // Notify the employee — their day's classification changed.
        const dLabel = targetDate.toLocaleDateString('en-IN');
        const human = {
            GRANT_WEEK_OFF: 'a week-off', GRANT_HOLIDAY: 'a holiday', MARK_WORKING: 'a working day',
        };
        yield notifyCorrection(Number(employeeId), `📆 HR marked ${dLabel} as ${human[overrideType]} for you${overrideType === 'MARK_WORKING' && autoCompOff ? ' (a comp-off credit was added)' : ''}. Reason: ${reason}`);
        return res.json(weekOffLog);
    }
    catch (err) {
        console.error("weekOffHolidayOverride error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.weekOffHolidayOverride = weekOffHolidayOverride;
/**
 * GET /api/hr-corrections/weekoff-holiday
 */
const getWeekOffHolidayOverrideList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const skip = (page - 1) * limit;
        const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
        const where = {};
        if (employeeId)
            where.employeeId = employeeId;
        const [records, total] = yield Promise.all([
            prisma_1.prisma.weekOffHolidayOverrideLog.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: "desc" },
                include: {
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            Department: { select: { name: true } },
                        },
                    },
                },
            }),
            prisma_1.prisma.weekOffHolidayOverrideLog.count({ where }),
        ]);
        return res.json({ records, total, page, limit });
    }
    catch (err) {
        console.error("getWeekOffHolidayOverrideList error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.getWeekOffHolidayOverrideList = getWeekOffHolidayOverrideList;
// ─── APPRAISAL OVERRIDE ─────────────────────────────────────────────────────
/**
 * GET /api/hr-corrections/appraisals/search
 * Search appraisal forms by employeeId, returns forms with cycle + current scores.
 */
const searchAppraisals = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
        if (!employeeId) {
            return res.status(400).json({ error: "employeeId is required" });
        }
        const forms = yield prisma_1.prisma.appraisalForm.findMany({
            where: { employeeId },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                cycle: true,
                status: true,
                overallScore: true,
                finalDecision: true,
                finalComments: true,
                createdAt: true,
            },
        });
        return res.json(forms);
    }
    catch (err) {
        console.error("searchAppraisals error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.searchAppraisals = searchAppraisals;
/**
 * POST /api/hr-corrections/appraisals/override
 * HR overrides appraisal form fields.
 * Body: { appraisalFormId, overallScore?, finalDecision?, status?, finalComments?, reason }
 */
const appraisalOverride = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { appraisalFormId, overallScore, finalDecision, status, finalComments, reason } = req.body;
        const performedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        if (!appraisalFormId || !reason) {
            return res.status(400).json({ error: "appraisalFormId and reason are required" });
        }
        if (overallScore === undefined && !finalDecision && !status && !finalComments) {
            return res.status(400).json({ error: "At least one field to override is required" });
        }
        const form = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id: Number(appraisalFormId) },
        });
        if (!form) {
            return res.status(404).json({ error: "Appraisal form not found" });
        }
        const updateData = {};
        if (overallScore !== undefined)
            updateData.overallScore = Number(overallScore);
        if (finalDecision !== undefined)
            updateData.finalDecision = finalDecision;
        if (status !== undefined)
            updateData.status = status;
        if (finalComments !== undefined)
            updateData.finalComments = finalComments;
        yield prisma_1.prisma.appraisalForm.update({
            where: { id: Number(appraisalFormId) },
            data: updateData,
        });
        const appraisalLog = yield prisma_1.prisma.appraisalOverrideLog.create({
            data: {
                appraisalFormId: Number(appraisalFormId),
                employeeId: form.employeeId,
                cycle: form.cycle,
                prevOverallScore: form.overallScore,
                newOverallScore: overallScore !== undefined ? Number(overallScore) : undefined,
                prevFinalDecision: form.finalDecision,
                newFinalDecision: finalDecision !== null && finalDecision !== void 0 ? finalDecision : undefined,
                prevStatus: form.status,
                newStatus: status !== null && status !== void 0 ? status : undefined,
                prevComments: form.finalComments,
                newComments: finalComments !== null && finalComments !== void 0 ? finalComments : undefined,
                reason,
                performedBy: performedBy !== null && performedBy !== void 0 ? performedBy : 0,
            },
        });
        return res.json(appraisalLog);
    }
    catch (err) {
        console.error("appraisalOverride error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.appraisalOverride = appraisalOverride;
/**
 * GET /api/hr-corrections/appraisals/override
 */
const getAppraisalOverrideList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const skip = (page - 1) * limit;
        const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
        const where = {};
        if (employeeId)
            where.employeeId = employeeId;
        const [records, total] = yield Promise.all([
            prisma_1.prisma.appraisalOverrideLog.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: "desc" },
                include: {
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            Department: { select: { name: true } },
                        },
                    },
                },
            }),
            prisma_1.prisma.appraisalOverrideLog.count({ where }),
        ]);
        return res.json({ records, total, page, limit });
    }
    catch (err) {
        console.error("getAppraisalOverrideList error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.getAppraisalOverrideList = getAppraisalOverrideList;
// ─── LEAVE TYPES (for dropdowns) ───────────────────────────────────────────
const getLeaveTypes = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const types = yield prisma_1.prisma.leaveType.findMany({
            select: { id: true, name: true },
            orderBy: { name: "asc" },
        });
        return res.json(types);
    }
    catch (err) {
        console.error("getLeaveTypes error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.getLeaveTypes = getLeaveTypes;
/* ════════════════════════════════════════════════════════════════════
   APPLY LEAVE ON BEHALF OF AN EMPLOYEE (HR override)
   POST /api/hr-corrections/leave-apply
   Body: { employeeId, leaveTypeId, startDate, endDate, reason,
           isHalfDay?, halfDaySession?, force? }
   ────────────────────────────────────────────────────────────────────
   HR raises a leave request for an employee and it goes straight to
   APPROVED with the balance deducted + ledger debit written — same end
   state as a normally-approved leave, but bypassing the per-application
   caps / weekly-one-type / sandwich-block rules (it's an override tool).
   Insufficient balance is blocked unless `force: true` (then it goes
   negative and is recorded).
   ════════════════════════════════════════════════════════════════════ */
const applyLeaveOnBehalf = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const hrUserId = Number((_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId);
        // HR / HR-Manager / Admin only
        const role = String((_e = (_d = req.user) === null || _d === void 0 ? void 0 : _d.role) !== null && _e !== void 0 ? _e : '').toUpperCase();
        const roleId = Number((_f = req.user) === null || _f === void 0 ? void 0 : _f.roleId);
        const isHR = ['HR', 'HR_MANAGER', 'ADMIN'].includes(role) || roleId === 1;
        if (!isHR) {
            return res.status(403).json({ error: "Only HR can apply leave on behalf of an employee." });
        }
        const { employeeId, leaveTypeId, startDate, endDate, reason, isHalfDay, halfDaySession, force, } = req.body || {};
        if (!employeeId || !leaveTypeId || !startDate || !endDate || !(reason === null || reason === void 0 ? void 0 : reason.trim())) {
            return res.status(400).json({
                error: "employeeId, leaveTypeId, startDate, endDate and reason are required",
            });
        }
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ error: "Invalid startDate / endDate" });
        }
        if (end < start)
            return res.status(400).json({ error: "endDate cannot be before startDate" });
        if (isHalfDay && start.toDateString() !== end.toDateString()) {
            return res.status(400).json({ error: "Half-day must be a single date" });
        }
        if (isHalfDay && !halfDaySession) {
            return res.status(400).json({ error: "halfDaySession is required for a half-day" });
        }
        const [employee, lt] = yield Promise.all([
            prisma_1.prisma.employee.findUnique({ where: { id: Number(employeeId) }, select: { id: true, firstName: true, lastName: true, employeeCode: true } }),
            prisma_1.prisma.leaveType.findUnique({ where: { id: Number(leaveTypeId) } }),
        ]);
        if (!employee)
            return res.status(404).json({ error: "Employee not found" });
        if (!lt)
            return res.status(400).json({ error: "Invalid leave type" });
        const year = getFinancialYear(start);
        // EL counts week-offs inside the range (sandwich rule); other types don't.
        const requestedUnits = isHalfDay
            ? 0.5
            : yield (0, leave_controller_1.countWorkingDays)(Number(employeeId), start, end, { includeWeekOffs: lt.name === 'EL' });
        if (requestedUnits <= 0) {
            return res.status(400).json({ error: "Selected range contains no leave days (only holidays / week-offs)." });
        }
        // RH / CO don't have a normal balance row — keep it simple: allow without
        // a balance check (the corrections module is an override; CO/RH balances
        // are managed elsewhere). For all other types, enforce balance unless force.
        const SKIP_BALANCE_TYPES = ['RH', 'CO'];
        const balance = SKIP_BALANCE_TYPES.includes(lt.name)
            ? null
            : yield prisma_1.prisma.employeeLeaveBalance.findFirst({
                where: { employeeId: Number(employeeId), leaveTypeId: Number(leaveTypeId), year, category: "LEAVE" },
            });
        if (!SKIP_BALANCE_TYPES.includes(lt.name)) {
            if (!balance) {
                return res.status(400).json({ error: `Leave balance not configured for ${employee.firstName} ${employee.lastName} (${lt.name}, ${year}).` });
            }
            const usedBefore = (0, leave_controller_1.computeTotalUsed)(balance);
            const remaining = ((_g = balance.totalAllowed) !== null && _g !== void 0 ? _g : 0) - usedBefore;
            if (requestedUnits > remaining && !force) {
                return res.status(400).json({
                    error: `Insufficient ${lt.name} balance — available ${remaining}, requested ${requestedUnits}. `
                        + `Re-submit with "allow negative balance" if this is intentional.`,
                    available: remaining, requested: requestedUnits,
                });
            }
        }
        const now = new Date();
        const created = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // 1) Create the leave request, already APPROVED, all levels stamped.
            const leave = yield tx.leaveRequest.create({
                data: {
                    employeeId: Number(employeeId),
                    leaveTypeId: Number(leaveTypeId),
                    startDate: start,
                    endDate: end,
                    reason: reason.trim(),
                    status: 'APPROVED',
                    isHalfDay: !!isHalfDay,
                    halfDaySession: isHalfDay ? halfDaySession : null,
                    approvedBy: hrUserId,
                    approvedDate: now,
                    hodDecision: 'APPROVED', hodDecidedAt: now, hodNote: 'Auto-approved (HR applied on behalf)',
                    hrDecision: 'APPROVED', hrDecidedAt: now, hrNote: reason.trim(),
                    inChargeDecision: 'APPROVED', inChargeDecidedAt: now, inChargeNote: 'Auto-approved (HR applied on behalf)',
                    appliedByHr: true,
                    appliedByHrId: hrUserId,
                },
                include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } }, leaveType: { select: { name: true } } },
            });
            // 2) Deduct balance (skip for RH / CO).
            if (!SKIP_BALANCE_TYPES.includes(lt.name)) {
                if (isHalfDay) {
                    yield tx.employeeLeaveBalance.updateMany({
                        where: { employeeId: Number(employeeId), leaveTypeId: Number(leaveTypeId), year },
                        data: { halfDayUsed: { increment: 1 } },
                    });
                }
                else {
                    yield tx.employeeLeaveBalance.updateMany({
                        where: { employeeId: Number(employeeId), leaveTypeId: Number(leaveTypeId), year },
                        data: { used: { increment: requestedUnits } },
                    });
                }
                // 3) Ledger DEBIT entries per touched month — mirrors the normal approval path.
                const touched = (0, leave_controller_1.getTouchedMonths)(start, end);
                touched.sort((a, b) => a.year - b.year || a.month - b.month);
                let runningBalance = yield (0, leave_controller_1.getLastLedgerBalanceTx)(tx, Number(employeeId), Number(leaveTypeId), year);
                for (const m of touched) {
                    const calYear = (0, leave_controller_1.getCalendarYear)(m.year, m.month);
                    const monthStart = new Date(calYear, m.month - 1, 1);
                    const monthEnd = new Date(calYear, m.month, 0);
                    const from = start > monthStart ? start : monthStart;
                    const to = end < monthEnd ? end : monthEnd;
                    const days = isHalfDay ? 0.5 : yield (0, leave_controller_1.countWorkingDays)(Number(employeeId), from, to, { includeWeekOffs: lt.name === 'EL' });
                    if (days <= 0)
                        continue;
                    runningBalance -= days;
                    yield (0, leave_controller_1.insertLedgerTx)(tx, {
                        employeeId: Number(employeeId),
                        leaveTypeId: Number(leaveTypeId),
                        year: m.year,
                        month: m.month,
                        debit: days,
                        credit: 0,
                        balanceAfter: runningBalance,
                        action: "DEBIT",
                        referenceType: "LEAVE_REQUEST",
                        referenceId: leave.id,
                        performedBy: hrUserId,
                        source: "ADMIN",
                        remarks: `HR-applied leave (${lt.name})${force ? ' [forced — negative balance]' : ''}: ${reason.trim().slice(0, 120)}`,
                    });
                    // half-day spans a single month, so break after the first
                    if (isHalfDay)
                        break;
                }
            }
            return leave;
        }), { timeout: 15000 });
        // ── Notification (employee only — supervisors are not notified for
        //    HR corrections / HR-applied leave; failures don't roll back). ──
        try {
            const typeName = lt.name;
            const range = isHalfDay
                ? `${start.toLocaleDateString('en-IN')} (${halfDaySession === 'FIRST_HALF' ? '1st half' : '2nd half'})`
                : `${start.toLocaleDateString('en-IN')} – ${end.toLocaleDateString('en-IN')}`;
            yield (0, notifications_controller_1.createNotification)(Number(employeeId), `📝 HR has applied ${requestedUnits} day(s) of ${typeName} leave on your behalf for ${range}. Reason: ${reason.trim()}`);
        }
        catch (notifyErr) {
            console.error("[applyLeaveOnBehalf notify] failed:", notifyErr);
        }
        return res.status(201).json({
            message: "Leave applied and approved on behalf of the employee.",
            data: created,
            requestedUnits,
        });
    }
    catch (err) {
        console.error("applyLeaveOnBehalf error:", err);
        return res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to apply leave on behalf" });
    }
});
exports.applyLeaveOnBehalf = applyLeaveOnBehalf;
/** GET /api/hr-corrections/leave-apply — list of HR-applied leaves (history). */
const getHrAppliedLeaveList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, page = "1", pageSize = "25" } = req.query;
        const where = { appliedByHr: true };
        if (employeeId)
            where.employeeId = Number(employeeId);
        const take = Math.min(100, Number(pageSize) || 25);
        const skip = (Math.max(1, Number(page) || 1) - 1) * take;
        const [rows, total] = yield Promise.all([
            prisma_1.prisma.leaveRequest.findMany({
                where,
                orderBy: { createdAt: "desc" },
                take, skip,
                include: {
                    employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
                    leaveType: { select: { id: true, name: true } },
                },
            }),
            prisma_1.prisma.leaveRequest.count({ where }),
        ]);
        return res.json({ total, rows });
    }
    catch (err) {
        console.error("getHrAppliedLeaveList error:", err);
        return res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to load HR-applied leaves" });
    }
});
exports.getHrAppliedLeaveList = getHrAppliedLeaveList;
