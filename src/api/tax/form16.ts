// ─────────────────────────────────────────────────────────────────────────────
//  Form 16 — annual TDS certificate.
//
//  Built from ACTUAL payslips for the financial year, never from the monthly
//  projection. The projection answers "what should we deduct this month"; Form
//  16 must answer "what did we actually pay and deduct", and those diverge
//  whenever a declaration was revised or a salary changed mid-year.
//
//  The PDF is password-protected with the employee's PAN + date of birth, which
//  is the convention every Indian payroll uses. pdfkit supports this natively
//  via userPassword, so no extra dependency is needed.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import { Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { currentEmployeeId } from '../../lib/currentUser';
import { sendMail } from '../../lib/mailer';
import { resolveCompanyId } from '../../lib/company';
import { computeAnnualTax, DeclaredDeduction, Regime } from '../payroll/calc/tax';
import { fyStartYear } from '../payroll/calc/taxSlabs';

const fmtINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number.isFinite(n) ? n : 0);

const fmtDate = (d?: Date | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * PAN + DDMMYYYY — the standard Form 16 password convention.
 *
 * The date is resolved in IST explicitly, NOT in the server's local timezone.
 * That matters: DOBs in this database are stored inconsistently — some as
 * IST-midnight (e.g. 1990-05-14T18:30:00Z = 15 May IST), others as UTC-midnight.
 * Reading them with getDate() returns whatever the host timezone happens to be,
 * so the same employee would get a different password on a UTC server than on
 * an IST one, and every issued certificate would stop opening.
 *
 * Pinning to Asia/Kolkata makes the password reproducible anywhere, and matches
 * the date the employee sees in their profile (the UI renders in IST too).
 */
const IST_DATE_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function form16Password(pan?: string | null, dob?: Date | null): string | null {
  if (!pan || !dob) return null;

  const parts = IST_DATE_PARTS.formatToParts(new Date(dob));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const stamp = `${get('day')}${get('month')}${get('year')}`;
  if (stamp.length !== 8) return null;

  return `${pan.toUpperCase().trim()}${stamp}`;
}

export interface Form16Figures {
  grossSalary: number;
  exemptAllowance: number;
  standardDeduct: number;
  chapterViaTotal: number;
  taxableIncome: number;
  taxOnIncome: number;
  rebate87A: number;
  surcharge: number;
  educationCess: number;
  totalTaxPayable: number;
  tdsDeducted: number;
  balanceTax: number;
  regime: Regime;
  monthlyRows: Array<{
    month: number; year: number; gross: number; tds: number;
    pf: number; pt: number;
  }>;
}

/**
 * Compute Form 16 figures for one employee and financial year from published
 * payslips. Returns null when the employee has no payslips in the FY.
 */
export async function computeForm16(
  employeeId: number,
  financialYear: string,
): Promise<Form16Figures | null> {
  const fyStart = fyStartYear(financialYear);
  if (Number.isNaN(fyStart)) return null;

  const payslips = await (prisma as any).payslip.findMany({
    where: {
      employeeId,
      OR: [
        { year: fyStart, month: { gte: 4 } },
        { year: fyStart + 1, month: { lte: 3 } },
      ],
      // Only published runs count — a draft run is not money that was paid.
      payrollRun: { status: 'PUBLISHED' },
    },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  if (!payslips.length) return null;

  let grossSalary = 0;
  let tdsDeducted = 0;
  let employeePf = 0;
  let professionalTax = 0;
  const monthlyRows: Form16Figures['monthlyRows'] = [];

  for (const p of payslips) {
    const gross =
      (p.grossEarnings || 0) + (p.overtimePay || 0) + (p.variableIncentive || 0) +
      (p.salaryRevisionArrear || 0) + (p.otherAddition || 0);

    grossSalary += gross;
    tdsDeducted += p.tds || 0;
    employeePf += p.pfEmployee || 0;
    professionalTax += p.professionalTax || 0;

    monthlyRows.push({
      month: p.month, year: p.year, gross,
      tds: p.tds || 0, pf: p.pfEmployee || 0, pt: p.professionalTax || 0,
    });
  }

  const [profile, declaration, employee] = await Promise.all([
    (prisma as any).employeeTaxProfile.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
    }),
    (prisma as any).taxDeclaration.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
      include: { items: true },
    }),
    prisma.employee.findUnique({ where: { id: employeeId }, select: { dob: true } }),
  ]);

  const regime: Regime = (profile?.regime as Regime) || 'NEW';

  // Only HR-approved amounts go into the certificate. An unreviewed declaration
  // contributes nothing — the certificate is a statutory document, not a draft.
  const deductions: DeclaredDeduction[] = [];
  if (declaration?.items?.length &&
      (declaration.status === 'APPROVED' || declaration.status === 'PARTIALLY_APPROVED')) {
    for (const item of declaration.items) {
      if (item.approvedAmount > 0) {
        deductions.push({ section: item.section, amount: item.approvedAmount });
      }
    }
  }

  const age = employee?.dob
    ? Math.floor((Date.now() - new Date(employee.dob).getTime()) / (365.25 * 24 * 3600 * 1000))
    : 0;

  const salaryStructure = await (prisma as any).salaryStructure.findUnique({
    where: { employeeId },
  });

  const breakdown = computeAnnualTax({
    financialYear,
    regime,
    annualGrossSalary: grossSalary,
    previousEmployerIncome: profile?.previousEmployerIncome || 0,
    previousEmployerTds: profile?.previousEmployerTds || 0,
    otherIncome: profile?.otherIncome || 0,
    housePropertyLoss: profile?.housePropertyLoss || 0,
    deductions,
    annualEmployeePf: employeePf,
    annualProfessionalTax: professionalTax,
    age,
    hra: {
      annualBasic: (salaryStructure?.basic || 0) * 12,
      annualHraReceived: (salaryStructure?.hra || 0) * 12,
      annualRentPaid: profile?.rentPaidAnnual || 0,
      metroCity: profile?.metroCity || false,
    },
  });

  return {
    grossSalary,
    exemptAllowance: breakdown.hraExemption,
    standardDeduct: breakdown.standardDeduction,
    chapterViaTotal: breakdown.chapterViaDeductions,
    taxableIncome: breakdown.taxableIncome,
    taxOnIncome: breakdown.taxBeforeRebate,
    rebate87A: breakdown.rebate87A,
    surcharge: breakdown.surcharge,
    educationCess: breakdown.cess,
    totalTaxPayable: breakdown.totalTaxLiability,
    tdsDeducted,
    balanceTax: Math.round(breakdown.totalTaxLiability - tdsDeducted),
    regime,
    monthlyRows,
  };
}

interface Form16PdfInput {
  financialYear: string;
  figures: Form16Figures;
  employee: any;
  company: any;
  password?: string | null;
}

/** Render the certificate. Encrypted when a password is supplied. */
export function generateForm16Pdf(input: Form16PdfInput): Promise<Buffer> {
  const { figures, employee, company, financialYear, password } = input;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 44,
        ...(password
          ? { userPassword: password, ownerPassword: `${password}-OWNER`, permissions: { printing: 'highResolution' } }
          : {}),
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const assessmentYear = `${fyStartYear(financialYear) + 1}-${String((fyStartYear(financialYear) + 2) % 100).padStart(2, '0')}`;

      // ── Header ──────────────────────────────────────────────────────────────
      doc.fontSize(15).fillColor('#1f3a93').text('FORM NO. 16', { align: 'center' });
      doc.fontSize(8).fillColor('#444')
         .text('[See rule 31(1)(a)]', { align: 'center' })
         .text('Certificate under section 203 of the Income-tax Act, 1961 for tax deducted at source on salary',
               { align: 'center' });
      doc.moveDown(0.8);

      const line = () => {
        doc.moveTo(doc.page.margins.left, doc.y)
           .lineTo(doc.page.width - doc.page.margins.right, doc.y)
           .strokeColor('#8fa4c8').lineWidth(0.8).stroke();
        doc.moveDown(0.5);
      };
      line();

      // ── Two-column identity block ───────────────────────────────────────────
      const leftX = doc.page.margins.left;
      const rightX = doc.page.width / 2 + 8;
      const top = doc.y;

      doc.fontSize(9).fillColor('#000');
      doc.font('Helvetica-Bold').text('Employer', leftX, top, { width: 230 });
      doc.font('Helvetica')
         .text(company?.legalName || company?.name || '—', { width: 230 })
         .text([company?.addressLine1, company?.city, company?.state, company?.pincode]
                 .filter(Boolean).join(', ') || '—', { width: 230 })
         .text(`PAN: ${company?.pan || '—'}`, { width: 230 })
         .text(`TAN: ${company?.tan || '—'}`, { width: 230 });

      const afterLeft = doc.y;

      doc.font('Helvetica-Bold').text('Employee', rightX, top, { width: 230 });
      doc.font('Helvetica')
         .text(`${employee?.firstName || ''} ${employee?.lastName || ''}`.trim() || '—', { width: 230 })
         .text(`Employee Code: ${employee?.employeeCode || '—'}`, { width: 230 })
         .text(`PAN: ${employee?.panNumber || '—'}`, { width: 230 })
         .text(`Designation: ${employee?.designation?.name || '—'}`, { width: 230 });

      doc.y = Math.max(afterLeft, doc.y);
      doc.moveDown(0.4);
      doc.font('Helvetica')
         .text(`Financial Year: ${financialYear}     Assessment Year: ${assessmentYear}     Tax Regime: ${figures.regime}`,
               leftX, doc.y, { width: 500 });
      doc.moveDown(0.4);
      line();

      // ── Part B — computation ────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1f3a93')
         .text('PART B — DETAILS OF SALARY PAID AND TAX COMPUTATION', leftX);
      doc.moveDown(0.4);

      const row = (label: string, value: number, opts: { bold?: boolean; indent?: number } = {}) => {
        const y = doc.y;
        doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#000');
        doc.text(label, leftX + (opts.indent || 0), y, { width: 360 });
        doc.text(fmtINR(value), leftX + 370, y, { width: 140, align: 'right' });
        doc.moveDown(0.25);
      };

      row('1. Gross salary paid', figures.grossSalary, { bold: true });
      row('2. Less: Allowances exempt under section 10 (HRA)', figures.exemptAllowance, { indent: 10 });
      row('3. Less: Standard deduction under section 16(ia)', figures.standardDeduct, { indent: 10 });
      row('4. Less: Deductions under Chapter VI-A', figures.chapterViaTotal, { indent: 10 });
      doc.moveDown(0.2);
      row('5. Total taxable income', figures.taxableIncome, { bold: true });
      doc.moveDown(0.2);
      row('6. Tax on total income', figures.taxOnIncome);
      row('7. Less: Rebate under section 87A', figures.rebate87A, { indent: 10 });
      row('8. Add: Surcharge', figures.surcharge, { indent: 10 });
      row('9. Add: Health and education cess', figures.educationCess, { indent: 10 });
      doc.moveDown(0.2);
      row('10. Total tax payable', figures.totalTaxPayable, { bold: true });
      row('11. Less: Tax deducted at source', figures.tdsDeducted);
      row(figures.balanceTax >= 0 ? '12. Balance tax payable' : '12. Refund due',
          Math.abs(figures.balanceTax), { bold: true });

      doc.moveDown(0.5);
      line();

      // ── Monthly TDS table ───────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1f3a93')
         .text('MONTHLY SALARY AND TAX DEDUCTED', leftX);
      doc.moveDown(0.4);

      const cols = [
        { label: 'Month', x: leftX, w: 110, align: 'left' as const },
        { label: 'Gross Salary', x: leftX + 110, w: 110, align: 'right' as const },
        { label: 'PF', x: leftX + 225, w: 80, align: 'right' as const },
        { label: 'Prof. Tax', x: leftX + 310, w: 80, align: 'right' as const },
        { label: 'TDS', x: leftX + 395, w: 105, align: 'right' as const },
      ];

      const headerY = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000');
      for (const c of cols) doc.text(c.label, c.x, headerY, { width: c.w, align: c.align });
      doc.moveDown(0.3);
      line();

      const monthName = (m: number, y: number) =>
        `${new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short' })} ${y}`;

      doc.font('Helvetica').fontSize(8.5);
      for (const r of figures.monthlyRows) {
        if (doc.y > doc.page.height - 110) {
          doc.addPage();
          doc.font('Helvetica').fontSize(8.5);
        }
        const y = doc.y;
        doc.text(monthName(r.month, r.year), cols[0].x, y, { width: cols[0].w });
        doc.text(fmtINR(r.gross), cols[1].x, y, { width: cols[1].w, align: 'right' });
        doc.text(fmtINR(r.pf), cols[2].x, y, { width: cols[2].w, align: 'right' });
        doc.text(fmtINR(r.pt), cols[3].x, y, { width: cols[3].w, align: 'right' });
        doc.text(fmtINR(r.tds), cols[4].x, y, { width: cols[4].w, align: 'right' });
        doc.moveDown(0.25);
      }

      doc.moveDown(0.3);
      line();
      const totalY = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5);
      doc.text('Total', cols[0].x, totalY, { width: cols[0].w });
      doc.text(fmtINR(figures.grossSalary), cols[1].x, totalY, { width: cols[1].w, align: 'right' });
      doc.text('', cols[2].x, totalY, { width: cols[2].w });
      doc.text('', cols[3].x, totalY, { width: cols[3].w });
      doc.text(fmtINR(figures.tdsDeducted), cols[4].x, totalY, { width: cols[4].w, align: 'right' });

      // ── Verification ────────────────────────────────────────────────────────
      doc.moveDown(2);
      doc.font('Helvetica').fontSize(8.5).fillColor('#000').text(
        `I, ${company?.signatoryName || '________________'}, ${company?.signatoryDesignation || ''}, ` +
        `do hereby certify that the information given above is true, complete and correct and is based on the ` +
        `books of account, documents and other available records.`,
        leftX, doc.y, { width: 500, align: 'justify' },
      );

      doc.moveDown(2);
      doc.text(`Place: ${company?.signatoryPlace || company?.city || '—'}`, leftX);
      doc.text(`Date: ${fmtDate(new Date())}`, leftX);
      doc.moveDown(1.6);
      doc.font('Helvetica-Bold')
         .text(company?.signatoryName || '—', leftX)
         .font('Helvetica')
         .text(company?.signatoryDesignation || 'Authorised Signatory', leftX);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Load employee + company context, compute, render. Shared by both endpoints. */
type CertificateFailure = { error: string };
type CertificateSuccess = {
  employee: any;
  company: any;
  companyId: number;
  figures: Form16Figures;
  password: string | null;
  pdf: Buffer;
};

async function buildCertificate(
  employeeId: number,
  financialYear: string,
): Promise<CertificateSuccess | CertificateFailure> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true, firstName: true, lastName: true, employeeCode: true, email: true,
      panNumber: true, dob: true, companyId: true,
      designation: { select: { name: true } },
    } as any,
  });
  if (!employee) return { error: 'Employee not found' };

  const figures = await computeForm16(employeeId, financialYear);
  if (!figures) {
    return { error: `No published payslips found for ${financialYear}` };
  }

  const companyId = (employee as any).companyId ?? (await resolveCompanyId(employeeId));
  const company = await (prisma as any).company.findUnique({ where: { id: companyId } });

  const password = form16Password((employee as any).panNumber, (employee as any).dob);
  const pdf = await generateForm16Pdf({ financialYear, figures, employee, company, password });

  return { employee, company, companyId, figures, password, pdf };
}

/** Persist the computed figures so the certificate is auditable/reissuable. */
async function recordForm16(
  employeeId: number, companyId: number, financialYear: string,
  figures: Form16Figures, generatedBy: number | null, emailed: boolean,
) {
  const data = {
    regime: figures.regime,
    grossSalary: figures.grossSalary,
    exemptAllowance: figures.exemptAllowance,
    standardDeduct: figures.standardDeduct,
    chapterViaTotal: figures.chapterViaTotal,
    taxableIncome: figures.taxableIncome,
    taxOnIncome: figures.taxOnIncome,
    rebate87A: figures.rebate87A,
    surcharge: figures.surcharge,
    educationCess: figures.educationCess,
    totalTaxPayable: figures.totalTaxPayable,
    tdsDeducted: figures.tdsDeducted,
    balanceTax: figures.balanceTax,
    passwordHint: 'PAN (uppercase) followed by date of birth as DDMMYYYY',
    generatedBy,
    generatedAt: new Date(),
    ...(emailed ? { emailedAt: new Date() } : {}),
  };

  return (prisma as any).form16Record.upsert({
    where: { employeeId_financialYear: { employeeId, financialYear } },
    create: { employeeId, companyId, financialYear, ...data },
    update: data,
  });
}

/** GET — stream the certificate to the browser. */
export const downloadForm16 = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const explicit = Number(req.params.employeeId ?? req.query.employeeId);
    const employeeId = Number.isInteger(explicit) && explicit > 0
      ? explicit
      : currentEmployeeId(req);
    const financialYear = String(req.query.financialYear || '').trim();

    if (!employeeId) return res.status(400).json({ message: 'employeeId required' });
    if (!/^\d{4}-\d{2}$/.test(financialYear)) {
      return res.status(400).json({ message: 'financialYear required, e.g. 2026-27' });
    }

    const built = await buildCertificate(employeeId, financialYear);
    if ('error' in built) return res.status(404).json({ message: built.error });

    await recordForm16(
      employeeId, built.companyId, financialYear, built.figures,
      currentEmployeeId(req), false,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Form16_${(built.employee as any).employeeCode}_${financialYear}.pdf"`,
    );
    res.send(built.pdf);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * POST — generate and email certificates in bulk.
 * Failures are collected per employee rather than aborting the batch; one
 * missing PAN must not stop the other 249 certificates going out.
 */
export const emailForm16Batch = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const financialYear = String(req.body.financialYear || '').trim();
    if (!/^\d{4}-\d{2}$/.test(financialYear)) {
      return res.status(400).json({ message: 'financialYear required, e.g. 2026-27' });
    }

    const requested: number[] = Array.isArray(req.body.employeeIds)
      ? req.body.employeeIds.map(Number).filter(Boolean)
      : [];

    let employeeIds = requested;
    if (!employeeIds.length) {
      const rows = await prisma.employee.findMany({
        where: { employmentStatus: 'ACTIVE' },
        select: { id: true },
      });
      employeeIds = rows.map((r) => r.id);
    }

    const generatedBy = currentEmployeeId(req);
    const sent: number[] = [];
    const failed: Array<{ employeeId: number; reason: string }> = [];

    for (const employeeId of employeeIds) {
      try {
        const built = await buildCertificate(employeeId, financialYear);
        if ('error' in built) {
          failed.push({ employeeId, reason: built.error });
          continue;
        }
        const email = (built.employee as any).email;
        if (!email) {
          failed.push({ employeeId, reason: 'No email address on record' });
          continue;
        }

        await sendMail({
          to: email,
          subject: `Form 16 for financial year ${financialYear}`,
          html:
            `<p>Dear ${(built.employee as any).firstName},</p>` +
            `<p>Your Form 16 for the financial year <strong>${financialYear}</strong> is attached.</p>` +
            `<p>The PDF is password protected. The password is your <strong>PAN in uppercase</strong> ` +
            `followed by your <strong>date of birth as DDMMYYYY</strong> — for example, ABCDE1234F01011990.</p>` +
            `<p>Regards,<br>${built.company?.name || 'HR Team'}</p>`,
        });

        await recordForm16(
          employeeId, built.companyId, financialYear, built.figures, generatedBy, true,
        );
        sent.push(employeeId);
      } catch (err: any) {
        failed.push({ employeeId, reason: err?.message || 'Unknown error' });
      }
    }

    res.json({ financialYear, requested: employeeIds.length, sent: sent.length, failed });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** List generated certificates for an FY (HR view). */
export const listForm16 = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const financialYear = String(req.query.financialYear || '').trim();
    const where = /^\d{4}-\d{2}$/.test(financialYear) ? { financialYear } : {};

    const rows = await (prisma as any).form16Record.findMany({
      where,
      orderBy: { generatedAt: 'desc' },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
