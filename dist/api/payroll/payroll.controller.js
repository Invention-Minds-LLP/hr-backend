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
exports.getPayrollSummary = exports.updatePayslipRemarks = exports.getPayslip = exports.getMyPayslips = exports.listPayslips = exports.deletePayrollRun = exports.publishPayrollRun = exports.getPayrollRun = exports.createPayrollRun = exports.listPayrollRuns = exports.upsertSalaryStructure = exports.getEmployeeSalaryStructure = exports.listSalaryStructures = void 0;
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
// ─── helpers ─────────────────────────────────────────────────────────────────
function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
}
function professionalTax(gross) {
    if (gross < 15000)
        return 0;
    if (gross < 20000)
        return 150;
    return 200;
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
// Count calendar working days (Mon–Sat) in a month; no holiday deduction here
// (attendance data already reflects holidays/week-offs)
function calendarWorkingDays(year, month) {
    const total = daysInMonth(year, month);
    let count = 0;
    for (let d = 1; d <= total; d++) {
        const day = new Date(year, month - 1, d).getDay(); // 0=Sun
        if (day !== 0)
            count++;
    }
    return count;
}
function buildPayslip(employeeId, month, year, payrollRunId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const sal = yield prisma_1.prisma.salaryStructure.findUnique({ where: { employeeId } });
        if (!sal)
            return null;
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);
        // ── attendance ──────────────────────────────────────────────────────────────
        const attendances = yield prisma_1.prisma.attendance.findMany({
            where: { employeeId, date: { gte: startDate, lte: endDate } },
        });
        let presentDays = 0;
        for (const a of attendances) {
            const s = a.status;
            if (s === 'PRESENT')
                presentDays += 1;
            else if (s === 'HALF_DAY')
                presentDays += 0.5;
            else if (s === 'WEEK_OFF')
                presentDays += 1; // paid
            else if (s === 'HOLIDAY')
                presentDays += 1; // paid
            else if (s === 'COMP_OFF')
                presentDays += 1; // paid
            else if (s === 'WFH')
                presentDays += 1; // paid
        }
        // ── approved leaves ─────────────────────────────────────────────────────────
        const leaves = yield prisma_1.prisma.leaveRequest.findMany({
            where: {
                employeeId,
                status: 'APPROVED',
                startDate: { lte: endDate },
                endDate: { gte: startDate },
            },
        });
        let leaveDays = 0;
        for (const l of leaves) {
            const s = new Date(Math.max(l.startDate.getTime(), startDate.getTime()));
            const e = new Date(Math.min(l.endDate.getTime(), endDate.getTime()));
            const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
            leaveDays += diff;
        }
        presentDays += leaveDays;
        // ── overtime ─────────────────────────────────────────────────────────────────
        const otRecords = yield prisma_1.prisma.overtimeApproval.findMany({
            where: {
                employeeId,
                status: 'APPROVED',
                date: { gte: startDate, lte: endDate },
            },
        });
        let overtimeHours = 0;
        for (const ot of otRecords) {
            overtimeHours += (_a = ot.hours) !== null && _a !== void 0 ? _a : 0;
        }
        const workingDays = calendarWorkingDays(year, month);
        const lopDays = Math.max(0, workingDays - presentDays);
        // ── earnings ─────────────────────────────────────────────────────────────────
        const gross = sal.basic + sal.hra + sal.medicalAllowance + sal.travelAllowance +
            sal.specialAllowance + sal.otherAllowances;
        const perDay = workingDays > 0 ? gross / workingDays : 0;
        const earnedGross = round2(gross - lopDays * perDay);
        // Hourly OT rate = (basic / (workingDays * 8)) * 2 (double rate)
        const hourlyOtRate = workingDays > 0 ? (sal.basic / (workingDays * 8)) * 2 : 0;
        const overtimePay = round2(overtimeHours * hourlyOtRate);
        // ── deductions ───────────────────────────────────────────────────────────────
        const pfEmployee = sal.pfApplicable ? round2(sal.basic * 0.12) : 0;
        const pfEmployer = sal.pfApplicable ? round2(sal.basic * 0.12) : 0;
        const esiEmployee = (sal.esiApplicable && gross <= 21000) ? round2(gross * 0.0075) : 0;
        const esiEmployer = (sal.esiApplicable && gross <= 21000) ? round2(gross * 0.0325) : 0;
        const pt = sal.ptApplicable ? professionalTax(earnedGross) : 0;
        const tds = (_b = sal.tdsMonthly) !== null && _b !== void 0 ? _b : 0;
        const totalDeductions = round2(pfEmployee + esiEmployee + pt + tds);
        const netPay = round2(earnedGross + overtimePay - totalDeductions);
        return {
            employeeId,
            payrollRunId,
            month,
            year,
            workingDays,
            presentDays: round2(presentDays),
            leaveDays: round2(leaveDays),
            lopDays: round2(lopDays),
            overtimeHours,
            overtimePay,
            basic: sal.basic,
            hra: sal.hra,
            medicalAllowance: sal.medicalAllowance,
            travelAllowance: sal.travelAllowance,
            specialAllowance: sal.specialAllowance,
            otherAllowances: sal.otherAllowances,
            grossEarnings: earnedGross,
            pfEmployee,
            pfEmployer,
            esiEmployee,
            esiEmployer,
            professionalTax: pt,
            tds,
            totalDeductions,
            netPay,
        };
    });
}
// ─── salary structure ─────────────────────────────────────────────────────────
const listSalaryStructures = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { search = '', page = '1', limit = '20' } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const structures = yield prisma_1.prisma.salaryStructure.findMany({
            skip,
            take: Number(limit),
            include: {
                employee: {
                    select: {
                        id: true, firstName: true, lastName: true, employeeCode: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
            },
            where: search
                ? {
                    employee: {
                        OR: [
                            { firstName: { contains: search } },
                            { lastName: { contains: search } },
                            { employeeCode: { contains: search } },
                        ],
                    },
                }
                : undefined,
            orderBy: { employee: { firstName: 'asc' } },
        });
        const total = yield prisma_1.prisma.salaryStructure.count();
        res.json({ data: structures, total });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.listSalaryStructures = listSalaryStructures;
const getEmployeeSalaryStructure = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        const structure = yield prisma_1.prisma.salaryStructure.findUnique({
            where: { employeeId },
        });
        if (!structure)
            return res.status(404).json({ message: 'No salary structure found' });
        res.json(structure);
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.getEmployeeSalaryStructure = getEmployeeSalaryStructure;
const upsertSalaryStructure = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { employeeId, basic = 0, hra = 0, medicalAllowance = 0, travelAllowance = 0, specialAllowance = 0, otherAllowances = 0, pfApplicable = true, esiApplicable = true, ptApplicable = true, tdsMonthly = 0, effectiveFrom, } = req.body;
        if (!employeeId)
            return res.status(400).json({ message: 'employeeId required' });
        const empId = Number(employeeId);
        const ctc = (n) => (n.basic || 0) + (n.hra || 0) + (n.medicalAllowance || 0) + (n.travelAllowance || 0) +
            (n.specialAllowance || 0) + (n.otherAllowances || 0);
        // Capture the prior CTC before the upsert so we can log a revision.
        const existing = yield prisma_1.prisma.salaryStructure.findUnique({ where: { employeeId: empId } });
        const oldCtc = existing ? ctc(existing) : 0;
        const newCtc = ctc({ basic, hra, medicalAllowance, travelAllowance, specialAllowance, otherAllowances });
        const structure = yield prisma_1.prisma.salaryStructure.upsert({
            where: { employeeId: empId },
            create: {
                employeeId: empId,
                basic, hra, medicalAllowance, travelAllowance, specialAllowance, otherAllowances,
                pfApplicable, esiApplicable, ptApplicable, tdsMonthly,
                effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
            },
            update: {
                basic, hra, medicalAllowance, travelAllowance, specialAllowance, otherAllowances,
                pfApplicable, esiApplicable, ptApplicable, tdsMonthly,
                effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
            },
        });
        // Record a salary revision when an existing CTC actually changed
        // (feeds management dashboard #22 — increment % by department).
        if (existing && oldCtc > 0 && Math.round(oldCtc) !== Math.round(newCtc)) {
            yield prisma_1.prisma.salaryRevision.create({
                data: {
                    employeeId: empId,
                    previousCtc: oldCtc,
                    newCtc,
                    percentage: +(((newCtc - oldCtc) / oldCtc) * 100).toFixed(2),
                    effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
                    reason: (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.reason) !== null && _b !== void 0 ? _b : null,
                    createdBy: (_d = (_c = req.user) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null,
                },
            });
        }
        res.json(structure);
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.upsertSalaryStructure = upsertSalaryStructure;
// ─── payroll runs ─────────────────────────────────────────────────────────────
const listPayrollRuns = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const runs = yield prisma_1.prisma.payrollRun.findMany({
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            include: { _count: { select: { payslips: true } } },
        });
        res.json(runs);
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.listPayrollRuns = listPayrollRuns;
const createPayrollRun = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { month, year, notes } = req.body;
        const performedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.employeeId) !== null && _b !== void 0 ? _b : 1;
        if (!month || !year)
            return res.status(400).json({ message: 'month and year required' });
        // Prevent duplicate run
        const existing = yield prisma_1.prisma.payrollRun.findUnique({
            where: { month_year: { month: Number(month), year: Number(year) } },
        });
        if (existing)
            return res.status(409).json({ message: `Payroll run for ${month}/${year} already exists` });
        // Fetch all active employees with a salary structure
        const employees = yield prisma_1.prisma.employee.findMany({
            where: {
                employmentStatus: 'ACTIVE',
                salaryStructure: { isNot: null },
            },
            select: { id: true },
        });
        // Create run first
        const run = yield prisma_1.prisma.payrollRun.create({
            data: { month: Number(month), year: Number(year), notes, processedBy: performedBy, status: 'DRAFT' },
        });
        // Build all payslips
        const payslipData = [];
        for (const emp of employees) {
            const ps = yield buildPayslip(emp.id, Number(month), Number(year), run.id);
            if (ps)
                payslipData.push(ps);
        }
        if (payslipData.length > 0) {
            yield prisma_1.prisma.payslip.createMany({ data: payslipData });
        }
        const fullRun = yield prisma_1.prisma.payrollRun.findUnique({
            where: { id: run.id },
            include: { _count: { select: { payslips: true } } },
        });
        res.status(201).json(fullRun);
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.createPayrollRun = createPayrollRun;
const getPayrollRun = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const runId = Number(req.params.id);
        const run = yield prisma_1.prisma.payrollRun.findUnique({
            where: { id: runId },
            include: {
                payslips: {
                    include: {
                        employee: {
                            select: {
                                id: true, firstName: true, lastName: true, employeeCode: true,
                                Department: { select: { name: true } },
                                designation: { select: { name: true } },
                            },
                        },
                    },
                    orderBy: { employee: { firstName: 'asc' } },
                },
            },
        });
        if (!run)
            return res.status(404).json({ message: 'Payroll run not found' });
        res.json(run);
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.getPayrollRun = getPayrollRun;
const publishPayrollRun = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const runId = Number(req.params.id);
        const run = yield prisma_1.prisma.payrollRun.update({
            where: { id: runId },
            data: { status: 'PUBLISHED' },
        });
        // 🔔 Notify every employee who has a payslip in this run
        const payslips = yield prisma_1.prisma.payslip.findMany({
            where: { payrollRunId: runId },
            select: { employeeId: true }
        });
        for (const p of payslips) {
            yield (0, notifications_controller_1.createNotification)(p.employeeId, `Your payslip for ${monthName(run.month)} ${run.year} is now available. Visit the Payroll section to view it.`);
        }
        res.json(run);
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.publishPayrollRun = publishPayrollRun;
function monthName(m) {
    var _a;
    return (_a = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]) !== null && _a !== void 0 ? _a : String(m);
}
const deletePayrollRun = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const runId = Number(req.params.id);
        // Only allow deleting DRAFT runs
        const run = yield prisma_1.prisma.payrollRun.findUnique({ where: { id: runId } });
        if (!run)
            return res.status(404).json({ message: 'Not found' });
        if (run.status === 'PUBLISHED')
            return res.status(400).json({ message: 'Cannot delete a published payroll run' });
        yield prisma_1.prisma.payslip.deleteMany({ where: { payrollRunId: runId } });
        yield prisma_1.prisma.payrollRun.delete({ where: { id: runId } });
        res.json({ message: 'Deleted' });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.deletePayrollRun = deletePayrollRun;
// ─── payslips ─────────────────────────────────────────────────────────────────
const listPayslips = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { month, year, employeeId, page = '1', limit = '20' } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const where = {};
        if (month)
            where.month = Number(month);
        if (year)
            where.year = Number(year);
        if (employeeId)
            where.employeeId = Number(employeeId);
        const [data, total] = yield Promise.all([
            prisma_1.prisma.payslip.findMany({
                where,
                skip,
                take: Number(limit),
                include: {
                    employee: {
                        select: {
                            id: true, firstName: true, lastName: true, employeeCode: true,
                            Department: { select: { name: true } },
                            designation: { select: { name: true } },
                        },
                    },
                    payrollRun: { select: { status: true } },
                },
                orderBy: [{ year: 'desc' }, { month: 'desc' }],
            }),
            prisma_1.prisma.payslip.count({ where }),
        ]);
        res.json({ data, total });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.listPayslips = listPayslips;
const getMyPayslips = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const employeeId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId;
        console.log(employeeId);
        if (!employeeId)
            return res.status(400).json({ message: 'Unauthorized' });
        const payslips = yield prisma_1.prisma.payslip.findMany({
            where: { employeeId, payrollRun: { status: 'PUBLISHED' } },
            include: { payrollRun: { select: { status: true, notes: true } } },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
        });
        res.json(payslips);
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.getMyPayslips = getMyPayslips;
const getPayslip = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const payslip = yield prisma_1.prisma.payslip.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true, firstName: true, lastName: true, employeeCode: true,
                        phone: true, email: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                        Branch: { select: { name: true } },
                    },
                },
                payrollRun: true,
            },
        });
        if (!payslip)
            return res.status(404).json({ message: 'Payslip not found' });
        res.json(payslip);
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.getPayslip = getPayslip;
const updatePayslipRemarks = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { remarks } = req.body;
        const ps = yield prisma_1.prisma.payslip.update({ where: { id }, data: { remarks } });
        res.json(ps);
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.updatePayslipRemarks = updatePayslipRemarks;
// ─── payroll summary (for dashboard cards) ───────────────────────────────────
const getPayrollSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { month, year } = req.query;
        const run = yield prisma_1.prisma.payrollRun.findUnique({
            where: { month_year: { month: Number(month), year: Number(year) } },
            include: { payslips: true },
        });
        if (!run)
            return res.json({ exists: false });
        const totalGross = run.payslips.reduce((s, p) => s + p.grossEarnings, 0);
        const totalNet = run.payslips.reduce((s, p) => s + p.netPay, 0);
        const totalPF = run.payslips.reduce((s, p) => s + p.pfEmployee + p.pfEmployer, 0);
        const totalESI = run.payslips.reduce((s, p) => s + p.esiEmployee + p.esiEmployer, 0);
        const totalLop = run.payslips.reduce((s, p) => s + p.lopDays, 0);
        res.json({
            exists: true,
            runId: run.id,
            status: run.status,
            headcount: run.payslips.length,
            totalGross: round2(totalGross),
            totalNet: round2(totalNet),
            totalPF: round2(totalPF),
            totalESI: round2(totalESI),
            totalLop: round2(totalLop),
        });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
});
exports.getPayrollSummary = getPayrollSummary;
