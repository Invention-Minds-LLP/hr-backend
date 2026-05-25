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
exports.getEncashmentHistory = exports.processEncashment = exports.getEncashmentEligible = void 0;
const prisma_1 = require("../../lib/prisma");
// ═══════════════════════════════════════════════════════════════════════════════
// GET ENCASHMENT ELIGIBLE EMPLOYEES
// Shows all employees whose EL balance exceeds maxCarryForward (45)
// ═══════════════════════════════════════════════════════════════════════════════
const getEncashmentEligible = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        const year = req.query.year ? Number(req.query.year) : getFinancialYear(new Date());
        // Get EL leave type
        const el = yield prisma_1.prisma.leaveType.findFirst({ where: { name: "EL" } });
        if (!el)
            return res.status(404).json({ error: "EL leave type not found" });
        // Get EL policy for maxCarryForward limit
        const policy = yield prisma_1.prisma.leavePolicy.findFirst({
            where: { leaveTypeId: el.id, isActive: true },
            orderBy: { createdAt: "desc" },
        });
        const maxCarryForward = (_a = policy === null || policy === void 0 ? void 0 : policy.maxCarryForward) !== null && _a !== void 0 ? _a : 45;
        const maxBalance = (_b = policy === null || policy === void 0 ? void 0 : policy.maxBalance) !== null && _b !== void 0 ? _b : 60;
        const encashable = (_c = policy === null || policy === void 0 ? void 0 : policy.encashable) !== null && _c !== void 0 ? _c : false;
        // Two thresholds:
        //  ELIGIBILITY_THRESHOLD — actual encashment cap (policy maxBalance, usually 60).
        //    Employees at or past this can be encashed NOW.
        //  APPROACHING_THRESHOLD — proactive heads-up (55). Employees above this but
        //    below the cap are shown in the list so HR can plan pay-out in advance.
        const ELIGIBILITY_THRESHOLD = maxBalance; // 60
        const APPROACHING_THRESHOLD = 55; // heads-up line
        // Get all EL balances for the year
        const balances = yield prisma_1.prisma.employeeLeaveBalance.findMany({
            where: { leaveTypeId: el.id, year },
        });
        const empIds = balances.map(b => b.employeeId);
        const employees = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: empIds } },
            select: {
                id: true, employeeCode: true, firstName: true, lastName: true,
                Department: { select: { name: true } },
                designation: { select: { name: true } },
            },
        });
        const empMap = new Map(employees.map(e => [e.id, e]));
        // Get encashment history from ledger
        const encashments = yield prisma_1.prisma.leaveLedger.findMany({
            where: { leaveTypeId: el.id, year, action: "ENCASHMENT" },
            select: { employeeId: true, debit: true, createdAt: true, remarks: true },
        });
        const encashmentByEmp = new Map();
        for (const e of encashments) {
            const existing = encashmentByEmp.get(e.employeeId) || { totalEncashed: 0, entries: [] };
            existing.totalEncashed += Number(e.debit);
            existing.entries.push(e);
            encashmentByEmp.set(e.employeeId, existing);
        }
        // Build rows — we include everyone above the APPROACHING line in the main list,
        // but tag each with a status so the UI can clearly show "eligible now" vs
        // "approaching cap".
        const visibleList = []; // balance > 55 (heads-up + eligible)
        const eligibleOnly = []; // balance >= 60 (truly eligible)
        const all = [];
        for (const bal of balances) {
            const emp = empMap.get(bal.employeeId);
            if (!emp)
                continue;
            const currentBalance = bal.totalAllowed - bal.used;
            const excessOverEligibility = Math.max(0, currentBalance - ELIGIBILITY_THRESHOLD); // days over 60
            const excessOverApproaching = Math.max(0, currentBalance - APPROACHING_THRESHOLD); // days over 55
            const excessOverCarryForward = Math.max(0, currentBalance - maxCarryForward);
            const encashmentData = encashmentByEmp.get(bal.employeeId);
            const totalEncashed = (_d = encashmentData === null || encashmentData === void 0 ? void 0 : encashmentData.totalEncashed) !== null && _d !== void 0 ? _d : 0;
            const isEligible = currentBalance >= ELIGIBILITY_THRESHOLD;
            const isApproaching = !isEligible && currentBalance > APPROACHING_THRESHOLD;
            const status = isEligible ? 'ELIGIBLE' :
                isApproaching ? 'APPROACHING' : 'SAFE';
            const row = {
                employeeId: bal.employeeId,
                employeeCode: emp.employeeCode,
                employeeName: `${emp.firstName} ${emp.lastName}`,
                department: (_f = (_e = emp.Department) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : '',
                designation: (_h = (_g = emp.designation) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : '',
                year,
                totalAllowed: bal.totalAllowed,
                used: bal.used,
                currentBalance,
                maxCarryForward,
                maxBalance, // 60 — policy cap
                approachingThreshold: APPROACHING_THRESHOLD, // 55
                excessOverCarryForward,
                excessOverEligibility, // days >= 60 (can actually be encashed)
                excessOverApproaching, // days > 55 (proactive buffer)
                // `encashmentEligible` kept for backward compat — reflects days payable now
                encashmentEligible: excessOverEligibility,
                status, // 'ELIGIBLE' | 'APPROACHING' | 'SAFE'
                isEligible,
                isApproaching,
                totalEncashed,
                pendingEncashment: Math.max(0, excessOverEligibility - totalEncashed),
                encashmentHistory: (_j = encashmentData === null || encashmentData === void 0 ? void 0 : encashmentData.entries) !== null && _j !== void 0 ? _j : [],
            };
            all.push(row);
            if (isEligible)
                eligibleOnly.push(row);
            if (isEligible || isApproaching)
                visibleList.push(row);
        }
        // Sort the visible list by balance descending so the most urgent cases top
        visibleList.sort((a, b) => b.currentBalance - a.currentBalance);
        eligibleOnly.sort((a, b) => b.currentBalance - a.currentBalance);
        return res.json({
            year,
            maxCarryForward,
            maxBalance,
            eligibilityThreshold: ELIGIBILITY_THRESHOLD, // 60
            approachingThreshold: APPROACHING_THRESHOLD, // 55
            encashable,
            totalEmployees: all.length,
            eligibleCount: eligibleOnly.length, // balance ≥ 60 — can be paid out now
            approachingCount: visibleList.length - eligibleOnly.length, // 55 < balance < 60
            totalExcessDays: eligibleOnly.reduce((sum, e) => sum + e.excessOverEligibility, 0),
            totalEncashedDays: all.reduce((sum, e) => sum + e.totalEncashed, 0),
            // `eligible` now contains everyone HR should be aware of (≥ 55),
            // with a `status` field on each row so the UI can colour/label them.
            eligible: visibleList,
            // Strict list if the UI only wants people who can be encashed right now
            eligibleOnly,
            all,
        });
    }
    catch (error) {
        console.error("getEncashmentEligible error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.getEncashmentEligible = getEncashmentEligible;
// ═══════════════════════════════════════════════════════════════════════════════
// PROCESS ENCASHMENT — debit excess from balance and log in ledger
// ═══════════════════════════════════════════════════════════════════════════════
const processEncashment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { employeeId, days, remarks } = req.body;
        const year = req.body.year ? Number(req.body.year) : getFinancialYear(new Date());
        const performedBy = req.body.performedBy ? Number(req.body.performedBy) : null;
        if (!employeeId || !days || days <= 0) {
            return res.status(400).json({ error: "employeeId and days (> 0) are required" });
        }
        const el = yield prisma_1.prisma.leaveType.findFirst({ where: { name: "EL" } });
        if (!el)
            return res.status(404).json({ error: "EL leave type not found" });
        const policy = yield prisma_1.prisma.leavePolicy.findFirst({
            where: { leaveTypeId: el.id, isActive: true },
            orderBy: { createdAt: "desc" },
        });
        const maxCarryForward = (_a = policy === null || policy === void 0 ? void 0 : policy.maxCarryForward) !== null && _a !== void 0 ? _a : 45;
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const balance = yield tx.employeeLeaveBalance.findFirst({
                where: { employeeId: Number(employeeId), leaveTypeId: el.id, year },
            });
            if (!balance)
                throw new Error("No EL balance found for this employee and year");
            const currentBalance = balance.totalAllowed - balance.used;
            const excessDays = currentBalance - maxCarryForward;
            if (excessDays <= 0)
                throw new Error("No excess balance to encash");
            if (days > excessDays)
                throw new Error(`Can only encash up to ${excessDays} days (excess over ${maxCarryForward})`);
            // Debit from balance
            yield tx.employeeLeaveBalance.update({
                where: { id: balance.id },
                data: { totalAllowed: { decrement: days } },
            });
            // Get last ledger balance
            const lastLedger = yield tx.leaveLedger.findFirst({
                where: { employeeId: Number(employeeId), leaveTypeId: el.id, year },
                orderBy: { id: "desc" },
                select: { balanceAfter: true },
            });
            const prevBalance = (_a = lastLedger === null || lastLedger === void 0 ? void 0 : lastLedger.balanceAfter) !== null && _a !== void 0 ? _a : currentBalance;
            // Insert ledger entry
            const ledger = yield tx.leaveLedger.create({
                data: {
                    employeeId: Number(employeeId),
                    leaveTypeId: el.id,
                    year,
                    month: new Date().getMonth() + 1,
                    transactionDate: new Date(),
                    referenceType: "ENCASHMENT",
                    credit: 0,
                    debit: days,
                    balanceAfter: prevBalance - days,
                    action: "ENCASHMENT",
                    source: "ADMIN",
                    performedBy,
                    performedAt: new Date(),
                    remarks: remarks || `EL encashment of ${days} days`,
                },
            });
            return {
                employeeId: Number(employeeId),
                daysEncashed: days,
                previousBalance: currentBalance,
                newBalance: currentBalance - days,
                ledgerId: ledger.id,
            };
        }), { timeout: 10000 });
        return res.json(result);
    }
    catch (error) {
        console.error("processEncashment error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.processEncashment = processEncashment;
// ═══════════════════════════════════════════════════════════════════════════════
// GET ENCASHMENT HISTORY for a specific employee
// ═══════════════════════════════════════════════════════════════════════════════
const getEncashmentHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        const year = req.query.year ? Number(req.query.year) : undefined;
        const where = { employeeId, action: "ENCASHMENT" };
        if (year)
            where.year = year;
        // Get EL leave type
        const el = yield prisma_1.prisma.leaveType.findFirst({ where: { name: "EL" } });
        if (el)
            where.leaveTypeId = el.id;
        const entries = yield prisma_1.prisma.leaveLedger.findMany({
            where,
            orderBy: { id: "desc" },
            include: {
                performedByUser: { select: { firstName: true, lastName: true } },
            },
        });
        const totalEncashed = entries.reduce((sum, e) => sum + Number(e.debit), 0);
        return res.json({
            employeeId,
            totalEncashed,
            entries: entries.map(e => ({
                id: e.id,
                year: e.year,
                month: e.month,
                days: e.debit,
                balanceAfter: e.balanceAfter,
                remarks: e.remarks,
                performedBy: e.performedByUser
                    ? `${e.performedByUser.firstName} ${e.performedByUser.lastName}` : null,
                performedAt: e.performedAt,
                createdAt: e.createdAt,
            })),
        });
    }
    catch (error) {
        console.error("getEncashmentHistory error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.getEncashmentHistory = getEncashmentHistory;
function getFinancialYear(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    return month >= 4 ? year : year - 1;
}
