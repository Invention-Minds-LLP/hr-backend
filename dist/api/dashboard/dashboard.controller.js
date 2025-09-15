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
exports.DashboardController = void 0;
exports.listPendingClearances = listPendingClearances;
const client_1 = require("@prisma/client");
const date_fns_1 = require("date-fns");
const prisma = new client_1.PrismaClient();
const IST = 'Asia/Kolkata';
function parseAud(audience) {
    if (!audience)
        return undefined;
    try {
        let f = JSON.parse(audience);
        if (typeof f === 'string')
            f = JSON.parse(f); // handle double encoding
        return f;
    }
    catch (_a) {
        return undefined;
    }
}
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);
// -------- date helpers (IST-safe) --------
function startOfDayIST(d = new Date()) {
    const x = new Date(d.toLocaleString('en-US', { timeZone: IST }));
    x.setHours(0, 0, 0, 0);
    return x;
}
function endOfDayIST(d = new Date()) {
    const x = new Date(d.toLocaleString('en-US', { timeZone: IST }));
    x.setHours(23, 59, 59, 999);
    return x;
}
function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}
function sameMonthDay(a, b) {
    if (!a || !b)
        return false;
    return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
}
function sameYMD(a, b) {
    if (!a || !b)
        return false;
    const da = a instanceof Date ? a : new Date(a);
    const db = b instanceof Date ? b : new Date(b);
    // strip time
    da.setHours(0, 0, 0, 0);
    db.setHours(0, 0, 0, 0);
    return (da.getFullYear() === db.getFullYear() &&
        da.getMonth() === db.getMonth() &&
        da.getDate() === db.getDate());
}
function median(nums) {
    if (!nums.length)
        return 0;
    const a = nums.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function combineDateAndTime(baseDate, timeTemplate) {
    const dt = new Date(baseDate);
    const t = new Date(timeTemplate);
    dt.setHours(t.getHours(), t.getMinutes(), 0, 0);
    return dt;
}
function fmtDate(d) {
    return d ? d.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
function fmtTime(d) {
    return d ? d.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' }) : '—';
}
class DashboardController {
    constructor() {
        // ========== PUBLIC HANDLERS ==========
        /** GET /api/dashboard?location=ALL&department=ALL */
        this.getDashboard = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
            const { location = 'ALL', department = 'ALL', branchId, departmentId } = (req.query || {});
            const todayStart = startOfDayIST();
            const todayEnd = endOfDayIST();
            const yesterdayStart = startOfDayIST(addDays(new Date(), -1));
            const yesterdayEnd = endOfDayIST(addDays(new Date(), -1));
            const now = new Date();
            // ---- scope employees (filters)
            const employeeWhere = Object.assign(Object.assign({ employmentStatus: 'ACTIVE' }, (departmentId ? { departmentId: Number(departmentId) }
                : department !== 'ALL' ? { Department: { name: department } } : {})), (branchId ? { branchId: Number(branchId) }
                : location !== 'ALL' ? { Branch: { name: location } } : {}));
            const employees = yield prisma.employee.findMany({
                where: employeeWhere,
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    dob: true,
                    employeeCode: true,
                    dateOfJoining: true,
                    departmentId: true,
                    branchId: true,
                    probationEndDate: true,
                    reportingManager: true,
                    roleId: true,
                    Department: { select: { name: true } },
                },
            });
            const employeeIds = employees.map((e) => e.id);
            // ---- Today counts
            const [leavesToday, wfhToday, permissionsToday] = yield Promise.all([
                prisma.leaveRequest.count({
                    where: {
                        employeeId: { in: employeeIds },
                        status: 'APPROVED',
                        OR: [
                            { startDate: { lte: todayEnd }, endDate: { gte: todayStart } },
                            { startDate: { lte: todayEnd }, endDate: todayStart },
                        ],
                    },
                }),
                prisma.wFHRequest.count({
                    where: {
                        employeeId: { in: employeeIds },
                        status: 'APPROVED',
                        OR: [
                            { startDate: { lte: todayEnd }, endDate: { gte: todayStart } },
                            { startDate: { lte: todayEnd }, endDate: todayStart },
                        ],
                    },
                }),
                prisma.permissionRequest.count({
                    where: {
                        employeeId: { in: employeeIds },
                        status: 'APPROVED',
                        OR: [
                            { day: { gte: todayStart, lte: todayEnd } },
                            { startTime: { lte: todayEnd }, endTime: { gte: todayStart } },
                        ],
                    },
                }),
            ]);
            const [todayAttendance, todayAssignments, shiftSettings] = yield Promise.all([
                prisma.attendance.findMany({
                    where: { employeeId: { in: employeeIds }, date: { gte: todayStart, lte: todayEnd } },
                    select: { employeeId: true, checkIn: true },
                }),
                prisma.shiftAssignment.findMany({
                    where: { employeeId: { in: employeeIds }, date: { gte: todayStart, lte: todayEnd } },
                    select: { employeeId: true, shift: { select: { id: true, startTime: true, endTime: true } } },
                }),
                prisma.employeeShiftSetting.findMany({
                    where: { employeeId: { in: employeeIds } },
                    select: {
                        employeeId: true,
                        mode: true,
                        startDate: true,
                        fixedShift: { select: { id: true, startTime: true, endTime: true } },
                        rotationPattern: {
                            select: {
                                cycleDays: true,
                                items: {
                                    select: {
                                        dayIndex: true,
                                        shift: { select: { id: true, startTime: true, endTime: true } },
                                    },
                                },
                            },
                        },
                    },
                }),
            ]);
            const empById = new Map(employees.map(e => [e.id, e]));
            const shiftTypeByEmp = new Map();
            for (const s of shiftSettings) {
                shiftTypeByEmp.set(s.employeeId, s.mode === 'ROTATIONAL' ? 'Rotational' : 'General');
            }
            // Map employeeId -> array of candidate start DateTimes for *today*
            const candidatesStartMap = new Map();
            // 1) Per-day assignment (highest priority): lock to that one shift
            for (const a of todayAssignments) {
                if ((_a = a.shift) === null || _a === void 0 ? void 0 : _a.startTime) {
                    candidatesStartMap.set(a.employeeId, [combineDateAndTime(todayStart, a.shift.startTime)]);
                }
            }
            // 2) Otherwise from shift settings
            for (const s of shiftSettings) {
                if (candidatesStartMap.has(s.employeeId))
                    continue; // already fixed by assignment
                if (s.mode === 'FIXED' && ((_b = s.fixedShift) === null || _b === void 0 ? void 0 : _b.startTime)) {
                    candidatesStartMap.set(s.employeeId, [combineDateAndTime(todayStart, s.fixedShift.startTime)]);
                }
                else if (s.mode === 'ROTATIONAL' && ((_d = (_c = s.rotationPattern) === null || _c === void 0 ? void 0 : _c.items) === null || _d === void 0 ? void 0 : _d.length)) {
                    // ANY-SHIFT policy: include *all* shifts in the pattern as valid for today
                    const uniq = new Map(); // dedupe by shiftId
                    for (const it of s.rotationPattern.items) {
                        if (!((_e = it.shift) === null || _e === void 0 ? void 0 : _e.startTime))
                            continue;
                        uniq.set(it.shift.id, combineDateAndTime(todayStart, it.shift.startTime));
                    }
                    candidatesStartMap.set(s.employeeId, Array.from(uniq.values()));
                }
            }
            const lateDiffs = [];
            const lateRows = [];
            for (const rec of todayAttendance) {
                if (!rec.checkIn)
                    continue;
                const cands = (_f = candidatesStartMap.get(rec.employeeId)) !== null && _f !== void 0 ? _f : [];
                if (cands.length === 0)
                    continue;
                // Compute minutes late vs each candidate start
                let bestLate = null;
                for (const start of cands) {
                    const diffMin = Math.round((rec.checkIn.getTime() - start.getTime()) / 60000);
                    if (diffMin > 0) {
                        bestLate = (bestLate == null) ? diffMin : Math.min(bestLate, diffMin);
                    }
                }
                if (bestLate != null) {
                    lateDiffs.push(bestLate);
                    const e = empById.get(rec.employeeId);
                    lateRows.push([
                        e ? `${e.firstName} ${e.lastName}` : `Emp #${rec.employeeId}`,
                        (e === null || e === void 0 ? void 0 : e.employeeCode) || '—',
                        ((_g = e === null || e === void 0 ? void 0 : e.Department) === null || _g === void 0 ? void 0 : _g.name) || '—',
                        shiftTypeByEmp.get(rec.employeeId) || 'General',
                        `${bestLate} min`,
                    ]);
                }
            }
            const late = { count: lateDiffs.length, medianMins: Math.round(median(lateDiffs)) || 0 };
            // OT yesterday — compare checkout against the best-matching scheduled end
            const [yAttend, ySettings] = yield Promise.all([
                prisma.attendance.findMany({
                    where: { employeeId: { in: employeeIds }, date: { gte: yesterdayStart, lte: yesterdayEnd } },
                    select: { employeeId: true, checkIn: true, checkOut: true },
                }),
                prisma.employeeShiftSetting.findMany({
                    where: { employeeId: { in: employeeIds } },
                    select: {
                        employeeId: true,
                        mode: true,
                        fixedShift: { select: { id: true, startTime: true, endTime: true } },
                        rotationPattern: {
                            select: {
                                items: {
                                    select: {
                                        shift: { select: { id: true, startTime: true, endTime: true } },
                                    },
                                },
                            },
                        },
                    },
                }),
            ]);
            function combineEndWithOvernight(yStart, startTpl, endTpl) {
                const schedStart = combineDateAndTime(yStart, startTpl);
                const schedEnd = combineDateAndTime(yStart, endTpl);
                // overnight if end TOD < start TOD → push to next day
                const sH = new Date(startTpl).getHours(), sM = new Date(startTpl).getMinutes();
                const eH = new Date(endTpl).getHours(), eM = new Date(endTpl).getMinutes();
                if (eH < sH || (eH === sH && eM < sM)) {
                    schedEnd.setDate(schedEnd.getDate() + 1);
                }
                return { schedStart, schedEnd };
            }
            // Build candidate (start,end) for yesterday per employee
            const yCandEnds = new Map();
            for (const s of ySettings) {
                const list = [];
                if (s.mode === 'FIXED' && ((_h = s.fixedShift) === null || _h === void 0 ? void 0 : _h.startTime) && ((_j = s.fixedShift) === null || _j === void 0 ? void 0 : _j.endTime)) {
                    list.push(combineEndWithOvernight(yesterdayStart, s.fixedShift.startTime, s.fixedShift.endTime));
                }
                else if (s.mode === 'ROTATIONAL' && ((_l = (_k = s.rotationPattern) === null || _k === void 0 ? void 0 : _k.items) === null || _l === void 0 ? void 0 : _l.length)) {
                    const seen = new Set();
                    for (const it of s.rotationPattern.items) {
                        const sh = it.shift;
                        if (!(sh === null || sh === void 0 ? void 0 : sh.id) || !sh.startTime || !sh.endTime || seen.has(sh.id))
                            continue;
                        seen.add(sh.id);
                        list.push(combineEndWithOvernight(yesterdayStart, sh.startTime, sh.endTime));
                    }
                }
                if (list.length)
                    yCandEnds.set(s.employeeId, list);
            }
            // OT minutes = min positive (checkOut - anyCandidateEnd)
            // let totalOtMins = 0;
            const otEmployeeSet = new Set();
            const otRows = [];
            // for (const rec of yAttend) {
            //     if (!rec.checkOut) continue;
            //     const cands = yCandEnds.get(rec.employeeId) ?? [];
            //     let bestOT: number | null = null;
            //     for (const { schedEnd } of cands) {
            //         const diff = Math.round((rec.checkOut.getTime() - schedEnd.getTime()) / 60000);
            //         if (diff > 0) bestOT = bestOT == null ? diff : Math.min(bestOT, diff);
            //     }
            //     // if (bestOT != null) totalOtMins += bestOT;
            //     if (bestOT != null) {
            //         totalOtMins += bestOT;
            //         otEmployeeSet.add(rec.employeeId);
            //         const e = empById.get(rec.employeeId);
            //         otRows.push([
            //             e ? `${e.firstName} ${e.lastName}` : `Emp #${rec.employeeId}`,
            //             e?.employeeCode || '—',
            //             e?.Department?.name || '—',
            //             shiftTypeByEmp.get(rec.employeeId) || 'General',
            //             `${Math.floor(bestOT / 60)}h ${bestOT % 60}m`,
            //         ]);
            //     }
            // }
            // // const otYesterday = { hours: Math.round((totalOtMins / 60) * 10) / 10, cost: undefined as string | undefined };
            // const otYesterday = {
            //     hours: Math.round((totalOtMins / 60) * 10) / 10,
            //     count: otEmployeeSet.size,
            //     cost: undefined as string | undefined,
            // };
            // Save yesterday's OT records into OvertimeApproval table
            for (const rec of yAttend) {
                if (!rec.checkOut)
                    continue;
                const cands = (_m = yCandEnds.get(rec.employeeId)) !== null && _m !== void 0 ? _m : [];
                let bestOT = null;
                let bestSchedEnd = null;
                for (const { schedEnd } of cands) {
                    const diff = Math.round((rec.checkOut.getTime() - schedEnd.getTime()) / 60000);
                    if (diff > 0 && (bestOT == null || diff < bestOT)) {
                        bestOT = diff;
                        bestSchedEnd = schedEnd; // 👈 remember which shift end gave the OT
                    }
                }
                if (bestOT != null) {
                    yield prisma.overtimeApproval.upsert({
                        where: { employeeId_date: { employeeId: rec.employeeId, date: yesterdayStart } },
                        create: { employeeId: rec.employeeId, date: yesterdayStart, minutes: bestOT, scheduledEnd: bestSchedEnd, checkOut: rec.checkOut, status: 'PENDING' },
                        update: { minutes: bestOT, scheduledEnd: bestSchedEnd, checkOut: rec.checkOut, },
                    });
                }
            }
            // Pull only APPROVED OTs for dashboard
            const approvedOTs = yield prisma.overtimeApproval.findMany({
                where: { status: 'APPROVE', date: yesterdayStart },
                include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } } }
            });
            let totalOtMins = approvedOTs.reduce((sum, o) => sum + o.minutes, 0);
            const otYesterday = {
                hours: Math.round((totalOtMins / 60) * 10) / 10,
                count: approvedOTs.length,
                cost: undefined,
            };
            // Joiners, birthdays, anniversaries
            const newJoiners = employees.filter((e) => sameYMD(e.dateOfJoining, todayStart)).length;
            const birthdays = employees.filter((e) => sameMonthDay(e.dob, todayStart)).length;
            const anniversaries = employees.filter((e) => {
                const doj = new Date(e.dateOfJoining);
                return sameMonthDay(doj, todayStart) &&
                    (todayStart.getFullYear() - doj.getFullYear()) >= 1; // ✅
            }).length;
            // Announcements ack rate
            // Announcements ack rate + list
            const liveAnns = yield prisma.announcement.findMany({
                where: { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
                include: { acks: true },
                orderBy: { startsAt: 'desc' },
            });
            // helper: filter employees by audience JSON
            const audienceSize = (ann) => {
                if (!ann.audience)
                    return employeeIds.length;
                try {
                    let filt = JSON.parse(ann.audience);
                    if (typeof filt === 'string')
                        filt = JSON.parse(filt); // handle double-encoding
                    const filtered = employees.filter(e => {
                        if (filt.all)
                            return true;
                        if (filt.departmentId && !filt.departmentId.includes(e.departmentId))
                            return false;
                        if (filt.branchId && !filt.branchId.includes(e.branchId))
                            return false;
                        if (filt.roleId && !filt.roleId.includes(e.roleId))
                            return false;
                        if (filt.employeeId && !filt.employeeId.includes(e.id))
                            return false;
                        return true;
                    });
                    return filtered.length;
                }
                catch (err) {
                    console.error('Bad audience JSON', ann.audience, err);
                    return employeeIds.length;
                }
            };
            // build per-announcement stats
            const announcementStats = liveAnns.map(a => {
                const audienceCount = Math.max(1, audienceSize(a)); // prevent divide by zero
                const ackCount = a.acks.length;
                const rate = ackCount / audienceCount;
                return {
                    id: a.id,
                    title: a.title,
                    ackCount,
                    audienceCount,
                    ackRate: rate,
                    ackPercent: Math.round(rate * 100),
                };
            });
            // overall average rate if you want
            let ackRate = 0;
            if (announcementStats.length) {
                ackRate =
                    announcementStats.reduce((sum, x) => sum + x.ackRate, 0) /
                        announcementStats.length;
            }
            // ---- Attention widgets
            const [unmarkedCount, pendingApprovals, docsExpiring, offersAwaiting, overdueClearances] = yield Promise.all([
                this.countUnmarkedAttendance(employeeIds, todayStart, todayEnd),
                this.countPendingApprovals(employeeIds, todayStart, todayEnd),
                prisma.document.count({
                    where: {
                        employeeId: { in: employeeIds },
                        expiryDate: { gte: todayStart, lte: addDays(todayEnd, 30) },
                    },
                }),
                // “after SHORTLISTED”, excluding REJECTED, NO_SHOW, HIRED
                prisma.application.count({
                    where: {
                        status: {
                            in: [
                                client_1.ApplicationStatus.INTERVIEW_SCHEDULED,
                                client_1.ApplicationStatus.INTERVIEWED,
                                client_1.ApplicationStatus.OFFERED,
                                client_1.ApplicationStatus.OFFER_ACCEPTED,
                                // Add WITHDRAWN here only if you want to include those too:
                                // ApplicationStatus.WITHDRAWN,
                            ],
                        },
                        // Optional: limit to last 7 days
                        // createdAt: { gte: addDays(new Date(), -7) },
                    },
                }),
                // prisma.resignationClearance.count({
                //     where: { decision: 'PENDING', decidedAt: null, resignation: { status: { in: ['APPROVED', 'UNDER_REVIEW'] } } },
                // }),
                listPendingClearances().then(arr => arr.length),
            ]);
            const probationSoon = employees.filter((e) => e.probationEndDate && e.probationEndDate <= addDays(todayEnd, 7)).length;
            // ---- Recruiting pipeline mini bars
            const pipeline = yield this.pipelineMiniBars();
            // ---- People Ops
            const headcount = employees.length;
            const mtdStart = startOfDayIST(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
            const [joinsMTD, exitsMTD, internsActive] = yield Promise.all([
                prisma.employee.count({ where: { dateOfJoining: { gte: mtdStart, lte: todayEnd } } }),
                prisma.resignationRequest.count({ where: { actualLastWorkingDay: { gte: mtdStart, lte: todayEnd } } }),
                prisma.internship.count({ where: { status: 'ACTIVE' } }).catch(() => 0), // optional table
            ]);
            const netMovement = joinsMTD - exitsMTD;
            const yearStart = new Date(new Date().getFullYear(), 0, 1);
            const [assigned30, completed30, leavesYTD, policy, shiftToday, fixedShiftCount] = yield Promise.all([
                prisma.assignedTest.count({ where: { assignedAt: { gte: addDays(todayStart, -30) } } }),
                prisma.assignedTest.count({ where: { status: { in: ['Completed', 'COMPLETED', 'Done'] } } }),
                prisma.leaveRequest.count({
                    where: { employeeId: { in: employeeIds }, status: 'APPROVED', startDate: { gte: yearStart, lte: todayEnd } },
                }),
                prisma.entitlementPolicy.findFirst({ where: { year: new Date().getFullYear() } }),
                prisma.shiftAssignment.count({ where: { employeeId: { in: employeeIds }, date: { gte: todayStart, lte: todayEnd } } }),
                prisma.employeeShiftSetting.count({
                    where: { employeeId: { in: employeeIds }, mode: 'FIXED', fixedShiftId: { not: null } },
                }),
            ]);
            const trainCompliance = assigned30 ? Math.round((completed30 / assigned30) * 100) : 0;
            const leavePct = (policy === null || policy === void 0 ? void 0 : policy.leaveEntitlement)
                ? Math.min(100, Math.round((leavesYTD / (policy.leaveEntitlement * Math.max(1, headcount))) * 100))
                : 0;
            const shiftCoveragePct = headcount ? Math.round(((shiftToday + fixedShiftCount) / headcount) * 100) : 0;
            // ---- Learning & Performance
            const [assignedTestsToday, overdueTests, appSubmitted, waitingMgr, last7Attempts] = yield Promise.all([
                prisma.assignedTest.count({ where: { assignedAt: { gte: todayStart, lte: todayEnd } } }),
                prisma.assignedTest.count({
                    where: { deadlineDate: { lt: now }, status: { notIn: ['Completed', 'COMPLETED', 'Done'] } },
                }),
                prisma.appraisalForm.count({ where: { status: { in: ['Reviewed'] } } }),
                prisma.appraisalForm.count({ where: { status: { in: ['Draft'] } } }),
                prisma.evaluationAttempt.findMany({ where: { createdAt: { gte: addDays(todayStart, -7) } }, select: { score: true } }),
            ]);
            const avgScore7d = last7Attempts.length
                ? Math.round(last7Attempts.reduce((s, a) => s + (a.score || 0), 0) / last7Attempts.length)
                : 0;
            // ---- Security & Access
            const [bagSuspicious7d, failedLogins24h, unreadNotifications] = yield Promise.all([
                prisma.bagCheck.count({ where: { date: { gte: addDays(todayStart, -7) }, result: 'SUSPICIOUS' } }),
                prisma.loginHistory.count({ where: { attemptedAt: { gte: addDays(now, -1) }, success: false } }),
                prisma.notification.count({ where: { isRead: false } }),
            ]);
            // ---- Drilldown lists (for modals)
            const lists = yield this.getAllLists(todayStart, todayEnd);
            const attention = [
                { label: 'Unmarked attendance (by 11:00)', count: unmarkedCount, severity: 'danger', modal: 'unmarked' },
                { label: 'Pending approvals (Leave/WFH/Perm)', count: pendingApprovals, severity: 'warn', modal: 'approvals' },
                { label: 'Probation ending (7 days)', count: probationSoon, severity: 'warn', modal: 'probation' },
                { label: 'Contract expiring (30 days)', count: docsExpiring, severity: 'warn', modal: 'docs' },
                { label: 'Candidates awaiting  (7d)', count: offersAwaiting, severity: 'warn', modal: 'offersPendingSignature' },
                { label: 'Exit clearances overdue', count: overdueClearances, severity: 'danger', modal: 'clearances' },
            ];
            // now add OT pending
            const otPending = yield prisma.overtimeApproval.count({
                where: { status: 'PENDING', date: yesterdayStart }
            });
            attention.push({
                label: 'OT pending approval (yesterday)',
                count: otPending,
                severity: otPending ? 'warn' : 'good',
                modal: 'otPending',
            });
            res.json({
                today: {
                    leaves: leavesToday,
                    wfh: wfhToday,
                    permissions: permissionsToday,
                    late,
                    otYesterday,
                    newJoiners,
                    birthdays,
                    anniversaries,
                    announcementsAck: Math.round(ackRate * 100) / 100,
                },
                announcements: announcementStats,
                latestAnnouncement: announcementStats[0] || null,
                attention,
                pipeline,
                peopleOps: [
                    ['Headcount (Active)', String(headcount)],
                    ['Net movement (MTD)', (netMovement >= 0 ? '▲ +' : '▼ ') + netMovement, netMovement >= 0 ? 'good' : 'danger'],
                    ['Interns active', String(internsActive)],
                    ['Training compliance', `${trainCompliance}%`, trainCompliance >= 85 ? 'good' : trainCompliance >= 70 ? 'warn' : 'danger'],
                    ['Entitlement usage (leave)', `${leavePct}% used`],
                    ['Shift coverage (today)', `${shiftCoveragePct}%`, shiftCoveragePct >= 90 ? 'good' : shiftCoveragePct >= 75 ? 'warn' : 'danger'],
                ],
                learnPerf: [
                    ['Assigned tests today', String(assignedTestsToday)],
                    ['Overdue tests', String(overdueTests), overdueTests ? 'warn' : 'good'],
                    ['Appraisals — Submitted', String(appSubmitted)],
                    ['Waiting on Manager', String(waitingMgr), waitingMgr ? 'warn' : 'good'],
                    ['Avg score (7d)', `${avgScore7d}%`, avgScore7d >= 70 ? 'good' : avgScore7d >= 50 ? 'warn' : 'danger'],
                ],
                secAccess: [
                    ['Bag-check suspicious (7d)', String(bagSuspicious7d), bagSuspicious7d ? 'danger' : 'good'],
                    ['Failed logins (24h)', String(failedLogins24h), failedLogins24h ? 'warn' : 'good'],
                    ['Unread notifications', String(unreadNotifications)],
                ],
                lists,
            });
        }));
        /** GET /api/dashboard/list?key=unmarked|approvals|probation|docs|feedback|clearances */
        this.getList = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
            const { key, id, departmentId } = (req.query || {});
            if (!key)
                return res.status(400).json({ error: 'Missing query param: key' });
            const start = startOfDayIST();
            const end = endOfDayIST();
            const base = yield this.getAllLists(start, end);
            const yesterdayStart = startOfDayIST(addDays(new Date(), -1));
            const yesterdayEnd = endOfDayIST(addDays(new Date(), -1));
            // ----- NEW: tile-specific lists -----
            if (key === 'annAck') {
                if (!id)
                    return res.status(400).json({ error: 'Missing query param: id (announcementId)' });
                const ann = yield prisma.announcement.findUnique({
                    where: { id: Number(id) },
                    select: { id: true, title: true, audience: true },
                });
                if (!ann)
                    return res.status(404).json({ error: 'Announcement not found' });
                const filt = parseAud(ann.audience);
                // All ACTIVE employees inside the announcement audience
                const whereEmp = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ employmentStatus: 'ACTIVE' }, ((filt === null || filt === void 0 ? void 0 : filt.all) ? {} : {})), (((_a = filt === null || filt === void 0 ? void 0 : filt.departmentId) === null || _a === void 0 ? void 0 : _a.length) ? { departmentId: { in: filt.departmentId } } : {})), (((_b = filt === null || filt === void 0 ? void 0 : filt.branchId) === null || _b === void 0 ? void 0 : _b.length) ? { branchId: { in: filt.branchId } } : {})), (((_c = filt === null || filt === void 0 ? void 0 : filt.roleId) === null || _c === void 0 ? void 0 : _c.length) ? { roleId: { in: filt.roleId } } : {})), (((_d = filt === null || filt === void 0 ? void 0 : filt.employeeId) === null || _d === void 0 ? void 0 : _d.length) ? { id: { in: filt.employeeId } } : {}));
                const employees = yield prisma.employee.findMany({
                    where: whereEmp,
                    select: {
                        id: true,
                        departmentId: true,
                        Department: { select: { id: true, name: true } },
                    },
                });
                const empIds = employees.map(e => e.id);
                // All ACKs for this announcement
                const acks = yield prisma.announcementAck.findMany({
                    where: { announcementId: Number(id), employeeId: { in: empIds.length ? empIds : [-1] } },
                    select: { employeeId: true },
                });
                const ackSet = new Set(acks.map(a => a.employeeId));
                const map = new Map();
                for (const e of employees) {
                    const key = (_e = e.departmentId) !== null && _e !== void 0 ? _e : null;
                    const name = ((_f = e.Department) === null || _f === void 0 ? void 0 : _f.name) || '—';
                    if (!map.has(key))
                        map.set(key, { deptId: key, deptName: name, audience: 0, acked: 0, pending: 0, pct: 0 });
                    const row = map.get(key);
                    row.audience += 1;
                    if (ackSet.has(e.id))
                        row.acked += 1;
                    else
                        row.pending += 1;
                }
                // finalize pct
                for (const r of map.values()) {
                    r.pct = r.audience ? Math.round((r.acked / r.audience) * 100) : 0;
                }
                // sort: lowest % first (so lagging depts bubble up)
                const rows = Array.from(map.values())
                    .sort((a, b) => a.pct - b.pct || a.deptName.localeCompare(b.deptName))
                    .map(r => [r.deptName, String(r.audience), String(r.acked), String(r.pending), `${r.pct}%`]);
                return res.json({
                    title: `Acknowledgements — ${ann.title}`,
                    cols: ['Department', 'Audience', 'Acked', 'Pending', 'Ack %'],
                    rows,
                    actions: ['View pending'],
                });
            }
            // -------------------------------------------
            // NEW: Drilldown of not-acknowledged employees (optional filter by department)
            // GET /api/list?key=annAckPending&id=<announcementId>&departmentId=<deptId?>    (deptId optional)
            if (key === 'annAckPending') {
                if (!id)
                    return res.status(400).json({ error: 'Missing query param: id (announcementId)' });
                const ann = yield prisma.announcement.findUnique({
                    where: { id: Number(id) },
                    select: { id: true, title: true, audience: true },
                });
                if (!ann)
                    return res.status(404).json({ error: 'Announcement not found' });
                const filt = parseAud(ann.audience);
                // Audience filter + optional department filter for drilldown
                const whereEmp = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ employmentStatus: 'ACTIVE' }, ((filt === null || filt === void 0 ? void 0 : filt.all) ? {} : {})), (((_g = filt === null || filt === void 0 ? void 0 : filt.departmentId) === null || _g === void 0 ? void 0 : _g.length) ? { departmentId: { in: filt.departmentId } } : {})), (((_h = filt === null || filt === void 0 ? void 0 : filt.branchId) === null || _h === void 0 ? void 0 : _h.length) ? { branchId: { in: filt.branchId } } : {})), (((_j = filt === null || filt === void 0 ? void 0 : filt.roleId) === null || _j === void 0 ? void 0 : _j.length) ? { roleId: { in: filt.roleId } } : {})), (((_k = filt === null || filt === void 0 ? void 0 : filt.employeeId) === null || _k === void 0 ? void 0 : _k.length) ? { id: { in: filt.employeeId } } : {})), (departmentId ? { departmentId: Number(departmentId) } : {}));
                const employees = yield prisma.employee.findMany({
                    where: whereEmp,
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        phone: true,
                        employeeCode: true,
                        Department: { select: { id: true, name: true } },
                        reportingManager: true,
                    },
                    take: 5000,
                });
                const mgrMap = yield buildManagerNameMap(employees.map(e => e.reportingManager));
                const empIds = employees.map(e => e.id);
                const acks = yield prisma.announcementAck.findMany({
                    where: { announcementId: Number(id), employeeId: { in: empIds.length ? empIds : [-1] } },
                    select: { employeeId: true },
                });
                const ackSet = new Set(acks.map(a => a.employeeId));
                // Filter who hasn't acknowledged
                const pending = employees.filter(e => !ackSet.has(e.id));
                const rows = pending.map(p => {
                    var _a;
                    return [
                        `${p.firstName} ${p.lastName}`,
                        p.employeeCode || '—',
                        ((_a = p.Department) === null || _a === void 0 ? void 0 : _a.name) || '—',
                        p.email || '—',
                        p.phone || '—',
                        mgrMap.get(p.reportingManager) || '—',
                    ];
                });
                return res.json({
                    title: `Pending Acknowledgements — ${ann.title}` + (departmentId ? ` (Dept ${departmentId})` : ''),
                    cols: ['Employee', 'EMP ID', 'Department', 'Email', 'Phone', 'Manager'],
                    rows,
                    actions: ['Remind all', 'Export'],
                });
            }
            // Leaves (approved & overlapping today)
            if (key === 'leaves') {
                const items = yield prisma.leaveRequest.findMany({
                    where: {
                        status: 'APPROVED',
                        OR: [
                            { startDate: { lte: end }, endDate: { gte: start } },
                            { startDate: { lte: end }, endDate: start },
                        ],
                    },
                    include: {
                        employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } },
                        leaveType: { select: { name: true } },
                    },
                    take: 100,
                });
                const rows = items.map(x => {
                    var _a, _b, _c;
                    return [
                        `${x.employee.firstName} ${x.employee.lastName}`,
                        (_b = (_a = x.leaveType) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '—',
                        x.employee.employeeCode || '—',
                        ((_c = x.employee.Department) === null || _c === void 0 ? void 0 : _c.name) || '—',
                        fmtDate(x.startDate) + ' → ' + fmtDate(x.endDate),
                        'Approved',
                    ];
                });
                return res.json({ title: 'Leaves Today', cols: ['Employee', 'Type', 'EMP ID', 'Dept', 'Dates', 'Status'], rows, actions: ['Message'] });
            }
            // WFH (approved & overlapping today)
            if (key === 'wfh') {
                const items = yield prisma.wFHRequest.findMany({
                    where: {
                        status: 'APPROVED',
                        OR: [
                            { startDate: { lte: end }, endDate: { gte: start } },
                            { startDate: { lte: end }, endDate: start },
                        ],
                    },
                    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } } },
                    take: 100,
                });
                const rows = items.map(x => {
                    var _a;
                    return [
                        `${x.employee.firstName} ${x.employee.lastName}`,
                        x.employee.employeeCode || '—',
                        ((_a = x.employee.Department) === null || _a === void 0 ? void 0 : _a.name) || '—',
                        fmtDate(x.startDate) + ' → ' + fmtDate(x.endDate),
                        'Approved',
                    ];
                });
                return res.json({ title: 'WFH Today', cols: ['Employee', 'EMP ID', 'Dept', 'Window', 'Status'], rows, actions: ['Message'] });
            }
            // Permissions (approved & today overlap)
            if (key === 'permissions') {
                const items = yield prisma.permissionRequest.findMany({
                    where: {
                        status: 'APPROVED',
                        OR: [
                            { day: { gte: start, lte: end } },
                            { startTime: { lte: end }, endTime: { gte: start } },
                        ],
                    },
                    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } } },
                    take: 100,
                });
                const rows = items.map(x => {
                    var _a, _b;
                    return [
                        `${x.employee.firstName} ${x.employee.lastName}`,
                        x.employee.employeeCode || '—',
                        ((_a = x.employee.Department) === null || _a === void 0 ? void 0 : _a.name) || '—',
                        (_b = x.timing) !== null && _b !== void 0 ? _b : '—',
                        x.startTime || x.endTime ? `${fmtTime(x.startTime)}–${fmtTime(x.endTime)}` : fmtDate(x.day),
                        'Approved',
                    ];
                });
                return res.json({ title: 'Permissions Today', cols: ['Employee', 'EMP ID', 'Dept', 'Timing', 'Window/Day', 'Status'], rows, actions: ['Message'] });
            }
            // Late Arrivals (today) — matches your "rotational can use any shift" rule
            if (key === 'late') {
                // attendance + shift settings
                const [att, settings] = yield Promise.all([
                    prisma.attendance.findMany({
                        where: { date: { gte: start, lte: end }, checkIn: { not: null } },
                        select: { employeeId: true, checkIn: true, employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } } },
                    }),
                    prisma.employeeShiftSetting.findMany({
                        select: {
                            employeeId: true,
                            mode: true,
                            fixedShift: { select: { id: true, startTime: true } },
                            rotationPattern: {
                                select: { items: { select: { shift: { select: { id: true, startTime: true } } } } },
                            },
                        },
                    }),
                ]);
                const combineDateAndTime = (base, t) => {
                    const dt = new Date(base), tt = new Date(t);
                    dt.setHours(tt.getHours(), tt.getMinutes(), 0, 0);
                    return dt;
                };
                const shiftType = new Map();
                for (const s of settings) {
                    shiftType.set(s.employeeId, s.mode === 'ROTATIONAL' ? 'Rotational' : 'General');
                }
                const cands = new Map();
                for (const s of settings) {
                    if (s.mode === 'FIXED' && ((_l = s.fixedShift) === null || _l === void 0 ? void 0 : _l.startTime)) {
                        cands.set(s.employeeId, [combineDateAndTime(start, s.fixedShift.startTime)]);
                    }
                    else if (s.mode === 'ROTATIONAL' && ((_o = (_m = s.rotationPattern) === null || _m === void 0 ? void 0 : _m.items) === null || _o === void 0 ? void 0 : _o.length)) {
                        const m = new Map();
                        for (const it of s.rotationPattern.items) {
                            const sh = it.shift;
                            if ((sh === null || sh === void 0 ? void 0 : sh.id) && sh.startTime)
                                m.set(sh.id, combineDateAndTime(start, sh.startTime));
                        }
                        cands.set(s.employeeId, [...m.values()]);
                    }
                }
                const rows = [];
                for (const r of att) {
                    const list = (_p = cands.get(r.employeeId)) !== null && _p !== void 0 ? _p : [];
                    let bestLate = null;
                    for (const sdt of list) {
                        const diff = Math.round((r.checkIn.getTime() - sdt.getTime()) / 60000);
                        if (diff > 0) {
                            if (!bestLate || diff < bestLate.mins)
                                bestLate = { mins: diff, sched: sdt };
                        }
                    }
                    if (bestLate) {
                        rows.push([
                            `${r.employee.firstName} ${r.employee.lastName}`,
                            r.employee.employeeCode || '—',
                            ((_q = r.employee.Department) === null || _q === void 0 ? void 0 : _q.name) || '—',
                            shiftType.get(r.employeeId) || 'General',
                            fmtTime(bestLate.sched),
                            fmtTime(r.checkIn),
                            String(bestLate.mins),
                        ]);
                    }
                }
                // sort by most late
                rows.sort((a, b) => Number(b[3]) - Number(a[3]));
                return res.json({ title: 'Late Arrivals', cols: ['Employee', 'EMP ID', 'Dept', 'Shift Type', 'Scheduled', 'Check-in', 'Late (mins)'], rows, actions: ['Notify all'] });
            }
            // OT Yesterday (best match end; handles overnight)
            // if (key === 'ot') {
            //     const [att, settings] = await Promise.all([
            //         prisma.attendance.findMany({
            //             where: { date: { gte: yesterdayStart, lte: yesterdayEnd }, checkOut: { not: null } },
            //             select: { employeeId: true, checkOut: true, employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } } },
            //         }),
            //         prisma.employeeShiftSetting.findMany({
            //             select: {
            //                 employeeId: true,
            //                 mode: true,
            //                 fixedShift: { select: { id: true, startTime: true, endTime: true } },
            //                 rotationPattern: {
            //                     select: { items: { select: { shift: { select: { id: true, startTime: true, endTime: true } } } } },
            //                 },
            //             },
            //         }),
            //     ]);
            //     const combine = (base: Date, t: Date) => {
            //         const dt = new Date(base), tt = new Date(t);
            //         dt.setHours(tt.getHours(), tt.getMinutes(), 0, 0);
            //         return dt;
            //     };
            //     const overnightEnd = (ys: Date, st: Date, et: Date) => {
            //         const start = combine(ys, st);
            //         const end = combine(ys, et);
            //         const sH = new Date(st).getHours(), sM = new Date(st).getMinutes();
            //         const eH = new Date(et).getHours(), eM = new Date(et).getMinutes();
            //         if (eH < sH || (eH === sH && eM < sM)) end.setDate(end.getDate() + 1);
            //         return end;
            //     };
            //     const shiftType = new Map<number, 'General' | 'Rotational'>();
            //     for (const s of settings) {
            //         shiftType.set(s.employeeId, s.mode === 'ROTATIONAL' ? 'Rotational' : 'General');
            //     }
            //     const cands = new Map<number, Date[]>(); // employeeId -> candidate scheduled end times
            //     for (const s of settings) {
            //         const ends: Date[] = [];
            //         if (s.mode === 'FIXED' && s.fixedShift?.startTime && s.fixedShift?.endTime) {
            //             ends.push(overnightEnd(yesterdayStart, s.fixedShift.startTime, s.fixedShift.endTime));
            //         } else if (s.mode === 'ROTATIONAL' && s.rotationPattern?.items?.length) {
            //             const seen = new Set<number>();
            //             for (const it of s.rotationPattern.items) {
            //                 const sh = it.shift;
            //                 if (!sh?.id || !sh.startTime || !sh.endTime || seen.has(sh.id)) continue;
            //                 seen.add(sh.id);
            //                 ends.push(overnightEnd(yesterdayStart, sh.startTime, sh.endTime));
            //             }
            //         }
            //         if (ends.length) cands.set(s.employeeId, ends);
            //     }
            //     const rows: string[][] = [];
            //     for (const r of att) {
            //         const list = (cands.get(r.employeeId) ?? []);
            //         let best: { mins: number, sched: Date } | null = null;
            //         for (const se of list) {
            //             const diff = Math.round((r.checkOut!.getTime() - se.getTime()) / 60000);
            //             if (diff > 0 && (!best || diff < best.mins)) best = { mins: diff, sched: se };
            //         }
            //         if (best) {
            //             rows.push([
            //                 `${r.employee.firstName} ${r.employee.lastName}`,
            //                 r.employee.employeeCode || '—',
            //                 r.employee.Department?.name || '—',
            //                 shiftType.get(r.employeeId) || 'General',
            //                 fmtTime(best.sched),
            //                 fmtTime(r.checkOut!),
            //                 String(best.mins),
            //             ]);
            //         }
            //     }
            //     // sort by highest OT
            //     rows.sort((a, b) => Number(b[3]) - Number(a[3]));
            //     return res.json({ title: 'OT Yesterday', cols: ['Employee', 'EMP ID', 'Dept', 'Shift Type', 'Sched End', 'Check-out', 'OT (mins)'], rows, actions: ['Export'] });
            // }
            if (key === 'ot') {
                // 1) Approved OTs from yesterday
                const items = yield prisma.overtimeApproval.findMany({
                    where: { status: 'APPROVE', date: yesterdayStart },
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
                    orderBy: { minutes: 'desc' },
                });
                // 2) Lookup shift types for those employees
                const empIds = items.map(o => o.employee.id);
                const settings = yield prisma.employeeShiftSetting.findMany({
                    where: { employeeId: { in: empIds } },
                    select: { employeeId: true, mode: true },
                });
                const shiftTypeMap = new Map();
                for (const s of settings) {
                    shiftTypeMap.set(s.employeeId, s.mode === 'ROTATIONAL' ? 'Rotational' : 'General');
                }
                // 3) Build rows
                const rows = items.map(o => {
                    var _a;
                    return [
                        `${o.employee.firstName} ${o.employee.lastName}`,
                        o.employee.employeeCode || '—',
                        ((_a = o.employee.Department) === null || _a === void 0 ? void 0 : _a.name) || '—',
                        shiftTypeMap.get(o.employee.id) || 'General',
                        fmtTime(o.scheduledEnd),
                        fmtTime(o.checkOut),
                        `${Math.floor(o.minutes / 60)}h ${o.minutes % 60}m`,
                    ];
                });
                return res.json({
                    title: 'OT Yesterday',
                    cols: ['Employee', 'EMP ID', 'Dept', 'Shift Type', 'Sched End', 'Check-out', 'OT Duration'],
                    rows,
                    actions: ['Export'],
                });
            }
            // New Joiners / Birthdays / Anniversaries (sameMonthDay as in your summary)
            if (key === 'joiners' || key === 'birthdays' || key === 'anniversaries') {
                const people = yield prisma.employee.findMany({
                    where: { employmentStatus: 'ACTIVE' },
                    include: { Department: true },
                    take: 5000, // safety cap
                });
                const rows = [];
                for (const e of people) {
                    if (key === 'joiners' && sameYMD(e.dateOfJoining, start)) {
                        rows.push([`${e.firstName} ${e.lastName}`, e.employeeCode || '—', ((_r = e.Department) === null || _r === void 0 ? void 0 : _r.name) || '—', fmtDate(e.dateOfJoining)]);
                    }
                    if (key === 'birthdays' && sameMonthDay(e.dob, start)) {
                        rows.push([`${e.firstName} ${e.lastName}`, e.employeeCode || '—', ((_s = e.Department) === null || _s === void 0 ? void 0 : _s.name) || '—', fmtDate(e.dob)]);
                    }
                    if (key === 'anniversaries' &&
                        e.dateOfJoining &&
                        sameMonthDay(e.dateOfJoining, start) &&
                        (start.getFullYear() - new Date(e.dateOfJoining).getFullYear()) >= 1 // ✅ at least 1 year completed
                    ) {
                        rows.push([
                            `${e.firstName} ${e.lastName}`,
                            e.employeeCode || '—',
                            ((_t = e.Department) === null || _t === void 0 ? void 0 : _t.name) || '—',
                            fmtDate(e.dateOfJoining)
                        ]);
                    }
                }
                const titles = {
                    joiners: 'New Joiners Today', birthdays: 'Birthdays Today', anniversaries: 'Anniversaries Today',
                };
                return res.json({ title: titles[key], cols: ['Employee', 'EMP ID', 'Dept', 'Date'], rows, actions: ['Congratulate'] });
            }
            // add a new key
            if (key === 'offersPendingSignature') {
                // Option A: define exactly which statuses you consider "after shortlisted"
                const allowed = [
                    client_1.ApplicationStatus.INTERVIEW_SCHEDULED,
                    client_1.ApplicationStatus.INTERVIEWED,
                    client_1.ApplicationStatus.OFFERED,
                    client_1.ApplicationStatus.OFFER_ACCEPTED,
                    client_1.ApplicationStatus.OFFER_DECLINED,
                    // ApplicationStatus.WITHDRAWN, // remove if you don't want withdrawn
                ];
                const where = {
                    status: { in: allowed },
                    // createdAt: { gte: addDays(new Date(), -7) }, // uncomment for last 7 days
                };
                const [items, total] = yield Promise.all([
                    prisma.application.findMany({
                        where,
                        select: {
                            status: true,
                            currentStage: true,
                            updatedAt: true,
                            candidate: { select: { name: true } },
                            job: { select: { title: true } },
                        },
                        orderBy: { updatedAt: 'desc' },
                        take: 100,
                    }),
                    prisma.application.count({ where }),
                ]);
                const rows = items.map(a => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        (_b = (_a = a.candidate) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '—',
                        (_d = (_c = a.job) === null || _c === void 0 ? void 0 : _c.title) !== null && _d !== void 0 ? _d : '—',
                        (_e = a.status) !== null && _e !== void 0 ? _e : '—',
                        (_f = a.currentStage) !== null && _f !== void 0 ? _f : '—',
                        (_h = (_g = a.updatedAt) === null || _g === void 0 ? void 0 : _g.toLocaleString('en-IN', { timeZone: IST })) !== null && _h !== void 0 ? _h : '—',
                    ];
                });
                return res.json({
                    title: `Pipeline after shortlist (excl. Rejected/No-show/Hired) — ${total}`,
                    cols: ['Candidate', 'Job', 'Status', 'Stage', 'Last update'],
                    rows,
                    actions: ['Open application', 'Message candidate'],
                });
            }
            if (key === 'otPending') {
                const items = yield prisma.overtimeApproval.findMany({
                    where: { status: 'PENDING', date: yesterdayStart },
                    include: {
                        employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } }
                    }
                });
                const rows = items.map(o => {
                    var _a;
                    return ({
                        id: o.id, // 👈 unique id for selection
                        data: [
                            `${o.employee.firstName} ${o.employee.lastName}`,
                            o.employee.employeeCode || '—',
                            ((_a = o.employee.Department) === null || _a === void 0 ? void 0 : _a.name) || '—',
                            fmtTime(o.scheduledEnd),
                            fmtTime(o.checkOut),
                            `${Math.floor(o.minutes / 60)}h ${o.minutes % 60}m`,
                            'PENDING',
                        ]
                    });
                });
                return res.json({
                    title: 'OT Pending Approval (Yesterday)',
                    cols: ['Employee', 'EMP ID', 'Dept', 'Sched End', 'Checked Out ', 'OT Duration', 'Status'],
                    rows,
                    actions: ['Approve selected', 'Reject selected'],
                    selectable: true
                });
            }
            // fallback to your existing attention lists
            return res.json((_u = base[key]) !== null && _u !== void 0 ? _u : { title: 'Not found', cols: [], rows: [] });
            // return res.json(all[key] ?? { title: 'Not found', cols: [], rows: [] });
        }));
        /** GET /api/dashboard/recruiting (salary rejects, yet-to-receive-offer, no-shows) */
        this.getRecruiting = asyncHandler((_req, res) => __awaiter(this, void 0, void 0, function* () {
            const salaryRejects = yield prisma.application.count({
                where: { status: 'REJECTED', rejectReason: 'SALARY' },
            });
            const yetToReceiveOffer = yield prisma.application.findMany({
                where: { status: { in: ['SHORTLISTED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED'] }, offer: null },
                select: { id: true, candidate: { select: { name: true } }, job: { select: { title: true } } },
                take: 50,
            });
            const noShows = yield prisma.offer.findMany({
                where: { joinOutcome: 'NO_SHOW' },
                select: {
                    application: { select: { candidate: { select: { name: true } }, job: { select: { title: true } } } },
                    noShowReason: true,
                },
            });
            res.json({ salaryRejects, yetToReceiveOffer, noShows });
        }));
        this.approveOrRejectOT = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const { ids, action } = req.body;
            if (!(ids === null || ids === void 0 ? void 0 : ids.length)) {
                return res.status(400).json({ error: 'No OT IDs provided' });
            }
            const updated = yield prisma.overtimeApproval.updateMany({
                where: { id: { in: ids }, status: 'PENDING' },
                data: {
                    status: action,
                    approvedAt: new Date(),
                },
            });
            res.json({ ok: true, updated: updated.count });
        }));
        /** POST /api/recruiting/backfill-from-resignation  { resignationId:number } */
        this.createBackfillFromResignation = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const { resignationId } = req.body || {};
            if (!resignationId)
                return res.status(400).json({ error: 'resignationId is required' });
            const rr = yield prisma.resignationRequest.findUnique({
                where: { id: Number(resignationId) },
                include: { employee: true },
            });
            if (!rr)
                return res.status(404).json({ error: 'Resignation not found' });
            if (rr.status !== 'APPROVED')
                return res.status(400).json({ error: 'Resignation not approved' });
            const exists = yield prisma.job.findFirst({
                where: { backfillForEmployeeId: rr.employeeId, status: { in: ['OPEN', 'ON_HOLD', 'DRAFT'] } },
                select: { id: true },
            });
            if (exists)
                return res.json({ ok: true, jobId: exists.id, note: 'Backfill job already exists' });
            const branch = yield prisma.branch.findUnique({ where: { id: rr.employee.branchId } }).catch(() => null);
            const job = yield prisma.job.create({
                data: {
                    title: rr.employee.designation,
                    departmentId: rr.employee.departmentId,
                    location: (branch === null || branch === void 0 ? void 0 : branch.name) || undefined,
                    headcount: 1,
                    status: 'OPEN',
                    createdBy: (_a = rr.managerId) !== null && _a !== void 0 ? _a : 0,
                    backfillForEmployeeId: rr.employeeId,
                },
                select: { id: true },
            });
            res.json({ ok: true, jobId: job.id });
        }));
    }
    // ========== PRIVATE HELPERS ==========
    // private async pipelineMiniBars() {
    //     const [jobsOpen, applied, shortlisted, interviewing, offered, joining, joined] = await Promise.all([
    //         prisma.job.count({ where: { status: 'OPEN' } }),
    //         prisma.application.count({ where: { status: 'APPLIED' } }),
    //         prisma.application.count({ where: { status: 'SHORTLISTED' } }),
    //         prisma.application.count({ where: { status: { in: ['INTERVIEW_SCHEDULED', 'INTERVIEWED'] } } }),
    //         prisma.application.count({ where: { status: 'OFFERED' } }),
    //         prisma.offer.count({
    //             where: { status: 'SIGNED', proposedJoinAt: { gte: startOfDayIST(), lte: addDays(endOfDayIST(), 30) } },
    //         }),
    //         prisma.application.count({ where: { status: 'HIRED' } }),
    //     ]);
    //     return [
    //         { name: 'Jobs Open', value: jobsOpen },
    //         { name: 'Applied', value: applied },
    //         { name: 'Shortlisted', value: shortlisted },
    //         { name: 'Interviewing', value: interviewing },
    //         { name: 'Offered', value: offered },
    //         { name: 'Joining', value: joining },
    //         { name: 'Joined', value: joined },
    //     ];
    // }
    pipelineMiniBars() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            // window for "Joining" (next 30 days)
            const from = startOfDayIST();
            const to = addDays(endOfDayIST(), 30);
            // Policy: when does a candidate consume a seat on an OPEN job?
            // - HIRED application OR SIGNED offer OR actually JOINED
            const SEAT_FILLED_OR = [
                { status: 'HIRED' },
                { offer: { status: 'SIGNED' } },
                { offer: { joinOutcome: 'JOINED' } },
            ];
            const [
            // total headcount requested on OPEN jobs
            openHeadcountAgg, 
            // applications that currently consume a seat on those OPEN jobs
            filledSeats, 
            // pipeline counts
            applied, shortlisted, interviewing, offered, // see note below
            joining, // signed offers with an upcoming join date
            joined, // actually joined
            ] = yield Promise.all([
                prisma.job.aggregate({
                    where: { status: 'OPEN' },
                    _sum: { headcount: true },
                }),
                prisma.application.count({
                    where: {
                        job: { status: 'OPEN' },
                        OR: SEAT_FILLED_OR,
                    },
                }),
                prisma.application.count({ where: { status: 'APPLIED' } }),
                prisma.application.count({ where: { status: 'SHORTLISTED' } }),
                prisma.application.count({ where: { status: { in: ['INTERVIEW_SCHEDULED', 'INTERVIEWED'] } } }),
                prisma.application.count({ where: { status: 'OFFERED' } }),
                prisma.offer.count({
                    where: {
                        AND: [
                            { status: 'SIGNED' },
                            { proposedJoinAt: { gte: startOfDayIST(), lte: addDays(endOfDayIST(), 30) } },
                            { joinOutcome: null },
                            { application: { status: { not: 'HIRED' } } },
                        ],
                    },
                }),
                prisma.application.count({ where: { status: 'HIRED' } }),
            ]);
            const openHeadcount = (_a = openHeadcountAgg._sum.headcount) !== null && _a !== void 0 ? _a : 0;
            const jobsOpenVacancies = Math.max(0, openHeadcount - filledSeats);
            return [
                { name: 'Jobs Open', value: jobsOpenVacancies },
                { name: 'Applied', value: applied },
                { name: 'Shortlisted', value: shortlisted },
                { name: 'Interviewing', value: interviewing },
                { name: 'Offered', value: offered },
                { name: 'Joining', value: joining },
                { name: 'Joined', value: joined },
            ];
        });
    }
    countUnmarkedAttendance(employeeIds, start, end) {
        return __awaiter(this, void 0, void 0, function* () {
            const todaysAttendance = yield prisma.attendance.findMany({
                where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end } },
                select: { employeeId: true },
            });
            const presentSet = new Set(todaysAttendance.map((a) => a.employeeId));
            const [approvedLeave, approvedWFH, approvedPerm] = yield Promise.all([
                prisma.leaveRequest.findMany({
                    where: {
                        employeeId: { in: employeeIds },
                        status: 'APPROVED',
                        OR: [
                            { startDate: { lte: end }, endDate: { gte: start } },
                            { startDate: { lte: end }, endDate: start },
                        ],
                    },
                    select: { employeeId: true },
                }),
                prisma.wFHRequest.findMany({
                    where: {
                        employeeId: { in: employeeIds },
                        status: 'APPROVED',
                        OR: [
                            { startDate: { lte: end }, endDate: { gte: start } },
                            { startDate: { lte: end }, endDate: start },
                        ],
                    },
                    select: { employeeId: true },
                }),
                prisma.permissionRequest.findMany({
                    where: {
                        employeeId: { in: employeeIds },
                        status: 'APPROVED',
                        OR: [
                            { day: { gte: start, lte: end } },
                            { startTime: { lte: end }, endTime: { gte: start } },
                        ],
                    },
                    select: { employeeId: true },
                }),
            ]);
            const excused = new Set([
                ...approvedLeave.map((x) => x.employeeId),
                ...approvedWFH.map((x) => x.employeeId),
                ...approvedPerm.map((x) => x.employeeId),
            ]);
            let count = 0;
            for (const id of employeeIds) {
                if (!presentSet.has(id) && !excused.has(id))
                    count++;
            }
            return count;
        });
    }
    countPendingApprovals(employeeIds, start, end) {
        return __awaiter(this, void 0, void 0, function* () {
            const [leave, wfh, perm] = yield Promise.all([
                prisma.leaveRequest.count({
                    where: { employeeId: { in: employeeIds }, status: 'PENDING', createdAt: { gte: start, lte: end } },
                }),
                prisma.wFHRequest.count({
                    where: { employeeId: { in: employeeIds }, status: 'PENDING', createdAt: { gte: start, lte: end } },
                }),
                prisma.permissionRequest.count({
                    where: { employeeId: { in: employeeIds }, status: 'PENDING', createdAt: { gte: start, lte: end } },
                }),
            ]);
            return leave + wfh + perm;
        });
    }
    getAllLists(todayStart, todayEnd) {
        return __awaiter(this, void 0, void 0, function* () {
            // Unmarked
            const unmarkedRows = yield this.buildUnmarkedList(todayStart, todayEnd);
            // Approvals created today
            const [permPend, leavePend, wfhPend] = yield Promise.all([
                prisma.permissionRequest.findMany({
                    where: { status: 'PENDING', createdAt: { gte: todayStart, lte: todayEnd } },
                    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } }, } } },
                    take: 50,
                }),
                prisma.leaveRequest.findMany({
                    where: { status: 'PENDING', createdAt: { gte: todayStart, lte: todayEnd } },
                    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } }, } } },
                    take: 50,
                }),
                prisma.wFHRequest.findMany({
                    where: { status: 'PENDING', createdAt: { gte: todayStart, lte: todayEnd } },
                    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } }, } } },
                    take: 50,
                }),
            ]);
            const approvalsRows = [
                ...leavePend.map((x) => {
                    var _a;
                    return [
                        'Leave',
                        `${x.employee.firstName} ${x.employee.lastName}`,
                        x.employee.employeeCode || '—',
                        ((_a = x.employee.Department) === null || _a === void 0 ? void 0 : _a.name) || '—',
                        x.createdAt.toLocaleString('en-IN', { timeZone: IST }),
                        'PENDING',
                    ];
                }),
                ...wfhPend.map((x) => {
                    var _a;
                    return [
                        'WFH',
                        `${x.employee.firstName} ${x.employee.lastName}`,
                        x.employee.employeeCode || '—',
                        ((_a = x.employee.Department) === null || _a === void 0 ? void 0 : _a.name) || '—',
                        x.createdAt.toLocaleString('en-IN', { timeZone: IST }),
                        'PENDING',
                    ];
                }),
                ...permPend.map((x) => {
                    var _a;
                    return [
                        'Permission',
                        `${x.employee.firstName} ${x.employee.lastName}`,
                        x.employee.employeeCode || '—',
                        ((_a = x.employee.Department) === null || _a === void 0 ? void 0 : _a.name) || '—',
                        x.createdAt.toLocaleString('en-IN', { timeZone: IST }),
                        'PENDING',
                    ];
                }),
            ].slice(0, 20);
            // Probation ending (7 days)
            const probRowsRaw = yield prisma.employee.findMany({
                where: { probationEndDate: { gte: todayStart, lte: addDays(todayEnd, 7) } },
                select: {
                    firstName: true,
                    lastName: true,
                    employeeCode: true,
                    Department: { select: { name: true } },
                    reportingManager: true,
                    probationEndDate: true,
                },
            });
            const probRows = probRowsRaw.map((e) => {
                var _a;
                return [
                    `${e.firstName} ${e.lastName}`,
                    e.employeeCode || '—',
                    ((_a = e.Department) === null || _a === void 0 ? void 0 : _a.name) || '—',
                    e.reportingManager ? `Mgr #${e.reportingManager}` : '—',
                    e.probationEndDate
                        ? e.probationEndDate.toLocaleDateString('en-IN', { timeZone: IST, month: 'short', day: '2-digit', year: 'numeric' })
                        : '—',
                ];
            });
            // Documents expiring (30 days)
            const docs = yield prisma.document.findMany({
                where: { expiryDate: { gte: todayStart, lte: addDays(todayEnd, 30) } },
                include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } }, } } },
            });
            const docRows = docs.map((d) => {
                var _a;
                return [
                    `${d.employee.firstName} ${d.employee.lastName}`,
                    d.employee.employeeCode || '—',
                    ((_a = d.employee.Department) === null || _a === void 0 ? void 0 : _a.name) || '—',
                    d.type || d.category,
                    d.expiryDate
                        ? d.expiryDate.toLocaleDateString('en-IN', { timeZone: IST, month: 'short', day: '2-digit', year: 'numeric' })
                        : '—',
                    'Expiring',
                ];
            });
            // Interviews missing feedback today
            const miss = yield prisma.interview.findMany({
                where: { startTime: { gte: todayStart, lte: todayEnd }, feedbackAt: null },
                include: { application: { include: { candidate: true } } },
            });
            const missRows = miss.map((m) => [
                m.application.candidate.name,
                m.stage,
                m.panelUserIds || '—',
                m.startTime.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' }),
            ]);
            // Exit clearances overdue
            const overdue = yield listPendingClearancesDetailed(); // <— run in parallel
            const overRows = overdue.map(o => [
                o.employeeName,
                o.employeeCode || '—',
                o.deptName || '—',
                o.type,
                `${o.sinceDays} days`,
                o.verifierId ? `User #${o.verifierId}` : 'Unassigned'
            ]);
            return {
                unmarked: {
                    title: 'Unmarked attendance',
                    cols: ['Employee', 'EMP ID', 'Manager', 'Dept', 'Last seen'],
                    rows: unmarkedRows,
                    actions: ['Message all', 'Mark exception'],
                },
                approvals: {
                    title: 'Pending approvals',
                    cols: ['Type', 'Employee', 'EMP ID', 'Dept', 'Requested', 'Status'],
                    rows: approvalsRows,
                    actions: ['Approve all', 'Reject all'],
                },
                probation: {
                    title: 'Probation ending (7 days)',
                    cols: ['Employee', 'EMP ID', 'Dept', 'Manager', 'End date'],
                    rows: probRows,
                    actions: ['Request feedback', 'Extend probation'],
                },
                docs: {
                    title: 'Documents expiring (30 days)',
                    cols: ['Employee', 'EMP ID', 'Dept', 'Type', 'Expiry', 'Status'],
                    rows: docRows,
                    actions: ['Notify all', 'Create renewal tickets'],
                },
                feedback: {
                    title: 'Interviews missing feedback',
                    cols: ['Candidate', 'Stage', 'Panel', 'Due'],
                    rows: missRows,
                    actions: ['Nudge panel', 'Reassign reviewer'],
                },
                clearances: {
                    title: 'Exit clearances overdue',
                    cols: ['Employee', 'EMP ID', 'Dept', 'Type', 'Since', 'Owner'],
                    rows: overRows,
                    actions: ['Escalate', 'Assign delegate'],
                },
            };
        });
    }
    buildUnmarkedList(todayStart, todayEnd) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const active = yield prisma.employee.findMany({
                where: { employmentStatus: 'ACTIVE' },
                select: { id: true, firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } }, reportingManager: true },
            });
            const att = yield prisma.attendance.findMany({
                where: { date: { gte: todayStart, lte: todayEnd } },
                select: { employeeId: true },
            });
            const present = new Set(att.map((a) => a.employeeId));
            const [leave, wfh, perm] = yield Promise.all([
                prisma.leaveRequest.findMany({
                    where: {
                        status: 'APPROVED',
                        OR: [
                            { startDate: { lte: todayEnd }, endDate: { gte: todayStart } },
                            { startDate: { lte: todayEnd }, endDate: todayStart },
                        ],
                    },
                    select: { employeeId: true },
                }),
                prisma.wFHRequest.findMany({
                    where: {
                        status: 'APPROVED',
                        OR: [
                            { startDate: { lte: todayEnd }, endDate: { gte: todayStart } },
                            { startDate: { lte: todayEnd }, endDate: todayStart },
                        ],
                    },
                    select: { employeeId: true },
                }),
                prisma.permissionRequest.findMany({
                    where: {
                        status: 'APPROVED',
                        OR: [
                            { day: { gte: todayStart, lte: todayEnd } },
                            { startTime: { lte: todayEnd }, endTime: { gte: todayStart } },
                        ],
                    },
                    select: { employeeId: true },
                }),
            ]);
            const excused = new Set([...leave, ...wfh, ...perm].map((x) => x.employeeId));
            // build manager name map only for people you’ll show
            const unmarked = active.filter(e => !present.has(e.id) && !excused.has(e.id));
            const mgrMap = yield buildManagerNameMap(unmarked.map(e => e.reportingManager));
            const rows = [];
            for (const e of unmarked) {
                rows.push([
                    `${e.firstName} ${e.lastName}`,
                    e.employeeCode || '—',
                    e.reportingManager ? (mgrMap.get(e.reportingManager) || '—') : '—', // ← manager name here
                    ((_a = e.Department) === null || _a === void 0 ? void 0 : _a.name) || '—',
                    'Yesterday 6:00 pm',
                ]);
            }
            return rows.slice(0, 20);
        });
    }
}
exports.DashboardController = DashboardController;
const REQUIRED = ['IT', 'FINANCE', 'HR', 'ADMIN', 'SECURITY'];
function listPendingClearances() {
    return __awaiter(this, void 0, void 0, function* () {
        // get relevant resignations with the clearances you *do* have
        const resignations = yield prisma.resignationRequest.findMany({
            where: { status: { in: ['UNDER_REVIEW', 'APPROVED'] } },
            select: {
                id: true,
                employeeId: true,
                clearances: { select: { type: true, decision: true } },
            },
        });
        // derive pending = REQUIRED - APPROVED
        const pending = [];
        for (const r of resignations) {
            const approved = new Set(r.clearances.filter(c => c.decision === 'APPROVED').map(c => c.type));
            for (const t of REQUIRED) {
                if (!approved.has(t)) {
                    pending.push({ resignationId: r.id, employeeId: r.employeeId, type: t });
                }
            }
        }
        return pending; // e.g. [{ resignationId: 12, employeeId: 101, type: 'IT' }, ...]
    });
}
const clearanceStart = (r) => { var _a, _b, _c; return (_c = (_b = (_a = r.hrDecidedAt) !== null && _a !== void 0 ? _a : r.managerDecidedAt) !== null && _b !== void 0 ? _b : r.createdAt) !== null && _c !== void 0 ? _c : new Date(); };
function listPendingClearancesDetailed() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const resignations = yield prisma.resignationRequest.findMany({
            where: { status: { in: ['UNDER_REVIEW', 'APPROVED'] } },
            select: {
                id: true,
                employeeId: true,
                createdAt: true,
                managerDecidedAt: true,
                hrDecidedAt: true,
                employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } }, } },
                clearances: { select: { type: true, decision: true, verifierId: true, createdAt: true } }
            }
        });
        const now = new Date();
        const items = [];
        for (const r of resignations) {
            const approved = new Set(r.clearances.filter(c => c.decision === 'APPROVED').map(c => c.type));
            for (const type of REQUIRED) {
                if (approved.has(type))
                    continue; // already done
                const row = r.clearances.find(c => c.type === type); // may be undefined if you only store APPROVED
                const startAnchor = (_d = (_c = (_b = (_a = row === null || row === void 0 ? void 0 : row.createdAt) !== null && _a !== void 0 ? _a : r.hrDecidedAt) !== null && _b !== void 0 ? _b : r.managerDecidedAt) !== null && _c !== void 0 ? _c : r.createdAt) !== null && _d !== void 0 ? _d : now;
                items.push({
                    resignationId: r.id,
                    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
                    employeeCode: r.employee.employeeCode || undefined,
                    deptName: ((_e = r.employee.Department) === null || _e === void 0 ? void 0 : _e.name) || undefined,
                    type,
                    sinceDays: Math.max(0, (0, date_fns_1.differenceInCalendarDays)(now, startAnchor)),
                    verifierId: (_f = row === null || row === void 0 ? void 0 : row.verifierId) !== null && _f !== void 0 ? _f : null
                });
            }
        }
        return items;
    });
}
// function parseAud(aud?: string | null): { departmentId?: number[]; branchId?: number[] } | null {
//     if (!aud) return null;
//     try { return JSON.parse(aud); } catch { return null; }
// }
function buildManagerNameMap(ids) {
    return __awaiter(this, void 0, void 0, function* () {
        const unique = Array.from(new Set(ids.filter((x) => !!x)));
        if (!unique.length)
            return new Map();
        const mgrs = yield prisma.employee.findMany({
            where: { id: { in: unique } },
            select: { id: true, firstName: true, lastName: true },
        });
        return new Map(mgrs.map(m => [m.id, `${m.firstName} ${m.lastName}`]));
    });
}
