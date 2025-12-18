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
exports.updateLeaveType = exports.initLeaveEndSchedular = exports.getLeaveBalance = exports.getBlockedDates = exports.updateLeaveStatus = exports.getLeaveTypes = exports.createLeaveType = exports.getLeaveRequests = exports.createLeaveRequest = void 0;
exports.daysInclusive = daysInclusive;
exports.getLeaveDashboard = getLeaveDashboard;
exports.getWhoIsOnLeaveToday = getWhoIsOnLeaveToday;
exports.getWhoIsOnLeaveBuckets = getWhoIsOnLeaveBuckets;
exports.sendWhatsAppTemplate = sendWhatsAppTemplate;
// import { PrismaClient, LeaveStatus } from "@prisma/client";
const axios_1 = __importDefault(require("axios"));
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
const node_cron_1 = __importDefault(require("node-cron"));
const LEAVE_APPLY_TEMPLATE_ID = "890321";
const LEAVE_STATUS_TEMPLATE_ID = "909803";
// Create Leave Request
const createLeaveRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { employeeId, leaveTypeId, startDate, endDate, reason } = req.body;
        if (!employeeId || !leaveTypeId || !startDate || !endDate || !reason) {
            return res.status(400).json({ error: "All fields are required" });
        }
        const start = new Date(startDate);
        const leaveYear = start.getFullYear();
        const daysRequested = daysInclusive(start, new Date(endDate));
        // Fetch balance for that year & leave type
        const balance = yield prisma_1.prisma.employeeLeaveBalance.findFirst({
            where: {
                employeeId: employeeId,
                leaveTypeId: leaveTypeId,
                year: leaveYear,
            }
        });
        if (!balance) {
            return res.status(400).json({
                error: `Leave balance not configured for ${leaveYear}`
            });
        }
        const remaining = balance.totalAllowed - balance.used;
        if (daysRequested > remaining) {
            return res.status(400).json({
                error: `Insufficient balance. You have only ${remaining} days available for this leave type.`
            });
        }
        const leaveRequest = yield prisma_1.prisma.leaveRequest.create({
            data: {
                employeeId,
                leaveTypeId,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                reason,
            },
            include: {
                leaveType: true,
                employee: {
                    select: { firstName: true, lastName: true, employeeCode: true, reportingManager: true }
                }
            }
        });
        const name = [leaveRequest.employee.firstName, leaveRequest.employee.lastName].filter(Boolean).join(" ");
        const days = daysInclusive(leaveRequest.startDate, leaveRequest.endDate);
        const placeholders = [name, days, fmtDate(leaveRequest.startDate), fmtDate(leaveRequest.endDate)];
        // Try to send to the manager right here
        let notifyStatus = "skipped";
        let notifyError;
        let mgrPhone;
        const mgrId = (_a = leaveRequest === null || leaveRequest === void 0 ? void 0 : leaveRequest.employee) === null || _a === void 0 ? void 0 : _a.reportingManager;
        if (mgrId) {
            const manager = yield prisma_1.prisma.employee.findUnique({
                where: { id: mgrId },
                select: { phone: true, firstName: true, lastName: true }
            });
            mgrPhone = (_b = manager === null || manager === void 0 ? void 0 : manager.phone) !== null && _b !== void 0 ? _b : undefined;
            const name = [leaveRequest.employee.firstName, leaveRequest.employee.lastName]
                .filter(Boolean)
                .join(" ");
            const message = `${name} has applied for leave for ${days} day(s), from ${fmtDate(leaveRequest.startDate)} to ${fmtDate(leaveRequest.endDate)}. Please review and take the necessary action.`;
            yield (0, notifications_controller_1.createNotification)(mgrId, message);
        }
        if (mgrPhone) {
            try {
                yield sendWhatsAppTemplate({
                    to: formatPhoneNumber(mgrPhone),
                    templateId: LEAVE_APPLY_TEMPLATE_ID,
                    placeholders,
                });
                notifyStatus = "sent";
            }
            catch (e) {
                notifyStatus = "failed";
                notifyError = (e === null || e === void 0 ? void 0 : e.message) || "WhatsApp send failed";
                // log but do NOT fail the API just because notification failed
                console.error("WFH notify (manager) failed:", e);
            }
        }
        res.status(201).json(leaveRequest);
    }
    catch (error) {
        console.error("Error creating leave request:", error);
        res.status(500).json({ error: "Failed to create leave request" });
    }
});
exports.createLeaveRequest = createLeaveRequest;
// Get All Leave Requests (optional)
const getLeaveRequests = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leaves = yield prisma_1.prisma.leaveRequest.findMany({
            where: {
                status: "PENDING" // only approved leave requests
            },
            include: {
                leaveType: true,
                employee: {
                    include: {
                        Department: true, // Gives departmentId + department name
                        role: true,
                        designation: true, // Gives roleId + role name
                    }
                }
            },
            orderBy: { createdAt: "desc" }
        });
        res.json(leaves);
    }
    catch (error) {
        console.error("Error fetching leave requests:", error);
        res.status(500).json({ error: "Failed to fetch leave requests" });
    }
});
exports.getLeaveRequests = getLeaveRequests;
const createLeaveType = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: "Leave type name is required" });
        }
        const leaveType = yield prisma_1.prisma.leaveType.create({
            data: { name },
        });
        res.status(201).json(leaveType);
    }
    catch (error) {
        console.error("Error creating leave type:", error);
        res.status(500).json({ error: "Failed to create leave type" });
    }
});
exports.createLeaveType = createLeaveType;
// Get All Leave Types
const getLeaveTypes = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leaveTypes = yield prisma_1.prisma.leaveType.findMany({
            orderBy: { name: "asc" }
        });
        res.json(leaveTypes);
    }
    catch (error) {
        console.error("Error fetching leave types:", error);
        res.status(500).json({ error: "Failed to fetch leave types" });
    }
});
exports.getLeaveTypes = getLeaveTypes;
// export const updateLeaveStatus = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const { role, status, userId } = req.body;
//     // role = "MANAGER" or "HR"
//     if (!['MANAGER', 'HR'].includes(role)) {
//       return res.status(400).json({ error: 'Invalid role' });
//     }
//     if (!["Approved", "Declined"].includes(status)) {
//       return res.status(400).json({ error: "Invalid status value" });
//     }
//     const leave = await prisma.leaveRequest.findUnique({ where: { id: Number(id) } });
//     if (!leave) return res.status(404).json({ error: "Leave request not found" });
//     const data: any = {};
//     // --- Manager decision first ---
//     if (role === "MANAGER") {
//       if (leave.hodDecision !== "PENDING") {
//         return res.status(400).json({ error: "Manager already decided" });
//       }
//       data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//       data.hodDecidedAt = new Date();
//       if (data.hodDecision === "REJECTED") {
//         data.status = LeaveStatus.REJECTED;
//         data.declinedBy = userId;
//         data.declinedDate = new Date();
//       }
//     }
//     // --- HR decision second ---
//     else if (role === "HR") {
//       if (leave.hodDecision !== "APPROVED") {
//         return res.status(400).json({ error: "Manager approval required first" });
//       }
//       if (leave.hrDecision !== "PENDING") {
//         return res.status(400).json({ error: "HR already decided" });
//       }
//       data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//       data.hrDecidedAt = new Date();
//       if (data.hrDecision === "APPROVED") {
//         data.status = LeaveStatus.APPROVED;
//         data.approvedBy = userId;
//         data.approvedDate = new Date();
//         const leaveYear = leave.startDate.getFullYear();
//         const days = daysInclusive(leave.startDate, leave.endDate);
//         await prisma.employeeLeaveBalance.updateMany({
//           where: {
//             employeeId: leave.employeeId,
//             leaveTypeId: leave.leaveTypeId,
//             year: leaveYear
//           },
//           data: {
//             used: { increment: days }
//           }
//         });
//       } else {
//         data.status = LeaveStatus.REJECTED;
//         data.declinedBy = userId;
//         data.declinedDate = new Date();
//       }
//     }
//     const updatedLeave = await prisma.leaveRequest.update({
//       where: { id: Number(id) },
//       data,
//       include: { employee: true, leaveType: true },
//     });
//     // --- WhatsApp notify employee ---
//     const employee = updatedLeave.employee;
//     const employeePhone = formatPhoneNumber(employee?.phone || "");
//     const employeeName = [employee?.firstName, employee?.lastName].filter(Boolean).join(" ");
//     const days = daysInclusive(updatedLeave.startDate, updatedLeave.endDate);
//     const start = fmtDate(updatedLeave.startDate);
//     const end = fmtDate(updatedLeave.endDate);
//     const statusLabel =
//       updatedLeave.status === LeaveStatus.APPROVED ? "Approved" :
//         updatedLeave.status === LeaveStatus.REJECTED ? "Declined" : "Pending";
//     const message = `Your leave application for ${days} day(s), from ${start} to ${end}, has been ${statusLabel}. Please contact the concerned person for more details.`;
//     if(statusLabel === "Approved" || statusLabel === "Declined") {
//       await createNotification(updatedLeave.employeeId, message);
//     }
//     if (employeePhone && updatedLeave.status === "APPROVED" ||
//       (updatedLeave.status === "REJECTED" && (role === "HR" || role === "MANAGER"))) {
//       try {
//         await sendWhatsAppTemplate({
//           to: employeePhone,
//           templateId: LEAVE_STATUS_TEMPLATE_ID,
//           placeholders: [employeeName, days, start, end, statusLabel],
//         });
//       } catch (e: any) {
//         console.error("Leave status WA send failed:", e?.message || e);
//       }
//     }
//     res.json(updatedLeave);
//   } catch (error) {
//     console.error("Error updating leave status:", error);
//     res.status(500).json({ error: "Failed to update leave status" });
//   }
// };
const updateLeaveStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { role, status, userId } = req.body;
        // role = "REPORTING_MANAGER", "HR_MANAGER", "MANAGEMENT"
        if (!["Approved", "Declined"].includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }
        // Fetch leave with employee and department
        const leave = yield prisma_1.prisma.leaveRequest.findUnique({
            where: { id: Number(id) },
            include: {
                employee: {
                    include: {
                        Department: true
                    }
                }
            }
        });
        if (!leave)
            return res.status(404).json({ error: "Leave not found" });
        const emp = leave.employee;
        const roleId = emp.roleId; // 1=HR Manager, 2=Employee, 3=Reporting Manager, 4=Management
        const deptId = emp.departmentId; // HR department = 1
        const isHRDept = deptId === 1; // HR Employee or HR Manager
        const data = {};
        // ================================================================
        //  1️⃣ HR EMPLOYEE (dept = 1, roleId ≠ HR Manager)
        // ================================================================
        if (isHRDept && roleId !== 1) {
            // Only HR Manager can approve at Level 1
            if (role !== "HR_MANAGER") {
                return res.status(400).json({ error: "Only HR Manager can approve HR employees" });
            }
            data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
            data.hodDecidedAt = new Date();
            data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
            data.hrDecidedAt = new Date();
            data.status = status === "Approved" ? "APPROVED" : "REJECTED";
            if (status === "Declined") {
                data.declinedBy = userId;
                data.declinedDate = new Date();
                data.declineReason = req.body.declineReason || null;
            }
        }
        // ================================================================
        //  2️⃣ HR MANAGER (roleId = 1)
        // ================================================================
        else if (roleId === 1) {
            if (role !== "MANAGEMENT") {
                return res.status(400).json({ error: "Only Management can approve HR Manager leave" });
            }
            data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
            data.hodDecidedAt = new Date();
            // No HR step for HR Manager
            data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
            data.hrDecidedAt = new Date();
            data.status = status === "Approved" ? "APPROVED" : "REJECTED";
            if (status === "Declined") {
                data.declinedBy = userId;
                data.declinedDate = new Date();
                data.declineReason = req.body.declineReason || null;
            }
        }
        // ================================================================
        //  3️⃣ REPORTING MANAGERS (roleId = 3) AND HOD (same logic)
        //    Level 1 = Management
        //    Level 2 = HR Manager
        // ================================================================
        else if (roleId === 3 || roleId === 5 /* HOD role if exists */) {
            // Level 1: Management
            if (role === "MANAGEMENT") {
                data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
                data.hodDecidedAt = new Date();
                if (status === "Declined") {
                    data.status = "REJECTED";
                    data.declinedBy = userId;
                    data.declinedDate = new Date();
                    data.declineReason = req.body.declineReason || null;
                }
            }
            // Level 2: HR Manager
            else if (role === "HR_MANAGER") {
                if (leave.hodDecision !== "APPROVED") {
                    return res.status(400).json({ error: "Management approval required first" });
                }
                data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
                data.hrDecidedAt = new Date();
                data.status = status === "Approved" ? "APPROVED" : "REJECTED";
                if (status === "Declined") {
                    data.declinedBy = userId;
                    data.declinedDate = new Date();
                    data.declineReason = req.body.declineReason || null;
                }
            }
            else {
                return res.status(400).json({ error: "Invalid approver for Reporting Manager/HOD" });
            }
        }
        // ================================================================
        //  4️⃣ NORMAL EMPLOYEE (roleId = 2)
        //    Level 1 = Reporting Manager
        //    Level 2 = HR Manager
        // ================================================================
        else if (roleId === 2) {
            // Level 1: Reporting Manager
            if (role === "REPORTING_MANAGER") {
                data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
                data.hodDecidedAt = new Date();
                if (status === "Declined") {
                    data.status = "REJECTED";
                    data.declinedBy = userId;
                    data.declinedDate = new Date();
                    data.declineReason = req.body.declineReason || null;
                }
            }
            // Level 2: HR Manager
            else if (role === "HR_MANAGER") {
                if (leave.hodDecision !== "APPROVED") {
                    return res.status(400).json({ error: "Manager approval required first" });
                }
                data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
                data.hrDecidedAt = new Date();
                data.status = status === "Approved" ? "APPROVED" : "REJECTED";
                if (status === "Declined") {
                    data.declinedBy = userId;
                    data.declinedDate = new Date();
                    data.declineReason = req.body.declineReason || null;
                }
            }
            else {
                return res.status(400).json({ error: "Unauthorized approver" });
            }
        }
        // ================================================================
        //  SAVE UPDATED LEAVE & UPDATE BALANCES
        // ================================================================
        const updatedLeave = yield prisma_1.prisma.leaveRequest.update({
            where: { id: Number(id) },
            data,
            include: { employee: true, leaveType: true }
        });
        // If fully approved → deduct leave balance
        if (updatedLeave.status === "APPROVED") {
            const year = updatedLeave.startDate.getFullYear();
            const days = daysInclusive(updatedLeave.startDate, updatedLeave.endDate);
            yield prisma_1.prisma.employeeLeaveBalance.updateMany({
                where: {
                    employeeId: updatedLeave.employeeId,
                    leaveTypeId: updatedLeave.leaveTypeId,
                    year
                },
                data: {
                    used: { increment: days }
                }
            });
        }
        // Notifications (optional)
        const employeePhone = formatPhoneNumber(updatedLeave.employee.phone);
        const employeeName = `${updatedLeave.employee.firstName} ${updatedLeave.employee.lastName}`;
        const start = fmtDate(updatedLeave.startDate);
        const end = fmtDate(updatedLeave.endDate);
        const days = daysInclusive(updatedLeave.startDate, updatedLeave.endDate);
        const statusLabel = updatedLeave.status;
        yield (0, notifications_controller_1.createNotification)(updatedLeave.employeeId, `Your leave request from ${start} to ${end} (${days} days) has been ${statusLabel}.`);
        res.json(updatedLeave);
    }
    catch (error) {
        console.error("Error updating leave:", error);
        res.status(500).json({ error: "Failed to update leave" });
    }
});
exports.updateLeaveStatus = updateLeaveStatus;
const MS_PER_DAY = 86400000;
function daysInclusive(s, e) {
    const ss = new Date(s);
    ss.setHours(0, 0, 0, 0);
    const ee = new Date(e);
    ee.setHours(0, 0, 0, 0);
    return Math.floor((ee.getTime() - ss.getTime()) / MS_PER_DAY) + 1;
}
function getLeaveDashboard(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const employeeId = Number(req.params.id);
            const today = req.query.date ? new Date(String(req.query.date)) : new Date();
            const y = today.getFullYear();
            const yearStart = new Date(y, 0, 1);
            const yearEnd = new Date(y, 11, 31, 23, 59, 59);
            const monthStart = new Date(y, today.getMonth(), 1);
            const monthEnd = new Date(y, today.getMonth() + 1, 0, 23, 59, 59);
            // Entitlement for this year
            const policy = yield prisma_1.prisma.entitlementPolicy.findFirst({ where: { year: y } });
            const entitlement = (_a = policy === null || policy === void 0 ? void 0 : policy.leaveEntitlement) !== null && _a !== void 0 ? _a : 0;
            // Approved leave requests (clamped to year)
            const leaves = yield prisma_1.prisma.leaveRequest.findMany({
                where: {
                    employeeId,
                    status: 'APPROVED',
                    AND: [{ endDate: { gte: yearStart } }, { startDate: { lte: yearEnd } }],
                },
                select: { startDate: true, endDate: true }
            });
            const takenYtd = leaves.reduce((sum, r) => {
                const s = r.startDate < yearStart ? yearStart : r.startDate;
                const e = r.endDate > yearEnd ? yearEnd : r.endDate;
                return sum + daysInclusive(s, e);
            }, 0);
            const takenThisMonth = leaves.reduce((sum, r) => {
                // overlap with current month
                const s = r.startDate < monthStart ? monthStart : r.startDate;
                const e = r.endDate > monthEnd ? monthEnd : r.endDate;
                return e >= s ? sum + daysInclusive(s, e) : sum;
            }, 0);
            const remaining = Math.max(0, entitlement - takenYtd);
            res.json({ entitlement, takenYtd, takenThisMonth, remaining });
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: (e === null || e === void 0 ? void 0 : e.message) || 'Failed to compute dashboard' });
        }
    });
}
function getWhoIsOnLeaveToday(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const today = req.query.date ? new Date(String(req.query.date)) : new Date();
            const start = new Date(today);
            start.setHours(0, 0, 0, 0);
            const end = new Date(today);
            end.setHours(23, 59, 59, 999);
            const rows = yield prisma_1.prisma.leaveRequest.findMany({
                where: {
                    status: 'APPROVED',
                    startDate: { lte: end },
                    endDate: { gte: start },
                },
                select: {
                    employee: { select: { id: true, firstName: true, lastName: true, designation: true, photoUrl: true } },
                },
                orderBy: { startDate: 'asc' }
            });
            const people = rows.map(r => ({
                id: r.employee.id,
                name: `${r.employee.firstName} ${r.employee.lastName}`,
                title: r.employee.designation,
                photoUrl: r.employee.photoUrl || null
            }));
            res.json(people);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: (e === null || e === void 0 ? void 0 : e.message) || 'Failed to fetch today leave list' });
        }
    });
}
function atStartOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function atEndOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function startOfISOWeek(d) {
    const x = atStartOfDay(d);
    const day = x.getDay(); // 0 Sun..6 Sat
    const diff = (day === 0 ? -6 : 1 - day); // move to Monday
    x.setDate(x.getDate() + diff);
    return x;
}
function endOfISOWeek(d) {
    const s = startOfISOWeek(d);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    return atEndOfDay(e);
}
function startOfNextMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
}
function endOfNextMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 2, 0, 23, 59, 59, 999);
}
function overlaps(aStart, aEnd, bStart, bEnd) {
    return aEnd >= bStart && aStart <= bEnd;
}
function getWhoIsOnLeaveBuckets(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const base = req.query.date ? new Date(String(req.query.date)) : new Date();
            // Ranges
            const todayStart = atStartOfDay(base);
            const todayEnd = atEndOfDay(base);
            const weekStart = startOfISOWeek(base);
            const weekEnd = endOfISOWeek(base);
            const nextMonthStart = startOfNextMonth(base);
            const nextMonthEnd = endOfNextMonth(base);
            // Single fetch covering all ranges
            const minStart = weekStart; // earliest we care about
            const maxEnd = nextMonthEnd; // latest we care about
            const rows = yield prisma_1.prisma.leaveRequest.findMany({
                where: {
                    status: 'APPROVED',
                    AND: [
                        { endDate: { gte: minStart } }, // overlaps window
                        { startDate: { lte: maxEnd } }
                    ]
                },
                select: {
                    startDate: true,
                    endDate: true,
                    employee: {
                        select: { id: true, firstName: true, lastName: true, designation: true, photoUrl: true }
                    }
                },
                orderBy: { startDate: 'asc' }
            });
            // Buckets with precedence: today > thisWeek > nextMonth
            const today = [];
            const thisWeek = [];
            const nextMonth = [];
            // de-dupe per bucket (employee might have multiple requests)
            const seenToday = new Set();
            const seenWeek = new Set();
            const seenNext = new Set();
            for (const r of rows) {
                const s = new Date(r.startDate);
                const e = new Date(r.endDate);
                const designationName = (_b = (_a = r.employee.designation) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : 'Default';
                const person = {
                    id: r.employee.id,
                    name: `${r.employee.firstName} ${r.employee.lastName}`,
                    title: designationName,
                    photoUrl: r.employee.photoUrl || null,
                    startDate: new Date(r.startDate).toISOString(),
                    endDate: new Date(r.endDate).toISOString(),
                };
                if (overlaps(s, e, todayStart, todayEnd)) {
                    if (!seenToday.has(person.id)) {
                        today.push(person);
                        seenToday.add(person.id);
                    }
                    continue; // precedence
                }
                if (overlaps(s, e, weekStart, weekEnd)) {
                    if (!seenWeek.has(person.id)) {
                        thisWeek.push(person);
                        seenWeek.add(person.id);
                    }
                    continue;
                }
                if (overlaps(s, e, nextMonthStart, nextMonthEnd)) {
                    if (!seenNext.has(person.id)) {
                        nextMonth.push(person);
                        seenNext.add(person.id);
                    }
                }
            }
            res.json({ today, thisWeek, nextMonth });
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: (e === null || e === void 0 ? void 0 : e.message) || 'Failed to fetch leave buckets' });
        }
    });
}
function formatPhoneNumber(raw) {
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.startsWith("91"))
        return `+${digits}`;
    if (digits.startsWith("0"))
        return `+91${digits.slice(1)}`;
    if (digits.length === 10)
        return `+91${digits}`;
    if (digits.startsWith("+"))
        return digits;
    return `+${digits}`;
}
const TZ = "Asia/Kolkata";
const fmtDate = (d) => new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(d));
function atStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function sendWhatsAppTemplate(_a) {
    return __awaiter(this, arguments, void 0, function* ({ to, templateId, placeholders }) {
        var _b;
        const payload = {
            from: process.env.WHATSAPP_FROM_PHONE_NUMBER,
            to: formatPhoneNumber(to),
            type: "template",
            message: {
                templateid: templateId,
                placeholders: placeholders.map(String),
            },
        };
        const headers = {
            "Content-Type": "application/json",
            apikey: process.env.WHATSAPP_AUTH_TOKEN,
        };
        const url = process.env.WHATSAPP_API_URL;
        const resp = yield axios_1.default.post(url, payload, { headers });
        if (((_b = resp === null || resp === void 0 ? void 0 : resp.data) === null || _b === void 0 ? void 0 : _b.code) !== "200") {
            throw new Error(`WhatsApp send failed: ${JSON.stringify(resp.data)}`);
        }
        return resp.data;
    });
}
const getBlockedDates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const employeeId = Number(req.params.employeeId);
    const existing = yield prisma_1.prisma.leaveRequest.findMany({
        where: {
            employeeId,
            status: { in: ["APPROVED", "PENDING"] }
        },
        select: { startDate: true, endDate: true }
    });
    return res.json(existing);
});
exports.getBlockedDates = getBlockedDates;
const getLeaveBalance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        const year = Number(req.query.year) || new Date().getFullYear();
        const balances = yield prisma_1.prisma.employeeLeaveBalance.findMany({
            where: { employeeId, year, category: 'LEAVE' },
            include: { leaveType: true }
        });
        res.json(balances.map(b => {
            var _a, _b;
            return ({
                leaveTypeId: b.leaveTypeId,
                leaveType: (_b = (_a = b.leaveType) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
                totalAllowed: b.totalAllowed,
                used: b.used,
                remaining: b.totalAllowed - b.used,
                year: b.year
            });
        }));
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch leave balance" });
    }
});
exports.getLeaveBalance = getLeaveBalance;
const initLeaveEndSchedular = () => {
    node_cron_1.default.schedule("0 9 * * *", () => __awaiter(void 0, void 0, void 0, function* () {
        console.log("Running leave reminder cron...");
        const today = new Date();
        const leaves = yield prisma_1.prisma.leaveRequest.findMany({
            where: {
                status: "APPROVED",
                endDate: today
            },
            include: {
                employee: true,
                leaveType: true,
            }
        });
        for (const leave of leaves) {
            const start = new Date(leave.startDate);
            const end = new Date(leave.endDate);
            const duration = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            console.log(`Checking leave ID ${leave.id} for ${leave.employee.firstName}: ${fmtDate(start)} to ${fmtDate(end)} (${duration} days)`);
            // RULE: Only send if leave duration > 1 day
            if (duration <= 1)
                continue;
            // Last day check
            if (isSameDate(today, end)) {
                const emp = leave.employee;
                if (!emp.phone)
                    continue;
                const message = `Hello ${emp.firstName}, today is the *last day of your approved leave*. Please be prepared to report tomorrow.`;
                console.log(`Leave End Reminder to ${emp.firstName} (${emp.phone}): ${message}`);
                // await sendWhatsAppMessage(emp.phone, message);
            }
        }
    }));
};
exports.initLeaveEndSchedular = initLeaveEndSchedular;
function isSameDate(date1, date2) {
    return (date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate());
}
const updateLeaveType = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params; // leaveRequestId
        const { newLeaveTypeId } = req.body;
        if (!newLeaveTypeId) {
            return res.status(400).json({ error: "New leave type is required" });
        }
        const leave = yield prisma_1.prisma.leaveRequest.findUnique({
            where: { id: Number(id) },
            include: {
                employee: true,
                leaveType: true
            }
        });
        if (!leave) {
            return res.status(404).json({ error: "Leave request not found" });
        }
        // Optional safety: don't allow changing approved leave
        if (leave.status === "APPROVED") {
            return res.status(400).json({
                error: "Cannot change leave type after approval"
            });
        }
        if (leave.leaveTypeId === newLeaveTypeId) {
            return res.status(400).json({
                error: "New leave type is same as existing leave type"
            });
        }
        const newLeaveType = yield prisma_1.prisma.leaveType.findUnique({
            where: { id: Number(newLeaveTypeId) }
        });
        if (!newLeaveType) {
            return res.status(400).json({ error: "Invalid leave type" });
        }
        // Update leave type
        const updatedLeave = yield prisma_1.prisma.leaveRequest.update({
            where: { id: Number(id) },
            data: {
                leaveTypeId: Number(newLeaveTypeId),
                updatedAt: new Date()
            },
            include: {
                employee: true,
                leaveType: true
            }
        });
        const employee = updatedLeave.employee;
        const employeeName = `${employee.firstName} ${employee.lastName}`;
        const start = fmtDate(updatedLeave.startDate);
        const end = fmtDate(updatedLeave.endDate);
        // In-app notification
        const message = `Your leave type for the leave from ${start} to ${end} has been changed to "${newLeaveType.name}".`;
        yield (0, notifications_controller_1.createNotification)(employee.id, message);
        res.json({
            message: "Leave type updated successfully",
            leave: updatedLeave
        });
    }
    catch (error) {
        console.error("Error updating leave type:", error);
        res.status(500).json({ error: "Failed to update leave type" });
    }
});
exports.updateLeaveType = updateLeaveType;
