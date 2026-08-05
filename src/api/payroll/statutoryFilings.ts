// ─────────────────────────────────────────────────────────────────────────────
//  Statutory return / challan file generation.
//
//  Four outputs, all derived from published payslips for a company and month:
//    • PF ECR   — EPFO Electronic Challan cum Return, #~# delimited text
//    • ESI      — ESIC monthly contribution CSV
//    • PT       — professional tax remittance statement (CSV)
//    • LWF      — labour welfare fund statement (CSV)
//
//  ⚠️  Column ORDER for the PF ECR and the ESI upload is fixed by the portal and
//      changes between portal versions. The layouts below follow the widely used
//      current formats, but the finance team MUST validate one file against the
//      live portal before the first real filing. Everything is derived from
//      stored payslip figures, so a layout correction is a change to the mapping
//      functions here only.
// ─────────────────────────────────────────────────────────────────────────────

import { Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { currentEmployeeId } from '../../lib/currentUser';
import { coerceCompanyId } from '../../lib/company';
import { resolveStatutoryRates } from './calc/resolveStatutory';
import { pfWageFor } from './calc/statutory';

const round0 = (n: number) => Math.round(Number.isFinite(n) ? n : 0);
const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

type FilingType = 'PF_ECR' | 'ESI' | 'PT' | 'LWF';

/** Published payslips for a company/month, with the employee fields the
 *  statutory formats need. */
async function loadPayslips(companyId: number, month: number, year: number) {
  return (prisma as any).payslip.findMany({
    where: {
      month, year,
      payrollRun: { status: 'PUBLISHED', companyId },
    },
    include: {
      employee: {
        select: {
          id: true, firstName: true, lastName: true, employeeCode: true,
          uanNumber: true, panNumber: true, aadharNumber: true,
          dateOfJoining: true, gender: true,
        },
      },
    },
    orderBy: { employee: { employeeCode: 'asc' } },
  });
}

interface BuiltFile {
  filename: string;
  contentType: string;
  body: string;
  employeeCount: number;
  totalEmployee: number;
  totalEmployer: number;
  totalAmount: number;
}

/**
 * PF ECR text file. One line per member, fields separated by #~#:
 *   UAN #~# Name #~# Gross #~# EPF wage #~# EPS wage #~# EDLI wage #~#
 *   EE share #~# EPS contribution #~# ER share #~# NCP days #~# refund
 */
async function buildPfEcr(
  companyId: number, month: number, year: number, payslips: any[],
): Promise<BuiltFile> {
  const { rates } = await resolveStatutoryRates(companyId, month, year);
  const lines: string[] = [];

  let totalEmployee = 0;
  let totalEmployer = 0;

  for (const p of payslips) {
    if (!p.pfEmployee && !p.pfEmployer) continue;

    const basic = p.basic || 0;
    const epfWage = round0(pfWageFor(basic, rates));
    const epsWage = round0(Math.min(epfWage, rates.pfWageCeiling));

    const eeShare = round0(p.pfEmployee || 0);
    // pfEmployer on the payslip holds the FULL employer 12%. Split it back into
    // the pension and PF halves the way the ECR expects.
    const employerTotal = round0(p.pfEmployer || 0);
    const epsContribution = round0(epsWage * (rates.epsRate / 100));
    const erShare = Math.max(0, employerTotal - epsContribution);

    totalEmployee += eeShare;
    totalEmployer += employerTotal;

    const name = `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim().toUpperCase();
    const ncpDays = round0(p.lopDays || 0);

    lines.push([
      p.employee?.uanNumber || '',
      name,
      round0(p.grossEarnings || 0),
      epfWage,
      epsWage,
      epfWage, // EDLI wage tracks the EPF wage
      eeShare,
      epsContribution,
      erShare,
      ncpDays,
      0, // refund of advances
    ].join('#~#'));
  }

  return {
    filename: `PF_ECR_${year}_${String(month).padStart(2, '0')}.txt`,
    contentType: 'text/plain; charset=utf-8',
    body: lines.join('\r\n'),
    employeeCount: lines.length,
    totalEmployee,
    totalEmployer,
    totalAmount: totalEmployee + totalEmployer,
  };
}

/** ESI monthly contribution CSV — IP number, name, days, wages, contribution. */
function buildEsi(month: number, year: number, payslips: any[]): BuiltFile {
  const rows: unknown[][] = [[
    'IP Number', 'IP Name', 'No of Days', 'Total Monthly Wages',
    'Employee Contribution', 'Employer Contribution', 'Reason Code', 'Last Working Day',
  ]];

  let totalEmployee = 0;
  let totalEmployer = 0;
  let count = 0;

  for (const p of payslips) {
    if (!p.esiEmployee && !p.esiEmployer) continue;

    const ee = round0(p.esiEmployee || 0);
    const er = round0(p.esiEmployer || 0);
    totalEmployee += ee;
    totalEmployer += er;
    count++;

    rows.push([
      p.employee?.employeeCode || '',
      `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim(),
      round0(p.presentDays || 0),
      round0(p.grossEarnings || 0),
      ee, er, 0, '',
    ]);
  }

  return {
    filename: `ESI_${year}_${String(month).padStart(2, '0')}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: csv(rows),
    employeeCount: count,
    totalEmployee,
    totalEmployer,
    totalAmount: totalEmployee + totalEmployer,
  };
}

/** Professional tax remittance statement. */
function buildPt(month: number, year: number, payslips: any[]): BuiltFile {
  const rows: unknown[][] = [[
    'Employee Code', 'Employee Name', 'PAN', 'Gross Salary', 'Professional Tax',
  ]];

  let total = 0;
  let count = 0;

  for (const p of payslips) {
    if (!p.professionalTax) continue;
    total += round0(p.professionalTax);
    count++;
    rows.push([
      p.employee?.employeeCode || '',
      `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim(),
      p.employee?.panNumber || '',
      round0(p.grossEarnings || 0),
      round0(p.professionalTax),
    ]);
  }

  rows.push([]);
  rows.push(['', '', 'Total', '', total]);

  return {
    filename: `PT_${year}_${String(month).padStart(2, '0')}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: csv(rows),
    employeeCount: count,
    totalEmployee: total,
    totalEmployer: 0,
    totalAmount: total,
  };
}

/** Labour welfare fund statement. */
function buildLwf(month: number, year: number, payslips: any[]): BuiltFile {
  const rows: unknown[][] = [[
    'Employee Code', 'Employee Name', 'Employee Contribution', 'Employer Contribution', 'Total',
  ]];

  let totalEmployee = 0;
  let totalEmployer = 0;
  let count = 0;

  for (const p of payslips) {
    const ee = round0(p.lwfEmployee || 0);
    const er = round0(p.lwfEmployer || 0);
    if (!ee && !er) continue;

    totalEmployee += ee;
    totalEmployer += er;
    count++;
    rows.push([
      p.employee?.employeeCode || '',
      `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim(),
      ee, er, ee + er,
    ]);
  }

  rows.push([]);
  rows.push(['', 'Total', totalEmployee, totalEmployer, totalEmployee + totalEmployer]);

  return {
    filename: `LWF_${year}_${String(month).padStart(2, '0')}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: csv(rows),
    employeeCount: count,
    totalEmployee,
    totalEmployer,
    totalAmount: totalEmployee + totalEmployer,
  };
}

/**
 * GET /api/payroll/statutory/:type
 * Streams the file and records a StatutoryFiling row for the audit trail.
 */
export const downloadStatutoryFile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const type = String(req.params.type || '').toUpperCase() as FilingType;
    if (!['PF_ECR', 'ESI', 'PT', 'LWF'].includes(type)) {
      return res.status(400).json({ message: 'type must be one of PF_ECR, ESI, PT, LWF' });
    }

    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!month || !year) return res.status(400).json({ message: 'month and year required' });

    const companyId = await coerceCompanyId(req.query.companyId);
    const payslips = await loadPayslips(companyId, month, year);

    if (!payslips.length) {
      return res.status(404).json({
        message: `No published payroll found for ${month}/${year}. Publish the run before generating statutory files.`,
      });
    }

    let file: BuiltFile;
    if (type === 'PF_ECR')   file = await buildPfEcr(companyId, month, year, payslips);
    else if (type === 'ESI') file = buildEsi(month, year, payslips);
    else if (type === 'PT')  file = buildPt(month, year, payslips);
    else                     file = buildLwf(month, year, payslips);

    if (!file.employeeCount) {
      return res.status(404).json({
        message: `No ${type} contributions found for ${month}/${year}.`,
      });
    }

    // Audit trail. Never let a logging failure block the download.
    await (prisma as any).statutoryFiling.upsert({
      where: { companyId_type_month_year: { companyId, type, month, year } },
      create: {
        companyId, type, month, year,
        employeeCount: file.employeeCount,
        totalEmployee: file.totalEmployee,
        totalEmployer: file.totalEmployer,
        totalAmount: file.totalAmount,
        generatedBy: currentEmployeeId(req),
      },
      update: {
        employeeCount: file.employeeCount,
        totalEmployee: file.totalEmployee,
        totalEmployer: file.totalEmployer,
        totalAmount: file.totalAmount,
        generatedBy: currentEmployeeId(req),
        generatedAt: new Date(),
      },
    }).catch(() => undefined);

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** Summary of what each statutory file would contain, without downloading. */
export const getStatutorySummary = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!month || !year) return res.status(400).json({ message: 'month and year required' });

    const companyId = await coerceCompanyId(req.query.companyId);
    const payslips = await loadPayslips(companyId, month, year);

    const sum = (fn: (p: any) => number) =>
      round0(payslips.reduce((s: number, p: any) => s + (fn(p) || 0), 0));

    res.json({
      companyId, month, year,
      payslipCount: payslips.length,
      pf: {
        employee: sum((p) => p.pfEmployee),
        employer: sum((p) => p.pfEmployer),
        adminCharges: sum((p) => p.pfAdminCharges),
        edli: sum((p) => p.edliCharges),
      },
      esi: { employee: sum((p) => p.esiEmployee), employer: sum((p) => p.esiEmployer) },
      pt: { total: sum((p) => p.professionalTax) },
      lwf: { employee: sum((p) => p.lwfEmployee), employer: sum((p) => p.lwfEmployer) },
      tds: { total: sum((p) => p.tds) },
      provisions: {
        gratuity: sum((p) => p.gratuityProvision),
        bonus: sum((p) => p.bonusProvision),
        leaveEncashment: sum((p) => p.leaveEncashProvision),
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** Filing history for the audit trail. */
export const listStatutoryFilings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = await coerceCompanyId(req.query.companyId);
    const year = Number(req.query.year);

    const rows = await (prisma as any).statutoryFiling.findMany({
      where: { companyId, ...(year ? { year } : {}) },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** Mark a generated file as actually filed, with the challan reference. */
export const markFilingFiled = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { reference } = req.body;

    const updated = await (prisma as any).statutoryFiling.update({
      where: { id },
      data: { status: 'FILED', filedAt: new Date(), reference: reference || null },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
