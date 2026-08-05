import ExcelJS from 'exceljs';
import { ColDef, RowCtx, SheetTemplate, round2, simpleBanner } from './engine';
import { professionalTaxFor, pfWageFor, PtSlab } from '../calc/statutory';

// ─── AKSHA-style salary register ──────────────────────────────────────────────
// Flat finalized "salary sheet" handed to accounts/audit. Gross-based (no CTC).
// Conventions verified from the reference sheet:
//   • Prorate base = fixed 31 (full attendance = 31 units; payable = 31 − LOP).
//   • PF = min(basic, 15000) × 12%  (flat ₹1,800 ceiling).
//   • ESIC = 0.75% × earned gross, only when ≤ ₹21,000.
//   • Components: Basic&DA / HRA / Conv(=travel) / Mad(=medical) / Edu(=other+special).
//   • Deductions: Hostel / Sundry(=other) / Salary-Adv(=advance) / PF / ESIC / PT.
// Snapshot-only (a finalized record, not an input template).

const DIV = 31; // AKSHA proration divisor — a full month is 31 units



function compute(ctx: RowCtx): Record<string, number> {
  const { sal, ps, rates } = ctx;
  const basic = sal.basic ?? 0;
  const hra = sal.hra ?? 0;
  const conv = sal.travelAllowance ?? 0;
  const mad = sal.medicalAllowance ?? 0;
  const edu = round2((sal.otherAllowances ?? 0) + (sal.specialAllowance ?? 0));
  const basicDa = round2(basic);
  const salary = round2(basicDa + hra + conv + mad + edu); // full gross

  const lopDays = ps?.lopDays ?? 0;
  const leave = ps?.leaveDays ?? 0;
  const presentTotal = Math.max(0, DIV - lopDays); // 31-based payable days
  const present = round2(Math.max(0, presentTotal - leave));
  const salEarns = round2(salary * presentTotal / DIV);

  const otHours = ps?.overtimeHours ?? 0;
  const otAmount = round2(ps?.overtimePay ?? 0);
  const are = ps?.salaryRevisionArrear ?? 0; // arrears
  const totalEarns = round2(salEarns + otAmount + are);

  const hostelDed = 0; // no field yet — an HR input in a real AKSHA run
  const sDeduction = ps?.otherDeduction ?? 0;
  const salaryAdv = ps?.advanceRecovery ?? 0;
  // Live rates rather than literals — editing the statutory config used to have
  // no effect on this sheet at all.
  const pfOn = sal.pfApplicable && rates.pfEnabled;
  const pf = pfOn ? round2(pfWageFor(basic, rates) * (rates.pfEmployeeRate / 100)) : 0;
  const esiOn = sal.esiApplicable && rates.esiEnabled && salEarns <= rates.esiWageLimit;
  const esic = esiOn ? round2(salEarns * (rates.esiEmployeeRate / 100)) : 0;
  const pt = sal.ptApplicable && rates.ptEnabled
    ? professionalTaxFor(salEarns, rates.ptSlabs as PtSlab[] | null, ps?.month ?? 6)
    : 0;
  const tDeduction = round2(hostelDed + sDeduction + salaryAdv + pf + esic + pt);
  const netPay = round2(totalEarns - tDeduction);

  return {
    present, leave, presentTotal, salary, basicDa, hra, conv, mad, edu, total: salary,
    salEarns, otHours, otAmount, are, totalEarns,
    hostelDed, sDeduction, salaryAdv, pf, esic, pt, tDeduction, netPay,
  };
}

const M = (key: string, header: string, width = 11): ColDef =>
  ({ key, header, role: 'calc', kind: 'money', width, sum: true });
const I = (key: string, header: string, width = 8): ColDef =>
  ({ key, header, role: 'calc', kind: 'int', width, sum: true });

const COLS: ColDef[] = [
  { key: 'slNo', header: 'SL NO', role: 'value', kind: 'int', width: 6, value: c => c.index + 1 },
  { key: 'idNo', header: 'ID NO', role: 'value', kind: 'text', width: 10, value: c => c.emp.employeeCode },
  { key: 'name', header: 'NAME', role: 'value', kind: 'text', width: 24, value: c => `${c.emp.firstName} ${c.emp.lastName}`.trim() },
  { key: 'department', header: 'DEPARTMENT', role: 'value', kind: 'text', width: 18, value: c => c.emp.Department?.name ?? '' },
  { key: 'designation', header: 'DESIGNATION', role: 'value', kind: 'text', width: 22, value: c => c.emp.designation?.name ?? '' },

  I('present', 'PRESENT'), I('leave', 'LEAVE'), I('presentTotal', 'PRESENT TOTAL', 9),

  M('salary', 'SALARY', 11), M('basicDa', 'BASIC & DA', 11), M('hra', 'HRA', 10),
  M('conv', 'CONV', 9), M('mad', 'MAD', 9), M('edu', 'EDU', 9),
  M('total', 'TOTAL', 11), M('salEarns', 'SAL EARNS', 11),
  I('otHours', 'OT HOURS', 8), M('otAmount', 'OT AMOUNT', 10), M('are', 'ARE', 9),
  M('totalEarns', 'TOTAL EARNS', 11),

  M('hostelDed', 'HOSTEL DED', 10), M('sDeduction', 'S DEDUCTION', 10), M('salaryAdv', 'SALARY ADV', 10),
  M('pf', 'PF', 9), M('esic', 'ESIC', 9), M('pt', 'PT', 8),
  M('tDeduction', 'T DEDUCTION', 11), M('netPay', 'NET PAY', 12),
];

export const akshaTemplate: SheetTemplate = {
  id: 'aksha-salary-register',
  label: 'Salary Register (flat, gross-based, 31-day)',
  sheetName: 'Salary Sheet',
  modes: ['snapshot'],
  freezeCols: 3,
  showGroupRow: false,
  columns: COLS,
  compute,
  totalSpan: 5,
  totalLabel: () => 'TOTAL',
  drawBanner: (ws, { org, monthLabel, lastLetter }) =>
    simpleBanner(ws, lastLetter, org.toUpperCase(), `SALARY SHEET FOR THE MONTH OF ${monthLabel}`),
};
