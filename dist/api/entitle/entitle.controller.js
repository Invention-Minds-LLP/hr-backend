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
exports.getEmployeeRequests = exports.getEmployeeUsageSummary = exports.getEntitlementPolicyByYear = exports.getAllEntitlementPolicies = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// GET all entitlement policies
const getAllEntitlementPolicies = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const policies = yield prisma.entitlementPolicy.findMany({
            orderBy: { year: 'desc' },
        });
        res.json(policies);
    }
    catch (error) {
        console.error('Error fetching entitlement policies:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.getAllEntitlementPolicies = getAllEntitlementPolicies;
// GET entitlement policy by year
const getEntitlementPolicyByYear = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const year = parseInt(req.params.year, 10);
    if (isNaN(year)) {
        res.status(400).json({ error: 'Year must be a valid number' });
        return;
    }
    try {
        const policy = yield prisma.entitlementPolicy.findFirst({
            where: { year },
        });
        if (!policy) {
            res.status(404).json({ error: 'Entitlement policy not found for the given year' });
            return;
        }
        res.json(policy);
    }
    catch (error) {
        console.error('Error fetching entitlement policy by year:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.getEntitlementPolicyByYear = getEntitlementPolicyByYear;
const getEmployeeUsageSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employees = yield prisma.employee.findMany({
            include: {
                Department: true,
                shifts: {
                    where: { date: { lte: new Date() } },
                    orderBy: { date: 'desc' },
                    take: 1,
                    include: { shift: true },
                },
                leaveRequests: {
                    where: { status: client_1.LeaveStatus.APPROVED },
                },
                WFHRequest: {
                    where: { status: client_1.WFHStatus.APPROVED },
                },
                permissions: {
                    where: { status: client_1.PermissionStatus.APPROVED },
                },
            },
        });
        const summary = employees.map(emp => {
            var _a;
            const totalLeaveDays = emp.leaveRequests.reduce((sum, leave) => {
                const days = Math.ceil((leave.endDate.getTime() - leave.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                return sum + days;
            }, 0);
            const totalWFHDays = emp.WFHRequest.reduce((sum, wfh) => {
                const days = Math.ceil((wfh.endDate.getTime() - wfh.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                return sum + days;
            }, 0);
            const totalPermissionHours = emp.permissions.reduce((sum, perm) => {
                switch (perm.timing) {
                    case 'HOURLY':
                        if (perm.startTime && perm.endTime) {
                            const hours = (perm.endTime.getTime() - perm.startTime.getTime()) / (1000 * 60 * 60);
                            return sum + hours;
                        }
                        return sum;
                    case 'HALFDAY':
                        return sum + 4; // You can adjust this based on your company's policy
                    case 'FULLDAY':
                        return sum + 8; // Standard full working day
                    default:
                        return sum;
                }
            }, 0);
            return {
                id: emp.id,
                name: `${emp.firstName} ${emp.lastName}`,
                email: emp.email,
                phone: emp.phone,
                employeeCode: emp.employeeCode,
                department: emp.departmentId,
                designation: emp.designation,
                employmentType: emp.employmentType,
                shiftType: ((_a = emp.shifts[0]) === null || _a === void 0 ? void 0 : _a.shift.shiftType) || 'N/A',
                totalLeaveDays,
                totalWFHDays,
                totalPermissionHours,
            };
        });
        res.json(summary);
    }
    catch (error) {
        console.error('Error in getEmployeeUsageSummary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.getEmployeeUsageSummary = getEmployeeUsageSummary;
// export const getEmployeeRequests = async (req: Request, res: Response) => {
//     const employeeId = parseInt(req.params.id);
//     try {
//         const [leaveRequests, wfhRequests, permissionRequests] = await Promise.all([
//             await prisma.leaveRequest.findMany({
//                 where: { employeeId, status: 'APPROVED' },
//                 orderBy: { startDate: 'desc' },
//                 include: {
//                     leaveType: {
//                         select: { name: true }
//                     }
//                 }
//             }),
//             prisma.wFHRequest.findMany({
//                 where: { employeeId, status: 'APPROVED' },
//                 orderBy: { startDate: 'desc' },
//             }),
//             prisma.permissionRequest.findMany({
//                 where: { employeeId, status: 'APPROVED' },
//                 orderBy: { day: 'desc' },
//             }),
//         ]);
//         // Calculate the total counts
//         const totalLeaveRequests = leaveRequests.length;
//         const totalWFHRequests = wfhRequests.length;
//         const totalPermissionRequests = permissionRequests.length;
//         res.json({
//             leaveRequests,
//             totalLeaveRequests,
//             wfhRequests,
//             totalWFHRequests,
//             permissionRequests,
//             totalPermissionRequests,
//         });
//     } catch (error) {
//         console.error('Error fetching requests:', error);
//         res.status(500).json({ error: 'Internal server error' });
//     }
// };
const getEmployeeRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.id);
        if (Number.isNaN(employeeId)) {
            return res.status(400).json({ error: 'Invalid employee id' });
        }
        // 1) Get employee DOJ and policy for current year
        const now = new Date();
        const year = now.getFullYear();
        const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
        const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
        const employee = yield prisma.employee.findUnique({
            where: { id: employeeId },
            select: { dateOfJoining: true },
        });
        if (!employee)
            return res.status(404).json({ error: 'Employee not found' });
        const policy = yield prisma.entitlementPolicy.findFirst({
            where: { year },
            select: { leaveEntitlement: true, wfhEntitlement: true, permissionEntitlement: true },
        });
        if (!policy)
            return res.status(404).json({ error: `EntitlementPolicy not found for ${year}` });
        // 2) Fetch APPROVED rows (you can keep your includes)
        const [leaveRequests, wfhRequests, permissionRequests] = yield Promise.all([
            prisma.leaveRequest.findMany({
                where: { employeeId, status: 'APPROVED' },
                orderBy: { startDate: 'desc' },
                include: { leaveType: { select: { name: true } } },
            }),
            prisma.wFHRequest.findMany({
                where: { employeeId, status: 'APPROVED' },
                orderBy: { startDate: 'desc' },
            }),
            prisma.permissionRequest.findMany({
                where: { employeeId, status: 'APPROVED' },
                orderBy: { day: 'desc' },
            }),
        ]);
        // 3) Per-row days/hours within the YEAR window
        const leaveWithDays = leaveRequests.map(r => {
            const { s, e } = clampRangeToYear(r.startDate, r.endDate, yearStart, yearEnd);
            return Object.assign(Object.assign({}, r), { daysApproved: daysInclusive({ s, e }) });
        });
        const wfhWithDays = wfhRequests.map(r => {
            const { s, e } = clampRangeToYear(r.startDate, r.endDate, yearStart, yearEnd);
            return Object.assign(Object.assign({}, r), { daysApproved: daysInclusive({ s, e }) });
        });
        const permissionWithHours = permissionRequests.map(r => {
            return Object.assign(Object.assign({}, r), { hoursApproved: permissionHours(r.startTime, r.endTime, r.timing) });
        });
        // 4) Totals (within year)
        const totalLeaveDays = leaveWithDays.reduce((sum, r) => sum + (r.daysApproved || 0), 0);
        const totalWFHDays = wfhWithDays.reduce((sum, r) => sum + (r.daysApproved || 0), 0);
        const totalPermissionHours = permissionWithHours.reduce((sum, r) => sum + (r.hoursApproved || 0), 0);
        // 5) Prorate entitlements from DOJ month (month-based, matches your example:
        //    join Feb -> 11 months left -> 22 if 24/yr)
        const prorated = prorateByDOJ(employee.dateOfJoining, policy, year);
        return res.json({
            // detailed rows with computed fields
            leaveRequests: leaveWithDays,
            wfhRequests: wfhWithDays,
            permissionRequests: permissionWithHours,
            // totals
            totals: {
                totalLeaveDays,
                totalWFHDays,
                totalPermissionHours,
            },
            // month-based prorated entitlements for the year
            entitlements: prorated,
            // (optional) echo context used
            context: { year, yearStart, yearEnd, dateOfJoining: employee.dateOfJoining },
        });
    }
    catch (error) {
        console.error('Error fetching requests:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.getEmployeeRequests = getEmployeeRequests;
/* ---------- helpers ---------- */
function clampRangeToYear(start, end, yearStart, yearEnd) {
    const s = new Date(Math.max(new Date(start).getTime(), yearStart.getTime()));
    const e = new Date(Math.min(new Date(end).getTime(), yearEnd.getTime()));
    if (e < s)
        return { s, e: s }; // zero span
    return { s, e };
}
function daysInclusive(range) {
    const s = new Date(range.s);
    s.setUTCHours(0, 0, 0, 0);
    const e = new Date(range.e);
    e.setUTCHours(0, 0, 0, 0);
    return Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
}
function permissionHours(start, end, timing) {
    if (start && end) {
        const ms = new Date(end).getTime() - new Date(start).getTime();
        return Math.max(0, ms / 36e5);
    }
    if (!timing)
        return 0;
    switch (timing) {
        case 'FULLDAY': return 8;
        case 'HALFDAY': return 4;
        case 'HOURLY': return 1;
        default: return 0;
    }
}
/** Month-based proration: if joined this year, eligibleMonths = (12 - joinMonth).
 *  If joined before this year -> full 12; after this year -> 0. */
function prorateByDOJ(doj, policy, year) {
    const join = new Date(doj);
    let months = 12;
    if (join.getFullYear() === year) {
        months = 12 - join.getMonth(); // Feb (1) -> 11 months
    }
    else if (join.getFullYear() > year) {
        months = 0;
    } // if joined before this year -> 12 months
    const perMonth = (n) => (n / 12) * months;
    return {
        leaveEntitlement: round(perMonth(policy.leaveEntitlement), 2),
        wfhEntitlement: round(perMonth(policy.wfhEntitlement), 2),
        permissionEntitlement: round(perMonth(policy.permissionEntitlement), 2), // hours
        monthsEligible: months,
    };
}
function round(n, p = 2) { return Math.round(n * 10 ** p) / 10 ** p; }
