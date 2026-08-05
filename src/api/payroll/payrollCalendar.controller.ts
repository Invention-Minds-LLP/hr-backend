// ─────────────────────────────────────────────────────────────────────────────
//  Payroll approval calendar.
//
//  The approval screen used to show four numbers per employee — working days,
//  present, LOP, OT — with no way to see how they were arrived at. An approver
//  signing off 250 payslips on that basis is not approving anything, they are
//  rubber-stamping. These endpoints expose the whole month, day by day, with
//  the loan and incentive lines that were pulled in.
// ─────────────────────────────────────────────────────────────────────────────

import { Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { buildEmployeeCalendar } from './calc/attendanceCalendar';
import { previewLoanAndIncentive } from './calc/loanIncentive';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * GET /api/payroll/runs/:id/calendar/:employeeId
 * One employee's full month behind their payslip.
 */
export const getPayslipCalendar = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const employeeId = Number(req.params.employeeId);

    const run = await (prisma as any).payrollRun.findUnique({ where: { id: runId } });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });

    const payslip = await (prisma as any).payslip.findFirst({
      where: { payrollRunId: runId, employeeId },
    });

    const calendar = await buildEmployeeCalendar(employeeId, run.month, run.year);
    if (!calendar) return res.status(404).json({ message: 'Employee not found' });

    const adjustments = await previewLoanAndIncentive(employeeId, run.month, run.year);

    // Cross-check the calendar against what the payslip actually paid. A gap
    // here means attendance changed after the run was generated — precisely
    // what an approver needs to know before publishing.
    const reconciliation = payslip
      ? {
          payslipWorkingDays: payslip.workingDays,
          payslipPresentDays: payslip.presentDays,
          payslipLopDays: payslip.lopDays,
          calendarWorkingDays: calendar.summary.workingDays,
          calendarPresentDays: calendar.summary.presentDays,
          calendarLopDays: calendar.summary.lopDays,
          lopMatches: Math.abs((payslip.lopDays || 0) - calendar.summary.lopDays) < 0.51,
          otPaidHours: payslip.overtimeHours,
          otApprovedHours: round2(calendar.summary.otApprovedMinutes / 60),
        }
      : null;

    if (reconciliation && !reconciliation.lopMatches) {
      calendar.exceptions.unshift(
        `Payslip shows ${reconciliation.payslipLopDays} LOP day(s) but the calendar now shows ` +
        `${reconciliation.calendarLopDays}. Attendance changed after this run was generated — ` +
        `regenerate the run before publishing.`,
      );
    }

    res.json({ runId, payslip, calendar, adjustments, reconciliation });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/payroll/calendar/:employeeId?month=&year=
 * Standalone calendar, independent of any run — used by the employee's own
 * attendance view and by HR when investigating a query.
 */
export const getEmployeeCalendar = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();

    const calendar = await buildEmployeeCalendar(employeeId, month, year);
    if (!calendar) return res.status(404).json({ message: 'Employee not found' });

    res.json(calendar);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/payroll/runs/:id/exceptions
 * Run-wide triage: which employees in this run need a human to look at them.
 * Built so the approver starts with the problems instead of scrolling 250 rows.
 */
export const getRunExceptions = async (req: AuthenticatedRequest, res: Response) => {
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
              },
            },
          },
          orderBy: { employee: { employeeCode: 'asc' } },
        },
      },
    });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });

    const rows: any[] = [];
    let totalExceptions = 0;

    for (const slip of run.payslips) {
      const calendar = await buildEmployeeCalendar(slip.employeeId, run.month, run.year);
      if (!calendar) continue;

      const s = calendar.summary;
      const lopMatches = Math.abs((slip.lopDays || 0) - s.lopDays) < 0.51;
      const issues = [...calendar.exceptions];
      if (!lopMatches) {
        issues.unshift(`LOP mismatch: payslip ${slip.lopDays}, calendar ${s.lopDays}`);
      }
      if (slip.netPay < 0) {
        issues.unshift(`Negative net pay of ${slip.netPay} — this payslip cannot be issued.`);
      }

      totalExceptions += issues.length;

      rows.push({
        employeeId: slip.employeeId,
        employeeCode: slip.employee?.employeeCode,
        name: `${slip.employee?.firstName ?? ''} ${slip.employee?.lastName ?? ''}`.trim(),
        department: slip.employee?.Department?.name ?? null,
        netPay: slip.netPay,
        lopDays: slip.lopDays,
        summary: s,
        issues,
        issueCount: issues.length,
      });
    }

    // Worst first — the approver's attention is the scarce resource.
    rows.sort((a, b) => b.issueCount - a.issueCount);

    res.json({
      runId,
      month: run.month,
      year: run.year,
      status: run.status,
      employeeCount: rows.length,
      totalExceptions,
      employeesWithIssues: rows.filter((r) => r.issueCount > 0).length,
      rows,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/payroll/runs/:id/adjustments
 * Every loan and incentive line pulled into this run — the "preview before
 * commit" half of the auto-pull behaviour.
 */
export const getRunAdjustments = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const run = await (prisma as any).payrollRun.findUnique({
      where: { id: runId },
      include: {
        payslips: {
          include: {
            employee: {
              select: { id: true, firstName: true, lastName: true, employeeCode: true },
            },
          },
        },
      },
    });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });

    const rows: any[] = [];
    let totalRecovery = 0;
    let totalIncentive = 0;

    for (const slip of run.payslips) {
      if (!slip.loanRecovery && !slip.incentivePayout) continue;
      const preview = await previewLoanAndIncentive(slip.employeeId, run.month, run.year);
      totalRecovery = round2(totalRecovery + (slip.loanRecovery || 0));
      totalIncentive = round2(totalIncentive + (slip.incentivePayout || 0));

      rows.push({
        employeeId: slip.employeeId,
        employeeCode: slip.employee?.employeeCode,
        name: `${slip.employee?.firstName ?? ''} ${slip.employee?.lastName ?? ''}`.trim(),
        payslipId: slip.id,
        loanRecovery: slip.loanRecovery || 0,
        incentivePayout: slip.incentivePayout || 0,
        loans: preview.loans,
        incentives: preview.incentives,
        notes: preview.notes,
      });
    }

    res.json({
      runId,
      status: run.status,
      settled: run.status === 'PUBLISHED',
      totalRecovery,
      totalIncentive,
      employeeCount: rows.length,
      rows,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
