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
exports.sendPendingWorkReminders = exports.getTrackerDashboard = exports.getTaskHistory = exports.carryForwardTasks = exports.deleteTaskEntry = exports.updateTaskEntry = exports.addTaskEntry = exports.deleteWeeklyReport = exports.updateWeeklyReportStatus = exports.submitWeeklyReport = exports.updateWeeklyReport = exports.getWeeklyReportById = exports.getWeeklyReports = exports.createWeeklyReport = void 0;
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
// ── Helper: ISO week label (e.g. "2026-W14") ──────────────────────────────────
function getWeekLabel(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
// ── Helper: get employee name map ──────────────────────────────────────────────
function getEmployeeMap() {
    return __awaiter(this, void 0, void 0, function* () {
        const emps = yield prisma_1.prisma.employee.findMany({
            select: { id: true, firstName: true, lastName: true },
        });
        return new Map(emps.map(e => [e.id, `${e.firstName} ${e.lastName}`]));
    });
}
// ── Helper: a report is editable by its owner only until an approver acts ───────
// Editable when DRAFT, REJECTED, or SUBMITTED with every approval level still PENDING.
function isReportEditable(report) {
    var _a, _b, _c;
    if (report.status === "DRAFT" || report.status === "REJECTED")
        return true;
    if (report.status === "SUBMITTED") {
        return ((_a = report.inChargeDecision) !== null && _a !== void 0 ? _a : "PENDING") === "PENDING"
            && ((_b = report.hodDecision) !== null && _b !== void 0 ? _b : "PENDING") === "PENDING"
            && ((_c = report.hrDecision) !== null && _c !== void 0 ? _c : "PENDING") === "PENDING";
    }
    return false;
}
// ── Helper: best-effort audit log (never breaks the main operation) ─────────────
function logActivity(reportId, action, byEmpId, detail) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield prisma_1.prisma.weeklyReportActivity.create({
                data: { reportId, action, byEmpId: byEmpId !== null && byEmpId !== void 0 ? byEmpId : null, detail: detail !== null && detail !== void 0 ? detail : null },
            });
        }
        catch (e) {
            console.error("logActivity failed:", e);
        }
    });
}
// ── Helper: if an already-submitted report is edited, ping the pending approver ──
function notifyApproverOfEdit(reportId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const report = yield prisma_1.prisma.weeklyPerformanceReport.findUnique({
                where: { id: reportId },
                select: {
                    status: true, weekLabel: true,
                    employee: { select: { firstName: true, lastName: true, inchargeId: true, reportingManager: true } },
                },
            });
            if (!report || report.status !== "SUBMITTED")
                return;
            const notifyId = report.employee.inchargeId || report.employee.reportingManager;
            if (notifyId) {
                yield (0, notifications_controller_1.createNotification)(notifyId, `${report.employee.firstName} ${report.employee.lastName} edited their submitted weekly report (${(_a = report.weekLabel) !== null && _a !== void 0 ? _a : ""}). Please review again.`);
            }
        }
        catch (e) {
            console.error("notifyApproverOfEdit failed:", e);
        }
    });
}
// ── Helper: notify all active HR Managers (roleId = 1) ──────────────────────────
function notifyHrManagers(message) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const hr = yield prisma_1.prisma.employee.findMany({
                where: { roleId: 1, employmentStatus: "ACTIVE" },
                select: { id: true },
            });
            for (const h of hr)
                yield (0, notifications_controller_1.createNotification)(h.id, message);
        }
        catch (e) {
            console.error("notifyHrManagers failed:", e);
        }
    });
}
// ═══════════════════════════════════════════════════════════════════════════════
// CREATE WEEKLY REPORT
// ═══════════════════════════════════════════════════════════════════════════════
const createWeeklyReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, weekStartDate, weekEndDate, employeeSummary } = req.body;
        if (!employeeId || !weekStartDate || !weekEndDate) {
            return res.status(400).json({ error: "employeeId, weekStartDate, weekEndDate are required" });
        }
        const start = new Date(weekStartDate);
        const end = new Date(weekEndDate);
        const existing = yield prisma_1.prisma.weeklyPerformanceReport.findUnique({
            where: { employeeId_weekStartDate: { employeeId: Number(employeeId), weekStartDate: start } },
        });
        if (existing) {
            return res.status(400).json({ error: "A report already exists for this employee and week" });
        }
        const report = yield prisma_1.prisma.weeklyPerformanceReport.create({
            data: {
                employeeId: Number(employeeId),
                weekStartDate: start,
                weekEndDate: end,
                weekLabel: getWeekLabel(start),
                employeeSummary: employeeSummary || null,
            },
            include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } }, dailyTasks: true },
        });
        yield logActivity(report.id, "CREATED", report.employeeId, `Report created for ${report.weekLabel}`);
        return res.status(201).json(report);
    }
    catch (error) {
        console.error("createWeeklyReport error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.createWeeklyReport = createWeeklyReport;
// ═══════════════════════════════════════════════════════════════════════════════
// GET WEEKLY REPORTS (list)
// ═══════════════════════════════════════════════════════════════════════════════
const getWeeklyReports = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, departmentId, status, weekStartDate, weekEndDate, page, limit, inchargeId, reportingManagerId } = req.query;
        const where = {};
        if (employeeId)
            where.employeeId = Number(employeeId);
        if (status)
            where.status = String(status);
        // Viewer scoping (incharge / reporting manager see only their own team)
        const employeeWhere = {};
        if (departmentId)
            employeeWhere.departmentId = Number(departmentId);
        if (inchargeId)
            employeeWhere.inchargeId = Number(inchargeId);
        if (reportingManagerId)
            employeeWhere.reportingManager = Number(reportingManagerId);
        if (Object.keys(employeeWhere).length)
            where.employee = employeeWhere;
        if (weekStartDate || weekEndDate) {
            where.weekStartDate = {};
            if (weekStartDate)
                where.weekStartDate.gte = new Date(String(weekStartDate));
            if (weekEndDate)
                where.weekStartDate.lte = new Date(String(weekEndDate));
        }
        const take = Number(limit) || 20;
        const skip = ((Number(page) || 1) - 1) * take;
        const [reports, total] = yield Promise.all([
            prisma_1.prisma.weeklyPerformanceReport.findMany({
                where,
                include: {
                    employee: {
                        select: {
                            employeeCode: true, firstName: true, lastName: true,
                            Department: { select: { name: true } },
                            designation: { select: { name: true } },
                            roleId: true, departmentId: true, inchargeId: true, reportingManager: true,
                        },
                    },
                    _count: { select: { dailyTasks: true } },
                },
                orderBy: { weekStartDate: "desc" },
                take,
                skip,
            }),
            prisma_1.prisma.weeklyPerformanceReport.count({ where }),
        ]);
        return res.json({ data: reports, total, page: Number(page) || 1, limit: take });
    }
    catch (error) {
        console.error("getWeeklyReports error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.getWeeklyReports = getWeeklyReports;
// ═══════════════════════════════════════════════════════════════════════════════
// GET SINGLE REPORT BY ID
// ═══════════════════════════════════════════════════════════════════════════════
const getWeeklyReportById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const empMap = yield getEmployeeMap();
        const report = yield prisma_1.prisma.weeklyPerformanceReport.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        employeeCode: true, firstName: true, lastName: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                        inchargeId: true, reportingManager: true, roleId: true, departmentId: true,
                    },
                },
                dailyTasks: { orderBy: [{ taskDate: "asc" }, { createdAt: "asc" }] },
                activities: { orderBy: { createdAt: "desc" } },
            },
        });
        if (!report) {
            return res.status(404).json({ error: "Report not found" });
        }
        const tasksWithAssignerName = report.dailyTasks.map(t => {
            var _a;
            return (Object.assign(Object.assign({}, t), { assignedByName: t.assignedById ? ((_a = empMap.get(t.assignedById)) !== null && _a !== void 0 ? _a : null) : null }));
        });
        const activitiesWithName = report.activities.map(a => {
            var _a;
            return (Object.assign(Object.assign({}, a), { byName: a.byEmpId ? ((_a = empMap.get(a.byEmpId)) !== null && _a !== void 0 ? _a : null) : null }));
        });
        return res.json(Object.assign(Object.assign({}, report), { dailyTasks: tasksWithAssignerName, activities: activitiesWithName }));
    }
    catch (error) {
        console.error("getWeeklyReportById error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.getWeeklyReportById = getWeeklyReportById;
// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE WEEKLY REPORT (DRAFT only)
// ═══════════════════════════════════════════════════════════════════════════════
const updateWeeklyReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const report = yield prisma_1.prisma.weeklyPerformanceReport.findUnique({ where: { id } });
        if (!report)
            return res.status(404).json({ error: "Report not found" });
        if (!isReportEditable(report))
            return res.status(400).json({ error: "This report can no longer be edited (already under or past review)." });
        const { employeeSummary, weekStartDate, weekEndDate } = req.body;
        const data = {};
        if (employeeSummary !== undefined)
            data.employeeSummary = employeeSummary;
        if (weekStartDate) {
            data.weekStartDate = new Date(weekStartDate);
            data.weekLabel = getWeekLabel(new Date(weekStartDate));
        }
        if (weekEndDate)
            data.weekEndDate = new Date(weekEndDate);
        const updated = yield prisma_1.prisma.weeklyPerformanceReport.update({
            where: { id },
            data,
            include: { dailyTasks: true },
        });
        yield logActivity(id, "EDITED", report.employeeId, "Report details updated");
        yield notifyApproverOfEdit(id);
        return res.json(updated);
    }
    catch (error) {
        console.error("updateWeeklyReport error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.updateWeeklyReport = updateWeeklyReport;
// ═══════════════════════════════════════════════════════════════════════════════
// SUBMIT WEEKLY REPORT (DRAFT -> SUBMITTED)
// ═══════════════════════════════════════════════════════════════════════════════
const submitWeeklyReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const report = yield prisma_1.prisma.weeklyPerformanceReport.findUnique({
            where: { id },
            include: {
                employee: { select: { firstName: true, lastName: true, inchargeId: true, reportingManager: true } },
                _count: { select: { dailyTasks: true } },
            },
        });
        if (!report)
            return res.status(404).json({ error: "Report not found" });
        if (!isReportEditable(report))
            return res.status(400).json({ error: "This report can no longer be submitted (already under or past review)." });
        if (report._count.dailyTasks === 0)
            return res.status(400).json({ error: "Add at least one task before submitting" });
        // (Re)submit — reset any prior decisions so a rejected/edited report restarts the chain cleanly.
        const updated = yield prisma_1.prisma.weeklyPerformanceReport.update({
            where: { id },
            data: {
                status: "SUBMITTED",
                submittedAt: new Date(),
                inChargeDecision: "PENDING", inChargeDecidedAt: null, inChargeNote: null, inChargeRating: null,
                hodDecision: "PENDING", hodDecidedAt: null, hodNote: null, hodRating: null,
                hrDecision: "PENDING", hrDecidedAt: null, hrNote: null, hrRating: null,
                approvedBy: null, approvedDate: null, declinedBy: null, declinedDate: null, declineReason: null,
            },
            include: { dailyTasks: true },
        });
        // Notify approver
        const empName = `${report.employee.firstName} ${report.employee.lastName}`;
        const notifyId = report.employee.inchargeId || report.employee.reportingManager;
        if (notifyId) {
            yield (0, notifications_controller_1.createNotification)(notifyId, `${empName} has submitted weekly performance report (${updated.weekLabel}) for your review.`);
        }
        yield logActivity(id, report.status === "DRAFT" ? "SUBMITTED" : "RESUBMITTED", report.employeeId, `Sent for approval`);
        return res.json(updated);
    }
    catch (error) {
        console.error("submitWeeklyReport error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.submitWeeklyReport = submitWeeklyReport;
// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE REPORT STATUS (3-level approval: INCHARGE -> HOD -> HR)
// ═══════════════════════════════════════════════════════════════════════════════
const updateWeeklyReportStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const reportId = Number(req.params.id);
        const { role, status, userId, declineReason, rating, note } = req.body;
        if (!reportId || !role || !status) {
            return res.status(400).json({ error: "id, role, status are required" });
        }
        if (!["Approved", "Declined"].includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }
        const approved = status === "Approved";
        const report = yield prisma_1.prisma.weeklyPerformanceReport.findUnique({
            where: { id: reportId },
            include: { employee: true },
        });
        if (!report)
            return res.status(404).json({ error: "Report not found" });
        if (report.status === "APPROVED" || report.status === "REJECTED") {
            return res.status(400).json({ error: "Report already finalized" });
        }
        if (report.status === "DRAFT") {
            return res.status(400).json({ error: "Report must be submitted first" });
        }
        const emp = report.employee;
        const roleId = emp.roleId;
        const deptId = emp.departmentId;
        const isHRDept = deptId === 1;
        const hasIncharge = !!emp.inchargeId;
        const data = {};
        // ── INCHARGE LEVEL ─────────────────────────────────────────────────────
        if (hasIncharge && role === "INCHARGE") {
            data.inChargeDecision = approved ? "APPROVED" : "REJECTED";
            data.inChargeDecidedAt = new Date();
            data.inChargeNote = note || null;
            if (rating)
                data.inChargeRating = rating;
            if (!approved) {
                data.status = "REJECTED";
                data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                data.declinedDate = new Date();
                data.declineReason = declineReason || null;
            }
            else {
                // Notify reporting manager + inform the employee of progress
                const empName = `${emp.firstName} ${emp.lastName}`;
                if (emp.reportingManager) {
                    yield (0, notifications_controller_1.createNotification)(emp.reportingManager, `Weekly performance report of ${empName} (${report.weekLabel}) has been approved by incharge and is pending your review.`);
                }
                yield (0, notifications_controller_1.createNotification)(report.employeeId, `Your weekly report (${report.weekLabel}) was approved by your incharge and is pending manager review.`);
            }
            const updated = yield prisma_1.prisma.weeklyPerformanceReport.update({
                where: { id: reportId }, data,
                include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } }, dailyTasks: true },
            });
            return res.json(updated);
        }
        // Block others until incharge approves
        if (hasIncharge && report.inChargeDecision !== "APPROVED") {
            return res.status(400).json({ error: "Incharge approval required first" });
        }
        // ── HR EMPLOYEE (dept=1, roleId != 1) → HR_MANAGER final ─────────────
        if (isHRDept && roleId !== 1) {
            if (role !== "HR_MANAGER") {
                return res.status(400).json({ error: "Only HR Manager can approve HR employees" });
            }
            data.hodDecision = approved ? "APPROVED" : "REJECTED";
            data.hodDecidedAt = new Date();
            data.hrDecision = approved ? "APPROVED" : "REJECTED";
            data.hrDecidedAt = new Date();
            data.hrNote = note || null;
            if (rating)
                data.hrRating = rating;
            data.status = approved ? "APPROVED" : "REJECTED";
            if (approved) {
                data.approvedBy = userId !== null && userId !== void 0 ? userId : null;
                data.approvedDate = new Date();
            }
            else {
                data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                data.declinedDate = new Date();
                data.declineReason = declineReason || null;
            }
        }
        // ── HR MANAGER (roleId=1) → MANAGEMENT final ────────────────────────
        else if (roleId === 1) {
            if (role !== "MANAGEMENT") {
                return res.status(400).json({ error: "Only Management can approve HR Manager reports" });
            }
            data.hodDecision = approved ? "APPROVED" : "REJECTED";
            data.hodDecidedAt = new Date();
            data.hrDecision = approved ? "APPROVED" : "REJECTED";
            data.hrDecidedAt = new Date();
            data.hodNote = note || null;
            if (rating)
                data.hodRating = rating;
            data.status = approved ? "APPROVED" : "REJECTED";
            if (approved) {
                data.approvedBy = userId !== null && userId !== void 0 ? userId : null;
                data.approvedDate = new Date();
            }
            else {
                data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                data.declinedDate = new Date();
                data.declineReason = declineReason || null;
            }
        }
        // ── HOD / SENIOR HOD (roleId 3 or 5) ────────────────────────────────
        else if (roleId === 3 || roleId === 5) {
            if (role === "MANAGEMENT") {
                data.hodDecision = approved ? "APPROVED" : "REJECTED";
                data.hodDecidedAt = new Date();
                data.hodNote = note || null;
                if (rating)
                    data.hodRating = rating;
                if (!approved) {
                    data.status = "REJECTED";
                    data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                    data.declinedDate = new Date();
                    data.declineReason = declineReason || null;
                }
            }
            else if (role === "HR_MANAGER") {
                if (report.hodDecision !== "APPROVED") {
                    return res.status(400).json({ error: "Management approval required first" });
                }
                data.hrDecision = approved ? "APPROVED" : "REJECTED";
                data.hrDecidedAt = new Date();
                data.hrNote = note || null;
                if (rating)
                    data.hrRating = rating;
                data.status = approved ? "APPROVED" : "REJECTED";
                if (approved) {
                    data.approvedBy = userId !== null && userId !== void 0 ? userId : null;
                    data.approvedDate = new Date();
                }
                else {
                    data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                    data.declinedDate = new Date();
                    data.declineReason = declineReason || null;
                }
            }
            else {
                return res.status(400).json({ error: "Invalid approver for HOD/Senior HOD" });
            }
        }
        // ── NORMAL EMPLOYEE (roleId=2) ──────────────────────────────────────
        else if (roleId === 2) {
            if (role === "REPORTING_MANAGER") {
                data.hodDecision = approved ? "APPROVED" : "REJECTED";
                data.hodDecidedAt = new Date();
                data.hodNote = note || null;
                if (rating)
                    data.hodRating = rating;
                if (!approved) {
                    data.status = "REJECTED";
                    data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                    data.declinedDate = new Date();
                    data.declineReason = declineReason || null;
                }
            }
            else if (role === "HR_MANAGER") {
                if (report.hodDecision !== "APPROVED") {
                    return res.status(400).json({ error: "Manager approval required first" });
                }
                data.hrDecision = approved ? "APPROVED" : "REJECTED";
                data.hrDecidedAt = new Date();
                data.hrNote = note || null;
                if (rating)
                    data.hrRating = rating;
                data.status = approved ? "APPROVED" : "REJECTED";
                if (approved) {
                    data.approvedBy = userId !== null && userId !== void 0 ? userId : null;
                    data.approvedDate = new Date();
                }
                else {
                    data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                    data.declinedDate = new Date();
                    data.declineReason = declineReason || null;
                }
            }
            else {
                return res.status(400).json({ error: "Invalid approver for Employee" });
            }
        }
        const updated = yield prisma_1.prisma.weeklyPerformanceReport.update({
            where: { id: reportId }, data,
            include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } }, dailyTasks: true },
        });
        // Notify employee on final decision
        if (data.status === "APPROVED" || data.status === "REJECTED") {
            yield (0, notifications_controller_1.createNotification)(report.employeeId, `Your weekly performance report (${report.weekLabel}) has been ${data.status.toLowerCase()}.`);
        }
        // Intermediate approval (report stays SUBMITTED) — keep the chain moving + inform employee.
        else if (approved && (role === "REPORTING_MANAGER" || role === "MANAGEMENT")) {
            const empName = `${emp.firstName} ${emp.lastName}`;
            const byWord = role === "MANAGEMENT" ? "management" : "reporting manager";
            yield notifyHrManagers(`Weekly report of ${empName} (${report.weekLabel}) approved by ${byWord} — pending HR review.`);
            yield (0, notifications_controller_1.createNotification)(report.employeeId, `Your weekly report (${report.weekLabel}) was approved by ${role === "MANAGEMENT" ? "management" : "your manager"} and is pending HR review.`);
        }
        yield logActivity(reportId, approved ? "APPROVED" : "DECLINED", userId !== null && userId !== void 0 ? userId : null, `${role}${approved ? (note ? ` — ${note}` : "") : (declineReason ? ` — ${declineReason}` : "")}`);
        return res.json(updated);
    }
    catch (error) {
        console.error("updateWeeklyReportStatus error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.updateWeeklyReportStatus = updateWeeklyReportStatus;
// ═══════════════════════════════════════════════════════════════════════════════
// DELETE WEEKLY REPORT (DRAFT only)
// ═══════════════════════════════════════════════════════════════════════════════
const deleteWeeklyReport = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const report = yield prisma_1.prisma.weeklyPerformanceReport.findUnique({ where: { id } });
        if (!report)
            return res.status(404).json({ error: "Report not found" });
        if (report.status !== "DRAFT")
            return res.status(400).json({ error: "Can only delete DRAFT reports" });
        yield prisma_1.prisma.weeklyPerformanceReport.delete({ where: { id } });
        return res.json({ message: "Report deleted" });
    }
    catch (error) {
        console.error("deleteWeeklyReport error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.deleteWeeklyReport = deleteWeeklyReport;
// ═══════════════════════════════════════════════════════════════════════════════
// ADD TASK ENTRY
// ═══════════════════════════════════════════════════════════════════════════════
const addTaskEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const reportId = Number(req.params.id);
        const report = yield prisma_1.prisma.weeklyPerformanceReport.findUnique({ where: { id: reportId } });
        if (!report)
            return res.status(404).json({ error: "Report not found" });
        if (!isReportEditable(report))
            return res.status(400).json({ error: "Cannot add tasks — this report is under or past review." });
        const { taskDate, taskDescription, category, priority, taskStatus, percentComplete, assignedById, deadline, completionDate, remarks, isCarriedForward, carriedFromEntryId, } = req.body;
        if (!taskDate || !taskDescription) {
            return res.status(400).json({ error: "taskDate and taskDescription are required" });
        }
        const task = yield prisma_1.prisma.weeklyTaskEntry.create({
            data: {
                reportId,
                taskDate: new Date(taskDate),
                taskDescription,
                category: category || null,
                priority: priority || "MEDIUM",
                taskStatus: taskStatus || "NOT_STARTED",
                percentComplete: percentComplete !== null && percentComplete !== void 0 ? percentComplete : 0,
                assignedById: assignedById ? Number(assignedById) : null,
                deadline: deadline ? new Date(deadline) : null,
                completionDate: completionDate ? new Date(completionDate) : null,
                remarks: remarks || null,
                isCarriedForward: isCarriedForward || false,
                carriedFromEntryId: carriedFromEntryId ? Number(carriedFromEntryId) : null,
            },
        });
        yield logActivity(reportId, "TASK_ADDED", report.employeeId, taskDescription);
        yield notifyApproverOfEdit(reportId);
        return res.status(201).json(task);
    }
    catch (error) {
        console.error("addTaskEntry error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.addTaskEntry = addTaskEntry;
// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE TASK ENTRY
// ═══════════════════════════════════════════════════════════════════════════════
const updateTaskEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const taskId = Number(req.params.taskId);
        const task = yield prisma_1.prisma.weeklyTaskEntry.findUnique({
            where: { id: taskId },
            include: { report: { select: { status: true, inChargeDecision: true, hodDecision: true, hrDecision: true } } },
        });
        if (!task)
            return res.status(404).json({ error: "Task not found" });
        if (!isReportEditable(task.report))
            return res.status(400).json({ error: "Cannot edit tasks — this report is under or past review." });
        const { taskDate, taskDescription, category, priority, taskStatus, percentComplete, assignedById, deadline, completionDate, remarks, } = req.body;
        const data = {};
        if (taskDate !== undefined)
            data.taskDate = new Date(taskDate);
        if (taskDescription !== undefined)
            data.taskDescription = taskDescription;
        if (category !== undefined)
            data.category = category;
        if (priority !== undefined)
            data.priority = priority;
        if (taskStatus !== undefined) {
            data.taskStatus = taskStatus;
            if (taskStatus === "COMPLETED") {
                data.percentComplete = 100;
                if (!completionDate)
                    data.completionDate = new Date();
            }
        }
        if (percentComplete !== undefined)
            data.percentComplete = percentComplete;
        if (assignedById !== undefined)
            data.assignedById = assignedById ? Number(assignedById) : null;
        if (deadline !== undefined)
            data.deadline = deadline ? new Date(deadline) : null;
        if (completionDate !== undefined)
            data.completionDate = completionDate ? new Date(completionDate) : null;
        if (remarks !== undefined)
            data.remarks = remarks;
        const updated = yield prisma_1.prisma.weeklyTaskEntry.update({ where: { id: taskId }, data });
        yield logActivity(task.reportId, "TASK_UPDATED", null, updated.taskDescription);
        yield notifyApproverOfEdit(task.reportId);
        return res.json(updated);
    }
    catch (error) {
        console.error("updateTaskEntry error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.updateTaskEntry = updateTaskEntry;
// ═══════════════════════════════════════════════════════════════════════════════
// DELETE TASK ENTRY
// ═══════════════════════════════════════════════════════════════════════════════
const deleteTaskEntry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const taskId = Number(req.params.taskId);
        const task = yield prisma_1.prisma.weeklyTaskEntry.findUnique({
            where: { id: taskId },
            include: { report: { select: { status: true, inChargeDecision: true, hodDecision: true, hrDecision: true } } },
        });
        if (!task)
            return res.status(404).json({ error: "Task not found" });
        if (!isReportEditable(task.report))
            return res.status(400).json({ error: "Cannot delete tasks — this report is under or past review." });
        yield prisma_1.prisma.weeklyTaskEntry.delete({ where: { id: taskId } });
        yield logActivity(task.reportId, "TASK_DELETED", null, task.taskDescription);
        yield notifyApproverOfEdit(task.reportId);
        return res.json({ message: "Task deleted" });
    }
    catch (error) {
        console.error("deleteTaskEntry error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.deleteTaskEntry = deleteTaskEntry;
// ═══════════════════════════════════════════════════════════════════════════════
// CARRY FORWARD INCOMPLETE TASKS TO NEXT WEEK
// ═══════════════════════════════════════════════════════════════════════════════
const carryForwardTasks = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const fromReportId = Number(req.params.id);
        const { toReportId, taskEntryIds, userId } = req.body;
        const fromReport = yield prisma_1.prisma.weeklyPerformanceReport.findUnique({
            where: { id: fromReportId },
            include: { dailyTasks: true },
        });
        if (!fromReport)
            return res.status(404).json({ error: "Source report not found" });
        // Ownership: an employee may only carry forward their own tasks.
        if (userId && Number(userId) !== fromReport.employeeId) {
            return res.status(403).json({ error: "You can only carry forward your own tasks" });
        }
        // Get incomplete tasks
        let tasksToCarry = fromReport.dailyTasks.filter(t => t.taskStatus !== "COMPLETED" && t.taskStatus !== "CARRIED_FORWARD");
        if (taskEntryIds === null || taskEntryIds === void 0 ? void 0 : taskEntryIds.length) {
            tasksToCarry = tasksToCarry.filter(t => taskEntryIds.includes(t.id));
        }
        if (tasksToCarry.length === 0) {
            return res.status(400).json({ error: "No incomplete tasks to carry forward" });
        }
        // Find or create target report
        let targetReportId = toReportId;
        if (!targetReportId) {
            const nextStart = new Date(fromReport.weekStartDate);
            nextStart.setDate(nextStart.getDate() + 7);
            const nextEnd = new Date(fromReport.weekEndDate);
            nextEnd.setDate(nextEnd.getDate() + 7);
            const existingNext = yield prisma_1.prisma.weeklyPerformanceReport.findUnique({
                where: { employeeId_weekStartDate: { employeeId: fromReport.employeeId, weekStartDate: nextStart } },
            });
            if (existingNext) {
                targetReportId = existingNext.id;
            }
            else {
                const newReport = yield prisma_1.prisma.weeklyPerformanceReport.create({
                    data: {
                        employeeId: fromReport.employeeId,
                        weekStartDate: nextStart,
                        weekEndDate: nextEnd,
                        weekLabel: getWeekLabel(nextStart),
                        previousWeekId: fromReportId,
                    },
                });
                targetReportId = newReport.id;
            }
        }
        // Guard the target + skip tasks already carried in (idempotent re-runs).
        const targetExisting = yield prisma_1.prisma.weeklyPerformanceReport.findUnique({
            where: { id: targetReportId },
            include: { dailyTasks: { select: { carriedFromEntryId: true } } },
        });
        if (targetExisting && !isReportEditable(targetExisting)) {
            return res.status(400).json({ error: "Next week's report is already under review — cannot add carried tasks." });
        }
        const alreadyCarried = new Set(((_a = targetExisting === null || targetExisting === void 0 ? void 0 : targetExisting.dailyTasks) !== null && _a !== void 0 ? _a : []).map(t => t.carriedFromEntryId).filter((v) => v != null));
        tasksToCarry = tasksToCarry.filter(t => !alreadyCarried.has(t.id));
        if (tasksToCarry.length === 0) {
            return res.status(400).json({ error: "These tasks are already carried forward to next week." });
        }
        // Create carried-forward entries in target report
        for (const task of tasksToCarry) {
            yield prisma_1.prisma.weeklyTaskEntry.create({
                data: {
                    reportId: targetReportId,
                    taskDate: task.taskDate,
                    taskDescription: task.taskDescription,
                    category: task.category,
                    priority: task.priority,
                    taskStatus: "NOT_STARTED",
                    percentComplete: task.percentComplete,
                    assignedById: task.assignedById,
                    deadline: task.deadline,
                    remarks: `Carried forward from ${fromReport.weekLabel}`,
                    isCarriedForward: true,
                    carriedFromEntryId: task.id,
                },
            });
            // Mark original as carried forward
            yield prisma_1.prisma.weeklyTaskEntry.update({
                where: { id: task.id },
                data: { taskStatus: "CARRIED_FORWARD" },
            });
        }
        const targetReport = yield prisma_1.prisma.weeklyPerformanceReport.findUnique({
            where: { id: targetReportId },
            include: { dailyTasks: true },
        });
        yield logActivity(fromReportId, "CARRIED_FORWARD", fromReport.employeeId, `${tasksToCarry.length} task(s) carried to ${(_b = targetReport === null || targetReport === void 0 ? void 0 : targetReport.weekLabel) !== null && _b !== void 0 ? _b : "next week"}`);
        return res.json({ message: `${tasksToCarry.length} tasks carried forward`, targetReport });
    }
    catch (error) {
        console.error("carryForwardTasks error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.carryForwardTasks = carryForwardTasks;
// ═══════════════════════════════════════════════════════════════════════════════
// TASK CARRY-FORWARD HISTORY (walk the carriedFromEntryId lineage across weeks)
// ═══════════════════════════════════════════════════════════════════════════════
const getTaskHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const taskId = Number(req.params.taskId);
        const start = yield prisma_1.prisma.weeklyTaskEntry.findUnique({ where: { id: taskId } });
        if (!start)
            return res.status(404).json({ error: "Task not found" });
        const chain = new Map();
        // Walk backward through the origins.
        let cur = start;
        while (cur) {
            chain.set(cur.id, cur);
            cur = cur.carriedFromEntryId
                ? yield prisma_1.prisma.weeklyTaskEntry.findUnique({ where: { id: cur.carriedFromEntryId } })
                : null;
        }
        // Walk forward through descendants (BFS, handles any branching).
        const queue = [...chain.keys()];
        while (queue.length) {
            const id = queue.shift();
            const children = yield prisma_1.prisma.weeklyTaskEntry.findMany({ where: { carriedFromEntryId: id } });
            for (const c of children) {
                if (!chain.has(c.id)) {
                    chain.set(c.id, c);
                    queue.push(c.id);
                }
            }
        }
        // Attach each entry's week info, ordered chronologically.
        const entries = [...chain.values()];
        const reportIds = [...new Set(entries.map(e => e.reportId))];
        const reports = yield prisma_1.prisma.weeklyPerformanceReport.findMany({
            where: { id: { in: reportIds } },
            select: { id: true, weekLabel: true, weekStartDate: true, weekEndDate: true, status: true },
        });
        const repMap = new Map(reports.map(r => [r.id, r]));
        const history = entries
            .map(e => {
            var _a;
            return ({
                id: e.id,
                reportId: e.reportId,
                week: (_a = repMap.get(e.reportId)) !== null && _a !== void 0 ? _a : null,
                taskDescription: e.taskDescription,
                taskStatus: e.taskStatus,
                percentComplete: e.percentComplete,
                isCarriedForward: e.isCarriedForward,
                carriedFromEntryId: e.carriedFromEntryId,
            });
        })
            .sort((a, b) => { var _a, _b, _c, _d; return new Date((_b = (_a = a.week) === null || _a === void 0 ? void 0 : _a.weekStartDate) !== null && _b !== void 0 ? _b : 0).getTime() - new Date((_d = (_c = b.week) === null || _c === void 0 ? void 0 : _c.weekStartDate) !== null && _d !== void 0 ? _d : 0).getTime(); });
        return res.json({ history });
    }
    catch (error) {
        console.error("getTaskHistory error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.getTaskHistory = getTaskHistory;
// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
const getTrackerDashboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, departmentId } = req.query;
        const where = {};
        if (employeeId)
            where.employeeId = Number(employeeId);
        if (departmentId)
            where.employee = { departmentId: Number(departmentId) };
        const [draft, submitted, approved, rejected, total] = yield Promise.all([
            prisma_1.prisma.weeklyPerformanceReport.count({ where: Object.assign(Object.assign({}, where), { status: "DRAFT" }) }),
            prisma_1.prisma.weeklyPerformanceReport.count({ where: Object.assign(Object.assign({}, where), { status: "SUBMITTED" }) }),
            prisma_1.prisma.weeklyPerformanceReport.count({ where: Object.assign(Object.assign({}, where), { status: "APPROVED" }) }),
            prisma_1.prisma.weeklyPerformanceReport.count({ where: Object.assign(Object.assign({}, where), { status: "REJECTED" }) }),
            prisma_1.prisma.weeklyPerformanceReport.count({ where }),
        ]);
        // Pending reviews (submitted but not fully approved)
        const pendingReview = yield prisma_1.prisma.weeklyPerformanceReport.findMany({
            where: Object.assign(Object.assign({}, where), { status: "SUBMITTED" }),
            include: {
                employee: {
                    select: {
                        employeeCode: true, firstName: true, lastName: true,
                        Department: { select: { name: true } },
                    },
                },
            },
            orderBy: { submittedAt: "asc" },
            take: 20,
        });
        // Recent approvals
        const recentApproved = yield prisma_1.prisma.weeklyPerformanceReport.findMany({
            where: Object.assign(Object.assign({}, where), { status: "APPROVED" }),
            include: {
                employee: {
                    select: { employeeCode: true, firstName: true, lastName: true },
                },
            },
            orderBy: { approvedDate: "desc" },
            take: 10,
        });
        return res.json({
            counts: { draft, submitted, approved, rejected, total },
            pendingReview,
            recentApproved,
        });
    }
    catch (error) {
        console.error("getTrackerDashboard error:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.getTrackerDashboard = getTrackerDashboard;
// ═══════════════════════════════════════════════════════════════════════════════
// PENDING-WORK REMINDERS (run by the daily cron)
// Reminds each employee about their NOT_STARTED / IN_PROGRESS tasks (overdue flagged),
// notifies their incharge + reporting manager per team member, and sends HR a digest.
// ═══════════════════════════════════════════════════════════════════════════════
const sendPendingWorkReminders = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const now = new Date();
    const tasks = yield prisma_1.prisma.weeklyTaskEntry.findMany({
        where: {
            taskStatus: { in: ["NOT_STARTED", "IN_PROGRESS"] },
            report: { status: { not: "REJECTED" } },
        },
        select: {
            deadline: true,
            report: {
                select: {
                    weekLabel: true, employeeId: true,
                    employee: {
                        select: {
                            id: true, firstName: true, lastName: true,
                            inchargeId: true, reportingManager: true, employmentStatus: true,
                        },
                    },
                },
            },
        },
    });
    // Group pending tasks per active employee.
    const byEmp = new Map();
    for (const t of tasks) {
        const emp = (_a = t.report) === null || _a === void 0 ? void 0 : _a.employee;
        if (!emp || emp.employmentStatus !== "ACTIVE")
            continue;
        let g = byEmp.get(emp.id);
        if (!g) {
            g = { emp, total: 0, overdue: 0 };
            byEmp.set(emp.id, g);
        }
        g.total++;
        if (t.deadline && new Date(t.deadline) < now)
            g.overdue++;
    }
    // Notify each employee + their incharge & reporting manager.
    for (const g of byEmp.values()) {
        const name = `${g.emp.firstName} ${g.emp.lastName}`;
        const ov = g.overdue ? ` (${g.overdue} overdue)` : "";
        yield (0, notifications_controller_1.createNotification)(g.emp.id, `You have ${g.total} pending task(s)${ov} in your weekly tracker. Please update or complete them.`);
        if (g.emp.inchargeId) {
            yield (0, notifications_controller_1.createNotification)(g.emp.inchargeId, `${name} has ${g.total} pending weekly task(s)${ov}.`);
        }
        if (g.emp.reportingManager) {
            yield (0, notifications_controller_1.createNotification)(g.emp.reportingManager, `${name} has ${g.total} pending weekly task(s)${ov}.`);
        }
    }
    // Single digest to each HR Manager.
    if (byEmp.size > 0) {
        const totalTasks = [...byEmp.values()].reduce((s, g) => s + g.total, 0);
        const totalOverdue = [...byEmp.values()].reduce((s, g) => s + g.overdue, 0);
        yield notifyHrManagers(`Weekly tracker: ${byEmp.size} employee(s) have ${totalTasks} pending task(s)${totalOverdue ? `, ${totalOverdue} overdue` : ""}.`);
    }
    return { employees: byEmp.size, tasks: tasks.length };
});
exports.sendPendingWorkReminders = sendPendingWorkReminders;
