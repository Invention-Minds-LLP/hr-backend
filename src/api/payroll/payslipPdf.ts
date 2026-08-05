// ─────────────────────────────────────────────────────────────────────────────
//  Payslip PDF + distribution.
//
//  Closes the gap where payslip data existed in the database but no employee
//  could ever see a document. Uses pdfkit (already a dependency, same approach
//  as the offer letter and Form 16) and the shared mailer.
//
//  Password protection is optional here, unlike Form 16: a payslip is routinely
//  forwarded to a landlord or a bank, and locking it makes that painful. HR can
//  turn it on per-batch with `protect: true`, which uses the same PAN + DOB
//  convention as Form 16.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import { Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { currentEmployeeId } from '../../lib/currentUser';
import { resolvePermissions } from '../../lib/permissionResolver';
import { sendMail } from '../../lib/mailer';
import { resolveCompanyId } from '../../lib/company';
import { config } from '../../config';
import { MONTHS } from './templates/engine';
import { form16Password } from '../tax/form16';

const fmtINR = (n?: number | null) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(n) || 0);

const fmtDate = (d?: Date | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** Indian-format words for the net pay line. Payslips conventionally carry it. */
export function amountInWords(amount: number): string {
  const n = Math.floor(Math.abs(Number(amount) || 0));
  if (n === 0) return 'Zero Rupees Only';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigit = (v: number): string => {
    if (v < 20) return ones[v];
    return `${tens[Math.floor(v / 10)]}${v % 10 ? ' ' + ones[v % 10] : ''}`;
  };
  const threeDigit = (v: number): string => {
    const h = Math.floor(v / 100);
    const rest = v % 100;
    return `${h ? ones[h] + ' Hundred' : ''}${h && rest ? ' ' : ''}${rest ? twoDigit(rest) : ''}`;
  };

  // Indian grouping: crore, lakh, thousand, hundred.
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigit(crore)} Crore`);
  if (lakh) parts.push(`${threeDigit(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigit(thousand)} Thousand`);
  if (rest) parts.push(threeDigit(rest));

  return `${parts.join(' ')} Rupees Only`;
}

interface PayslipPdfInput {
  payslip: any;
  employee: any;
  company: any;
  password?: string | null;
}

export function generatePayslipPdf(input: PayslipPdfInput): Promise<Buffer> {
  const { payslip: p, employee: emp, company, password } = input;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 42,
        ...(password
          ? { userPassword: password, ownerPassword: `${password}-OWNER`, permissions: { printing: 'highResolution' } }
          : {}),
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const width = right - left;
      const orgName = company?.legalName || company?.name || config.branding.companyName || 'HRMINDS';

      // ── Header ──────────────────────────────────────────────────────────────
      doc.fontSize(16).fillColor('#1f3a93').text(orgName, left, doc.y, { width, align: 'center' });
      const addr = [company?.addressLine1, company?.city, company?.state, company?.pincode]
        .filter(Boolean).join(', ');
      if (addr) {
        doc.fontSize(8.5).fillColor('#555').text(addr, { width, align: 'center' });
      }
      doc.moveDown(0.4);
      doc.fontSize(11).fillColor('#000')
         .text(`Payslip for ${MONTHS[p.month]} ${p.year}`, { width, align: 'center' });
      doc.moveDown(0.5);

      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#1f3a93').lineWidth(1.2).stroke();
      doc.moveDown(0.6);

      // ── Employee identity, two columns ──────────────────────────────────────
      const colW = width / 2 - 8;
      const rightX = left + colW + 16;
      const top = doc.y;

      const idRow = (label: string, value: string, x: number) => {
        doc.fontSize(9).fillColor('#666').text(`${label}`, x, doc.y, { width: 110, continued: true });
        doc.fillColor('#000').text(`  ${value}`, { width: colW - 110 });
      };

      doc.y = top;
      idRow('Employee Name', `${emp?.firstName || ''} ${emp?.lastName || ''}`.trim() || '—', left);
      idRow('Employee Code', emp?.employeeCode || '—', left);
      idRow('Designation', emp?.designation?.name || '—', left);
      idRow('Department', emp?.Department?.name || '—', left);
      const afterLeft = doc.y;

      doc.y = top;
      idRow('Date of Joining', fmtDate(emp?.dateOfJoining), rightX);
      idRow('PAN', emp?.panNumber || '—', rightX);
      idRow('UAN', emp?.uanNumber || '—', rightX);
      idRow('Bank A/C', emp?.bankDetail?.bankAccountNumber || '—', rightX);

      doc.y = Math.max(afterLeft, doc.y);
      doc.moveDown(0.5);

      // ── Attendance strip ────────────────────────────────────────────────────
      const stripY = doc.y;
      doc.rect(left, stripY, width, 22).fillAndStroke('#f2f4f7', '#d9dee6');
      doc.fillColor('#333').fontSize(9);
      const cellW = width / 4;
      const strip = [
        ['Working Days', String(p.workingDays ?? 0)],
        ['Days Paid', String(Math.max(0, (p.workingDays ?? 0) - (p.lopDays ?? 0)))],
        ['LOP Days', String(p.lopDays ?? 0)],
        ['Overtime Hours', String(p.overtimeHours ?? 0)],
      ];
      strip.forEach(([label, value], i) => {
        doc.fillColor('#666').text(`${label}: `, left + i * cellW + 8, stripY + 7,
          { width: cellW - 12, continued: true });
        doc.fillColor('#000').text(value);
      });
      doc.y = stripY + 30;

      // ── Earnings / deductions, side by side ─────────────────────────────────
      const tableTop = doc.y;
      const halfW = width / 2 - 6;

      const earnings: [string, number][] = [
        ['Basic', p.basic],
        ['House Rent Allowance', p.hra],
        ['Medical Allowance', p.medicalAllowance],
        ['Travel Allowance', p.travelAllowance],
        ['Special Allowance', p.specialAllowance],
        ['Other Allowances', p.otherAllowances],
      ];
      if (p.overtimePay) earnings.push(['Overtime', p.overtimePay]);
      if (p.variableIncentive) earnings.push(['Variable Incentive', p.variableIncentive]);
      if (p.salaryRevisionArrear) earnings.push(['Salary Arrears', p.salaryRevisionArrear]);
      if (p.otherAddition) earnings.push(['Other Additions', p.otherAddition]);
      if (p.petrolReimb) earnings.push(['Petrol Reimbursement', p.petrolReimb]);
      if (p.driverReimb) earnings.push(['Driver Reimbursement', p.driverReimb]);

      const deductions: [string, number][] = [];
      if (p.pfEmployee) deductions.push(['Provident Fund', p.pfEmployee]);
      if (p.esiEmployee) deductions.push(['ESI', p.esiEmployee]);
      if (p.professionalTax) deductions.push(['Professional Tax', p.professionalTax]);
      if (p.lwfEmployee) deductions.push(['Labour Welfare Fund', p.lwfEmployee]);
      if (p.tds) deductions.push(['Income Tax (TDS)', p.tds]);
      if (p.advanceRecovery) deductions.push(['Advance Recovery', p.advanceRecovery]);
      if (p.otherDeduction) deductions.push(['Other Deductions', p.otherDeduction]);
      if (!deductions.length) deductions.push(['—', 0]);

      const drawColumn = (x: number, title: string, rows: [string, number][], total: number) => {
        let y = tableTop;
        doc.rect(x, y, halfW, 20).fillAndStroke('#1f3a93', '#1f3a93');
        doc.fillColor('#fff').fontSize(9.5).text(title, x + 8, y + 6, { width: halfW - 90 });
        doc.text('Amount (₹)', x + halfW - 88, y + 6, { width: 80, align: 'right' });
        y += 20;

        doc.fontSize(9);
        for (const [label, value] of rows) {
          doc.rect(x, y, halfW, 17).strokeColor('#e2e6ec').lineWidth(0.5).stroke();
          doc.fillColor('#333').text(label, x + 8, y + 5, { width: halfW - 95 });
          doc.fillColor('#000').text(fmtINR(value), x + halfW - 88, y + 5, { width: 80, align: 'right' });
          y += 17;
        }

        doc.rect(x, y, halfW, 20).fillAndStroke('#e8ecf2', '#d9dee6');
        doc.fillColor('#000').fontSize(9.5).text(`Total ${title}`, x + 8, y + 6, { width: halfW - 95 });
        doc.text(fmtINR(total), x + halfW - 88, y + 6, { width: 80, align: 'right' });
        return y + 20;
      };

      const grossTotal =
        (p.grossEarnings || 0) + (p.overtimePay || 0) + (p.variableIncentive || 0) +
        (p.salaryRevisionArrear || 0) + (p.otherAddition || 0) +
        (p.petrolReimb || 0) + (p.driverReimb || 0);

      const endLeft = drawColumn(left, 'Earnings', earnings, grossTotal);
      const endRight = drawColumn(left + halfW + 12, 'Deductions', deductions, p.totalDeductions || 0);

      doc.y = Math.max(endLeft, endRight) + 14;

      // ── Net pay ─────────────────────────────────────────────────────────────
      const netY = doc.y;
      doc.rect(left, netY, width, 34).fillAndStroke('#1f3a93', '#1f3a93');
      doc.fillColor('#fff').fontSize(11).text('NET PAY', left + 12, netY + 10, { width: 120 });
      doc.fontSize(14).text(`₹ ${fmtINR(p.netPay)}`, left + 140, netY + 8,
        { width: width - 160, align: 'right' });
      doc.y = netY + 42;

      doc.fontSize(8.5).fillColor('#444')
         .text(`Amount in words: ${amountInWords(p.netPay)}`, left, doc.y, { width });
      doc.moveDown(0.8);

      // ── Employer contributions (information only) ───────────────────────────
      const employerRows: [string, number][] = [];
      if (p.pfEmployer) employerRows.push(['Provident Fund (Employer)', p.pfEmployer]);
      if (p.esiEmployer) employerRows.push(['ESI (Employer)', p.esiEmployer]);
      if (p.lwfEmployer) employerRows.push(['Labour Welfare Fund (Employer)', p.lwfEmployer]);
      if (p.gratuityProvision) employerRows.push(['Gratuity Provision', p.gratuityProvision]);
      if (p.bonusProvision) employerRows.push(['Statutory Bonus Provision', p.bonusProvision]);

      if (employerRows.length) {
        doc.fontSize(9).fillColor('#1f3a93').text('Employer Contributions (not deducted from your pay)', left, doc.y);
        doc.moveDown(0.25);
        doc.fontSize(8.5).fillColor('#444');
        for (const [label, value] of employerRows) {
          const y = doc.y;
          doc.text(label, left + 4, y, { width: width - 110 });
          doc.text(fmtINR(value), left + width - 100, y, { width: 96, align: 'right' });
          doc.moveDown(0.15);
        }
        doc.moveDown(0.5);
      }

      if (p.remarks) {
        doc.fontSize(8.5).fillColor('#666').text(`Remarks: ${p.remarks}`, left, doc.y, { width });
        doc.moveDown(0.4);
      }

      // ── Footer ──────────────────────────────────────────────────────────────
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#d9dee6').lineWidth(0.5).stroke();
      doc.moveDown(0.4);
      doc.fontSize(7.5).fillColor('#888').text(
        'This is a computer-generated payslip and does not require a signature.',
        left, doc.y, { width, align: 'center' },
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Load a payslip with everything the PDF needs. */
async function loadPayslip(payslipId: number) {
  return (prisma as any).payslip.findUnique({
    where: { id: payslipId },
    include: {
      payrollRun: true,
      employee: {
        include: {
          Department: { select: { name: true } },
          designation: { select: { name: true } },
          bankDetail: true,
        },
      },
    },
  });
}

type PayslipPdfFailure = { error: string };
type PayslipPdfSuccess = {
  payslip: any;
  employee: any;
  company: any;
  pdf: Buffer;
  password: string | null;
};

async function buildPayslipPdf(
  payslipId: number,
  protect: boolean,
): Promise<PayslipPdfSuccess | PayslipPdfFailure> {
  const payslip = await loadPayslip(payslipId);
  if (!payslip) return { error: 'Payslip not found' };

  // A draft run is not money that was paid — never issue a document for one.
  if (payslip.payrollRun?.status !== 'PUBLISHED') {
    return { error: 'Payroll for this month has not been published yet' };
  }

  const emp = payslip.employee;
  const companyId = emp?.companyId ?? (await resolveCompanyId(emp.id));
  const company = await (prisma as any).company.findUnique({ where: { id: companyId } });

  const password = protect ? form16Password(emp?.panNumber, emp?.dob) : null;
  const pdf = await generatePayslipPdf({ payslip, employee: emp, company, password });

  return { payslip, employee: emp, company, pdf, password };
}

/** GET /api/payroll/payslips/:id/pdf — stream one payslip. */
export const downloadPayslipPdf = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const payslipId = Number(req.params.id);
    if (!payslipId) return res.status(400).json({ message: 'payslip id required' });

    const protect = String(req.query.protect || '') === 'true';
    const built = await buildPayslipPdf(payslipId, protect);
    if ('error' in built) return res.status(404).json({ message: built.error });

    // An employee may only fetch their own payslip; payroll staff pass through.
    // The JWT carries no permission list, so the grant is resolved from the DB
    // the same way the auth middleware does it.
    const callerEmpId = currentEmployeeId(req);
    if (!callerEmpId) return res.status(401).json({ message: 'Unauthorized' });

    if (callerEmpId !== built.payslip.employeeId) {
      const held = await resolvePermissions(callerEmpId);
      if (!held.includes('admin.payroll.view' as any)) {
        return res.status(403).json({ message: 'You can only download your own payslip' });
      }
    }

    const { month, year } = built.payslip;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Payslip_${built.employee.employeeCode}_${MONTHS[month]}-${year}.pdf"`,
    );
    res.send(built.pdf);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/payroll/runs/:id/email-payslips
 * Generate and email every payslip in a published run.
 * Failures are collected per employee — one missing email address must not stop
 * the rest of the batch.
 */
export const emailPayslipsForRun = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const protect = !!req.body?.protect;
    const onlyEmployeeIds: number[] = Array.isArray(req.body?.employeeIds)
      ? req.body.employeeIds.map(Number).filter(Boolean)
      : [];

    const run = await (prisma as any).payrollRun.findUnique({
      where: { id: runId },
      include: { payslips: { select: { id: true, employeeId: true } } },
    });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });
    if (run.status !== 'PUBLISHED') {
      return res.status(409).json({ message: 'Publish the payroll run before emailing payslips' });
    }

    const targets = onlyEmployeeIds.length
      ? run.payslips.filter((p: any) => onlyEmployeeIds.includes(p.employeeId))
      : run.payslips;

    const sent: number[] = [];
    const failed: Array<{ employeeId: number; reason: string }> = [];

    for (const slip of targets) {
      try {
        const built = await buildPayslipPdf(slip.id, protect);
        if ('error' in built) {
          failed.push({ employeeId: slip.employeeId, reason: built.error });
          continue;
        }
        const email = built.employee?.email;
        if (!email) {
          failed.push({ employeeId: slip.employeeId, reason: 'No email address on record' });
          continue;
        }

        const label = `${MONTHS[run.month]} ${run.year}`;
        await sendMail({
          to: email,
          subject: `Payslip for ${label}`,
          html:
            `<p>Dear ${built.employee.firstName},</p>` +
            `<p>Your payslip for <strong>${label}</strong> is attached.</p>` +
            (built.password
              ? `<p>The PDF is password protected. The password is your <strong>PAN in uppercase</strong> ` +
                `followed by your <strong>date of birth as DDMMYYYY</strong>.</p>`
              : '') +
            `<p>Regards,<br>${built.company?.name || 'HR Team'}</p>`,
        });
        sent.push(slip.employeeId);
      } catch (err: any) {
        failed.push({ employeeId: slip.employeeId, reason: err?.message || 'Unknown error' });
      }
    }

    res.json({ runId, requested: targets.length, sent: sent.length, failed });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
