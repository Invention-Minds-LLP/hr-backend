// ─────────────────────────────────────────────────────────────────────────────
//  Pre-flight check before an employee submits a leave application.
//
//  Answers two things the employee could not previously know until it was too
//  late:
//
//   1. Will this be paid? The balance decides it, and a type flagged as loss of
//      pay is unpaid outright. Telling someone AFTER approval that three days
//      were unpaid is how payroll queries start.
//
//   2. Has payroll already been run for those days? Applying on the 28th for the
//      20th means the payslip is already calculated. The application is still
//      accepted — people are genuinely ill late in the month — but everyone is
//      told it will be adjusted next month instead.
//
//  Deliberately read-only. It informs; it does not block.
// ─────────────────────────────────────────────────────────────────────────────

import { Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { currentEmployeeId } from '../../lib/currentUser';
import { resolveLopForRequest, leaveDuration } from '../../lib/leaveLop';
import { checkPayrollCutoff } from '../../lib/payrollCutoff';
import { checkELApplication, getELAvailableBalance, getELRequestCountForYear } from '../../lib/elApplicationRules';
import { countWorkingDays } from './leave.controller';

/**
 * POST /api/leaves/precheck
 * Body: { leaveTypeId, startDate, endDate, isHalfDay?, employeeId? }
 */
export const precheckLeave = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // HR may check on someone's behalf; otherwise it is the caller's own.
    const explicit = Number(req.body?.employeeId);
    const employeeId = Number.isInteger(explicit) && explicit > 0
      ? explicit
      : currentEmployeeId(req);

    if (!employeeId) return res.status(401).json({ message: 'Unauthorized' });

    const { leaveTypeId, startDate, endDate, isHalfDay } = req.body ?? {};
    if (!leaveTypeId || !startDate || !endDate) {
      return res.status(400).json({
        message: 'leaveTypeId, startDate and endDate are required',
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ message: 'startDate or endDate is not a valid date' });
    }
    if (end < start) {
      return res.status(400).json({ message: 'endDate cannot be before startDate' });
    }

    const [lop, cutoff, leaveType] = await Promise.all([
      resolveLopForRequest({
        employeeId,
        leaveTypeId: Number(leaveTypeId),
        startDate: start,
        endDate: end,
        isHalfDay: !!isHalfDay,
      }),
      checkPayrollCutoff({ employeeId, startDate: start, endDate: end }),
      prisma.leaveType.findUnique({
        where: { id: Number(leaveTypeId) },
        select: { id: true, name: true, isLop: true } as any,
      }),
    ]);

    if (!lop || !leaveType) {
      return res.status(404).json({ message: 'Leave type not found' });
    }

    const duration = leaveDuration(start, end, !!isHalfDay);

    // Overlapping requests are worth catching before submission rather than in
    // an approval queue three days later.
    const overlapping = await prisma.leaveRequest.findMany({
      where: {
        employeeId,
        startDate: { lte: end },
        endDate: { gte: start },
        status: { in: ['PENDING', 'APPROVED'] as any },
      },
      include: { leaveType: { select: { name: true } } } as any,
    });

    const warnings: Array<{ level: 'info' | 'warn' | 'danger'; title: string; message: string }> = [];

    if (overlapping.length) {
      warnings.push({
        level: 'danger',
        title: 'Overlapping leave',
        message:
          `You already have ${overlapping.length} leave request(s) covering some of these dates: ` +
          overlapping
            .map((o: any) => `${o.leaveType?.name ?? 'Leave'} ${new Date(o.startDate).toISOString().slice(0, 10)}` +
                             `–${new Date(o.endDate).toISOString().slice(0, 10)} (${o.status})`)
            .join('; '),
      });
    }

    if (lop.forcedByType) {
      warnings.push({
        level: 'warn',
        title: `${leaveType.name} is unpaid`,
        message:
          `All ${duration} day(s) will be loss of pay and deducted from your salary. ` +
          `Choose a different leave type if you have balance available.`,
      });
    } else if (lop.lopUnits > 0) {
      warnings.push({
        level: 'warn',
        title: 'Part of this leave is unpaid',
        message:
          `Your balance covers ${lop.paidUnits} day(s). The remaining ${lop.lopUnits} day(s) ` +
          `will be loss of pay and deducted from your salary.`,
      });
    }

    if (cutoff.warn) {
      warnings.push({
        level: cutoff.locked ? 'danger' : 'warn',
        title: cutoff.title,
        message: cutoff.message,
      });
    }

    // EL is the one type this endpoint can refuse outright: the balance floors
    // are hard rules, so warning about them and then letting the submission fail
    // would just move the rejection one screen later.
    let elBlock: { code: string; message: string } | null = null;
    if ((leaveType as any).name === 'EL') {
      const financialYear = start.getMonth() + 1 >= 4 ? start.getFullYear() : start.getFullYear() - 1;
      // Must match createLeaveRequest exactly, or the pre-flight check and the
      // submit can disagree: EL counts week-offs but still skips mandatory
      // holidays, so a range spanning one is a day shorter than the calendar
      // span that `duration` reports.
      const elUnits = isHalfDay
        ? 0.5
        : await countWorkingDays(employeeId, start, end, { includeWeekOffs: true });
      const [available, requestCount] = await Promise.all([
        getELAvailableBalance(employeeId, financialYear),
        getELRequestCountForYear(employeeId, financialYear),
      ]);
      const elCheck = checkELApplication(available, elUnits, requestCount);
      if (!elCheck.ok) {
        elBlock = { code: elCheck.code!, message: elCheck.error! };
        warnings.push({
          level: 'danger',
          title: 'Earned Leave not permitted',
          message: elCheck.error!,
        });
      }
    }

    res.json({
      employeeId,
      leaveType: { id: leaveType.id, name: leaveType.name, isLop: (leaveType as any).isLop },
      duration,
      paidUnits: lop.paidUnits,
      lopUnits: lop.lopUnits,
      lopReason: lop.reason,
      forcedByType: lop.forcedByType,
      cutoff,
      overlapping: overlapping.map((o: any) => ({
        id: o.id,
        leaveType: o.leaveType?.name ?? null,
        startDate: o.startDate,
        endDate: o.endDate,
        status: o.status,
      })),
      warnings,
      elBlock,
      // The employee can still submit — this informs, it does not block. Only a
      // genuine overlap, or an EL rule breach, is worth refusing.
      canSubmit: overlapping.length === 0 && !elBlock,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
