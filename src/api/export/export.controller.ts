import { Request, Response } from 'express';
import XLSX from 'xlsx';
import { prisma } from '../../lib/prisma';

// All dates in this export module render in IST (Asia/Kolkata). Using
// toISOString() for "YYYY-MM-DD" silently shifts dates back one day for any
// value stored as IST midnight (which becomes 18:30 the previous day in UTC),
// e.g. a leave applied for April 6 IST would export as April 5 — confusing.
// `en-CA` produces YYYY-MM-DD so the format matches the previous behaviour.
const fmt = (d: Date | null | undefined): string =>
  d ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '';

const fmtT = (d: Date | null | undefined): string => {
  if (!d) return '';
  const dt = new Date(d);
  const date = dt.toLocaleDateString('en-CA',  { timeZone: 'Asia/Kolkata' });
  const time = dt.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  return `${date} ${time}`;
};

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const monthName = (m: number | null | undefined): string =>
  m ? (MONTH_NAMES[m] ?? String(m)) : '';

type SheetData = {
  name: string;
  headers: string[];
  rows: (string | number | boolean | null | undefined)[][];
};

function sendExcel(
  res: Response,
  filename: string,
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  const buf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  res.send(buf);
}

function sendMultiSheetExcel(res: Response, filename: string, sheets: SheetData[]): void {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  const buf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  res.send(buf);
}

async function getEmployeeMap(): Promise<Map<number, string>> {
  const emps = await prisma.employee.findMany({
    select: { id: true, firstName: true, lastName: true },
  });
  return new Map(emps.map(e => [e.id, `${e.firstName} ${e.lastName}`]));
}

export const exportTable = async (req: Request, res: Response): Promise<void> => {
  const table = req.params.table;
  const { startDate, endDate, year, month, employeeId, cycleId } = req.query;

  try {
    switch (table) {
      // ─── EMPLOYEE MASTER ──────────────────────────────────────────────────────
      case 'employee-master': {
        const [employees, addresses, qualifications, documents, emergencyContacts] =
          await Promise.all([
            prisma.employee.findMany({
              include: {
                Department: true,
                Branch: true,
                designation: true,
                role: true,
              },
            }),
            prisma.address.findMany({
              include: {
                employee: { select: { employeeCode: true, firstName: true, lastName: true } },
              },
            }),
            prisma.qualification.findMany({
              include: {
                employee: { select: { employeeCode: true, firstName: true, lastName: true } },
              },
            }),
            prisma.document.findMany({
              include: {
                employee: { select: { employeeCode: true, firstName: true, lastName: true } },
              },
            }),
            prisma.emergencyContact.findMany({
              include: {
                employee: { select: { employeeCode: true, firstName: true, lastName: true } },
              },
            }),
          ]);

        const empMap = await getEmployeeMap();

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
        const masterRows = employees.map(e => [
          e.employeeCode, e.referenceCode ?? '', e.firstName, e.lastName,
          `${e.firstName} ${e.lastName}`, e.gender, fmt(e.dob), e.age ?? '',
          e.phone, e.alternatePhone ?? '', e.email,
          e.Department.name, e.Branch.name, e.designation?.name ?? '', e.role.name,
          e.reportingManager ? (empMap.get(e.reportingManager) ?? e.reportingManager) : '',
          e.inchargeId ? (empMap.get(e.inchargeId) ?? e.inchargeId) : '',
          fmt(e.dateOfJoining), e.employmentType, e.employmentStatus,
          fmt(e.probationEndDate), e.totalYearsOfExperience ?? '',
          e.marital ?? '', e.fatherName ?? '', e.motherName ?? '',
          e.panNumber ?? '', e.aadharNumber ?? '', e.uanNumber ?? '',
          e.licenseNumber ?? '', fmt(e.licenseRegDate), fmt(e.licenseExpiryDate),
          fmt(e.createdAt), fmt(e.updatedAt),
        ]);

        // Sheet 2 — Addresses
        const addressHeaders = [
          'Employee Code', 'Employee Name', 'Address Type', 'Address Line 1',
          'Address Line 2', 'City', 'State', 'Postal Code', 'Country',
          'Created On', 'Last Updated On',
        ];
        const addressRows = addresses.map(a => [
          a.employee.employeeCode,
          `${a.employee.firstName} ${a.employee.lastName}`,
          a.type, a.line1, a.line2 ?? '', a.city, a.state, a.zipCode, a.country,
          fmt(a.createdAt), fmt(a.updatedAt),
        ]);

        // Sheet 3 — Qualifications
        const qualHeaders = [
          'Employee Code', 'Employee Name', 'Degree', 'Degree Name', 'Institution',
          'Year of Passing', 'Grade / Percentage', 'Created On', 'Last Updated On',
        ];
        const qualRows = qualifications.map(q => [
          q.employee.employeeCode,
          `${q.employee.firstName} ${q.employee.lastName}`,
          q.degree, q.degreeName ?? '', q.institution, q.year, q.grade ?? '',
          fmt(q.createdAt), fmt(q.updatedAt),
        ]);

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
          { name: 'Master Details',      headers: masterHeaders,  rows: masterRows },
          { name: 'Addresses',           headers: addressHeaders, rows: addressRows },
          { name: 'Qualifications',      headers: qualHeaders,    rows: qualRows },
          { name: 'Documents',           headers: docHeaders,     rows: docRows },
          { name: 'Emergency Contacts',  headers: ecHeaders,      rows: ecRows },
        ]);
        break;
      }

      // ─── EMPLOYEE ADDRESSES ───────────────────────────────────────────────────
      case 'employee-addresses': {
        const addresses = await prisma.address.findMany({
          include: {
            employee: { select: { employeeCode: true, firstName: true, lastName: true } },
          },
        });

        const headers = [
          'Employee Code', 'Employee Name', 'Address Type', 'Address Line 1',
          'Address Line 2', 'City', 'State', 'Postal Code', 'Country',
          'Created On', 'Last Updated On',
        ];

        const rows = addresses.map(a => [
          a.employee.employeeCode,
          `${a.employee.firstName} ${a.employee.lastName}`,
          a.type, a.line1, a.line2 ?? '', a.city, a.state, a.zipCode, a.country,
          fmt(a.createdAt), fmt(a.updatedAt),
        ]);

        sendExcel(res, 'Employee_Addresses', headers, rows);
        break;
      }

      // ─── EMERGENCY CONTACTS ───────────────────────────────────────────────────
      case 'emergency-contacts': {
        const contacts = await prisma.emergencyContact.findMany({
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
        const quals = await prisma.qualification.findMany({
          include: {
            employee: { select: { employeeCode: true, firstName: true, lastName: true } },
          },
        });

        const headers = [
          'Employee Code', 'Employee Name', 'Degree', 'Degree Name', 'Institution',
          'Year of Passing', 'Grade / Percentage', 'Created On', 'Last Updated On',
        ];

        const rows = quals.map(q => [
          q.employee.employeeCode,
          `${q.employee.firstName} ${q.employee.lastName}`,
          q.degree, q.degreeName ?? '', q.institution, q.year, q.grade ?? '',
          fmt(q.createdAt), fmt(q.updatedAt),
        ]);

        sendExcel(res, 'Qualifications', headers, rows);
        break;
      }

      // ─── EMPLOYEE DOCUMENTS ───────────────────────────────────────────────────
      case 'employee-documents': {
        const docs = await prisma.document.findMany({
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
        const empMap = await getEmployeeMap();
        const where: any = {};
        if (startDate || endDate) {
          where.date = {};
          if (startDate) where.date.gte = new Date(startDate as string);
          if (endDate) where.date.lte = new Date(endDate as string);
        }
        if (employeeId) where.employeeId = Number(employeeId);

        const att = await prisma.attendance.findMany({
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

        const rows = att.map(a => [
          a.employee.employeeCode,
          `${a.employee.firstName} ${a.employee.lastName}`,
          fmt(a.date), a.status,
          fmtT(a.checkIn), fmtT(a.checkOut),
          a.reason ?? '', a.attendanceApproval ?? '',
          a.approvedBy ? (empMap.get(a.approvedBy) ?? a.approvedBy) : '',
          fmt(a.approvedAt),
          a.createdBy ? (empMap.get(a.createdBy) ?? a.createdBy) : '',
          fmt(a.createdAt),
        ]);

        sendExcel(res, 'Attendance', headers, rows);
        break;
      }

      // ─── LEAVE REQUESTS ───────────────────────────────────────────────────────
      case 'leave-requests': {
        const empMap = await getEmployeeMap();
        const where: any = {};
        if (startDate || endDate) {
          where.startDate = {};
          if (startDate) where.startDate.gte = new Date(startDate as string);
          if (endDate) where.startDate.lte = new Date(endDate as string);
        }
        if (employeeId) where.employeeId = Number(employeeId);

        const leaves = await prisma.leaveRequest.findMany({
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

        const rows = leaves.map(l => [
          l.id, l.employee.employeeCode,
          `${l.employee.firstName} ${l.employee.lastName}`,
          l.leaveType.name,
          fmt(l.startDate), fmt(l.endDate),
          l.reason, l.status,
          l.isHalfDay ? 'Yes' : 'No', l.halfDaySession ?? '',
          l.approvedBy ? (empMap.get(l.approvedBy) ?? l.approvedBy) : '',
          fmt(l.approvedDate),
          l.declinedBy ? (empMap.get(l.declinedBy) ?? l.declinedBy) : '',
          fmt(l.declinedDate), l.declineReason ?? '',
          l.hodDecision, l.hodNote ?? '', fmt(l.hodDecidedAt),
          l.hrDecision, l.hrNote ?? '', fmt(l.hrDecidedAt),
          l.inChargeDecision, l.inChargeNote ?? '', fmt(l.inChargeDecidedAt),
          l.prescriptionUrl ? 'Yes' : 'No',
          fmt(l.createdAt),
        ]);

        sendExcel(res, 'Leave_Requests', headers, rows);
        break;
      }

      // ─── LEAVE BALANCE ────────────────────────────────────────────────────────
      case 'leave-balance': {
        const where: any = {};
        if (year) where.year = Number(year);

        const balances = await prisma.employeeLeaveBalance.findMany({
          where,
          include: { leaveType: { select: { name: true } } },
        });

        const empIds = [...new Set(balances.map(b => b.employeeId))];
        const emps = await prisma.employee.findMany({
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
          const emp = empDetailMap.get(b.employeeId);
          const available = b.isUnlimited ? 'Unlimited' : b.totalAllowed - b.used;
          return [
            emp?.employeeCode ?? '',
            emp ? `${emp.firstName} ${emp.lastName}` : '',
            b.leaveType?.name ?? b.permissionType ?? '',
            b.year, b.category,
            b.isUnlimited ? 'Yes' : 'No',
            b.totalAllowed, b.used, b.halfDayUsed ?? 0, available,
          ];
        });

        sendExcel(res, 'Leave_Balance', headers, rows);
        break;
      }

      // ─── LEAVE MONTHLY SUMMARY ────────────────────────────────────────────────
      case 'leave-monthly-summary': {
        const where: any = {};
        if (year) where.year = Number(year);
        if (month) where.month = Number(month);

        const summaries = await prisma.leaveMonthlySummary.findMany({ where });

        const empIds = [...new Set(summaries.map(s => s.employeeId))];
        const ltIds = [...new Set(summaries.map(s => s.leaveTypeId))];
        const [emps, lts] = await Promise.all([
          prisma.employee.findMany({
            where: { id: { in: empIds } },
            select: { id: true, employeeCode: true, firstName: true, lastName: true },
          }),
          prisma.leaveType.findMany({
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
          const emp = empDetailMap.get(s.employeeId);
          return [
            emp?.employeeCode ?? '',
            emp ? `${emp.firstName} ${emp.lastName}` : '',
            ltMap.get(s.leaveTypeId) ?? '', s.year, monthName(s.month),
            s.opening, s.credited, s.used, s.lapsed, s.closing,
          ];
        });

        sendExcel(res, 'Leave_Monthly_Summary', headers, rows);
        break;
      }

      // ─── LEAVE YEARLY SUMMARY ─────────────────────────────────────────────────
      case 'leave-yearly-summary': {
        const where: any = {};
        if (year) where.year = Number(year);

        const summaries = await prisma.leaveYearlySummary.findMany({ where });

        const empIds = [...new Set(summaries.map(s => s.employeeId))];
        const ltIds = [...new Set(summaries.map(s => s.leaveTypeId))];
        const [emps, lts] = await Promise.all([
          prisma.employee.findMany({
            where: { id: { in: empIds } },
            select: { id: true, employeeCode: true, firstName: true, lastName: true },
          }),
          prisma.leaveType.findMany({
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
          const emp = empDetailMap.get(s.employeeId);
          return [
            emp?.employeeCode ?? '',
            emp ? `${emp.firstName} ${emp.lastName}` : '',
            ltMap.get(s.leaveTypeId) ?? '', s.year,
            s.opening, s.credited, s.used, s.lapsed, s.encashed, s.closing,
          ];
        });

        sendExcel(res, 'Leave_Yearly_Summary', headers, rows);
        break;
      }

      // ─── LEAVE ACCRUAL DETAILS ────────────────────────────────────────────────
      case 'leave-accrual-details': {
        const where: any = {};
        if (year) where.year = Number(year);
        if (month) where.month = Number(month);
        if (employeeId) where.employeeId = Number(employeeId);

        const accruals = await prisma.leaveAccrual.findMany({
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

        const rows = accruals.map(a => [
          a.employee.employeeCode,
          `${a.employee.firstName} ${a.employee.lastName}`,
          a.leaveType.name, a.year, monthName(a.month),
          a.accrualType, a.daysCredited, a.remarks ?? '', fmt(a.createdAt),
        ]);

        sendExcel(res, 'Leave_Accrual_Details', headers, rows);
        break;
      }

      // ─── LEAVE LEDGER ─────────────────────────────────────────────────────────
      case 'leave-ledger': {
        const where: any = {};
        if (year) where.year = Number(year);
        if (month) where.month = Number(month);
        if (employeeId) where.employeeId = Number(employeeId);

        const ledgers = await prisma.leaveLedger.findMany({
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

        const rows = ledgers.map(l => [
          l.employee.employeeCode,
          `${l.employee.firstName} ${l.employee.lastName}`,
          l.leaveType.name,
          fmt(l.transactionDate), l.year, monthName(l.month),
          l.referenceType, l.credit, l.debit, l.balanceAfter,
          l.action,
          l.performedByUser
            ? `${l.performedByUser.firstName} ${l.performedByUser.lastName}`
            : '',
          fmt(l.performedAt), l.source ?? '', l.remarks ?? '',
          fmt(l.createdAt),
        ]);

        sendExcel(res, 'Leave_Ledger', headers, rows);
        break;
      }

      // ─── LEAVE POLICY ─────────────────────────────────────────────────────────
      case 'leave-policy': {
        const policies = await prisma.leavePolicy.findMany({
          include: { leaveType: { select: { name: true } } },
        });

        const headers = [
          'Leave Type', 'Policy Name', 'Accrual Type', 'Accrual Rate',
          'Accrual Frequency', 'Maximum Balance', 'Carry Forward Allowed',
          'Maximum Carry Forward', 'Negative Balance Allowed', 'Approval Required',
          'Approval Levels', 'Include Probation', 'Exclude Weekends', 'Exclude Holidays',
          'Document Required', 'Encashable', 'Effective From', 'Effective To', 'Created On',
        ];

        const rows = policies.map(p => [
          p.leaveType.name, p.name, p.accrualType, p.accrualRate ?? '',
          p.accrualFrequency ?? '', p.maxBalance ?? '',
          p.carryForward ? 'Yes' : 'No', p.maxCarryForward ?? '',
          p.allowNegativeBalance ? 'Yes' : 'No',
          p.requiresApproval ? 'Yes' : 'No', p.approvalLevels ?? '',
          p.includeProbation ? 'Yes' : 'No',
          p.excludeWeekends ? 'Yes' : 'No',
          p.excludeHolidays ? 'Yes' : 'No',
          p.requiresDocument ? 'Yes' : 'No',
          p.encashable ? 'Yes' : 'No',
          fmt(p.effectiveFrom), fmt(p.effectiveTo), fmt(p.createdAt),
        ]);

        sendExcel(res, 'Leave_Policy', headers, rows);
        break;
      }

      // ─── ENTITLEMENT POLICY ───────────────────────────────────────────────────
      case 'entitlement-policy': {
        const policies = await prisma.entitlementPolicy.findMany();

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
        const empMap = await getEmployeeMap();
        const where: any = {};
        if (startDate || endDate) {
          where.day = {};
          if (startDate) where.day.gte = new Date(startDate as string);
          if (endDate) where.day.lte = new Date(endDate as string);
        }
        if (employeeId) where.employeeId = Number(employeeId);

        const perms = await prisma.permissionRequest.findMany({
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
          const durationMins =
            p.startTime && p.endTime
              ? Math.round(
                  (new Date(p.endTime).getTime() - new Date(p.startTime).getTime()) / 60000
                )
              : '';
          return [
            p.employee.employeeCode,
            `${p.employee.firstName} ${p.employee.lastName}`,
            fmt(p.day), fmtT(p.startTime), fmtT(p.endTime),
            p.permissionType ?? '', durationMins, p.reason, p.status,
            p.approvedBy ? (empMap.get(p.approvedBy) ?? p.approvedBy) : '',
            fmt(p.approvedDate),
            p.declinedBy ? (empMap.get(p.declinedBy) ?? p.declinedBy) : '',
            fmt(p.declinedDate), p.declineReason ?? '',
            p.hodDecision, p.hrDecision, p.inChargeDecision,
            fmt(p.createdAt),
          ];
        });

        sendExcel(res, 'Permission_Requests', headers, rows);
        break;
      }

      // ─── SHIFT TEMPLATES ──────────────────────────────────────────────────────
      case 'shift-templates': {
        const shifts = await prisma.shiftTemplate.findMany();

        const headers = ['Shift Name', 'Shift Type', 'Start Time', 'End Time'];
        const rows = shifts.map(s => [s.name, s.shiftType, fmtT(s.startTime), fmtT(s.endTime)]);

        sendExcel(res, 'Shift_Templates', headers, rows);
        break;
      }

      // ─── SHIFT ASSIGNMENTS ────────────────────────────────────────────────────
      case 'shift-assignments': {
        const empMap = await getEmployeeMap();
        const where: any = {};
        if (startDate || endDate) {
          where.date = {};
          if (startDate) where.date.gte = new Date(startDate as string);
          if (endDate) where.date.lte = new Date(endDate as string);
        }
        if (employeeId) where.employeeId = Number(employeeId);

        const assignments = await prisma.shiftAssignment.findMany({
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

        const rows = assignments.map(a => [
          a.employee.employeeCode,
          `${a.employee.firstName} ${a.employee.lastName}`,
          a.shift.name, fmt(a.date),
          a.acknowledged ? 'Yes' : 'No',
          a.assignedBy ? (empMap.get(a.assignedBy) ?? a.assignedBy) : '',
          fmt(a.createdAt),
        ]);

        sendExcel(res, 'Shift_Assignments', headers, rows);
        break;
      }

      // ─── EMPLOYEE SHIFT SETTINGS ──────────────────────────────────────────────
      case 'employee-shift-settings': {
        const settings = await prisma.employeeShiftSetting.findMany({
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

        const rows = settings.map(s => [
          s.employee.employeeCode,
          `${s.employee.firstName} ${s.employee.lastName}`,
          s.mode, s.fixedShift?.name ?? '', s.rotationPattern?.name ?? '',
          fmt(s.startDate), fmt(s.createdAt), fmt(s.updatedAt),
        ]);

        sendExcel(res, 'Employee_Shift_Settings', headers, rows);
        break;
      }

      // ─── SHIFT ROTATION PATTERNS ──────────────────────────────────────────────
      case 'shift-rotation-patterns': {
        const patterns = await prisma.shiftRotationPattern.findMany();

        const headers = [
          'Pattern Name', 'Cycle Days', 'Active', 'Source', 'Month', 'Year',
          'Created On', 'Last Updated On',
        ];

        const rows = patterns.map(p => [
          p.name, p.cycleDays, p.isActive ? 'Yes' : 'No',
          p.source ?? '', p.month ?? '', p.year ?? '',
          fmt(p.createdAt), fmt(p.updatedAt),
        ]);

        sendExcel(res, 'Shift_Rotation_Patterns', headers, rows);
        break;
      }

      // ─── JOBS ─────────────────────────────────────────────────────────────────
      case 'jobs': {
        const empMap = await getEmployeeMap();
        const jobs = await prisma.job.findMany({
          include: { department: { select: { name: true } } },
        });

        const headers = [
          'Job Title', 'Department', 'Location', 'Headcount', 'Job Status',
          'Created By', 'Backfill For', 'Created On',
        ];

        const rows = jobs.map(j => [
          j.title, j.department.name, j.location ?? '', j.headcount, j.status,
          empMap.get(j.createdBy) ?? j.createdBy,
          j.backfillForEmployeeId
            ? (empMap.get(j.backfillForEmployeeId) ?? j.backfillForEmployeeId)
            : '',
          fmt(j.createdAt),
        ]);

        sendExcel(res, 'Jobs', headers, rows);
        break;
      }

      // ─── CANDIDATES ───────────────────────────────────────────────────────────
      case 'candidates': {
        const candidates = await prisma.candidate.findMany();

        const headers = [
          'Candidate Name', 'Email Address', 'Mobile Number', 'Source',
          'Resume Link', 'Experience', 'Qualification', 'Address',
          'Last Login', 'Created On',
        ];

        const rows = candidates.map(c => [
          c.name, c.email, c.phone ?? '', c.source ?? '',
          c.resumeUrl ?? '', c.experience ?? '', c.qualification ?? '', c.address ?? '',
          fmt(c.lastLogin), fmt(c.createdAt),
        ]);

        sendExcel(res, 'Candidates', headers, rows);
        break;
      }

      // ─── APPLICATIONS ─────────────────────────────────────────────────────────
      case 'applications': {
        const apps = await prisma.application.findMany({
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

        const rows = apps.map(a => [
          a.id, a.job.title, a.candidate.name, a.status,
          a.currentStage ?? '', a.rejectReason ?? '',
          a.expectedCtc ?? '', a.noticeDays ?? '', a.salaryNote ?? '',
          a.experience ?? '', a.qualification ?? '', a.source ?? '', a.shortlistNote ?? '',
          fmt(a.createdAt), fmt(a.updatedAt),
        ]);

        sendExcel(res, 'Applications', headers, rows);
        break;
      }

      // ─── TRAININGS ────────────────────────────────────────────────────────────
      case 'trainings': {
        const empMap = await getEmployeeMap();
        const trainings = await prisma.training.findMany({
          include: { department: { select: { name: true } } },
        });

        const headers = [
          'Training Title', 'Description', 'Objectives', 'Trainer Type', 'Trainer Name',
          'Trainer Organization', 'Mode', 'Location', 'Start Date', 'End Date',
          'Training Status', 'Duration (Hours)', 'Department', 'Created By', 'Created On',
        ];

        const rows = trainings.map(t => [
          t.title, t.description ?? '', t.objectives ?? '',
          t.trainerType ?? '', t.trainerName ?? '', t.trainerOrg ?? '',
          t.mode ?? '', t.location ?? '',
          fmt(t.startDate), fmt(t.endDate), t.status,
          t.durationHours ?? '', t.department?.name ?? '',
          empMap.get(t.createdBy) ?? t.createdBy,
          fmt(t.createdAt),
        ]);

        sendExcel(res, 'Trainings', headers, rows);
        break;
      }

      // ─── TRAINING ASSIGNMENTS ─────────────────────────────────────────────────
      case 'training-assignments': {
        const empMap = await getEmployeeMap();
        const assignments = await prisma.trainingAssignment.findMany({
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

        const rows = assignments.map(a => [
          a.training.title, a.employee.employeeCode,
          `${a.employee.firstName} ${a.employee.lastName}`,
          empMap.get(a.assignedBy) ?? a.assignedBy,
          fmt(a.assignedAt), a.status, a.progress ?? '', fmt(a.completedAt),
          fmt(a.createdAt), fmt(a.updatedAt),
        ]);

        sendExcel(res, 'Training_Assignments', headers, rows);
        break;
      }

      // ─── TRAINING ATTENDANCE ──────────────────────────────────────────────────
      case 'training-attendance': {
        const empMap = await getEmployeeMap();
        const where: any = {};
        if (startDate || endDate) {
          where.date = {};
          if (startDate) where.date.gte = new Date(startDate as string);
          if (endDate) where.date.lte = new Date(endDate as string);
        }

        const attendance = await prisma.trainingAttendance.findMany({
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

        const rows = attendance.map(a => [
          a.training.title, a.employee.employeeCode,
          `${a.employee.firstName} ${a.employee.lastName}`,
          fmt(a.date), a.status, fmt(a.markedAt),
          a.markedBy ? (empMap.get(a.markedBy) ?? a.markedBy) : '',
          fmt(a.createdAt), fmt(a.updatedAt),
        ]);

        sendExcel(res, 'Training_Attendance', headers, rows);
        break;
      }

      // ─── APPRAISAL FORMS ──────────────────────────────────────────────────────
      case 'appraisal-forms': {
        const empMap = await getEmployeeMap();
        const appraisals = await prisma.appraisalForm.findMany({
          include: {
            employee: { select: { employeeCode: true, firstName: true, lastName: true } },
          },
        });

        const headers = [
          'Employee Code', 'Employee Name', 'Appraisal Cycle', 'Form Status',
          'Overall Score', 'Final Decision', 'Final Comments', 'Manager',
          'Created On', 'Last Updated On',
        ];

        const rows = appraisals.map(a => [
          a.employee.employeeCode,
          `${a.employee.firstName} ${a.employee.lastName}`,
          a.cycle, a.status, a.overallScore ?? '',
          a.finalDecision ?? '', a.finalComments ?? '',
          a.managerId ? (empMap.get(a.managerId) ?? a.managerId) : '',
          fmt(a.createdAt), fmt(a.updatedAt),
        ]);

        sendExcel(res, 'Appraisal_Forms', headers, rows);
        break;
      }

      // ─── GRIEVANCES ───────────────────────────────────────────────────────────
      case 'grievances': {
        const grievances = await prisma.grievance.findMany({
          include: {
            employee: { select: { employeeCode: true, firstName: true, lastName: true } },
          },
        });

        const headers = [
          'Grievance No', 'Employee Code', 'Employee Name', 'Title',
          'Description', 'Category', 'Status', 'Raised On', 'Last Updated On',
        ];

        const rows = grievances.map(g => [
          g.id, g.employee.employeeCode,
          `${g.employee.firstName} ${g.employee.lastName}`,
          g.title, g.description, g.category ?? '', g.status,
          fmt(g.createdAt), fmt(g.updatedAt),
        ]);

        sendExcel(res, 'Grievances', headers, rows);
        break;
      }

      // ─── POSH CASES ───────────────────────────────────────────────────────────
      case 'posh-cases': {
        const cases = await prisma.poshCase.findMany({
          include: {
            complainant: { select: { employeeCode: true, firstName: true, lastName: true } },
            accused: { select: { employeeCode: true, firstName: true, lastName: true } },
          },
        });

        const headers = [
          'Case No', 'Complainant', 'Accused Employee', 'Description',
          'Case Status', 'Committee Note', 'Created On', 'Last Updated On',
        ];

        const rows = cases.map(c => [
          c.id,
          `${c.complainant.firstName} ${c.complainant.lastName}`,
          `${c.accused.firstName} ${c.accused.lastName}`,
          c.description, c.status, c.committeeNote ?? '',
          fmt(c.createdAt), fmt(c.updatedAt),
        ]);

        sendExcel(res, 'POSH_Cases', headers, rows);
        break;
      }

      // ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────
      case 'announcements': {
        const announcements = await prisma.announcement.findMany();

        const headers = [
          'Announcement Title', 'Announcement Body', 'Audience', 'Start Date',
          'End Date', 'Circular Code', 'Pinned', 'Acknowledgement Required',
          'Announcement Type', 'Created By', 'Created On', 'Last Updated On',
        ];

        const rows = announcements.map(a => [
          a.title, a.body, a.audience ?? '', fmt(a.startsAt), fmt(a.endsAt),
          a.circularCode ?? '', a.isPinned ? 'Yes' : 'No',
          a.requireAck ? 'Yes' : 'No', a.type ?? '',
          a.createdBy, fmt(a.createdAt), fmt(a.updatedAt),
        ]);

        sendExcel(res, 'Announcements', headers, rows);
        break;
      }

      // ─── INCIDENTS ────────────────────────────────────────────────────────────
      case 'incidents': {
        const incidents = await prisma.incident.findMany({
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
        const rows = incidents.map((i: any) => [
          i.employee?.employeeCode ?? '',
          i.employee
            ? `${i.employee.firstName} ${i.employee.lastName}`.trim()
            : '',
          i.isAnonymous
            ? 'Anonymous'
            : (i.reporter
                ? `${i.reporter.firstName} ${i.reporter.lastName}`.trim()
                : ''),
          i.title, i.description, i.status, i.attachment ?? '',
          fmt(i.createdAt), fmt(i.updatedAt),
        ]);

        sendExcel(res, 'Incidents', headers, rows);
        break;
      }

      // ─── RESIGNATION REQUESTS ─────────────────────────────────────────────────
      case 'resignation-requests': {
        const empMap = await getEmployeeMap();
        const resignations = await prisma.resignationRequest.findMany({
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

        const rows = resignations.map(r => [
          r.id, r.employee.employeeCode,
          `${r.employee.firstName} ${r.employee.lastName}`,
          r.managerId ? (empMap.get(r.managerId) ?? r.managerId) : '',
          r.reason, r.additionalNotes ?? '',
          r.noticePeriodDays, fmt(r.proposedLastWorkingDay), fmt(r.actualLastWorkingDay),
          r.status, r.managerDecision, fmt(r.managerDecidedAt), r.managerNote ?? '',
          r.hrDecision, fmt(r.hrDecidedAt), r.hrNote ?? '',
          fmt(r.withdrawRequestedAt), r.withdrawDecision ?? '',
          fmt(r.createdAt), fmt(r.updatedAt),
        ]);

        sendExcel(res, 'Resignation_Requests', headers, rows);
        break;
      }

      // ─── EXIT INTERVIEWS ──────────────────────────────────────────────────────
      case 'exit-interviews': {
        const empMap = await getEmployeeMap();
        const exits = await prisma.exitInterview.findMany({
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

        const rows = exits.map(e => [
          e.employee?.employeeCode ?? '',
          e.employee ? `${e.employee.firstName} ${e.employee.lastName}` : '',
          fmt(e.scheduledAt),
          e.interviewerId ? (empMap.get(e.interviewerId) ?? e.interviewerId) : '',
          e.outcome ?? '', e.reasonForLeaving ?? '',
          e.mostSatisfying ?? '', e.leastSatisfying ?? '',
          e.recommendCompany != null ? (e.recommendCompany ? 'Yes' : 'No') : '',
          e.recommendReason ?? '', e.supportReceived ?? '',
          e.stayEncouragement ?? '', e.notes ?? '',
          fmt(e.completedAt),
        ]);

        sendExcel(res, 'Exit_Interviews', headers, rows);
        break;
      }

      // ─── HOLIDAY EXPORT ───────────────────────────────────────────────────────
      case 'holiday-export': {
        const holidays = await prisma.holiday.findMany({
          include: { calendar: { select: { name: true, year: true, isActive: true } } },
          where: year ? { calendar: { year: Number(year) } } : {},
          orderBy: [{ date: 'asc' }],
        });

        const headers = [
          'Calendar Name', 'Year', 'Holiday Name', 'Holiday Date',
          'Description', 'Optional Holiday', 'Active Calendar',
        ];

        const rows = holidays.map(h => [
          h.calendar.name, h.calendar.year, h.title, fmt(h.date),
          h.description ?? '', h.isOptional ? 'Yes' : 'No',
          h.calendar.isActive ? 'Yes' : 'No',
        ]);

        sendExcel(res, 'Holiday_Export', headers, rows);
        break;
      }

      // ─── INTERNSHIP ───────────────────────────────────────────────────────────
      case 'internship': {
        const empMap = await getEmployeeMap();
        const internships = await prisma.internship.findMany({
          include: { Department: { select: { name: true } } },
        });

        const headers = [
          'Intern Name', 'Email Address', 'Mobile Number', 'Internship Title',
          'Department', 'Mentor', 'Start Date', 'End Date', 'Status',
          'Stipend', 'Certificate Code', 'Certificate Issued On',
          'Created On', 'Last Updated On',
        ];

        const rows = internships.map(i => [
          i.candidateName, i.email ?? '', i.phone ?? '', i.title ?? '',
          i.Department?.name ?? '',
          i.mentorId ? (empMap.get(i.mentorId) ?? i.mentorId) : '',
          fmt(i.startDate), fmt(i.endDate), i.status,
          i.stipend ?? '', i.certificateCode ?? '', fmt(i.certificateIssuedAt),
          fmt(i.createdAt), fmt(i.updatedAt),
        ]);

        sendExcel(res, 'Internship', headers, rows);
        break;
      }

      // ─── USERS ────────────────────────────────────────────────────────────────
      case 'users': {
        const users = await prisma.user.findMany();

        const headers = ['Employee Code', 'Username', 'User Role', 'Last Login', 'Created On'];
        const rows = users.map(u => [
          u.employeeCode, u.username, u.role, fmt(u.lastLogin), fmt(u.createdAt),
        ]);

        sendExcel(res, 'Users', headers, rows);
        break;
      }

      // ─── ROLES ────────────────────────────────────────────────────────────────
      case 'roles': {
        const roles = await prisma.role.findMany();

        const headers = ['Role Name', 'Description'];
        const rows = roles.map(r => [r.name, r.description ?? '']);

        sendExcel(res, 'Roles', headers, rows);
        break;
      }

      // ─── PERMISSIONS ──────────────────────────────────────────────────────────
      case 'permissions': {
        const perms = await prisma.permission.findMany();

        const headers = ['Permission Name'];
        const rows = perms.map(p => [p.name]);

        sendExcel(res, 'Permissions', headers, rows);
        break;
      }

      // ─── DEPARTMENTS ──────────────────────────────────────────────────────────
      case 'departments': {
        const depts = await prisma.department.findMany();

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
        const branches = await prisma.branch.findMany();

        const headers = ['Branch Name', 'Location', 'Created On', 'Last Updated On'];
        const rows = branches.map(b => [
          b.name, b.location ?? '', fmt(b.createdAt), fmt(b.updatedAt),
        ]);

        sendExcel(res, 'Branches', headers, rows);
        break;
      }

      // ─── DESIGNATIONS ─────────────────────────────────────────────────────────
      case 'designations': {
        const designations = await prisma.designation.findMany();

        const headers = ['Designation Name', 'Active'];
        const rows = designations.map(d => [d.name, d.isActive ? 'Yes' : 'No']);

        sendExcel(res, 'Designations', headers, rows);
        break;
      }

      // ─── TEST DETAILS ─────────────────────────────────────────────────────────
      case 'test-details': {
        const tests = await prisma.evaluationTest.findMany();

        const qbIds = [...new Set(tests.map(t => t.questionBankId))];
        const qbs = await prisma.questionBank.findMany({
          where: { id: { in: qbIds } },
          select: { id: true, name: true },
        });
        const qbMap = new Map(qbs.map(q => [q.id, q.name]));

        const headers = [
          'Test Name', 'Question Bank', 'Duration (Minutes)', 'Passing Percentage',
          'Maximum Attempts', 'Active From', 'Active To', 'Instructions', 'Published',
          'Level', 'Purpose', 'Randomization', 'Applicable Role', 'Created On', 'Last Updated On',
        ];

        const rows = tests.map(t => [
          t.name, qbMap.get(t.questionBankId) ?? '', t.duration, t.passingPercent,
          t.maxAttempts, fmt(t.activeFrom), fmt(t.activeTo), t.instructions ?? '',
          t.isPublished ? 'Yes' : 'No', t.level ?? '', t.purpose ?? '',
          t.randomization ?? '', t.role ?? '',
          fmt(t.createdAt), fmt(t.updatedAt),
        ]);

        sendExcel(res, 'Test_Details', headers, rows);
        break;
      }

      // ─── TEST ASSIGNMENT DETAILS ──────────────────────────────────────────────
      case 'test-assignments': {
        const empMap = await getEmployeeMap();
        const where: any = {};
        if (employeeId) where.employeeId = Number(employeeId);

        const assignments = await prisma.assignedTest.findMany({
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

        const rows = assignments.map(a => [
          a.test.name, a.employee.employeeCode,
          `${a.employee.firstName} ${a.employee.lastName}`,
          empMap.get(a.assignedBy) ?? a.assignedBy,
          fmt(a.assignedAt), a.status, a.attempts,
          fmt(a.startedAt), fmt(a.completedAt),
          fmt(a.deadlineDate), fmt(a.testDate),
        ]);

        sendExcel(res, 'Test_Assignments', headers, rows);
        break;
      }

      // ─── TEST ATTEMPT DETAILS ─────────────────────────────────────────────────
      case 'test-attempts': {
        const where: any = {};
        if (employeeId) where.employeeId = Number(employeeId);

        const attempts = await prisma.evaluationAttempt.findMany({
          where,
          include: {
            employee: { select: { employeeCode: true, firstName: true, lastName: true } },
          },
        });

        const testIds = [...new Set(attempts.map(a => a.testId))];
        const tests = await prisma.evaluationTest.findMany({
          where: { id: { in: testIds } },
          select: { id: true, name: true },
        });
        const testMap = new Map(tests.map(t => [t.id, t.name]));

        const headers = [
          'Test Name', 'Employee Code', 'Employee Name', 'Score', 'Attempt Status',
          'Completed On', 'Response', 'Created On', 'Last Updated On',
        ];

        const rows = attempts.map(a => [
          testMap.get(a.testId) ?? a.testId,
          a.employee.employeeCode,
          `${a.employee.firstName} ${a.employee.lastName}`,
          a.score, a.status,
          fmt(a.updatedAt),
          a.response ? 'Has Response' : '',
          fmt(a.createdAt), fmt(a.updatedAt),
        ]);

        sendExcel(res, 'Test_Attempts', headers, rows);
        break;
      }

      // ─── CANDIDATE TEST ASSIGNMENT DETAILS ────────────────────────────────────
      case 'candidate-test-assignments': {
        const empMap = await getEmployeeMap();
        const assignments = await prisma.candidateAssignedTest.findMany({
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

        const rows = assignments.map(a => [
          a.application.candidate.name, a.application.job.title, a.test.name,
          empMap.get(a.assignedBy) ?? a.assignedBy,
          fmt(a.assignedAt), fmt(a.testDate), fmt(a.deadlineDate),
          a.status, a.attempts, fmt(a.startedAt), fmt(a.completedAt),
          a.score ?? '', a.reviewDecision ?? '', a.reviewNote ?? '', fmt(a.reviewedAt),
        ]);

        sendExcel(res, 'Candidate_Test_Assignments', headers, rows);
        break;
      }

      // ─── PERFORMANCE APPRAISAL – PERIOD WISE ─────────────────────────────────
      case 'performance-appraisal': {
        const empMap = await getEmployeeMap();
        const where: any = {};
        if (year) where.cycle = { contains: String(year) };

        const responses = await prisma.performanceResponse.findMany({
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

        const rows = responses.map(r => [
          r.employee.employeeCode,
          `${r.employee.firstName} ${r.employee.lastName}`,
          r.department.name, r.cycle, r.period,
          r.question.category, r.question.text, r.score ?? '',
          r.reviewerId ? (empMap.get(r.reviewerId) ?? r.reviewerId) : '',
          r.comments ?? '', fmt(r.updatedAt),
        ]);

        sendExcel(res, 'Performance_Appraisal', headers, rows);
        break;
      }

      // ─── PERFORMANCE SUMMARY ──────────────────────────────────────────────────
      case 'performance-summary': {
        const where: any = {};
        if (year) where.cycle = { contains: String(year) };

        const summaries = await prisma.performanceSummary.findMany({
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

        const rows = summaries.map(s => [
          s.employee.employeeCode,
          `${s.employee.firstName} ${s.employee.lastName}`,
          s.department.name, s.cycle, s.period,
          s.marksScored ?? '', s.overallPerf ?? '',
          fmt(s.createdAt), fmt(s.updatedAt),
        ]);

        sendExcel(res, 'Performance_Summary', headers, rows);
        break;
      }

      // ─── PERFORMANCE FINAL REVIEW ─────────────────────────────────────────────
      case 'performance-final-review': {
        const where: any = {};
        if (year) where.cycle = { contains: String(year) };

        const reviews = await prisma.performanceFinalReview.findMany({
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

        const rows = reviews.map(r => [
          r.employee.employeeCode,
          `${r.employee.firstName} ${r.employee.lastName}`,
          r.department.name, r.cycle,
          r.appreciations ?? '', r.talents ?? '', r.overallComments ?? '',
          r.supervisorSig ? 'Signed' : '', r.hrSig ? 'Signed' : '',
          fmt(r.createdAt), fmt(r.updatedAt),
        ]);

        sendExcel(res, 'Performance_Final_Review', headers, rows);
        break;
      }

      // ─── SURVEY SUBMISSION SUMMARY ────────────────────────────────────────────
      case 'survey-submission-summary': {
        const where: any = {};
        // A cycle IS a date window, so it supersedes startDate/endDate. Without
        // it the sheet blends every cycle together, which is what these reports
        // did before the cycle engine existed.
        if (cycleId) {
          where.cycleId = Number(cycleId);
        } else if (startDate || endDate) {
          where.date = {};
          if (startDate) where.date.gte = new Date(startDate as string);
          if (endDate) where.date.lte = new Date(endDate as string);
        }

        const surveys = await prisma.employeeSurvey.findMany({
          where,
          include: {
            employee: { select: { employeeCode: true, firstName: true, lastName: true } },
            cycle: { select: { name: true, endDate: true } },
          },
        });

        const headers = [
          'Survey ID', 'Cycle', 'Employee Code', 'Employee Name', 'Survey Date',
          'Due On', 'Submission Status', 'Submitted On', 'Created On',
        ];

        const rows = surveys.map(s => [
          s.id, s.cycle?.name ?? '—', s.employee.employeeCode,
          `${s.employee.firstName} ${s.employee.lastName}`,
          fmt(s.date), s.cycle ? fmt(s.cycle.endDate) : '—',
          s.status, fmt(s.submittedAt), fmt(s.createdAt),
        ]);

        sendExcel(res, 'Survey_Submission_Summary', headers, rows);
        break;
      }

      // ─── SURVEY QUESTION MASTER ───────────────────────────────────────────────
      case 'survey-question-master': {
        const questions = await prisma.surveyQuestion.findMany({
          orderBy: [{ section: 'asc' }, { orderNo: 'asc' }],
        });

        const headers = ['Question ID', 'Section / Topic', 'Question', 'Display Order'];
        const rows = questions.map(q => [q.id, q.section, q.questionText, q.orderNo]);

        sendExcel(res, 'Survey_Question_Master', headers, rows);
        break;
      }

      // ─── SURVEY RESPONSE DETAILS ──────────────────────────────────────────────
      case 'survey-response-details': {
        const where: any = {};
        if (cycleId) {
          where.survey = { cycleId: Number(cycleId) };
        } else if (startDate || endDate) {
          where.survey = { date: {} };
          if (startDate) where.survey.date.gte = new Date(startDate as string);
          if (endDate) where.survey.date.lte = new Date(endDate as string);
        }

        const responses = await prisma.surveyResponse.findMany({
          where,
          include: {
            survey: {
              include: {
                employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                cycle: { select: { name: true } },
              },
            },
            question: { select: { section: true, questionText: true } },
          },
        });

        const headers = [
          'Survey ID', 'Cycle', 'Employee Code', 'Employee Name', 'Survey Date',
          'Section / Topic', 'Question', 'Answer', 'Submission Status', 'Submitted On',
        ];

        const rows = responses.map(r => [
          r.surveyId, r.survey.cycle?.name ?? '—', r.survey.employee.employeeCode,
          `${r.survey.employee.firstName} ${r.survey.employee.lastName}`,
          fmt(r.survey.date), r.question.section, r.question.questionText,
          r.answer, r.survey.status, fmt(r.survey.submittedAt),
        ]);

        sendExcel(res, 'Survey_Response_Details', headers, rows);
        break;
      }

      // ─── SURVEY TOPIC WISE EXPORT ─────────────────────────────────────────────
      case 'survey-topic-wise': {
        const responses = await prisma.surveyResponse.findMany({
          where: cycleId ? { survey: { cycleId: Number(cycleId) } } : {},
          include: {
            survey: {
              include: {
                employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                cycle: { select: { name: true } },
              },
            },
            question: { select: { section: true, questionText: true } },
          },
          orderBy: [{ question: { section: 'asc' } }],
        });

        const headers = [
          'Section / Topic', 'Cycle', 'Employee Code', 'Employee Name', 'Survey Date',
          'Question', 'Answer', 'Submitted On',
        ];

        const rows = responses.map(r => [
          r.question.section, r.survey.cycle?.name ?? '—', r.survey.employee.employeeCode,
          `${r.survey.employee.firstName} ${r.survey.employee.lastName}`,
          fmt(r.survey.date), r.question.questionText,
          r.answer, fmt(r.survey.submittedAt),
        ]);

        sendExcel(res, 'Survey_Topic_Wise', headers, rows);
        break;
      }

      // ─── EMPLOYEE WISE SURVEY EXPORT ──────────────────────────────────────────
      case 'employee-wise-survey': {
        const surveyWhere: any = {};
        if (employeeId) surveyWhere.employeeId = Number(employeeId);
        if (cycleId) surveyWhere.cycleId = Number(cycleId);
        const where: any = Object.keys(surveyWhere).length ? { survey: surveyWhere } : {};

        const responses = await prisma.surveyResponse.findMany({
          where,
          include: {
            survey: {
              include: {
                employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                cycle: { select: { name: true } },
              },
            },
            question: { select: { section: true, questionText: true } },
          },
          orderBy: [{ survey: { employeeId: 'asc' } }],
        });

        const headers = [
          'Employee Code', 'Employee Name', 'Cycle', 'Survey Date', 'Section / Topic',
          'Question', 'Answer', 'Submission Status', 'Submitted On',
        ];

        const rows = responses.map(r => [
          r.survey.employee.employeeCode,
          `${r.survey.employee.firstName} ${r.survey.employee.lastName}`,
          r.survey.cycle?.name ?? '—',
          fmt(r.survey.date), r.question.section, r.question.questionText,
          r.answer, r.survey.status, fmt(r.survey.submittedAt),
        ]);

        sendExcel(res, 'Employee_Wise_Survey', headers, rows);
        break;
      }

      // ─── QUESTION WISE SURVEY EXPORT ──────────────────────────────────────────
      case 'question-wise-survey': {
        const responses = await prisma.surveyResponse.findMany({
          where: cycleId ? { survey: { cycleId: Number(cycleId) } } : {},
          include: {
            survey: {
              include: {
                employee: { select: { employeeCode: true, firstName: true, lastName: true } },
                cycle: { select: { name: true } },
              },
            },
            question: { select: { section: true, questionText: true } },
          },
          orderBy: [{ questionId: 'asc' }],
        });

        const headers = [
          'Section / Topic', 'Question', 'Cycle', 'Employee Code', 'Employee Name',
          'Survey Date', 'Answer', 'Submitted On',
        ];

        const rows = responses.map(r => [
          r.question.section, r.question.questionText,
          r.survey.cycle?.name ?? '—',
          r.survey.employee.employeeCode,
          `${r.survey.employee.firstName} ${r.survey.employee.lastName}`,
          fmt(r.survey.date), r.answer, fmt(r.survey.submittedAt),
        ]);

        sendExcel(res, 'Question_Wise_Survey', headers, rows);
        break;
      }

      // ─── SURVEY PENDING / NOT SUBMITTED ───────────────────────────────────────
      case 'survey-pending': {
        // Covers both states a non-submission can be in: DRAFT (window still
        // open, still actionable) and EXPIRED (window closed, permanent
        // non-response). Without the cycle column this sheet grows into an
        // undifferentiated list of everyone who ever missed a survey, so the
        // cycle and its due date are carried on every row.
        const surveys = await prisma.employeeSurvey.findMany({
          where: {
            status: { not: 'SUBMITTED' },
            ...(cycleId ? { cycleId: Number(cycleId) } : {}),
          },
          include: {
            employee: { select: { employeeCode: true, firstName: true, lastName: true } },
            cycle: { select: { name: true, endDate: true, status: true } },
          },
          orderBy: [{ cycleId: 'desc' }, { employeeId: 'asc' }],
        });

        const headers = [
          'Employee Code', 'Employee Name', 'Cycle', 'Survey Date', 'Due On',
          'Submission Status', 'Window', 'Created On',
        ];

        const rows = surveys.map(s => [
          s.employee.employeeCode,
          `${s.employee.firstName} ${s.employee.lastName}`,
          s.cycle?.name ?? '—',
          fmt(s.date),
          s.cycle ? fmt(s.cycle.endDate) : '—',
          s.status === 'EXPIRED' ? 'Not submitted' : 'Pending',
          s.cycle ? (s.cycle.status === 'CLOSED' ? 'Closed' : 'Open') : 'No deadline',
          fmt(s.createdAt),
        ]);

        sendExcel(res, 'Survey_Pending', headers, rows);
        break;
      }

      // ─── CONSOLIDATED EMPLOYEE DETAILS ─────────────────────────────────────
      case 'consolidated-employee': {
        const [employees, addresses, qualifications, documents, emergencyContacts] =
          await Promise.all([
            prisma.employee.findMany({
              include: {
                Department: true,
                Branch: true,
                designation: true,
                role: true,
              },
            }),
            prisma.address.findMany(),
            prisma.qualification.findMany(),
            prisma.document.findMany(),
            prisma.emergencyContact.findMany(),
          ]);

        const empMap = await getEmployeeMap();

        // Group related records by employeeId
        const addrByEmp = new Map<number, typeof addresses>();
        for (const a of addresses) {
          const arr = addrByEmp.get(a.employeeId) ?? [];
          arr.push(a);
          addrByEmp.set(a.employeeId, arr);
        }

        const qualByEmp = new Map<number, typeof qualifications>();
        for (const q of qualifications) {
          const arr = qualByEmp.get(q.employeeId) ?? [];
          arr.push(q);
          qualByEmp.set(q.employeeId, arr);
        }

        const docByEmp = new Map<number, typeof documents>();
        for (const d of documents) {
          const arr = docByEmp.get(d.employeeId) ?? [];
          arr.push(d);
          docByEmp.set(d.employeeId, arr);
        }

        const ecByEmp = new Map<number, typeof emergencyContacts>();
        for (const c of emergencyContacts) {
          const arr = ecByEmp.get(c.employeeId) ?? [];
          arr.push(c);
          ecByEmp.set(c.employeeId, arr);
        }

        // Determine max counts to create enough columns
        let maxAddr = 0, maxQual = 0, maxDoc = 0, maxEc = 0, maxVacc = 0;
        for (const e of employees) {
          maxAddr = Math.max(maxAddr, addrByEmp.get(e.id)?.length ?? 0);
          maxQual = Math.max(maxQual, qualByEmp.get(e.id)?.length ?? 0);
          maxDoc = Math.max(maxDoc, docByEmp.get(e.id)?.length ?? 0);
          maxEc = Math.max(maxEc, ecByEmp.get(e.id)?.length ?? 0);
          const vacc = e.vaccinations ? JSON.parse(e.vaccinations as string) : [];
          maxVacc = Math.max(maxVacc, Array.isArray(vacc) ? vacc.length : 0);
        }

        // Build headers
        const consolidatedHeaders: string[] = [
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
          consolidatedHeaders.push(
            `Address ${i} Type`, `Address ${i} Line 1`, `Address ${i} Line 2`,
            `Address ${i} City`, `Address ${i} State`, `Address ${i} Postal Code`, `Address ${i} Country`,
          );
        }
        // Qualification columns
        for (let i = 1; i <= maxQual; i++) {
          consolidatedHeaders.push(
            `Qualification ${i} Degree`, `Qualification ${i} Degree Name`,
            `Qualification ${i} Institution`, `Qualification ${i} Year of Passing`,
            `Qualification ${i} Grade`,
          );
        }
        // Emergency Contact columns
        for (let i = 1; i <= maxEc; i++) {
          consolidatedHeaders.push(
            `Emergency Contact ${i} Name`, `Emergency Contact ${i} Number`,
            `Emergency Contact ${i} Relationship`,
          );
        }
        // Document columns
        for (let i = 1; i <= maxDoc; i++) {
          consolidatedHeaders.push(
            `Document ${i} Title`, `Document ${i} Type`, `Document ${i} Category`,
            `Document ${i} Issue Date`, `Document ${i} Expiry Date`,
          );
        }
        // Vaccination columns
        for (let i = 1; i <= maxVacc; i++) {
          consolidatedHeaders.push(
            `Vaccination ${i} Name`, `Vaccination ${i} Date`, `Vaccination ${i} Dose`,
            `Vaccination ${i} Certificate`,
          );
        }

        // Build rows
        const consolidatedRows = employees.map(e => {
          const row: (string | number | boolean | null | undefined)[] = [
            // Master
            e.employeeCode, e.referenceCode ?? '', e.firstName, e.lastName,
            `${e.firstName} ${e.lastName}`, e.gender, fmt(e.dob), e.age ?? '',
            e.phone, e.alternatePhone ?? '', e.email,
            e.Department.name, e.Branch.name, e.designation?.name ?? '', e.role.name,
            e.reportingManager ? (empMap.get(e.reportingManager) ?? e.reportingManager) : '',
            e.inchargeId ? (empMap.get(e.inchargeId) ?? e.inchargeId) : '',
            fmt(e.dateOfJoining), e.employmentType, e.employmentStatus,
            fmt(e.probationEndDate), e.totalYearsOfExperience ?? '',
            e.marital ?? '', e.fatherName ?? '', e.motherName ?? '',
            e.panNumber ?? '', e.aadharNumber ?? '', e.uanNumber ?? '',
            e.licenseNumber ?? '', fmt(e.licenseRegDate), fmt(e.licenseExpiryDate),
            e.bloodGroup ?? '', e.height ?? '', e.weight ?? '', e.bmi ?? '',
            e.bloodPressure ?? '', e.bloodSugar ?? '', e.cholesterol ?? '',
            e.smoking ? 'Yes' : 'No', e.alcohol ? 'Yes' : 'No', e.exerciseFrequency ?? '',
            e.allergies ?? '', e.chronicConditions ?? '', e.pastSurgeries ?? '',
            e.visionType ?? '', e.usesGlasses ? 'Yes' : 'No', e.visionRemarks ?? '',
            e.hasDisability ? 'Yes' : 'No', e.disabilityType ?? '', e.disabilityDescription ?? '',
            e.preferredHospital ?? '', e.primaryPhysician ?? '', e.emergencyNotes ?? '',
            fmt(e.preEmploymentCheckDate),
            fmt(e.createdAt), fmt(e.updatedAt),
          ];

          // Addresses
          const empAddrs = addrByEmp.get(e.id) ?? [];
          for (let i = 0; i < maxAddr; i++) {
            const a = empAddrs[i];
            row.push(
              a?.type ?? '', a?.line1 ?? '', a?.line2 ?? '',
              a?.city ?? '', a?.state ?? '', a?.zipCode ?? '', a?.country ?? '',
            );
          }
          // Qualifications
          const empQuals = qualByEmp.get(e.id) ?? [];
          for (let i = 0; i < maxQual; i++) {
            const q = empQuals[i];
            row.push(
              q?.degree ?? '', q?.degreeName ?? '',
              q?.institution ?? '', q?.year ?? '', q?.grade ?? '',
            );
          }
          // Emergency Contacts
          const empEcs = ecByEmp.get(e.id) ?? [];
          for (let i = 0; i < maxEc; i++) {
            const c = empEcs[i];
            row.push(c?.name ?? '', c?.phone ?? '', c?.relationship ?? '');
          }
          // Documents
          const empDocs = docByEmp.get(e.id) ?? [];
          for (let i = 0; i < maxDoc; i++) {
            const d = empDocs[i];
            row.push(
              d?.title ?? '', d?.type ?? '', d?.category ?? '',
              fmt(d?.issueDate), fmt(d?.expiryDate),
            );
          }
          // Vaccinations
          const vaccArr = e.vaccinations ? JSON.parse(e.vaccinations as string) : [];
          const vaccList: any[] = Array.isArray(vaccArr) ? vaccArr : [];
          for (let i = 0; i < maxVacc; i++) {
            const v = vaccList[i];
            row.push(
              v?.name ?? v?.vaccineName ?? '',
              v?.date ?? v?.vaccinationDate ?? '',
              v?.dose ?? v?.doseNumber ?? '',
              v?.proofUrl ?? v?.certificate ?? '',
            );
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
  } catch (error: any) {
    console.error(`Export error for table "${table}":`, error);
    res.status(500).json({ error: 'Export failed', message: error.message });
  }
};
