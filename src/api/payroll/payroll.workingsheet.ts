import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { renderWorkbook, MONTHS, SheetMode } from './templates/engine';
import { getTemplate, listTemplates } from './templates';
import { resolveStatutoryRates } from './calc/resolveStatutory';
import { coerceCompanyId } from '../../lib/company';

// ─── Payroll sheet export ─────────────────────────────────────────────────────
// Renders a payroll run as a styled .xlsx in one of several org-specific formats
// (see api/payroll/templates). Template chosen via ?template=<id>; mode via
// ?mode=template|snapshot (a template may restrict which modes it supports).
//
// Organisation name = the tenant's configured brand (same source as offer
// letters / emails), never a hard-coded client name.
const ORG_NAME = config.branding.companyName || 'HRMINDS';

async function fetchRun(runId: number) {
  return (prisma as any).payrollRun.findUnique({
    where: { id: runId },
    include: {
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

export const listSheetTemplates = (_req: Request, res: Response) => {
  res.json(listTemplates());
};

export const exportWorkingSheet = async (req: Request, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const tpl = getTemplate(req.query.template as string | undefined);

    // Resolve mode against what the chosen template supports.
    const requested = (req.query.mode as string) === 'snapshot' ? 'snapshot' : 'template';
    const mode: SheetMode = tpl.modes.includes(requested) ? requested : tpl.modes[0];

    const run = await fetchRun(runId);
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });

    // Statutory rates in force for THIS run's company and month. Without this
    // the sheet silently used hardcoded 12% PF and fixed PT slabs, so editing
    // the statutory config had no effect on any export.
    const companyId = run.companyId ?? (await coerceCompanyId(undefined));
    const { rates } = await resolveStatutoryRates(companyId, run.month, run.year);

    const wb = renderWorkbook(run, mode, tpl, ORG_NAME, rates);
    const buf = await wb.xlsx.writeBuffer();
    const fname = `Payroll_${tpl.id}_${MONTHS[run.month]}-${run.year}${mode === 'snapshot' ? '_FINAL' : ''}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(Buffer.from(buf));
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
