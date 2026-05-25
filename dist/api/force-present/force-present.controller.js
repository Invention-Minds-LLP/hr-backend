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
exports.getApprovedLeavesOnDate = exports.getForcePresentList = exports.markForcePresent = void 0;
const prisma_1 = require("../../lib/prisma");
function getFinancialYear(date) {
    const month = date.getMonth() + 1;
    return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}
function atStartOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}
function isSameDay(a, b) {
    return (a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate());
}
function addDays(date, days) {
    const d = atStartOfDay(new Date(date));
    d.setDate(d.getDate() + days);
    return d;
}
function getLastLedgerBalance(tx, employeeId, leaveTypeId, year) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const last = yield tx.leaveLedger.findFirst({
            where: { employeeId, leaveTypeId, year },
            orderBy: { id: "desc" },
            select: { balanceAfter: true },
        });
        return (_a = last === null || last === void 0 ? void 0 : last.balanceAfter) !== null && _a !== void 0 ? _a : 0;
    });
}
// Mark an employee as force present on a date they have an approved leave
const markForcePresent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { employeeId, date, reason, createCompOff } = req.body;
        const performedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        if (!employeeId || !date || !reason) {
            return res
                .status(400)
                .json({ error: "employeeId, date, and reason are required" });
        }
        const targetDate = atStartOfDay(new Date(date));
        const year = getFinancialYear(targetDate);
        const month = targetDate.getMonth() + 1;
        const dayEnd = new Date(targetDate);
        dayEnd.setHours(23, 59, 59, 999);
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Find any APPROVED leave covering this date
            const leave = yield tx.leaveRequest.findFirst({
                where: {
                    employeeId: Number(employeeId),
                    status: "APPROVED",
                    startDate: { lte: dayEnd },
                    endDate: { gte: targetDate },
                    cancelledAt: null,
                },
                include: { leaveType: true },
            });
            // Leave cancellation is optional — employee may have had no leave
            // (e.g., emergency, went directly to client without biometric)
            let daysRestored = 0;
            let leaveRequestId = null;
            if (leave) {
                leaveRequestId = leave.id;
                const isSingleDay = isSameDay(leave.startDate, leave.endDate);
                const isHalfDay = leave.isHalfDay && isSingleDay;
                daysRestored = isHalfDay ? 0.5 : 1;
                const isCOLeave = leave.leaveType.name === "CO";
                const isFirstDay = isSameDay(targetDate, leave.startDate);
                const isLastDay = isSameDay(targetDate, leave.endDate);
                // Determine restoration amount from the original ledger debit for this leave,
                // not from leave.isHalfDay — avoids mismatch when the approval debited differently.
                const originalDebitEntry = yield tx.leaveLedger.findFirst({
                    where: {
                        employeeId: Number(employeeId),
                        leaveTypeId: leave.leaveTypeId,
                        referenceId: leave.id,
                        action: "DEBIT",
                    },
                    orderBy: { id: "asc" },
                });
                // For multi-day leaves we restore exactly 1 day (the force-present date).
                // For single-day leaves we restore however much was actually debited (0.5 or 1).
                if (isSingleDay && originalDebitEntry) {
                    daysRestored = Number(originalDebitEntry.debit);
                }
                if (isSingleDay) {
                    // Cancel the entire leave
                    yield tx.leaveRequest.update({
                        where: { id: leave.id },
                        data: {
                            status: "CANCELLED",
                            cancelledAt: new Date(),
                            cancelledBy: performedBy,
                            cancellationReason: `Force Present on ${date}: ${reason}`,
                        },
                    });
                }
                else if (isFirstDay) {
                    // Shrink: move startDate to the next day
                    yield tx.leaveRequest.update({
                        where: { id: leave.id },
                        data: { startDate: addDays(targetDate, 1) },
                    });
                }
                else if (isLastDay) {
                    // Shrink: move endDate to the previous day
                    yield tx.leaveRequest.update({
                        where: { id: leave.id },
                        data: { endDate: addDays(targetDate, -1) },
                    });
                }
                else {
                    // Split: original leave ends the day before, new leave starts the day after
                    yield tx.leaveRequest.update({
                        where: { id: leave.id },
                        data: { endDate: addDays(targetDate, -1) },
                    });
                    yield tx.leaveRequest.create({
                        data: {
                            employeeId: leave.employeeId,
                            leaveTypeId: leave.leaveTypeId,
                            startDate: addDays(targetDate, 1),
                            endDate: leave.endDate,
                            reason: `${leave.reason} [split from leave #${leave.id} due to force present on ${date}]`,
                            status: "APPROVED",
                            approvedBy: leave.approvedBy,
                            isHalfDay: false,
                            hodDecision: leave.hodDecision,
                            hodDecidedAt: leave.hodDecidedAt,
                            hrDecision: leave.hrDecision,
                            hrDecidedAt: leave.hrDecidedAt,
                            inChargeDecision: leave.inChargeDecision,
                            inChargeDecidedAt: leave.inChargeDecidedAt,
                        },
                    });
                }
                // Restore leave balance (non-CO leaves)
                if (!isCOLeave) {
                    const balance = yield tx.employeeLeaveBalance.findFirst({
                        where: {
                            employeeId: Number(employeeId),
                            leaveTypeId: leave.leaveTypeId,
                            year,
                        },
                    });
                    if (balance) {
                        const currentLedgerBalance = yield getLastLedgerBalance(tx, Number(employeeId), leave.leaveTypeId, year);
                        if (isHalfDay) {
                            yield tx.employeeLeaveBalance.update({
                                where: { id: balance.id },
                                data: { halfDayUsed: { decrement: 1 } },
                            });
                        }
                        else {
                            yield tx.employeeLeaveBalance.update({
                                where: { id: balance.id },
                                data: { used: { decrement: 1 } },
                            });
                        }
                        // Insert CANCELLATION ledger entry
                        yield tx.leaveLedger.create({
                            data: {
                                employeeId: Number(employeeId),
                                leaveTypeId: leave.leaveTypeId,
                                year,
                                month,
                                credit: daysRestored,
                                balanceAfter: currentLedgerBalance + daysRestored,
                                action: "CANCELLATION",
                                referenceType: "LEAVE_REQUEST",
                                referenceId: leave.id,
                                performedBy: performedBy,
                                source: "ADMIN",
                                remarks: `Force present on ${date}: ${reason}`,
                            },
                        });
                    }
                }
                else {
                    // CO leave: restore the CompOff credit that was consumed
                    const usedCredit = yield tx.compOffCredit.findFirst({
                        where: { leaveId: leave.id, used: true },
                    });
                    if (usedCredit) {
                        yield tx.compOffCredit.update({
                            where: { id: usedCredit.id },
                            data: { used: false, usedOn: null, leaveId: null },
                        });
                    }
                }
            }
            // If no leave exists: attendance is simply corrected to PRESENT
            // (no balance changes needed)
            // Upsert attendance as PRESENT with isForcedPresent flag
            const existing = yield tx.attendance.findUnique({
                where: {
                    employeeId_date: {
                        employeeId: Number(employeeId),
                        date: targetDate,
                    },
                },
            });
            let attendanceId;
            if (existing) {
                const updated = yield tx.attendance.update({
                    where: { id: existing.id },
                    data: {
                        status: "PRESENT",
                        isForcedPresent: true,
                        reason,
                    },
                });
                attendanceId = updated.id;
            }
            else {
                const created = yield tx.attendance.create({
                    data: {
                        employeeId: Number(employeeId),
                        date: targetDate,
                        status: "PRESENT",
                        isForcedPresent: true,
                        createdBy: performedBy,
                        reason,
                    },
                });
                attendanceId = created.id;
            }
            // Optionally grant a new CompOff credit (3-month expiry)
            if (createCompOff) {
                const expiryDate = new Date(targetDate);
                expiryDate.setMonth(expiryDate.getMonth() + 2);
                yield tx.compOffCredit.create({
                    data: {
                        employeeId: Number(employeeId),
                        workDate: targetDate,
                        expiryDate,
                    },
                });
            }
            // Create audit record
            const action = yield tx.forcePresentAction.create({
                data: {
                    employeeId: Number(employeeId),
                    date: targetDate,
                    leaveRequestId: leaveRequestId,
                    daysRestored: daysRestored,
                    compOffGranted: createCompOff !== null && createCompOff !== void 0 ? createCompOff : false,
                    performedBy: performedBy !== null && performedBy !== void 0 ? performedBy : 0,
                    reason,
                },
            });
            return { kind: "OK", status: 200, body: action, attendanceId };
        }), { timeout: 20000 });
        // Link attendance to the force-present action outside the transaction
        // (non-critical back-reference — keeps transaction lean)
        yield prisma_1.prisma.attendance.update({
            where: { id: result.attendanceId },
            data: { forcePresentId: result.body.id },
        });
        return res.json(result.body);
    }
    catch (err) {
        console.error("markForcePresent error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.markForcePresent = markForcePresent;
// List force present actions with pagination
const getForcePresentList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const skip = (page - 1) * limit;
        const employeeId = req.query.employeeId
            ? Number(req.query.employeeId)
            : undefined;
        const where = {};
        if (employeeId)
            where.employeeId = employeeId;
        const [records, total] = yield Promise.all([
            prisma_1.prisma.forcePresentAction.findMany({
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
                    leaveRequest: {
                        select: {
                            id: true,
                            startDate: true,
                            endDate: true,
                            leaveType: { select: { name: true } },
                        },
                    },
                },
            }),
            prisma_1.prisma.forcePresentAction.count({ where }),
        ]);
        return res.json({ records, total, page, limit });
    }
    catch (err) {
        console.error("getForcePresentList error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.getForcePresentList = getForcePresentList;
// Preview: get approved leaves for an employee on a specific date
const getApprovedLeavesOnDate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, date } = req.query;
        if (!employeeId || !date) {
            return res
                .status(400)
                .json({ error: "employeeId and date are required" });
        }
        const targetDate = atStartOfDay(new Date(date));
        const dayEnd = new Date(targetDate);
        dayEnd.setHours(23, 59, 59, 999);
        const leaves = yield prisma_1.prisma.leaveRequest.findMany({
            where: {
                employeeId: Number(employeeId),
                status: "APPROVED",
                startDate: { lte: dayEnd },
                endDate: { gte: targetDate },
                cancelledAt: null,
            },
            include: { leaveType: { select: { id: true, name: true } } },
        });
        return res.json(leaves);
    }
    catch (err) {
        console.error("getApprovedLeavesOnDate error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.getApprovedLeavesOnDate = getApprovedLeavesOnDate;
