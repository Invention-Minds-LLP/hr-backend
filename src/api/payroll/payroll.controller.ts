import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { createNotification } from '../notifications/notifications.controller';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';

// ─── helpers ─────────────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function professionalTax(gross: number): number {
  if (gross < 15000) return 0;
  if (gross < 20000) return 150;
  return 200;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Count calendar working days (Mon–Sat) in a month; no holiday deduction here
// (attendance data already reflects holidays/week-offs)
function calendarWorkingDays(year: number, month: number): number {
  const total = daysInMonth(year, month);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    const day = new Date(year, month - 1, d).getDay(); // 0=Sun
    if (day !== 0) count++;
  }
  return count;
}

async function buildPayslip(
  employeeId: number,
  month: number,
  year: number,
  payrollRunId: number
): Promise<any> {
  const sal = await (prisma as any).salaryStructure.findUnique({ where: { employeeId } });
  if (!sal) return null;

  const startDate = new Date(year, month - 1, 1);
  const endDate   = new Date(year, month, 0, 23, 59, 59);

  // ── attendance ──────────────────────────────────────────────────────────────
  const attendances = await prisma.attendance.findMany({
    where: { employeeId, date: { gte: startDate, lte: endDate } },
  });

  let presentDays = 0;
  for (const a of attendances) {
    const s = a.status as string;
    if (s === 'PRESENT')               presentDays += 1;
    else if (s === 'HALF_DAY')         presentDays += 0.5;
    else if (s === 'WEEK_OFF')         presentDays += 1;  // paid
    else if (s === 'HOLIDAY')          presentDays += 1;  // paid
    else if (s === 'COMP_OFF')         presentDays += 1;  // paid
    else if (s === 'WFH')              presentDays += 1;  // paid
  }

  // ── approved leaves ─────────────────────────────────────────────────────────
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      startDate: { lte: endDate },
      endDate:   { gte: startDate },
    },
  });
  let leaveDays = 0;
  for (const l of leaves) {
    const s = new Date(Math.max(l.startDate.getTime(), startDate.getTime()));
    const e = new Date(Math.min(l.endDate.getTime(),   endDate.getTime()));
    const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
    leaveDays += diff;
  }
  presentDays += leaveDays;

  // ── overtime ─────────────────────────────────────────────────────────────────
  const otRecords = await prisma.overtimeApproval.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      date: { gte: startDate, lte: endDate },
    } as any,
  });
  let overtimeHours = 0;
  for (const ot of otRecords) {
    overtimeHours += (ot as any).hours ?? 0;
  }

  const workingDays = calendarWorkingDays(year, month);
  const lopDays     = Math.max(0, workingDays - presentDays);

  // ── earnings ─────────────────────────────────────────────────────────────────
  const gross = sal.basic + sal.hra + sal.medicalAllowance + sal.travelAllowance +
                sal.specialAllowance + sal.otherAllowances;
  const perDay = workingDays > 0 ? gross / workingDays : 0;
  const earnedGross = round2(gross - lopDays * perDay);

  // Hourly OT rate = (basic / (workingDays * 8)) * 2 (double rate)
  const hourlyOtRate = workingDays > 0 ? (sal.basic / (workingDays * 8)) * 2 : 0;
  const overtimePay  = round2(overtimeHours * hourlyOtRate);

  // ── deductions ───────────────────────────────────────────────────────────────
  const pfEmployee    = sal.pfApplicable  ? round2(sal.basic * 0.12)   : 0;
  const pfEmployer    = sal.pfApplicable  ? round2(sal.basic * 0.12)   : 0;
  const esiEmployee   = (sal.esiApplicable && gross <= 21000) ? round2(gross * 0.0075) : 0;
  const esiEmployer   = (sal.esiApplicable && gross <= 21000) ? round2(gross * 0.0325) : 0;
  const pt            = sal.ptApplicable  ? professionalTax(earnedGross) : 0;
  const tds           = sal.tdsMonthly ?? 0;

  const totalDeductions = round2(pfEmployee + esiEmployee + pt + tds);
  const netPay          = round2(earnedGross + overtimePay - totalDeductions);

  return {
    employeeId,
    payrollRunId,
    month,
    year,
    workingDays,
    presentDays: round2(presentDays),
    leaveDays:   round2(leaveDays),
    lopDays:     round2(lopDays),
    overtimeHours,
    overtimePay,
    basic:            sal.basic,
    hra:              sal.hra,
    medicalAllowance: sal.medicalAllowance,
    travelAllowance:  sal.travelAllowance,
    specialAllowance: sal.specialAllowance,
    otherAllowances:  sal.otherAllowances,
    grossEarnings:    earnedGross,
    pfEmployee,
    pfEmployer,
    esiEmployee,
    esiEmployer,
    professionalTax: pt,
    tds,
    totalDeductions,
    netPay,
  };
}

// ─── salary structure ─────────────────────────────────────────────────────────

export const listSalaryStructures = async (req: Request, res: Response) => {
  try {
    const { search = '', page = '1', limit = '20' } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);

    const structures = await (prisma as any).salaryStructure.findMany({
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
                { firstName: { contains: search as string } },
                { lastName:  { contains: search as string } },
                { employeeCode: { contains: search as string } },
              ],
            },
          }
        : undefined,
      orderBy: { employee: { firstName: 'asc' } },
    });

    const total = await (prisma as any).salaryStructure.count();
    res.json({ data: structures, total });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getEmployeeSalaryStructure = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const structure = await (prisma as any).salaryStructure.findUnique({
      where: { employeeId },
    });
    if (!structure) return res.status(404).json({ message: 'No salary structure found' });
    res.json(structure);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const upsertSalaryStructure = async (req: Request, res: Response) => {
  try {
    const {
      employeeId, basic = 0, hra = 0, medicalAllowance = 0, travelAllowance = 0,
      specialAllowance = 0, otherAllowances = 0,
      pfApplicable = true, esiApplicable = true, ptApplicable = true,
      tdsMonthly = 0, effectiveFrom,
    } = req.body;

    if (!employeeId) return res.status(400).json({ message: 'employeeId required' });

    const structure = await (prisma as any).salaryStructure.upsert({
      where: { employeeId: Number(employeeId) },
      create: {
        employeeId: Number(employeeId),
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
    res.json(structure);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── payroll runs ─────────────────────────────────────────────────────────────

export const listPayrollRuns = async (req: Request, res: Response) => {
  try {
    const runs = await (prisma as any).payrollRun.findMany({
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { _count: { select: { payslips: true } } },
    });
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const createPayrollRun = async (req: Request, res: Response) => {
  try {
    const { month, year, notes } = req.body;
    const performedBy = (req as any).user?.employeeId ?? 1;

    if (!month || !year) return res.status(400).json({ message: 'month and year required' });

    // Prevent duplicate run
    const existing = await (prisma as any).payrollRun.findUnique({
      where: { month_year: { month: Number(month), year: Number(year) } },
    });
    if (existing) return res.status(409).json({ message: `Payroll run for ${month}/${year} already exists` });

    // Fetch all active employees with a salary structure
    const employees = await prisma.employee.findMany({
      where: {
        employmentStatus: 'ACTIVE',
        salaryStructure: { isNot: null },
      } as any,
      select: { id: true },
    });

    // Create run first
    const run = await (prisma as any).payrollRun.create({
      data: { month: Number(month), year: Number(year), notes, processedBy: performedBy, status: 'DRAFT' },
    });

    // Build all payslips
    const payslipData: any[] = [];
    for (const emp of employees) {
      const ps = await buildPayslip(emp.id, Number(month), Number(year), run.id);
      if (ps) payslipData.push(ps);
    }

    if (payslipData.length > 0) {
      await (prisma as any).payslip.createMany({ data: payslipData });
    }

    const fullRun = await (prisma as any).payrollRun.findUnique({
      where: { id: run.id },
      include: { _count: { select: { payslips: true } } },
    });
    res.status(201).json(fullRun);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getPayrollRun = async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const run = await (prisma as any).payrollRun.findUnique({
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
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const publishPayrollRun = async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const run = await (prisma as any).payrollRun.update({
      where: { id: runId },
      data: { status: 'PUBLISHED' },
    });

    // 🔔 Notify every employee who has a payslip in this run
    const payslips = await (prisma as any).payslip.findMany({
      where: { payrollRunId: runId },
      select: { employeeId: true }
    });
    for (const p of payslips) {
      await createNotification(
        p.employeeId,
        `Your payslip for ${monthName(run.month)} ${run.year} is now available. Visit the Payroll section to view it.`
      );
    }

    res.json(run);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

function monthName(m: number): string {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] ?? String(m);
}

export const deletePayrollRun = async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    // Only allow deleting DRAFT runs
    const run = await (prisma as any).payrollRun.findUnique({ where: { id: runId } });
    if (!run) return res.status(404).json({ message: 'Not found' });
    if (run.status === 'PUBLISHED') return res.status(400).json({ message: 'Cannot delete a published payroll run' });

    await (prisma as any).payslip.deleteMany({ where: { payrollRunId: runId } });
    await (prisma as any).payrollRun.delete({ where: { id: runId } });
    res.json({ message: 'Deleted' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── payslips ─────────────────────────────────────────────────────────────────

export const listPayslips = async (req: Request, res: Response) => {
  try {
    const { month, year, employeeId, page = '1', limit = '20' } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (month)      where.month      = Number(month);
    if (year)       where.year       = Number(year);
    if (employeeId) where.employeeId = Number(employeeId);

    const [data, total] = await Promise.all([
      (prisma as any).payslip.findMany({
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
      (prisma as any).payslip.count({ where }),
    ]);
    res.json({ data, total });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getMyPayslips = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = (req as any).user?.empId;
    console.log(employeeId)
    if (!employeeId) return res.status(400).json({ message: 'Unauthorized' });

    const payslips = await (prisma as any).payslip.findMany({
      where: { employeeId, payrollRun: { status: 'PUBLISHED' } },
      include: { payrollRun: { select: { status: true, notes: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    res.json(payslips);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getPayslip = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const payslip = await (prisma as any).payslip.findUnique({
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
    if (!payslip) return res.status(404).json({ message: 'Payslip not found' });
    res.json(payslip);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const updatePayslipRemarks = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { remarks } = req.body;
    const ps = await (prisma as any).payslip.update({ where: { id }, data: { remarks } });
    res.json(ps);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── payroll summary (for dashboard cards) ───────────────────────────────────

export const getPayrollSummary = async (req: Request, res: Response) => {
  try {
    const { month, year } = req.query as any;

    const run = await (prisma as any).payrollRun.findUnique({
      where: { month_year: { month: Number(month), year: Number(year) } },
      include: { payslips: true },
    });

    if (!run) return res.json({ exists: false });

    const totalGross   = run.payslips.reduce((s: number, p: any) => s + p.grossEarnings, 0);
    const totalNet     = run.payslips.reduce((s: number, p: any) => s + p.netPay, 0);
    const totalPF      = run.payslips.reduce((s: number, p: any) => s + p.pfEmployee + p.pfEmployer, 0);
    const totalESI     = run.payslips.reduce((s: number, p: any) => s + p.esiEmployee + p.esiEmployer, 0);
    const totalLop     = run.payslips.reduce((s: number, p: any) => s + p.lopDays, 0);

    res.json({
      exists:      true,
      runId:       run.id,
      status:      run.status,
      headcount:   run.payslips.length,
      totalGross:  round2(totalGross),
      totalNet:    round2(totalNet),
      totalPF:     round2(totalPF),
      totalESI:    round2(totalESI),
      totalLop:    round2(totalLop),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
