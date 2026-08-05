// ─────────────────────────────────────────────────────────────────────────────
//  Working-sheet import — the missing half of payroll.workingsheet.ts.
//
//  HR exports the sheet, Finance fills the BLUE/YELLOW input cells, and this
//  reads those columns back onto the draft payslips. Only columns whose ColDef
//  role is `inputHr` or `inputFin` are importable — `calc` and `value` columns
//  are derived or identity data, and letting a spreadsheet overwrite them would
//  make the payslip unexplainable.
//
//  Two-step by design: `previewImport` parses and reports, `applyImport` writes.
//  A payroll file is not something to apply blind — the preview shows exactly
//  which employees change and by how much before anything is committed.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { getTemplate } from './templates';
import { ColDef } from './templates/engine';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Payslip columns an import is allowed to touch, mapped from sheet column key. */
const IMPORTABLE_FIELDS: Record<string, string> = {
  lopDays: 'lopDays',
  tds: 'tds',
  advanceRecovery: 'advanceRecovery',
  otherDeduction: 'otherDeduction',
  variableIncentive: 'variableIncentive',
  salaryRevisionArrear: 'salaryRevisionArrear',
  otherAddition: 'otherAddition',
  petrolReimb: 'petrolReimb',
  driverReimb: 'driverReimb',
  remarks: 'remarks',
};

export interface ImportRowChange {
  employeeCode: string;
  employeeId: number | null;
  payslipId: number | null;
  changes: Record<string, { from: any; to: any }>;
  errors: string[];
}

export interface ImportReport {
  runId: number;
  templateId: string;
  sheetName: string;
  totalRows: number;
  matchedRows: number;
  changedRows: number;
  unmatchedCodes: string[];
  rows: ImportRowChange[];
  columnsRead: string[];
  ignoredColumns: string[];
}

/** Excel cells can be numbers, strings, formula results or rich text. */
function cellNumber(cell: ExcelJS.Cell | undefined): number | null {
  if (!cell) return null;
  const v: any = cell.value;
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'result' in v) {
    const r = (v as any).result;
    return typeof r === 'number' ? r : null;
  }
  const parsed = Number(String(v).replace(/[₹,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return '';
  const v: any = cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('result' in v) return String((v as any).result ?? '');
    if ('richText' in v) return (v as any).richText.map((t: any) => t.text).join('');
    if ('text' in v) return String((v as any).text ?? '');
  }
  return String(v).trim();
}

/**
 * Locate the header row by finding the row containing the template's Emp ID
 * header. The banner height varies per template, so searching beats assuming.
 */
function findHeaderRow(ws: ExcelJS.Worksheet, columns: ColDef[]): number | null {
  const idHeader = columns[0]?.header?.toLowerCase();
  if (!idHeader) return null;

  const limit = Math.min(ws.rowCount, 20);
  for (let r = 1; r <= limit; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= Math.min(row.cellCount, 60); c++) {
      if (cellText(row.getCell(c)).toLowerCase() === idHeader) return r;
    }
  }
  return null;
}

/** Map each template column key to the 1-based sheet column it was found in. */
function mapColumns(
  ws: ExcelJS.Worksheet, headerRow: number, columns: ColDef[],
): Record<string, number> {
  const header = ws.getRow(headerRow);
  const byHeaderText = new Map<string, number>();
  for (let c = 1; c <= Math.min(header.cellCount, 80); c++) {
    const text = cellText(header.getCell(c)).toLowerCase().trim();
    if (text && !byHeaderText.has(text)) byHeaderText.set(text, c);
  }

  const map: Record<string, number> = {};
  for (const col of columns) {
    const found = byHeaderText.get(col.header.toLowerCase().trim());
    if (found) map[col.key] = found;
  }
  return map;
}

async function parseWorkbook(
  buffer: Buffer, runId: number, templateId?: string,
): Promise<ImportReport | { error: string }> {
  const tpl = getTemplate(templateId);

  const run = await (prisma as any).payrollRun.findUnique({
    where: { id: runId },
    include: {
      payslips: {
        include: { employee: { select: { id: true, employeeCode: true } } },
      },
    },
  });
  if (!run) return { error: 'Payroll run not found' };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const ws = wb.getWorksheet(tpl.sheetName) || wb.worksheets[0];
  if (!ws) return { error: 'The uploaded file has no readable worksheet' };

  const headerRow = findHeaderRow(ws, tpl.columns);
  if (!headerRow) {
    return {
      error:
        `Could not find the header row. Expected a cell reading "${tpl.columns[0]?.header}". ` +
        `Make sure you are uploading the ${tpl.label} sheet unmodified.`,
    };
  }

  const colMap = mapColumns(ws, headerRow, tpl.columns);
  if (colMap['empId'] == null) {
    return { error: 'The sheet has no Emp ID column, so rows cannot be matched to employees' };
  }

  // Only input-role columns present in BOTH the template and the sheet.
  const importable = tpl.columns.filter(
    (c) => (c.role === 'inputHr' || c.role === 'inputFin')
      && IMPORTABLE_FIELDS[c.key]
      && colMap[c.key] != null,
  );
  const ignored = tpl.columns
    .filter((c) => (c.role === 'inputHr' || c.role === 'inputFin') && !IMPORTABLE_FIELDS[c.key])
    .map((c) => c.header);

  const bySlipCode = new Map<string, any>();
  for (const slip of run.payslips) {
    const code = slip.employee?.employeeCode;
    if (code) bySlipCode.set(String(code).trim().toLowerCase(), slip);
  }

  const rows: ImportRowChange[] = [];
  const unmatchedCodes: string[] = [];
  let totalRows = 0;
  let matchedRows = 0;
  let changedRows = 0;

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = cellText(row.getCell(colMap['empId'])).trim();
    // The GRAND TOTAL row has no employee code — that is the natural terminator.
    if (!code) continue;

    totalRows++;
    const slip = bySlipCode.get(code.toLowerCase());
    if (!slip) {
      unmatchedCodes.push(code);
      rows.push({
        employeeCode: code, employeeId: null, payslipId: null, changes: {},
        errors: ['No payslip for this employee in this payroll run'],
      });
      continue;
    }

    matchedRows++;
    const changes: Record<string, { from: any; to: any }> = {};
    const errors: string[] = [];

    for (const col of importable) {
      const field = IMPORTABLE_FIELDS[col.key];
      const cell = row.getCell(colMap[col.key]);

      if (col.kind === 'text') {
        const next = cellText(cell);
        const prev = slip[field] ?? '';
        if (next !== prev) changes[field] = { from: prev, to: next };
        continue;
      }

      const next = cellNumber(cell);
      if (next == null) continue; // blank cell = "leave as is", not "set to zero"

      if (next < 0) {
        errors.push(`${col.header} is negative (${next})`);
        continue;
      }
      if (field === 'lopDays' && next > (slip.workingDays || 31)) {
        errors.push(`LOP days (${next}) exceed working days (${slip.workingDays})`);
        continue;
      }

      const prev = round2(slip[field] ?? 0);
      const rounded = round2(next);
      if (rounded !== prev) changes[field] = { from: prev, to: rounded };
    }

    if (Object.keys(changes).length) changedRows++;
    rows.push({
      employeeCode: code, employeeId: slip.employeeId, payslipId: slip.id, changes, errors,
    });
  }

  return {
    runId,
    templateId: tpl.id,
    sheetName: ws.name,
    totalRows,
    matchedRows,
    changedRows,
    unmatchedCodes,
    rows,
    columnsRead: importable.map((c) => c.header),
    ignoredColumns: ignored,
  };
}

/** Multer/formidable put the file on req; support both shapes. */
function fileBufferFrom(req: Request): Buffer | null {
  const anyReq = req as any;
  if (anyReq.file?.buffer) return anyReq.file.buffer;
  if (Array.isArray(anyReq.files) && anyReq.files[0]?.buffer) return anyReq.files[0].buffer;
  if (anyReq.files?.file?.[0]?.buffer) return anyReq.files.file[0].buffer;
  return null;
}

/** POST /api/payroll/runs/:id/import/preview — parse and report, write nothing. */
export const previewImport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const buffer = fileBufferFrom(req);
    if (!buffer) return res.status(400).json({ message: 'No file uploaded' });

    const report = await parseWorkbook(buffer, runId, req.query.template as string | undefined);
    if ('error' in report) return res.status(400).json({ message: report.error });

    res.json(report);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/payroll/runs/:id/import — parse and commit.
 * Recomputes totalDeductions and netPay from the imported values so the payslip
 * stays internally consistent; without that the sheet and the DB would disagree.
 */
export const applyImport = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const runId = Number(req.params.id);
    const buffer = fileBufferFrom(req);
    if (!buffer) return res.status(400).json({ message: 'No file uploaded' });

    const run = await (prisma as any).payrollRun.findUnique({ where: { id: runId } });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });
    if (run.status === 'PUBLISHED') {
      return res.status(409).json({
        message: 'This run is published. Importing would change figures already issued to employees.',
      });
    }
    if (run.lockedAt) {
      return res.status(409).json({ message: 'This payroll month is locked' });
    }

    const report = await parseWorkbook(buffer, runId, req.query.template as string | undefined);
    if ('error' in report) return res.status(400).json({ message: report.error });

    const blocking = report.rows.filter((r) => r.errors.length && r.payslipId);
    if (blocking.length && String(req.query.force || '') !== 'true') {
      return res.status(422).json({
        message: `${blocking.length} row(s) have validation errors. Fix the sheet, or retry with force=true to import only the clean rows.`,
        rows: blocking,
      });
    }

    let updated = 0;
    for (const row of report.rows) {
      if (!row.payslipId || row.errors.length || !Object.keys(row.changes).length) continue;

      const slip = await (prisma as any).payslip.findUnique({ where: { id: row.payslipId } });
      if (!slip) continue;

      const next: Record<string, any> = {};
      for (const [field, change] of Object.entries(row.changes)) next[field] = change.to;

      // Rebuild the dependent totals from the merged values.
      const merged = { ...slip, ...next };
      const totalDeductions = round2(
        (merged.pfEmployee || 0) + (merged.esiEmployee || 0) + (merged.professionalTax || 0) +
        (merged.lwfEmployee || 0) + (merged.tds || 0) +
        (merged.advanceRecovery || 0) + (merged.otherDeduction || 0),
      );
      const netPay = round2(
        (merged.grossEarnings || 0) + (merged.overtimePay || 0) +
        (merged.variableIncentive || 0) + (merged.salaryRevisionArrear || 0) +
        (merged.otherAddition || 0) + (merged.petrolReimb || 0) + (merged.driverReimb || 0) -
        totalDeductions,
      );

      await (prisma as any).payslip.update({
        where: { id: row.payslipId },
        data: { ...next, totalDeductions, netPay },
      });
      updated++;
    }

    res.json({
      message: `Imported ${updated} payslip(s)`,
      updated,
      skipped: report.rows.length - updated,
      unmatchedCodes: report.unmatchedCodes,
      report,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
