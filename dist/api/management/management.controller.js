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
exports.getPayrollReadiness = exports.getIncentiveOverview = exports.getLoanOverview = exports.getPayrollTrend = exports.getPayrollOverview = exports.getTrainingCalendar = exports.getTrainingInsights = exports.getElInsights = exports.getQualifications = exports.getMobileLoginActivity = exports.getWorkforceInsights = exports.getAbsenteeism = exports.getLeaveUtilization = exports.getLateArrivals = exports.getOtAnalysis = exports.getKpiDetail = exports.getPerformanceDistribution = exports.getWeeklyTrend = exports.getDeptSnapshot = exports.getDeptRisk = exports.getActionItems = exports.getTrainingByDept = exports.getRecruitmentFunnel = exports.getAttritionTrend = exports.getActivePIPs = exports.getPerformanceRadar = exports.getLeaveCalendar = exports.getAttendanceSummary = exports.getWorkforce = exports.getAttention = exports.getPulse = void 0;
const prisma_1 = require("../../lib/prisma");
const date_fns_1 = require("date-fns");
function startOfDayIST(d = new Date()) {
    const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    ist.setHours(0, 0, 0, 0);
    return ist;
}
function endOfDayIST(d = new Date()) {
    const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    ist.setHours(23, 59, 59, 999);
    return ist;
}
// ═══════════════════════════════════════════════════════════
// SECTION 1 — PULSE KPIs
// GET /api/management/pulse
// ═══════════════════════════════════════════════════════════
const getPulse = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const todayStart = startOfDayIST();
        const todayEnd = endOfDayIST();
        const monthStart = (0, date_fns_1.startOfMonth)(new Date());
        const monthEnd = (0, date_fns_1.endOfMonth)(new Date());
        const [totalHeadcount, presentToday, pendingLeaves, pendingPermissions, openJobs, activePIPs, resignationsThisMonth, otPending, trainingTotal, trainingCompleted,] = yield Promise.all([
            // 1. Total active headcount
            prisma_1.prisma.employee.count({ where: { employmentStatus: "ACTIVE" } }),
            // 2. Present today
            prisma_1.prisma.attendance.count({
                where: {
                    date: { gte: todayStart, lte: todayEnd },
                    status: "PRESENT",
                },
            }),
            // 3. Pending leave requests
            prisma_1.prisma.leaveRequest.count({ where: { status: "PENDING" } }),
            // 4. Pending permissions
            prisma_1.prisma.permissionRequest.count({ where: { status: "PENDING" } }),
            // 5. Open job positions
            prisma_1.prisma.job.count({ where: { status: "OPEN" } }),
            // 6. Active PIPs
            prisma_1.prisma.employeePIP.count({
                where: {
                    status: {
                        in: ["WARNING_ISSUED", "PIP_ACTIVE", "PIP_EXTENDED"],
                    },
                },
            }),
            // 7. Resignations this month
            prisma_1.prisma.resignationRequest.count({
                where: {
                    createdAt: { gte: monthStart, lte: monthEnd },
                    status: { notIn: ["WITHDRAWN", "CANCELLED", "REJECTED"] },
                },
            }),
            // 8. OT pending approval (>60 min)
            prisma_1.prisma.overtimeApproval.count({
                where: {
                    status: "PENDING",
                    managerStatus: "APPROVED",
                    minutes: { gt: 60 },
                },
            }),
            // 9. Training assignments total
            prisma_1.prisma.trainingAssignment.count(),
            // 10. Training completed
            prisma_1.prisma.trainingAssignment.count({ where: { status: "Completed" } }),
        ]);
        const attendancePct = totalHeadcount > 0
            ? Math.round((presentToday / totalHeadcount) * 100)
            : 0;
        const trainingPct = trainingTotal > 0
            ? Math.round((trainingCompleted / trainingTotal) * 100)
            : 0;
        // ── Period comparisons (vs last month) ───────────────────────
        // Cheap parallel fetch — only the four metrics where MoM delta is
        // meaningful. Transient counts (pending leaves, OT pending) are
        // point-in-time so we don't bother with their deltas.
        const prevMonthStart = (0, date_fns_1.startOfMonth)((0, date_fns_1.subMonths)(new Date(), 1));
        const prevMonthEnd = (0, date_fns_1.endOfMonth)((0, date_fns_1.subMonths)(new Date(), 1));
        const [prevHeadcount, // active employees as of end of last month
        prevAttritionFullMonth, // resignations during entire previous month
        prevTrainingTotal, // assignments due in last month
        prevTrainingCompleted, prevAttendanceAvg, // avg daily attendance % in last month
        ] = yield Promise.all([
            // Active count at end of last month — anyone whose status was ACTIVE then
            // (good-enough proxy: employees joined before end-of-prev-month and not
            // exited before end-of-prev-month is harder to compute without an audit
            // log; we use current ACTIVE employees with dateOfJoining <= prevMonthEnd
            // as the closest reasonable approximation).
            prisma_1.prisma.employee.count({
                where: {
                    employmentStatus: "ACTIVE",
                    dateOfJoining: { lte: prevMonthEnd },
                },
            }),
            prisma_1.prisma.resignationRequest.count({
                where: {
                    createdAt: { gte: prevMonthStart, lte: prevMonthEnd },
                    status: { notIn: ["WITHDRAWN", "CANCELLED", "REJECTED"] },
                },
            }),
            prisma_1.prisma.trainingAssignment.count({
                where: { createdAt: { gte: prevMonthStart, lte: prevMonthEnd } },
            }),
            prisma_1.prisma.trainingAssignment.count({
                where: {
                    status: "Completed",
                    createdAt: { gte: prevMonthStart, lte: prevMonthEnd },
                },
            }),
            // Avg attendance % across last month — single SQL aggregate.
            // Counts PRESENT rows divided by total attendance rows.
            (() => __awaiter(void 0, void 0, void 0, function* () {
                const [presentCount, totalCount] = yield Promise.all([
                    prisma_1.prisma.attendance.count({
                        where: {
                            date: { gte: prevMonthStart, lte: prevMonthEnd },
                            status: "PRESENT",
                        },
                    }),
                    prisma_1.prisma.attendance.count({
                        where: { date: { gte: prevMonthStart, lte: prevMonthEnd } },
                    }),
                ]);
                return totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;
            }))(),
        ]);
        const prevTrainingPct = prevTrainingTotal > 0
            ? Math.round((prevTrainingCompleted / prevTrainingTotal) * 100)
            : 0;
        // delta() returns null when prev=0 (avoids divide-by-zero / nonsense %).
        // Return the absolute diff so the UI can show "↑ 3" or "↑ 4.2%" cleanly.
        const delta = (curr, prev) => prev === 0 ? null : Number(((curr - prev) * 100 / prev).toFixed(1));
        res.json({
            headcount: totalHeadcount,
            presentToday,
            attendancePct,
            pendingApprovals: pendingLeaves + pendingPermissions,
            pendingLeaves,
            pendingPermissions,
            openPositions: openJobs,
            activePIPs,
            attritionMTD: resignationsThisMonth,
            otPending,
            trainingCompletionPct: trainingPct,
            // Comparison block — null = no prior data, frontend hides delta chip.
            comparisons: {
                headcount: { prev: prevHeadcount, deltaPct: delta(totalHeadcount, prevHeadcount) },
                attendancePct: {
                    prev: prevAttendanceAvg,
                    // attendance % is ALREADY a percentage, so use absolute-point delta
                    // (e.g. "84% vs 87% = -3 points") — `deltaPct` carried percentage diff
                    // would be misleading.
                    deltaPoints: prevAttendanceAvg ? Number((attendancePct - prevAttendanceAvg).toFixed(1)) : null,
                },
                attritionMTD: { prev: prevAttritionFullMonth, deltaPct: delta(resignationsThisMonth, prevAttritionFullMonth) },
                trainingCompletionPct: { prev: prevTrainingPct, deltaPoints: prevTrainingPct ? Number((trainingPct - prevTrainingPct).toFixed(1)) : null },
            },
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getPulse = getPulse;
// ═══════════════════════════════════════════════════════════
// ATTENTION NEEDED — auto-flagged items requiring management review
// GET /api/management/attention
//
// Runs threshold checks across attendance, attrition, OT, recruitment
// and training. Returns a sorted list of alerts ({ severity, title,
// message, sectionId }). The frontend renders them as red/yellow/blue
// chips at the top of the dashboard so management can see "what needs
// my attention today" at a glance, without scrolling 19 sections.
//
// Thresholds are env-overridable so HR/Ops can tune them per hospital
// without code changes. See ATTENTION_THRESHOLDS below.
// ═══════════════════════════════════════════════════════════
const ATTENTION_THRESHOLDS = {
    attendancePctRed: Number(process.env.ATTN_ATTENDANCE_RED) || 80, // <80% → red
    attendancePctYellow: Number(process.env.ATTN_ATTENDANCE_YELLOW) || 90, // 80-89% → yellow
    pendingLeavesYellow: Number(process.env.ATTN_PENDING_LEAVES) || 20,
    pendingPermsYellow: Number(process.env.ATTN_PENDING_PERMS) || 20,
    pipRed: Number(process.env.ATTN_PIP_RED) || 5,
    pipYellow: Number(process.env.ATTN_PIP_YELLOW) || 2,
    attritionMtdRed: Number(process.env.ATTN_ATTRITION_RED) || 5,
    attritionMtdYellow: Number(process.env.ATTN_ATTRITION_YELLOW) || 2,
    otPendingYellow: Number(process.env.ATTN_OT_PENDING) || 30,
    openJobsYellow: Number(process.env.ATTN_OPEN_JOBS) || 10,
    trainingPctRed: Number(process.env.ATTN_TRAINING_RED) || 50,
    trainingPctYellow: Number(process.env.ATTN_TRAINING_YELLOW) || 70,
};
const getAttention = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const todayStart = startOfDayIST();
        const todayEnd = endOfDayIST();
        const monthStart = (0, date_fns_1.startOfMonth)(new Date());
        const monthEnd = (0, date_fns_1.endOfMonth)(new Date());
        const T = ATTENTION_THRESHOLDS;
        const [headcount, presentToday, pendingLeaves, pendingPerms, activePIPs, attritionMTD, otPending, openJobs, trainTotal, trainCompleted, 
        // Departments where today's attendance is unusually low (<70%) — surfaced
        // separately so management can spot a single struggling department, not
        // just an aggregate dip.
        lowDeptAttendance,] = yield Promise.all([
            prisma_1.prisma.employee.count({ where: { employmentStatus: "ACTIVE" } }),
            prisma_1.prisma.attendance.count({
                where: { date: { gte: todayStart, lte: todayEnd }, status: "PRESENT" },
            }),
            prisma_1.prisma.leaveRequest.count({ where: { status: "PENDING" } }),
            prisma_1.prisma.permissionRequest.count({ where: { status: "PENDING" } }),
            prisma_1.prisma.employeePIP.count({
                where: { status: { in: ["WARNING_ISSUED", "PIP_ACTIVE", "PIP_EXTENDED"] } },
            }),
            prisma_1.prisma.resignationRequest.count({
                where: {
                    createdAt: { gte: monthStart, lte: monthEnd },
                    status: { notIn: ["WITHDRAWN", "CANCELLED", "REJECTED"] },
                },
            }),
            prisma_1.prisma.overtimeApproval.count({
                where: { status: "PENDING", managerStatus: "APPROVED", minutes: { gt: 60 } },
            }),
            prisma_1.prisma.job.count({ where: { status: "OPEN" } }),
            prisma_1.prisma.trainingAssignment.count(),
            prisma_1.prisma.trainingAssignment.count({ where: { status: "Completed" } }),
            // Per-department attendance today. Done with two simple Prisma calls
            // (groupBy + count) instead of a $queryRaw — keeps it portable across
            // Postgres / MySQL and side-steps the ::int cast that makes the raw
            // query DB-specific.
            (() => __awaiter(void 0, void 0, void 0, function* () {
                var _a, _b;
                try {
                    const deptCounts = yield prisma_1.prisma.employee.groupBy({
                        by: ['departmentId'],
                        where: { employmentStatus: 'ACTIVE' },
                        _count: { _all: true },
                    });
                    const deptIds = deptCounts.map((c) => c.departmentId);
                    const [depts, presentByDept] = yield Promise.all([
                        prisma_1.prisma.department.findMany({
                            where: { id: { in: deptIds } },
                            select: { id: true, name: true },
                        }),
                        prisma_1.prisma.attendance.findMany({
                            where: {
                                date: { gte: todayStart, lte: todayEnd },
                                status: 'PRESENT',
                                employee: { employmentStatus: 'ACTIVE' },
                            },
                            select: { employee: { select: { departmentId: true } } },
                        }),
                    ]);
                    const presentMap = new Map();
                    for (const a of presentByDept) {
                        const did = (_a = a.employee) === null || _a === void 0 ? void 0 : _a.departmentId;
                        if (did != null)
                            presentMap.set(did, ((_b = presentMap.get(did)) !== null && _b !== void 0 ? _b : 0) + 1);
                    }
                    const nameMap = new Map(depts.map((d) => [d.id, d.name]));
                    return deptCounts
                        .map((c) => {
                        var _a, _b;
                        const total = c._count._all;
                        const present = (_a = presentMap.get(c.departmentId)) !== null && _a !== void 0 ? _a : 0;
                        const pct = total ? Math.round((present * 100) / total) : 0;
                        return {
                            departmentId: c.departmentId,
                            departmentName: (_b = nameMap.get(c.departmentId)) !== null && _b !== void 0 ? _b : `Dept ${c.departmentId}`,
                            total, present, pct,
                        };
                    })
                        .filter((r) => r.pct < 70 && r.total >= 5);
                }
                catch (e) {
                    console.error('[getAttention] dept-attendance aggregation failed:', e);
                    return [];
                }
            }))(),
        ]);
        const attendancePct = headcount > 0 ? Math.round((presentToday / headcount) * 100) : 0;
        const trainingPct = trainTotal > 0 ? Math.round((trainCompleted / trainTotal) * 100) : 0;
        const items = [];
        // ── Attendance ─────────────────────────────────────────────
        if (attendancePct < T.attendancePctRed) {
            items.push({
                severity: 'red', icon: '⚠️', sectionId: 'sec-attendance',
                title: 'Critically low attendance today',
                message: `Only ${attendancePct}% present today (${presentToday}/${headcount}). Threshold ${T.attendancePctRed}%.`,
                metric: attendancePct,
            });
        }
        else if (attendancePct < T.attendancePctYellow) {
            items.push({
                severity: 'yellow', icon: '⏰', sectionId: 'sec-attendance',
                title: 'Attendance below target',
                message: `${attendancePct}% present today (${presentToday}/${headcount}).`,
                metric: attendancePct,
            });
        }
        // Department-specific dips
        for (const d of lowDeptAttendance) {
            items.push({
                severity: d.pct < 50 ? 'red' : 'yellow', icon: '🏥', sectionId: 'sec-dept-risk',
                title: `${d.departmentName}: low attendance today`,
                message: `${d.pct}% present in ${d.departmentName} (${d.present}/${d.total}).`,
                metric: d.pct,
            });
        }
        // ── PIP ────────────────────────────────────────────────────
        if (activePIPs >= T.pipRed) {
            items.push({
                severity: 'red', icon: '📉', sectionId: 'sec-pip',
                title: 'High number of active PIPs',
                message: `${activePIPs} performance improvement plans currently active.`,
                metric: activePIPs,
            });
        }
        else if (activePIPs >= T.pipYellow) {
            items.push({
                severity: 'yellow', icon: '📉', sectionId: 'sec-pip',
                title: 'Active PIPs require review',
                message: `${activePIPs} performance improvement plans active.`,
                metric: activePIPs,
            });
        }
        // ── Attrition this month ──────────────────────────────────
        if (attritionMTD >= T.attritionMtdRed) {
            items.push({
                severity: 'red', icon: '📤', sectionId: 'sec-attrition',
                title: 'Elevated attrition this month',
                message: `${attritionMTD} resignation(s) recorded so far this month.`,
                metric: attritionMTD,
            });
        }
        else if (attritionMTD >= T.attritionMtdYellow) {
            items.push({
                severity: 'yellow', icon: '📤', sectionId: 'sec-attrition',
                title: 'Attrition activity to watch',
                message: `${attritionMTD} resignation(s) this month.`,
                metric: attritionMTD,
            });
        }
        // ── Pending approvals ─────────────────────────────────────
        if (pendingLeaves >= T.pendingLeavesYellow) {
            items.push({
                severity: 'yellow', icon: '📋', sectionId: 'sec-attendance',
                title: 'Leave approvals piling up',
                message: `${pendingLeaves} leave request(s) awaiting decision.`,
                metric: pendingLeaves,
            });
        }
        if (pendingPerms >= T.pendingPermsYellow) {
            items.push({
                severity: 'yellow', icon: '🕒', sectionId: 'sec-attendance',
                title: 'Permission requests pending',
                message: `${pendingPerms} permission request(s) awaiting decision.`,
                metric: pendingPerms,
            });
        }
        if (otPending >= T.otPendingYellow) {
            items.push({
                severity: 'yellow', icon: '⏱️', sectionId: 'sec-ot',
                title: 'Overtime approvals pending',
                message: `${otPending} OT request(s) awaiting management approval.`,
                metric: otPending,
            });
        }
        // ── Recruitment ───────────────────────────────────────────
        // Frontend combines Attrition + Recruitment into one section, so the
        // alert links to that combined section.
        if (openJobs >= T.openJobsYellow) {
            items.push({
                severity: 'yellow', icon: '💼', sectionId: 'sec-attrition',
                title: 'Many open positions',
                message: `${openJobs} job position(s) currently open.`,
                metric: openJobs,
            });
        }
        // ── Training compliance ───────────────────────────────────
        if (trainTotal > 0 && trainingPct < T.trainingPctRed) {
            items.push({
                severity: 'red', icon: '🎓', sectionId: 'sec-training',
                title: 'Training completion lagging',
                message: `Only ${trainingPct}% of assigned training completed.`,
                metric: trainingPct,
            });
        }
        else if (trainTotal > 0 && trainingPct < T.trainingPctYellow) {
            items.push({
                severity: 'yellow', icon: '🎓', sectionId: 'sec-training',
                title: 'Training completion below target',
                message: `${trainingPct}% of assigned training completed.`,
                metric: trainingPct,
            });
        }
        // Sort: red first, then yellow, then info — within each group keep insertion order
        const sevRank = { red: 0, yellow: 1, info: 2 };
        items.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
        res.json({
            generatedAt: new Date().toISOString(),
            counts: {
                red: items.filter((i) => i.severity === 'red').length,
                yellow: items.filter((i) => i.severity === 'yellow').length,
                info: items.filter((i) => i.severity === 'info').length,
            },
            items,
            thresholds: T,
        });
    }
    catch (err) {
        console.error('[getAttention] failed:', err);
        res.status(500).json({ error: err.message });
    }
});
exports.getAttention = getAttention;
// ═══════════════════════════════════════════════════════════
// SECTION 2 — WORKFORCE
// GET /api/management/workforce
// ═══════════════════════════════════════════════════════════
const getWorkforce = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        // Fetch ALL employees (every status) so the donut can show every segment.
        const allEmployees = yield prisma_1.prisma.employee.findMany({
            select: {
                firstName: true,
                lastName: true,
                employmentType: true,
                employmentStatus: true,
                Department: { select: { name: true } },
                designation: { select: { name: true } },
            },
            orderBy: [{ departmentId: "asc" }, { firstName: "asc" }],
        });
        // Active slice — used for the by-dept breakdown (currently working staff)
        const activeEmployees = allEmployees.filter((e) => e.employmentStatus === "ACTIVE");
        // By department + employment type (active only)
        const deptMap = new Map();
        for (const e of activeEmployees) {
            const dept = ((_a = e.Department) === null || _a === void 0 ? void 0 : _a.name) || "Unassigned";
            const type = e.employmentType || "Other";
            if (!deptMap.has(dept))
                deptMap.set(dept, {});
            const row = deptMap.get(dept);
            row[type] = (row[type] || 0) + 1;
            row["_total"] = (row["_total"] || 0) + 1;
        }
        const byDept = Array.from(deptMap.entries())
            .sort((a, b) => (b[1]["_total"] || 0) - (a[1]["_total"] || 0))
            .map(([dept, types]) => (Object.assign({ dept }, types)));
        // By status (donut) — ALL statuses included
        const statusMap = new Map();
        for (const e of allEmployees) {
            const s = e.employmentStatus || "UNKNOWN";
            statusMap.set(s, (statusMap.get(s) || 0) + 1);
        }
        // Preserve a canonical status order so colors stay consistent
        const statusOrder = ["ACTIVE", "NOTICE_PERIOD", "SABBATICAL", "SUSPENDED", "RESIGNED", "TERMINATED"];
        const byStatus = statusOrder
            .filter((s) => statusMap.has(s))
            .map((s) => ({ status: s, count: statusMap.get(s) }))
            .concat(Array.from(statusMap.entries())
            .filter(([s]) => !statusOrder.includes(s))
            .map(([status, count]) => ({ status, count })));
        // Full employee roster (all statuses) for drill-down
        const employeeList = allEmployees.map((e) => {
            var _a, _b;
            return ({
                name: `${e.firstName} ${e.lastName}`,
                dept: ((_a = e.Department) === null || _a === void 0 ? void 0 : _a.name) || "—",
                designation: ((_b = e.designation) === null || _b === void 0 ? void 0 : _b.name) || "—",
                type: e.employmentType || "—",
                status: e.employmentStatus,
            });
        });
        res.json({
            byDept,
            byStatus,
            total: allEmployees.length, // grand total across all statuses
            activeTotal: activeEmployees.length, // separate field for "active only"
            employeeList,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getWorkforce = getWorkforce;
// ═══════════════════════════════════════════════════════════
// SECTION 3 — ATTENDANCE SUMMARY
// GET /api/management/attendance-summary?days=7|14|30
// ═══════════════════════════════════════════════════════════
const getAttendanceSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const numDays = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
        const rangeStart = startOfDayIST((0, date_fns_1.addDays)(new Date(), -(numDays - 1)));
        const rangeEnd = endOfDayIST(new Date());
        // ── Determine months covered by the window ────────────────
        const monthsInRange = [];
        const seenMonths = new Set();
        for (let i = numDays - 1; i >= 0; i--) {
            const d = (0, date_fns_1.addDays)(new Date(), -i);
            const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
            if (!seenMonths.has(key)) {
                seenMonths.add(key);
                monthsInRange.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
            }
        }
        const totalActive = yield prisma_1.prisma.employee.count({ where: { employmentStatus: "ACTIVE" } });
        // ── Public holidays in range ──────────────────────────────
        const publicHolidays = yield prisma_1.prisma.holiday.findMany({
            where: { date: { gte: rangeStart, lte: rangeEnd } },
            select: { date: true, title: true },
        });
        const holidayMap = new Map();
        for (const h of publicHolidays) {
            const ist = new Date(h.date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
            holidayMap.set((0, date_fns_1.format)(ist, "yyyy-MM-dd"), h.title);
        }
        // ── Approved weekly off from ShiftApproval ────────────────
        // Fetch all approved monthly rotational shift configs for active employees
        // covering months in the trend window
        const shiftApprovals = yield prisma_1.prisma.shiftApproval.findMany({
            where: {
                status: "APPROVED",
                month: { not: null },
                year: { not: null },
                OR: monthsInRange.map(({ year, month }) => ({ year, month })),
            },
            select: { employeeId: true, month: true, year: true, weekOffConfig: true },
        });
        // Build per-employee week-off dates within the range
        // Map<employeeId, Set<"yyyy-MM-dd">>
        const empWeekOffDates = new Map();
        // Track which employees have an approved shift per month
        const approvedEmpsByMonth = new Map();
        for (const approval of shiftApprovals) {
            if (!approval.month || !approval.year)
                continue;
            const monthKey = `${approval.year}-${approval.month}`;
            if (!approvedEmpsByMonth.has(monthKey))
                approvedEmpsByMonth.set(monthKey, new Set());
            approvedEmpsByMonth.get(monthKey).add(approval.employeeId);
            const cfg = approval.weekOffConfig;
            if (!(cfg === null || cfg === void 0 ? void 0 : cfg.weeks))
                continue;
            // Compute week-off dates: same algorithm as attendance.controller.ts
            const monthStart = new Date(approval.year, approval.month - 1, 1);
            const firstWeekStart = new Date(monthStart);
            firstWeekStart.setDate(monthStart.getDate() - monthStart.getDay()); // back to Sunday
            firstWeekStart.setHours(0, 0, 0, 0);
            if (!empWeekOffDates.has(approval.employeeId))
                empWeekOffDates.set(approval.employeeId, new Set());
            const datesSet = empWeekOffDates.get(approval.employeeId);
            Object.entries(cfg.weeks).forEach(([weekIndexStr, dayOfWeek]) => {
                const weekIndex = Number(weekIndexStr);
                if (Number.isNaN(weekIndex) || typeof dayOfWeek !== "number")
                    return;
                const woDate = new Date(firstWeekStart);
                woDate.setDate(firstWeekStart.getDate() + weekIndex * 7 + dayOfWeek);
                if (woDate >= rangeStart && woDate <= rangeEnd) {
                    datesSet.add((0, date_fns_1.format)(woDate, "yyyy-MM-dd"));
                }
            });
        }
        // ── Fetch active employee roster once (for absent-list drill-down) ──
        const activeEmployees = yield prisma_1.prisma.employee.findMany({
            where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                Department: { select: { name: true } },
                designation: { select: { name: true } },
            },
        });
        const empMap = new Map(activeEmployees.map((e) => {
            var _a, _b, _c, _d, _e, _f;
            return [e.id, {
                    id: e.id,
                    name: `${(_a = e.firstName) !== null && _a !== void 0 ? _a : ""} ${(_b = e.lastName) !== null && _b !== void 0 ? _b : ""}`.trim(),
                    employeeCode: e.employeeCode,
                    dept: (_d = (_c = e.Department) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "—",
                    designation: (_f = (_e = e.designation) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : "—",
                }];
        }));
        // Pull all attendance records across the full range in one query
        const fullRangeRecords = yield prisma_1.prisma.attendance.findMany({
            where: { date: { gte: rangeStart, lte: rangeEnd } },
            select: { employeeId: true, status: true, date: true },
        });
        // Group by yyyy-MM-dd → Map<employeeId, status>
        const attByDay = new Map();
        for (const rec of fullRangeRecords) {
            const key = (0, date_fns_1.format)(new Date(rec.date), "yyyy-MM-dd");
            if (!attByDay.has(key))
                attByDay.set(key, new Map());
            attByDay.get(key).set(rec.employeeId, rec.status);
        }
        // ── Build daily summary ───────────────────────────────────
        const days = [];
        for (let i = numDays - 1; i >= 0; i--) {
            const d = (0, date_fns_1.addDays)(new Date(), -i);
            const dayStr = (0, date_fns_1.format)(d, "yyyy-MM-dd");
            const label = numDays <= 7 ? (0, date_fns_1.format)(d, "EEE dd") : (0, date_fns_1.format)(d, "dd MMM");
            const monthKey = `${d.getFullYear()}-${d.getMonth() + 1}`;
            // Count employees whose approved week-off falls on this date
            let weekoffFromApprovals = 0;
            const weekoffEmpIds = new Set();
            for (const [empId, dates] of empWeekOffDates.entries()) {
                if (dates.has(dayStr)) {
                    weekoffFromApprovals++;
                    weekoffEmpIds.add(empId);
                }
            }
            // Employees WITHOUT an approved shift this month → Sunday fallback
            const approvedThisMonth = (_b = (_a = approvedEmpsByMonth.get(monthKey)) === null || _a === void 0 ? void 0 : _a.size) !== null && _b !== void 0 ? _b : 0;
            const unapprovedThisMonth = Math.max(0, totalActive - approvedThisMonth);
            const sundayFallback = d.getDay() === 0 ? unapprovedThisMonth : 0;
            const totalWeekoff = weekoffFromApprovals + sundayFallback;
            const holidayTitle = holidayMap.get(dayStr);
            const isHoliday = !!holidayTitle;
            const isWeekOff = totalWeekoff > 0;
            // Count statuses from the pre-fetched map.
            // MySQL string compare is case-insensitive, but JS === is not, so normalize.
            const dayMap = (_c = attByDay.get(dayStr)) !== null && _c !== void 0 ? _c : new Map();
            let present = 0, leave = 0, permission = 0;
            const attendedIds = new Set();
            for (const [empId, st] of dayMap.entries()) {
                const s = (st || "").toUpperCase();
                if (s === "PRESENT") {
                    present++;
                    attendedIds.add(empId);
                }
                else if (s === "LEAVE") {
                    leave++;
                    attendedIds.add(empId);
                }
                else if (s === "PERMISSION") {
                    permission++;
                    attendedIds.add(empId);
                }
            }
            if (isHoliday) {
                // Public holiday: nobody is absent
                days.push({
                    date: label, dateStr: dayStr,
                    present, absent: 0, leave: 0, permission: 0,
                    weekoff: Math.max(0, totalActive - present),
                    isNonWorking: true, nonWorkingLabel: holidayTitle,
                    absentEmployees: [],
                });
            }
            else {
                // Working day (may have some employees on week-off)
                const weekoffNet = Math.max(0, totalWeekoff - present);
                const presentFromRegular = Math.max(0, present - totalWeekoff);
                const expectedRegular = Math.max(0, totalActive - totalWeekoff);
                const absent = Math.max(0, expectedRegular - presentFromRegular - leave - permission);
                // Absent employee list: active minus on-weekoff minus those with any record today
                const absentList = [];
                for (const [empId, info] of empMap.entries()) {
                    if (weekoffEmpIds.has(empId))
                        continue;
                    if (attendedIds.has(empId))
                        continue;
                    absentList.push(info);
                }
                days.push({
                    date: label, dateStr: dayStr,
                    present, absent, leave, permission,
                    weekoff: weekoffNet,
                    isNonWorking: false, nonWorkingLabel: isWeekOff ? "Week Off" : null,
                    absentEmployees: absentList,
                });
            }
        }
        res.json({ days, totalActive, numDays });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getAttendanceSummary = getAttendanceSummary;
// ═══════════════════════════════════════════════════════════
// SECTION 3b — LEAVE CALENDAR
// GET /api/management/leave-calendar?month=YYYY-MM
// ═══════════════════════════════════════════════════════════
const getLeaveCalendar = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        // Helper: convert a UTC Date from DB to IST date string (yyyy-MM-dd)
        const toISTDateStr = (d) => {
            const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
            return (0, date_fns_1.format)(ist, "yyyy-MM-dd");
        };
        // Build IST month boundaries: start = IST midnight of day 1, end = IST 23:59:59 of last day
        let year = new Date().getFullYear();
        let month = new Date().getMonth() + 1; // 1-based
        if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) {
            [year, month] = req.query.month.split("-").map(Number);
        }
        // IST midnight of first day → UTC  (IST = UTC+5:30, so midnight IST = prev day 18:30 UTC)
        const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
        // IST 23:59:59 of last day
        const lastDay = new Date(year, month, 0).getDate(); // days in month
        const monthEnd = new Date(Date.UTC(year, month - 1, lastDay, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);
        console.log(`Fetching leaves overlapping ${year}-${String(month).padStart(2, "0")}-01 to ${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`);
        console.log(monthStart, monthEnd);
        const leaves = yield prisma_1.prisma.leaveRequest.findMany({
            where: {
                status: "APPROVED",
                startDate: { lte: monthEnd },
                endDate: { gte: monthStart },
            },
            select: {
                startDate: true,
                endDate: true,
                employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
                leaveType: { select: { name: true } },
            },
        });
        // Build day → entries map using IST date strings
        const dayMap = new Map();
        // IST date strings for month boundaries (for range filtering in the loop)
        const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
        const monthEndStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        for (const l of leaves) {
            let cur = new Date(l.startDate);
            const end = new Date(l.endDate);
            const leaveTypeName = ((_a = l.leaveType) === null || _a === void 0 ? void 0 : _a.name) || "Leave";
            while (cur <= end) {
                const key = toISTDateStr(cur);
                // Only include days within the requested month
                if (key >= monthStartStr && key <= monthEndStr) {
                    if (!dayMap.has(key))
                        dayMap.set(key, { count: 0, entries: [], typeCounts: new Map() });
                    const entry = dayMap.get(key);
                    entry.count += 1;
                    entry.entries.push({
                        name: `${l.employee.firstName} ${l.employee.lastName} (${((_b = l.employee.Department) === null || _b === void 0 ? void 0 : _b.name) || "-"})`,
                        type: leaveTypeName,
                    });
                    entry.typeCounts.set(leaveTypeName, (entry.typeCounts.get(leaveTypeName) || 0) + 1);
                }
                cur = (0, date_fns_1.addDays)(cur, 1);
            }
        }
        const calendar = Array.from(dayMap.entries()).map(([date, v]) => {
            // dominant leave type for colour coding
            let dominantType = "Leave";
            let maxCount = 0;
            v.typeCounts.forEach((cnt, type) => { if (cnt > maxCount) {
                maxCount = cnt;
                dominantType = type;
            } });
            return {
                date,
                count: v.count,
                // tooltip string: "Name (Dept) [TYPE]"
                employees: v.entries.map(e => `${e.name} [${e.type}]`),
                dominantType,
                types: Array.from(v.typeCounts.entries()).map(([type, cnt]) => ({ type, cnt })),
            };
        });
        // Top leave types this month
        const typeCount = new Map();
        for (const l of leaves) {
            const t = ((_c = l.leaveType) === null || _c === void 0 ? void 0 : _c.name) || "Leave";
            typeCount.set(t, (typeCount.get(t) || 0) + 1);
        }
        const topTypes = Array.from(typeCount.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([type, count]) => ({ type, count }));
        res.json({
            calendar,
            topTypes,
            month: `${year}-${String(month).padStart(2, "0")}`,
            monthLabel: (0, date_fns_1.format)(new Date(year, month - 1, 1), "MMMM yyyy"),
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getLeaveCalendar = getLeaveCalendar;
// ═══════════════════════════════════════════════════════════
// SECTION 4 — PERFORMANCE RADAR
// GET /api/management/performance-radar
// ═══════════════════════════════════════════════════════════
const getPerformanceRadar = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerAppraisals = yield prisma_1.prisma.managerAppraisal.findMany({
            select: {
                communication: true,
                teamwork: true,
                problemSolving: true,
                initiative: true,
                reliability: true,
                attendanceRating: true,
                leadershipRating: true,
                qualityOfWorkRating: true,
                overallScore: true,
            },
        });
        const selfAppraisals = yield prisma_1.prisma.selfAppraisal.findMany({
            select: {
                communication: true,
                teamwork: true,
                problemSolving: true,
                initiative: true,
                reliability: true,
                overallScore: true,
            },
        });
        const avg = (arr) => {
            const valid = arr.filter((v) => v !== null && v !== undefined);
            return valid.length ? Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * 10) / 10 : 0;
        };
        // Map frontend dimension keys to actual DB field names
        const dimensionMap = {
            communication: "communication",
            teamwork: "teamwork",
            problemSolving: "problemSolving",
            initiative: "initiative",
            reliability: "reliability",
            attendance: "attendanceRating",
            leadership: "leadershipRating",
            qualityOfWork: "qualityOfWorkRating",
        };
        const dimensions = ["communication", "teamwork", "problemSolving", "initiative", "reliability", "attendance", "leadership", "qualityOfWork"];
        const managerAvg = dimensions.map((d) => ({
            dimension: d,
            value: avg(managerAppraisals.map((a) => a[dimensionMap[d]])),
        }));
        const selfDims = ["communication", "teamwork", "problemSolving", "initiative", "reliability"];
        const selfAvg = selfDims.map((d) => ({
            dimension: d,
            value: avg(selfAppraisals.map((a) => a[d])),
        }));
        res.json({
            managerRatings: managerAvg,
            selfRatings: selfAvg,
            totalAppraisals: managerAppraisals.length,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getPerformanceRadar = getPerformanceRadar;
// ═══════════════════════════════════════════════════════════
// SECTION 4b — ACTIVE PIPs
// GET /api/management/pip-active
// ═══════════════════════════════════════════════════════════
const getActivePIPs = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const pips = yield prisma_1.prisma.employeePIP.findMany({
            where: {
                status: { in: ["WARNING_ISSUED", "PIP_ACTIVE", "PIP_EXTENDED"] },
            },
            include: {
                employee: {
                    select: {
                        firstName: true,
                        lastName: true,
                        Department: { select: { name: true } },
                    },
                },
                weeklyReviews: {
                    orderBy: { weekNumber: "asc" },
                    select: { weekNumber: true, weeklyScore: true, status: true },
                },
            },
            orderBy: { createdAt: "desc" },
        });
        const result = pips.map((p) => {
            var _a;
            return ({
                id: p.id,
                pipNumber: p.pipNumber,
                employeeName: `${p.employee.firstName} ${p.employee.lastName}`,
                department: ((_a = p.employee.Department) === null || _a === void 0 ? void 0 : _a.name) || "—",
                triggerScore: p.triggerScore,
                triggerMonth: p.triggerMonth,
                status: p.status,
                weeklyScores: p.weeklyReviews.map((r) => ({
                    week: r.weekNumber,
                    score: r.weeklyScore,
                    status: r.status,
                })),
                trend: p.weeklyReviews.length >= 2
                    ? (p.weeklyReviews[p.weeklyReviews.length - 1].weeklyScore || 0) >
                        (p.weeklyReviews[0].weeklyScore || 0)
                        ? "improving"
                        : "declining"
                    : "neutral",
            });
        });
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getActivePIPs = getActivePIPs;
// ═══════════════════════════════════════════════════════════
// SECTION 5 — ATTRITION TREND (last 12 months)
// GET /api/management/attrition-trend
// ═══════════════════════════════════════════════════════════
const getAttritionTrend = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const months = [];
        for (let i = 11; i >= 0; i--) {
            const d = (0, date_fns_1.subMonths)(new Date(), i);
            const mStart = (0, date_fns_1.startOfMonth)(d);
            const mEnd = (0, date_fns_1.endOfMonth)(d);
            const label = (0, date_fns_1.format)(d, "MMM yy");
            const [submitted, exited, resignList] = yield Promise.all([
                prisma_1.prisma.resignationRequest.count({
                    where: {
                        createdAt: { gte: mStart, lte: mEnd },
                        status: { notIn: ["WITHDRAWN", "CANCELLED"] },
                    },
                }),
                prisma_1.prisma.resignationRequest.count({
                    where: {
                        actualLastWorkingDay: { gte: mStart, lte: mEnd },
                        status: "COMPLETED",
                    },
                }),
                prisma_1.prisma.resignationRequest.findMany({
                    where: {
                        createdAt: { gte: mStart, lte: mEnd },
                        status: { notIn: ["WITHDRAWN", "CANCELLED"] },
                    },
                    select: {
                        actualLastWorkingDay: true,
                        proposedLastWorkingDay: true,
                        status: true,
                        employee: {
                            select: {
                                firstName: true, lastName: true, employeeCode: true,
                                Department: { select: { name: true } },
                                designation: { select: { name: true } },
                            },
                        },
                    },
                }),
            ]);
            const resignations = resignList.map((r) => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
                return ({
                    name: `${(_b = (_a = r.employee) === null || _a === void 0 ? void 0 : _a.firstName) !== null && _b !== void 0 ? _b : ""} ${(_d = (_c = r.employee) === null || _c === void 0 ? void 0 : _c.lastName) !== null && _d !== void 0 ? _d : ""}`.trim(),
                    employeeCode: (_f = (_e = r.employee) === null || _e === void 0 ? void 0 : _e.employeeCode) !== null && _f !== void 0 ? _f : "",
                    dept: (_j = (_h = (_g = r.employee) === null || _g === void 0 ? void 0 : _g.Department) === null || _h === void 0 ? void 0 : _h.name) !== null && _j !== void 0 ? _j : "—",
                    designation: (_m = (_l = (_k = r.employee) === null || _k === void 0 ? void 0 : _k.designation) === null || _l === void 0 ? void 0 : _l.name) !== null && _m !== void 0 ? _m : "—",
                    lastDate: (_q = (_p = ((_o = r.actualLastWorkingDay) !== null && _o !== void 0 ? _o : r.proposedLastWorkingDay)) === null || _p === void 0 ? void 0 : _p.toISOString().slice(0, 10)) !== null && _q !== void 0 ? _q : "—",
                    status: r.status,
                });
            });
            months.push({ month: label, submitted, exited, resignations });
        }
        // Top exit reason from exit interviews
        const interviews = yield prisma_1.prisma.exitInterview.findMany({
            where: { completedAt: { not: null } },
            select: { reasonForLeaving: true },
        });
        const reasonMap = new Map();
        for (const i of interviews) {
            const r = i.reasonForLeaving;
            if (r)
                reasonMap.set(r, (reasonMap.get(r) || 0) + 1);
        }
        const topReason = ((_a = Array.from(reasonMap.entries()).sort((a, b) => b[1] - a[1])[0]) === null || _a === void 0 ? void 0 : _a[0]) || null;
        res.json({ months, topReason });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getAttritionTrend = getAttritionTrend;
// ═══════════════════════════════════════════════════════════
// SECTION 5b — RECRUITMENT FUNNEL
// GET /api/management/recruitment-funnel
// ═══════════════════════════════════════════════════════════
const getRecruitmentFunnel = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const stages = [
            { key: "applied", label: "Applied", statuses: ["APPLIED", "SCREENING"] },
            { key: "shortlisted", label: "Shortlisted", statuses: ["SHORTLISTED"] },
            { key: "interviewed", label: "Interviewed", statuses: ["INTERVIEW_SCHEDULED", "INTERVIEWED"] },
            { key: "offered", label: "Offered", statuses: ["OFFERED", "OFFER_ACCEPTED", "OFFER_DECLINED"] },
            { key: "joined", label: "Joined", statuses: ["HIRED"] },
        ];
        const counts = yield Promise.all(stages.map((s) => prisma_1.prisma.application.count({ where: { status: { in: s.statuses } } })));
        const funnel = stages.map((s, i) => ({
            stage: s.label,
            count: counts[i],
            dropPct: i > 0 && counts[i - 1] > 0
                ? Math.round(((counts[i - 1] - counts[i]) / counts[i - 1]) * 100)
                : 0,
        }));
        // Offer acceptance rate
        const offered = yield prisma_1.prisma.application.count({
            where: { status: { in: ["OFFERED", "OFFER_ACCEPTED", "OFFER_DECLINED"] } },
        });
        const accepted = yield prisma_1.prisma.application.count({
            where: { status: "OFFER_ACCEPTED" },
        });
        const acceptanceRate = offered > 0 ? Math.round((accepted / offered) * 100) : 0;
        res.json({ funnel, acceptanceRate });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getRecruitmentFunnel = getRecruitmentFunnel;
// ═══════════════════════════════════════════════════════════
// SECTION 6 — TRAINING BY DEPARTMENT
// GET /api/management/training-by-dept
// ═══════════════════════════════════════════════════════════
const getTrainingByDept = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const assignments = yield prisma_1.prisma.trainingAssignment.findMany({
            include: {
                employee: { select: { Department: { select: { name: true } } } },
            },
        });
        const deptMap = new Map();
        for (const a of assignments) {
            const dept = ((_b = (_a = a.employee) === null || _a === void 0 ? void 0 : _a.Department) === null || _b === void 0 ? void 0 : _b.name) || "Unassigned";
            if (!deptMap.has(dept))
                deptMap.set(dept, { total: 0, completed: 0 });
            const row = deptMap.get(dept);
            row.total += 1;
            if (a.status === "Completed")
                row.completed += 1;
        }
        const result = Array.from(deptMap.entries())
            .map(([dept, v]) => ({
            dept,
            total: v.total,
            completed: v.completed,
            pct: v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0,
        }))
            .sort((a, b) => b.total - a.total);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getTrainingByDept = getTrainingByDept;
// ═══════════════════════════════════════════════════════════
// SECTION 7 — ACTION ITEMS
// GET /api/management/action-items
// ═══════════════════════════════════════════════════════════
const getActionItems = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const now = new Date();
        const in7days = (0, date_fns_1.addDays)(now, 7);
        const in30days = (0, date_fns_1.addDays)(now, 30);
        const [pipTerminations, overdueGrievances, poshCases, probationEnding, expiringDocs, overdueClearances,] = yield Promise.all([
            // PIP terminations initiated
            prisma_1.prisma.employeePIP.findMany({
                where: { status: "TERMINATION_INITIATED" },
                select: {
                    id: true,
                    pipNumber: true,
                    warningDate: true,
                    employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
                },
            }),
            // Grievances open >7 days
            prisma_1.prisma.grievance.findMany({
                where: {
                    status: { in: ["OPEN", "IN_REVIEW"] },
                    createdAt: { lte: (0, date_fns_1.addDays)(now, -7) },
                },
                select: {
                    id: true,
                    title: true,
                    createdAt: true,
                    employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
                },
            }),
            // Active POSH cases
            prisma_1.prisma.poshCase.findMany({
                where: { status: { in: ["FILED", "UNDER_INVESTIGATION"] } },
                select: {
                    id: true,
                    status: true,
                    createdAt: true,
                    complainant: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
                },
            }),
            // Probation ending in 7 days
            prisma_1.prisma.employee.findMany({
                where: { probationEndDate: { gte: now, lte: in7days }, employmentStatus: "ACTIVE" },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    probationEndDate: true,
                    Department: { select: { name: true } },
                },
            }),
            // Documents expiring in 30 days
            prisma_1.prisma.document.findMany({
                where: { expiryDate: { gte: now, lte: in30days } },
                select: {
                    id: true,
                    type: true,
                    expiryDate: true,
                    employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
                },
            }),
            // Overdue exit clearances (>7 days pending)
            prisma_1.prisma.resignationClearance.findMany({
                where: {
                    decision: { not: "APPROVED" },
                    createdAt: { lte: (0, date_fns_1.addDays)(now, -7) },
                },
                select: {
                    id: true,
                    type: true,
                    createdAt: true,
                    resignation: {
                        select: {
                            employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
                        },
                    },
                },
                take: 20,
            }),
        ]);
        const items = [];
        for (const p of pipTerminations) {
            items.push({
                category: "PIP",
                severity: "danger",
                item: "Termination initiated",
                employee: `${p.employee.firstName} ${p.employee.lastName}`,
                dept: ((_a = p.employee.Department) === null || _a === void 0 ? void 0 : _a.name) || "—",
                since: p.warningDate ? Math.max(0, Math.floor((now.getTime() - new Date(p.warningDate).getTime()) / 86400000)) : null,
                ref: p.id,
                tag: "pip",
            });
        }
        for (const g of overdueGrievances) {
            const days = Math.floor((now.getTime() - new Date(g.createdAt).getTime()) / 86400000);
            items.push({
                category: "Grievance",
                severity: days > 14 ? "danger" : "warn",
                item: g.title,
                employee: `${g.employee.firstName} ${g.employee.lastName}`,
                dept: ((_b = g.employee.Department) === null || _b === void 0 ? void 0 : _b.name) || "—",
                since: days,
                ref: g.id,
                tag: "grievance",
            });
        }
        for (const c of poshCases) {
            const days = Math.floor((now.getTime() - new Date(c.createdAt).getTime()) / 86400000);
            items.push({
                category: "POSH",
                severity: "danger",
                item: c.status === "FILED" ? "Case filed" : "Under investigation",
                employee: `${c.complainant.firstName} ${c.complainant.lastName}`,
                dept: ((_c = c.complainant.Department) === null || _c === void 0 ? void 0 : _c.name) || "—",
                since: days,
                ref: c.id,
                tag: "posh",
            });
        }
        for (const e of probationEnding) {
            const days = e.probationEndDate
                ? Math.ceil((new Date(e.probationEndDate).getTime() - now.getTime()) / 86400000)
                : null;
            items.push({
                category: "Probation",
                severity: "warn",
                item: `Ending in ${days} day(s)`,
                employee: `${e.firstName} ${e.lastName}`,
                dept: ((_d = e.Department) === null || _d === void 0 ? void 0 : _d.name) || "—",
                since: null,
                daysLeft: days,
                ref: e.id,
                tag: "probation",
            });
        }
        for (const d of expiringDocs) {
            const days = d.expiryDate
                ? Math.ceil((new Date(d.expiryDate).getTime() - now.getTime()) / 86400000)
                : null;
            items.push({
                category: "Document",
                severity: days !== null && days <= 7 ? "danger" : "warn",
                item: `${d.type || "Document"} expiring in ${days} day(s)`,
                employee: `${d.employee.firstName} ${d.employee.lastName}`,
                dept: ((_e = d.employee.Department) === null || _e === void 0 ? void 0 : _e.name) || "—",
                since: null,
                daysLeft: days,
                ref: d.id,
                tag: "document",
            });
        }
        for (const c of overdueClearances) {
            const days = Math.floor((now.getTime() - new Date(c.createdAt).getTime()) / 86400000);
            items.push({
                category: "Clearance",
                severity: "warn",
                item: `${c.type} clearance pending`,
                employee: `${c.resignation.employee.firstName} ${c.resignation.employee.lastName}`,
                dept: ((_f = c.resignation.employee.Department) === null || _f === void 0 ? void 0 : _f.name) || "—",
                since: days,
                ref: c.id,
                tag: "clearance",
            });
        }
        // Sort: danger first, then by since desc
        items.sort((a, b) => {
            if (a.severity === "danger" && b.severity !== "danger")
                return -1;
            if (b.severity === "danger" && a.severity !== "danger")
                return 1;
            return (b.since || 0) - (a.since || 0);
        });
        res.json(items);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getActionItems = getActionItems;
// ═══════════════════════════════════════════════════════════
// SECTION 7b — DEPARTMENT RISK ANALYSIS
// GET /api/management/dept-risk
// ═══════════════════════════════════════════════════════════
const getDeptRisk = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        const monthStart = (0, date_fns_1.startOfMonth)(new Date());
        const monthEnd = (0, date_fns_1.endOfMonth)(new Date());
        const threeMonthsAgo = (0, date_fns_1.subMonths)(new Date(), 3);
        // 1. Resignations per dept (last 3 months)
        const resignations = yield prisma_1.prisma.resignationRequest.findMany({
            where: {
                createdAt: { gte: threeMonthsAgo },
                status: { notIn: ["WITHDRAWN", "CANCELLED", "REJECTED"] },
            },
            include: {
                employee: { select: { Department: { select: { name: true } } } },
            },
        });
        // 2. Leave requests this month per dept
        const leaves = yield prisma_1.prisma.leaveRequest.findMany({
            where: {
                status: { in: ["APPROVED", "PENDING"] },
                startDate: { lte: monthEnd },
                endDate: { gte: monthStart },
            },
            include: {
                employee: { select: { Department: { select: { name: true } } } },
                leaveType: { select: { name: true } },
            },
        });
        // 3. Latest appraisal scores per employee
        const appraisals = yield prisma_1.prisma.appraisalForm.findMany({
            where: { overallScore: { not: null } },
            orderBy: { createdAt: "desc" },
            select: {
                employeeId: true,
                overallScore: true,
                employee: { select: { Department: { select: { name: true } } } },
            },
        });
        const latestScore = new Map();
        for (const a of appraisals) {
            if (!latestScore.has(a.employeeId)) {
                latestScore.set(a.employeeId, {
                    score: a.overallScore,
                    dept: ((_b = (_a = a.employee) === null || _a === void 0 ? void 0 : _a.Department) === null || _b === void 0 ? void 0 : _b.name) || "Unassigned",
                });
            }
        }
        // 4. Active PIPs per dept
        const pips = yield prisma_1.prisma.employeePIP.findMany({
            where: { status: { in: ["WARNING_ISSUED", "PIP_ACTIVE", "PIP_EXTENDED"] } },
            include: { employee: { select: { Department: { select: { name: true } } } } },
        });
        // 5. Headcount per dept
        const employees = yield prisma_1.prisma.employee.findMany({
            where: { employmentStatus: "ACTIVE" },
            select: { Department: { select: { name: true } } },
        });
        // Aggregate
        const deptMap = new Map();
        const ensureDept = (d) => {
            if (!deptMap.has(d))
                deptMap.set(d, { headcount: 0, resignations: 0, leaveCount: 0, leaveTypes: new Map(), scores: [], pips: 0 });
            return deptMap.get(d);
        };
        for (const e of employees) {
            const dept = ((_c = e.Department) === null || _c === void 0 ? void 0 : _c.name) || "Unassigned";
            ensureDept(dept).headcount += 1;
        }
        for (const r of resignations) {
            const dept = ((_e = (_d = r.employee) === null || _d === void 0 ? void 0 : _d.Department) === null || _e === void 0 ? void 0 : _e.name) || "Unassigned";
            ensureDept(dept).resignations += 1;
        }
        for (const l of leaves) {
            const dept = ((_g = (_f = l.employee) === null || _f === void 0 ? void 0 : _f.Department) === null || _g === void 0 ? void 0 : _g.name) || "Unassigned";
            const row = ensureDept(dept);
            row.leaveCount += 1;
            const t = ((_h = l.leaveType) === null || _h === void 0 ? void 0 : _h.name) || "Leave";
            row.leaveTypes.set(t, (row.leaveTypes.get(t) || 0) + 1);
        }
        for (const [, v] of latestScore) {
            ensureDept(v.dept).scores.push(v.score);
        }
        for (const p of pips) {
            const dept = ((_k = (_j = p.employee) === null || _j === void 0 ? void 0 : _j.Department) === null || _k === void 0 ? void 0 : _k.name) || "Unassigned";
            ensureDept(dept).pips += 1;
        }
        const result = Array.from(deptMap.entries())
            .filter(([, v]) => v.headcount > 0)
            .map(([dept, v]) => {
            const avgScore = v.scores.length
                ? Math.round(v.scores.reduce((s, x) => s + x, 0) / v.scores.length)
                : null;
            const topLeaveTypes = Array.from(v.leaveTypes.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([type, count]) => `${type} (${count})`);
            // Risk score: weighted sum (resign weight=3, low score weight=2, pips weight=2, leave rate weight=1)
            const resignRate = v.headcount > 0 ? v.resignations / v.headcount : 0;
            const leaveRate = v.headcount > 0 ? v.leaveCount / v.headcount : 0;
            const scoreRisk = avgScore !== null ? Math.max(0, (60 - avgScore) / 60) : 0;
            const pipRate = v.pips / Math.max(v.headcount, 1);
            const riskScore = Math.round((resignRate * 3 + leaveRate * 1 + scoreRisk * 2 + pipRate * 2) * 33);
            const riskLevel = riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low";
            // Score breakdown — individual contribution of each factor
            const breakdown = {
                resign: Math.round(resignRate * 3 * 33),
                leave: Math.round(leaveRate * 1 * 33),
                score: Math.round(scoreRisk * 2 * 33),
                pip: Math.round(pipRate * 2 * 33),
            };
            return {
                dept,
                headcount: v.headcount,
                resignations: v.resignations,
                leaveCount: v.leaveCount,
                topLeaveTypes,
                avgScore,
                pips: v.pips,
                riskScore: Math.min(riskScore, 100),
                riskLevel,
                breakdown,
            };
        })
            .sort((a, b) => b.riskScore - a.riskScore);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getDeptRisk = getDeptRisk;
// ═══════════════════════════════════════════════════════════
// SECTION 8 — DEPARTMENT SNAPSHOT
// GET /api/management/dept-snapshot
// ═══════════════════════════════════════════════════════════
const getDeptSnapshot = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const todayStart = startOfDayIST();
        const todayEnd = endOfDayIST();
        // All active employees grouped by dept
        const employees = yield prisma_1.prisma.employee.findMany({
            where: { employmentStatus: "ACTIVE" },
            select: { id: true, Department: { select: { name: true } } },
        });
        // Today's attendance
        const todayAttendance = yield prisma_1.prisma.attendance.findMany({
            where: { date: { gte: todayStart, lte: todayEnd }, status: "PRESENT" },
            select: { employeeId: true },
        });
        const presentSet = new Set(todayAttendance.map((a) => a.employeeId));
        // Latest appraisal scores
        const appraisals = yield prisma_1.prisma.appraisalForm.findMany({
            where: { overallScore: { not: null } },
            orderBy: { createdAt: "desc" },
            select: { employeeId: true, overallScore: true },
        });
        // Keep only the latest appraisal per employee
        const latestScore = new Map();
        for (const a of appraisals) {
            if (!latestScore.has(a.employeeId))
                latestScore.set(a.employeeId, a.overallScore);
        }
        // Active PIPs per employee
        const pips = yield prisma_1.prisma.employeePIP.findMany({
            where: { status: { in: ["WARNING_ISSUED", "PIP_ACTIVE", "PIP_EXTENDED"] } },
            select: { employeeId: true },
        });
        const pipSet = new Set(pips.map((p) => p.employeeId));
        // Aggregate by dept
        const deptMap = new Map();
        for (const e of employees) {
            const dept = ((_a = e.Department) === null || _a === void 0 ? void 0 : _a.name) || "Unassigned";
            if (!deptMap.has(dept))
                deptMap.set(dept, { headcount: 0, present: 0, scores: [], pips: 0 });
            const row = deptMap.get(dept);
            row.headcount += 1;
            if (presentSet.has(e.id))
                row.present += 1;
            if (latestScore.has(e.id))
                row.scores.push(latestScore.get(e.id));
            if (pipSet.has(e.id))
                row.pips += 1;
        }
        const result = Array.from(deptMap.entries())
            .map(([dept, v]) => ({
            dept,
            headcount: v.headcount,
            present: v.present,
            attendancePct: v.headcount > 0 ? Math.round((v.present / v.headcount) * 100) : 0,
            avgScore: v.scores.length > 0 ? Math.round(v.scores.reduce((s, x) => s + x, 0) / v.scores.length) : null,
            pips: v.pips,
        }))
            .sort((a, b) => b.headcount - a.headcount);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getDeptSnapshot = getDeptSnapshot;
// ═══════════════════════════════════════════════════════════
// SECTION 9 — WEEKLY RATING TREND (last 8 weeks)
// GET /api/management/weekly-trend
// ═══════════════════════════════════════════════════════════
const getWeeklyTrend = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    try {
        const eightWeeksAgo = (0, date_fns_1.addDays)(new Date(), -56);
        const ratings = yield prisma_1.prisma.weeklyPerformanceRating.findMany({
            where: {
                weekStartDate: { gte: eightWeeksAgo },
                status: "SUBMITTED",
                overallScore: { not: null },
            },
            select: {
                weekStartDate: true,
                weekLabel: true,
                overallScore: true,
                ratedBy: true,
                employee: {
                    select: {
                        firstName: true,
                        lastName: true,
                        employeeCode: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
            },
            orderBy: { weekStartDate: "asc" },
        });
        // Collect unique rater IDs so we can show who rated in the drill-down
        const raterIds = Array.from(new Set(ratings.map((r) => r.ratedBy)));
        const raters = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: raterIds } },
            select: { id: true, firstName: true, lastName: true },
        });
        const raterName = new Map(raters.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));
        // Group by week
        const weekMap = new Map();
        for (const r of ratings) {
            const key = (0, date_fns_1.format)(new Date(r.weekStartDate), "yyyy-MM-dd");
            const label = r.weekLabel || (0, date_fns_1.format)(new Date(r.weekStartDate), "dd MMM");
            if (!weekMap.has(key))
                weekMap.set(key, { label, scores: [], submissions: [] });
            const bucket = weekMap.get(key);
            bucket.scores.push(r.overallScore);
            bucket.submissions.push({
                name: `${(_b = (_a = r.employee) === null || _a === void 0 ? void 0 : _a.firstName) !== null && _b !== void 0 ? _b : ""} ${(_d = (_c = r.employee) === null || _c === void 0 ? void 0 : _c.lastName) !== null && _d !== void 0 ? _d : ""}`.trim(),
                employeeCode: (_f = (_e = r.employee) === null || _e === void 0 ? void 0 : _e.employeeCode) !== null && _f !== void 0 ? _f : "",
                dept: (_j = (_h = (_g = r.employee) === null || _g === void 0 ? void 0 : _g.Department) === null || _h === void 0 ? void 0 : _h.name) !== null && _j !== void 0 ? _j : "—",
                designation: (_m = (_l = (_k = r.employee) === null || _k === void 0 ? void 0 : _k.designation) === null || _l === void 0 ? void 0 : _l.name) !== null && _m !== void 0 ? _m : "—",
                score: r.overallScore,
                ratedBy: (_o = raterName.get(r.ratedBy)) !== null && _o !== void 0 ? _o : "—",
            });
        }
        const weeks = Array.from(weekMap.entries()).map(([, v]) => ({
            label: v.label,
            avgScore: v.scores.length > 0 ? Math.round((v.scores.reduce((s, x) => s + x, 0) / v.scores.length) * 10) / 10 : 0,
            rated: v.scores.length,
            submissions: v.submissions,
        }));
        // Trend: comparing last 4 weeks vs previous 4 weeks
        const last4 = weeks.slice(-4);
        const prev4 = weeks.slice(-8, -4);
        const avgLast = last4.length ? last4.reduce((s, w) => s + w.avgScore, 0) / last4.length : 0;
        const avgPrev = prev4.length ? prev4.reduce((s, w) => s + w.avgScore, 0) / prev4.length : 0;
        const trend = avgLast > avgPrev ? "improving" : avgLast < avgPrev ? "declining" : "stable";
        res.json({ weeks, trend, avgLast: Math.round(avgLast * 10) / 10, avgPrev: Math.round(avgPrev * 10) / 10 });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getWeeklyTrend = getWeeklyTrend;
// ═══════════════════════════════════════════════════════════
// SECTION 10 — PERFORMANCE DISTRIBUTION
// GET /api/management/performance-distribution
// ═══════════════════════════════════════════════════════════
const getPerformanceDistribution = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        // Latest appraisal per employee
        const appraisals = yield prisma_1.prisma.appraisalForm.findMany({
            where: { overallScore: { not: null } },
            orderBy: { createdAt: "desc" },
            select: {
                employeeId: true,
                overallScore: true,
                status: true,
                cycle: true,
                employee: {
                    select: {
                        firstName: true,
                        lastName: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
            },
        });
        const seenEmployees = new Set();
        const latest = [];
        for (const a of appraisals) {
            if (!seenEmployees.has(a.employeeId)) {
                seenEmployees.add(a.employeeId);
                latest.push(a);
            }
        }
        // Score bands
        const bands = [
            { label: "Excellent (80–100)", min: 80, max: 100, color: "#22c55e" },
            { label: "Good (60–79)", min: 60, max: 79, color: "#60a5fa" },
            { label: "Average (40–59)", min: 40, max: 59, color: "#f59e0b" },
            { label: "Below Avg (<40)", min: 0, max: 39, color: "#ef4444" },
        ];
        const distribution = bands.map((b) => (Object.assign(Object.assign({}, b), { count: latest.filter((a) => { var _a, _b; return ((_a = a.overallScore) !== null && _a !== void 0 ? _a : 0) >= b.min && ((_b = a.overallScore) !== null && _b !== void 0 ? _b : 0) <= b.max; }).length })));
        // Drill-down: per-employee row with the band label so frontend can filter
        const bandFor = (score) => {
            var _a;
            const b = bands.find((bb) => score >= bb.min && score <= bb.max);
            return (_a = b === null || b === void 0 ? void 0 : b.label) !== null && _a !== void 0 ? _a : "—";
        };
        const employeeList = latest.map((a) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j;
            return ({
                name: `${(_b = (_a = a.employee) === null || _a === void 0 ? void 0 : _a.firstName) !== null && _b !== void 0 ? _b : ""} ${(_d = (_c = a.employee) === null || _c === void 0 ? void 0 : _c.lastName) !== null && _d !== void 0 ? _d : ""}`.trim(),
                dept: ((_f = (_e = a.employee) === null || _e === void 0 ? void 0 : _e.Department) === null || _f === void 0 ? void 0 : _f.name) || "—",
                designation: ((_h = (_g = a.employee) === null || _g === void 0 ? void 0 : _g.designation) === null || _h === void 0 ? void 0 : _h.name) || "—",
                score: a.overallScore,
                band: bandFor((_j = a.overallScore) !== null && _j !== void 0 ? _j : 0),
            });
        });
        // Appraisal completion: employees with a submitted/completed appraisal vs total active
        const totalActive = yield prisma_1.prisma.employee.count({ where: { employmentStatus: "ACTIVE" } });
        const withAppraisal = latest.length;
        const completionPct = totalActive > 0 ? Math.round((withAppraisal / totalActive) * 100) : 0;
        // Dept-wise avg score
        const deptScores = new Map();
        for (const a of latest) {
            const dept = ((_b = (_a = a.employee) === null || _a === void 0 ? void 0 : _a.Department) === null || _b === void 0 ? void 0 : _b.name) || "Unassigned";
            if (!deptScores.has(dept))
                deptScores.set(dept, []);
            deptScores.get(dept).push(a.overallScore);
        }
        const deptAvg = Array.from(deptScores.entries())
            .map(([dept, scores]) => ({
            dept,
            avg: Math.round(scores.reduce((s, x) => s + x, 0) / scores.length),
            count: scores.length,
        }))
            .sort((a, b) => b.avg - a.avg);
        res.json({ distribution, completionPct, withAppraisal, totalActive, deptAvg, employeeList });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getPerformanceDistribution = getPerformanceDistribution;
// ═══════════════════════════════════════════════════════════
// SECTION 11 — KPI DRILLDOWN DETAIL
// GET /api/management/kpi-detail?type=present|approvals|attrition|ot|positions
// ═══════════════════════════════════════════════════════════
const getKpiDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const type = req.query.type;
    try {
        if (type === "present") {
            const todayStart = startOfDayIST();
            const todayEnd = endOfDayIST();
            const rows = yield prisma_1.prisma.attendance.findMany({
                where: { date: { gte: todayStart, lte: todayEnd }, status: "PRESENT" },
                include: {
                    employee: {
                        select: {
                            firstName: true, lastName: true,
                            Department: { select: { name: true } },
                            designation: { select: { name: true } },
                        },
                    },
                },
                orderBy: { checkIn: "asc" },
            });
            return res.json(rows.map((r) => {
                var _a, _b, _c, _d, _e, _f;
                return ({
                    name: `${(_a = r.employee) === null || _a === void 0 ? void 0 : _a.firstName} ${(_b = r.employee) === null || _b === void 0 ? void 0 : _b.lastName}`,
                    department: ((_d = (_c = r.employee) === null || _c === void 0 ? void 0 : _c.Department) === null || _d === void 0 ? void 0 : _d.name) || "—",
                    designation: ((_f = (_e = r.employee) === null || _e === void 0 ? void 0 : _e.designation) === null || _f === void 0 ? void 0 : _f.name) || "—",
                    checkIn: r.checkIn ? (0, date_fns_1.format)(new Date(r.checkIn), "hh:mm a") : "—",
                    checkOut: r.checkOut ? (0, date_fns_1.format)(new Date(r.checkOut), "hh:mm a") : "—",
                });
            }));
        }
        if (type === "approvals") {
            const [leaves, permissions] = yield Promise.all([
                prisma_1.prisma.leaveRequest.findMany({
                    where: { status: "PENDING" },
                    include: {
                        employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
                        leaveType: { select: { name: true } },
                    },
                    orderBy: { createdAt: "asc" },
                    take: 50,
                }),
                prisma_1.prisma.permissionRequest.findMany({
                    where: { status: "PENDING" },
                    include: {
                        employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
                    },
                    orderBy: { createdAt: "asc" },
                    take: 50,
                }),
            ]);
            const now = new Date();
            const items = [
                ...leaves.map((l) => {
                    var _a, _b, _c, _d, _e;
                    return ({
                        name: `${(_a = l.employee) === null || _a === void 0 ? void 0 : _a.firstName} ${(_b = l.employee) === null || _b === void 0 ? void 0 : _b.lastName}`,
                        department: ((_d = (_c = l.employee) === null || _c === void 0 ? void 0 : _c.Department) === null || _d === void 0 ? void 0 : _d.name) || "—",
                        type: ((_e = l.leaveType) === null || _e === void 0 ? void 0 : _e.name) || "Leave",
                        requestType: "Leave",
                        since: Math.floor((now.getTime() - new Date(l.createdAt).getTime()) / 86400000),
                    });
                }),
                ...permissions.map((p) => {
                    var _a, _b, _c, _d;
                    return ({
                        name: `${(_a = p.employee) === null || _a === void 0 ? void 0 : _a.firstName} ${(_b = p.employee) === null || _b === void 0 ? void 0 : _b.lastName}`,
                        department: ((_d = (_c = p.employee) === null || _c === void 0 ? void 0 : _c.Department) === null || _d === void 0 ? void 0 : _d.name) || "—",
                        type: "Permission",
                        requestType: "Permission",
                        since: Math.floor((now.getTime() - new Date(p.createdAt).getTime()) / 86400000),
                    });
                }),
            ].sort((a, b) => b.since - a.since);
            return res.json(items);
        }
        if (type === "attrition") {
            const monthStart = (0, date_fns_1.startOfMonth)(new Date());
            const monthEnd = (0, date_fns_1.endOfMonth)(new Date());
            const rows = yield prisma_1.prisma.resignationRequest.findMany({
                where: {
                    createdAt: { gte: monthStart, lte: monthEnd },
                    status: { notIn: ["WITHDRAWN", "CANCELLED", "REJECTED"] },
                },
                include: {
                    employee: {
                        select: {
                            firstName: true, lastName: true,
                            Department: { select: { name: true } },
                            designation: { select: { name: true } },
                        },
                    },
                },
                orderBy: { createdAt: "desc" },
            });
            return res.json(rows.map((r) => {
                var _a, _b, _c, _d, _e, _f;
                return ({
                    name: `${(_a = r.employee) === null || _a === void 0 ? void 0 : _a.firstName} ${(_b = r.employee) === null || _b === void 0 ? void 0 : _b.lastName}`,
                    department: ((_d = (_c = r.employee) === null || _c === void 0 ? void 0 : _c.Department) === null || _d === void 0 ? void 0 : _d.name) || "—",
                    designation: ((_f = (_e = r.employee) === null || _e === void 0 ? void 0 : _e.designation) === null || _f === void 0 ? void 0 : _f.name) || "—",
                    reason: r.reason || "—",
                    lastDate: r.proposedLastWorkingDay ? (0, date_fns_1.format)(new Date(r.proposedLastWorkingDay), "dd MMM yyyy") : "—",
                    status: r.status,
                });
            }));
        }
        if (type === "ot") {
            const rows = yield prisma_1.prisma.overtimeApproval.findMany({
                where: { status: "PENDING", managerStatus: "APPROVED", minutes: { gt: 60 } },
                include: {
                    employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
                },
                orderBy: { date: "desc" },
                take: 50,
            });
            return res.json(rows.map((r) => {
                var _a, _b, _c, _d;
                return ({
                    name: `${(_a = r.employee) === null || _a === void 0 ? void 0 : _a.firstName} ${(_b = r.employee) === null || _b === void 0 ? void 0 : _b.lastName}`,
                    department: ((_d = (_c = r.employee) === null || _c === void 0 ? void 0 : _c.Department) === null || _d === void 0 ? void 0 : _d.name) || "—",
                    date: (0, date_fns_1.format)(new Date(r.date), "dd MMM yyyy"),
                    minutes: r.minutes,
                    hours: `${Math.floor(r.minutes / 60)}h ${r.minutes % 60}m`,
                });
            }));
        }
        if (type === "positions") {
            const now = new Date();
            const jobs = yield prisma_1.prisma.job.findMany({
                where: { status: "OPEN" },
                include: { department: { select: { name: true } } },
                orderBy: { createdAt: "asc" },
            });
            return res.json(jobs.map((j) => {
                var _a;
                return ({
                    title: j.title,
                    department: ((_a = j.department) === null || _a === void 0 ? void 0 : _a.name) || "—",
                    headcount: j.headcount,
                    openSince: Math.floor((now.getTime() - new Date(j.createdAt).getTime()) / 86400000),
                    location: j.location || "—",
                });
            }));
        }
        res.status(400).json({ error: "Unknown type. Use: present | approvals | attrition | ot | positions" });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getKpiDetail = getKpiDetail;
// ═══════════════════════════════════════════════════════════
// SECTION 12 — OT ANALYSIS
// GET /api/management/ot-analysis?month=YYYY-MM
// ═══════════════════════════════════════════════════════════
const getOtAnalysis = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const monthParam = req.query.month;
        let rangeStart;
        let rangeEnd;
        if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
            const base = new Date(`${monthParam}-01`);
            rangeStart = (0, date_fns_1.startOfMonth)(base);
            rangeEnd = (0, date_fns_1.endOfMonth)(base);
        }
        else {
            rangeStart = (0, date_fns_1.startOfMonth)(new Date());
            rangeEnd = (0, date_fns_1.endOfMonth)(new Date());
        }
        // Dept-wise OT totals (approved)
        const otByDept = yield prisma_1.prisma.overtimeApproval.groupBy({
            by: ["employeeId"],
            where: {
                date: { gte: rangeStart, lte: rangeEnd },
                status: "APPROVE",
                managerStatus: "APPROVED",
            },
            _sum: { minutes: true },
        });
        // Get employee info for dept grouping
        const empIds = otByDept.map((r) => r.employeeId);
        const employees = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: empIds } },
            include: {
                Department: { select: { name: true } },
                designation: { select: { name: true } },
            },
        });
        const empMap = new Map(employees.map((e) => [e.id, e]));
        // Aggregate by dept
        const deptMap = new Map();
        for (const row of otByDept) {
            const emp = empMap.get(row.employeeId);
            const dept = ((_a = emp === null || emp === void 0 ? void 0 : emp.Department) === null || _a === void 0 ? void 0 : _a.name) || "Unknown";
            deptMap.set(dept, (deptMap.get(dept) || 0) + (row._sum.minutes || 0));
        }
        const deptTotals = Array.from(deptMap.entries())
            .map(([dept, minutes]) => ({ dept, minutes, hours: +(minutes / 60).toFixed(1) }))
            .sort((a, b) => b.minutes - a.minutes);
        // All employees with OT — sorted by dept then hours desc
        const allEmployees = otByDept
            .map((row) => {
            var _a, _b;
            const emp = empMap.get(row.employeeId);
            return {
                name: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
                dept: ((_a = emp === null || emp === void 0 ? void 0 : emp.Department) === null || _a === void 0 ? void 0 : _a.name) || "—",
                designation: ((_b = emp === null || emp === void 0 ? void 0 : emp.designation) === null || _b === void 0 ? void 0 : _b.name) || "—",
                minutes: row._sum.minutes || 0,
                hours: +(((row._sum.minutes || 0) / 60)).toFixed(1),
            };
        })
            .sort((a, b) => a.dept.localeCompare(b.dept) || b.minutes - a.minutes);
        // Top 15 for summary card
        const topEmployees = [...allEmployees].sort((a, b) => b.minutes - a.minutes).slice(0, 15);
        const monthLabel = (0, date_fns_1.format)(rangeStart, "MMMM yyyy");
        res.json({ deptTotals, topEmployees, allEmployees, monthLabel });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getOtAnalysis = getOtAnalysis;
// ═══════════════════════════════════════════════════════════
// SECTION 13 — LATE ARRIVALS ANALYSIS
// GET /api/management/late-arrivals?days=30
// ═══════════════════════════════════════════════════════════
const getLateArrivals = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const days = Math.min(parseInt(req.query.days || "30", 10) || 30, 90);
        const since = startOfDayIST((0, date_fns_1.addDays)(new Date(), -days + 1));
        // All late login records with employee info
        const allLate = yield prisma_1.prisma.lateLoginLog.findMany({
            where: { date: { gte: since } },
            include: {
                employee: { include: { Department: { select: { name: true } } } },
            },
        });
        const empLateMap = new Map();
        for (const row of allLate) {
            const emp = row.employee;
            const cur = empLateMap.get(row.employeeId) || {
                name: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
                dept: ((_a = emp === null || emp === void 0 ? void 0 : emp.Department) === null || _a === void 0 ? void 0 : _a.name) || "—",
                count: 0,
                totalMinutes: 0,
            };
            cur.count += 1;
            cur.totalMinutes += row.lateMinutes || 0;
            empLateMap.set(row.employeeId, cur);
        }
        // All employees sorted by dept then count desc
        const allEmployees = Array.from(empLateMap.values())
            .map((e) => (Object.assign(Object.assign({}, e), { avgMinutes: Math.round(e.totalMinutes / e.count) })))
            .sort((a, b) => a.dept.localeCompare(b.dept) || b.count - a.count);
        // Top 15 for summary card (by count desc)
        const topLate = [...allEmployees].sort((a, b) => b.count - a.count).slice(0, 15);
        // Dept heatmap
        const deptFreq = new Map();
        for (const row of allLate) {
            const dept = ((_c = (_b = row.employee) === null || _b === void 0 ? void 0 : _b.Department) === null || _c === void 0 ? void 0 : _c.name) || "Unknown";
            const cur = deptFreq.get(dept) || { count: 0, totalMinutes: 0 };
            cur.count += 1;
            cur.totalMinutes += row.lateMinutes || 0;
            deptFreq.set(dept, cur);
        }
        const deptHeatmap = Array.from(deptFreq.entries())
            .map(([dept, v]) => ({ dept, count: v.count, avgMinutes: Math.round(v.totalMinutes / v.count) }))
            .sort((a, b) => b.count - a.count);
        res.json({ topLate, allEmployees, deptHeatmap, days });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getLateArrivals = getLateArrivals;
// ═══════════════════════════════════════════════════════════
// SECTION 14 — LEAVE BALANCE UTILIZATION
// GET /api/management/leave-utilization
// ═══════════════════════════════════════════════════════════
const getLeaveUtilization = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const year = new Date().getFullYear();
        const balances = yield prisma_1.prisma.employeeLeaveBalance.findMany({ where: { year } });
        // Fetch employees separately and build a map
        const empIds = [...new Set(balances.map((b) => b.employeeId))];
        const empList = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: empIds } },
            include: { Department: { select: { name: true } } },
        });
        const empMap = new Map(empList.map((e) => [e.id, e]));
        const empAgg = new Map();
        for (const b of balances) {
            const cur = empAgg.get(b.employeeId) || { allowed: 0, used: 0 };
            cur.allowed += b.totalAllowed || 0;
            cur.used += (b.used || 0) + (b.halfDayUsed || 0) * 0.5;
            empAgg.set(b.employeeId, cur);
        }
        // Dept-wise aggregation
        const deptMap = new Map();
        for (const [empId, agg] of empAgg.entries()) {
            const emp = empMap.get(empId);
            const dept = ((_a = emp === null || emp === void 0 ? void 0 : emp.Department) === null || _a === void 0 ? void 0 : _a.name) || "Unknown";
            const cur = deptMap.get(dept) || { allowed: 0, used: 0, count: 0 };
            cur.allowed += agg.allowed;
            cur.used += agg.used;
            cur.count += 1;
            deptMap.set(dept, cur);
        }
        const deptStats = Array.from(deptMap.entries())
            .map(([dept, v]) => ({
            dept,
            headcount: v.count,
            totalAllowed: v.allowed,
            totalUsed: +v.used.toFixed(1),
            remaining: +(v.allowed - v.used).toFixed(1),
            utilizationPct: v.allowed > 0 ? Math.round((v.used / v.allowed) * 100) : 0,
        }))
            .sort((a, b) => b.utilizationPct - a.utilizationPct);
        // All employees — sorted by dept then utilization desc (no limit)
        const allEmployees = Array.from(empAgg.entries())
            .map(([empId, agg]) => {
            var _a;
            const emp = empMap.get(empId);
            return {
                name: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
                dept: ((_a = emp === null || emp === void 0 ? void 0 : emp.Department) === null || _a === void 0 ? void 0 : _a.name) || "—",
                allowed: agg.allowed,
                used: +agg.used.toFixed(1),
                remaining: +(agg.allowed - agg.used).toFixed(1),
                utilizationPct: agg.allowed > 0 ? Math.round((agg.used / agg.allowed) * 100) : 0,
            };
        })
            .sort((a, b) => a.dept.localeCompare(b.dept) || b.utilizationPct - a.utilizationPct);
        // Top 15 for summary card
        const topUsers = [...allEmployees]
            .filter((e) => e.used > 0)
            .sort((a, b) => b.utilizationPct - a.utilizationPct)
            .slice(0, 15);
        res.json({ deptStats, topUsers, allEmployees, year });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getLeaveUtilization = getLeaveUtilization;
// ═══════════════════════════════════════════════════════════
// SECTION 15 — ABSENTEEISM TRACKING
// GET /api/management/absenteeism?days=30
// ═══════════════════════════════════════════════════════════
const getAbsenteeism = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const days = Math.min(parseInt(req.query.days || "30", 10) || 30, 90);
        const since = startOfDayIST((0, date_fns_1.addDays)(new Date(), -days + 1));
        // Count absent days per employee (ABSENT or LEAVE status without approved leave = absenteeism)
        const absentGroups = yield prisma_1.prisma.attendance.groupBy({
            by: ["employeeId"],
            where: {
                date: { gte: since },
                status: "ABSENT",
            },
            _count: { id: true },
            having: { id: { _count: { gte: 3 } } },
            orderBy: { _count: { id: "desc" } },
        });
        const empIds = absentGroups.map((r) => r.employeeId);
        const employees = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: empIds } },
            include: { Department: { select: { name: true } } },
        });
        const empMap = new Map(employees.map((e) => [e.id, e]));
        const chronicAbsentees = absentGroups.map((row) => {
            var _a;
            const emp = empMap.get(row.employeeId);
            return {
                name: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
                dept: ((_a = emp === null || emp === void 0 ? void 0 : emp.Department) === null || _a === void 0 ? void 0 : _a.name) || "—",
                absentDays: row._count.id,
                absentRate: Math.round((row._count.id / days) * 100),
            };
        });
        // Dept-wise absent days (all employees, not just chronic)
        const allAbsent = yield prisma_1.prisma.attendance.groupBy({
            by: ["employeeId"],
            where: {
                date: { gte: since },
                status: "ABSENT",
            },
            _count: { id: true },
        });
        const allEmpIds = allAbsent.map((r) => r.employeeId);
        const allEmpsForDept = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: allEmpIds } },
            include: { Department: { select: { name: true } } },
        });
        const allEmpMap = new Map(allEmpsForDept.map((e) => [e.id, e]));
        const deptAbsent = new Map();
        for (const row of allAbsent) {
            const dept = ((_b = (_a = allEmpMap.get(row.employeeId)) === null || _a === void 0 ? void 0 : _a.Department) === null || _b === void 0 ? void 0 : _b.name) || "Unknown";
            deptAbsent.set(dept, (deptAbsent.get(dept) || 0) + row._count.id);
        }
        // Get headcount per dept for rate calculation
        const deptHeadcounts = yield prisma_1.prisma.employee.groupBy({
            by: ["departmentId"],
            where: { employmentStatus: "ACTIVE" },
            _count: { id: true },
        });
        const deptNames = yield prisma_1.prisma.department.findMany({ select: { id: true, name: true } });
        const deptSummary = Array.from(deptAbsent.entries())
            .map(([dept, totalAbsent]) => {
            var _a;
            const deptEntry = deptNames.find((d) => d.name === dept);
            const hc = deptEntry
                ? (((_a = deptHeadcounts.find((d) => d.departmentId === deptEntry.id)) === null || _a === void 0 ? void 0 : _a._count.id) || 1)
                : 1;
            return {
                dept,
                totalAbsentDays: totalAbsent,
                headcount: hc,
                avgAbsentDays: +(totalAbsent / hc).toFixed(1),
                absentRate: Math.round((totalAbsent / (hc * days)) * 100),
            };
        })
            .sort((a, b) => b.absentRate - a.absentRate);
        // All absent employees sorted by dept then absent days desc
        const allAbsentEmployees = allAbsent
            .map((row) => {
            var _a;
            const emp = allEmpMap.get(row.employeeId);
            return {
                name: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
                dept: ((_a = emp === null || emp === void 0 ? void 0 : emp.Department) === null || _a === void 0 ? void 0 : _a.name) || "—",
                absentDays: row._count.id,
                absentRate: Math.round((row._count.id / days) * 100),
            };
        })
            .sort((a, b) => a.dept.localeCompare(b.dept) || b.absentDays - a.absentDays);
        res.json({ chronicAbsentees, deptSummary, allAbsentEmployees, days });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getAbsenteeism = getAbsenteeism;
// ═══════════════════════════════════════════════════════════
// SECTION 16 — WORKFORCE INSIGHTS (Age/Gender + Tenure)
// GET /api/management/workforce-insights
// ═══════════════════════════════════════════════════════════
const getWorkforceInsights = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const employees = yield prisma_1.prisma.employee.findMany({
            where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } },
            select: {
                firstName: true,
                lastName: true,
                employeeCode: true,
                dob: true,
                gender: true,
                dateOfJoining: true,
                Department: { select: { name: true } },
                designation: { select: { name: true } },
            },
        });
        const now = new Date();
        // Helper to classify tenure into the same buckets as the chart
        const tenureBandFor = (doj) => {
            if (!doj)
                return "unknown";
            const yrs = (now.getTime() - new Date(doj).getTime()) / (365.25 * 24 * 3600 * 1000);
            if (yrs < 1)
                return "< 1 year";
            if (yrs < 3)
                return "1 – 3 yrs";
            if (yrs < 5)
                return "3 – 5 yrs";
            if (yrs < 10)
                return "5 – 10 yrs";
            return "> 10 yrs";
        };
        // Full employee list (used by frontend for drill-down popups)
        const employeeList = employees.map((e) => {
            var _a, _b, _c, _d;
            const ageYrs = e.dob
                ? (now.getTime() - new Date(e.dob).getTime()) / (365.25 * 24 * 3600 * 1000)
                : null;
            return {
                name: `${(_a = e.firstName) !== null && _a !== void 0 ? _a : ""} ${(_b = e.lastName) !== null && _b !== void 0 ? _b : ""}`.trim(),
                employeeCode: e.employeeCode,
                dept: ((_c = e.Department) === null || _c === void 0 ? void 0 : _c.name) || "Unassigned",
                designation: ((_d = e.designation) === null || _d === void 0 ? void 0 : _d.name) || "—",
                gender: e.gender,
                age: ageYrs != null ? Math.floor(ageYrs) : null,
                ageBand: ageYrs != null ? (ageYrs <= 45 ? "≤ 45 years" : "> 45 years") : "unknown",
                dateOfJoining: e.dateOfJoining
                    ? new Date(e.dateOfJoining).toISOString().slice(0, 10) : null,
                tenureBand: tenureBandFor(e.dateOfJoining),
                joiningYear: e.dateOfJoining ? new Date(e.dateOfJoining).getFullYear() : null,
            };
        });
        // ── Age-Gender Split ──────────────────────────────────
        const ageSplit = {
            below45: { MALE: 0, FEMALE: 0, OTHER: 0 },
            above45: { MALE: 0, FEMALE: 0, OTHER: 0 },
        };
        for (const e of employees) {
            if (!e.dob)
                continue;
            const age = (now.getTime() - new Date(e.dob).getTime()) / (365.25 * 24 * 3600 * 1000);
            const bucket = age <= 45 ? "below45" : "above45";
            const g = (e.gender === "MALE" || e.gender === "FEMALE") ? e.gender : "OTHER";
            ageSplit[bucket][g] += 1;
        }
        const ageSplitChart = [
            { label: "≤ 45 years", male: ageSplit.below45.MALE, female: ageSplit.below45.FEMALE, other: ageSplit.below45.OTHER },
            { label: "> 45 years", male: ageSplit.above45.MALE, female: ageSplit.above45.FEMALE, other: ageSplit.above45.OTHER },
        ];
        // ── Tenure Buckets ────────────────────────────────────
        const tenureBuckets = [
            { label: "< 1 year", min: 0, max: 1, count: 0 },
            { label: "1 – 3 yrs", min: 1, max: 3, count: 0 },
            { label: "3 – 5 yrs", min: 3, max: 5, count: 0 },
            { label: "5 – 10 yrs", min: 5, max: 10, count: 0 },
            { label: "> 10 yrs", min: 10, max: 9999, count: 0 },
        ];
        for (const e of employees) {
            if (!e.dateOfJoining)
                continue;
            const tenureYrs = (now.getTime() - new Date(e.dateOfJoining).getTime()) / (365.25 * 24 * 3600 * 1000);
            for (const b of tenureBuckets) {
                if (tenureYrs >= b.min && tenureYrs < b.max) {
                    b.count++;
                    break;
                }
            }
        }
        // ── Joining vs Resignation Year Trend ─────────────────
        // Joinings per year — from ALL employees regardless of current status
        // (since the current query filters ACTIVE + NOTICE_PERIOD, query again for full history)
        const allForTrend = yield prisma_1.prisma.employee.findMany({
            select: { dateOfJoining: true },
        });
        const joiningYearMap = new Map();
        for (const e of allForTrend) {
            if (!e.dateOfJoining)
                continue;
            const yr = new Date(e.dateOfJoining).getFullYear();
            joiningYearMap.set(yr, (joiningYearMap.get(yr) || 0) + 1);
        }
        // Resignations per year — from resignation requests that actually completed
        const resignations = yield prisma_1.prisma.resignationRequest.findMany({
            where: { actualLastWorkingDay: { not: null } },
            select: { actualLastWorkingDay: true },
        });
        const resignationYearMap = new Map();
        for (const r of resignations) {
            if (!r.actualLastWorkingDay)
                continue;
            const yr = new Date(r.actualLastWorkingDay).getFullYear();
            resignationYearMap.set(yr, (resignationYearMap.get(yr) || 0) + 1);
        }
        // Build a combined year range so both series align on the X axis
        const allYears = new Set([
            ...joiningYearMap.keys(),
            ...resignationYearMap.keys(),
        ]);
        const joiningTrend = Array.from(allYears)
            .sort((a, b) => a - b)
            .map((year) => {
            var _a, _b, _c, _d, _e;
            return ({
                year,
                count: (_a = joiningYearMap.get(year)) !== null && _a !== void 0 ? _a : 0, // joinings (legacy field name kept)
                joinings: (_b = joiningYearMap.get(year)) !== null && _b !== void 0 ? _b : 0,
                resignations: (_c = resignationYearMap.get(year)) !== null && _c !== void 0 ? _c : 0,
                net: ((_d = joiningYearMap.get(year)) !== null && _d !== void 0 ? _d : 0) - ((_e = resignationYearMap.get(year)) !== null && _e !== void 0 ? _e : 0),
            });
        });
        // ── Dept Gender Breakdown ─────────────────────────────
        const deptGenderMap = new Map();
        for (const e of employees) {
            const dept = ((_a = e.Department) === null || _a === void 0 ? void 0 : _a.name) || "Unassigned";
            const cur = deptGenderMap.get(dept) || { male: 0, female: 0, other: 0 };
            if (e.gender === "MALE")
                cur.male++;
            else if (e.gender === "FEMALE")
                cur.female++;
            else
                cur.other++;
            deptGenderMap.set(dept, cur);
        }
        const deptGender = Array.from(deptGenderMap.entries())
            .map(([dept, v]) => (Object.assign(Object.assign({ dept }, v), { total: v.male + v.female + v.other })))
            .sort((a, b) => b.total - a.total);
        res.json({ ageSplitChart, tenureBuckets, joiningTrend, deptGender, employeeList });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getWorkforceInsights = getWorkforceInsights;
// ═══════════════════════════════════════════════════════════
// SECTION 17 — MOBILE LOGIN ACTIVITY
// GET /api/management/mobile-login-activity?days=14
// Detects mobile vs desktop from LoginHistory userAgent
// ═══════════════════════════════════════════════════════════
const getMobileLoginActivity = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const days = Math.min(parseInt(req.query.days) || 14, 90);
        const since = new Date();
        since.setDate(since.getDate() - days + 1);
        since.setHours(0, 0, 0, 0);
        const logs = yield prisma_1.prisma.loginHistory.findMany({
            where: { attemptedAt: { gte: since }, success: true },
            select: { attemptedAt: true, userAgent: true, userId: true },
            orderBy: { attemptedAt: "asc" },
        });
        const isMobile = (ua) => {
            if (!ua)
                return false;
            return /Mobile|Android|iPhone|iPad|Windows Phone|BlackBerry|webOS|Opera Mini/i.test(ua);
        };
        // Build a map for every day in the window
        const dayMap = new Map();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
            dayMap.set(dateStr, { mobile: 0, desktop: 0, users: new Set() });
        }
        for (const log of logs) {
            const dateStr = log.attemptedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
            const entry = dayMap.get(dateStr);
            if (!entry)
                continue;
            if (isMobile(log.userAgent))
                entry.mobile++;
            else
                entry.desktop++;
            entry.users.add(log.userId);
        }
        const daily = Array.from(dayMap.entries()).map(([date, v]) => ({
            date,
            label: new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
            mobile: v.mobile,
            desktop: v.desktop,
            total: v.mobile + v.desktop,
            uniqueUsers: v.users.size,
        }));
        const totalMobile = daily.reduce((s, d) => s + d.mobile, 0);
        const totalDesktop = daily.reduce((s, d) => s + d.desktop, 0);
        const totalLogins = totalMobile + totalDesktop;
        const uniqueActiveUsers = new Set(logs.map((l) => l.userId)).size;
        // Hourly distribution (IST hour 0–23)
        const hourly = Array.from({ length: 24 }, (_, h) => ({
            hour: h, mobile: 0, desktop: 0,
        }));
        for (const log of logs) {
            const hr = new Date(log.attemptedAt.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();
            if (isMobile(log.userAgent))
                hourly[hr].mobile++;
            else
                hourly[hr].desktop++;
        }
        res.json({
            daily,
            hourly,
            totalLogins,
            totalMobile,
            totalDesktop,
            mobilePct: totalLogins > 0 ? Math.round((totalMobile / totalLogins) * 100) : 0,
            uniqueActiveUsers,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getMobileLoginActivity = getMobileLoginActivity;
// ═══════════════════════════════════════════════════════════
// SECTION 18 — QUALIFICATIONS ANALYTICS
// GET /api/management/qualifications
// ═══════════════════════════════════════════════════════════
const getQualifications = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const [totalActive, qualifications] = yield Promise.all([
            prisma_1.prisma.employee.count({ where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } } }),
            prisma_1.prisma.qualification.findMany({
                select: {
                    degree: true,
                    degreeName: true,
                    institution: true,
                    year: true,
                    grade: true,
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            employmentStatus: true,
                            Department: { select: { name: true } },
                            designation: { select: { name: true } },
                        },
                    },
                },
            }),
        ]);
        // Only consider active/notice-period employees
        const active = qualifications.filter((q) => q.employee.employmentStatus === "ACTIVE" || q.employee.employmentStatus === "NOTICE_PERIOD");
        // Academic hierarchy — higher rank = higher qualification.
        // We pick ONLY the highest degree per employee so someone with SSLC + PU + Bachelor
        // gets counted once under "Bachelor", not three times.
        const degreeRank = (raw) => {
            const u = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (/(PHD|DOCTORATE)/.test(u))
                return { rank: 6, canonical: "PhD" };
            if (/(MASTER|MTECH|MSC|MA|MCOM|MBA|MCA|ME|MED|POSTGRAD|PG)/.test(u))
                return { rank: 5, canonical: "Master" };
            if (/(BACHELOR|BTECH|BSC|BA|BCOM|BBA|BCA|BE|BED|UG|GRADUATE)/.test(u))
                return { rank: 4, canonical: "Bachelor" };
            if (/DIPLOMA/.test(u))
                return { rank: 3, canonical: "Diploma" };
            if (/(PU|PUC|HSC|12)/.test(u))
                return { rank: 2, canonical: "PU" };
            if (/(SSLC|10)/.test(u))
                return { rank: 1, canonical: "SSLC" };
            return { rank: 0, canonical: raw.trim() || "Other" };
        };
        // Reduce to one qualification per employee = the highest one
        const highestByEmp = new Map();
        for (const q of active) {
            const raw = (q.degreeName || q.degree || "Other").trim();
            const { rank, canonical } = degreeRank(raw);
            const cur = highestByEmp.get(q.employee.id);
            if (!cur || rank > cur.rank) {
                highestByEmp.set(q.employee.id, {
                    degree: canonical,
                    rawDegree: raw,
                    institution: (_a = q.institution) !== null && _a !== void 0 ? _a : null,
                    dept: ((_b = q.employee.Department) === null || _b === void 0 ? void 0 : _b.name) || "Unassigned",
                    designation: ((_c = q.employee.designation) === null || _c === void 0 ? void 0 : _c.name) || "—",
                    name: `${(_d = q.employee.firstName) !== null && _d !== void 0 ? _d : ""} ${(_e = q.employee.lastName) !== null && _e !== void 0 ? _e : ""}`.trim(),
                    employeeCode: q.employee.employeeCode,
                    year: (_f = q.year) !== null && _f !== void 0 ? _f : null,
                    grade: (_g = q.grade) !== null && _g !== void 0 ? _g : null,
                    rank,
                });
            }
        }
        const coveredEmployeeIds = new Set(highestByEmp.keys());
        const coveragePct = totalActive > 0 ? Math.round((coveredEmployeeIds.size / totalActive) * 100) : 0;
        // Degree type distribution — based on highest per employee
        const degreeMap = new Map();
        for (const { degree } of highestByEmp.values()) {
            degreeMap.set(degree, (degreeMap.get(degree) || 0) + 1);
        }
        const degreeDistribution = Array.from(degreeMap.entries())
            .map(([degree, count]) => ({ degree, count }))
            .sort((a, b) => b.count - a.count);
        // Top institutions — use only the HIGHEST qualification's institution per employee
        const instMap = new Map();
        for (const { institution } of highestByEmp.values()) {
            if (!institution)
                continue;
            const key = institution.trim();
            instMap.set(key, (instMap.get(key) || 0) + 1);
        }
        const topInstitutions = Array.from(instMap.entries())
            .map(([institution, count]) => ({ institution, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
        // Department-wise — most common highest-degree per dept
        const deptMap = new Map();
        for (const [empId, v] of highestByEmp.entries()) {
            if (!deptMap.has(v.dept))
                deptMap.set(v.dept, { deptDegrees: new Map(), total: 0, empIds: new Set() });
            const entry = deptMap.get(v.dept);
            entry.deptDegrees.set(v.degree, (entry.deptDegrees.get(v.degree) || 0) + 1);
            entry.total++;
            entry.empIds.add(empId);
        }
        const deptBreakdown = Array.from(deptMap.entries())
            .map(([dept, v]) => {
            let topDegree = "";
            let topCount = 0;
            v.deptDegrees.forEach((cnt, deg) => { if (cnt > topCount) {
                topCount = cnt;
                topDegree = deg;
            } });
            return { dept, qualifiedCount: v.empIds.size, topDegree, totalQuals: v.total };
        })
            .sort((a, b) => b.qualifiedCount - a.qualifiedCount);
        // Graduation year trend (group by decade)
        const yearMap = new Map();
        for (const q of active) {
            if (!q.year || q.year < 1960 || q.year > new Date().getFullYear())
                continue;
            const decade = `${Math.floor(q.year / 10) * 10}s`;
            yearMap.set(decade, (yearMap.get(decade) || 0) + 1);
        }
        const graduationDecades = Array.from(yearMap.entries())
            .map(([decade, count]) => ({ decade, count }))
            .sort((a, b) => a.decade.localeCompare(b.decade));
        res.json({
            totalActive,
            withQualification: coveredEmployeeIds.size,
            coveragePct,
            degreeDistribution,
            topInstitutions,
            deptBreakdown,
            graduationDecades,
            // Per-employee highest qualification — powers drill-down popups
            employeeList: Array.from(highestByEmp.values()).map((v) => ({
                name: v.name,
                employeeCode: v.employeeCode,
                dept: v.dept,
                designation: v.designation,
                degree: v.degree,
                rawDegree: v.rawDegree,
                institution: v.institution,
                year: v.year,
                grade: v.grade,
            })),
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getQualifications = getQualifications;
// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 19 — EL ENCASHMENT & BALANCE INSIGHTS
// GET /api/management/el-insights
// KPI tiles + balance distribution + top offenders for management oversight
// ═══════════════════════════════════════════════════════════════════════════════
const getElInsights = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        // Current financial year
        const now = new Date();
        const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const el = yield prisma_1.prisma.leaveType.findFirst({ where: { name: "EL" } });
        if (!el)
            return res.status(404).json({ error: "EL leave type not found" });
        const policy = yield prisma_1.prisma.leavePolicy.findFirst({
            where: { leaveTypeId: el.id, isActive: true },
            orderBy: { createdAt: "desc" },
        });
        const policyMaxBalance = (_a = policy === null || policy === void 0 ? void 0 : policy.maxBalance) !== null && _a !== void 0 ? _a : 60;
        const policyMaxCarryForward = (_b = policy === null || policy === void 0 ? void 0 : policy.maxCarryForward) !== null && _b !== void 0 ? _b : 45;
        // Thresholds used by the insights section.
        // Real encashment eligibility IS the policy max (60 days).
        // The 55-day "approaching" list is a proactive heads-up — these people are
        // close to the hard policy limit, so management can plan pay-out in advance.
        const THRESHOLD_ELIGIBLE = policyMaxBalance; // 60 — actual encashment eligibility (policy)
        const THRESHOLD_APPROACHING = 55; // 55 — approaching eligibility heads-up
        const THRESHOLD_WATCHLIST = 50; // 50 — broader watchlist
        // Pull all current-year EL balances + employee info
        const balances = yield prisma_1.prisma.employeeLeaveBalance.findMany({
            where: { leaveTypeId: el.id, year: fyStartYear },
        });
        const empIds = balances.map(b => b.employeeId);
        const employees = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: empIds }, employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } },
            select: {
                id: true, employeeCode: true, firstName: true, lastName: true,
                Department: { select: { name: true } },
                designation: { select: { name: true } },
            },
        });
        const empMap = new Map(employees.map(e => [e.id, e]));
        // Last leave taken per employee (to spot leave-hoarders)
        const lastLeaves = yield prisma_1.prisma.leaveRequest.findMany({
            where: {
                employeeId: { in: empIds },
                leaveTypeId: el.id,
                status: "APPROVED",
            },
            select: { employeeId: true, endDate: true },
            orderBy: { endDate: "desc" },
        });
        const lastLeaveMap = new Map();
        for (const l of lastLeaves) {
            if (!lastLeaveMap.has(l.employeeId)) {
                lastLeaveMap.set(l.employeeId, l.endDate);
            }
        }
        // Build rows
        const rows = [];
        for (const bal of balances) {
            const emp = empMap.get(bal.employeeId);
            if (!emp)
                continue; // skip non-active employees
            const balance = Math.max(0, bal.totalAllowed - bal.used);
            // Days past the APPROACHING threshold (55) — the heads-up buffer
            const daysOver55 = Math.max(0, balance - THRESHOLD_APPROACHING);
            // Days past the actual ELIGIBLE threshold (60, policy max) — real liability
            const daysOver60 = Math.max(0, balance - THRESHOLD_ELIGIBLE);
            const lastLeaveDate = (_c = lastLeaveMap.get(bal.employeeId)) !== null && _c !== void 0 ? _c : null;
            rows.push({
                employeeId: bal.employeeId,
                employeeCode: emp.employeeCode,
                employeeName: `${emp.firstName} ${emp.lastName}`,
                dept: (_e = (_d = emp.Department) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "—",
                designation: (_g = (_f = emp.designation) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "—",
                totalAllowed: bal.totalAllowed,
                used: bal.used,
                balance,
                daysOver55,
                daysOver60,
                lastLeaveDate: lastLeaveDate ? lastLeaveDate.toISOString().slice(0, 10) : null,
            });
        }
        // ── Summary KPIs ────────────────────────────────────────
        // Eligible NOW = balance ≥ policy max (60). These people CAN be encashed today.
        const countEligible = rows.filter(r => r.balance >= THRESHOLD_ELIGIBLE).length;
        // Approaching = above 55 but not yet eligible. Heads-up for planning.
        const countApproaching = rows.filter(r => r.balance > THRESHOLD_APPROACHING).length;
        // Wider watchlist
        const countWatch = rows.filter(r => r.balance > THRESHOLD_WATCHLIST).length;
        // Actual encashment liability in days — only balances over policy max count
        const totalEligibleDays = rows.reduce((s, r) => s + r.daysOver60, 0);
        // Days already over the 55 heads-up threshold (includes eligible + approaching)
        const totalDaysOver55 = rows.reduce((s, r) => s + r.daysOver55, 0);
        // ── Distribution buckets ────────────────────────────────
        const buckets = [
            { label: "0–30 days", key: "b1", min: 0, max: 30, count: 0 },
            { label: "30–45 days", key: "b2", min: 30, max: 45, count: 0 },
            { label: "45–55 days", key: "b3", min: 45, max: 55, count: 0 },
            { label: "55–60 days", key: "b4", min: 55, max: 60, count: 0 },
            { label: "60+ days", key: "b5", min: 60, max: Infinity, count: 0 },
        ];
        for (const r of rows) {
            const b = buckets.find(b => r.balance >= b.min && r.balance < b.max);
            if (b)
                b.count++;
        }
        // Tag each row with its bucket for drill-down filtering
        const rowsWithBucket = rows.map(r => {
            var _a;
            const b = buckets.find(b => r.balance >= b.min && r.balance < b.max);
            return Object.assign(Object.assign({}, r), { bucket: (_a = b === null || b === void 0 ? void 0 : b.label) !== null && _a !== void 0 ? _a : "Unknown" });
        });
        // ── Top offenders (highest balance) ─────────────────────
        const topOffenders = [...rowsWithBucket]
            .sort((a, b) => b.balance - a.balance)
            .slice(0, 10);
        // ── Department-wise average balance (bonus for Option C flavor) ─────
        const deptMap = new Map();
        for (const r of rowsWithBucket) {
            const cur = (_h = deptMap.get(r.dept)) !== null && _h !== void 0 ? _h : { total: 0, count: 0, overThreshold: 0 };
            cur.total += r.balance;
            cur.count++;
            if (r.balance > THRESHOLD_ELIGIBLE)
                cur.overThreshold++;
            deptMap.set(r.dept, cur);
        }
        const deptAvg = Array.from(deptMap.entries())
            .map(([dept, v]) => ({
            dept,
            headcount: v.count,
            avgBalance: Math.round(v.total / v.count),
            overThreshold: v.overThreshold,
        }))
            .sort((a, b) => b.avgBalance - a.avgBalance);
        return res.json({
            year: fyStartYear,
            policyMaxBalance,
            policyMaxCarryForward,
            thresholds: {
                eligible: THRESHOLD_ELIGIBLE, // 60 — actual encashment eligibility
                approaching: THRESHOLD_APPROACHING, // 55 — heads-up threshold
                watchlist: THRESHOLD_WATCHLIST, // 50 — broader watch
            },
            summary: {
                totalEmployees: rows.length,
                countEligible, // balance >= 60, actually eligible now
                countApproaching, // balance > 55, heads-up (includes eligible)
                countWatch, // balance > 50, broader watchlist
                totalEligibleDays, // days over 60 — real encashment liability
                totalDaysOver55, // days over 55 — includes approaching window
            },
            distribution: buckets,
            topOffenders,
            deptAvg,
            employeeList: rowsWithBucket,
        });
    }
    catch (err) {
        console.error("getElInsights error:", err);
        return res.status(500).json({ error: err.message });
    }
});
exports.getElInsights = getElInsights;
// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 19 — TRAINING INSIGHTS (Calendar + Performance + Feedback)
// GET /api/management/training-insights
// ═══════════════════════════════════════════════════════════════════════════════
const getTrainingInsights = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        const yearStart = new Date(now.getFullYear(), 0, 1);
        // ── KPI tiles ────────────────────────────────────────────
        const [trainingsThisMonth, assignmentsAll, completedAssignments, attempts, pendingAssignedTests,] = yield Promise.all([
            prisma_1.prisma.training.count({
                where: {
                    OR: [
                        { startDate: { gte: monthStart, lte: monthEnd } },
                        { endDate: { gte: monthStart, lte: monthEnd } },
                        { AND: [{ startDate: { lte: monthStart } }, { endDate: { gte: monthEnd } }] },
                    ],
                },
            }),
            prisma_1.prisma.trainingAssignment.count({}),
            prisma_1.prisma.trainingAssignment.count({ where: { status: "Completed" } }),
            prisma_1.prisma.evaluationAttempt.findMany({
                where: { status: "Completed", createdAt: { gte: yearStart } },
                select: { score: true, employeeId: true, testId: true, createdAt: true },
            }),
            prisma_1.prisma.assignedTest.count({ where: { status: { not: "Completed" } } }),
        ]);
        const avgCompletionPct = assignmentsAll > 0
            ? Math.round((completedAssignments / assignmentsAll) * 100)
            : 0;
        const avgTestScore = attempts.length > 0
            ? Math.round(attempts.reduce((s, a) => { var _a; return s + ((_a = a.score) !== null && _a !== void 0 ? _a : 0); }, 0) / attempts.length)
            : 0;
        // ── Department Participation (improved) ──────────────────
        const allAssignments = yield prisma_1.prisma.trainingAssignment.findMany({
            include: {
                employee: {
                    select: {
                        id: true, firstName: true, lastName: true, employeeCode: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
                training: { select: { id: true, title: true } },
            },
        });
        const deptMap = new Map();
        for (const a of allAssignments) {
            const dept = ((_b = (_a = a.employee) === null || _a === void 0 ? void 0 : _a.Department) === null || _b === void 0 ? void 0 : _b.name) || "Unassigned";
            const cur = deptMap.get(dept) || { total: 0, completed: 0, trainings: new Set() };
            cur.total++;
            if (a.status === "Completed")
                cur.completed++;
            if ((_c = a.training) === null || _c === void 0 ? void 0 : _c.id)
                cur.trainings.add(a.training.id);
            deptMap.set(dept, cur);
        }
        const deptParticipation = Array.from(deptMap.entries())
            .map(([dept, v]) => ({
            dept,
            assignedEmployees: v.total,
            completed: v.completed,
            pending: v.total - v.completed,
            completionPct: v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0,
            trainingsCovered: v.trainings.size,
        }))
            .sort((a, b) => b.assignedEmployees - a.assignedEmployees);
        // ── Test Score Distribution ──────────────────────────────
        const scoreBands = [
            { label: "Excellent (80-100)", min: 80, max: 100, color: "#22c55e", count: 0 },
            { label: "Good (60-79)", min: 60, max: 79, color: "#60a5fa", count: 0 },
            { label: "Average (40-59)", min: 40, max: 59, color: "#f59e0b", count: 0 },
            { label: "Below Avg (<40)", min: 0, max: 39, color: "#ef4444", count: 0 },
        ];
        for (const a of attempts) {
            const s = (_d = a.score) !== null && _d !== void 0 ? _d : 0;
            const b = scoreBands.find(b => s >= b.min && s <= b.max);
            if (b)
                b.count++;
        }
        // Per-employee average score (for top/low lists)
        const empScoreMap = new Map();
        for (const a of attempts) {
            const cur = (_e = empScoreMap.get(a.employeeId)) !== null && _e !== void 0 ? _e : { total: 0, count: 0 };
            cur.total += (_f = a.score) !== null && _f !== void 0 ? _f : 0;
            cur.count++;
            empScoreMap.set(a.employeeId, cur);
        }
        const perfEmpIds = Array.from(empScoreMap.keys());
        const empDetails = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: perfEmpIds } },
            select: {
                id: true, firstName: true, lastName: true, employeeCode: true,
                Department: { select: { name: true } },
                designation: { select: { name: true } },
            },
        });
        const perfEmpMap = new Map(empDetails.map(e => [e.id, e]));
        // Helper to map a numeric score to a band label (matches scoreBands above)
        const bandFor = (score) => {
            var _a;
            const b = scoreBands.find((b) => score >= b.min && score <= b.max);
            return (_a = b === null || b === void 0 ? void 0 : b.label) !== null && _a !== void 0 ? _a : "—";
        };
        const performers = perfEmpIds.map(id => {
            var _a, _b, _c, _d, _e;
            const v = empScoreMap.get(id);
            const e = perfEmpMap.get(id);
            const avgScore = Math.round(v.total / v.count);
            return {
                employeeId: id,
                name: e ? `${e.firstName} ${e.lastName}` : `#${id}`,
                employeeCode: (_a = e === null || e === void 0 ? void 0 : e.employeeCode) !== null && _a !== void 0 ? _a : "",
                dept: (_c = (_b = e === null || e === void 0 ? void 0 : e.Department) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : "—",
                designation: (_e = (_d = e === null || e === void 0 ? void 0 : e.designation) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "—",
                avgScore,
                band: bandFor(avgScore), // drill-down uses this
                attemptsCount: v.count,
            };
        });
        // Granular per-attempt rows so a dept drill-down can show
        // exactly which training and which test produced each score.
        const tests = yield prisma_1.prisma.evaluationTest.findMany({
            where: { id: { in: [...new Set(attempts.map((a) => a.testId))] } },
            select: {
                id: true, name: true, passingPercent: true,
                TrainingTest: { select: { training: { select: { id: true, title: true } } } },
            },
        });
        const testMap = new Map(tests.map((t) => [t.id, t]));
        const attemptDetails = attempts.map((a) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
            const e = perfEmpMap.get(a.employeeId);
            const t = testMap.get(a.testId);
            const trainingTitle = (_d = (_c = (_b = (_a = t === null || t === void 0 ? void 0 : t.TrainingTest) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.training) === null || _c === void 0 ? void 0 : _c.title) !== null && _d !== void 0 ? _d : "—";
            return {
                employeeId: a.employeeId,
                name: e ? `${e.firstName} ${e.lastName}` : `#${a.employeeId}`,
                employeeCode: (_e = e === null || e === void 0 ? void 0 : e.employeeCode) !== null && _e !== void 0 ? _e : "",
                dept: (_g = (_f = e === null || e === void 0 ? void 0 : e.Department) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "—",
                designation: (_j = (_h = e === null || e === void 0 ? void 0 : e.designation) === null || _h === void 0 ? void 0 : _h.name) !== null && _j !== void 0 ? _j : "—",
                trainingTitle,
                testName: (_k = t === null || t === void 0 ? void 0 : t.name) !== null && _k !== void 0 ? _k : "—",
                score: (_l = a.score) !== null && _l !== void 0 ? _l : 0,
                passingPercent: (_m = t === null || t === void 0 ? void 0 : t.passingPercent) !== null && _m !== void 0 ? _m : 0,
                passed: ((_o = a.score) !== null && _o !== void 0 ? _o : 0) >= ((_p = t === null || t === void 0 ? void 0 : t.passingPercent) !== null && _p !== void 0 ? _p : 0),
                attemptDate: a.createdAt.toISOString().slice(0, 10),
                band: bandFor((_q = a.score) !== null && _q !== void 0 ? _q : 0),
            };
        });
        const topPerformers = [...performers].sort((a, b) => b.avgScore - a.avgScore).slice(0, 10);
        const lowPerformers = [...performers]
            .filter(p => p.avgScore < 60 && p.attemptsCount >= 1)
            .sort((a, b) => a.avgScore - b.avgScore)
            .slice(0, 10);
        // ── Feedback / Top trainings ─────────────────────────────
        const feedbacks = yield prisma_1.prisma.trainingFeedback.findMany({
            include: { training: { select: { id: true, title: true, startDate: true } } },
        });
        const trMap = new Map();
        for (const f of feedbacks) {
            const t = f.training;
            if (!t)
                continue;
            const cur = (_g = trMap.get(t.id)) !== null && _g !== void 0 ? _g : {
                title: t.title, ratings: [], trainerRatings: [],
                contentRatings: [], relevanceRatings: [], startDate: t.startDate,
            };
            if (f.rating)
                cur.ratings.push(f.rating);
            if (f.trainerRating)
                cur.trainerRatings.push(f.trainerRating);
            if (f.contentQuality)
                cur.contentRatings.push(f.contentQuality);
            if (f.relevance)
                cur.relevanceRatings.push(f.relevance);
            trMap.set(t.id, cur);
        }
        const avg = (arr) => arr.length === 0 ? 0 : Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10;
        const trainingFeedbackList = Array.from(trMap.entries()).map(([id, v]) => ({
            trainingId: id,
            title: v.title,
            startDate: v.startDate ? v.startDate.toISOString().slice(0, 10) : null,
            avgRating: avg(v.ratings),
            avgTrainer: avg(v.trainerRatings),
            avgContent: avg(v.contentRatings),
            avgRelevance: avg(v.relevanceRatings),
            feedbackCount: v.ratings.length,
        }));
        const topRatedTrainings = [...trainingFeedbackList]
            .filter(t => t.feedbackCount > 0)
            .sort((a, b) => b.avgRating - a.avgRating).slice(0, 5);
        const lowRatedTrainings = [...trainingFeedbackList]
            .filter(t => t.feedbackCount > 0)
            .sort((a, b) => a.avgRating - b.avgRating).slice(0, 5);
        return res.json({
            kpis: {
                trainingsThisMonth,
                totalAssigned: assignmentsAll,
                avgCompletionPct,
                avgTestScore,
                pendingAssignedTests,
            },
            deptParticipation,
            scoreDistribution: scoreBands,
            topPerformers,
            lowPerformers,
            topRatedTrainings,
            lowRatedTrainings,
            // Per-employee detail rows for drill-down (avg score across all attempts)
            employeeList: performers,
            // Granular per-attempt detail rows (employee × training × test)
            // — used for dept drill-down so management sees which trainings/tests
            // contributed to each dept's numbers.
            attemptDetails,
        });
    }
    catch (err) {
        console.error("getTrainingInsights error:", err);
        return res.status(500).json({ error: err.message });
    }
});
exports.getTrainingInsights = getTrainingInsights;
// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 20 — TRAINING CALENDAR (month view)
// GET /api/management/training-calendar?month=YYYY-MM
// ═══════════════════════════════════════════════════════════════════════════════
const getTrainingCalendar = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const monthParam = String(req.query.month || "");
        const m = monthParam.match(/^(\d{4})-(\d{1,2})$/);
        const now = new Date();
        const year = m ? Number(m[1]) : now.getFullYear();
        const month = m ? Number(m[2]) - 1 : now.getMonth();
        const monthStart = new Date(year, month, 1);
        const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
        const trainings = yield prisma_1.prisma.training.findMany({
            where: {
                OR: [
                    { startDate: { gte: monthStart, lte: monthEnd } },
                    { endDate: { gte: monthStart, lte: monthEnd } },
                    { AND: [{ startDate: { lte: monthStart } }, { endDate: { gte: monthEnd } }] },
                ],
            },
            include: {
                department: { select: { name: true } },
                TrainingAttendance: { select: { employeeId: true, date: true, status: true } },
                assignedEmployees: { select: { employeeId: true, status: true } },
            },
            orderBy: { startDate: "asc" },
        });
        const byDay = {};
        for (const t of trainings) {
            // startDate / endDate are nullable on the Training model — skip rows without dates
            if (!t.startDate)
                continue;
            const start = new Date(t.startDate);
            const end = new Date((_a = t.endDate) !== null && _a !== void 0 ? _a : t.startDate);
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                if (d < monthStart || d > monthEnd)
                    continue;
                const key = d.toISOString().slice(0, 10);
                const dayAttendance = t.TrainingAttendance.filter((a) => a.date && new Date(a.date).toISOString().slice(0, 10) === key);
                const attended = dayAttendance.filter((a) => (a.status || "").toUpperCase() === "PRESENT").length;
                const assigned = t.assignedEmployees.length;
                if (!byDay[key])
                    byDay[key] = [];
                byDay[key].push({
                    trainingId: t.id,
                    title: t.title,
                    dept: (_c = (_b = t.department) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : "All depts",
                    mode: (_d = t.mode) !== null && _d !== void 0 ? _d : "—",
                    startDate: t.startDate.toISOString().slice(0, 10),
                    endDate: ((_e = t.endDate) !== null && _e !== void 0 ? _e : t.startDate).toISOString().slice(0, 10),
                    assignedCount: assigned,
                    attendedCount: attended,
                    attendancePct: assigned > 0 ? Math.round((attended / assigned) * 100) : 0,
                });
            }
        }
        const days = [];
        const totalDays = monthEnd.getDate();
        for (let dom = 1; dom <= totalDays; dom++) {
            const d = new Date(year, month, dom);
            const key = d.toISOString().slice(0, 10);
            const list = (_f = byDay[key]) !== null && _f !== void 0 ? _f : [];
            days.push({
                date: key,
                dayOfMonth: dom,
                trainings: list,
                total: list.length,
                totalAttended: list.reduce((s, x) => s + x.attendedCount, 0),
            });
        }
        return res.json({
            year, month: month + 1,
            monthLabel: monthStart.toLocaleString("en-US", { month: "long", year: "numeric" }),
            totalTrainings: trainings.length,
            days,
        });
    }
    catch (err) {
        console.error("getTrainingCalendar error:", err);
        return res.status(500).json({ error: err.message });
    }
});
exports.getTrainingCalendar = getTrainingCalendar;
// ═══════════════════════════════════════════════════════════
// PAYROLL — money cards for the management dashboard
// ═══════════════════════════════════════════════════════════
const money = (n) => Math.round(n * 100) / 100;
// ── Payroll cost & statutory liability for one run ─────────────
// GET /api/management/payroll-overview?month=YYYY-MM
const getPayrollOverview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const monthParam = req.query.month;
        let targetYear;
        let targetMonth; // 1-12
        let labelDate;
        if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
            const [y, m] = monthParam.split("-").map(Number);
            targetYear = y;
            targetMonth = m;
            labelDate = new Date(`${monthParam}-01`);
        }
        else {
            const n = new Date();
            targetYear = n.getFullYear();
            targetMonth = n.getMonth() + 1;
            labelDate = (0, date_fns_1.startOfMonth)(n);
        }
        const monthLabel = (0, date_fns_1.format)(labelDate, "MMMM yyyy");
        const run = yield prisma_1.prisma.payrollRun.findUnique({
            where: { month_year: { month: targetMonth, year: targetYear } },
            include: { payslips: true },
        });
        if (!run) {
            return res.json({
                exists: false,
                monthLabel,
                headcount: 0,
                totals: { gross: 0, net: 0, deductions: 0, employerCost: 0, lopDays: 0, otPay: 0, otHours: 0 },
                statutory: { pf: 0, esi: 0, professionalTax: 0, tds: 0 },
                byDept: [],
                byBranch: [],
            });
        }
        const slips = run.payslips;
        const sum = (fn) => slips.reduce((s, p) => s + fn(p), 0);
        const gross = sum((p) => p.grossEarnings);
        const net = sum((p) => p.netPay);
        const deductions = sum((p) => p.totalDeductions);
        const pfEmployee = sum((p) => p.pfEmployee);
        const pfEmployer = sum((p) => p.pfEmployer);
        const esiEmployee = sum((p) => p.esiEmployee);
        const esiEmployer = sum((p) => p.esiEmployer);
        const professionalTax = sum((p) => p.professionalTax);
        const tds = sum((p) => p.tds);
        // Dept / branch cost split
        const empIds = slips.map((p) => p.employeeId);
        const employees = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: empIds } },
            include: { Department: { select: { name: true } }, Branch: { select: { name: true } } },
        });
        const empMap = new Map(employees.map((e) => [e.id, e]));
        const deptMap = new Map();
        const branchMap = new Map();
        for (const p of slips) {
            const emp = empMap.get(p.employeeId);
            const dept = ((_a = emp === null || emp === void 0 ? void 0 : emp.Department) === null || _a === void 0 ? void 0 : _a.name) || "Unknown";
            const branch = ((_b = emp === null || emp === void 0 ? void 0 : emp.Branch) === null || _b === void 0 ? void 0 : _b.name) || "Unknown";
            const d = deptMap.get(dept) || { gross: 0, net: 0, count: 0 };
            d.gross += p.grossEarnings;
            d.net += p.netPay;
            d.count += 1;
            deptMap.set(dept, d);
            const b = branchMap.get(branch) || { gross: 0, net: 0, count: 0 };
            b.gross += p.grossEarnings;
            b.net += p.netPay;
            b.count += 1;
            branchMap.set(branch, b);
        }
        const byDept = Array.from(deptMap.entries())
            .map(([dept, v]) => ({ dept, gross: money(v.gross), net: money(v.net), count: v.count }))
            .sort((a, b) => b.gross - a.gross);
        const byBranch = Array.from(branchMap.entries())
            .map(([branch, v]) => ({ branch, gross: money(v.gross), net: money(v.net), count: v.count }))
            .sort((a, b) => b.gross - a.gross);
        res.json({
            exists: true,
            monthLabel,
            runId: run.id,
            status: run.status,
            headcount: slips.length,
            totals: {
                gross: money(gross),
                net: money(net),
                deductions: money(deductions),
                employerCost: money(gross + pfEmployer + esiEmployer),
                lopDays: money(sum((p) => p.lopDays)),
                otPay: money(sum((p) => p.overtimePay)),
                otHours: money(sum((p) => p.overtimeHours)),
            },
            statutory: {
                pf: money(pfEmployee + pfEmployer),
                esi: money(esiEmployee + esiEmployer),
                professionalTax: money(professionalTax),
                tds: money(tds),
            },
            byDept,
            byBranch,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getPayrollOverview = getPayrollOverview;
// ── Month-over-month payroll trend (last 6 runs) ───────────────
// GET /api/management/payroll-trend
const getPayrollTrend = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const pairs = [];
        for (let i = 5; i >= 0; i--) {
            const d = (0, date_fns_1.subMonths)((0, date_fns_1.startOfMonth)(now), i);
            pairs.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: (0, date_fns_1.format)(d, "MMM yyyy") });
        }
        const grouped = yield prisma_1.prisma.payslip.groupBy({
            by: ["year", "month"],
            where: { OR: pairs.map((p) => ({ year: p.year, month: p.month })) },
            _sum: { grossEarnings: true, netPay: true, totalDeductions: true },
            _count: { _all: true },
        });
        const gMap = new Map(grouped.map((g) => [`${g.year}-${g.month}`, g]));
        const trend = pairs.map((p) => {
            const g = gMap.get(`${p.year}-${p.month}`);
            return {
                label: p.label,
                gross: money((g === null || g === void 0 ? void 0 : g._sum.grossEarnings) || 0),
                net: money((g === null || g === void 0 ? void 0 : g._sum.netPay) || 0),
                deductions: money((g === null || g === void 0 ? void 0 : g._sum.totalDeductions) || 0),
                headcount: (g === null || g === void 0 ? void 0 : g._count._all) || 0,
            };
        });
        res.json({ trend });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getPayrollTrend = getPayrollTrend;
// ── Loan exposure & repayment view ─────────────────────────────
// GET /api/management/loan-overview
const getLoanOverview = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [active, byStatus, byType, repaymentByMode, repaidAgg] = yield Promise.all([
            prisma_1.prisma.loan.aggregate({
                where: { status: "ACTIVE" },
                _sum: { outstandingBalance: true, emiAmount: true, principalAmount: true },
                _count: { _all: true },
            }),
            prisma_1.prisma.loan.groupBy({
                by: ["status"],
                _sum: { principalAmount: true, outstandingBalance: true },
                _count: { _all: true },
            }),
            prisma_1.prisma.loan.groupBy({
                by: ["loanType"],
                _sum: { principalAmount: true, outstandingBalance: true },
                _count: { _all: true },
            }),
            prisma_1.prisma.loanRepayment.groupBy({
                by: ["mode"],
                _sum: { amount: true },
                _count: { _all: true },
            }),
            prisma_1.prisma.loan.aggregate({ _sum: { totalRepaid: true, principalAmount: true } }),
        ]);
        const pending = byStatus.find((s) => s.status === "PENDING");
        res.json({
            outstandingExposure: money(active._sum.outstandingBalance || 0),
            activeLoans: active._count._all,
            emiDueThisMonth: money(active._sum.emiAmount || 0),
            totalDisbursed: money(repaidAgg._sum.principalAmount || 0),
            totalRepaid: money(repaidAgg._sum.totalRepaid || 0),
            pendingApprovals: {
                count: (pending === null || pending === void 0 ? void 0 : pending._count._all) || 0,
                amount: money((pending === null || pending === void 0 ? void 0 : pending._sum.principalAmount) || 0),
            },
            byStatus: byStatus.map((s) => ({
                status: s.status,
                count: s._count._all,
                principal: money(s._sum.principalAmount || 0),
                outstanding: money(s._sum.outstandingBalance || 0),
            })),
            byType: byType.map((t) => ({
                type: t.loanType,
                count: t._count._all,
                principal: money(t._sum.principalAmount || 0),
                outstanding: money(t._sum.outstandingBalance || 0),
            })),
            repaymentByMode: repaymentByMode.map((m) => ({
                mode: m.mode || "UNSPECIFIED",
                count: m._count._all,
                amount: money(m._sum.amount || 0),
            })),
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getLoanOverview = getLoanOverview;
// ── Incentive payouts & pending approvals ──────────────────────
// GET /api/management/incentive-overview
const getIncentiveOverview = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const monthStart = (0, date_fns_1.startOfMonth)(now);
        const monthEnd = (0, date_fns_1.endOfMonth)(now);
        const yearStart = new Date(now.getFullYear(), 0, 1);
        const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        const [pending, byType, bySource, paidThisMonth, paidThisYear] = yield Promise.all([
            prisma_1.prisma.incentive.aggregate({
                where: { status: "PENDING" },
                _sum: { amount: true },
                _count: { _all: true },
            }),
            prisma_1.prisma.incentive.groupBy({
                by: ["type"],
                _sum: { amount: true },
                _count: { _all: true },
            }),
            prisma_1.prisma.incentive.groupBy({
                by: ["source"],
                _sum: { amount: true },
                _count: { _all: true },
            }),
            prisma_1.prisma.incentive.aggregate({
                where: { status: "PAID", paidOn: { gte: monthStart, lte: monthEnd } },
                _sum: { amount: true },
                _count: { _all: true },
            }),
            prisma_1.prisma.incentive.aggregate({
                where: { status: "PAID", paidOn: { gte: yearStart, lte: yearEnd } },
                _sum: { amount: true },
                _count: { _all: true },
            }),
        ]);
        res.json({
            pendingApprovals: { count: pending._count._all, amount: money(pending._sum.amount || 0) },
            paidThisMonth: { count: paidThisMonth._count._all, amount: money(paidThisMonth._sum.amount || 0) },
            paidThisYear: { count: paidThisYear._count._all, amount: money(paidThisYear._sum.amount || 0) },
            byType: byType.map((t) => ({ type: t.type, count: t._count._all, amount: money(t._sum.amount || 0) })),
            bySource: bySource.map((s) => ({ source: s.source, count: s._count._all, amount: money(s._sum.amount || 0) })),
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getIncentiveOverview = getIncentiveOverview;
// ── Payroll readiness: structure gaps, CTC spread, TDS, revisions ──
// GET /api/management/payroll-readiness
const getPayrollReadiness = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const [missing, structures, upcoming] = yield Promise.all([
            // Active employees with no salary structure → would be skipped in a run
            prisma_1.prisma.employee.findMany({
                where: { employmentStatus: "ACTIVE", salaryStructure: { is: null } },
                select: {
                    id: true, firstName: true, lastName: true, employeeCode: true,
                    Department: { select: { name: true } },
                },
                orderBy: { firstName: "asc" },
            }),
            prisma_1.prisma.salaryStructure.findMany({
                select: {
                    basic: true, hra: true, medicalAllowance: true, travelAllowance: true,
                    specialAllowance: true, otherAllowances: true, tdsMonthly: true,
                },
            }),
            // Salary revisions scheduled to take effect in the future
            prisma_1.prisma.salaryStructure.findMany({
                where: { effectiveFrom: { gt: now } },
                select: {
                    effectiveFrom: true,
                    employee: {
                        select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } },
                    },
                },
                orderBy: { effectiveFrom: "asc" },
            }),
        ]);
        // Monthly CTC distribution buckets
        const buckets = [
            { label: "< 20k", min: 0, max: 20000, count: 0 },
            { label: "20k–40k", min: 20000, max: 40000, count: 0 },
            { label: "40k–60k", min: 40000, max: 60000, count: 0 },
            { label: "60k–1L", min: 60000, max: 100000, count: 0 },
            { label: "> 1L", min: 100000, max: Infinity, count: 0 },
        ];
        let totalMonthlyTds = 0;
        for (const s of structures) {
            const ctc = s.basic + s.hra + s.medicalAllowance + s.travelAllowance + s.specialAllowance + s.otherAllowances;
            totalMonthlyTds += s.tdsMonthly;
            const bucket = buckets.find((b) => ctc >= b.min && ctc < b.max);
            if (bucket)
                bucket.count += 1;
        }
        res.json({
            missingStructure: {
                count: missing.length,
                employees: missing.map((e) => {
                    var _a;
                    return ({
                        name: `${e.firstName} ${e.lastName}`,
                        employeeCode: e.employeeCode,
                        dept: ((_a = e.Department) === null || _a === void 0 ? void 0 : _a.name) || "—",
                    });
                }),
            },
            ctcDistribution: buckets.map((b) => ({ label: b.label, count: b.count })),
            totalMonthlyTds: money(totalMonthlyTds),
            structuresOnFile: structures.length,
            upcomingRevisions: {
                count: upcoming.length,
                items: upcoming.map((u) => {
                    var _a, _b, _c;
                    return ({
                        name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : "—",
                        employeeCode: ((_a = u.employee) === null || _a === void 0 ? void 0 : _a.employeeCode) || "—",
                        dept: ((_c = (_b = u.employee) === null || _b === void 0 ? void 0 : _b.Department) === null || _c === void 0 ? void 0 : _c.name) || "—",
                        effectiveFrom: u.effectiveFrom,
                    });
                }),
            },
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getPayrollReadiness = getPayrollReadiness;
