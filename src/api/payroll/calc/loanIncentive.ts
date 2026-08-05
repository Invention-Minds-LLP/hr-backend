// ─────────────────────────────────────────────────────────────────────────────
//  Loan recovery and incentive payout inside a payroll run.
//
//  Both modules already existed but never reached a payslip — HR was keying the
//  figures by hand into the working sheet, which is exactly where transcription
//  errors come from.
//
//  Behaviour is "auto with preview": the run pulls in what is due, and the
//  approval screen shows every line so HR can see what was pulled and exclude
//  anything before publishing. Nothing settles until the run is PUBLISHED —
//  a draft that gets deleted must not leave a loan half-repaid.
//
//  ── The rule that protects the employee ─────────────────────────────────────
//  An EMI is never allowed to exceed the outstanding balance, and recovery is
//  capped so it cannot drive net pay negative. A payroll system that hands
//  someone a negative payslip has failed, and the earlier PF bug in this
//  codebase did exactly that.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../../../lib/prisma';
import { config } from '../../../config';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface LoanRecoveryLine {
  loanId: number;
  loanType: string;
  emiAmount: number;
  /** What will actually be recovered — EMI, or the outstanding if that is less. */
  recoverAmount: number;
  outstandingBefore: number;
  outstandingAfter: number;
  isFinalInstalment: boolean;
  note?: string;
}

export interface IncentiveLine {
  incentiveId: number;
  type: string;
  amount: number;
  description: string | null;
  effectiveDate: Date;
}

export interface LoanIncentivePreview {
  employeeId: number;
  loanRecovery: number;
  incentivePayout: number;
  loans: LoanRecoveryLine[];
  incentives: IncentiveLine[];
  notes: string[];
}

/** Is loan recovery switched on for this deployment? */
export function loanRecoveryEnabled(): boolean {
  return config.flags.payrollLoanRecovery !== false;
}

/** Is incentive payout through payroll switched on for this deployment? */
export function incentivePayoutEnabled(): boolean {
  return config.flags.payrollIncentivePayout !== false;
}

/**
 * What would be recovered and paid for one employee in one payroll month.
 * Read-only — safe to call from a preview endpoint.
 *
 * `netPayBeforeAdjustments` lets the caller cap recovery so the payslip cannot
 * go negative. Pass it when computing a real payslip; omit for a pure preview.
 */
export async function previewLoanAndIncentive(
  employeeId: number,
  month: number,
  year: number,
  netPayBeforeAdjustments?: number,
): Promise<LoanIncentivePreview> {
  const p: any = prisma;
  const notes: string[] = [];

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  // ── Loans ────────────────────────────────────────────────────────────────
  const loans: LoanRecoveryLine[] = [];
  let loanRecovery = 0;

  if (loanRecoveryEnabled()) {
    const active = await p.loan.findMany({
      where: {
        employeeId,
        status: { in: ['ACTIVE', 'APPROVED'] },
        outstandingBalance: { gt: 0 },
        // Only recover once the money has actually been handed over.
        disbursedOn: { not: null, lte: monthEnd },
      },
      orderBy: { disbursedOn: 'asc' },
    });

    for (const loan of active) {
      // Guard against a double recovery if the run is rebuilt for a month that
      // already has a repayment recorded.
      const alreadyThisMonth = await p.loanRepayment.findFirst({
        where: {
          loanId: loan.id,
          paidOn: { gte: monthStart, lte: monthEnd },
          mode: 'SALARY_DEDUCTION',
        },
      });
      if (alreadyThisMonth) {
        notes.push(`Loan #${loan.id}: an instalment is already recorded for this month — skipped.`);
        continue;
      }

      const outstanding = round2(loan.outstandingBalance);
      // Never take more than is owed. The last instalment is usually smaller
      // than the EMI, and overshooting creates a credit nobody reconciles.
      const recover = round2(Math.min(loan.emiAmount, outstanding));
      const isFinal = recover >= outstanding - 0.01;

      loans.push({
        loanId: loan.id,
        loanType: loan.loanType,
        emiAmount: round2(loan.emiAmount),
        recoverAmount: recover,
        outstandingBefore: outstanding,
        outstandingAfter: round2(outstanding - recover),
        isFinalInstalment: isFinal,
        note: isFinal ? 'Final instalment — the loan closes with this run.' : undefined,
      });
      loanRecovery = round2(loanRecovery + recover);
    }
  }

  // ── Incentives ───────────────────────────────────────────────────────────
  const incentives: IncentiveLine[] = [];
  let incentivePayout = 0;

  if (incentivePayoutEnabled()) {
    const due = await p.incentive.findMany({
      where: {
        employeeId,
        status: 'APPROVED',
        paidOn: null,
        // Anything approved and effective on or before month end is due now.
        // Using lte rather than a month window means an incentive approved late
        // is still picked up in the next run instead of being lost.
        effectiveDate: { lte: monthEnd },
      },
      orderBy: { effectiveDate: 'asc' },
    });

    for (const inc of due) {
      incentives.push({
        incentiveId: inc.id,
        type: inc.type,
        amount: round2(inc.amount),
        description: inc.description ?? null,
        effectiveDate: inc.effectiveDate,
      });
      incentivePayout = round2(incentivePayout + inc.amount);
    }
  }

  // ── Negative-pay guard ───────────────────────────────────────────────────
  if (netPayBeforeAdjustments != null) {
    const available = round2(netPayBeforeAdjustments + incentivePayout);
    if (loanRecovery > available && available >= 0) {
      const capped = Math.max(0, available);
      notes.push(
        `Loan recovery reduced from ${loanRecovery.toFixed(2)} to ${capped.toFixed(2)} — ` +
        `the full instalment would have made net pay negative. The shortfall stays outstanding ` +
        `and carries to next month.`,
      );
      // Trim from the last loan backwards so earlier loans stay whole.
      let excess = round2(loanRecovery - capped);
      for (let i = loans.length - 1; i >= 0 && excess > 0; i--) {
        const take = Math.min(loans[i].recoverAmount, excess);
        loans[i].recoverAmount = round2(loans[i].recoverAmount - take);
        loans[i].outstandingAfter = round2(loans[i].outstandingBefore - loans[i].recoverAmount);
        loans[i].isFinalInstalment = loans[i].outstandingAfter <= 0.01;
        excess = round2(excess - take);
      }
      loanRecovery = capped;
    }
  }

  return { employeeId, loanRecovery, incentivePayout, loans, incentives, notes };
}

/**
 * Settle the recoveries and payouts for a published run.
 *
 * Called once, at publish. Writes LoanRepayment rows, moves loan balances,
 * closes loans that reach zero, and marks incentives PAID.
 *
 * Idempotent by design: a repayment already recorded against the payslip is
 * skipped, so publishing twice cannot double-recover.
 */
export async function settleForPayslip(
  payslip: { id: number; employeeId: number; month: number; year: number; loanRecovery: number; incentivePayout: number },
): Promise<{ loansSettled: number; incentivesPaid: number; notes: string[] }> {
  const p: any = prisma;
  const notes: string[] = [];
  let loansSettled = 0;
  let incentivesPaid = 0;

  const paidOn = new Date(payslip.year, payslip.month - 1, 28);

  if (payslip.loanRecovery > 0) {
    const existing = await p.loanRepayment.findFirst({ where: { payslipId: payslip.id } });
    if (existing) {
      notes.push('Loan recovery for this payslip was already settled — skipped.');
    } else {
      const preview = await previewLoanAndIncentive(
        payslip.employeeId, payslip.month, payslip.year,
      );

      // Distribute the amount actually deducted across the loans, in order.
      let remaining = round2(payslip.loanRecovery);
      for (const line of preview.loans) {
        if (remaining <= 0) break;
        const amount = round2(Math.min(line.recoverAmount, remaining));
        if (amount <= 0) continue;

        const loan = await p.loan.findUnique({ where: { id: line.loanId } });
        if (!loan) continue;

        const newOutstanding = round2(Math.max(0, loan.outstandingBalance - amount));

        await prisma.$transaction(
          async (tx: any) => {
            await tx.loanRepayment.create({
              data: {
                loanId: line.loanId,
                employeeId: payslip.employeeId,
                amount,
                paidOn,
                mode: 'SALARY_DEDUCTION',
                payslipId: payslip.id,
                remarks: `Recovered in payroll ${payslip.month}/${payslip.year}`,
              },
            });
            await tx.loan.update({
              where: { id: line.loanId },
              data: {
                totalRepaid: round2(loan.totalRepaid + amount),
                outstandingBalance: newOutstanding,
                status: newOutstanding <= 0.01 ? 'CLOSED' : 'ACTIVE',
              },
            });
          },
          { maxWait: 15000, timeout: 30000 },
        );

        if (newOutstanding <= 0.01) notes.push(`Loan #${line.loanId} closed — fully repaid.`);
        remaining = round2(remaining - amount);
        loansSettled++;
      }
    }
  }

  if (payslip.incentivePayout > 0) {
    const monthEnd = new Date(payslip.year, payslip.month, 0, 23, 59, 59, 999);
    const due = await p.incentive.findMany({
      where: {
        employeeId: payslip.employeeId,
        status: 'APPROVED',
        paidOn: null,
        effectiveDate: { lte: monthEnd },
      },
    });

    for (const inc of due) {
      await p.incentive.update({
        where: { id: inc.id },
        data: { status: 'PAID', paidOn },
      });
      incentivesPaid++;
    }
  }

  return { loansSettled, incentivesPaid, notes };
}
