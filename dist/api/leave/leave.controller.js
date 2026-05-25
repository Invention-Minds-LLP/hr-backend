"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadPrescription = exports.triggerFYRollover = exports.purgeAndRerunFYRollover = exports.initFinancialYearRolloverCron = exports.bulkUploadLeaveBalancesExcel = exports.initNewJoineeLeaveAllocationCron = exports.initELAccrualCron = exports.triggerELAccrual = exports.getCompOffCredits = exports.getMonthlyCasualUsage = exports.updateLeaveType = exports.initLeaveEndScheduler = exports.getLeaveBalance = exports.getBlockedDates = exports.createLeaveBalances = exports.updateLeaveStatus = exports.getLeaveTypes = exports.createLeaveType = exports.getLeaveRequests = exports.cancelLeaveRequest = exports.updateLeaveRequest = exports.createLeaveRequest = void 0;
exports.daysInclusive = daysInclusive;
exports.countWorkingDays = countWorkingDays;
exports.getLeaveDashboard = getLeaveDashboard;
exports.getWhoIsOnLeaveToday = getWhoIsOnLeaveToday;
exports.getWhoIsOnLeaveBuckets = getWhoIsOnLeaveBuckets;
exports.sendWhatsAppTemplate = sendWhatsAppTemplate;
exports.computeTotalUsed = computeTotalUsed;
exports.getTouchedMonths = getTouchedMonths;
exports.insertLedgerTx = insertLedgerTx;
exports.getLastLedgerBalanceTx = getLastLedgerBalanceTx;
exports.getFinancialYear = getFinancialYear;
exports.getCalendarYear = getCalendarYear;
exports.runFYRollover = runFYRollover;
// import { PrismaClient, LeaveStatus } from "@prisma/client";
const axios_1 = __importDefault(require("axios"));
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
const node_cron_1 = __importDefault(require("node-cron"));
const client_1 = require("@prisma/client");
const formidable_1 = __importDefault(require("formidable"));
const XLSX = __importStar(require("xlsx"));
const p_limit_1 = __importDefault(require("p-limit"));
const fs_1 = __importDefault(require("fs"));
const basic_ftp_1 = require("basic-ftp");
const path_1 = __importDefault(require("path"));
const FTP_CONFIG = {
    host: (_a = process.env.FTP_HOST) !== null && _a !== void 0 ? _a : "",
    user: (_b = process.env.FTP_USER) !== null && _b !== void 0 ? _b : "",
    password: (_c = process.env.FTP_PASSWORD) !== null && _c !== void 0 ? _c : "",
    secure: false,
};
const LEAVE_APPLY_TEMPLATE_ID = "890321";
const LEAVE_STATUS_TEMPLATE_ID = "909803";
// Create Leave Request
const createLeaveRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { employeeId, leaveTypeId, startDate, endDate, reason, isHalfDay, halfDaySession } = req.body;
        if (!employeeId || !leaveTypeId || !startDate || !endDate || !reason) {
            return res.status(400).json({ error: "All fields are required" });
        }
        const start = new Date(startDate);
        const year = getFinancialYear(start);
        // const leaveYear = getFinancialYear(start);
        // const daysRequested = daysInclusive(start, new Date(endDate));
        const end = new Date(endDate);
        if (end < start)
            return res.status(400).json({ error: "endDate cannot be before startDate" });
        // validate leave type exists
        const lt = yield prisma_1.prisma.leaveType.findUnique({ where: { id: Number(leaveTypeId) } });
        if (!lt)
            return res.status(400).json({ error: "Invalid leave type" });
        if (lt.name === "CO" && isHalfDay) {
            return res.status(400).json({ error: "Half-day not allowed for CO" });
        }
        // ── Rule A: one leave TYPE per ISO week ──────────────────────────
        // If the employee already has a PENDING/APPROVED leave of a DIFFERENT
        // type touching any week of this request, block it. (RH / CO exempt.)
        const weeklyClash = yield findWeeklyTypeConflict(Number(employeeId), Number(leaveTypeId), lt.name, start, end);
        if (weeklyClash) {
            const wkLabel = startOfISOWeek(new Date(weeklyClash.startDate))
                .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            return res.status(400).json({
                error: `You already have a ${weeklyClash.leaveType.name} leave in the week of ${wkLabel}. `
                    + `Only one leave type is allowed per week — please use ${weeklyClash.leaveType.name} for these dates `
                    + `or pick dates in a different week.`,
            });
        }
        // Fetch balance for that year & leave type
        const balance = yield prisma_1.prisma.employeeLeaveBalance.findFirst({
            where: {
                employeeId: employeeId,
                leaveTypeId: leaveTypeId,
                year: year,
            }
        });
        // Allow advance applications for the next FY when rollover hasn't run yet
        // (e.g., applying for April leave while still in March)
        const currentFY = getFinancialYear(new Date());
        // const isAdvanceNextFY = !balance && year === currentFY + 1;
        if (!balance && (lt.name !== "CO" && lt.name !== "RH")) {
            return res.status(400).json({
                error: `Leave balance not configured for ${year}`
            });
        }
        // const year = start.getFullYear();
        // EL counts week-offs that fall inside the range (sandwich rule).
        const isEarnedLeave = lt.name === "EL";
        const requestedUnits = isHalfDay
            ? 0.5
            : yield countWorkingDays(employeeId, start, end, { includeWeekOffs: isEarnedLeave });
        if (isHalfDay && !isSameDate(new Date(startDate), new Date(endDate))) {
            return res.status(400).json({ error: "Half-day must be a single date" });
        }
        if (isHalfDay && !halfDaySession) {
            return res.status(400).json({ error: "halfDaySession is required for half-day" });
        }
        if (lt.name === "CL" && requestedUnits > 2) {
            return res.status(400).json({
                error: "Casual Leave (CL) can be applied for a maximum of 2 days at a time",
            });
        }
        // ── RH (Restricted Holiday) validations ───────────────────────────────
        if (lt.name === "RH") {
            // RH must be exactly 1 day
            if (requestedUnits > 1) {
                return res.status(400).json({ error: "RH can only be applied for 1 day at a time" });
            }
            // RH date must fall on an optional holiday
            // The start date from frontend is IST midnight in UTC (e.g. 2026-04-02T18:30:00Z for April 3rd IST)
            // Holiday dates are stored as UTC midnight (e.g. 2026-04-03T00:00:00Z)
            // So we need to check a window around the start date to account for timezone
            const rhDateStart = new Date(start.getTime() - 6 * 60 * 60 * 1000); // -6 hours buffer
            const rhDateEnd = new Date(start.getTime() + 24 * 60 * 60 * 1000); // +24 hours buffer
            const optionalHoliday = yield prisma_1.prisma.holiday.findFirst({
                where: {
                    isOptional: true,
                    date: {
                        gte: rhDateStart,
                        lt: rhDateEnd,
                    },
                },
            });
            if (!optionalHoliday) {
                return res.status(400).json({
                    error: "RH can only be applied on a Restricted Holiday (optional holiday) date",
                });
            }
            // Max 2 RH allowed per financial year (out of available optional holidays)
            const MAX_RH_PER_YEAR = 2;
            const rhUsedCount = yield prisma_1.prisma.leaveRequest.count({
                where: {
                    employeeId: Number(employeeId),
                    leaveTypeId: Number(leaveTypeId),
                    status: { in: ["PENDING", "APPROVED"] },
                    startDate: { gte: new Date(Date.UTC(year, 3, 1)) },
                    endDate: { lt: new Date(Date.UTC(year + 1, 3, 1)) },
                },
            });
            if (rhUsedCount >= MAX_RH_PER_YEAR) {
                return res.status(400).json({
                    error: `Maximum ${MAX_RH_PER_YEAR} Restricted Holidays allowed per financial year. You have already used ${rhUsedCount}.`,
                });
            }
        }
        if (lt.name !== "CO" && lt.name !== "RH") {
            const bal = yield getBalance(Number(employeeId), Number(leaveTypeId), year);
            if (!bal)
                return res.status(400).json({ error: `Leave balance not configured for ${year}` });
            const totalUsed = computeTotalUsed(bal);
            const remaining = ((_a = bal.totalAllowed) !== null && _a !== void 0 ? _a : 0) - totalUsed;
            if (requestedUnits > remaining) {
                return res.status(400).json({
                    error: `Insufficient balance. Available: ${remaining}, requested: ${requestedUnits}`
                });
            }
        }
        const leaveRequest = yield prisma_1.prisma.leaveRequest.create({
            data: {
                employeeId,
                leaveTypeId,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                reason,
                isHalfDay,
                halfDaySession
            },
            include: {
                leaveType: true,
                employee: {
                    select: { firstName: true, lastName: true, employeeCode: true, reportingManager: true, inchargeId: true, departmentId: true }
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
        const emp = leaveRequest.employee;
        const notifyTo = (_b = emp.inchargeId) !== null && _b !== void 0 ? _b : emp.reportingManager;
        const mgrId = (_c = leaveRequest === null || leaveRequest === void 0 ? void 0 : leaveRequest.employee) === null || _c === void 0 ? void 0 : _c.reportingManager;
        // if (mgrId) {
        //   const manager = await prisma.employee.findUnique({
        //     where: { id: mgrId },
        //     select: { phone: true, firstName: true, lastName: true }
        //   });
        //   mgrPhone = manager?.phone ?? undefined;
        //   const name = [leaveRequest.employee.firstName, leaveRequest.employee.lastName]
        //     .filter(Boolean)
        //     .join(" ");
        //   const message = `${name} has applied for leave for ${days} day(s), from ${fmtDate(
        //     leaveRequest.startDate
        //   )} to ${fmtDate(leaveRequest.endDate)}. Please review and take the necessary action.`;
        //   await createNotification(mgrId, message);
        // }
        // if (mgrPhone) {
        //   try {
        //     await sendWhatsAppTemplate({
        //       to: formatPhoneNumber(mgrPhone),
        //       templateId: LEAVE_APPLY_TEMPLATE_ID,
        //       placeholders,
        //     });
        //     notifyStatus = "sent";
        //   } catch (e: any) {
        //     notifyStatus = "failed";
        //     notifyError = e?.message || "WhatsApp send failed";
        //     // log but do NOT fail the API just because notification failed
        //     console.error("WFH notify (manager) failed:", e);
        //   }
        // }
        const recipients = new Set();
        // If employee is HR (dept 1)
        if (emp.departmentId === 1) {
            if (emp.reportingManager) {
                recipients.add(emp.reportingManager);
            }
        }
        else {
            // Normal employee
            if (emp.inchargeId) {
                recipients.add(emp.inchargeId);
            }
            if (emp.reportingManager) {
                recipients.add(emp.reportingManager);
            }
            // Add HR managers (dept 1)
            const hrManagers = yield prisma_1.prisma.employee.findMany({
                where: {
                    departmentId: 1,
                    employmentStatus: "ACTIVE"
                },
                select: { id: true }
            });
            hrManagers.forEach(hr => recipients.add(hr.id));
        }
        // const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ");
        const message = `${name} has applied for leave for ${days} day(s), from ${fmtDate(leaveRequest.startDate)} to ${fmtDate(leaveRequest.endDate)}. Please review and take action.`;
        for (const id of recipients) {
            yield (0, notifications_controller_1.createNotification)(id, message);
        }
        if (notifyTo) {
            const approver = yield prisma_1.prisma.employee.findUnique({
                where: { id: notifyTo },
                select: { phone: true }
            });
            const name = [leaveRequest.employee.firstName, leaveRequest.employee.lastName]
                .filter(Boolean)
                .join(" ");
            // const message = `${name} has applied for leave for ${days} day(s), from ${fmtDate(
            //   leaveRequest.startDate
            // )} to ${fmtDate(leaveRequest.endDate)}. Please review and take the necessary action.`;
            // await createNotification(notifyTo, message);
            // if (approver?.phone) {
            //   await sendWhatsAppTemplate({
            //     to: formatPhoneNumber(approver.phone),
            //     templateId: LEAVE_APPLY_TEMPLATE_ID,
            //     placeholders,
            //   });
            // }
        }
        res.status(201).json(leaveRequest);
    }
    catch (error) {
        console.error("Error creating leave request:", error);
        res.status(500).json({ error: "Failed to create leave request" });
    }
});
exports.createLeaveRequest = createLeaveRequest;
// ─────────────────────────────────────────────────────────────────
// EDIT a pending leave request
// Only allowed when no approver (incharge / RM/HOD / HR) has acted yet,
// AND the overall status is still PENDING.
// ─────────────────────────────────────────────────────────────────
const updateLeaveRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const id = Number(req.params.id);
        const { startDate, endDate, reason, isHalfDay, halfDaySession, leaveTypeId } = req.body;
        const userId = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        const existing = yield prisma_1.prisma.leaveRequest.findUnique({ where: { id } });
        if (!existing)
            return res.status(404).json({ error: "Leave request not found" });
        // Only the owner may edit
        if (userId && existing.employeeId !== Number(userId)) {
            return res.status(403).json({ error: "You can only edit your own leave request" });
        }
        // Block edit once any approver has acted
        if (existing.status !== "PENDING") {
            return res.status(400).json({ error: `Cannot edit a ${existing.status.toLowerCase()} leave request` });
        }
        if (existing.inChargeDecision !== "PENDING" ||
            existing.hodDecision !== "PENDING" ||
            existing.hrDecision !== "PENDING") {
            return res.status(400).json({ error: "Cannot edit — at least one approver has already acted" });
        }
        // Build a partial update payload; only include fields the user actually sent
        const data = { updatedAt: new Date() };
        if (startDate)
            data.startDate = new Date(startDate);
        if (endDate)
            data.endDate = new Date(endDate);
        if (reason !== undefined)
            data.reason = reason;
        if (isHalfDay !== undefined)
            data.isHalfDay = !!isHalfDay;
        if (halfDaySession !== undefined)
            data.halfDaySession = halfDaySession;
        if (leaveTypeId)
            data.leaveTypeId = Number(leaveTypeId);
        if (data.startDate && data.endDate && data.endDate < data.startDate) {
            return res.status(400).json({ error: "endDate cannot be before startDate" });
        }
        const updated = yield prisma_1.prisma.leaveRequest.update({ where: { id }, data });
        return res.json(updated);
    }
    catch (err) {
        console.error("Error updating leave request:", err);
        return res.status(500).json({ error: err.message || "Failed to update leave request" });
    }
});
exports.updateLeaveRequest = updateLeaveRequest;
// ─────────────────────────────────────────────────────────────────
// CANCEL a pending leave request
// Same rule as edit — disallowed once any approver has acted.
// ─────────────────────────────────────────────────────────────────
const cancelLeaveRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const id = Number(req.params.id);
        const { reason } = (_a = req.body) !== null && _a !== void 0 ? _a : {};
        const userId = (_c = (_b = req.user) === null || _b === void 0 ? void 0 : _b.empId) !== null && _c !== void 0 ? _c : null;
        const existing = yield prisma_1.prisma.leaveRequest.findUnique({
            where: { id },
            include: {
                leaveType: true,
                employee: {
                    select: {
                        firstName: true, lastName: true, employeeCode: true,
                        reportingManager: true, inchargeId: true, departmentId: true,
                    },
                },
            },
        });
        if (!existing)
            return res.status(404).json({ error: "Leave request not found" });
        if (userId && existing.employeeId !== Number(userId)) {
            return res.status(403).json({ error: "You can only cancel your own leave request" });
        }
        if (existing.status === "CANCELLED") {
            return res.status(400).json({ error: "Already cancelled" });
        }
        if (existing.status !== "PENDING" ||
            existing.inChargeDecision !== "PENDING" ||
            existing.hodDecision !== "PENDING" ||
            existing.hrDecision !== "PENDING") {
            return res.status(400).json({ error: "Cannot cancel — request has already been actioned" });
        }
        const updated = yield prisma_1.prisma.leaveRequest.update({
            where: { id },
            data: {
                status: "CANCELLED",
                cancelledAt: new Date(),
                cancelledBy: userId ? Number(userId) : null,
                cancellationReason: reason !== null && reason !== void 0 ? reason : "Cancelled by employee",
            },
        });
        // ── Notify the same people who were notified on creation ────────
        const emp = existing.employee;
        const recipients = new Set();
        if (emp.departmentId === 1) {
            // HR employee → only their reporting manager
            if (emp.reportingManager)
                recipients.add(emp.reportingManager);
        }
        else {
            if (emp.inchargeId)
                recipients.add(emp.inchargeId);
            if (emp.reportingManager)
                recipients.add(emp.reportingManager);
            const hrManagers = yield prisma_1.prisma.employee.findMany({
                where: { departmentId: 1, employmentStatus: "ACTIVE" },
                select: { id: true },
            });
            hrManagers.forEach((hr) => recipients.add(hr.id));
        }
        const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ");
        const days = daysInclusive(existing.startDate, existing.endDate);
        const message = `${name} has CANCELLED their ${(_e = (_d = existing.leaveType) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "leave"} request for ${days} day(s), ` +
            `from ${fmtDate(existing.startDate)} to ${fmtDate(existing.endDate)}. ` +
            `Reason: ${reason !== null && reason !== void 0 ? reason : "Cancelled by employee"}.`;
        for (const rid of recipients) {
            try {
                yield (0, notifications_controller_1.createNotification)(rid, message);
            }
            catch (notifyErr) {
                console.error(`Failed to notify recipient ${rid}:`, notifyErr);
                // Don't fail the cancellation if notification delivery fails
            }
        }
        return res.json(updated);
    }
    catch (err) {
        console.error("Error cancelling leave request:", err);
        return res.status(500).json({ error: err.message || "Failed to cancel leave request" });
    }
});
exports.cancelLeaveRequest = cancelLeaveRequest;
// Get All Leave Requests (optional)
const getLeaveRequests = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leaves = yield prisma_1.prisma.leaveRequest.findMany({
            select: {
                id: true,
                status: true,
                startDate: true,
                endDate: true,
                reason: true,
                declineReason: true,
                hodDecision: true,
                hrDecision: true,
                inChargeDecision: true,
                createdAt: true,
                isHalfDay: true,
                halfDaySession: true,
                prescriptionUrl: true,
                leaveType: {
                    select: {
                        name: true,
                    },
                },
                employee: {
                    select: {
                        id: true,
                        employeeCode: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        departmentId: true,
                        reportingManager: true,
                        inchargeId: true,
                        roleId: true,
                        gender: true,
                        photoUrl: true,
                        designation: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        res.json(leaves);
    }
    catch (error) {
        console.error('Error fetching leave requests:', error);
        res.status(500).json({ error: 'Failed to fetch leave requests' });
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
//     // role = "REPORTING_MANAGER", "HR_MANAGER", "MANAGEMENT"
//     if (!["Approved", "Declined"].includes(status)) {
//       return res.status(400).json({ error: "Invalid status" });
//     }
//     // Fetch leave with employee and department
//     const leave = await prisma.leaveRequest.findUnique({
//       where: { id: Number(id) },
//       include: {
//         employee: {
//           include: {
//             Department: true
//           }
//         }
//       }
//     });
//     if (!leave) return res.status(404).json({ error: "Leave not found" });
//     const emp = leave.employee;
//     const roleId = emp.roleId;               // 1=HR Manager, 2=Employee, 3=Reporting Manager, 4=Management
//     const deptId = emp.departmentId;         // HR department = 1
//     const isHRDept = deptId === 1;           // HR Employee or HR Manager
//     const hasIncharge = !!emp.inchargeId;
//     const approved = status === "Approved";
//     const data: any = {};
//     /* ================================================================
//   NEW INCHARGE LEVEL (ONLY IF EXISTS)
// ================================================================ */
//     if (hasIncharge && role === "INCHARGE") {
//       data.inChargeDecision = approved ? "APPROVED" : "REJECTED";
//       data.inChargeDecidedAt = new Date();
//       if (!approved) {
//         data.status = "REJECTED";
//         data.declinedBy = userId;
//         data.declinedDate = new Date();
//         data.declineReason = req.body.declineReason || null;
//       }
//       const updated = await prisma.leaveRequest.update({
//         where: { id: Number(id) },
//         data
//       });
//       return res.json(updated);
//     }
//     /* ================================================================
//         BLOCK OTHERS IF INCHARGE EXISTS & NOT APPROVED YET
//     ================================================================ */
//     if (hasIncharge && leave.inChargeDecision !== "APPROVED") {
//       return res.status(400).json({
//         error: "Incharge approval required first"
//       });
//     }
//     // ================================================================
//     //   HR EMPLOYEE (dept = 1, roleId ≠ HR Manager)
//     // ================================================================
//     if (isHRDept && roleId !== 1) {
//       // Only HR Manager can approve at Level 1
//       if (role !== "HR_MANAGER") {
//         return res.status(400).json({ error: "Only HR Manager can approve HR employees" });
//       }
//       data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//       data.hodDecidedAt = new Date();
//       data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//       data.hrDecidedAt = new Date();
//       data.status = status === "Approved" ? "APPROVED" : "REJECTED";
//       if (status === "Declined") {
//         data.declinedBy = userId;
//         data.declinedDate = new Date();
//         data.declineReason = req.body.declineReason || null;
//       }
//     }
//     // ================================================================
//     //   HR MANAGER (roleId = 1)
//     // ================================================================
//     else if (roleId === 1) {
//       if (role !== "MANAGEMENT") {
//         return res.status(400).json({ error: "Only Management can approve HR Manager leave" });
//       }
//       data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//       data.hodDecidedAt = new Date();
//       // No HR step for HR Manager
//       data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//       data.hrDecidedAt = new Date();
//       data.status = status === "Approved" ? "APPROVED" : "REJECTED";
//       if (status === "Declined") {
//         data.declinedBy = userId;
//         data.declinedDate = new Date();
//         data.declineReason = req.body.declineReason || null;
//       }
//     }
//     // ================================================================
//     //   REPORTING MANAGERS (roleId = 3) AND HOD (same logic)
//     //    Level 1 = Management
//     //    Level 2 = HR Manager
//     // ================================================================
//     else if (roleId === 3 || roleId === 5 /* HOD role if exists */) {
//       // Level 1: Management
//       if (role === "MANAGEMENT") {
//         data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//         data.hodDecidedAt = new Date();
//         if (status === "Declined") {
//           data.status = "REJECTED";
//           data.declinedBy = userId;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//       }
//       // Level 2: HR Manager
//       else if (role === "HR_MANAGER") {
//         if (leave.hodDecision !== "APPROVED") {
//           return res.status(400).json({ error: "Management approval required first" });
//         }
//         data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//         data.hrDecidedAt = new Date();
//         data.status = status === "Approved" ? "APPROVED" : "REJECTED";
//         if (status === "Declined") {
//           data.declinedBy = userId;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//       }
//       else {
//         return res.status(400).json({ error: "Invalid approver for Reporting Manager/HOD" });
//       }
//     }
//     // ================================================================
//     //   NORMAL EMPLOYEE (roleId = 2)
//     //    Level 1 = Reporting Manager
//     //    Level 2 = HR Manager
//     // ================================================================
//     else if (roleId === 2) {
//       // Level 1: Reporting Manager
//       if (role === "REPORTING_MANAGER") {
//         data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//         data.hodDecidedAt = new Date();
//         if (status === "Declined") {
//           data.status = "REJECTED";
//           data.declinedBy = userId;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//       }
//       // Level 2: HR Manager
//       else if (role === "HR_MANAGER") {
//         if (leave.hodDecision !== "APPROVED") {
//           return res.status(400).json({ error: "Manager approval required first" });
//         }
//         data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//         data.hrDecidedAt = new Date();
//         data.status = status === "Approved" ? "APPROVED" : "REJECTED";
//         if (status === "Declined") {
//           data.declinedBy = userId;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//       }
//       else {
//         return res.status(400).json({ error: "Unauthorized approver" });
//       }
//     }
//     // ================================================================
//     //  SAVE UPDATED LEAVE & UPDATE BALANCES
//     // ================================================================
//     const updatedLeave = await prisma.leaveRequest.update({
//       where: { id: Number(id) },
//       data,
//       include: { employee: true, leaveType: true }
//     });
//     console.log("Updated Leave:", updatedLeave);
//     // If fully approved → deduct leave balance
//     if (updatedLeave.status === "APPROVED") {
//       if (updatedLeave.leaveType.name === "CO") {
//         const today = new Date();
//         today.setHours(0, 0, 0, 0);
//         // Always full day for CO
//         const requiredDays = daysInclusive(
//           updatedLeave.startDate,
//           updatedLeave.endDate
//         );
//         // Fetch valid credits (earliest expiry first)
//         const credits = await prisma.compOffCredit.findMany({
//           where: {
//             employeeId: updatedLeave.employeeId,
//             used: false,
//             expiryDate: { gte: today }
//           },
//           orderBy: {
//             expiryDate: "asc"
//           }
//         });
//         if (credits.length < requiredDays) {
//           throw new Error("Not enough comp-off credits");
//         }
//         const toUse = credits.slice(0, requiredDays);
//         for (const credit of toUse) {
//           await prisma.compOffCredit.update({
//             where: { id: credit.id },
//             data: {
//               used: true,
//               usedOn: new Date(),
//               leaveId: updatedLeave.id
//             }
//           });
//         }
//       }
//       if (updatedLeave.leaveType.name !== "CO") {
//         const year = updatedLeave.startDate.getFullYear();
//         if (updatedLeave.isHalfDay) {
//           await prisma.employeeLeaveBalance.updateMany({
//             where: {
//               employeeId: updatedLeave.employeeId,
//               leaveTypeId: updatedLeave.leaveTypeId,
//               year
//             },
//             data: {
//               halfDayUsed: { increment: 1 }
//             }
//           });
//         } else {
//           const days = daysInclusive(updatedLeave.startDate, updatedLeave.endDate);
//           await prisma.employeeLeaveBalance.updateMany({
//             where: {
//               employeeId: updatedLeave.employeeId,
//               leaveTypeId: updatedLeave.leaveTypeId,
//               year
//             },
//             data: {
//               used: { increment: days }
//             }
//           });
//         }
//       }
//     }
//     // Notifications (optional)
//     const employeePhone = formatPhoneNumber(updatedLeave.employee.phone);
//     const employeeName = `${updatedLeave.employee.firstName} ${updatedLeave.employee.lastName}`;
//     const start = fmtDate(updatedLeave.startDate);
//     const end = fmtDate(updatedLeave.endDate);
//     const days = daysInclusive(updatedLeave.startDate, updatedLeave.endDate);
//     const statusLabel = updatedLeave.status;
//     // await createNotification(
//     //   updatedLeave.employeeId,
//     //   `Your leave request from ${start} to ${end} (${days} days) has been ${statusLabel}.`
//     // );
//     res.json(updatedLeave);
//   } catch (error) {
//     console.error("Error updating leave:", error);
//     res.status(500).json({ error: "Failed to update leave" });
//   }
// };
// export const createLeaveBalances = async (req: Request, res: Response) => {
//   try {
//     const { employeeId, year, leaves = [], permissions = [] } = req.body;
//     if (!employeeId || !year) {
//       return res.status(400).json({ error: "employeeId and year are required" });
//     }
//     const rows: any[] = [];
//     // LEAVES
//     for (const l of leaves) {
//       rows.push({
//         employeeId,
//         leaveTypeId: l.leaveTypeId,
//         permissionType: null,
//         category: "LEAVE",
//         year,
//         totalAllowed: l.totalAllowed,
//         used: 0
//       });
//     }
//     // PERMISSIONS
//     for (const p of permissions) {
//       rows.push({
//         employeeId,
//         leaveTypeId: null,
//         permissionType: p.permissionType,
//         category: "PERMISSION",
//         year,
//         totalAllowed: p.totalAllowed,
//         used: 0
//       });
//     }
//     // Upsert to avoid duplicates
//     for (const row of rows) {
//       await prisma.employeeLeaveBalance.upsert({
//         where: {
//           employeeId_leaveTypeId_permissionType_year: {
//             employeeId: row.employeeId,
//             leaveTypeId: row.leaveTypeId,
//             permissionType: row.permissionType,
//             year: row.year
//           }
//         },
//         update: {
//           totalAllowed: row.totalAllowed
//         },
//         create: row
//       });
//     }
//     res.json({ message: "Leave balances saved successfully" });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to create leave balances" });
//   }
// };
// export const createLeaveBalances = async (req: Request, res: Response) => {
//   try {
//     const { employeeId, year, leaves = [], permissions = [] } = req.body;
//     if (!employeeId || !year) {
//       return res.status(400).json({ error: "employeeId and year are required" });
//     }
//     const rows: any[] = [];
//     // LEAVES
//     for (const l of leaves) {
//       rows.push({
//         employeeId,
//         leaveTypeId: l.leaveTypeId,
//         permissionType: null,
//         category: "LEAVE",
//         year,
//         totalAllowed: l.totalAllowed,
//         used: l.used ?? 0 // ✅ IMPORTANT
//       });
//     }
//     // PERMISSIONS
//     for (const p of permissions) {
//       rows.push({
//         employeeId,
//         leaveTypeId: null,
//         permissionType: p.permissionType,
//         category: "PERMISSION",
//         year,
//         totalAllowed: p.totalAllowed,
//         used: p.used ?? 0 // ✅ IMPORTANT
//       });
//     }
//     for (const row of rows) {
//       await prisma.employeeLeaveBalance.upsert({
//         where: {
//           employeeId_leaveTypeId_permissionType_year: {
//             employeeId: row.employeeId,
//             leaveTypeId: row.leaveTypeId,
//             permissionType: row.permissionType,
//             year: row.year
//           }
//         },
//         update: {
//           totalAllowed: row.totalAllowed,
//           used: row.used // ✅ UPDATE USED
//         },
//         create: row
//       });
//     }
//     res.json({ message: "Leave balances saved successfully" });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to create leave balances" });
//   }
// };
// export const updateLeaveStatus = async (req: Request, res: Response) => {
//   try {
//     const leaveId = Number(req.params.id);
//     const { role, status, userId } = req.body as {
//       role: "INCHARGE" | "REPORTING_MANAGER" | "HR_MANAGER" | "MANAGEMENT";
//       status: "Approved" | "Declined";
//       userId?: number;
//       declineReason?: string;
//     };
//     if (!leaveId || !role || !status) {
//       return res.status(400).json({ error: "id, role, status are required" });
//     }
//     if (!["Approved", "Declined"].includes(status)) {
//       return res.status(400).json({ error: "Invalid status" });
//     }
//     const approved = status === "Approved";
//     const result = await prisma.$transaction(async (tx: Tx) => {
//       const leave = await tx.leaveRequest.findUnique({
//         where: { id: leaveId },
//         include: {
//           leaveType: true,
//           employee: true,
//         },
//       });
//       if (!leave) {
//         return { kind: "ERR" as const, status: 404, body: { error: "Leave not found" } };
//       }
//       // Already final? (optional hard guard)
//       if (leave.status === "APPROVED" || leave.status === "REJECTED") {
//         return { kind: "ERR" as const, status: 400, body: { error: "Leave already finalized" } };
//       }
//       const emp = leave.employee;
//       const roleId = emp.roleId; // your mapping
//       const deptId = emp.departmentId;
//       const isHRDept = deptId === 1;
//       const hasIncharge = !!emp.inchargeId;
//       const data: any = {};
//       // --------------------------
//       // INCHARGE LEVEL (if exists)
//       // --------------------------
//       if (hasIncharge && role === "INCHARGE") {
//         data.inChargeDecision = approved ? "APPROVED" : "REJECTED";
//         data.inChargeDecidedAt = new Date();
//         if (!approved) {
//           data.status = "REJECTED";
//           data.declinedBy = userId ?? null;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//         const updated = await tx.leaveRequest.update({
//           where: { id: leaveId },
//           data,
//           include: { leaveType: true, employee: true },
//         });
//         return { kind: "OK" as const, status: 200, body: updated };
//       }
//       // If incharge exists, block others until incharge approves
//       if (hasIncharge && leave.inChargeDecision !== "APPROVED") {
//         return {
//           kind: "ERR" as const,
//           status: 400,
//           body: { error: "Incharge approval required first" },
//         };
//       }
//       // ================================================================
//       // HR EMPLOYEE (dept = 1, roleId ≠ HR Manager)
//       // Level1: HR_MANAGER only. Direct final.
//       // ================================================================
//       if (isHRDept && roleId !== 1) {
//         if (role !== "HR_MANAGER") {
//           return {
//             kind: "ERR" as const,
//             status: 400,
//             body: { error: "Only HR Manager can approve HR employees" },
//           };
//         }
//         data.hodDecision = approved ? "APPROVED" : "REJECTED";
//         data.hodDecidedAt = new Date();
//         data.hrDecision = approved ? "APPROVED" : "REJECTED";
//         data.hrDecidedAt = new Date();
//         data.status = approved ? "APPROVED" : "REJECTED";
//         if (!approved) {
//           data.declinedBy = userId ?? null;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//       }
//       // ================================================================
//       // HR MANAGER (roleId = 1)
//       // Level1: MANAGEMENT only. Direct final.
//       // ================================================================
//       else if (roleId === 1) {
//         if (role !== "MANAGEMENT") {
//           return {
//             kind: "ERR" as const,
//             status: 400,
//             body: { error: "Only Management can approve HR Manager leave" },
//           };
//         }
//         data.hodDecision = approved ? "APPROVED" : "REJECTED";
//         data.hodDecidedAt = new Date();
//         data.hrDecision = approved ? "APPROVED" : "REJECTED";
//         data.hrDecidedAt = new Date();
//         data.status = approved ? "APPROVED" : "REJECTED";
//         if (!approved) {
//           data.declinedBy = userId ?? null;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//       }
//       // ================================================================
//       // REPORTING MANAGER / HOD (roleId = 3 or 5)
//       // Level1: MANAGEMENT
//       // Level2: HR_MANAGER
//       // ================================================================
//       else if (roleId === 3 || roleId === 5) {
//         if (role === "MANAGEMENT") {
//           data.hodDecision = approved ? "APPROVED" : "REJECTED";
//           data.hodDecidedAt = new Date();
//           if (!approved) {
//             data.status = "REJECTED";
//             data.declinedBy = userId ?? null;
//             data.declinedDate = new Date();
//             data.declineReason = req.body.declineReason || null;
//           }
//         } else if (role === "HR_MANAGER") {
//           if (leave.hodDecision !== "APPROVED") {
//             return {
//               kind: "ERR" as const,
//               status: 400,
//               body: { error: "Management approval required first" },
//             };
//           }
//           data.hrDecision = approved ? "APPROVED" : "REJECTED";
//           data.hrDecidedAt = new Date();
//           data.status = approved ? "APPROVED" : "REJECTED";
//           if (!approved) {
//             data.declinedBy = userId ?? null;
//             data.declinedDate = new Date();
//             data.declineReason = req.body.declineReason || null;
//           }
//         } else {
//           return {
//             kind: "ERR" as const,
//             status: 400,
//             body: { error: "Invalid approver for Reporting Manager/HOD" },
//           };
//         }
//       }
//       // ================================================================
//       // NORMAL EMPLOYEE (roleId = 2)
//       // Level1: REPORTING_MANAGER
//       // Level2: HR_MANAGER
//       // ================================================================
//       else if (roleId === 2) {
//         if (role === "REPORTING_MANAGER") {
//           data.hodDecision = approved ? "APPROVED" : "REJECTED";
//           data.hodDecidedAt = new Date();
//           if (!approved) {
//             data.status = "REJECTED";
//             data.declinedBy = userId ?? null;
//             data.declinedDate = new Date();
//             data.declineReason = req.body.declineReason || null;
//           }
//         } else if (role === "HR_MANAGER") {
//           if (leave.hodDecision !== "APPROVED") {
//             return {
//               kind: "ERR" as const,
//               status: 400,
//               body: { error: "Manager approval required first" },
//             };
//           }
//           data.hrDecision = approved ? "APPROVED" : "REJECTED";
//           data.hrDecidedAt = new Date();
//           data.status = approved ? "APPROVED" : "REJECTED";
//           if (!approved) {
//             data.declinedBy = userId ?? null;
//             data.declinedDate = new Date();
//             data.declineReason = req.body.declineReason || null;
//           }
//         } else {
//           return {
//             kind: "ERR" as const,
//             status: 400,
//             body: { error: "Unauthorized approver" },
//           };
//         }
//       } else {
//         return { kind: "ERR" as const, status: 400, body: { error: "Unsupported employee roleId" } };
//       }
//       // Save decisions
//       const updatedLeave = await tx.leaveRequest.update({
//         where: { id: leaveId },
//         data,
//         include: { employee: true, leaveType: true },
//       });
//       // If not finally approved, stop here
//       if (updatedLeave.status !== "APPROVED") {
//         return { kind: "OK" as const, status: 200, body: updatedLeave };
//       }
//       // ================================================================
//       // FINAL APPROVAL: CONSUME CO OR DEBIT BALANCE + LEDGER + SUMMARIES
//       // ================================================================
//       const startDate = new Date(updatedLeave.startDate);
//       const endDate = new Date(updatedLeave.endDate);
//       // const year = startDate.getFullYear();
//       const year = getFinancialYear(startDate);
//       const month = startDate.getMonth() + 1;
//       const requestedUnits = updatedLeave.isHalfDay ? 0.5 : daysInclusive(startDate, endDate);
//       // ---- CO: consume credits only (leave balance table untouched)
//       if (updatedLeave.leaveType.name === "CO") {
//         const today = atStartOfDay(new Date());
//         // CO always full day credits
//         const requiredDays = Math.ceil(requestedUnits);
//         const credits = await tx.compOffCredit.findMany({
//           where: {
//             employeeId: updatedLeave.employeeId,
//             used: false,
//             expiryDate: { gte: today },
//           },
//           orderBy: { expiryDate: "asc" },
//         });
//         if (credits.length < requiredDays) {
//           return {
//             kind: "ERR" as const,
//             status: 400,
//             body: { error: "Not enough comp-off credits" },
//           };
//         }
//         const toUse = credits.slice(0, requiredDays);
//         for (const c of toUse) {
//           await tx.compOffCredit.update({
//             where: { id: c.id },
//             data: { used: true, usedOn: new Date(), leaveId: updatedLeave.id },
//           });
//         }
//         // OPTIONAL: if you want a ledger trail for CO also, you can add a separate leaveType for CO balance.
//         // For now, returning as-is (like your previous behavior).
//         return { kind: "OK" as const, status: 200, body: { ...updatedLeave, requestedUnits } };
//       }
//       // ---- Other leaves: validate & debit EmployeeLeaveBalance + ledger + summaries
//       const bal = await getBalance(updatedLeave.employeeId, updatedLeave.leaveTypeId, year);
//       if (!bal) {
//         return {
//           kind: "ERR" as const,
//           status: 400,
//           body: { error: `Leave balance not configured for ${year}` },
//         };
//       }
//       const totalUsedBefore = computeTotalUsed(bal);
//       const remainingBefore = (bal.totalAllowed ?? 0) - totalUsedBefore;
//       // extra guard (in case frontend bypasses)
//       if (requestedUnits > remainingBefore) {
//         return {
//           kind: "ERR" as const,
//           status: 400,
//           body: { error: "Insufficient balance at approval time" },
//         };
//       }
//       const ledgerBalance = await getLastLedgerBalanceTx(tx, updatedLeave.employeeId, updatedLeave.leaveTypeId, year);
//       if (requestedUnits > ledgerBalance) {
//         return {
//           kind: "ERR" as const,
//           status: 400,
//           body: { error: "Insufficient balance (ledger)" }
//         };
//       }
//       // 1) Update EmployeeLeaveBalance usage
//       if (updatedLeave.isHalfDay) {
//         await tx.employeeLeaveBalance.updateMany({
//           where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year },
//           data: { halfDayUsed: { increment: 1 } },
//         });
//       } else {
//         await tx.employeeLeaveBalance.updateMany({
//           where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year },
//           data: { used: { increment: requestedUnits } },
//         });
//       }
//       // 3) Rebuild monthly summaries for ALL touched months (important for cross-month leave)
//       const touched = getTouchedMonths(startDate, endDate);
//       // ensure previous month summary exists chain-wise:
//       // rebuild in chronological order
//       touched.sort((a, b) => (a.year - b.year) || (a.month - b.month));
//       let runningBalance = await getLastLedgerBalanceTx(
//         tx,
//         updatedLeave.employeeId,
//         updatedLeave.leaveTypeId,
//         year
//       );
//       for (const m of touched) {
//         const days = calculateDaysForMonth(startDate, endDate, m.year, m.month);
//         if (days <= 0) continue;
//         runningBalance = runningBalance - days;
//         await insertLedgerTx(tx, {
//           employeeId: updatedLeave.employeeId,
//           leaveTypeId: updatedLeave.leaveTypeId,
//           year: m.year,
//           month: m.month,
//           debit: days,
//           credit: 0,
//           balanceAfter: runningBalance,
//           action: "DEBIT",
//           referenceType: "LEAVE_REQUEST",
//           referenceId: updatedLeave.id,
//           performedBy: userId ?? null,
//           source: "ADMIN",
//           remarks: `Leave part for ${m.month}/${m.year}`
//         });
//       }
//       for (const m of touched) {
//         await rebuildMonthlySummaryTx(tx, updatedLeave.employeeId, updatedLeave.leaveTypeId, m.year, m.month);
//       }
//       // 4) Rebuild yearly summary
//       // (if leave spans years, rebuild both)
//       const yearsTouched = Array.from(new Set(touched.map((t) => t.year)));
//       for (const y of yearsTouched) {
//         await rebuildYearlySummaryTx(tx, updatedLeave.employeeId, updatedLeave.leaveTypeId, y);
//       }
//       return { kind: "OK" as const, status: 200, body: { ...updatedLeave, requestedUnits } };
//     });
//     if (result.kind === "ERR") {
//       return res.status(result.status).json(result.body);
//     }
//     return res.status(result.status).json(result.body);
//   } catch (error) {
//     console.error("Error updating leave:", error);
//     return res.status(500).json({ error: "Failed to update leave" });
//   }
// };
const updateLeaveStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const leaveId = Number(req.params.id);
        const { role, status, userId, declineReason } = req.body;
        if (!leaveId || !role || !status) {
            return res.status(400).json({ error: "id, role, status are required" });
        }
        if (!["Approved", "Declined"].includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }
        const approved = status === "Approved";
        // We will rebuild summaries OUTSIDE transaction to avoid P2028 timeouts.
        let touchedMonths = [];
        let yearsTouched = [];
        let rebuildEmployeeId = null;
        let rebuildLeaveTypeId = null;
        const result = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const leave = yield tx.leaveRequest.findUnique({
                where: { id: leaveId },
                include: { leaveType: true, employee: true },
            });
            if (!leave) {
                return { kind: "ERR", status: 404, body: { error: "Leave not found" } };
            }
            if (leave.status === "APPROVED" || leave.status === "REJECTED") {
                return { kind: "ERR", status: 400, body: { error: "Leave already finalized" } };
            }
            const emp = leave.employee;
            const roleId = emp.roleId;
            const deptId = emp.departmentId;
            const isHRDept = deptId === 1;
            const hasIncharge = !!emp.inchargeId;
            const data = {};
            // --------------------------
            // INCHARGE LEVEL (if exists)
            // --------------------------
            if (hasIncharge && role === "INCHARGE") {
                data.inChargeDecision = approved ? "APPROVED" : "REJECTED";
                data.inChargeDecidedAt = new Date();
                if (!approved) {
                    data.status = "REJECTED";
                    data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                    data.declinedDate = new Date();
                    data.declineReason = declineReason || null;
                }
                const updated = yield tx.leaveRequest.update({
                    where: { id: leaveId },
                    data,
                    include: { leaveType: true, employee: true },
                });
                return { kind: "OK", status: 200, body: updated };
            }
            // Block others until incharge approves
            if (hasIncharge && leave.inChargeDecision !== "APPROVED") {
                return {
                    kind: "ERR",
                    status: 400,
                    body: { error: "Incharge approval required first" },
                };
            }
            // ================================================================
            // HR EMPLOYEE (dept=1, roleId != 1) -> HR_MANAGER final
            // ================================================================
            if (isHRDept && roleId !== 1) {
                if (role !== "HR_MANAGER") {
                    return {
                        kind: "ERR",
                        status: 400,
                        body: { error: "Only HR Manager can approve HR employees" },
                    };
                }
                data.hodDecision = approved ? "APPROVED" : "REJECTED";
                data.hodDecidedAt = new Date();
                data.hrDecision = approved ? "APPROVED" : "REJECTED";
                data.hrDecidedAt = new Date();
                data.status = approved ? "APPROVED" : "REJECTED";
                if (!approved) {
                    data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                    data.declinedDate = new Date();
                    data.declineReason = declineReason || null;
                }
            }
            // ================================================================
            // HR MANAGER (roleId=1) -> MANAGEMENT final
            // ================================================================
            else if (roleId === 1) {
                if (role !== "MANAGEMENT") {
                    return {
                        kind: "ERR",
                        status: 400,
                        body: { error: "Only Management can approve HR Manager leave" },
                    };
                }
                data.hodDecision = approved ? "APPROVED" : "REJECTED";
                data.hodDecidedAt = new Date();
                data.hrDecision = approved ? "APPROVED" : "REJECTED";
                data.hrDecidedAt = new Date();
                data.status = approved ? "APPROVED" : "REJECTED";
                if (!approved) {
                    data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                    data.declinedDate = new Date();
                    data.declineReason = declineReason || null;
                }
            }
            // ================================================================
            // REPORTING MANAGER / HOD (roleId 3 or 5)
            //   Level1: MANAGEMENT
            //   Level2: HR_MANAGER
            // ================================================================
            else if (roleId === 3) {
                if (role === "MANAGEMENT") {
                    data.hodDecision = approved ? "APPROVED" : "REJECTED";
                    data.hodDecidedAt = new Date();
                    if (!approved) {
                        data.status = "REJECTED";
                        data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                        data.declinedDate = new Date();
                        data.declineReason = declineReason || null;
                    }
                }
                else if (role === "HR_MANAGER") {
                    if (leave.hodDecision !== "APPROVED") {
                        return {
                            kind: "ERR",
                            status: 400,
                            body: { error: "Management approval required first" },
                        };
                    }
                    data.hrDecision = approved ? "APPROVED" : "REJECTED";
                    data.hrDecidedAt = new Date();
                    data.status = approved ? "APPROVED" : "REJECTED";
                    if (!approved) {
                        data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                        data.declinedDate = new Date();
                        data.declineReason = declineReason || null;
                    }
                }
                else {
                    return {
                        kind: "ERR",
                        status: 400,
                        body: { error: "Invalid approver for Reporting Manager/HOD" },
                    };
                }
            }
            // ================================================================
            // NORMAL EMPLOYEE (roleId=2)
            //   Level1: REPORTING_MANAGER
            //   Level2: HR_MANAGER
            // ================================================================
            else if (roleId === 2 || roleId === 5) {
                // Level 1: the employee's assigned reportingManager approves —
                // regardless of whether that manager's own role is 3 (Reporting
                // Manager) or 4 (Management). Frontend may send either label, so
                // we authorize by identity (userId === emp.reportingManager), not
                // by the role string.
                if (role === "REPORTING_MANAGER" || role === "MANAGEMENT") {
                    if (!emp.reportingManager) {
                        return {
                            kind: "ERR",
                            status: 400,
                            body: { error: "No reporting manager assigned for this employee" },
                        };
                    }
                    if (!userId || userId !== emp.reportingManager) {
                        return {
                            kind: "ERR",
                            status: 403,
                            body: { error: "Only the assigned reporting manager can approve this leave" },
                        };
                    }
                    data.hodDecision = approved ? "APPROVED" : "REJECTED";
                    data.hodDecidedAt = new Date();
                    if (!approved) {
                        data.status = "REJECTED";
                        data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                        data.declinedDate = new Date();
                        data.declineReason = declineReason || null;
                    }
                }
                else if (role === "HR_MANAGER") {
                    if (leave.hodDecision !== "APPROVED") {
                        return {
                            kind: "ERR",
                            status: 400,
                            body: { error: "Manager approval required first" },
                        };
                    }
                    data.hrDecision = approved ? "APPROVED" : "REJECTED";
                    data.hrDecidedAt = new Date();
                    data.status = approved ? "APPROVED" : "REJECTED";
                    if (!approved) {
                        data.declinedBy = userId !== null && userId !== void 0 ? userId : null;
                        data.declinedDate = new Date();
                        data.declineReason = declineReason || null;
                    }
                }
                else {
                    return {
                        kind: "ERR",
                        status: 400,
                        body: { error: "Unauthorized approver" },
                    };
                }
            }
            else {
                return {
                    kind: "ERR",
                    status: 400,
                    body: { error: "Unsupported employee roleId" },
                };
            }
            // Save decisions
            const updatedLeave = yield tx.leaveRequest.update({
                where: { id: leaveId },
                data,
                include: { employee: true, leaveType: true },
            });
            // If not finally approved, stop here (NO ledger work)
            if (updatedLeave.status !== "APPROVED") {
                return { kind: "OK", status: 200, body: updatedLeave };
            }
            // ================================================================
            // FINAL APPROVAL: CONSUME CO OR DEBIT BALANCE + LEDGER
            // ================================================================
            const startDate = new Date(updatedLeave.startDate);
            const endDate = new Date(updatedLeave.endDate);
            // ── Rule A re-check at approval (catches legacy / race conflicts).
            // If a different-type leave now occupies the same ISO week, refuse.
            const weeklyClashOnApprove = yield findWeeklyTypeConflict(updatedLeave.employeeId, updatedLeave.leaveTypeId, updatedLeave.leaveType.name, startDate, endDate, updatedLeave.id);
            if (weeklyClashOnApprove) {
                return {
                    kind: "ERR",
                    status: 400,
                    body: {
                        error: `Cannot approve — employee already has a ${weeklyClashOnApprove.leaveType.name} `
                            + `leave in the same week. Only one leave type is allowed per week.`,
                    },
                };
            }
            const year = getFinancialYear(startDate);
            // EL counts week-offs inside the range (sandwich rule); other types don't.
            const isEarnedLeave = updatedLeave.leaveType.name === "EL";
            const requestedUnits = updatedLeave.isHalfDay
                ? 0.5
                : yield countWorkingDays(updatedLeave.employeeId, startDate, endDate, { includeWeekOffs: isEarnedLeave });
            // ---- CO: consume credits only (leave balance untouched)
            if (updatedLeave.leaveType.name === "CO") {
                const today = atStartOfDay(new Date());
                const requiredDays = Math.ceil(requestedUnits);
                const credits = yield tx.compOffCredit.findMany({
                    where: {
                        employeeId: updatedLeave.employeeId,
                        used: false,
                        expiryDate: { gte: today },
                    },
                    orderBy: { expiryDate: "asc" },
                });
                if (credits.length < requiredDays) {
                    return {
                        kind: "ERR",
                        status: 400,
                        body: { error: "Not enough comp-off credits" },
                    };
                }
                for (const c of credits.slice(0, requiredDays)) {
                    yield tx.compOffCredit.update({
                        where: { id: c.id },
                        data: { used: true, usedOn: new Date(), leaveId: updatedLeave.id },
                    });
                }
                return { kind: "OK", status: 200, body: Object.assign(Object.assign({}, updatedLeave), { requestedUnits }) };
            }
            // ---- RH: no balance table, just approve (validated at creation)
            if (updatedLeave.leaveType.name === "RH") {
                return { kind: "OK", status: 200, body: Object.assign(Object.assign({}, updatedLeave), { requestedUnits }) };
            }
            // ---- Non-CO/RH: validate balance
            const bal = yield tx.employeeLeaveBalance.findFirst({
                where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year, category: "LEAVE" },
            });
            if (!bal) {
                return {
                    kind: "ERR",
                    status: 400,
                    body: { error: `Leave balance not configured for ${year}` },
                };
            }
            const totalUsedBefore = computeTotalUsed(bal);
            const remainingBefore = ((_a = bal.totalAllowed) !== null && _a !== void 0 ? _a : 0) - totalUsedBefore;
            if (requestedUnits > remainingBefore) {
                return {
                    kind: "ERR",
                    status: 400,
                    body: { error: "Insufficient balance at approval time" },
                };
            }
            // ledger balance check
            const ledgerBalance = yield getLastLedgerBalanceTx(tx, updatedLeave.employeeId, updatedLeave.leaveTypeId, year);
            if (requestedUnits > ledgerBalance) {
                return { kind: "ERR", status: 400, body: { error: "Insufficient balance (ledger)" } };
            }
            // Update EmployeeLeaveBalance usage
            if (updatedLeave.isHalfDay) {
                yield tx.employeeLeaveBalance.updateMany({
                    where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year },
                    data: { halfDayUsed: { increment: 1 } },
                });
            }
            else {
                yield tx.employeeLeaveBalance.updateMany({
                    where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year },
                    data: { used: { increment: requestedUnits } },
                });
            }
            // Create ledger DEBITs per touched month (FAST enough; summary rebuild moved out)
            const touched = getTouchedMonths(startDate, endDate);
            touched.sort((a, b) => a.year - b.year || a.month - b.month);
            // IMPORTANT: start running balance from current ledger AFTER the debit inserts base
            let runningBalance = ledgerBalance;
            for (const m of touched) {
                const calYear = getCalendarYear(m.year, m.month);
                const monthStart = new Date(calYear, m.month - 1, 1);
                const monthEnd = new Date(calYear, m.month, 0);
                const from = startDate > monthStart ? startDate : monthStart;
                const to = endDate < monthEnd ? endDate : monthEnd;
                const days = yield countWorkingDays(updatedLeave.employeeId, from, to, { includeWeekOffs: isEarnedLeave });
                if (days <= 0)
                    continue;
                runningBalance -= days;
                yield insertLedgerTx(tx, {
                    employeeId: updatedLeave.employeeId,
                    leaveTypeId: updatedLeave.leaveTypeId,
                    year: m.year,
                    month: m.month,
                    debit: days,
                    credit: 0,
                    balanceAfter: runningBalance,
                    action: "DEBIT",
                    referenceType: "LEAVE_REQUEST",
                    referenceId: updatedLeave.id,
                    performedBy: userId !== null && userId !== void 0 ? userId : null,
                    source: "ADMIN",
                    remarks: `Leave part for ${m.month}/${m.year}`,
                });
            }
            // Pass rebuild info OUTSIDE the transaction
            return {
                kind: "OK",
                status: 200,
                body: Object.assign(Object.assign({}, updatedLeave), { requestedUnits, __touched: touched }),
            };
        }), {
            // optional, but helps (still keep rebuild OUTSIDE)
            timeout: 15000,
        });
        if (result.kind === "ERR") {
            return res.status(result.status).json(result.body);
        }
        // =========================
        // ✅ OUTSIDE TRANSACTION: REBUILD SUMMARIES (NO tx)
        // =========================
        const body = result.body;
        if ((body === null || body === void 0 ? void 0 : body.status) === "APPROVED" && ((_a = body === null || body === void 0 ? void 0 : body.leaveType) === null || _a === void 0 ? void 0 : _a.name) !== "CO" && Array.isArray(body.__touched)) {
            touchedMonths = body.__touched;
            yearsTouched = Array.from(new Set(touchedMonths.map((t) => t.year)));
            rebuildEmployeeId = body.employeeId;
            rebuildLeaveTypeId = body.leaveTypeId;
            // Rebuild in order (month chain)
            touchedMonths.sort((a, b) => a.year - b.year || a.month - b.month);
            if (rebuildEmployeeId !== null &&
                rebuildLeaveTypeId !== null) {
                for (const m of touchedMonths) {
                    yield rebuildMonthlySummaryTx(prisma_1.prisma, rebuildEmployeeId, rebuildLeaveTypeId, m.year, m.month);
                }
                for (const y of yearsTouched) {
                    yield rebuildYearlySummaryTx(prisma_1.prisma, rebuildEmployeeId, rebuildLeaveTypeId, y);
                }
            }
        }
        // cleanup helper key
        if (body === null || body === void 0 ? void 0 : body.__touched)
            delete body.__touched;
        // 🔔 Notify employee of final decision
        if ((body === null || body === void 0 ? void 0 : body.status) === 'APPROVED' || (body === null || body === void 0 ? void 0 : body.status) === 'REJECTED') {
            try {
                const start = fmtDate(body.startDate);
                const end = fmtDate(body.endDate);
                const days = daysInclusive(new Date(body.startDate), new Date(body.endDate));
                yield (0, notifications_controller_1.createNotification)(body.employeeId, `Your leave request from ${start} to ${end} (${days} day(s)) has been ${body.status}.`);
            }
            catch (err) {
                console.error("Leave status notification failed:", err);
            }
        }
        return res.status(result.status).json(body);
    }
    catch (error) {
        console.error("Error updating leave:", error);
        return res.status(500).json({ error: "Failed to update leave" });
    }
});
exports.updateLeaveStatus = updateLeaveStatus;
// export const createLeaveBalances = async (req: Request, res: Response) => {
//   try {
//     const { employeeId, year, leaves = [], permissions = [] } = req.body;
//     if (!employeeId || !year) {
//       return res.status(400).json({ error: "employeeId and year are required" });
//     }
//     // 🔹 LEAVES
//     for (const l of leaves) {
//       await prisma.employeeLeaveBalance.upsert({
//         where: {
//           employeeId_leaveTypeId_year: {
//             employeeId,
//             leaveTypeId: l.leaveTypeId,
//             year
//           }
//         },
//         update: {
//           totalAllowed: l.totalAllowed,
//           used: l.used ?? 0,
//           halfDayUsed: l.halfDayUsed ?? 0
//         },
//         create: {
//           employeeId,
//           leaveTypeId: l.leaveTypeId,
//           permissionType: null,
//           category: "LEAVE",
//           year,
//           totalAllowed: l.totalAllowed,
//           used: l.used ?? 0,
//           halfDayUsed: l.halfDayUsed ?? 0
//         }
//       });
//     }
//     // 🔹 PERMISSIONS
//     for (const p of permissions) {
//       await prisma.employeeLeaveBalance.upsert({
//         where: {
//           employeeId_permissionType_year: {
//             employeeId,
//             permissionType: p.permissionType,
//             year
//           }
//         },
//         update: {
//           totalAllowed: p.totalAllowed,
//           used: p.used ?? 0
//         },
//         create: {
//           employeeId,
//           leaveTypeId: null,
//           permissionType: p.permissionType,
//           category: "PERMISSION",
//           year,
//           totalAllowed: p.totalAllowed,
//           used: p.used ?? 0
//         }
//       });
//     }
//     res.json({ message: "Leave balances saved successfully" });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to create leave balances" });
//   }
// };
const createLeaveBalances = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, year, leaves = [] } = req.body;
        if (!employeeId || !year) {
            return res.status(400).json({ error: "employeeId and year are required" });
        }
        const affectedLeaveTypes = new Set();
        const month = new Date().getMonth() + 1;
        // =========================
        // 🔁 PROCESS LEAVES (SMALL TX PER ITEM)
        // =========================
        for (const l of leaves) {
            yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                const existing = yield tx.employeeLeaveBalance.findFirst({
                    where: {
                        employeeId,
                        leaveTypeId: l.leaveTypeId,
                        year
                    }
                });
                // =========================
                // 🔢 CALCULATIONS
                // =========================
                const prevTotal = (_a = existing === null || existing === void 0 ? void 0 : existing.totalAllowed) !== null && _a !== void 0 ? _a : 0;
                const newTotal = Number((_b = l.totalAllowed) !== null && _b !== void 0 ? _b : 0);
                const totalDelta = newTotal - prevTotal;
                const prevUsed = ((_c = existing === null || existing === void 0 ? void 0 : existing.used) !== null && _c !== void 0 ? _c : 0) + (((_d = existing === null || existing === void 0 ? void 0 : existing.halfDayUsed) !== null && _d !== void 0 ? _d : 0) * 0.5);
                const newUsed = (Number((_e = l.used) !== null && _e !== void 0 ? _e : 0)) + ((Number((_f = l.halfDayUsed) !== null && _f !== void 0 ? _f : 0)) * 0.5);
                const usedDelta = newUsed - prevUsed;
                // =========================
                // 💾 UPSERT BALANCE
                // =========================
                yield tx.employeeLeaveBalance.upsert({
                    where: {
                        employeeId_leaveTypeId_year: {
                            employeeId,
                            leaveTypeId: l.leaveTypeId,
                            year
                        }
                    },
                    update: {
                        totalAllowed: newTotal,
                        used: Number((_g = l.used) !== null && _g !== void 0 ? _g : 0),
                        halfDayUsed: Number((_h = l.halfDayUsed) !== null && _h !== void 0 ? _h : 0)
                    },
                    create: {
                        employeeId,
                        leaveTypeId: l.leaveTypeId,
                        permissionType: null,
                        category: "LEAVE",
                        year,
                        totalAllowed: newTotal,
                        used: Number((_j = l.used) !== null && _j !== void 0 ? _j : 0),
                        halfDayUsed: Number((_k = l.halfDayUsed) !== null && _k !== void 0 ? _k : 0)
                    }
                });
                // =========================
                // 📊 LEDGER
                // =========================
                let prevLedgerBalance = yield getLastLedgerBalanceTx(tx, employeeId, l.leaveTypeId, year);
                let newLedgerBalance = prevLedgerBalance;
                // 🔹 TOTAL CHANGE
                if (totalDelta !== 0) {
                    newLedgerBalance += totalDelta;
                    yield insertLedgerTx(tx, {
                        employeeId,
                        leaveTypeId: l.leaveTypeId,
                        year,
                        month,
                        credit: totalDelta > 0 ? totalDelta : 0,
                        debit: totalDelta < 0 ? Math.abs(totalDelta) : 0,
                        balanceAfter: newLedgerBalance,
                        action: "ADJUSTMENT",
                        referenceType: "MANUAL",
                        source: "ADMIN",
                        remarks: "Total allocation updated"
                    });
                }
                // 🔹 USED CHANGE (🔥 IMPORTANT)
                if (usedDelta !== 0) {
                    newLedgerBalance -= usedDelta;
                    yield insertLedgerTx(tx, {
                        employeeId,
                        leaveTypeId: l.leaveTypeId,
                        year,
                        month,
                        credit: usedDelta < 0 ? Math.abs(usedDelta) : 0,
                        debit: usedDelta > 0 ? usedDelta : 0,
                        balanceAfter: newLedgerBalance,
                        action: "DEBIT",
                        referenceType: "MANUAL",
                        source: "ADMIN",
                        remarks: "Used updated manually"
                    });
                }
                // ✅ TRACK FOR SUMMARY REBUILD
                if (totalDelta !== 0 || usedDelta !== 0) {
                    affectedLeaveTypes.add(l.leaveTypeId);
                }
            }), { timeout: 10000 }); // ⬅️ avoid timeout issues
        }
        // =========================
        // 🔹 PERMISSIONS (NO LEDGER)
        // =========================
        // for (const p of permissions) {
        //   await prisma.employeeLeaveBalance.upsert({
        //     where: {
        //       employeeId_permissionType_year: {
        //         employeeId,
        //         permissionType: p.permissionType,
        //         year
        //       }
        //     },
        //     update: {
        //       totalAllowed: Number(p.totalAllowed ?? 0),
        //       used: Number(p.used ?? 0)
        //     },
        //     create: {
        //       employeeId,
        //       leaveTypeId: null,
        //       permissionType: p.permissionType,
        //       category: "PERMISSION",
        //       year,
        //       totalAllowed: Number(p.totalAllowed ?? 0),
        //       used: Number(p.used ?? 0)
        //     }
        //   });
        // }
        // =========================
        // 🔁 REBUILD SUMMARIES (OUTSIDE TX)
        // =========================
        for (const leaveTypeId of affectedLeaveTypes) {
            yield rebuildMonthlySummaryTx(prisma_1.prisma, employeeId, leaveTypeId, year, month);
            yield rebuildYearlySummaryTx(prisma_1.prisma, employeeId, leaveTypeId, year);
        }
        return res.json({ message: "Leave balances updated successfully" });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to update leave balances" });
    }
});
exports.createLeaveBalances = createLeaveBalances;
const MS_PER_DAY = 86400000;
function daysInclusive(s, e) {
    const ss = new Date(s);
    ss.setHours(0, 0, 0, 0);
    const ee = new Date(e);
    ee.setHours(0, 0, 0, 0);
    return Math.floor((ee.getTime() - ss.getTime()) / MS_PER_DAY) + 1;
}
// Counts leave days between start and end (inclusive).
// By default, excludes:
//   - week-offs (per employee shift config, fallback Sunday)
//   - mandatory national holidays (isOptional = false)
// Optional holidays (RH) are always counted as working days.
//
// When opts.includeWeekOffs is true, week-offs that fall inside the range ARE
// counted as leave days. This implements the "Earned Leave sandwich rule" —
// if an employee takes EL spanning a weekend, the weekend is deducted too.
// Mandatory national holidays are still excluded even in that mode.
function countWorkingDays(employeeId, start, end, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (start > end)
            return 0;
        const includeWeekOffs = !!(opts === null || opts === void 0 ? void 0 : opts.includeWeekOffs);
        // Fetch all mandatory holidays in the date range once
        const mandatoryHolidays = yield prisma_1.prisma.holiday.findMany({
            where: {
                isOptional: false,
                date: { gte: start, lte: end }
            },
            select: { date: true }
        });
        const holidaySet = new Set(mandatoryHolidays.map(h => {
            const d = new Date(h.date);
            d.setHours(0, 0, 0, 0);
            return d.toISOString().slice(0, 10);
        }));
        const monthConfigs = new Map();
        let total = 0;
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const current = new Date(d);
            current.setHours(0, 0, 0, 0);
            const dateKey = current.toISOString().slice(0, 10);
            // Skip mandatory national holidays — always, even for EL.
            if (holidaySet.has(dateKey))
                continue;
            // For EL (includeWeekOffs), don't even bother resolving the week-off
            // config — every non-holiday day counts.
            if (includeWeekOffs) {
                total++;
                continue;
            }
            const month = current.getMonth() + 1;
            const year = current.getFullYear();
            const monthKey = `${year}-${month}`;
            if (!monthConfigs.has(monthKey)) {
                const approval = yield prisma_1.prisma.shiftApproval.findFirst({
                    where: {
                        employeeId,
                        month,
                        year,
                        status: "APPROVED",
                        weekOffConfig: { not: client_1.Prisma.DbNull }
                    }
                });
                monthConfigs.set(monthKey, (_a = approval === null || approval === void 0 ? void 0 : approval.weekOffConfig) !== null && _a !== void 0 ? _a : null);
            }
            const config = monthConfigs.get(monthKey);
            if (!isWeeklyOffFromConfig(config, current)) {
                total++;
            }
        }
        return total;
    });
}
function getLeaveDashboard(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const employeeId = Number(req.params.id);
            const today = req.query.date ? new Date(String(req.query.date)) : new Date();
            const fyYear = getFinancialYear(today);
            const yearStart = new Date(fyYear, 3, 1); // April 1 of FY
            const yearEnd = new Date(fyYear + 1, 2, 31, 23, 59, 59); // March 31 end of FY
            const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
            const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
            // Entitlement for this financial year
            const policy = yield prisma_1.prisma.entitlementPolicy.findFirst({ where: { year: fyYear } });
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
function atStartOfDay(d) { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; }
function atEndOfDay(d) { const x = new Date(d); x.setUTCHours(23, 59, 59, 999); return x; }
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
/** Every ISO week (Mon..Sun) that the date range [start, end] overlaps. */
function isoWeeksTouched(start, end) {
    const out = [];
    let cur = startOfISOWeek(start);
    const lastWeekStart = startOfISOWeek(end);
    // Walk Monday → Monday until we've covered the week containing `end`.
    while (cur.getTime() <= lastWeekStart.getTime()) {
        const ws = new Date(cur);
        const we = endOfISOWeek(cur);
        out.push({ weekStart: ws, weekEnd: we });
        cur = new Date(cur);
        cur.setDate(cur.getDate() + 7);
    }
    return out;
}
/**
 * Rule A — one leave TYPE per ISO week.
 * Checks whether the employee already has a PENDING/APPROVED leave of a
 * DIFFERENT type in any ISO week the new request touches. RH and CO are
 * exempt (special-case leaves: tied to a fixed holiday / earned by working).
 * Returns the conflicting record (with leaveType) or null if clear.
 *
 * Pass `excludeRequestId` when re-checking on approval so the request being
 * approved doesn't conflict with itself.
 */
function findWeeklyTypeConflict(employeeId, leaveTypeId, leaveTypeName, start, end, excludeRequestId) {
    return __awaiter(this, void 0, void 0, function* () {
        const WEEKLY_RULE_EXEMPT = ['RH', 'CO'];
        // The leave being applied for is itself exempt → no restriction.
        if (WEEKLY_RULE_EXEMPT.includes(leaveTypeName))
            return null;
        for (const w of isoWeeksTouched(start, end)) {
            const clash = yield prisma_1.prisma.leaveRequest.findFirst({
                where: Object.assign({ employeeId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: w.weekEnd }, endDate: { gte: w.weekStart }, leaveTypeId: { not: leaveTypeId }, leaveType: { name: { notIn: WEEKLY_RULE_EXEMPT } } }, (excludeRequestId ? { id: { not: excludeRequestId } } : {})),
                include: { leaveType: { select: { name: true } } },
                orderBy: { startDate: 'asc' },
            });
            if (clash)
                return clash;
        }
        return null;
    });
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
            // Optional scope: when a leave-detail view passes the applicant's
            // departmentId, restrict buckets to that department only. Without it,
            // behavior is unchanged (org-wide buckets).
            const deptIdRaw = req.query.departmentId;
            const departmentId = deptIdRaw !== undefined && deptIdRaw !== '' && !Number.isNaN(Number(deptIdRaw))
                ? Number(deptIdRaw)
                : null;
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
                where: Object.assign({ status: 'APPROVED', AND: [
                        { endDate: { gte: minStart } }, // overlaps window
                        { startDate: { lte: maxEnd } }
                    ] }, (departmentId !== null
                    ? { employee: { is: { departmentId } } }
                    : {})),
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
        select: { id: true, startDate: true, endDate: true }
    });
    return res.json(existing);
});
exports.getBlockedDates = getBlockedDates;
// export const getLeaveBalance = async (req: Request, res: Response) => {
//   try {
//     const employeeId = Number(req.params.employeeId);
//     const year = Number(req.query.year) || new Date().getFullYear();
//     const balances = await prisma.employeeLeaveBalance.findMany({
//       where: { employeeId, year, category: 'LEAVE' },
//       include: { leaveType: true }
//     });
//     res.json(
//       balances.map(b => ({
//         leaveTypeId: b.leaveTypeId,
//         leaveType: b.leaveType?.name ?? null,
//         totalAllowed: b.totalAllowed,
//         used: b.used,
//         remaining: b.totalAllowed - b.used,
//         year: b.year
//       }))
//     );
//   } catch (err) {
//     res.status(500).json({ error: "Failed to fetch leave balance" });
//   }
// };
const getLeaveBalance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        // const year = Number(req.query.year) || getFinancialYear(new Date());
        const yearParam = Number(req.query.year);
        const year = Number.isFinite(yearParam)
            ? yearParam
            : getFinancialYear(new Date());
        // 1️⃣ Fetch ALL leave types (master)
        const leaveTypes = yield prisma_1.prisma.leaveType.findMany({
            select: { id: true, name: true }
        });
        // 2️⃣ Fetch existing balances
        const balances = yield prisma_1.prisma.employeeLeaveBalance.findMany({
            where: { employeeId, year, category: 'LEAVE' },
        });
        // 3️⃣ Map balances by leaveTypeId
        const balanceMap = new Map();
        balances.forEach(b => {
            if (b.leaveTypeId)
                balanceMap.set(b.leaveTypeId, b);
        });
        // 4️⃣ Merge master + balance
        const result = leaveTypes.map(lt => {
            var _a, _b, _c, _d;
            const b = balanceMap.get(lt.id);
            const usedFull = (_a = b === null || b === void 0 ? void 0 : b.used) !== null && _a !== void 0 ? _a : 0;
            const usedHalfCount = (_b = b === null || b === void 0 ? void 0 : b.halfDayUsed) !== null && _b !== void 0 ? _b : 0;
            const usedHalfDays = usedHalfCount * 0.5;
            const totalUsed = usedFull + usedHalfDays;
            // return {
            //   leaveTypeId: lt.id,
            //   leaveType: lt.name,
            //   totalAllowed: b?.totalAllowed ?? 0,
            //   used: totalUsed ?? 0,
            //   remaining: (b?.totalAllowed ?? 0) - totalUsed,
            //   year
            // };
            return {
                leaveTypeId: lt.id,
                leaveType: lt.name,
                totalAllowed: (_c = b === null || b === void 0 ? void 0 : b.totalAllowed) !== null && _c !== void 0 ? _c : 0,
                used: usedFull,
                usedHalf: usedHalfCount,
                totalUsed,
                remaining: ((_d = b === null || b === void 0 ? void 0 : b.totalAllowed) !== null && _d !== void 0 ? _d : 0) - totalUsed,
                year
            };
        });
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch leave balance" });
    }
});
exports.getLeaveBalance = getLeaveBalance;
const initLeaveEndScheduler = () => {
    node_cron_1.default.schedule("0 9 * * *", () => __awaiter(void 0, void 0, void 0, function* () {
        console.log("Running leave reminder cron...");
        const today = atStartOfDay(new Date());
        const todayEnd = atEndOfDay(new Date());
        const leaves = yield prisma_1.prisma.leaveRequest.findMany({
            where: {
                status: "APPROVED",
                endDate: { gte: today, lte: todayEnd },
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
                const message = `Hello ${emp.firstName}, today is the *last day of your approved leave*. Please be prepared to report tomorrow.`;
                try {
                    yield (0, notifications_controller_1.createNotification)(emp.id, message);
                }
                catch (err) {
                    console.error("Error creating notification:", err);
                }
                if (!emp.phone)
                    continue;
                console.log(`Leave End Reminder to ${emp.firstName} (${emp.phone}): ${message}`);
                // await sendWhatsAppMessage(emp.phone, message);
            }
        }
    }));
};
exports.initLeaveEndScheduler = initLeaveEndScheduler;
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
// GET /leaves/casual/monthly-usage
const getMonthlyCasualUsage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const employeeId = Number(req.query.employeeId);
    // const year = Number(req.query.year);
    const yearParam = Number(req.query.year);
    const year = Number.isFinite(yearParam)
        ? yearParam
        : getFinancialYear(new Date());
    const month = Number(req.query.month);
    const leaveType = yield prisma_1.prisma.leaveType.findFirst({
        where: { name: 'CL' }
    });
    const used = yield getUsedCasualLeaveDays(employeeId, leaveType.id, year, month);
    res.json({
        used,
        remaining: Math.max(0, 2 - used)
    });
});
exports.getMonthlyCasualUsage = getMonthlyCasualUsage;
function getUsedCasualLeaveDays(employeeId, leaveTypeId, year, month) {
    return __awaiter(this, void 0, void 0, function* () {
        const calYear = getCalendarYear(year, month);
        const monthStart = new Date(calYear, month - 1, 1);
        const monthEnd = new Date(calYear, month, 0, 23, 59, 59);
        const leaves = yield prisma_1.prisma.leaveRequest.findMany({
            where: {
                employeeId,
                leaveTypeId,
                status: { in: ['PENDING', 'APPROVED'] },
                startDate: { lte: monthEnd },
                endDate: { gte: monthStart }
            }
        });
        let used = 0;
        for (const l of leaves) {
            const from = new Date(Math.max(l.startDate.getTime(), monthStart.getTime()));
            const to = new Date(Math.min(l.endDate.getTime(), monthEnd.getTime()));
            used += Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        }
        return used;
    });
}
const getCompOffCredits = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const employeeId = Number(req.query.employeeId);
    const today = new Date();
    const credits = yield prisma_1.prisma.compOffCredit.findMany({
        where: {
            employeeId,
            used: false,
            expiryDate: { gte: today }
        },
        orderBy: { workDate: "asc" }
    });
    res.json(credits);
});
exports.getCompOffCredits = getCompOffCredits;
function getActivePolicy(leaveTypeId, onDate) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        // Your schema has: effectiveFrom/effectiveTo nullable, isActive, financialYearStart etc.
        // Basic: pick latest active policy effective for the date.
        const policies = yield prisma_1.prisma.leavePolicy.findMany({
            where: {
                leaveTypeId,
                isActive: true,
                OR: [
                    { effectiveFrom: null },
                    { effectiveFrom: { lte: onDate } }
                ],
                AND: [
                    {
                        OR: [
                            { effectiveTo: null },
                            { effectiveTo: { gte: onDate } }
                        ]
                    }
                ]
            },
            orderBy: { createdAt: "desc" },
            take: 1
        });
        return (_a = policies[0]) !== null && _a !== void 0 ? _a : null;
    });
}
function insertLedgerRow(params) {
    return __awaiter(this, void 0, void 0, function* () {
        const { employeeId, leaveTypeId, year, month, credit = 0, debit = 0, balanceAfter, action, referenceType, referenceId = null, performedBy = null, source = null, remarks = null, metadata = null } = params;
        yield prisma_1.prisma.leaveLedger.create({
            data: {
                employeeId,
                leaveTypeId,
                year,
                month: month !== null && month !== void 0 ? month : null,
                transactionDate: new Date(),
                referenceType,
                referenceId,
                credit,
                debit,
                balanceAfter,
                action,
                performedBy,
                source,
                remarks,
                metadata
            }
        });
    });
}
function computeTotalUsed(balance) {
    var _a, _b;
    const usedFull = (_a = balance.used) !== null && _a !== void 0 ? _a : 0;
    const halfCount = (_b = balance.halfDayUsed) !== null && _b !== void 0 ? _b : 0; // count of half-days
    return usedFull + halfCount * 0.5;
}
function getBalance(employeeId, leaveTypeId, year) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma_1.prisma.employeeLeaveBalance.findFirst({
            where: { employeeId, leaveTypeId, year, category: "LEAVE" }
        });
    });
}
function getLastLedgerBalance(employeeId, leaveTypeId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const last = yield prisma_1.prisma.leaveLedger.findFirst({
            where: { employeeId, leaveTypeId },
            orderBy: { id: "desc" }, // id autoinc is safe ordering
            select: { balanceAfter: true },
        });
        return (_a = last === null || last === void 0 ? void 0 : last.balanceAfter) !== null && _a !== void 0 ? _a : 0;
    });
}
/**
 * Rebuild 1 month summary from ledger + previous month closing.
 * IMPORTANT: Opening comes from previous summary closing (or 0 if none).
 */
function rebuildMonthlySummaryTx(tx, employeeId, leaveTypeId, year, month, openingOverride) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        let opening;
        if (openingOverride !== undefined) {
            // Caller knows the correct opening (e.g. rollover passing pre-lapse balance)
            opening = openingOverride;
        }
        else if (month === 4) {
            // Start of financial year — each FY ledger starts from 0.
            // The OPENING_BALANCE credit in April is captured in `credited` below,
            // so opening must be 0. Using March-prev-year closing would double-count
            // any carried balance.
            opening = 0;
        }
        else {
            const { year: prevYear, month: prevMonth } = getPrevMonthFY(year, month);
            const prev = yield tx.leaveMonthlySummary.findUnique({
                where: {
                    employeeId_leaveTypeId_year_month: {
                        employeeId,
                        leaveTypeId,
                        year: prevYear,
                        month: prevMonth,
                    },
                },
            });
            opening = (_a = prev === null || prev === void 0 ? void 0 : prev.closing) !== null && _a !== void 0 ? _a : 0;
        }
        const entries = yield tx.leaveLedger.findMany({
            where: { employeeId, leaveTypeId, year, month },
            select: { credit: true, debit: true, action: true },
        });
        let credited = 0;
        let used = 0;
        let lapsed = 0;
        for (const e of entries) {
            credited += Number((_b = e.credit) !== null && _b !== void 0 ? _b : 0);
            if (e.action === "LAPSE") {
                lapsed += Number((_c = e.debit) !== null && _c !== void 0 ? _c : 0);
            }
            else {
                used += Number((_d = e.debit) !== null && _d !== void 0 ? _d : 0);
            }
        }
        const closing = opening + credited - used - lapsed; // (lapsed already part of debit/used)
        yield tx.leaveMonthlySummary.upsert({
            where: {
                employeeId_leaveTypeId_year_month: {
                    employeeId,
                    leaveTypeId,
                    year,
                    month,
                },
            },
            update: { opening, credited, used, lapsed, closing },
            create: { employeeId, leaveTypeId, year, month, opening, credited, used, lapsed, closing },
        });
        return { opening, credited, used, lapsed, closing };
    });
}
function rebuildYearlySummaryTx(tx, employeeId, leaveTypeId, year) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const months = yield tx.leaveMonthlySummary.findMany({
            where: { employeeId, leaveTypeId, year },
            orderBy: { month: "asc" },
        });
        // const opening = months.find((m) => m.month === 1)?.opening ?? 0;
        const opening = (_b = (_a = months.find((m) => m.month === 4)) === null || _a === void 0 ? void 0 : _a.opening) !== null && _b !== void 0 ? _b : 0;
        const credited = months.reduce((s, m) => { var _a; return s + Number((_a = m.credited) !== null && _a !== void 0 ? _a : 0); }, 0);
        const used = months.reduce((s, m) => { var _a; return s + Number((_a = m.used) !== null && _a !== void 0 ? _a : 0); }, 0);
        const lapsed = months.reduce((s, m) => { var _a; return s + Number((_a = m.lapsed) !== null && _a !== void 0 ? _a : 0); }, 0);
        // Sum encashment debits from the ledger for this year
        const encashmentEntries = yield tx.leaveLedger.findMany({
            where: { employeeId, leaveTypeId, year, action: "ENCASHMENT" },
            select: { debit: true },
        });
        const encashed = encashmentEntries.reduce((s, e) => { var _a; return s + Number((_a = e.debit) !== null && _a !== void 0 ? _a : 0); }, 0);
        const closing = opening + credited - used - lapsed - encashed;
        yield tx.leaveYearlySummary.upsert({
            where: {
                employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year },
            },
            update: { opening, credited, used, lapsed, encashed, closing },
            create: { employeeId, leaveTypeId, year, opening, credited, used, lapsed, encashed, closing },
        });
        return { opening, credited, used, lapsed, closing };
    });
}
/**
 * If a leave spans multiple months, you should rebuild all touched months.
 */
function getTouchedMonths(startDate, endDate) {
    const s = atStartOfDay(startDate);
    const e = atStartOfDay(endDate);
    const out = [];
    const cursor = new Date(s);
    cursor.setDate(1);
    while (cursor <= e) {
        out.push({ year: getFinancialYear(cursor), month: cursor.getMonth() + 1 });
        cursor.setMonth(cursor.getMonth() + 1);
    }
    // de-dupe (safe)
    const keySet = new Set();
    return out.filter((x) => {
        const k = `${x.year}-${x.month}`;
        if (keySet.has(k))
            return false;
        keySet.add(k);
        return true;
    });
}
function insertLedgerTx(tx, params) {
    return __awaiter(this, void 0, void 0, function* () {
        const { employeeId, leaveTypeId, year, month, credit = 0, debit = 0, balanceAfter, action, referenceType, referenceId = null, performedBy = null, source = null, remarks = null, metadata = null, } = params;
        return tx.leaveLedger.create({
            data: {
                employeeId,
                leaveTypeId,
                year,
                month: month !== null && month !== void 0 ? month : null,
                transactionDate: new Date(),
                referenceType,
                referenceId,
                credit,
                debit,
                balanceAfter,
                action,
                performedBy,
                source,
                remarks,
                metadata,
            },
        });
    });
}
// ── Core EL accrual logic — called by cron AND manual trigger ──────────────
function runELAccrual(overrideYear, overrideMonth) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const today = atStartOfDay(new Date());
        const year = overrideYear !== null && overrideYear !== void 0 ? overrideYear : getFinancialYear(today);
        const month = overrideMonth !== null && overrideMonth !== void 0 ? overrideMonth : (today.getMonth() + 1);
        // 1️⃣ EL Leave Type
        const el = yield prisma_1.prisma.leaveType.findFirst({
            where: { name: "EL" },
            select: { id: true }
        });
        if (!el)
            return { error: "EL leave type not found" };
        // 2️⃣ Policy
        const policy = yield getActivePolicy(el.id, today);
        console.log("Active EL policy:", policy);
        if (!policy)
            return { error: "No active EL policy found" };
        if (policy.accrualType !== "MONTHLY")
            return { error: "EL policy is not MONTHLY accrual" };
        const monthlyCredit = Number((_a = policy.accrualRate) !== null && _a !== void 0 ? _a : 0);
        if (!monthlyCredit)
            return { error: "EL accrual rate is 0" };
        const workingDaysRequired = (_b = policy.workingDaysRequired) !== null && _b !== void 0 ? _b : 0;
        const maxBalance = (_c = policy.maxBalance) !== null && _c !== void 0 ? _c : null;
        // 3️⃣ Employees — only those who have completed 1 year of service
        const oneYearAgo = new Date(today);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const employees = yield prisma_1.prisma.employee.findMany({
            where: {
                employmentStatus: "ACTIVE",
                dateOfJoining: { lte: oneYearAgo },
            },
            select: { id: true },
        });
        let credited = 0, skipped = 0;
        const errors = [];
        // 4️⃣ Loop employees
        for (const emp of employees) {
            try {
                let didCredit = false;
                yield prisma_1.prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                    // ❗ Skip if already credited
                    const exists = yield tx.leaveAccrual.findUnique({
                        where: {
                            employeeId_leaveTypeId_year_month: {
                                employeeId: emp.id,
                                leaveTypeId: el.id,
                                year,
                                month
                            }
                        }
                    });
                    if (exists) {
                        skipped++;
                        return;
                    }
                    // 4.1️⃣ & 4.2️⃣ Working days check — PAUSED for now
                    // TODO: Uncomment when attendance data is ready
                    // const shift = await tx.shiftApproval.findFirst({
                    //   where: { employeeId: emp.id, status: "APPROVED", month, year },
                    //   select: { weekOffConfig: true }
                    // });
                    // const weekOffConfig = shift?.weekOffConfig ?? null;
                    // const workedDays = await getWorkedDaysOptimized(emp.id, year, month, weekOffConfig);
                    // if (workingDaysRequired && workedDays < workingDaysRequired) {
                    //   console.log(`❌ Skipping EL for emp ${emp.id}, worked: ${workedDays}`);
                    //   skipped++;
                    //   return;
                    // }
                    const workedDays = 'N/A (check paused)';
                    // 4.3️⃣ Balance row
                    const bal = yield tx.employeeLeaveBalance.upsert({
                        where: {
                            employeeId_leaveTypeId_year: {
                                employeeId: emp.id,
                                leaveTypeId: el.id,
                                year
                            }
                        },
                        update: {},
                        create: {
                            employeeId: emp.id,
                            leaveTypeId: el.id,
                            category: "LEAVE",
                            year,
                            totalAllowed: 0,
                            used: 0,
                            halfDayUsed: 0
                        }
                    });
                    // 4.4️⃣ Ledger balance
                    const prevBalance = yield getLastLedgerBalanceTx(tx, emp.id, el.id, year);
                    const credit = monthlyCredit;
                    if (credit <= 0) {
                        skipped++;
                        return;
                    }
                    // 4.5️⃣ Accrual record
                    yield tx.leaveAccrual.create({
                        data: {
                            employeeId: emp.id,
                            leaveTypeId: el.id,
                            year,
                            month,
                            accrualType: "MONTHLY",
                            daysCredited: credit
                        }
                    });
                    // 4.6️⃣ Balance update
                    yield tx.employeeLeaveBalance.update({
                        where: { id: bal.id },
                        data: {
                            totalAllowed: { increment: credit }
                        }
                    });
                    // 4.7️⃣ Ledger — credit
                    const balanceAfterCredit = prevBalance + credit;
                    yield insertLedgerTx(tx, {
                        employeeId: emp.id,
                        leaveTypeId: el.id,
                        year,
                        month,
                        credit,
                        debit: 0,
                        balanceAfter: balanceAfterCredit,
                        action: "CREDIT",
                        referenceType: "ACCRUAL",
                        source: "SYSTEM",
                        remarks: `EL credited (worked ${workedDays} days)`
                    });
                    // 4.7b️⃣ Auto-encash excess over maxBalance
                    if (maxBalance != null && balanceAfterCredit > maxBalance) {
                        const excessDays = balanceAfterCredit - maxBalance;
                        yield tx.employeeLeaveBalance.update({
                            where: { id: bal.id },
                            data: {
                                totalAllowed: { decrement: excessDays }
                            }
                        });
                        yield insertLedgerTx(tx, {
                            employeeId: emp.id,
                            leaveTypeId: el.id,
                            year,
                            month,
                            credit: 0,
                            debit: excessDays,
                            balanceAfter: maxBalance,
                            action: "ENCASHMENT",
                            referenceType: "ENCASHMENT",
                            source: "SYSTEM",
                            remarks: `EL auto-encashed ${excessDays} days (exceeded max balance ${maxBalance})`
                        });
                        console.log(`💰 EL auto-encashed ${excessDays} days for emp ${emp.id}`);
                    }
                    credited++;
                    didCredit = true;
                }), { timeout: 15000 });
                // 4.8️⃣ Summaries — outside transaction to avoid timeout
                if (didCredit) {
                    yield rebuildMonthlySummaryTx(prisma_1.prisma, emp.id, el.id, year, month);
                    yield rebuildYearlySummaryTx(prisma_1.prisma, emp.id, el.id, year);
                }
            }
            catch (err) {
                errors.push(`emp ${emp.id}: ${(_d = err === null || err === void 0 ? void 0 : err.message) !== null && _d !== void 0 ? _d : "unknown"}`);
            }
        }
        console.log(`✅ EL accrual done for ${year}-${month}: credited=${credited}, skipped=${skipped}`);
        return { year, month, totalEmployees: employees.length, credited, skipped, errors };
    });
}
// ── Manual trigger endpoint ────────────────────────────────────────────────
const triggerELAccrual = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const year = req.body.year ? Number(req.body.year) : undefined;
        const month = req.body.month ? Number(req.body.month) : undefined;
        const result = yield runELAccrual(year, month);
        return res.json(result);
    }
    catch (e) {
        console.error("Manual EL accrual error:", e);
        return res.status(500).json({ error: e.message });
    }
});
exports.triggerELAccrual = triggerELAccrual;
// ── Cron wrapper ───────────────────────────────────────────────────────────
const initELAccrualCron = () => {
    node_cron_1.default.schedule("10 2 1 * *", () => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield runELAccrual();
        }
        catch (e) {
            console.error("EL CRON ERROR:", e);
        }
    }));
};
exports.initELAccrualCron = initELAccrualCron;
function getLastLedgerBalanceTx(tx, employeeId, leaveTypeId, year) {
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
function getWeekOfMonth(date) {
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    const dayOfMonth = date.getDate();
    const adjusted = dayOfMonth + firstDay.getDay();
    return Math.ceil(adjusted / 7);
}
function isWeeklyOffFromConfig(config, date) {
    const day = date.getDay();
    if (!config) {
        return day === 0; // Sunday fallback
    }
    // Fixed weekly off
    if (config.fixedDays && Array.isArray(config.fixedDays)) {
        return config.fixedDays.includes(day);
    }
    // Rotational
    if (config.weeks && Array.isArray(config.weeks)) {
        const weekIndex = getWeekOfMonth(date) - 1;
        const offDay = config.weeks[weekIndex];
        if (offDay !== undefined) {
            return day === offDay;
        }
    }
    return day === 0;
}
function getWorkedDaysOptimized(employeeId, year, month, weekOffConfig) {
    return __awaiter(this, void 0, void 0, function* () {
        const calYear = getCalendarYear(year, month);
        const start = new Date(calYear, month - 1, 1);
        const end = new Date(calYear, month, 0, 23, 59, 59);
        console.log(`Calculating worked days for emp ${employeeId} in ${year}-${month}...`);
        console.log(`Date range: ${fmtDate(start)} to ${fmtDate(end)}`);
        const workedDates = new Set();
        // 1️⃣ Attendance
        const attendance = yield prisma_1.prisma.attendance.findMany({
            where: {
                employeeId,
                date: { gte: start, lte: end },
                status: "PRESENT"
            },
            select: { date: true }
        });
        console.log(`Attendance records for emp ${employeeId} in ${year}-${month}:`, attendance.length);
        attendance.forEach(a => {
            workedDates.add(atStartOfDay(a.date).toISOString());
        });
        // 2️⃣ Approved Leave
        const leaves = yield prisma_1.prisma.leaveRequest.findMany({
            where: {
                employeeId,
                status: "APPROVED",
                startDate: { lte: end },
                endDate: { gte: start }
            }
        });
        for (const l of leaves) {
            const from = new Date(Math.max(l.startDate.getTime(), start.getTime()));
            const to = new Date(Math.min(l.endDate.getTime(), end.getTime()));
            for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
                workedDates.add(atStartOfDay(d).toISOString());
            }
        }
        // 3️⃣ Remove weekly offs (NO DB CALL HERE 🔥)
        let finalCount = 0;
        for (const dateStr of workedDates) {
            const d = new Date(dateStr);
            if (!isWeeklyOffFromConfig(weekOffConfig, d)) {
                finalCount++;
            }
        }
        console.log(`Final worked days for emp ${employeeId} in ${year}-${month}: ${finalCount}`);
        return finalCount;
    });
}
const initNewJoineeLeaveAllocationCron = () => {
    node_cron_1.default.schedule("0 2 * * *", () => __awaiter(void 0, void 0, void 0, function* () {
        console.log("Running New Joinee Leave Allocation Cron...");
        const today = new Date();
        const employees = yield prisma_1.prisma.employee.findMany({
            where: {
                employmentStatus: "ACTIVE",
                probationEndDate: {
                    lte: today
                }
            }
        });
        for (const emp of employees) {
            if (!emp.probationEndDate)
                continue;
            const eligibleDate = new Date(emp.probationEndDate);
            // const eligibleDate = new Date(emp.probationEndDate);
            // 👉 Only trigger ONCE
            if (!isSameDate(eligibleDate, today))
                continue;
            const fy = getFinancialYearBounds(eligibleDate);
            // ✅ APPLY HALF-MONTH RULE
            let effectiveStart = new Date(eligibleDate);
            if (eligibleDate.getDate() > 15) {
                // skip current month → move to next month 1st
                effectiveStart = new Date(eligibleDate.getFullYear(), eligibleDate.getMonth() + 1, 1);
            }
            const months = getRemainingMonths(effectiveStart, fy.end);
            const CL_ANNUAL = 12;
            const SL_ANNUAL = 12;
            const cl = (CL_ANNUAL / 12) * months;
            const sl = (SL_ANNUAL / 12) * months;
            yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                yield allocateLeave(tx, emp.id, "CL", cl, fy.fyYear, effectiveStart);
                yield allocateLeave(tx, emp.id, "SL", sl, fy.fyYear, effectiveStart);
            }));
            console.log(`✅ Leave allocated for emp ${emp.id}: CL=${cl}, SL=${sl}`);
        }
    }));
};
exports.initNewJoineeLeaveAllocationCron = initNewJoineeLeaveAllocationCron;
function getRemainingMonths(from, to) {
    return ((to.getFullYear() - from.getFullYear()) * 12 +
        (to.getMonth() - from.getMonth()) + 1);
}
function getFinancialYearBounds(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    if (month >= 4) {
        return {
            start: new Date(year, 3, 1),
            end: new Date(year + 1, 2, 31),
            fyYear: year
        };
    }
    else {
        return {
            start: new Date(year - 1, 3, 1),
            end: new Date(year, 2, 31),
            fyYear: year - 1
        };
    }
}
function allocateLeave(tx, employeeId, leaveName, amount, year, date) {
    return __awaiter(this, void 0, void 0, function* () {
        const lt = yield tx.leaveType.findFirst({
            where: { name: leaveName }
        });
        if (!lt)
            return;
        const prevBalance = yield getLastLedgerBalanceTx(tx, employeeId, lt.id, year);
        const newBalance = prevBalance + amount;
        // 1️⃣ Balance Table
        yield tx.employeeLeaveBalance.upsert({
            where: {
                employeeId_leaveTypeId_year: {
                    employeeId,
                    leaveTypeId: lt.id,
                    year
                }
            },
            update: {
                totalAllowed: amount
            },
            create: {
                employeeId,
                leaveTypeId: lt.id,
                category: "LEAVE",
                year,
                totalAllowed: amount,
                used: 0,
                halfDayUsed: 0
            }
        });
        // 2️⃣ Ledger Entry
        yield insertLedgerTx(tx, {
            employeeId,
            leaveTypeId: lt.id,
            year,
            month: date.getMonth() + 1,
            credit: amount,
            debit: 0,
            balanceAfter: newBalance,
            action: "OPENING_BALANCE",
            referenceType: "MANUAL",
            source: "SYSTEM",
            remarks: "Auto allocation after probation"
        });
        // 3️⃣ Summaries
        yield rebuildMonthlySummaryTx(tx, employeeId, lt.id, year, date.getMonth() + 1);
        yield rebuildYearlySummaryTx(tx, employeeId, lt.id, year);
    });
}
function getFinancialYear(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    return month >= 4 ? year : year - 1;
}
function getPrevMonthFY(year, month) {
    if (month === 4) {
        return { year: year - 1, month: 3 }; // March of previous FY
    }
    return { year, month: month - 1 };
}
function getCalendarYear(fyYear, month) {
    return month >= 4 ? fyYear : fyYear + 1;
}
const bulkUploadLeaveBalancesExcel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const form = (0, formidable_1.default)({ multiples: false, keepExtensions: true });
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            if (err) {
                return res.status(500).json({ error: "File parsing error" });
            }
            const fileObj = Array.isArray(files.file) ? files.file[0] : files.file;
            if (!fileObj) {
                return res.status(400).json({ error: "No file uploaded" });
            }
            // =========================
            // 📥 READ EXCEL
            // =========================
            const workbook = XLSX.readFile(fileObj.filepath);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet);
            // =========================
            // 🔧 PREP DATA
            // =========================
            const year = fields.year ? Number(fields.year) : getFinancialYear(new Date());
            const month = fields.month ? Number(fields.month) : new Date().getMonth() + 1;
            const [leaveTypes, employees] = yield Promise.all([
                prisma_1.prisma.leaveType.findMany(),
                prisma_1.prisma.employee.findMany({
                    select: { id: true, employeeCode: true }
                })
            ]);
            const leaveTypeMap = {};
            leaveTypes.forEach(lt => {
                leaveTypeMap[lt.name.toUpperCase()] = lt.id;
            });
            const employeeMap = new Map();
            employees.forEach(emp => {
                employeeMap.set(emp.employeeCode, emp.id);
            });
            const logs = [];
            const errorRows = [];
            const affected = new Set();
            const limit = (0, p_limit_1.default)(5); // prevent DB overload
            // =========================
            // PROCESS EACH ROW
            // =========================
            const processRow = (row, index) => __awaiter(void 0, void 0, void 0, function* () {
                var _a;
                // Normalize: find the employee code regardless of header casing/spacing
                const code = row.employeeCode
                    || row["Emp Code"]
                    || row["emp code"]
                    || row["EmpCode"]
                    || row["empCode"]
                    || row["Employee Code"]
                    || row["employee code"]
                    || ((_a = Object.entries(row).find(([k]) => k.trim().toLowerCase().replace(/\s+/g, '') === 'empcode')) === null || _a === void 0 ? void 0 : _a[1]);
                console.log(code);
                try {
                    if (!code)
                        throw new Error("employeeCode missing");
                    const employeeId = employeeMap.get(String(code).trim());
                    if (!employeeId) {
                        throw new Error(`Employee not found: ${code}`);
                    }
                    for (const key of ["CL", "SL", "EL"]) {
                        const leaveTypeId = leaveTypeMap[key];
                        if (!leaveTypeId)
                            continue;
                        // const newTotal = Number(row[key] ?? 0);
                        const rawValue = row[key];
                        // SKIP empty cells (IMPORTANT FIX)
                        if (rawValue === undefined ||
                            rawValue === null ||
                            String(rawValue).trim() === "") {
                            continue;
                        }
                        const newTotal = Number(rawValue);
                        //Validate numeric
                        if (isNaN(newTotal)) {
                            throw new Error(`${key} must be a valid number`);
                        }
                        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
                            var _a;
                            const existing = yield tx.employeeLeaveBalance.findFirst({
                                where: { employeeId, leaveTypeId, year }
                            });
                            const prevTotal = (_a = existing === null || existing === void 0 ? void 0 : existing.totalAllowed) !== null && _a !== void 0 ? _a : 0;
                            const delta = newTotal - prevTotal;
                            // UPSERT BALANCE
                            yield tx.employeeLeaveBalance.upsert({
                                where: {
                                    employeeId_leaveTypeId_year: {
                                        employeeId,
                                        leaveTypeId,
                                        year
                                    }
                                },
                                update: {
                                    totalAllowed: newTotal
                                },
                                create: {
                                    employeeId,
                                    leaveTypeId,
                                    category: "LEAVE",
                                    year,
                                    totalAllowed: newTotal,
                                    used: 0,
                                    halfDayUsed: 0
                                }
                            });
                            // LEDGER
                            if (delta !== 0) {
                                const prevBalance = yield getLastLedgerBalanceTx(tx, employeeId, leaveTypeId, year);
                                const newBalance = prevBalance + delta;
                                yield insertLedgerTx(tx, {
                                    employeeId,
                                    leaveTypeId,
                                    year,
                                    month,
                                    credit: delta > 0 ? delta : 0,
                                    debit: delta < 0 ? Math.abs(delta) : 0,
                                    balanceAfter: newBalance,
                                    action: "ADJUSTMENT",
                                    referenceType: "MANUAL",
                                    source: "IMPORT",
                                    remarks: "Excel bulk upload"
                                });
                            }
                        }), { timeout: 10000 });
                        affected.add(`${employeeId}-${leaveTypeId}`);
                    }
                    logs.push(`Row ${index + 1}: SUCCESS (${code})`);
                }
                catch (error) {
                    errorRows.push(Object.assign({ rowNumber: index + 1, employeeCode: code, error: error.message }, row));
                    logs.push(`Row ${index + 1}: FAILED → ${error.message}`);
                }
            });
            //  Controlled parallel execution
            yield Promise.all(rows.map((row, i) => limit(() => processRow(row, i))));
            // =========================
            // REBUILD SUMMARIES (ONCE)
            // =========================
            for (const key of affected) {
                const [employeeId, leaveTypeId] = key.split("-").map(Number);
                yield rebuildMonthlySummaryTx(prisma_1.prisma, employeeId, leaveTypeId, year, month);
                yield rebuildYearlySummaryTx(prisma_1.prisma, employeeId, leaveTypeId, year);
            }
            return res.json({
                totalRows: rows.length,
                successCount: rows.length - errorRows.length,
                failedCount: errorRows.length,
                logs,
                errors: errorRows
            });
        }));
    }
    catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Excel bulk upload failed" });
    }
});
exports.bulkUploadLeaveBalancesExcel = bulkUploadLeaveBalancesExcel;
// ── Core rollover logic — called by cron AND manual trigger ──────────────────
function runFYRollover(overrideYear) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const today = atStartOfDay(new Date());
        const newYear = overrideYear !== null && overrideYear !== void 0 ? overrideYear : getFinancialYear(today);
        const prevYear = newYear - 1;
        const month = 4; // April — first month of Indian FY
        let processed = 0;
        let skipped = 0;
        const errors = [];
        const [employees, leaveTypes] = yield Promise.all([
            prisma_1.prisma.employee.findMany({
                where: { employmentStatus: "ACTIVE" },
                select: { id: true },
            }),
            prisma_1.prisma.leaveType.findMany(),
        ]);
        console.log('hi');
        const leaveTypeMap = {};
        leaveTypes.forEach(lt => { leaveTypeMap[lt.name.toUpperCase()] = lt.id; });
        for (const emp of employees) {
            try {
                // ── Idempotency: read-only check outside any transaction ──────────────
                const alreadyProcessed = yield prisma_1.prisma.leaveLedger.findFirst({
                    where: { employeeId: emp.id, year: newYear, action: "OPENING_BALANCE", source: "SYSTEM" },
                    select: { id: true },
                });
                if (alreadyProcessed) {
                    skipped++;
                    continue;
                }
                // =====================================================
                // 🔹 CL — NO CARRY FORWARD (policy: lapses at year-end)
                // ── Small tx: writes only. Rebuilds happen outside. ──
                // =====================================================
                const clId = leaveTypeMap["CL"];
                let clLapsedPrev = false;
                let clPrevRemaining = 0;
                if (clId) {
                    yield prisma_1.prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                        // Use ledger balance as source of truth — balance table may be out of sync
                        const prevCLLedger = yield getLastLedgerBalanceTx(tx, emp.id, clId, prevYear);
                        clPrevRemaining = Math.max(0, prevCLLedger);
                        if (clPrevRemaining > 0) {
                            yield insertLedgerTx(tx, {
                                employeeId: emp.id, leaveTypeId: clId, year: prevYear, month: 3,
                                credit: 0, debit: clPrevRemaining, balanceAfter: 0,
                                action: "LAPSE", referenceType: "LAPSE", source: "SYSTEM", remarks: "CL year-end lapse",
                            });
                            clLapsedPrev = true;
                        }
                        const totalCL = 12;
                        yield tx.employeeLeaveBalance.upsert({
                            where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: clId, year: newYear } },
                            update: { totalAllowed: totalCL, used: 0, halfDayUsed: 0 },
                            create: { employeeId: emp.id, leaveTypeId: clId, category: "LEAVE", year: newYear, totalAllowed: totalCL, used: 0, halfDayUsed: 0 },
                        });
                        const clPrevBal = yield getLastLedgerBalanceTx(tx, emp.id, clId, newYear);
                        yield insertLedgerTx(tx, {
                            employeeId: emp.id, leaveTypeId: clId, year: newYear, month,
                            credit: totalCL, debit: 0, balanceAfter: clPrevBal + totalCL,
                            action: "OPENING_BALANCE", referenceType: "MANUAL", source: "SYSTEM", remarks: "CL yearly allocation",
                        });
                    }), { timeout: 8000 });
                    // Rebuild OUTSIDE transaction (avoids P2028 / P1017 timeout)
                    if (clLapsedPrev) {
                        // Pass clPrevRemaining as openingOverride so March opening is correct
                        // even when earlier monthly summaries are missing.
                        yield rebuildMonthlySummaryTx(prisma_1.prisma, emp.id, clId, prevYear, 3, clPrevRemaining);
                        yield rebuildYearlySummaryTx(prisma_1.prisma, emp.id, clId, prevYear);
                    }
                    yield rebuildMonthlySummaryTx(prisma_1.prisma, emp.id, clId, newYear, month);
                    yield rebuildYearlySummaryTx(prisma_1.prisma, emp.id, clId, newYear);
                }
                // =====================================================
                // 🔹 SL — CARRY FORWARD MAX 60 DAYS
                // =====================================================
                const slId = leaveTypeMap["SL"];
                let slLapsedPrev = false;
                let slPrevRemaining = 0;
                if (slId) {
                    yield prisma_1.prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                        // Use ledger balance as source of truth — balance table may be out of sync
                        const prevSLLedger = yield getLastLedgerBalanceTx(tx, emp.id, slId, prevYear);
                        slPrevRemaining = Math.max(0, prevSLLedger);
                        const slCarry = Math.min(slPrevRemaining, 60);
                        const slLapsed = slPrevRemaining - slCarry;
                        if (slLapsed > 0) {
                            yield insertLedgerTx(tx, {
                                employeeId: emp.id, leaveTypeId: slId, year: prevYear, month: 3,
                                credit: 0, debit: slLapsed, balanceAfter: prevSLLedger - slLapsed,
                                action: "LAPSE", referenceType: "LAPSE", source: "SYSTEM",
                                remarks: "SL year-end lapse (excess over 60-day carry limit)",
                            });
                            slLapsedPrev = true;
                        }
                        const totalSL = 12 + slCarry;
                        yield tx.employeeLeaveBalance.upsert({
                            where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: slId, year: newYear } },
                            update: { totalAllowed: totalSL, used: 0, halfDayUsed: 0 },
                            create: { employeeId: emp.id, leaveTypeId: slId, category: "LEAVE", year: newYear, totalAllowed: totalSL, used: 0, halfDayUsed: 0 },
                        });
                        const slPrevBal = yield getLastLedgerBalanceTx(tx, emp.id, slId, newYear);
                        yield insertLedgerTx(tx, {
                            employeeId: emp.id, leaveTypeId: slId, year: newYear, month,
                            credit: totalSL, debit: 0, balanceAfter: slPrevBal + totalSL,
                            action: "OPENING_BALANCE", referenceType: "MANUAL", source: "SYSTEM",
                            remarks: `SL yearly allocation (12 fresh + ${slCarry} carried)`,
                        });
                    }), { timeout: 8000 });
                    if (slLapsedPrev) {
                        yield rebuildMonthlySummaryTx(prisma_1.prisma, emp.id, slId, prevYear, 3, slPrevRemaining);
                        yield rebuildYearlySummaryTx(prisma_1.prisma, emp.id, slId, prevYear);
                    }
                    yield rebuildMonthlySummaryTx(prisma_1.prisma, emp.id, slId, newYear, month);
                    yield rebuildYearlySummaryTx(prisma_1.prisma, emp.id, slId, newYear);
                }
                // =====================================================
                // 🔹 EL — POLICY-BASED CARRY FORWARD
                // =====================================================
                const elId = leaveTypeMap["EL"];
                let elLapsedPrev = false;
                let elPrevRemaining = 0;
                if (elId) {
                    // Fetch policy OUTSIDE tx (read-only, no need to hold a connection)
                    const elPolicy = yield getActivePolicy(elId, today);
                    yield prisma_1.prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                        // Use ledger balance as source of truth — balance table may be out of sync
                        const prevELLedger = yield getLastLedgerBalanceTx(tx, emp.id, elId, prevYear);
                        elPrevRemaining = Math.max(0, prevELLedger);
                        let elCarry = 0;
                        console.log(`EL rollover for emp ${emp.id}: prevRemaining=${elPrevRemaining}, policy carryForward=${elPolicy === null || elPolicy === void 0 ? void 0 : elPolicy.carryForward}, maxCarryForward=${elPolicy === null || elPolicy === void 0 ? void 0 : elPolicy.maxCarryForward}`);
                        if (elPolicy === null || elPolicy === void 0 ? void 0 : elPolicy.carryForward) {
                            elCarry = elPolicy.maxCarryForward
                                ? Math.min(elPrevRemaining, elPolicy.maxCarryForward)
                                : elPrevRemaining;
                            console.log(`EL policy for emp ${emp.id}: carryForward=${elPolicy.carryForward}, maxCarryForward=${elPolicy.maxCarryForward}, prevRemaining=${elPrevRemaining}, calculatedCarry=${elCarry}`);
                        }
                        const elLapsed = elPrevRemaining - elCarry;
                        if (elLapsed > 0) {
                            yield insertLedgerTx(tx, {
                                employeeId: emp.id, leaveTypeId: elId, year: prevYear, month: 3,
                                credit: 0, debit: elLapsed, balanceAfter: prevELLedger - elLapsed,
                                action: "LAPSE", referenceType: "LAPSE", source: "SYSTEM",
                                remarks: "EL year-end lapse (excess over carry limit)",
                            });
                            elLapsedPrev = true;
                        }
                        yield tx.employeeLeaveBalance.upsert({
                            where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: elId, year: newYear } },
                            update: { totalAllowed: elCarry, used: 0, halfDayUsed: 0 },
                            create: { employeeId: emp.id, leaveTypeId: elId, category: "LEAVE", year: newYear, totalAllowed: elCarry, used: 0, halfDayUsed: 0 },
                        });
                        if (elCarry > 0) {
                            const elPrevBal = yield getLastLedgerBalanceTx(tx, emp.id, elId, newYear);
                            yield insertLedgerTx(tx, {
                                employeeId: emp.id, leaveTypeId: elId, year: newYear, month,
                                credit: elCarry, debit: 0, balanceAfter: elPrevBal + elCarry,
                                action: "OPENING_BALANCE", referenceType: "MANUAL", source: "SYSTEM",
                                remarks: "EL carry forward",
                            });
                        }
                    }), { timeout: 8000 });
                    if (elLapsedPrev) {
                        yield rebuildMonthlySummaryTx(prisma_1.prisma, emp.id, elId, prevYear, 3, elPrevRemaining);
                        yield rebuildYearlySummaryTx(prisma_1.prisma, emp.id, elId, prevYear);
                    }
                    yield rebuildMonthlySummaryTx(prisma_1.prisma, emp.id, elId, newYear, month);
                    yield rebuildYearlySummaryTx(prisma_1.prisma, emp.id, elId, newYear);
                }
                processed++;
            }
            catch (err) {
                errors.push(`emp ${emp.id}: ${(_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : "unknown error"}`);
                console.error(`❌ FY rollover failed for emp ${emp.id}:`, err);
            }
        }
        return { processed, skipped, errors };
    });
}
// ── Cron wrapper ─────────────────────────────────────────────────────────────
const initFinancialYearRolloverCron = () => {
    node_cron_1.default.schedule("0 2 1 4 *", () => __awaiter(void 0, void 0, void 0, function* () {
        console.log("🚀 Running FY Rollover Cron...");
        const result = yield runFYRollover();
        console.log(`✅ FY rollover done — processed: ${result.processed}, skipped: ${result.skipped}, errors: ${result.errors.length}`);
        if (result.errors.length)
            console.error("FY rollover errors:", result.errors);
    }));
};
exports.initFinancialYearRolloverCron = initFinancialYearRolloverCron;
// ── Purge wrong rollover data + re-run ───────────────────────────────────────
const purgeAndRerunFYRollover = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const year = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.year) ? Number(req.body.year) : 2026;
    const prevYear = year - 1;
    try {
        console.log(`🗑️ Purging FY ${year} rollover data (prev year lapse entries from ${prevYear})...`);
        // 1. Delete all ledger entries for the target year (opening balances etc.)
        const deletedLedger2026 = yield prisma_1.prisma.leaveLedger.deleteMany({
            where: { year },
        });
        // 2. Delete LAPSE entries added for prevYear month=3 during the wrong rollover
        const deletedLapse2025 = yield prisma_1.prisma.leaveLedger.deleteMany({
            where: {
                year: prevYear,
                month: 3,
                action: 'LAPSE',
                source: 'SYSTEM',
            },
        });
        // 3. Delete EmployeeLeaveBalance for target year
        const deletedBalance = yield prisma_1.prisma.employeeLeaveBalance.deleteMany({
            where: { year },
        });
        // 4. Delete monthly/yearly summaries for target year
        const deletedMonthly2026 = yield prisma_1.prisma.leaveMonthlySummary.deleteMany({
            where: { year },
        });
        const deletedYearly2026 = yield prisma_1.prisma.leaveYearlySummary.deleteMany({
            where: { year },
        });
        // 5. Delete prevYear month=3 summaries (rebuilt wrongly during bad rollover)
        const deletedMonthly2025 = yield prisma_1.prisma.leaveMonthlySummary.deleteMany({
            where: { year: prevYear, month: 3 },
        });
        const deletedYearly2025 = yield prisma_1.prisma.leaveYearlySummary.deleteMany({
            where: { year: prevYear },
        });
        console.log(`✅ Purge complete — ledger:${deletedLedger2026.count}, lapse:${deletedLapse2025.count}, balance:${deletedBalance.count}, monthly2026:${deletedMonthly2026.count}, yearly2026:${deletedYearly2026.count}, monthly2025march:${deletedMonthly2025.count}, yearly2025:${deletedYearly2025.count}`);
        // 6. Re-run rollover with clean data
        console.log(`🚀 Re-running FY rollover for year ${year}...`);
        const result = yield runFYRollover(year);
        return res.json({
            message: `FY ${year} data purged and rollover re-run successfully`,
            purged: {
                ledger2026: deletedLedger2026.count,
                lapse2025: deletedLapse2025.count,
                balance2026: deletedBalance.count,
                monthly2026: deletedMonthly2026.count,
                yearly2026: deletedYearly2026.count,
                monthly2025March: deletedMonthly2025.count,
                yearly2025: deletedYearly2025.count,
            },
            rollover: result,
        });
    }
    catch (err) {
        console.error('Purge + re-run failed:', err);
        return res.status(500).json({ error: 'Purge failed', message: err === null || err === void 0 ? void 0 : err.message });
    }
});
exports.purgeAndRerunFYRollover = purgeAndRerunFYRollover;
// ── Manual trigger (admin endpoint handler) ───────────────────────────────────
const triggerFYRollover = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const overrideYear = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.year) ? Number(req.body.year) : undefined;
        console.log(`🔧 Manual FY rollover triggered${overrideYear ? ` for year ${overrideYear}` : ""}`);
        const result = yield runFYRollover(overrideYear);
        return res.json(Object.assign({ message: "FY rollover completed", year: overrideYear !== null && overrideYear !== void 0 ? overrideYear : getFinancialYear(new Date()) }, result));
    }
    catch (err) {
        console.error("Manual FY rollover failed:", err);
        return res.status(500).json({ error: "FY rollover failed", message: err === null || err === void 0 ? void 0 : err.message });
    }
});
exports.triggerFYRollover = triggerFYRollover;
function uploadToFTP(localFilePath, remoteFileName) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = false;
        try {
            yield client.access(FTP_CONFIG);
            const folder = path_1.default.dirname(remoteFileName);
            yield client.ensureDir(folder);
            console.log(remoteFileName);
            yield client.uploadFrom(localFilePath, remoteFileName);
            yield client.close();
            // return `https://hrproindia.in/documents/${remoteFileName}`; // public URL
        }
        catch (error) {
            console.error("FTP Upload Error:", error);
            throw new Error("FTP upload failed");
        }
    });
}
const uploadPrescription = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { leaveId } = req.params;
        const leave = yield prisma_1.prisma.leaveRequest.findUnique({
            where: { id: Number(leaveId) },
            include: { leaveType: true }
        });
        if (!leave) {
            return res.status(404).json({ error: "Leave not found" });
        }
        if (leave.leaveType.name !== "SL") {
            return res.status(400).json({
                error: "Prescription allowed only for Sick Leave"
            });
        }
        const form = (0, formidable_1.default)({
            multiples: false,
            keepExtensions: true,
            maxFileSize: 10 * 1024 * 1024,
            filter: part => { var _a, _b; return (_b = (_a = part.mimetype) === null || _a === void 0 ? void 0 : _a.startsWith("image/")) !== null && _b !== void 0 ? _b : false; },
        });
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            if (err) {
                return res.status(400).json({ error: "Upload failed" });
            }
            const prescription = files.prescription;
            if (!prescription) {
                return res.status(400).json({
                    error: "Prescription image is required"
                });
            }
            // ✅ Safely handle File | File[]
            const file = Array.isArray(prescription)
                ? prescription[0]
                : prescription;
            if (!file.filepath) {
                return res.status(400).json({ error: "Invalid file" });
            }
            const ext = path_1.default.extname(file.originalFilename || "") || ".jpg";
            const safeName = `prescription_${Date.now()}${ext}`;
            const remotePath = `/public_html/leave-prescriptions/${safeName}`;
            const publicUrl = `https://hrproindia.in/leave-prescriptions/${safeName}`;
            yield uploadToFTP(file.filepath, remotePath);
            fs_1.default.unlinkSync(file.filepath);
            yield prisma_1.prisma.leaveRequest.update({
                where: { id: Number(leaveId) },
                data: { prescriptionUrl: publicUrl }
            });
            return res.status(200).json({
                message: "Prescription uploaded successfully",
                prescriptionUrl: publicUrl
            });
        }));
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: "Upload failed" });
    }
});
exports.uploadPrescription = uploadPrescription;
