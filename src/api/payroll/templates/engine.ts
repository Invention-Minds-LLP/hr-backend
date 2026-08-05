import ExcelJS from 'exceljs';
import { StatutoryRates, LEGACY_DEFAULT_RATES } from '../calc/statutory';

export { StatutoryRates };

// ─── Payroll sheet engine ─────────────────────────────────────────────────────
// One generic renderer + N thin template descriptors. Each org's salary sheet
// (MEDFIN working sheet, AKSHA register, …) is a `SheetTemplate` describing its
// columns, formulas and layout; `renderWorkbook` turns any of them into a styled
// .xlsx. Adding a new format = adding a descriptor, not new rendering code.

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
// 1-based column index → Excel letter (A, B, … Z, AA, AB, …)
export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const CURRENCY_FMT = '#,##0.00';

export type SheetMode = 'template' | 'snapshot';
// value  : always rendered from value() (identity / structure / bank text)
// calc   : Excel formula in template mode, computed number in snapshot mode
// inputHr / inputFin : HR / Finance input cell (blue / yellow); blank in template
//          mode unless prefill=true; rendered from value() in snapshot mode
export type ColRole = 'value' | 'calc' | 'inputHr' | 'inputFin';
export type ColKind = 'text' | 'date' | 'int' | 'money';

export interface RowCtx {
  emp: any;
  sal: any;
  ps: any;
  calendarDays: number;
  index: number; // 0-based row index within the run
  computed: Record<string, number>;
  // Statutory rates in force for the run's company and month. Templates used to
  // hardcode 12% PF and the PT slabs, which meant editing the statutory config
  // had no effect whatsoever on an exported sheet. Every rate a template needs
  // now arrives here.
  rates: StatutoryRates;
}

export interface ColDef {
  key: string;
  header: string;
  role: ColRole;
  kind: ColKind;
  width: number;
  group?: string;
  numFmt?: string;
  sum?: boolean;
  prefill?: boolean; // input cell pre-filled even in template mode (e.g. LOP, TDS)
  value?: (ctx: RowCtx) => any;
  // `rates` is passed so a formula can embed the live percentages and slabs
  // rather than literals — an Excel formula reading 0.12 is a lie the moment PF
  // changes.
  formula?: (r: number, L: Record<string, string>, rates: StatutoryRates) => string;
}

export interface SheetTemplate {
  id: string;
  label: string;
  sheetName: string;
  modes: SheetMode[];
  freezeCols: number;
  showGroupRow: boolean;
  columns: ColDef[];
  compute: (ctx: RowCtx) => Record<string, number>;
  // Draw the banner/meta rows above the header; return the 1-based row index
  // where the (group) header row should start.
  drawBanner: (ws: ExcelJS.Worksheet, ctx: BannerCtx) => number;
  groupFill?: Record<string, string>;
  roleFill?: Partial<Record<ColRole, string>>;
  totalLabel: (n: number) => string;
  totalSpan: number; // how many leading columns the TOTAL label merges across
}

export interface BannerCtx {
  org: string;
  monthLabel: string;
  run: any;
  lastLetter: string;
  calendarDays: number;
  rates: StatutoryRates;
}

const thin = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function numFmtFor(c: ColDef): string | undefined {
  if (c.numFmt) return c.numFmt;
  if (c.kind === 'money') return CURRENCY_FMT;
  if (c.kind === 'int') return '0.##';
  return undefined;
}

export function renderWorkbook(
  run: any,
  mode: SheetMode,
  tpl: SheetTemplate,
  org: string,
  rates: StatutoryRates = LEGACY_DEFAULT_RATES,
): ExcelJS.Workbook {
  const calendarDays = daysInMonth(run.year, run.month);
  const monthLabel = `${MONTHS[run.month]}-${run.year}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'HRMINDS';
  const ws = wb.addWorksheet(tpl.sheetName);

  const cols = tpl.columns;
  const lastLetter = colLetter(cols.length);
  const L: Record<string, string> = {};
  cols.forEach((c, i) => { L[c.key] = colLetter(i + 1); });

  // 1. banner / meta rows (template-specific)
  const headerStart = tpl.drawBanner(ws, { org, monthLabel, run, lastLetter, calendarDays, rates });

  // 2. optional group-header band
  let colHeaderRow = headerStart;
  if (tpl.showGroupRow) {
    const groupRow = headerStart;
    colHeaderRow = headerStart + 1;
    let start = 1;
    for (let i = 1; i <= cols.length; i++) {
      const isLast = i === cols.length;
      if (isLast || cols[i].group !== cols[start - 1].group) {
        const g = cols[start - 1].group ?? '';
        ws.mergeCells(`${colLetter(start)}${groupRow}:${colLetter(i)}${groupRow}`);
        const cell = ws.getCell(`${colLetter(start)}${groupRow}`);
        cell.value = g;
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tpl.groupFill?.[g] ?? 'FF1F3864' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        start = i + 1;
      }
    }
    ws.getRow(groupRow).height = 22;
  }

  // 3. column headers
  const hdr = ws.getRow(colHeaderRow);
  cols.forEach((c, idx) => {
    const cell = hdr.getCell(idx + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF44546A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = BORDER;
    ws.getColumn(idx + 1).width = c.width;
  });
  hdr.height = 32;

  ws.views = [{ state: 'frozen', xSplit: tpl.freezeCols, ySplit: colHeaderRow }];

  // 4. data rows
  const firstDataRow = colHeaderRow + 1;
  run.payslips.forEach((ps: any, rowIdx: number) => {
    const emp = ps.employee;
    const sal = emp?.salaryStructure ?? {
      basic: 0, hra: 0, specialAllowance: 0, medicalAllowance: 0, travelAllowance: 0,
      otherAllowances: 0, lta: 0, mobileInternet: 0, mealFuel: 0,
    };
    const r = firstDataRow + rowIdx;
    const row = ws.getRow(r);
    const ctx: RowCtx = { emp, sal, ps, calendarDays, index: rowIdx, computed: {}, rates };
    ctx.computed = tpl.compute(ctx);

    cols.forEach((c, idx) => {
      const cell = row.getCell(idx + 1);
      if (c.role === 'calc') {
        if (mode === 'template' && c.formula) {
          // Ship the computed value alongside the formula. ExcelJS writes no
          // cached result by default, so any viewer that does not recalculate on
          // open (Google Sheets, LibreOffice preview, Excel in protected view)
          // renders the cell blank — which reads as "the export is broken".
          cell.value = {
            formula: c.formula(r, L, rates),
            result: ctx.computed[c.key] ?? 0,
          } as any;
        } else {
          cell.value = ctx.computed[c.key] ?? 0;
        }
      } else if (c.role === 'inputHr' || c.role === 'inputFin') {
        if (mode === 'snapshot' || c.prefill) cell.value = c.value ? c.value(ctx) : 0;
      } else { // value
        const v = c.value ? c.value(ctx) : '';
        if (c.kind === 'date' && v) cell.value = new Date(v);
        else cell.value = v;
      }
      const nf = numFmtFor(c);
      if (nf) cell.numFmt = c.kind === 'date' ? 'dd-mmm-yyyy' : nf;
      if (c.kind === 'date') cell.numFmt = 'dd-mmm-yyyy';
      if (c.key === 'bankAccountNumber' || c.key === 'idNo') cell.numFmt = '@';

      const fill = tpl.roleFill?.[c.role];
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      cell.border = BORDER;
      if (c.kind !== 'text') cell.alignment = { horizontal: 'center' };
    });
  });

  // 5. GRAND TOTAL row
  const totalRow = firstDataRow + run.payslips.length;
  const tr = ws.getRow(totalRow);
  const span = Math.max(1, tpl.totalSpan);
  ws.mergeCells(`${colLetter(1)}${totalRow}:${colLetter(span)}${totalRow}`);
  const label = ws.getCell(`${colLetter(1)}${totalRow}`);
  label.value = tpl.totalLabel(run.payslips.length);
  label.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  label.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  label.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };

  cols.forEach((c, idx) => {
    if (!c.sum || idx + 1 <= span) return;
    const cell = tr.getCell(idx + 1);
    const letter = colLetter(idx + 1);
    // Total is needed either way: as the value in snapshot mode, and as the
    // cached result behind the SUM() in template mode.
    let total = 0;
    run.payslips.forEach((ps: any, i: number) => {
      const emp = ps.employee;
      const sal = emp?.salaryStructure ?? {
        basic: 0, hra: 0, specialAllowance: 0, medicalAllowance: 0, travelAllowance: 0,
        otherAllowances: 0, lta: 0, mobileInternet: 0, mealFuel: 0,
      };
      total += tpl.compute({ emp, sal, ps, calendarDays, index: i, computed: {}, rates })[c.key] ?? 0;
    });
    total = round2(total);

    if (mode === 'template') {
      cell.value = {
        formula: `SUM(${letter}${firstDataRow}:${letter}${totalRow - 1})`,
        result: total,
      } as any;
    } else {
      cell.value = total;
    }
    const nf = numFmtFor(c);
    if (nf) cell.numFmt = nf;
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    cell.border = BORDER;
    cell.alignment = { horizontal: 'center' };
  });
  tr.height = 20;

  return wb;
}

// Shared banner helper for a simple centred title (+ optional subtitle) banner.
export function simpleBanner(
  ws: ExcelJS.Worksheet, lastLetter: string, title: string, subtitle?: string, navy = 'FF1F3864'
): number {
  ws.mergeCells(`A1:${lastLetter}1`);
  const t = ws.getCell('A1');
  t.value = title;
  t.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
  t.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 26;
  if (subtitle) {
    ws.mergeCells(`A2:${lastLetter}2`);
    const s = ws.getCell('A2');
    s.value = subtitle;
    s.font = { bold: true, size: 11 };
    s.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(2).height = 18;
    return 3;
  }
  return 2;
}
