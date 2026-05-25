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
exports.exportTable = void 0;
const xlsx_1 = __importDefault(require("xlsx"));
const prisma_1 = require("../../lib/prisma");
// All dates in this export module render in IST (Asia/Kolkata). Using
// toISOString() for "YYYY-MM-DD" silently shifts dates back one day for any
// value stored as IST midnight (which becomes 18:30 the previous day in UTC),
// e.g. a leave applied for April 6 IST would export as April 5 — confusing.
// `en-CA` produces YYYY-MM-DD so the format matches the previous behaviour.
const fmt = (d) => d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '';
const fmtT = (d) => {
    if (!d)
        return '';
    const dt = new Date(d);
    const date = dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const time = dt.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
    return `${date} ${time}`;
};
const MONTH_NAMES = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const monthName = (m) => { var _a; return m ? ((_a = MONTH_NAMES[m]) !== null && _a !== void 0 ? _a : String(m)) : ''; };
function sendExcel(res, filename, headers, rows) {
    const wb = xlsx_1.default.utils.book_new();
    const ws = xlsx_1.default.utils.aoa_to_sheet([headers, ...rows]);
    xlsx_1.default.utils.book_append_sheet(wb, ws, 'Data');
    const buf = xlsx_1.default.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(buf);
}
function sendMultiSheetExcel(res, filename, sheets) {
    const wb = xlsx_1.default.utils.book_new();
    for (const sheet of sheets) {
        const ws = xlsx_1.default.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);
        xlsx_1.default.utils.book_append_sheet(wb, ws, sheet.name);
    }
    const buf = xlsx_1.default.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(buf);
}
function getEmployeeMap() {
    return __awaiter(this, void 0, void 0, function* () {
        const emps = yield prisma_1.prisma.employee.findMany({
            select: { id: true, firstName: true, lastName: true },
        });
        return new Map(emps.map(e => [e.id, `${e.firstName} ${e.lastName}`]));
    });
}
const exportTable = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const table = req.params.table;
    const { startDate, endDate, year, month, employeeId } = req.query;
    try {
        switch (table) {
            // ─── EMPLOYEE MASTER ──────────────────────────────────────────────────────
            case 'employee-master': {
                const [employees, addresses, qualifications, documents, emergencyContacts] = yield Promise.all([
                    prisma_1.prisma.employee.findMany({
                        include: {
                            Department: true,
                            Branch: true,
                            designation: true,
                            role: true,
                        },
                    }),
                    prisma_1.prisma.address.findMany({
                        include: {
                            employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        },
                    }),
                    prisma_1.prisma.qualification.findMany({
                        include: {
                            employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        },
                    }),
                    prisma_1.prisma.document.findMany({
                        include: {
                            employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        },
                    }),
                    prisma_1.prisma.emergencyContact.findMany({
                        include: {
                            employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        },
                    }),
                ]);
                const empMap = yield getEmployeeMap();
                // Sheet 1 — Master Details
                const masterHeaders = [
                    'Employee Code', 'Reference Code', 'First Name', 'Last Name', 'Full Name',
                    'Gender', 'Date of Birth', 'Age', 'Mobile Number', 'Alternate Mobile Number',
                    'Email Address', 'Department', 'Branch', 'Designation', 'Role',
                    'Reporting Manager', 'In Charge', 'Date of Joining', 'Employment Type',
                    'Employment Status', 'Probation End Date', 'Years of Experience', 'Marital Status',
                    'Father Name', 'Mother Name', 'PAN Number', 'Aadhaar Number', 'UAN Number',
                    'License Number', 'License Registration Date', 'License Expiry Date',
                    'Created On', 'Last Updated On',
                ];
                const masterRows = employees.map(e => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
                    return [
                        e.employeeCode,
                        (_a = e.referenceCode) !== null && _a !== void 0 ? _a : '',
                        e.firstName, e.lastName,
                        `${e.firstName} ${e.lastName}`, e.gender, fmt(e.dob),
                        (_b = e.age) !== null && _b !== void 0 ? _b : '',
                        e.phone,
                        (_c = e.alternatePhone) !== null && _c !== void 0 ? _c : '',
                        e.email,
                        e.Department.name, e.Branch.name,
                        (_e = (_d = e.designation) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : '',
                        e.role.name,
                        e.reportingManager ? ((_f = empMap.get(e.reportingManager)) !== null && _f !== void 0 ? _f : e.reportingManager) : '',
                        e.inchargeId ? ((_g = empMap.get(e.inchargeId)) !== null && _g !== void 0 ? _g : e.inchargeId) : '',
                        fmt(e.dateOfJoining), e.employmentType, e.employmentStatus,
                        fmt(e.probationEndDate),
                        (_h = e.totalYearsOfExperience) !== null && _h !== void 0 ? _h : '',
                        (_j = e.marital) !== null && _j !== void 0 ? _j : '',
                        (_k = e.fatherName) !== null && _k !== void 0 ? _k : '',
                        (_l = e.motherName) !== null && _l !== void 0 ? _l : '',
                        (_m = e.panNumber) !== null && _m !== void 0 ? _m : '',
                        (_o = e.aadharNumber) !== null && _o !== void 0 ? _o : '',
                        (_p = e.uanNumber) !== null && _p !== void 0 ? _p : '',
                        (_q = e.licenseNumber) !== null && _q !== void 0 ? _q : '',
                        fmt(e.licenseRegDate), fmt(e.licenseExpiryDate),
                        fmt(e.createdAt), fmt(e.updatedAt),
                    ];
                });
                // Sheet 2 — Addresses
                const addressHeaders = [
                    'Employee Code', 'Employee Name', 'Address Type', 'Address Line 1',
                    'Address Line 2', 'City', 'State', 'Postal Code', 'Country',
                    'Created On', 'Last Updated On',
                ];
                const addressRows = addresses.map(a => {
                    var _a;
                    return [
                        a.employee.employeeCode,
                        `${a.employee.firstName} ${a.employee.lastName}`,
                        a.type, a.line1,
                        (_a = a.line2) !== null && _a !== void 0 ? _a : '',
                        a.city, a.state, a.zipCode, a.country,
                        fmt(a.createdAt), fmt(a.updatedAt),
                    ];
                });
                // Sheet 3 — Qualifications
                const qualHeaders = [
                    'Employee Code', 'Employee Name', 'Degree', 'Degree Name', 'Institution',
                    'Year of Passing', 'Grade / Percentage', 'Created On', 'Last Updated On',
                ];
                const qualRows = qualifications.map(q => {
                    var _a, _b;
                    return [
                        q.employee.employeeCode,
                        `${q.employee.firstName} ${q.employee.lastName}`,
                        q.degree,
                        (_a = q.degreeName) !== null && _a !== void 0 ? _a : '',
                        q.institution, q.year,
                        (_b = q.grade) !== null && _b !== void 0 ? _b : '',
                        fmt(q.createdAt), fmt(q.updatedAt),
                    ];
                });
                // Sheet 4 — Documents
                const docHeaders = [
                    'Employee Code', 'Employee Name', 'Document Title', 'Document Type',
                    'Document Category', 'Issue Date', 'Expiry Date', 'File URL',
                    'Created On', 'Last Updated On',
                ];
                const docRows = documents.map(d => [
                    d.employee.employeeCode,
                    `${d.employee.firstName} ${d.employee.lastName}`,
                    d.title, d.type, d.category,
                    fmt(d.issueDate), fmt(d.expiryDate), d.fileUrl,
                    fmt(d.createdAt), fmt(d.updatedAt),
                ]);
                // Sheet 5 — Emergency Contacts
                const ecHeaders = [
                    'Employee Code', 'Employee Name', 'Contact Name', 'Contact Number',
                    'Relationship', 'Created On', 'Last Updated On',
                ];
                const ecRows = emergencyContacts.map(c => [
                    c.employee.employeeCode,
                    `${c.employee.firstName} ${c.employee.lastName}`,
                    c.name, c.phone, c.relationship,
                    fmt(c.createdAt), fmt(c.updatedAt),
                ]);
                sendMultiSheetExcel(res, 'Employee_Master', [
                    { name: 'Master Details', headers: masterHeaders, rows: masterRows },
                    { name: 'Addresses', headers: addressHeaders, rows: addressRows },
                    { name: 'Qualifications', headers: qualHeaders, rows: qualRows },
                    { name: 'Documents', headers: docHeaders, rows: docRows },
                    { name: 'Emergency Contacts', headers: ecHeaders, rows: ecRows },
                ]);
                break;
            }
            // ─── EMPLOYEE ADDRESSES ───────────────────────────────────────────────────
            case 'employee-addresses': {
                const addresses = yield prisma_1.prisma.address.findMany({
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Address Type', 'Address Line 1',
                    'Address Line 2', 'City', 'State', 'Postal Code', 'Country',
                    'Created On', 'Last Updated On',
                ];
                const rows = addresses.map(a => {
                    var _a;
                    return [
                        a.employee.employeeCode,
                        `${a.employee.firstName} ${a.employee.lastName}`,
                        a.type, a.line1,
                        (_a = a.line2) !== null && _a !== void 0 ? _a : '',
                        a.city, a.state, a.zipCode, a.country,
                        fmt(a.createdAt), fmt(a.updatedAt),
                    ];
                });
                sendExcel(res, 'Employee_Addresses', headers, rows);
                break;
            }
            // ─── EMERGENCY CONTACTS ───────────────────────────────────────────────────
            case 'emergency-contacts': {
                const contacts = yield prisma_1.prisma.emergencyContact.findMany({
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Contact Name', 'Contact Number',
                    'Relationship', 'Created On', 'Last Updated On',
                ];
                const rows = contacts.map(c => [
                    c.employee.employeeCode,
                    `${c.employee.firstName} ${c.employee.lastName}`,
                    c.name, c.phone, c.relationship,
                    fmt(c.createdAt), fmt(c.updatedAt),
                ]);
                sendExcel(res, 'Emergency_Contacts', headers, rows);
                break;
            }
            // ─── QUALIFICATIONS ───────────────────────────────────────────────────────
            case 'qualifications': {
                const quals = yield prisma_1.prisma.qualification.findMany({
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Degree', 'Degree Name', 'Institution',
                    'Year of Passing', 'Grade / Percentage', 'Created On', 'Last Updated On',
                ];
                const rows = quals.map(q => {
                    var _a, _b;
                    return [
                        q.employee.employeeCode,
                        `${q.employee.firstName} ${q.employee.lastName}`,
                        q.degree,
                        (_a = q.degreeName) !== null && _a !== void 0 ? _a : '',
                        q.institution, q.year,
                        (_b = q.grade) !== null && _b !== void 0 ? _b : '',
                        fmt(q.createdAt), fmt(q.updatedAt),
                    ];
                });
                sendExcel(res, 'Qualifications', headers, rows);
                break;
            }
            // ─── EMPLOYEE DOCUMENTS ───────────────────────────────────────────────────
            case 'employee-documents': {
                const docs = yield prisma_1.prisma.document.findMany({
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Document Title', 'Document Type',
                    'Document Category', 'Issue Date', 'Expiry Date', 'File URL',
                    'Created On', 'Last Updated On',
                ];
                const rows = docs.map(d => [
                    d.employee.employeeCode,
                    `${d.employee.firstName} ${d.employee.lastName}`,
                    d.title, d.type, d.category,
                    fmt(d.issueDate), fmt(d.expiryDate), d.fileUrl,
                    fmt(d.createdAt), fmt(d.updatedAt),
                ]);
                sendExcel(res, 'Employee_Documents', headers, rows);
                break;
            }
            // ─── ATTENDANCE ───────────────────────────────────────────────────────────
            case 'attendance': {
                const empMap = yield getEmployeeMap();
                const where = {};
                if (startDate || endDate) {
                    where.date = {};
                    if (startDate)
                        where.date.gte = new Date(startDate);
                    if (endDate)
                        where.date.lte = new Date(endDate);
                }
                if (employeeId)
                    where.employeeId = Number(employeeId);
                const att = yield prisma_1.prisma.attendance.findMany({
                    where,
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                    orderBy: [{ date: 'asc' }],
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Attendance Date', 'Attendance Status',
                    'Check In Time', 'Check Out Time', 'Reason', 'Approval Status',
                    'Approved By', 'Approved On', 'Marked By', 'Created On',
                ];
                const rows = att.map(a => {
                    var _a, _b, _c, _d;
                    return [
                        a.employee.employeeCode,
                        `${a.employee.firstName} ${a.employee.lastName}`,
                        fmt(a.date), a.status,
                        fmtT(a.checkIn), fmtT(a.checkOut),
                        (_a = a.reason) !== null && _a !== void 0 ? _a : '',
                        (_b = a.attendanceApproval) !== null && _b !== void 0 ? _b : '',
                        a.approvedBy ? ((_c = empMap.get(a.approvedBy)) !== null && _c !== void 0 ? _c : a.approvedBy) : '',
                        fmt(a.approvedAt),
                        a.createdBy ? ((_d = empMap.get(a.createdBy)) !== null && _d !== void 0 ? _d : a.createdBy) : '',
                        fmt(a.createdAt),
                    ];
                });
                sendExcel(res, 'Attendance', headers, rows);
                break;
            }
            // ─── LEAVE REQUESTS ───────────────────────────────────────────────────────
            case 'leave-requests': {
                const empMap = yield getEmployeeMap();
                const where = {};
                if (startDate || endDate) {
                    where.startDate = {};
                    if (startDate)
                        where.startDate.gte = new Date(startDate);
                    if (endDate)
                        where.startDate.lte = new Date(endDate);
                }
                if (employeeId)
                    where.employeeId = Number(employeeId);
                const leaves = yield prisma_1.prisma.leaveRequest.findMany({
                    where,
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        leaveType: { select: { name: true } },
                    },
                    orderBy: [{ createdAt: 'desc' }],
                });
                const headers = [
                    'Leave Request No', 'Employee Code', 'Employee Name', 'Leave Type',
                    'From Date', 'To Date', 'Reason', 'Leave Status', 'Half Day', 'Half Day Session',
                    'Approved By', 'Approved On', 'Rejected By', 'Rejected On', 'Rejection Reason',
                    'HOD Decision', 'HOD Remarks', 'HOD Decided On',
                    'HR Decision', 'HR Remarks', 'HR Decided On',
                    'In Charge Decision', 'In Charge Remarks', 'In Charge Decided On',
                    'Medical Certificate', 'Created On',
                ];
                const rows = leaves.map(l => {
                    var _a, _b, _c, _d, _e, _f, _g;
                    return [
                        l.id, l.employee.employeeCode,
                        `${l.employee.firstName} ${l.employee.lastName}`,
                        l.leaveType.name,
                        fmt(l.startDate), fmt(l.endDate),
                        l.reason, l.status,
                        l.isHalfDay ? 'Yes' : 'No',
                        (_a = l.halfDaySession) !== null && _a !== void 0 ? _a : '',
                        l.approvedBy ? ((_b = empMap.get(l.approvedBy)) !== null && _b !== void 0 ? _b : l.approvedBy) : '',
                        fmt(l.approvedDate),
                        l.declinedBy ? ((_c = empMap.get(l.declinedBy)) !== null && _c !== void 0 ? _c : l.declinedBy) : '',
                        fmt(l.declinedDate),
                        (_d = l.declineReason) !== null && _d !== void 0 ? _d : '',
                        l.hodDecision,
                        (_e = l.hodNote) !== null && _e !== void 0 ? _e : '',
                        fmt(l.hodDecidedAt),
                        l.hrDecision,
                        (_f = l.hrNote) !== null && _f !== void 0 ? _f : '',
                        fmt(l.hrDecidedAt),
                        l.inChargeDecision,
                        (_g = l.inChargeNote) !== null && _g !== void 0 ? _g : '',
                        fmt(l.inChargeDecidedAt),
                        l.prescriptionUrl ? 'Yes' : 'No',
                        fmt(l.createdAt),
                    ];
                });
                sendExcel(res, 'Leave_Requests', headers, rows);
                break;
            }
            // ─── LEAVE BALANCE ────────────────────────────────────────────────────────
            case 'leave-balance': {
                const where = {};
                if (year)
                    where.year = Number(year);
                const balances = yield prisma_1.prisma.employeeLeaveBalance.findMany({
                    where,
                    include: { leaveType: { select: { name: true } } },
                });
                const empIds = [...new Set(balances.map(b => b.employeeId))];
                const emps = yield prisma_1.prisma.employee.findMany({
                    where: { id: { in: empIds } },
                    select: { id: true, employeeCode: true, firstName: true, lastName: true },
                });
                const empDetailMap = new Map(emps.map(e => [e.id, e]));
                const headers = [
                    'Employee Code', 'Employee Name', 'Leave Type', 'Balance Year',
                    'Balance Category', 'Unlimited Balance', 'Total Allowed',
                    'Leave Used', 'Half Day Used', 'Available Balance',
                ];
                const rows = balances.map(b => {
                    var _a, _b, _c, _d, _e;
                    const emp = empDetailMap.get(b.employeeId);
                    const available = b.isUnlimited ? 'Unlimited' : b.totalAllowed - b.used;
                    return [
                        (_a = emp === null || emp === void 0 ? void 0 : emp.employeeCode) !== null && _a !== void 0 ? _a : '',
                        emp ? `${emp.firstName} ${emp.lastName}` : '',
                        (_d = (_c = (_b = b.leaveType) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : b.permissionType) !== null && _d !== void 0 ? _d : '',
                        b.year, b.category,
                        b.isUnlimited ? 'Yes' : 'No',
                        b.totalAllowed, b.used,
                        (_e = b.halfDayUsed) !== null && _e !== void 0 ? _e : 0,
                        available,
                    ];
                });
                sendExcel(res, 'Leave_Balance', headers, rows);
                break;
            }
            // ─── LEAVE MONTHLY SUMMARY ────────────────────────────────────────────────
            case 'leave-monthly-summary': {
                const where = {};
                if (year)
                    where.year = Number(year);
                if (month)
                    where.month = Number(month);
                const summaries = yield prisma_1.prisma.leaveMonthlySummary.findMany({ where });
                const empIds = [...new Set(summaries.map(s => s.employeeId))];
                const ltIds = [...new Set(summaries.map(s => s.leaveTypeId))];
                const [emps, lts] = yield Promise.all([
                    prisma_1.prisma.employee.findMany({
                        where: { id: { in: empIds } },
                        select: { id: true, employeeCode: true, firstName: true, lastName: true },
                    }),
                    prisma_1.prisma.leaveType.findMany({
                        where: { id: { in: ltIds } },
                        select: { id: true, name: true },
                    }),
                ]);
                const empDetailMap = new Map(emps.map(e => [e.id, e]));
                const ltMap = new Map(lts.map(l => [l.id, l.name]));
                const headers = [
                    'Employee Code', 'Employee Name', 'Leave Type', 'Year', 'Month',
                    'Opening Balance', 'Leave Credited', 'Leave Used', 'Leave Lapsed', 'Closing Balance',
                ];
                const rows = summaries.map(s => {
                    var _a, _b;
                    const emp = empDetailMap.get(s.employeeId);
                    return [
                        (_a = emp === null || emp === void 0 ? void 0 : emp.employeeCode) !== null && _a !== void 0 ? _a : '',
                        emp ? `${emp.firstName} ${emp.lastName}` : '',
                        (_b = ltMap.get(s.leaveTypeId)) !== null && _b !== void 0 ? _b : '',
                        s.year, monthName(s.month),
                        s.opening, s.credited, s.used, s.lapsed, s.closing,
                    ];
                });
                sendExcel(res, 'Leave_Monthly_Summary', headers, rows);
                break;
            }
            // ─── LEAVE YEARLY SUMMARY ─────────────────────────────────────────────────
            case 'leave-yearly-summary': {
                const where = {};
                if (year)
                    where.year = Number(year);
                const summaries = yield prisma_1.prisma.leaveYearlySummary.findMany({ where });
                const empIds = [...new Set(summaries.map(s => s.employeeId))];
                const ltIds = [...new Set(summaries.map(s => s.leaveTypeId))];
                const [emps, lts] = yield Promise.all([
                    prisma_1.prisma.employee.findMany({
                        where: { id: { in: empIds } },
                        select: { id: true, employeeCode: true, firstName: true, lastName: true },
                    }),
                    prisma_1.prisma.leaveType.findMany({
                        where: { id: { in: ltIds } },
                        select: { id: true, name: true },
                    }),
                ]);
                const empDetailMap = new Map(emps.map(e => [e.id, e]));
                const ltMap = new Map(lts.map(l => [l.id, l.name]));
                const headers = [
                    'Employee Code', 'Employee Name', 'Leave Type', 'Year',
                    'Opening Balance', 'Leave Credited', 'Leave Used',
                    'Leave Lapsed', 'Leave Encashed', 'Closing Balance',
                ];
                const rows = summaries.map(s => {
                    var _a, _b;
                    const emp = empDetailMap.get(s.employeeId);
                    return [
                        (_a = emp === null || emp === void 0 ? void 0 : emp.employeeCode) !== null && _a !== void 0 ? _a : '',
                        emp ? `${emp.firstName} ${emp.lastName}` : '',
                        (_b = ltMap.get(s.leaveTypeId)) !== null && _b !== void 0 ? _b : '',
                        s.year,
                        s.opening, s.credited, s.used, s.lapsed, s.encashed, s.closing,
                    ];
                });
                sendExcel(res, 'Leave_Yearly_Summary', headers, rows);
                break;
            }
            // ─── LEAVE ACCRUAL DETAILS ────────────────────────────────────────────────
            case 'leave-accrual-details': {
                const where = {};
                if (year)
                    where.year = Number(year);
                if (month)
                    where.month = Number(month);
                if (employeeId)
                    where.employeeId = Number(employeeId);
                const accruals = yield prisma_1.prisma.leaveAccrual.findMany({
                    where,
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        leaveType: { select: { name: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Leave Type', 'Year', 'Month',
                    'Accrual Type', 'Days Credited', 'Remarks', 'Created On',
                ];
                const rows = accruals.map(a => {
                    var _a;
                    return [
                        a.employee.employeeCode,
                        `${a.employee.firstName} ${a.employee.lastName}`,
                        a.leaveType.name, a.year, monthName(a.month),
                        a.accrualType, a.daysCredited,
                        (_a = a.remarks) !== null && _a !== void 0 ? _a : '',
                        fmt(a.createdAt),
                    ];
                });
                sendExcel(res, 'Leave_Accrual_Details', headers, rows);
                break;
            }
            // ─── LEAVE LEDGER ─────────────────────────────────────────────────────────
            case 'leave-ledger': {
                const where = {};
                if (year)
                    where.year = Number(year);
                if (month)
                    where.month = Number(month);
                if (employeeId)
                    where.employeeId = Number(employeeId);
                const ledgers = yield prisma_1.prisma.leaveLedger.findMany({
                    where,
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        leaveType: { select: { name: true } },
                        performedByUser: { select: { firstName: true, lastName: true } },
                    },
                    orderBy: [{ transactionDate: 'desc' }],
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Leave Type', 'Transaction Date',
                    'Year', 'Month', 'Reference Type', 'Credit', 'Debit',
                    'Balance After Transaction', 'Action', 'Performed By', 'Performed On',
                    'Source', 'Remarks', 'Created On',
                ];
                const rows = ledgers.map(l => {
                    var _a, _b;
                    return [
                        l.employee.employeeCode,
                        `${l.employee.firstName} ${l.employee.lastName}`,
                        l.leaveType.name,
                        fmt(l.transactionDate), l.year, monthName(l.month),
                        l.referenceType, l.credit, l.debit, l.balanceAfter,
                        l.action,
                        l.performedByUser
                            ? `${l.performedByUser.firstName} ${l.performedByUser.lastName}`
                            : '',
                        fmt(l.performedAt),
                        (_a = l.source) !== null && _a !== void 0 ? _a : '',
                        (_b = l.remarks) !== null && _b !== void 0 ? _b : '',
                        fmt(l.createdAt),
                    ];
                });
                sendExcel(res, 'Leave_Ledger', headers, rows);
                break;
            }
            // ─── LEAVE POLICY ─────────────────────────────────────────────────────────
            case 'leave-policy': {
                const policies = yield prisma_1.prisma.leavePolicy.findMany({
                    include: { leaveType: { select: { name: true } } },
                });
                const headers = [
                    'Leave Type', 'Policy Name', 'Accrual Type', 'Accrual Rate',
                    'Accrual Frequency', 'Maximum Balance', 'Carry Forward Allowed',
                    'Maximum Carry Forward', 'Negative Balance Allowed', 'Approval Required',
                    'Approval Levels', 'Include Probation', 'Exclude Weekends', 'Exclude Holidays',
                    'Document Required', 'Encashable', 'Effective From', 'Effective To', 'Created On',
                ];
                const rows = policies.map(p => {
                    var _a, _b, _c, _d, _e;
                    return [
                        p.leaveType.name, p.name, p.accrualType,
                        (_a = p.accrualRate) !== null && _a !== void 0 ? _a : '',
                        (_b = p.accrualFrequency) !== null && _b !== void 0 ? _b : '',
                        (_c = p.maxBalance) !== null && _c !== void 0 ? _c : '',
                        p.carryForward ? 'Yes' : 'No',
                        (_d = p.maxCarryForward) !== null && _d !== void 0 ? _d : '',
                        p.allowNegativeBalance ? 'Yes' : 'No',
                        p.requiresApproval ? 'Yes' : 'No',
                        (_e = p.approvalLevels) !== null && _e !== void 0 ? _e : '',
                        p.includeProbation ? 'Yes' : 'No',
                        p.excludeWeekends ? 'Yes' : 'No',
                        p.excludeHolidays ? 'Yes' : 'No',
                        p.requiresDocument ? 'Yes' : 'No',
                        p.encashable ? 'Yes' : 'No',
                        fmt(p.effectiveFrom), fmt(p.effectiveTo), fmt(p.createdAt),
                    ];
                });
                sendExcel(res, 'Leave_Policy', headers, rows);
                break;
            }
            // ─── ENTITLEMENT POLICY ───────────────────────────────────────────────────
            case 'entitlement-policy': {
                const policies = yield prisma_1.prisma.entitlementPolicy.findMany();
                const headers = [
                    'Year', 'Leave Entitlement', 'WFH Entitlement',
                    'Permission Entitlement', 'Created On', 'Last Updated On',
                ];
                const rows = policies.map(p => [
                    p.year, p.leaveEntitlement, p.wfhEntitlement,
                    p.permissionEntitlement, fmt(p.createdAt), fmt(p.updatedAt),
                ]);
                sendExcel(res, 'Entitlement_Policy', headers, rows);
                break;
            }
            // ─── PERMISSION REQUESTS ──────────────────────────────────────────────────
            case 'permission-requests': {
                const empMap = yield getEmployeeMap();
                const where = {};
                if (startDate || endDate) {
                    where.day = {};
                    if (startDate)
                        where.day.gte = new Date(startDate);
                    if (endDate)
                        where.day.lte = new Date(endDate);
                }
                if (employeeId)
                    where.employeeId = Number(employeeId);
                const perms = yield prisma_1.prisma.permissionRequest.findMany({
                    where,
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                    orderBy: [{ day: 'desc' }],
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Permission Date', 'Start Time', 'End Time',
                    'Permission Type', 'Permission Duration (mins)', 'Reason', 'Request Status',
                    'Approved By', 'Approved On', 'Rejected By', 'Rejected On', 'Rejection Reason',
                    'HOD Decision', 'HR Decision', 'In Charge Decision', 'Created On',
                ];
                const rows = perms.map(p => {
                    var _a, _b, _c, _d;
                    const durationMins = p.startTime && p.endTime
                        ? Math.round((new Date(p.endTime).getTime() - new Date(p.startTime).getTime()) / 60000)
                        : '';
                    return [
                        p.employee.employeeCode,
                        `${p.employee.firstName} ${p.employee.lastName}`,
                        fmt(p.day), fmtT(p.startTime), fmtT(p.endTime),
                        (_a = p.permissionType) !== null && _a !== void 0 ? _a : '',
                        durationMins, p.reason, p.status,
                        p.approvedBy ? ((_b = empMap.get(p.approvedBy)) !== null && _b !== void 0 ? _b : p.approvedBy) : '',
                        fmt(p.approvedDate),
                        p.declinedBy ? ((_c = empMap.get(p.declinedBy)) !== null && _c !== void 0 ? _c : p.declinedBy) : '',
                        fmt(p.declinedDate),
                        (_d = p.declineReason) !== null && _d !== void 0 ? _d : '',
                        p.hodDecision, p.hrDecision, p.inChargeDecision,
                        fmt(p.createdAt),
                    ];
                });
                sendExcel(res, 'Permission_Requests', headers, rows);
                break;
            }
            // ─── SHIFT TEMPLATES ──────────────────────────────────────────────────────
            case 'shift-templates': {
                const shifts = yield prisma_1.prisma.shiftTemplate.findMany();
                const headers = ['Shift Name', 'Shift Type', 'Start Time', 'End Time'];
                const rows = shifts.map(s => [s.name, s.shiftType, fmtT(s.startTime), fmtT(s.endTime)]);
                sendExcel(res, 'Shift_Templates', headers, rows);
                break;
            }
            // ─── SHIFT ASSIGNMENTS ────────────────────────────────────────────────────
            case 'shift-assignments': {
                const empMap = yield getEmployeeMap();
                const where = {};
                if (startDate || endDate) {
                    where.date = {};
                    if (startDate)
                        where.date.gte = new Date(startDate);
                    if (endDate)
                        where.date.lte = new Date(endDate);
                }
                if (employeeId)
                    where.employeeId = Number(employeeId);
                const assignments = yield prisma_1.prisma.shiftAssignment.findMany({
                    where,
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        shift: { select: { name: true } },
                    },
                    orderBy: [{ date: 'desc' }],
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Shift Name', 'Shift Date',
                    'Acknowledged', 'Assigned By', 'Assigned On',
                ];
                const rows = assignments.map(a => {
                    var _a;
                    return [
                        a.employee.employeeCode,
                        `${a.employee.firstName} ${a.employee.lastName}`,
                        a.shift.name, fmt(a.date),
                        a.acknowledged ? 'Yes' : 'No',
                        a.assignedBy ? ((_a = empMap.get(a.assignedBy)) !== null && _a !== void 0 ? _a : a.assignedBy) : '',
                        fmt(a.createdAt),
                    ];
                });
                sendExcel(res, 'Shift_Assignments', headers, rows);
                break;
            }
            // ─── EMPLOYEE SHIFT SETTINGS ──────────────────────────────────────────────
            case 'employee-shift-settings': {
                const settings = yield prisma_1.prisma.employeeShiftSetting.findMany({
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        fixedShift: { select: { name: true } },
                        rotationPattern: { select: { name: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Assignment Mode', 'Fixed Shift',
                    'Rotation Pattern', 'Effective From', 'Created On', 'Last Updated On',
                ];
                const rows = settings.map(s => {
                    var _a, _b, _c, _d;
                    return [
                        s.employee.employeeCode,
                        `${s.employee.firstName} ${s.employee.lastName}`,
                        s.mode,
                        (_b = (_a = s.fixedShift) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '',
                        (_d = (_c = s.rotationPattern) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : '',
                        fmt(s.startDate), fmt(s.createdAt), fmt(s.updatedAt),
                    ];
                });
                sendExcel(res, 'Employee_Shift_Settings', headers, rows);
                break;
            }
            // ─── SHIFT ROTATION PATTERNS ──────────────────────────────────────────────
            case 'shift-rotation-patterns': {
                const patterns = yield prisma_1.prisma.shiftRotationPattern.findMany();
                const headers = [
                    'Pattern Name', 'Cycle Days', 'Active', 'Source', 'Month', 'Year',
                    'Created On', 'Last Updated On',
                ];
                const rows = patterns.map(p => {
                    var _a, _b, _c;
                    return [
                        p.name, p.cycleDays, p.isActive ? 'Yes' : 'No',
                        (_a = p.source) !== null && _a !== void 0 ? _a : '',
                        (_b = p.month) !== null && _b !== void 0 ? _b : '',
                        (_c = p.year) !== null && _c !== void 0 ? _c : '',
                        fmt(p.createdAt), fmt(p.updatedAt),
                    ];
                });
                sendExcel(res, 'Shift_Rotation_Patterns', headers, rows);
                break;
            }
            // ─── JOBS ─────────────────────────────────────────────────────────────────
            case 'jobs': {
                const empMap = yield getEmployeeMap();
                const jobs = yield prisma_1.prisma.job.findMany({
                    include: { department: { select: { name: true } } },
                });
                const headers = [
                    'Job Title', 'Department', 'Location', 'Headcount', 'Job Status',
                    'Created By', 'Backfill For', 'Created On',
                ];
                const rows = jobs.map(j => {
                    var _a, _b, _c;
                    return [
                        j.title, j.department.name,
                        (_a = j.location) !== null && _a !== void 0 ? _a : '',
                        j.headcount, j.status,
                        (_b = empMap.get(j.createdBy)) !== null && _b !== void 0 ? _b : j.createdBy,
                        j.backfillForEmployeeId
                            ? ((_c = empMap.get(j.backfillForEmployeeId)) !== null && _c !== void 0 ? _c : j.backfillForEmployeeId)
                            : '',
                        fmt(j.createdAt),
                    ];
                });
                sendExcel(res, 'Jobs', headers, rows);
                break;
            }
            // ─── CANDIDATES ───────────────────────────────────────────────────────────
            case 'candidates': {
                const candidates = yield prisma_1.prisma.candidate.findMany();
                const headers = [
                    'Candidate Name', 'Email Address', 'Mobile Number', 'Source',
                    'Resume Link', 'Experience', 'Qualification', 'Address',
                    'Last Login', 'Created On',
                ];
                const rows = candidates.map(c => {
                    var _a, _b, _c, _d, _e, _f;
                    return [
                        c.name, c.email,
                        (_a = c.phone) !== null && _a !== void 0 ? _a : '',
                        (_b = c.source) !== null && _b !== void 0 ? _b : '',
                        (_c = c.resumeUrl) !== null && _c !== void 0 ? _c : '',
                        (_d = c.experience) !== null && _d !== void 0 ? _d : '',
                        (_e = c.qualification) !== null && _e !== void 0 ? _e : '',
                        (_f = c.address) !== null && _f !== void 0 ? _f : '',
                        fmt(c.lastLogin), fmt(c.createdAt),
                    ];
                });
                sendExcel(res, 'Candidates', headers, rows);
                break;
            }
            // ─── APPLICATIONS ─────────────────────────────────────────────────────────
            case 'applications': {
                const apps = yield prisma_1.prisma.application.findMany({
                    include: {
                        job: { select: { title: true } },
                        candidate: { select: { name: true } },
                    },
                });
                const headers = [
                    'Application No', 'Job Title', 'Candidate Name', 'Application Status',
                    'Current Stage', 'Rejection Reason', 'Expected CTC', 'Notice Period (Days)',
                    'Salary Notes', 'Experience', 'Qualification', 'Source', 'Shortlist Notes',
                    'Applied On', 'Last Updated On',
                ];
                const rows = apps.map(a => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                    return [
                        a.id, a.job.title, a.candidate.name, a.status,
                        (_a = a.currentStage) !== null && _a !== void 0 ? _a : '',
                        (_b = a.rejectReason) !== null && _b !== void 0 ? _b : '',
                        (_c = a.expectedCtc) !== null && _c !== void 0 ? _c : '',
                        (_d = a.noticeDays) !== null && _d !== void 0 ? _d : '',
                        (_e = a.salaryNote) !== null && _e !== void 0 ? _e : '',
                        (_f = a.experience) !== null && _f !== void 0 ? _f : '',
                        (_g = a.qualification) !== null && _g !== void 0 ? _g : '',
                        (_h = a.source) !== null && _h !== void 0 ? _h : '',
                        (_j = a.shortlistNote) !== null && _j !== void 0 ? _j : '',
                        fmt(a.createdAt), fmt(a.updatedAt),
                    ];
                });
                sendExcel(res, 'Applications', headers, rows);
                break;
            }
            // ─── TRAININGS ────────────────────────────────────────────────────────────
            case 'trainings': {
                const empMap = yield getEmployeeMap();
                const trainings = yield prisma_1.prisma.training.findMany({
                    include: { department: { select: { name: true } } },
                });
                const headers = [
                    'Training Title', 'Description', 'Objectives', 'Trainer Type', 'Trainer Name',
                    'Trainer Organization', 'Mode', 'Location', 'Start Date', 'End Date',
                    'Training Status', 'Duration (Hours)', 'Department', 'Created By', 'Created On',
                ];
                const rows = trainings.map(t => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
                    return [
                        t.title,
                        (_a = t.description) !== null && _a !== void 0 ? _a : '',
                        (_b = t.objectives) !== null && _b !== void 0 ? _b : '',
                        (_c = t.trainerType) !== null && _c !== void 0 ? _c : '',
                        (_d = t.trainerName) !== null && _d !== void 0 ? _d : '',
                        (_e = t.trainerOrg) !== null && _e !== void 0 ? _e : '',
                        (_f = t.mode) !== null && _f !== void 0 ? _f : '',
                        (_g = t.location) !== null && _g !== void 0 ? _g : '',
                        fmt(t.startDate), fmt(t.endDate), t.status,
                        (_h = t.durationHours) !== null && _h !== void 0 ? _h : '',
                        (_k = (_j = t.department) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : '',
                        (_l = empMap.get(t.createdBy)) !== null && _l !== void 0 ? _l : t.createdBy,
                        fmt(t.createdAt),
                    ];
                });
                sendExcel(res, 'Trainings', headers, rows);
                break;
            }
            // ─── TRAINING ASSIGNMENTS ─────────────────────────────────────────────────
            case 'training-assignments': {
                const empMap = yield getEmployeeMap();
                const assignments = yield prisma_1.prisma.trainingAssignment.findMany({
                    include: {
                        training: { select: { title: true } },
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Training Title', 'Employee Code', 'Employee Name', 'Assigned By',
                    'Assigned On', 'Assignment Status', 'Progress', 'Completed On',
                    'Created On', 'Last Updated On',
                ];
                const rows = assignments.map(a => {
                    var _a, _b;
                    return [
                        a.training.title, a.employee.employeeCode,
                        `${a.employee.firstName} ${a.employee.lastName}`,
                        (_a = empMap.get(a.assignedBy)) !== null && _a !== void 0 ? _a : a.assignedBy,
                        fmt(a.assignedAt), a.status,
                        (_b = a.progress) !== null && _b !== void 0 ? _b : '',
                        fmt(a.completedAt),
                        fmt(a.createdAt), fmt(a.updatedAt),
                    ];
                });
                sendExcel(res, 'Training_Assignments', headers, rows);
                break;
            }
            // ─── TRAINING ATTENDANCE ──────────────────────────────────────────────────
            case 'training-attendance': {
                const empMap = yield getEmployeeMap();
                const where = {};
                if (startDate || endDate) {
                    where.date = {};
                    if (startDate)
                        where.date.gte = new Date(startDate);
                    if (endDate)
                        where.date.lte = new Date(endDate);
                }
                const attendance = yield prisma_1.prisma.trainingAttendance.findMany({
                    where,
                    include: {
                        training: { select: { title: true } },
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Training Title', 'Employee Code', 'Employee Name', 'Attendance Date',
                    'Attendance Status', 'Marked On', 'Marked By', 'Created On', 'Last Updated On',
                ];
                const rows = attendance.map(a => {
                    var _a;
                    return [
                        a.training.title, a.employee.employeeCode,
                        `${a.employee.firstName} ${a.employee.lastName}`,
                        fmt(a.date), a.status, fmt(a.markedAt),
                        a.markedBy ? ((_a = empMap.get(a.markedBy)) !== null && _a !== void 0 ? _a : a.markedBy) : '',
                        fmt(a.createdAt), fmt(a.updatedAt),
                    ];
                });
                sendExcel(res, 'Training_Attendance', headers, rows);
                break;
            }
            // ─── APPRAISAL FORMS ──────────────────────────────────────────────────────
            case 'appraisal-forms': {
                const empMap = yield getEmployeeMap();
                const appraisals = yield prisma_1.prisma.appraisalForm.findMany({
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Appraisal Cycle', 'Form Status',
                    'Overall Score', 'Final Decision', 'Final Comments', 'Manager',
                    'Created On', 'Last Updated On',
                ];
                const rows = appraisals.map(a => {
                    var _a, _b, _c, _d;
                    return [
                        a.employee.employeeCode,
                        `${a.employee.firstName} ${a.employee.lastName}`,
                        a.cycle, a.status,
                        (_a = a.overallScore) !== null && _a !== void 0 ? _a : '',
                        (_b = a.finalDecision) !== null && _b !== void 0 ? _b : '',
                        (_c = a.finalComments) !== null && _c !== void 0 ? _c : '',
                        a.managerId ? ((_d = empMap.get(a.managerId)) !== null && _d !== void 0 ? _d : a.managerId) : '',
                        fmt(a.createdAt), fmt(a.updatedAt),
                    ];
                });
                sendExcel(res, 'Appraisal_Forms', headers, rows);
                break;
            }
            // ─── GRIEVANCES ───────────────────────────────────────────────────────────
            case 'grievances': {
                const grievances = yield prisma_1.prisma.grievance.findMany({
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Grievance No', 'Employee Code', 'Employee Name', 'Title',
                    'Description', 'Category', 'Status', 'Raised On', 'Last Updated On',
                ];
                const rows = grievances.map(g => {
                    var _a;
                    return [
                        g.id, g.employee.employeeCode,
                        `${g.employee.firstName} ${g.employee.lastName}`,
                        g.title, g.description,
                        (_a = g.category) !== null && _a !== void 0 ? _a : '',
                        g.status,
                        fmt(g.createdAt), fmt(g.updatedAt),
                    ];
                });
                sendExcel(res, 'Grievances', headers, rows);
                break;
            }
            // ─── POSH CASES ───────────────────────────────────────────────────────────
            case 'posh-cases': {
                const cases = yield prisma_1.prisma.poshCase.findMany({
                    include: {
                        complainant: { select: { employeeCode: true, firstName: true, lastName: true } },
                        accused: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Case No', 'Complainant', 'Accused Employee', 'Description',
                    'Case Status', 'Committee Note', 'Created On', 'Last Updated On',
                ];
                const rows = cases.map(c => {
                    var _a;
                    return [
                        c.id,
                        `${c.complainant.firstName} ${c.complainant.lastName}`,
                        `${c.accused.firstName} ${c.accused.lastName}`,
                        c.description, c.status,
                        (_a = c.committeeNote) !== null && _a !== void 0 ? _a : '',
                        fmt(c.createdAt), fmt(c.updatedAt),
                    ];
                });
                sendExcel(res, 'POSH_Cases', headers, rows);
                break;
            }
            // ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────
            case 'announcements': {
                const announcements = yield prisma_1.prisma.announcement.findMany();
                const headers = [
                    'Announcement Title', 'Announcement Body', 'Audience', 'Start Date',
                    'End Date', 'Circular Code', 'Pinned', 'Acknowledgement Required',
                    'Announcement Type', 'Created By', 'Created On', 'Last Updated On',
                ];
                const rows = announcements.map(a => {
                    var _a, _b, _c;
                    return [
                        a.title, a.body,
                        (_a = a.audience) !== null && _a !== void 0 ? _a : '',
                        fmt(a.startsAt), fmt(a.endsAt),
                        (_b = a.circularCode) !== null && _b !== void 0 ? _b : '',
                        a.isPinned ? 'Yes' : 'No',
                        a.requireAck ? 'Yes' : 'No',
                        (_c = a.type) !== null && _c !== void 0 ? _c : '',
                        a.createdBy, fmt(a.createdAt), fmt(a.updatedAt),
                    ];
                });
                sendExcel(res, 'Announcements', headers, rows);
                break;
            }
            // ─── INCIDENTS ────────────────────────────────────────────────────────────
            case 'incidents': {
                const incidents = yield prisma_1.prisma.incident.findMany({
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        reporter: { select: { firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Reported By', 'Incident Title',
                    'Description', 'Status', 'Attachment', 'Created On', 'Last Updated On',
                ];
                // Both `employee` and `reporter` are nullable on the Incident model
                // — `employee` may be empty for incidents that aren't tied to a
                // specific person (equipment damage, security event), and `reporter`
                // is null for anonymous public reports. Fall back gracefully so the
                // export never crashes on either case.
                const rows = incidents.map((i) => {
                    var _a, _b, _c;
                    return [
                        (_b = (_a = i.employee) === null || _a === void 0 ? void 0 : _a.employeeCode) !== null && _b !== void 0 ? _b : '',
                        i.employee
                            ? `${i.employee.firstName} ${i.employee.lastName}`.trim()
                            : '',
                        i.isAnonymous
                            ? 'Anonymous'
                            : (i.reporter
                                ? `${i.reporter.firstName} ${i.reporter.lastName}`.trim()
                                : ''),
                        i.title, i.description, i.status,
                        (_c = i.attachment) !== null && _c !== void 0 ? _c : '',
                        fmt(i.createdAt), fmt(i.updatedAt),
                    ];
                });
                sendExcel(res, 'Incidents', headers, rows);
                break;
            }
            // ─── RESIGNATION REQUESTS ─────────────────────────────────────────────────
            case 'resignation-requests': {
                const empMap = yield getEmployeeMap();
                const resignations = yield prisma_1.prisma.resignationRequest.findMany({
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Resignation No', 'Employee Code', 'Employee Name', 'Reporting Manager',
                    'Reason', 'Additional Notes', 'Notice Period (Days)',
                    'Proposed Last Working Day', 'Actual Last Working Day', 'Status',
                    'Manager Decision', 'Manager Decision Date', 'Manager Remarks',
                    'HR Decision', 'HR Decision Date', 'HR Remarks',
                    'Withdrawal Requested On', 'Withdrawal Status', 'Created On', 'Last Updated On',
                ];
                const rows = resignations.map(r => {
                    var _a, _b, _c, _d, _e;
                    return [
                        r.id, r.employee.employeeCode,
                        `${r.employee.firstName} ${r.employee.lastName}`,
                        r.managerId ? ((_a = empMap.get(r.managerId)) !== null && _a !== void 0 ? _a : r.managerId) : '',
                        r.reason,
                        (_b = r.additionalNotes) !== null && _b !== void 0 ? _b : '',
                        r.noticePeriodDays, fmt(r.proposedLastWorkingDay), fmt(r.actualLastWorkingDay),
                        r.status, r.managerDecision, fmt(r.managerDecidedAt),
                        (_c = r.managerNote) !== null && _c !== void 0 ? _c : '',
                        r.hrDecision, fmt(r.hrDecidedAt),
                        (_d = r.hrNote) !== null && _d !== void 0 ? _d : '',
                        fmt(r.withdrawRequestedAt),
                        (_e = r.withdrawDecision) !== null && _e !== void 0 ? _e : '',
                        fmt(r.createdAt), fmt(r.updatedAt),
                    ];
                });
                sendExcel(res, 'Resignation_Requests', headers, rows);
                break;
            }
            // ─── EXIT INTERVIEWS ──────────────────────────────────────────────────────
            case 'exit-interviews': {
                const empMap = yield getEmployeeMap();
                const exits = yield prisma_1.prisma.exitInterview.findMany({
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Exit Interview Date', 'Interviewer',
                    'Outcome', 'Reason for Leaving', 'Most Satisfying', 'Least Satisfying',
                    'Recommend Company', 'Recommend Reason', 'Support Received',
                    'Stay Encouragement', 'Notes', 'Completed On',
                ];
                const rows = exits.map(e => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
                    return [
                        (_b = (_a = e.employee) === null || _a === void 0 ? void 0 : _a.employeeCode) !== null && _b !== void 0 ? _b : '',
                        e.employee ? `${e.employee.firstName} ${e.employee.lastName}` : '',
                        fmt(e.scheduledAt),
                        e.interviewerId ? ((_c = empMap.get(e.interviewerId)) !== null && _c !== void 0 ? _c : e.interviewerId) : '',
                        (_d = e.outcome) !== null && _d !== void 0 ? _d : '',
                        (_e = e.reasonForLeaving) !== null && _e !== void 0 ? _e : '',
                        (_f = e.mostSatisfying) !== null && _f !== void 0 ? _f : '',
                        (_g = e.leastSatisfying) !== null && _g !== void 0 ? _g : '',
                        e.recommendCompany != null ? (e.recommendCompany ? 'Yes' : 'No') : '',
                        (_h = e.recommendReason) !== null && _h !== void 0 ? _h : '',
                        (_j = e.supportReceived) !== null && _j !== void 0 ? _j : '',
                        (_k = e.stayEncouragement) !== null && _k !== void 0 ? _k : '',
                        (_l = e.notes) !== null && _l !== void 0 ? _l : '',
                        fmt(e.completedAt),
                    ];
                });
                sendExcel(res, 'Exit_Interviews', headers, rows);
                break;
            }
            // ─── HOLIDAY EXPORT ───────────────────────────────────────────────────────
            case 'holiday-export': {
                const holidays = yield prisma_1.prisma.holiday.findMany({
                    include: { calendar: { select: { name: true, year: true, isActive: true } } },
                    where: year ? { calendar: { year: Number(year) } } : {},
                    orderBy: [{ date: 'asc' }],
                });
                const headers = [
                    'Calendar Name', 'Year', 'Holiday Name', 'Holiday Date',
                    'Description', 'Optional Holiday', 'Active Calendar',
                ];
                const rows = holidays.map(h => {
                    var _a;
                    return [
                        h.calendar.name, h.calendar.year, h.title, fmt(h.date),
                        (_a = h.description) !== null && _a !== void 0 ? _a : '',
                        h.isOptional ? 'Yes' : 'No',
                        h.calendar.isActive ? 'Yes' : 'No',
                    ];
                });
                sendExcel(res, 'Holiday_Export', headers, rows);
                break;
            }
            // ─── INTERNSHIP ───────────────────────────────────────────────────────────
            case 'internship': {
                const empMap = yield getEmployeeMap();
                const internships = yield prisma_1.prisma.internship.findMany({
                    include: { Department: { select: { name: true } } },
                });
                const headers = [
                    'Intern Name', 'Email Address', 'Mobile Number', 'Internship Title',
                    'Department', 'Mentor', 'Start Date', 'End Date', 'Status',
                    'Stipend', 'Certificate Code', 'Certificate Issued On',
                    'Created On', 'Last Updated On',
                ];
                const rows = internships.map(i => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return [
                        i.candidateName,
                        (_a = i.email) !== null && _a !== void 0 ? _a : '',
                        (_b = i.phone) !== null && _b !== void 0 ? _b : '',
                        (_c = i.title) !== null && _c !== void 0 ? _c : '',
                        (_e = (_d = i.Department) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : '',
                        i.mentorId ? ((_f = empMap.get(i.mentorId)) !== null && _f !== void 0 ? _f : i.mentorId) : '',
                        fmt(i.startDate), fmt(i.endDate), i.status,
                        (_g = i.stipend) !== null && _g !== void 0 ? _g : '',
                        (_h = i.certificateCode) !== null && _h !== void 0 ? _h : '',
                        fmt(i.certificateIssuedAt),
                        fmt(i.createdAt), fmt(i.updatedAt),
                    ];
                });
                sendExcel(res, 'Internship', headers, rows);
                break;
            }
            // ─── USERS ────────────────────────────────────────────────────────────────
            case 'users': {
                const users = yield prisma_1.prisma.user.findMany();
                const headers = ['Employee Code', 'Username', 'User Role', 'Last Login', 'Created On'];
                const rows = users.map(u => [
                    u.employeeCode, u.username, u.role, fmt(u.lastLogin), fmt(u.createdAt),
                ]);
                sendExcel(res, 'Users', headers, rows);
                break;
            }
            // ─── ROLES ────────────────────────────────────────────────────────────────
            case 'roles': {
                const roles = yield prisma_1.prisma.role.findMany();
                const headers = ['Role Name', 'Description'];
                const rows = roles.map(r => { var _a; return [r.name, (_a = r.description) !== null && _a !== void 0 ? _a : '']; });
                sendExcel(res, 'Roles', headers, rows);
                break;
            }
            // ─── PERMISSIONS ──────────────────────────────────────────────────────────
            case 'permissions': {
                const perms = yield prisma_1.prisma.permission.findMany();
                const headers = ['Permission Name'];
                const rows = perms.map(p => [p.name]);
                sendExcel(res, 'Permissions', headers, rows);
                break;
            }
            // ─── DEPARTMENTS ──────────────────────────────────────────────────────────
            case 'departments': {
                const depts = yield prisma_1.prisma.department.findMany();
                const headers = [
                    'Department Name', 'Default Clearance Department', 'Created On', 'Last Updated On',
                ];
                const rows = depts.map(d => [
                    d.name, d.isDefaultClearance ? 'Yes' : 'No', fmt(d.createdAt), fmt(d.updatedAt),
                ]);
                sendExcel(res, 'Departments', headers, rows);
                break;
            }
            // ─── BRANCHES ─────────────────────────────────────────────────────────────
            case 'branches': {
                const branches = yield prisma_1.prisma.branch.findMany();
                const headers = ['Branch Name', 'Location', 'Created On', 'Last Updated On'];
                const rows = branches.map(b => {
                    var _a;
                    return [
                        b.name,
                        (_a = b.location) !== null && _a !== void 0 ? _a : '',
                        fmt(b.createdAt), fmt(b.updatedAt),
                    ];
                });
                sendExcel(res, 'Branches', headers, rows);
                break;
            }
            // ─── DESIGNATIONS ─────────────────────────────────────────────────────────
            case 'designations': {
                const designations = yield prisma_1.prisma.designation.findMany();
                const headers = ['Designation Name', 'Active'];
                const rows = designations.map(d => [d.name, d.isActive ? 'Yes' : 'No']);
                sendExcel(res, 'Designations', headers, rows);
                break;
            }
            // ─── TEST DETAILS ─────────────────────────────────────────────────────────
            case 'test-details': {
                const tests = yield prisma_1.prisma.evaluationTest.findMany();
                const qbIds = [...new Set(tests.map(t => t.questionBankId))];
                const qbs = yield prisma_1.prisma.questionBank.findMany({
                    where: { id: { in: qbIds } },
                    select: { id: true, name: true },
                });
                const qbMap = new Map(qbs.map(q => [q.id, q.name]));
                const headers = [
                    'Test Name', 'Question Bank', 'Duration (Minutes)', 'Passing Percentage',
                    'Maximum Attempts', 'Active From', 'Active To', 'Instructions', 'Published',
                    'Level', 'Purpose', 'Randomization', 'Applicable Role', 'Created On', 'Last Updated On',
                ];
                const rows = tests.map(t => {
                    var _a, _b, _c, _d, _e, _f;
                    return [
                        t.name,
                        (_a = qbMap.get(t.questionBankId)) !== null && _a !== void 0 ? _a : '',
                        t.duration, t.passingPercent,
                        t.maxAttempts, fmt(t.activeFrom), fmt(t.activeTo),
                        (_b = t.instructions) !== null && _b !== void 0 ? _b : '',
                        t.isPublished ? 'Yes' : 'No',
                        (_c = t.level) !== null && _c !== void 0 ? _c : '',
                        (_d = t.purpose) !== null && _d !== void 0 ? _d : '',
                        (_e = t.randomization) !== null && _e !== void 0 ? _e : '',
                        (_f = t.role) !== null && _f !== void 0 ? _f : '',
                        fmt(t.createdAt), fmt(t.updatedAt),
                    ];
                });
                sendExcel(res, 'Test_Details', headers, rows);
                break;
            }
            // ─── TEST ASSIGNMENT DETAILS ──────────────────────────────────────────────
            case 'test-assignments': {
                const empMap = yield getEmployeeMap();
                const where = {};
                if (employeeId)
                    where.employeeId = Number(employeeId);
                const assignments = yield prisma_1.prisma.assignedTest.findMany({
                    where,
                    include: {
                        test: { select: { name: true } },
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Test Name', 'Employee Code', 'Employee Name', 'Assigned By', 'Assigned On',
                    'Assignment Status', 'Attempts Used', 'Started On', 'Completed On',
                    'Deadline Date', 'Test Date',
                ];
                const rows = assignments.map(a => {
                    var _a;
                    return [
                        a.test.name, a.employee.employeeCode,
                        `${a.employee.firstName} ${a.employee.lastName}`,
                        (_a = empMap.get(a.assignedBy)) !== null && _a !== void 0 ? _a : a.assignedBy,
                        fmt(a.assignedAt), a.status, a.attempts,
                        fmt(a.startedAt), fmt(a.completedAt),
                        fmt(a.deadlineDate), fmt(a.testDate),
                    ];
                });
                sendExcel(res, 'Test_Assignments', headers, rows);
                break;
            }
            // ─── TEST ATTEMPT DETAILS ─────────────────────────────────────────────────
            case 'test-attempts': {
                const where = {};
                if (employeeId)
                    where.employeeId = Number(employeeId);
                const attempts = yield prisma_1.prisma.evaluationAttempt.findMany({
                    where,
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const testIds = [...new Set(attempts.map(a => a.testId))];
                const tests = yield prisma_1.prisma.evaluationTest.findMany({
                    where: { id: { in: testIds } },
                    select: { id: true, name: true },
                });
                const testMap = new Map(tests.map(t => [t.id, t.name]));
                const headers = [
                    'Test Name', 'Employee Code', 'Employee Name', 'Score', 'Attempt Status',
                    'Completed On', 'Response', 'Created On', 'Last Updated On',
                ];
                const rows = attempts.map(a => {
                    var _a;
                    return [
                        (_a = testMap.get(a.testId)) !== null && _a !== void 0 ? _a : a.testId,
                        a.employee.employeeCode,
                        `${a.employee.firstName} ${a.employee.lastName}`,
                        a.score, a.status,
                        fmt(a.updatedAt),
                        a.response ? 'Has Response' : '',
                        fmt(a.createdAt), fmt(a.updatedAt),
                    ];
                });
                sendExcel(res, 'Test_Attempts', headers, rows);
                break;
            }
            // ─── CANDIDATE TEST ASSIGNMENT DETAILS ────────────────────────────────────
            case 'candidate-test-assignments': {
                const empMap = yield getEmployeeMap();
                const assignments = yield prisma_1.prisma.candidateAssignedTest.findMany({
                    include: {
                        application: {
                            include: {
                                candidate: { select: { name: true } },
                                job: { select: { title: true } },
                            },
                        },
                        test: { select: { name: true } },
                    },
                });
                const headers = [
                    'Candidate Name', 'Job Title', 'Test Name', 'Assigned By', 'Assigned On',
                    'Test Date', 'Deadline Date', 'Assignment Status', 'Attempts Used',
                    'Started On', 'Completed On', 'Score', 'Review Decision',
                    'Review Note', 'Reviewed On',
                ];
                const rows = assignments.map(a => {
                    var _a, _b, _c, _d;
                    return [
                        a.application.candidate.name, a.application.job.title, a.test.name,
                        (_a = empMap.get(a.assignedBy)) !== null && _a !== void 0 ? _a : a.assignedBy,
                        fmt(a.assignedAt), fmt(a.testDate), fmt(a.deadlineDate),
                        a.status, a.attempts, fmt(a.startedAt), fmt(a.completedAt),
                        (_b = a.score) !== null && _b !== void 0 ? _b : '',
                        (_c = a.reviewDecision) !== null && _c !== void 0 ? _c : '',
                        (_d = a.reviewNote) !== null && _d !== void 0 ? _d : '',
                        fmt(a.reviewedAt),
                    ];
                });
                sendExcel(res, 'Candidate_Test_Assignments', headers, rows);
                break;
            }
            // ─── PERFORMANCE APPRAISAL – PERIOD WISE ─────────────────────────────────
            case 'performance-appraisal': {
                const empMap = yield getEmployeeMap();
                const where = {};
                if (year)
                    where.cycle = { contains: String(year) };
                const responses = yield prisma_1.prisma.performanceResponse.findMany({
                    where,
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        department: { select: { name: true } },
                        question: { select: { text: true, category: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Department', 'Appraisal Cycle',
                    'Evaluation Period', 'Question Category', 'Question', 'Score',
                    'Reviewer', 'Comments', 'Reviewed On',
                ];
                const rows = responses.map(r => {
                    var _a, _b, _c;
                    return [
                        r.employee.employeeCode,
                        `${r.employee.firstName} ${r.employee.lastName}`,
                        r.department.name, r.cycle, r.period,
                        r.question.category, r.question.text,
                        (_a = r.score) !== null && _a !== void 0 ? _a : '',
                        r.reviewerId ? ((_b = empMap.get(r.reviewerId)) !== null && _b !== void 0 ? _b : r.reviewerId) : '',
                        (_c = r.comments) !== null && _c !== void 0 ? _c : '',
                        fmt(r.updatedAt),
                    ];
                });
                sendExcel(res, 'Performance_Appraisal', headers, rows);
                break;
            }
            // ─── PERFORMANCE SUMMARY ──────────────────────────────────────────────────
            case 'performance-summary': {
                const where = {};
                if (year)
                    where.cycle = { contains: String(year) };
                const summaries = yield prisma_1.prisma.performanceSummary.findMany({
                    where,
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        department: { select: { name: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Department', 'Appraisal Cycle',
                    'Evaluation Period', 'Total Marks Scored', 'Overall Performance',
                    'Created On', 'Last Updated On',
                ];
                const rows = summaries.map(s => {
                    var _a, _b;
                    return [
                        s.employee.employeeCode,
                        `${s.employee.firstName} ${s.employee.lastName}`,
                        s.department.name, s.cycle, s.period,
                        (_a = s.marksScored) !== null && _a !== void 0 ? _a : '',
                        (_b = s.overallPerf) !== null && _b !== void 0 ? _b : '',
                        fmt(s.createdAt), fmt(s.updatedAt),
                    ];
                });
                sendExcel(res, 'Performance_Summary', headers, rows);
                break;
            }
            // ─── PERFORMANCE FINAL REVIEW ─────────────────────────────────────────────
            case 'performance-final-review': {
                const where = {};
                if (year)
                    where.cycle = { contains: String(year) };
                const reviews = yield prisma_1.prisma.performanceFinalReview.findMany({
                    where,
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                        department: { select: { name: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Department', 'Appraisal Cycle',
                    'Appreciations', 'Key Talents', 'Overall Comments',
                    'Supervisor Signature', 'HR Signature', 'Created On', 'Last Updated On',
                ];
                const rows = reviews.map(r => {
                    var _a, _b, _c;
                    return [
                        r.employee.employeeCode,
                        `${r.employee.firstName} ${r.employee.lastName}`,
                        r.department.name, r.cycle,
                        (_a = r.appreciations) !== null && _a !== void 0 ? _a : '',
                        (_b = r.talents) !== null && _b !== void 0 ? _b : '',
                        (_c = r.overallComments) !== null && _c !== void 0 ? _c : '',
                        r.supervisorSig ? 'Signed' : '', r.hrSig ? 'Signed' : '',
                        fmt(r.createdAt), fmt(r.updatedAt),
                    ];
                });
                sendExcel(res, 'Performance_Final_Review', headers, rows);
                break;
            }
            // ─── SURVEY SUBMISSION SUMMARY ────────────────────────────────────────────
            case 'survey-submission-summary': {
                const where = {};
                if (startDate || endDate) {
                    where.date = {};
                    if (startDate)
                        where.date.gte = new Date(startDate);
                    if (endDate)
                        where.date.lte = new Date(endDate);
                }
                const surveys = yield prisma_1.prisma.employeeSurvey.findMany({
                    where,
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Survey ID', 'Employee Code', 'Employee Name', 'Survey Date',
                    'Submission Status', 'Submitted On', 'Created On',
                ];
                const rows = surveys.map(s => [
                    s.id, s.employee.employeeCode,
                    `${s.employee.firstName} ${s.employee.lastName}`,
                    fmt(s.date), s.status, fmt(s.submittedAt), fmt(s.createdAt),
                ]);
                sendExcel(res, 'Survey_Submission_Summary', headers, rows);
                break;
            }
            // ─── SURVEY QUESTION MASTER ───────────────────────────────────────────────
            case 'survey-question-master': {
                const questions = yield prisma_1.prisma.surveyQuestion.findMany({
                    orderBy: [{ section: 'asc' }, { orderNo: 'asc' }],
                });
                const headers = ['Question ID', 'Section / Topic', 'Question', 'Display Order'];
                const rows = questions.map(q => [q.id, q.section, q.questionText, q.orderNo]);
                sendExcel(res, 'Survey_Question_Master', headers, rows);
                break;
            }
            // ─── SURVEY RESPONSE DETAILS ──────────────────────────────────────────────
            case 'survey-response-details': {
                const where = {};
                if (startDate || endDate) {
                    where.survey = { date: {} };
                    if (startDate)
                        where.survey.date.gte = new Date(startDate);
                    if (endDate)
                        where.survey.date.lte = new Date(endDate);
                }
                const responses = yield prisma_1.prisma.surveyResponse.findMany({
                    where,
                    include: {
                        survey: {
                            include: {
                                employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                            },
                        },
                        question: { select: { section: true, questionText: true } },
                    },
                });
                const headers = [
                    'Survey ID', 'Employee Code', 'Employee Name', 'Survey Date',
                    'Section / Topic', 'Question', 'Answer', 'Submission Status', 'Submitted On',
                ];
                const rows = responses.map(r => [
                    r.surveyId, r.survey.employee.employeeCode,
                    `${r.survey.employee.firstName} ${r.survey.employee.lastName}`,
                    fmt(r.survey.date), r.question.section, r.question.questionText,
                    r.answer, r.survey.status, fmt(r.survey.submittedAt),
                ]);
                sendExcel(res, 'Survey_Response_Details', headers, rows);
                break;
            }
            // ─── SURVEY TOPIC WISE EXPORT ─────────────────────────────────────────────
            case 'survey-topic-wise': {
                const responses = yield prisma_1.prisma.surveyResponse.findMany({
                    include: {
                        survey: {
                            include: {
                                employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                            },
                        },
                        question: { select: { section: true, questionText: true } },
                    },
                    orderBy: [{ question: { section: 'asc' } }],
                });
                const headers = [
                    'Section / Topic', 'Employee Code', 'Employee Name', 'Survey Date',
                    'Question', 'Answer', 'Submitted On',
                ];
                const rows = responses.map(r => [
                    r.question.section, r.survey.employee.employeeCode,
                    `${r.survey.employee.firstName} ${r.survey.employee.lastName}`,
                    fmt(r.survey.date), r.question.questionText,
                    r.answer, fmt(r.survey.submittedAt),
                ]);
                sendExcel(res, 'Survey_Topic_Wise', headers, rows);
                break;
            }
            // ─── EMPLOYEE WISE SURVEY EXPORT ──────────────────────────────────────────
            case 'employee-wise-survey': {
                const where = {};
                if (employeeId)
                    where.survey = { employeeId: Number(employeeId) };
                const responses = yield prisma_1.prisma.surveyResponse.findMany({
                    where,
                    include: {
                        survey: {
                            include: {
                                employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                            },
                        },
                        question: { select: { section: true, questionText: true } },
                    },
                    orderBy: [{ survey: { employeeId: 'asc' } }],
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Survey Date', 'Section / Topic',
                    'Question', 'Answer', 'Submission Status', 'Submitted On',
                ];
                const rows = responses.map(r => [
                    r.survey.employee.employeeCode,
                    `${r.survey.employee.firstName} ${r.survey.employee.lastName}`,
                    fmt(r.survey.date), r.question.section, r.question.questionText,
                    r.answer, r.survey.status, fmt(r.survey.submittedAt),
                ]);
                sendExcel(res, 'Employee_Wise_Survey', headers, rows);
                break;
            }
            // ─── QUESTION WISE SURVEY EXPORT ──────────────────────────────────────────
            case 'question-wise-survey': {
                const responses = yield prisma_1.prisma.surveyResponse.findMany({
                    include: {
                        survey: {
                            include: {
                                employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                            },
                        },
                        question: { select: { section: true, questionText: true } },
                    },
                    orderBy: [{ questionId: 'asc' }],
                });
                const headers = [
                    'Section / Topic', 'Question', 'Employee Code', 'Employee Name',
                    'Survey Date', 'Answer', 'Submitted On',
                ];
                const rows = responses.map(r => [
                    r.question.section, r.question.questionText,
                    r.survey.employee.employeeCode,
                    `${r.survey.employee.firstName} ${r.survey.employee.lastName}`,
                    fmt(r.survey.date), r.answer, fmt(r.survey.submittedAt),
                ]);
                sendExcel(res, 'Question_Wise_Survey', headers, rows);
                break;
            }
            // ─── SURVEY PENDING / NOT SUBMITTED ───────────────────────────────────────
            case 'survey-pending': {
                const surveys = yield prisma_1.prisma.employeeSurvey.findMany({
                    where: { status: { not: 'SUBMITTED' } },
                    include: {
                        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                    },
                });
                const headers = [
                    'Employee Code', 'Employee Name', 'Survey Date', 'Submission Status', 'Created On',
                ];
                const rows = surveys.map(s => [
                    s.employee.employeeCode,
                    `${s.employee.firstName} ${s.employee.lastName}`,
                    fmt(s.date), s.status, fmt(s.createdAt),
                ]);
                sendExcel(res, 'Survey_Pending', headers, rows);
                break;
            }
            // ─── CONSOLIDATED EMPLOYEE DETAILS ─────────────────────────────────────
            case 'consolidated-employee': {
                const [employees, addresses, qualifications, documents, emergencyContacts] = yield Promise.all([
                    prisma_1.prisma.employee.findMany({
                        include: {
                            Department: true,
                            Branch: true,
                            designation: true,
                            role: true,
                        },
                    }),
                    prisma_1.prisma.address.findMany(),
                    prisma_1.prisma.qualification.findMany(),
                    prisma_1.prisma.document.findMany(),
                    prisma_1.prisma.emergencyContact.findMany(),
                ]);
                const empMap = yield getEmployeeMap();
                // Group related records by employeeId
                const addrByEmp = new Map();
                for (const a of addresses) {
                    const arr = (_a = addrByEmp.get(a.employeeId)) !== null && _a !== void 0 ? _a : [];
                    arr.push(a);
                    addrByEmp.set(a.employeeId, arr);
                }
                const qualByEmp = new Map();
                for (const q of qualifications) {
                    const arr = (_b = qualByEmp.get(q.employeeId)) !== null && _b !== void 0 ? _b : [];
                    arr.push(q);
                    qualByEmp.set(q.employeeId, arr);
                }
                const docByEmp = new Map();
                for (const d of documents) {
                    const arr = (_c = docByEmp.get(d.employeeId)) !== null && _c !== void 0 ? _c : [];
                    arr.push(d);
                    docByEmp.set(d.employeeId, arr);
                }
                const ecByEmp = new Map();
                for (const c of emergencyContacts) {
                    const arr = (_d = ecByEmp.get(c.employeeId)) !== null && _d !== void 0 ? _d : [];
                    arr.push(c);
                    ecByEmp.set(c.employeeId, arr);
                }
                // Determine max counts to create enough columns
                let maxAddr = 0, maxQual = 0, maxDoc = 0, maxEc = 0, maxVacc = 0;
                for (const e of employees) {
                    maxAddr = Math.max(maxAddr, (_f = (_e = addrByEmp.get(e.id)) === null || _e === void 0 ? void 0 : _e.length) !== null && _f !== void 0 ? _f : 0);
                    maxQual = Math.max(maxQual, (_h = (_g = qualByEmp.get(e.id)) === null || _g === void 0 ? void 0 : _g.length) !== null && _h !== void 0 ? _h : 0);
                    maxDoc = Math.max(maxDoc, (_k = (_j = docByEmp.get(e.id)) === null || _j === void 0 ? void 0 : _j.length) !== null && _k !== void 0 ? _k : 0);
                    maxEc = Math.max(maxEc, (_m = (_l = ecByEmp.get(e.id)) === null || _l === void 0 ? void 0 : _l.length) !== null && _m !== void 0 ? _m : 0);
                    const vacc = e.vaccinations ? JSON.parse(e.vaccinations) : [];
                    maxVacc = Math.max(maxVacc, Array.isArray(vacc) ? vacc.length : 0);
                }
                // Build headers
                const consolidatedHeaders = [
                    // Master
                    'Employee Code', 'Reference Code', 'First Name', 'Last Name', 'Full Name',
                    'Gender', 'Date of Birth', 'Age', 'Mobile Number', 'Alternate Mobile Number',
                    'Email Address', 'Department', 'Branch', 'Designation', 'Role',
                    'Reporting Manager', 'In Charge', 'Date of Joining', 'Employment Type',
                    'Employment Status', 'Probation End Date', 'Years of Experience', 'Marital Status',
                    'Father Name', 'Mother Name', 'PAN Number', 'Aadhaar Number', 'UAN Number',
                    'License Number', 'License Registration Date', 'License Expiry Date',
                    'Blood Group', 'Height', 'Weight', 'BMI',
                    'Blood Pressure', 'Blood Sugar', 'Cholesterol',
                    'Smoking', 'Alcohol', 'Exercise Frequency',
                    'Allergies', 'Chronic Conditions', 'Past Surgeries',
                    'Vision Type', 'Uses Glasses', 'Vision Remarks',
                    'Has Disability', 'Disability Type', 'Disability Description',
                    'Preferred Hospital', 'Primary Physician', 'Emergency Notes',
                    'Pre-Employment Check Date',
                    'Created On', 'Last Updated On',
                ];
                // Address columns
                for (let i = 1; i <= maxAddr; i++) {
                    consolidatedHeaders.push(`Address ${i} Type`, `Address ${i} Line 1`, `Address ${i} Line 2`, `Address ${i} City`, `Address ${i} State`, `Address ${i} Postal Code`, `Address ${i} Country`);
                }
                // Qualification columns
                for (let i = 1; i <= maxQual; i++) {
                    consolidatedHeaders.push(`Qualification ${i} Degree`, `Qualification ${i} Degree Name`, `Qualification ${i} Institution`, `Qualification ${i} Year of Passing`, `Qualification ${i} Grade`);
                }
                // Emergency Contact columns
                for (let i = 1; i <= maxEc; i++) {
                    consolidatedHeaders.push(`Emergency Contact ${i} Name`, `Emergency Contact ${i} Number`, `Emergency Contact ${i} Relationship`);
                }
                // Document columns
                for (let i = 1; i <= maxDoc; i++) {
                    consolidatedHeaders.push(`Document ${i} Title`, `Document ${i} Type`, `Document ${i} Category`, `Document ${i} Issue Date`, `Document ${i} Expiry Date`);
                }
                // Vaccination columns
                for (let i = 1; i <= maxVacc; i++) {
                    consolidatedHeaders.push(`Vaccination ${i} Name`, `Vaccination ${i} Date`, `Vaccination ${i} Dose`, `Vaccination ${i} Certificate`);
                }
                // Build rows
                const consolidatedRows = employees.map(e => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20, _21, _22, _23, _24, _25, _26, _27, _28, _29, _30, _31, _32, _33, _34, _35, _36, _37, _38;
                    const row = [
                        // Master
                        e.employeeCode,
                        (_a = e.referenceCode) !== null && _a !== void 0 ? _a : '',
                        e.firstName, e.lastName,
                        `${e.firstName} ${e.lastName}`, e.gender, fmt(e.dob),
                        (_b = e.age) !== null && _b !== void 0 ? _b : '',
                        e.phone,
                        (_c = e.alternatePhone) !== null && _c !== void 0 ? _c : '',
                        e.email,
                        e.Department.name, e.Branch.name,
                        (_e = (_d = e.designation) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : '',
                        e.role.name,
                        e.reportingManager ? ((_f = empMap.get(e.reportingManager)) !== null && _f !== void 0 ? _f : e.reportingManager) : '',
                        e.inchargeId ? ((_g = empMap.get(e.inchargeId)) !== null && _g !== void 0 ? _g : e.inchargeId) : '',
                        fmt(e.dateOfJoining), e.employmentType, e.employmentStatus,
                        fmt(e.probationEndDate),
                        (_h = e.totalYearsOfExperience) !== null && _h !== void 0 ? _h : '',
                        (_j = e.marital) !== null && _j !== void 0 ? _j : '',
                        (_k = e.fatherName) !== null && _k !== void 0 ? _k : '',
                        (_l = e.motherName) !== null && _l !== void 0 ? _l : '',
                        (_m = e.panNumber) !== null && _m !== void 0 ? _m : '',
                        (_o = e.aadharNumber) !== null && _o !== void 0 ? _o : '',
                        (_p = e.uanNumber) !== null && _p !== void 0 ? _p : '',
                        (_q = e.licenseNumber) !== null && _q !== void 0 ? _q : '',
                        fmt(e.licenseRegDate), fmt(e.licenseExpiryDate),
                        (_r = e.bloodGroup) !== null && _r !== void 0 ? _r : '',
                        (_s = e.height) !== null && _s !== void 0 ? _s : '',
                        (_t = e.weight) !== null && _t !== void 0 ? _t : '',
                        (_u = e.bmi) !== null && _u !== void 0 ? _u : '',
                        (_v = e.bloodPressure) !== null && _v !== void 0 ? _v : '',
                        (_w = e.bloodSugar) !== null && _w !== void 0 ? _w : '',
                        (_x = e.cholesterol) !== null && _x !== void 0 ? _x : '',
                        e.smoking ? 'Yes' : 'No', e.alcohol ? 'Yes' : 'No',
                        (_y = e.exerciseFrequency) !== null && _y !== void 0 ? _y : '',
                        (_z = e.allergies) !== null && _z !== void 0 ? _z : '',
                        (_0 = e.chronicConditions) !== null && _0 !== void 0 ? _0 : '',
                        (_1 = e.pastSurgeries) !== null && _1 !== void 0 ? _1 : '',
                        (_2 = e.visionType) !== null && _2 !== void 0 ? _2 : '',
                        e.usesGlasses ? 'Yes' : 'No',
                        (_3 = e.visionRemarks) !== null && _3 !== void 0 ? _3 : '',
                        e.hasDisability ? 'Yes' : 'No',
                        (_4 = e.disabilityType) !== null && _4 !== void 0 ? _4 : '',
                        (_5 = e.disabilityDescription) !== null && _5 !== void 0 ? _5 : '',
                        (_6 = e.preferredHospital) !== null && _6 !== void 0 ? _6 : '',
                        (_7 = e.primaryPhysician) !== null && _7 !== void 0 ? _7 : '',
                        (_8 = e.emergencyNotes) !== null && _8 !== void 0 ? _8 : '',
                        fmt(e.preEmploymentCheckDate),
                        fmt(e.createdAt), fmt(e.updatedAt),
                    ];
                    // Addresses
                    const empAddrs = (_9 = addrByEmp.get(e.id)) !== null && _9 !== void 0 ? _9 : [];
                    for (let i = 0; i < maxAddr; i++) {
                        const a = empAddrs[i];
                        row.push((_10 = a === null || a === void 0 ? void 0 : a.type) !== null && _10 !== void 0 ? _10 : '', (_11 = a === null || a === void 0 ? void 0 : a.line1) !== null && _11 !== void 0 ? _11 : '', (_12 = a === null || a === void 0 ? void 0 : a.line2) !== null && _12 !== void 0 ? _12 : '', (_13 = a === null || a === void 0 ? void 0 : a.city) !== null && _13 !== void 0 ? _13 : '', (_14 = a === null || a === void 0 ? void 0 : a.state) !== null && _14 !== void 0 ? _14 : '', (_15 = a === null || a === void 0 ? void 0 : a.zipCode) !== null && _15 !== void 0 ? _15 : '', (_16 = a === null || a === void 0 ? void 0 : a.country) !== null && _16 !== void 0 ? _16 : '');
                    }
                    // Qualifications
                    const empQuals = (_17 = qualByEmp.get(e.id)) !== null && _17 !== void 0 ? _17 : [];
                    for (let i = 0; i < maxQual; i++) {
                        const q = empQuals[i];
                        row.push((_18 = q === null || q === void 0 ? void 0 : q.degree) !== null && _18 !== void 0 ? _18 : '', (_19 = q === null || q === void 0 ? void 0 : q.degreeName) !== null && _19 !== void 0 ? _19 : '', (_20 = q === null || q === void 0 ? void 0 : q.institution) !== null && _20 !== void 0 ? _20 : '', (_21 = q === null || q === void 0 ? void 0 : q.year) !== null && _21 !== void 0 ? _21 : '', (_22 = q === null || q === void 0 ? void 0 : q.grade) !== null && _22 !== void 0 ? _22 : '');
                    }
                    // Emergency Contacts
                    const empEcs = (_23 = ecByEmp.get(e.id)) !== null && _23 !== void 0 ? _23 : [];
                    for (let i = 0; i < maxEc; i++) {
                        const c = empEcs[i];
                        row.push((_24 = c === null || c === void 0 ? void 0 : c.name) !== null && _24 !== void 0 ? _24 : '', (_25 = c === null || c === void 0 ? void 0 : c.phone) !== null && _25 !== void 0 ? _25 : '', (_26 = c === null || c === void 0 ? void 0 : c.relationship) !== null && _26 !== void 0 ? _26 : '');
                    }
                    // Documents
                    const empDocs = (_27 = docByEmp.get(e.id)) !== null && _27 !== void 0 ? _27 : [];
                    for (let i = 0; i < maxDoc; i++) {
                        const d = empDocs[i];
                        row.push((_28 = d === null || d === void 0 ? void 0 : d.title) !== null && _28 !== void 0 ? _28 : '', (_29 = d === null || d === void 0 ? void 0 : d.type) !== null && _29 !== void 0 ? _29 : '', (_30 = d === null || d === void 0 ? void 0 : d.category) !== null && _30 !== void 0 ? _30 : '', fmt(d === null || d === void 0 ? void 0 : d.issueDate), fmt(d === null || d === void 0 ? void 0 : d.expiryDate));
                    }
                    // Vaccinations
                    const vaccArr = e.vaccinations ? JSON.parse(e.vaccinations) : [];
                    const vaccList = Array.isArray(vaccArr) ? vaccArr : [];
                    for (let i = 0; i < maxVacc; i++) {
                        const v = vaccList[i];
                        row.push((_32 = (_31 = v === null || v === void 0 ? void 0 : v.name) !== null && _31 !== void 0 ? _31 : v === null || v === void 0 ? void 0 : v.vaccineName) !== null && _32 !== void 0 ? _32 : '', (_34 = (_33 = v === null || v === void 0 ? void 0 : v.date) !== null && _33 !== void 0 ? _33 : v === null || v === void 0 ? void 0 : v.vaccinationDate) !== null && _34 !== void 0 ? _34 : '', (_36 = (_35 = v === null || v === void 0 ? void 0 : v.dose) !== null && _35 !== void 0 ? _35 : v === null || v === void 0 ? void 0 : v.doseNumber) !== null && _36 !== void 0 ? _36 : '', (_38 = (_37 = v === null || v === void 0 ? void 0 : v.proofUrl) !== null && _37 !== void 0 ? _37 : v === null || v === void 0 ? void 0 : v.certificate) !== null && _38 !== void 0 ? _38 : '');
                    }
                    return row;
                });
                sendExcel(res, 'Consolidated_Employee_Details', consolidatedHeaders, consolidatedRows);
                break;
            }
            // ─── UNKNOWN ──────────────────────────────────────────────────────────────
            default:
                res.status(400).json({
                    error: `Unknown export table: "${table}"`,
                    available: [
                        'consolidated-employee',
                        'employee-master', 'employee-addresses', 'emergency-contacts', 'qualifications',
                        'employee-documents', 'attendance', 'leave-requests', 'leave-balance',
                        'leave-monthly-summary', 'leave-yearly-summary', 'leave-accrual-details',
                        'leave-ledger', 'leave-policy', 'entitlement-policy', 'permission-requests',
                        'shift-templates', 'shift-assignments', 'employee-shift-settings',
                        'shift-rotation-patterns', 'jobs', 'candidates', 'applications',
                        'trainings', 'training-assignments', 'training-attendance', 'appraisal-forms',
                        'grievances', 'posh-cases', 'announcements', 'incidents',
                        'resignation-requests', 'exit-interviews', 'holiday-export', 'internship',
                        'users', 'roles', 'permissions', 'departments', 'branches', 'designations',
                        'test-details', 'test-assignments', 'test-attempts', 'candidate-test-assignments',
                        'performance-appraisal', 'performance-summary', 'performance-final-review',
                        'survey-submission-summary', 'survey-question-master', 'survey-response-details',
                        'survey-topic-wise', 'employee-wise-survey', 'question-wise-survey', 'survey-pending',
                    ],
                });
        }
    }
    catch (error) {
        console.error(`Export error for table "${table}":`, error);
        res.status(500).json({ error: 'Export failed', message: error.message });
    }
});
exports.exportTable = exportTable;
