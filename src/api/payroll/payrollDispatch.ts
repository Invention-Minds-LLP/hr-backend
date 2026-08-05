// ─────────────────────────────────────────────────────────────────────────────
//  Emailing the verified payroll workbook to Finance.
//
//  Closes the last manual step of month-end. Previously HR downloaded the sheet
//  and attached it to an email by hand — which is exactly where last month's
//  file gets sent, or a draft goes out as if it were final.
//
//  Three safeguards, because this email is what someone pays salaries from:
//
//   1. A DRAFT run can only be sent with `acknowledgeDraft`, and the subject and
//      body are stamped DRAFT so a recipient cannot mistake it for final.
//   2. Attendance exceptions are counted before sending and reported back, so
//      HR knows if they are dispatching figures that no longer reconcile.
//   3. Every send is recorded with the totals as they stood, so "what did
//      Finance actually receive?" does not depend on anyone's sent-items.
// ─────────────────────────────────────────────────────────────────────────────

import { Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { currentEmployeeId } from '../../lib/currentUser';
import { sendMail } from '../../lib/mailer';
import { config } from '../../config';
import { renderWorkbook, MONTHS, SheetMode } from './templates/engine';
import { getTemplate, listTemplates } from './templates';
import { buildEmployeeCalendar } from './calc/attendanceCalendar';
import { resolveStatutoryRates } from './calc/resolveStatutory';
import { coerceCompanyId } from '../../lib/company';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const fmtINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
    .format(Number(n) || 0);

/** Split a comma/semicolon/newline separated list and keep only valid addresses. */
function parseRecipients(raw: unknown): { valid: string[]; invalid: string[] } {
  const parts = String(raw ?? '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const valid: string[] = [];
  const invalid: string[] = [];
  // Deliberately permissive: this rejects obvious typos, not exotic-but-legal
  // addresses. Bouncing a real address is worse than letting the SMTP server
  // reject a bad one.
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const p of parts) (re.test(p) ? valid : invalid).push(p);
  return { valid: [...new Set(valid)], invalid };
}

async function fetchRun(runId: number) {
  return (prisma as any).payrollRun.findUnique({
    where: { id: runId },
    include: {
      company: true,
      payslips: {
        include: {
          employee: {
            include: {
              Department: { select: { name: true } },
              designation: { select: { name: true } },
              bankDetail: true,
              salaryStructure: true,
            },
          },
        },
        orderBy: { employee: { employeeCode: 'asc' } },
      },
    },
  });
}

/** Run totals, computed once and reused for the email body and the audit row. */
function totalsFor(run: any) {
  const sum = (fn: (p: any) => number) =>
    round2(run.payslips.reduce((s: number, p: any) => s + (fn(p) || 0), 0));

  const totalGross = sum((p) => (p.grossEarnings || 0) + (p.overtimePay || 0) +
    (p.variableIncentive || 0) + (p.salaryRevisionArrear || 0) + (p.otherAddition || 0) +
    (p.incentivePayout || 0));

  const employerCost = sum((p) =>
    (p.pfEmployer || 0) + (p.esiEmployer || 0) + (p.lwfEmployer || 0) +
    (p.pfAdminCharges || 0) + (p.edliCharges || 0));

  return {
    employeeCount: run.payslips.length,
    totalGross,
    totalDeductions: sum((p) => p.totalDeductions),
    totalNet: sum((p) => p.netPay),
    totalEmployerCost: employerCost,
    totalPf: sum((p) => (p.pfEmployee || 0) + (p.pfEmployer || 0)),
    totalEsi: sum((p) => (p.esiEmployee || 0) + (p.esiEmployer || 0)),
    totalPt: sum((p) => p.professionalTax),
    totalTds: sum((p) => p.tds),
    totalLoanRecovery: sum((p) => p.loanRecovery),
    totalIncentive: sum((p) => p.incentivePayout),
  };
}

/**
 * GET /api/payroll/runs/:id/dispatch-preview
 * What would be sent, and anything that ought to be fixed first.
 */
export const getDispatchPreview = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const run = await fetchRun(runId);
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });

    const totals = totalsFor(run);

    // Count employees whose attendance no longer matches the payslip. Sending a
    // workbook that does not reconcile is the failure this preview exists for.
    let unreconciled = 0;
    let negativeNet = 0;
    for (const slip of run.payslips) {
      if (slip.netPay < 0) negativeNet++;
      const cal = await buildEmployeeCalendar(slip.employeeId, run.month, run.year);
      if (cal && Math.abs((slip.lopDays || 0) - cal.summary.lopDays) >= 0.51) unreconciled++;
    }

    const previous = await (prisma as any).payrollDispatch.findMany({
      where: { payrollRunId: runId },
      orderBy: { sentAt: 'desc' },
      take: 5,
    });

    const blockers: string[] = [];
    if (negativeNet) blockers.push(`${negativeNet} payslip(s) have a negative net pay.`);
    if (unreconciled) {
      blockers.push(
        `${unreconciled} employee(s) no longer reconcile with attendance — regenerate the run first.`,
      );
    }

    const warnings: string[] = [];
    if (run.status !== 'PUBLISHED') {
      warnings.push('This run is still a DRAFT. Figures may change before it is published.');
    }
    if (!run.company?.financeEmails) {
      warnings.push('No default finance recipients are set on the company — enter them manually, or save them under Companies & Statutory.');
    }

    res.json({
      runId,
      month: run.month,
      year: run.year,
      status: run.status,
      monthLabel: `${MONTHS[run.month]} ${run.year}`,
      company: run.company
        ? { id: run.company.id, name: run.company.name, financeEmails: run.company.financeEmails }
        : null,
      defaultRecipients: run.company?.financeEmails ?? '',
      templates: listTemplates(),
      totals,
      blockers,
      warnings,
      previousDispatches: previous,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/payroll/runs/:id/dispatch
 * Build the chosen workbooks and email them.
 *
 * Body: { to, cc?, templates?: string[], mode?, note?, acknowledgeDraft?, subject? }
 */
export const dispatchPayrollSheet = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const run = await fetchRun(runId);
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });
    if (!run.payslips.length) {
      return res.status(400).json({ message: 'This run has no payslips to send' });
    }

    // ── Recipients ──────────────────────────────────────────────────────────
    const rawTo = req.body?.to ?? run.company?.financeEmails ?? '';
    const { valid: to, invalid } = parseRecipients(rawTo);
    const { valid: cc } = parseRecipients(req.body?.cc);

    if (!to.length) {
      return res.status(400).json({
        message: 'At least one valid recipient is required.',
        invalid,
      });
    }
    if (invalid.length) {
      return res.status(400).json({
        message: `These do not look like valid email addresses: ${invalid.join(', ')}`,
        invalid,
      });
    }

    // ── Draft guard ─────────────────────────────────────────────────────────
    const isDraft = run.status !== 'PUBLISHED';
    if (isDraft && !req.body?.acknowledgeDraft) {
      return res.status(409).json({
        message:
          'This payroll run is still a DRAFT. Publish it first, or resend with acknowledgeDraft ' +
          'to send it explicitly marked as a draft.',
        requiresAcknowledgement: true,
      });
    }

    // ── Templates ───────────────────────────────────────────────────────────
    const requested: string[] = Array.isArray(req.body?.templates) && req.body.templates.length
      ? req.body.templates.map(String)
      : ['medfin-working-sheet'];

    // A published run goes out as values; a draft as an editable template, so
    // Finance can work in it. The template's own capability wins either way.
    const wantedMode: SheetMode = req.body?.mode === 'template' ? 'template'
      : req.body?.mode === 'snapshot' ? 'snapshot'
      : (isDraft ? 'template' : 'snapshot');

    const orgName = run.company?.legalName || run.company?.name
      || config.branding.companyName || 'HRMINDS';

    // Same statutory rates the payslips were computed with, so the attachment
    // and the payroll agree.
    const dispatchCompanyId = run.companyId ?? (await coerceCompanyId(undefined));
    const { rates } = await resolveStatutoryRates(dispatchCompanyId, run.month, run.year);

    const attachments: { filename: string; content: Buffer }[] = [];
    for (const id of requested) {
      const tpl = getTemplate(id);
      const mode: SheetMode = tpl.modes.includes(wantedMode) ? wantedMode : tpl.modes[0];
      const wb = renderWorkbook(run, mode, tpl, orgName, rates);
      const buf = await wb.xlsx.writeBuffer();
      const filename =
        `Payroll_${tpl.id}_${MONTHS[run.month]}-${run.year}` +
        `${mode === 'snapshot' ? '_FINAL' : '_WORKING'}${isDraft ? '_DRAFT' : ''}.xlsx`;
      attachments.push({ filename, content: Buffer.from(buf) });
    }

    // ── Email ───────────────────────────────────────────────────────────────
    const totals = totalsFor(run);
    const monthLabel = `${MONTHS[run.month]} ${run.year}`;
    const subject = req.body?.subject
      || `${isDraft ? '[DRAFT] ' : ''}Payroll ${monthLabel} — ${orgName}`;

    const row = (label: string, value: string, bold = false) =>
      `<tr><td style="padding:5px 12px 5px 0;color:#444;">${label}</td>` +
      `<td style="padding:5px 0;text-align:right;${bold ? 'font-weight:700;' : ''}">${value}</td></tr>`;

    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#222;">
        ${isDraft ? `<p style="background:#fdecea;border:1px solid #b3261e;color:#7a1c16;
             padding:10px 14px;border-radius:6px;">
             <b>This is a DRAFT payroll run.</b> Figures may still change before it is published.
             Do not process payments from this file.</p>` : ''}
        <p>Hello,</p>
        <p>Please find attached the payroll workbook for <b>${monthLabel}</b>
           for ${orgName}${isDraft ? ' (draft)' : ''}.</p>
        ${req.body?.note ? `<p style="background:#f2f4f7;border-left:3px solid #1f3a93;
             padding:9px 13px;">${String(req.body.note)}</p>` : ''}
        <table style="border-collapse:collapse;margin:14px 0;font-size:13px;">
          ${row('Employees', String(totals.employeeCount))}
          ${row('Gross earnings', fmtINR(totals.totalGross))}
          ${row('Total deductions', fmtINR(totals.totalDeductions))}
          ${row('Net payable', fmtINR(totals.totalNet), true)}
          <tr><td colspan="2" style="padding-top:8px;border-top:1px solid #ddd;"></td></tr>
          ${row('PF (employee + employer)', fmtINR(totals.totalPf))}
          ${row('ESI (employee + employer)', fmtINR(totals.totalEsi))}
          ${row('Professional tax', fmtINR(totals.totalPt))}
          ${row('TDS', fmtINR(totals.totalTds))}
          ${totals.totalLoanRecovery ? row('Loan recovery', fmtINR(totals.totalLoanRecovery)) : ''}
          ${totals.totalIncentive ? row('Incentives paid', fmtINR(totals.totalIncentive)) : ''}
          ${row('Employer cost (over and above net)', fmtINR(totals.totalEmployerCost))}
        </table>
        <p style="font-size:12px;color:#666;">
          Attached: ${attachments.map((a) => a.filename).join(', ')}<br>
          Generated from HRMINDS on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.
        </p>
      </div>`;

    const dispatchBase = {
      payrollRunId: runId,
      companyId: run.companyId ?? null,
      recipients: to.join(', '),
      ccList: cc.length ? cc.join(', ') : null,
      subject,
      note: req.body?.note ? String(req.body.note) : null,
      templates: requested.join(', '),
      mode: wantedMode,
      fileNames: attachments.map((a) => a.filename).join(', '),
      employeeCount: totals.employeeCount,
      totalGross: totals.totalGross,
      totalDeductions: totals.totalDeductions,
      totalNet: totals.totalNet,
      totalEmployerCost: totals.totalEmployerCost,
      sentBy: currentEmployeeId(req),
    };

    try {
      await sendMail({ to: [...to, ...cc], subject, html });
    } catch (err: any) {
      // Record the failure too — a dispatch log that only contains successes
      // cannot answer "why didn't Finance get it?".
      await (prisma as any).payrollDispatch.create({
        data: { ...dispatchBase, status: 'FAILED', error: err?.message ?? 'Unknown mail error' },
      });
      return res.status(502).json({
        message: `Could not send the email: ${err?.message ?? 'unknown SMTP error'}`,
      });
    }

    const dispatch = await (prisma as any).payrollDispatch.create({
      data: { ...dispatchBase, status: 'SENT' },
    });

    res.status(201).json({
      message: `Payroll workbook sent to ${to.length} recipient(s)`,
      dispatch,
      attachments: attachments.map((a) => a.filename),
      totals,
      wasDraft: isDraft,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** GET /api/payroll/runs/:id/dispatches — who was sent what, and when. */
export const listDispatches = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const rows = await (prisma as any).payrollDispatch.findMany({
      where: { payrollRunId: runId },
      orderBy: { sentAt: 'desc' },
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
