import ExcelJS from 'exceljs';
import { ColDef, RowCtx, SheetTemplate, round2, simpleBanner } from './engine';

// ─── Bank transfer advice ─────────────────────────────────────────────────────
// The file handed to the bank to credit salaries. Deliberately narrow: account
// number, IFSC, beneficiary name, amount. Anything else is noise the bank does
// not read, and salary detail should not leave the building on this document.
//
// Snapshot-only: an advice with live formulas is meaningless — the bank needs
// settled numbers, and a template-mode file with blank inputs would transfer 0.

const NAVY = 'FF1F3864';

const COLS: ColDef[] = [
  {
    key: 'srNo', header: 'Sr. No.', role: 'value', kind: 'text', width: 8,
    value: c => c.index + 1,
  },
  {
    key: 'bankAccountNumber', header: 'Beneficiary Account No.', role: 'value', kind: 'text', width: 24,
    value: c => c.emp?.bankDetail?.bankAccountNumber ?? '',
  },
  {
    key: 'ifscCode', header: 'IFSC Code', role: 'value', kind: 'text', width: 16,
    value: c => c.emp?.bankDetail?.ifscCode ?? '',
  },
  {
    key: 'nameOnAccount', header: 'Beneficiary Name', role: 'value', kind: 'text', width: 30,
    // Fall back to the employee's own name when the bank record has no explicit
    // account holder — the two differ often enough to be worth the fallback.
    value: c => c.emp?.bankDetail?.nameOnAccount
      || `${c.emp?.firstName ?? ''} ${c.emp?.lastName ?? ''}`.trim(),
  },
  {
    key: 'empId', header: 'Employee Code', role: 'value', kind: 'text', width: 14,
    value: c => c.emp?.employeeCode ?? '',
  },
  {
    key: 'amount', header: 'Amount (₹)', role: 'value', kind: 'money', width: 16,
    sum: true,
    value: c => round2(
      (c.ps?.netPay ?? 0) + (c.ps?.petrolReimb ?? 0) + (c.ps?.driverReimb ?? 0),
    ),
  },
  {
    key: 'narration', header: 'Narration', role: 'value', kind: 'text', width: 28,
    value: c => `SAL ${c.ps?.month ?? ''}/${c.ps?.year ?? ''} ${c.emp?.employeeCode ?? ''}`.trim(),
  },
];

function compute(ctx: RowCtx): Record<string, number> {
  const amount = round2(
    (ctx.ps?.netPay ?? 0) + (ctx.ps?.petrolReimb ?? 0) + (ctx.ps?.driverReimb ?? 0),
  );
  return { amount };
}

function drawBanner(
  ws: ExcelJS.Worksheet,
  ctx: { org: string; monthLabel: string; lastLetter: string },
): number {
  const headerStart = simpleBanner(
    ws,
    ctx.lastLetter,
    `${ctx.org.toUpperCase()} — SALARY TRANSFER ADVICE`,
    `Payroll Month: ${ctx.monthLabel}`,
    NAVY,
  );

  // Warn on the face of the document: a zero or blank account number here means
  // a failed credit, and it is far cheaper to catch that before submission.
  ws.mergeCells(`A${headerStart}:${ctx.lastLetter}${headerStart}`);
  const note = ws.getCell(`A${headerStart}`);
  note.value =
    '⚠ Verify every account number and IFSC before submitting to the bank. Rows with a blank account number will fail.';
  note.font = { italic: true, size: 9, color: { argb: 'FF7A3128' } };
  note.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEA' } };
  note.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(headerStart).height = 18;

  return headerStart + 1;
}

export const bankAdviceTemplate: SheetTemplate = {
  id: 'bank-advice',
  label: 'Bank Transfer Advice (NEFT upload)',
  sheetName: 'Bank Advice',
  modes: ['snapshot'],
  freezeCols: 1,
  showGroupRow: false,
  columns: COLS,
  compute,
  drawBanner,
  totalSpan: 5,
  totalLabel: (n) => `TOTAL — ${n} beneficiaries`,
  roleFill: {},
};
