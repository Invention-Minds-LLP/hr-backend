import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { createNotification } from '../notifications/notifications.controller';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { resolveCompanyId, coerceCompanyId } from '../../lib/company';
import { currentEmployeeId } from '../../lib/currentUser';
import { resolveStatutoryRates } from './calc/resolveStatutory';
import { computeStatutory } from './calc/statutory';
import { resolveMonthlyTds } from './calc/resolveTds';
import { previewLoanAndIncentive, settleForPayslip } from './calc/loanIncentive';

// ─── helpers ─────────────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
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
  payrollRunId: number,
  companyId?: number
): Promise<any> {
  const sal = await (prisma as any).salaryStructure.findUnique({ where: { employeeId } });
  if (!sal) return null;

  // Statutory rates are company- and date-scoped. Resolve the employee's legal
  // entity when the caller didn't already pin one for the whole run.
  const resolvedCompanyId = companyId ?? (await resolveCompanyId(employeeId));

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
  let leaveDays = 0;      // total approved leave days in the month (paid + LOP)
  let leaveLopDays = 0;   // LOP (unpaid) portion of that leave, within the month
  for (const l of leaves) {
    const s = new Date(Math.max(l.startDate.getTime(), startDate.getTime()));
    const e = new Date(Math.min(l.endDate.getTime(),   endDate.getTime()));
    const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
    leaveDays += diff;

    // LOP portion of this leave that falls inside the payroll month, apportioned
    // by the share of the leave's calendar span overlapping the month. Legacy
    // rows (lopUnits = 0) and fully-paid leaves stay fully paid.
    const lop = (l as any).lopUnits ?? 0;
    if (lop > 0) {
      const fullDays = Math.round((l.endDate.getTime() - l.startDate.getTime()) / 86400000) + 1;
      const lopInMonth = fullDays > 0 ? (lop * diff) / fullDays : 0;
      leaveLopDays += Math.min(diff, lopInMonth);
    }
  }
  // Only the PAID portion of leave counts as present; the LOP portion is left
  // out, so it flows into lopDays (workingDays − presentDays) → salary deducted.
  presentDays += (leaveDays - leaveLopDays);

  // ── overtime ─────────────────────────────────────────────────────────────────
  // Approval sanctions the hours; for an employee-raised request the manager
  // must also confirm the work landed. An approved-but-unacknowledged claim
  // pays nothing, and one acknowledged as NOT completed is excluded outright —
  // the hours were sanctioned for a task that never happened.
  const otRecords = await prisma.overtimeApproval.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      date: { gte: startDate, lte: endDate },
      NOT: { taskCompleted: false },
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

  // ── statutory deductions & employer provisions ───────────────────────────────
  // Rates come from the company's StatutoryConfig (versioned by effectiveFrom),
  // falling back to the pre-Phase-1 hardcoded values when none is configured —
  // so an un-migrated client's payroll is byte-identical to what it was before.
  const { rates } = await resolveStatutoryRates(resolvedCompanyId, month, year);

  const earnedBasic = round2(sal.basic - lopDays * (workingDays > 0 ? sal.basic / workingDays : 0));

  const statutory = computeStatutory({
    rates,
    flags: {
      pfApplicable:  !!sal.pfApplicable,
      esiApplicable: !!sal.esiApplicable,
      ptApplicable:  !!sal.ptApplicable,
    },
    earnedBasic,
    earnedGross,
    fullMonthGross: gross,
    fullMonthBasic: sal.basic,
    month,
  });

  // ── income tax ───────────────────────────────────────────────────────────────
  // AUTO → projected by the tax engine across the remaining months of the FY.
  // MANUAL → SalaryStructure.tdsMonthly, i.e. exactly the old behaviour. The
  // switch is per-employee (EmployeeTaxProfile.autoComputeTds), so a client
  // adopts the engine gradually instead of all at once.
  const tdsResult = await resolveMonthlyTds(employeeId, month, year, sal.tdsMonthly ?? 0);
  const tds = tdsResult.tds;

  // ── loan recovery & incentive payout ─────────────────────────────────────────
  // Pulled from the loan and incentive modules rather than keyed by hand into
  // the working sheet. Recovery is capped against the pre-adjustment net so a
  // large EMI can never produce a negative payslip; the shortfall stays
  // outstanding and carries forward.
  const statutoryDeductions = round2(statutory.totalEmployeeDeductions + tds);
  const netBeforeAdjustments = round2(earnedGross + overtimePay - statutoryDeductions);

  const adjustments = await previewLoanAndIncentive(
    employeeId, month, year, netBeforeAdjustments,
  );

  const totalDeductions = round2(statutoryDeductions + adjustments.loanRecovery);
  const netPay          = round2(
    earnedGross + overtimePay + adjustments.incentivePayout - totalDeductions,
  );

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
    // Employer PF is stored as the full 12% (PF + EPS split) so existing
    // reports that sum pfEmployee + pfEmployer keep reconciling; the EPS split
    // is recomputed from StatutoryConfig when the ECR file is generated.
    pfEmployee:       statutory.pfEmployee,
    pfEmployer:       round2(statutory.pfEmployer + statutory.epsEmployer),
    esiEmployee:      statutory.esiEmployee,
    esiEmployer:      statutory.esiEmployer,
    professionalTax:  statutory.professionalTax,
    tds,
    lwfEmployee:          statutory.lwfEmployee,
    lwfEmployer:          statutory.lwfEmployer,
    pfAdminCharges:       statutory.pfAdminCharges,
    edliCharges:          statutory.edliCharges,
    gratuityProvision:    statutory.gratuityProvision,
    bonusProvision:       statutory.bonusProvision,
    leaveEncashProvision: statutory.leaveEncashProvision,
    tdsMode:              tdsResult.mode,
    taxRegime:            tdsResult.regime,
    loanRecovery:         adjustments.loanRecovery,
    incentivePayout:      adjustments.incentivePayout,
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

    const empId = Number(employeeId);
    const ctc = (n: any) =>
      (n.basic || 0) + (n.hra || 0) + (n.medicalAllowance || 0) + (n.travelAllowance || 0) +
      (n.specialAllowance || 0) + (n.otherAllowances || 0);

    // Capture the prior CTC before the upsert so we can log a revision.
    const existing = await prisma.salaryStructure.findUnique({ where: { employeeId: empId } });
    const oldCtc = existing ? ctc(existing) : 0;
    const newCtc = ctc({ basic, hra, medicalAllowance, travelAllowance, specialAllowance, otherAllowances });

    const structure = await (prisma as any).salaryStructure.upsert({
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
      await prisma.salaryRevision.create({
        data: {
          employeeId: empId,
          previousCtc: oldCtc,
          newCtc,
          percentage: +(((newCtc - oldCtc) / oldCtc) * 100).toFixed(2),
          effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
          reason: req.body?.reason ?? null,
          createdBy: (req as any).user?.id ?? null,
        },
      });
    }

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
    const { month, year, notes, companyId: rawCompanyId } = req.body;
    // The JWT claim is `empId`; reading `employeeId` here always fell through to
    // the `?? 1` fallback, so every run was recorded as processed by employee 1.
    const performedBy = currentEmployeeId(req as any) ?? 1;

    if (!month || !year) return res.status(400).json({ message: 'month and year required' });

    // A run belongs to one legal entity. Omitting companyId resolves to the
    // default company, so single-entity clients call this exactly as before.
    const companyId = await coerceCompanyId(rawCompanyId);

    // Prevent duplicate run for this company/month
    const existing = await (prisma as any).payrollRun.findUnique({
      where: { companyId_month_year: { companyId, month: Number(month), year: Number(year) } },
    });
    if (existing) return res.status(409).json({ message: `Payroll run for ${month}/${year} already exists` });

    // Active employees of THIS company that have a salary structure. Legacy
    // rows with a NULL companyId are picked up by the default company so no
    // employee silently drops out of payroll mid-rollout.
    const isDefaultCompany = await (prisma as any).company.findFirst({
      where: { id: companyId, isDefault: true },
      select: { id: true },
    });

    const employees = await prisma.employee.findMany({
      where: {
        employmentStatus: 'ACTIVE',
        salaryStructure: { isNot: null },
        ...(isDefaultCompany
          ? { OR: [{ companyId }, { companyId: null }] }
          : { companyId }),
      } as any,
      select: { id: true },
    });

    // Create run first
    const run = await (prisma as any).payrollRun.create({
      data: {
        companyId, month: Number(month), year: Number(year),
        notes, processedBy: performedBy, status: 'DRAFT',
      },
    });

    // Build all payslips. Sequential on purpose: each payslip reads the
    // employee's FY payslip history for the TDS projection, so concurrency here
    // would hammer the remote DB for no wall-clock gain.
    const payslipData: any[] = [];
    for (const emp of employees) {
      const ps = await buildPayslip(emp.id, Number(month), Number(year), run.id, companyId);
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

    // Publishing is the point money is committed, so guard against doing it
    // twice — a second publish would settle every loan instalment again.
    const existing = await (prisma as any).payrollRun.findUnique({ where: { id: runId } });
    if (!existing) return res.status(404).json({ message: 'Payroll run not found' });
    if (existing.status === 'PUBLISHED') {
      return res.status(409).json({ message: 'This payroll run is already published' });
    }

    const run = await (prisma as any).payrollRun.update({
      where: { id: runId },
      data: { status: 'PUBLISHED' },
    });

    const payslips = await (prisma as any).payslip.findMany({
      where: { payrollRunId: runId },
      select: {
        id: true, employeeId: true, month: true, year: true,
        loanRecovery: true, incentivePayout: true,
      },
    });

    // Settle loan repayments and mark incentives paid. Done per payslip and
    // outside a single transaction on purpose: the remote DB would time out on
    // 250 employees in one transaction, and each settlement is individually
    // idempotent, so a partial failure can be resolved by re-publishing.
    const settlement = { loansSettled: 0, incentivesPaid: 0, notes: [] as string[] };
    for (const p of payslips) {
      if (!p.loanRecovery && !p.incentivePayout) continue;
      try {
        const r = await settleForPayslip(p);
        settlement.loansSettled += r.loansSettled;
        settlement.incentivesPaid += r.incentivesPaid;
        settlement.notes.push(...r.notes);
      } catch (err: any) {
        settlement.notes.push(`Employee ${p.employeeId}: settlement failed — ${err?.message}`);
      }
    }

    // 🔔 Notify every employee who has a payslip in this run
    for (const p of payslips) {
      await createNotification(
        p.employeeId,
        `Your payslip for ${monthName(run.month)} ${run.year} is now available. Visit the Payroll section to view it.`
      ).catch(() => undefined);
    }

    res.json({ ...run, settlement });
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
    if (run.lockedAt) return res.status(409).json({ message: 'This payroll month is locked. Unlock it first.' });

    await (prisma as any).payslip.deleteMany({ where: { payrollRunId: runId } });
    await (prisma as any).payrollRun.delete({ where: { id: runId } });
    res.json({ message: 'Deleted' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── month-end freeze ─────────────────────────────────────────────────────────
// Locking is the accounting full stop for a payroll month: after it, the run
// cannot be deleted, re-imported or have arrears pushed into it. Publishing
// makes payslips visible; locking asserts the figures are final.

export const lockPayrollRun = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const run = await (prisma as any).payrollRun.findUnique({ where: { id: runId } });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });

    if (run.status !== 'PUBLISHED') {
      return res.status(409).json({
        message: 'Publish the payroll run before locking it — locking a draft would freeze unissued figures.',
      });
    }
    if (run.lockedAt) return res.status(409).json({ message: 'This run is already locked' });

    const updated = await (prisma as any).payrollRun.update({
      where: { id: runId },
      data: { lockedAt: new Date(), lockedBy: currentEmployeeId(req as any) },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const unlockPayrollRun = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const run = await (prisma as any).payrollRun.findUnique({ where: { id: runId } });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });
    if (!run.lockedAt) return res.status(409).json({ message: 'This run is not locked' });

    const updated = await (prisma as any).payrollRun.update({
      where: { id: runId },
      data: { lockedAt: null, lockedBy: null },
    });
    res.json(updated);
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
