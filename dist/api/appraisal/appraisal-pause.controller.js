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
exports.deletePause = exports.updatePause = exports.createPause = exports.getActivePause = exports.listEmployeePauses = void 0;
exports.getPausedDaysBetween = getPausedDaysBetween;
exports.getActivePauseForEmployee = getActivePauseForEmployee;
exports.isHRActor = isHRActor;
exports.assertNotPausedOrHR = assertNotPausedOrHR;
exports.getEffectiveMonthsSinceJoining = getEffectiveMonthsSinceJoining;
const prisma_1 = require("../../lib/prisma");
const MS_PER_DAY = 1000 * 60 * 60 * 24;
/**
 * Sum of paused days for an employee that overlap the window [from, to].
 * Used by:
 *   - The auto-draft cron (subtract from elapsed months before threshold check)
 *   - getEmployeeInsights (exclude paused windows when counting incidents/ratings)
 *   - The frontend period selector (subtract before deciding MONTH_1/3/6/YEAR_1)
 *
 * An ongoing pause (endDate=null) is treated as ending at `to`. Overlap is
 * clipped to the [from, to] window.
 */
function getPausedDaysBetween(employeeId, from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const pauses = yield prisma_1.prisma.employeeAppraisalPause.findMany({
            where: {
                employeeId,
                startDate: { lte: to },
                OR: [{ endDate: null }, { endDate: { gte: from } }],
            },
            select: { startDate: true, endDate: true },
        });
        let days = 0;
        for (const p of pauses) {
            const a = p.startDate < from ? from : p.startDate;
            const bRaw = (_a = p.endDate) !== null && _a !== void 0 ? _a : to;
            const b = bRaw > to ? to : bRaw;
            if (b <= a)
                continue;
            days += Math.ceil((b.getTime() - a.getTime()) / MS_PER_DAY);
        }
        return days;
    });
}
/**
 * Quick check: is the employee currently in an open pause window?
 * Used by every submit endpoint to refuse reviews mid-pause.
 */
function getActivePauseForEmployee(employeeId) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma_1.prisma.employeeAppraisalPause.findFirst({
            where: { employeeId, endDate: null },
            orderBy: { startDate: "desc" },
        });
    });
}
/**
 * Returns true if the actor is an HR Manager (roleId=1) or an HR Executive
 * (deptId=1 + roleId=2). HR is allowed to override the pause-block.
 */
function isHRActor(actorEmpId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!actorEmpId)
            return false;
        const actor = yield prisma_1.prisma.employee.findUnique({
            where: { id: actorEmpId },
            select: { roleId: true, departmentId: true },
        });
        if (!actor)
            return false;
        return actor.roleId === 1 || (actor.departmentId === 1 && actor.roleId === 2);
    });
}
/**
 * Guard for submit endpoints. If the employee is currently paused AND the
 * actor is not HR, returns { blocked: true } and a 423-ready message. HR
 * (roleId 1, or dept 1 + roleId 2) is allowed through.
 *
 *   const guard = await assertNotPausedOrHR(empId, actorEmpId);
 *   if (guard.blocked) return res.status(423).json({ error: guard.message });
 */
function assertNotPausedOrHR(employeeId, actorEmpId) {
    return __awaiter(this, void 0, void 0, function* () {
        const active = yield getActivePauseForEmployee(employeeId);
        if (!active)
            return { blocked: false };
        if (yield isHRActor(actorEmpId))
            return { blocked: false };
        return {
            blocked: true,
            pause: active,
            message: `Employee's appraisal is paused (since ${active.startDate.toISOString().slice(0, 10)}: ${active.reason}). Only HR can override.`,
        };
    });
}
/**
 * Effective months an employee has been "actively working" since their DOJ
 * (or any fromDate), with paused windows subtracted.
 */
function getEffectiveMonthsSinceJoining(employeeId_1, doj_1) {
    return __awaiter(this, arguments, void 0, function* (employeeId, doj, asOf = new Date()) {
        const rawMs = asOf.getTime() - doj.getTime();
        const pausedDays = yield getPausedDaysBetween(employeeId, doj, asOf);
        const effectiveMs = rawMs - pausedDays * MS_PER_DAY;
        return effectiveMs / (MS_PER_DAY * 30.4375); // mean month length
    });
}
// ═══════════════════════════════════════════════════════════════════════════
// CRUD endpoints
// ═══════════════════════════════════════════════════════════════════════════
const listEmployeePauses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.empId);
        const pauses = yield prisma_1.prisma.employeeAppraisalPause.findMany({
            where: { employeeId },
            orderBy: { startDate: "desc" },
        });
        res.json(pauses);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.listEmployeePauses = listEmployeePauses;
/**
 * Returns the currently-active pause for an employee (endDate IS NULL),
 * plus convenience fields the UI uses for badges/labels.
 */
const getActivePause = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.empId);
        const active = yield prisma_1.prisma.employeeAppraisalPause.findFirst({
            where: { employeeId, endDate: null },
            orderBy: { startDate: "desc" },
        });
        res.json({ active });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getActivePause = getActivePause;
const createPause = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.empId);
        const { startDate, endDate, reason, createdBy } = req.body;
        if (!startDate)
            return res.status(400).json({ error: "startDate is required" });
        if (!reason || !reason.trim())
            return res.status(400).json({ error: "reason is required" });
        if (!createdBy)
            return res.status(400).json({ error: "createdBy is required" });
        const start = new Date(startDate);
        const end = endDate ? new Date(endDate) : null;
        if (end && end <= start) {
            return res.status(400).json({ error: "endDate must be after startDate" });
        }
        // Refuse a new pause when one is already active (UI should hit PATCH instead).
        const active = yield prisma_1.prisma.employeeAppraisalPause.findFirst({
            where: { employeeId, endDate: null },
        });
        if (active && (!end || end > new Date())) {
            return res.status(409).json({
                error: "Employee already has an active pause. End the existing pause before starting a new one.",
                activePauseId: active.id,
            });
        }
        const pause = yield prisma_1.prisma.employeeAppraisalPause.create({
            data: {
                employeeId,
                startDate: start,
                endDate: end,
                reason: reason.trim(),
                createdBy,
            },
        });
        res.json(pause);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.createPause = createPause;
/**
 * Update an existing pause — used to end an active pause, fix the reason,
 * or correct a date. Endpoint is also used by the "Resume" button: it sets
 * endDate=today and endedBy=<actor>.
 */
const updatePause = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.pauseId);
        const { startDate, endDate, reason, endedBy } = req.body;
        const existing = yield prisma_1.prisma.employeeAppraisalPause.findUnique({ where: { id } });
        if (!existing)
            return res.status(404).json({ error: "Pause not found" });
        const data = {};
        if (startDate)
            data.startDate = new Date(startDate);
        if (endDate !== undefined) {
            data.endDate = endDate ? new Date(endDate) : null;
            // Closing an ongoing pause → record who closed it + when.
            if (endDate && !existing.endDate) {
                data.endedBy = endedBy !== null && endedBy !== void 0 ? endedBy : null;
                data.endedAt = new Date();
            }
        }
        if (reason !== undefined)
            data.reason = reason.trim();
        if (data.startDate && data.endDate && data.endDate <= data.startDate) {
            return res.status(400).json({ error: "endDate must be after startDate" });
        }
        if (!data.startDate && data.endDate && data.endDate <= existing.startDate) {
            return res.status(400).json({ error: "endDate must be after startDate" });
        }
        const updated = yield prisma_1.prisma.employeeAppraisalPause.update({
            where: { id },
            data,
        });
        res.json(updated);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.updatePause = updatePause;
const deletePause = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.pauseId);
        const existing = yield prisma_1.prisma.employeeAppraisalPause.findUnique({ where: { id } });
        if (!existing)
            return res.status(404).json({ error: "Pause not found" });
        yield prisma_1.prisma.employeeAppraisalPause.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.deletePause = deletePause;
