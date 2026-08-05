import ExcelJS from 'exceljs';
import { ColDef, RowCtx, SheetTemplate, round2, colLetter, CURRENCY_FMT, StatutoryRates } from './engine';
import { professionalTaxFor, pfWageFor, PtSlab } from '../calc/statutory';

// ─── MEDFIN / Ekana working sheet ─────────────────────────────────────────────
// Colour-coded working sheet: BLUE = HR input, YELLOW = Finance TDS,
// GREY = auto-calc. CTC-based. Prorate base = calendar days. See engine.ts.

const NAVY = 'FF1F3864';
const CAL = '$E$2'; // calendar-days meta cell, referenced by GREY formulas

/** Excel formula for PF at the company's configured rate, applying the wage
 *  ceiling only when the company actually caps at it. */
function pfFormula(basicRef: string, rates: StatutoryRates, side: 'employee' | 'employer'): string {
  const rate = (side === 'employee' ? rates.pfEmployeeRate : rates.pfEmployerRate) / 100;
  const wage = rates.pfCapAtCeiling ? `MIN(${basicRef},${rates.pfWageCeiling})` : basicRef;
  return `ROUND(${rate}*${wage},2)`;
}

/** Build a nested Excel IF() from the company's configured PT slabs, so the
 *  sheet's own formula matches what payroll actually deducted. */
function ptFormula(cellRef: string, rates: StatutoryRates): string {
  const slabs = (Array.isArray(rates.ptSlabs) && rates.ptSlabs.length
    ? rates.ptSlabs
    : [{ upTo: 15000, amount: 0 }, { upTo: 20000, amount: 150 }, { upTo: null, amount: 200 }]) as PtSlab[];

  // Walk backwards so the open-ended top slab is the innermost fallback.
  const ordered = [...slabs].sort((a, b) =>
    (a.upTo ?? Number.MAX_SAFE_INTEGER) - (b.upTo ?? Number.MAX_SAFE_INTEGER));

  let expr = String(ordered[ordered.length - 1]?.amount ?? 0);
  for (let i = ordered.length - 2; i >= 0; i--) {
    const slab = ordered[i];
    if (slab.upTo == null) continue;
    expr = `IF(${cellRef}<${slab.upTo},${slab.amount},${expr})`;
  }
  return expr;
}

const COLS: ColDef[] = [
  { key: 'empId', header: 'Emp ID', group: 'EMPLOYEE IDENTITY', role: 'value', kind: 'text', width: 12, value: c => c.emp.employeeCode },
  { key: 'name', header: 'Employee Name', group: 'EMPLOYEE IDENTITY', role: 'value', kind: 'text', width: 26, value: c => `${c.emp.firstName} ${c.emp.lastName}`.trim() },
  { key: 'doj', header: 'Date of Joining', group: 'EMPLOYEE IDENTITY', role: 'value', kind: 'date', width: 14, value: c => c.emp.dateOfJoining },
  { key: 'dept', header: 'Dept / Cost Centre', group: 'EMPLOYEE IDENTITY', role: 'value', kind: 'text', width: 18, value: c => c.emp.Department?.name ?? '' },

  { key: 'jobTitle', header: 'Job Title', group: 'ORGANISATION', role: 'value', kind: 'text', width: 18, value: c => c.emp.designation?.name ?? '' },
  { key: 'workerType', header: 'Worker Type', group: 'ORGANISATION', role: 'value', kind: 'text', width: 12, value: c => c.emp.employeeType ?? 'Regular' },
  { key: 'lopDays', header: 'LOP Days', group: 'ORGANISATION', role: 'inputHr', kind: 'int', width: 10, prefill: true, value: c => c.ps?.lopDays ?? 0, sum: true },
  { key: 'daysPayable', header: 'Days Payable', group: 'ORGANISATION', role: 'calc', kind: 'int', width: 11, formula: (r, L) => `${CAL}-${L.lopDays}${r}` },

  { key: 'monthlyCtc', header: 'Monthly CTC (₹)', group: 'FULL MONTH SALARY STRUCTURE (₹)', role: 'calc', kind: 'money', width: 14, formula: (r, L) => `${L.fullGross}${r}+${L.fullPfEmployer}${r}+${L.lta}${r}+${L.mobileInternet}${r}+${L.mealFuel}${r}`, sum: true },
  { key: 'fullBasic', header: 'Full Mth Basic (₹)', group: 'FULL MONTH SALARY STRUCTURE (₹)', role: 'value', kind: 'money', width: 14, value: c => c.sal.basic, sum: true },
  { key: 'fullHra', header: 'Full Mth HRA (₹)', group: 'FULL MONTH SALARY STRUCTURE (₹)', role: 'value', kind: 'money', width: 14, value: c => c.sal.hra, sum: true },
  { key: 'fullSpecial', header: 'Full Mth Special (₹)', group: 'FULL MONTH SALARY STRUCTURE (₹)', role: 'value', kind: 'money', width: 14, value: c => round2(c.sal.specialAllowance + c.sal.medicalAllowance + c.sal.travelAllowance + c.sal.otherAllowances), sum: true },
  { key: 'fullGross', header: 'Full Mth Gross (₹)', group: 'FULL MONTH SALARY STRUCTURE (₹)', role: 'calc', kind: 'money', width: 14, formula: (r, L) => `${L.fullBasic}${r}+${L.fullHra}${r}+${L.fullSpecial}${r}`, sum: true },
  { key: 'fullPfEmployer', header: 'Full Mth PF Employer (₹)', group: 'FULL MONTH SALARY STRUCTURE (₹)', role: 'calc', kind: 'money', width: 14, formula: (r, L, rt) => pfFormula(`${L.fullBasic}${r}`, rt, 'employer'), sum: true },
  { key: 'fullPfEmployee', header: 'Full Mth PF Employee (₹)', group: 'FULL MONTH SALARY STRUCTURE (₹)', role: 'calc', kind: 'money', width: 14, formula: (r, L, rt) => pfFormula(`${L.fullBasic}${r}`, rt, 'employee'), sum: true },
  { key: 'lta', header: 'LTA (₹)', group: 'FULL MONTH SALARY STRUCTURE (₹)', role: 'value', kind: 'money', width: 12, value: c => c.sal.lta, sum: true },
  { key: 'mobileInternet', header: 'Mobile & Internet (₹)', group: 'FULL MONTH SALARY STRUCTURE (₹)', role: 'value', kind: 'money', width: 14, value: c => c.sal.mobileInternet, sum: true },
  { key: 'mealFuel', header: 'Meal & Fuel (₹)', group: 'FULL MONTH SALARY STRUCTURE (₹)', role: 'value', kind: 'money', width: 13, value: c => c.sal.mealFuel, sum: true },

  { key: 'proratedGross', header: 'Prorated Gross (₹)', group: 'PRORATED EARNINGS (₹)', role: 'calc', kind: 'money', width: 14, formula: (r, L) => `ROUND(${L.fullGross}${r}/${CAL}*${L.daysPayable}${r},2)`, sum: true },
  { key: 'proratedBasic', header: 'Prorated Basic (₹)', group: 'PRORATED EARNINGS (₹)', role: 'calc', kind: 'money', width: 14, formula: (r, L) => `ROUND(${L.fullBasic}${r}/${CAL}*${L.daysPayable}${r},2)`, sum: true },
  { key: 'proratedHra', header: 'Prorated HRA (₹)', group: 'PRORATED EARNINGS (₹)', role: 'calc', kind: 'money', width: 14, formula: (r, L) => `ROUND(${L.fullHra}${r}/${CAL}*${L.daysPayable}${r},2)`, sum: true },
  { key: 'proratedSpecial', header: 'Prorated Special (₹)', group: 'PRORATED EARNINGS (₹)', role: 'calc', kind: 'money', width: 14, formula: (r, L) => `ROUND(${L.fullSpecial}${r}/${CAL}*${L.daysPayable}${r},2)`, sum: true },

  { key: 'pfEmployerDed', header: 'PF Employer (₹)', group: 'STATUTORY DEDUCTIONS (₹)', role: 'calc', kind: 'money', width: 13, formula: (r, L, rt) => pfFormula(`${L.fullBasic}${r}`, rt, 'employer'), sum: true },
  { key: 'pfEmployeeDed', header: 'PF Employee (₹)', group: 'STATUTORY DEDUCTIONS (₹)', role: 'calc', kind: 'money', width: 13, formula: (r, L, rt) => pfFormula(`${L.fullBasic}${r}`, rt, 'employee'), sum: true },
  { key: 'profTax', header: 'Prof Tax (₹)', group: 'STATUTORY DEDUCTIONS (₹)', role: 'calc', kind: 'money', width: 11, formula: (r, L, rt) => ptFormula(`${L.proratedGross}${r}`, rt), sum: true },
  { key: 'tds', header: 'Income Tax / TDS (₹)', group: 'STATUTORY DEDUCTIONS (₹)', role: 'inputFin', kind: 'money', width: 14, prefill: true, value: c => c.ps?.tds ?? 0, sum: true },
  { key: 'advanceRecovery', header: 'Advance Recovery (₹)', group: 'STATUTORY DEDUCTIONS (₹)', role: 'inputHr', kind: 'money', width: 14, value: c => c.ps?.advanceRecovery ?? 0, sum: true },
  { key: 'otherDeduction', header: 'Other Deduction (₹)', group: 'STATUTORY DEDUCTIONS (₹)', role: 'inputHr', kind: 'money', width: 14, value: c => c.ps?.otherDeduction ?? 0, sum: true },
  { key: 'totalDeductions', header: 'Total Deductions (₹)', group: 'STATUTORY DEDUCTIONS (₹)', role: 'calc', kind: 'money', width: 14, formula: (r, L) => `${L.pfEmployeeDed}${r}+${L.profTax}${r}+${L.tds}${r}+${L.advanceRecovery}${r}+${L.otherDeduction}${r}`, sum: true },

  { key: 'variableIncentive', header: 'Variable Incentive (₹)', group: 'ONE-TIME ITEMS (₹)', role: 'inputHr', kind: 'money', width: 14, value: c => c.ps?.variableIncentive ?? 0, sum: true },
  { key: 'salaryRevisionArrear', header: 'Salary Revision (₹)', group: 'ONE-TIME ITEMS (₹)', role: 'inputHr', kind: 'money', width: 14, value: c => c.ps?.salaryRevisionArrear ?? 0, sum: true },
  { key: 'otherAddition', header: 'Other Addition (₹)', group: 'ONE-TIME ITEMS (₹)', role: 'inputHr', kind: 'money', width: 14, value: c => c.ps?.otherAddition ?? 0, sum: true },

  { key: 'petrolReimb', header: 'Petrol Reimb (₹)', group: 'REIMBURSEMENTS (₹)', role: 'inputHr', kind: 'money', width: 13, value: c => c.ps?.petrolReimb ?? 0, sum: true },
  { key: 'driverReimb', header: 'Driver Reimb (₹)', group: 'REIMBURSEMENTS (₹)', role: 'inputHr', kind: 'money', width: 13, value: c => c.ps?.driverReimb ?? 0, sum: true },

  { key: 'netPay', header: 'Net Pay (₹)', group: 'NET PAY (₹)', role: 'calc', kind: 'money', width: 14, formula: (r, L) => `${L.proratedGross}${r}+${L.lta}${r}+${L.mobileInternet}${r}+${L.mealFuel}${r}+${L.variableIncentive}${r}+${L.salaryRevisionArrear}${r}+${L.otherAddition}${r}-${L.totalDeductions}${r}`, sum: true },
  { key: 'totalNetPay', header: 'Total Net Pay (₹)', group: 'NET PAY (₹)', role: 'calc', kind: 'money', width: 14, formula: (r, L) => `${L.netPay}${r}+${L.petrolReimb}${r}+${L.driverReimb}${r}`, sum: true },

  { key: 'bankAccountNumber', header: 'Bank Account No.', group: 'BANK DETAILS', role: 'value', kind: 'text', width: 20, value: c => c.emp.bankDetail?.bankAccountNumber ?? '' },
  { key: 'ifscCode', header: 'IFSC Code', group: 'BANK DETAILS', role: 'value', kind: 'text', width: 14, value: c => c.emp.bankDetail?.ifscCode ?? '' },
  { key: 'nameOnAccount', header: 'Name on Account', group: 'BANK DETAILS', role: 'value', kind: 'text', width: 22, value: c => c.emp.bankDetail?.nameOnAccount ?? '' },

  { key: 'remarks', header: 'Remarks / Notes', group: 'REMARKS', role: 'value', kind: 'text', width: 24, value: c => c.ps?.remarks ?? '' },
  { key: 'totalCashOutflow', header: 'Total Cash Outflow (₹)', group: 'REMARKS', role: 'calc', kind: 'money', width: 16, formula: (r, L) => `${L.totalNetPay}${r}+${L.pfEmployerDed}${r}+${L.pfEmployeeDed}${r}+${L.profTax}${r}+${L.tds}${r}`, sum: true },
];

function compute(ctx: RowCtx): Record<string, number> {
  const { sal, ps, calendarDays, rates } = ctx;
  const fullBasic = sal.basic;
  const fullHra = sal.hra;
  const fullSpecial = round2(sal.specialAllowance + sal.medicalAllowance + sal.travelAllowance + sal.otherAllowances);
  const fullGross = round2(fullBasic + fullHra + fullSpecial);
  // Live rates, and the wage ceiling if the company caps PF at it.
  const pfWage = sal.pfApplicable === false || !rates.pfEnabled ? 0 : pfWageFor(fullBasic, rates);
  const fullPfEmployer = round2(pfWage * (rates.pfEmployerRate / 100));
  const fullPfEmployee = round2(pfWage * (rates.pfEmployeeRate / 100));
  const lta = sal.lta ?? 0, mobileInternet = sal.mobileInternet ?? 0, mealFuel = sal.mealFuel ?? 0;
  const monthlyCtc = round2(fullGross + fullPfEmployer + lta + mobileInternet + mealFuel);

  const lopDays = ps?.lopDays ?? 0;
  const daysPayable = round2(calendarDays - lopDays);
  const proratedGross = round2(fullGross / calendarDays * daysPayable);
  const proratedBasic = round2(fullBasic / calendarDays * daysPayable);
  const proratedHra = round2(fullHra / calendarDays * daysPayable);
  const proratedSpecial = round2(fullSpecial / calendarDays * daysPayable);

  const pfEmployerDed = fullPfEmployer, pfEmployeeDed = fullPfEmployee;
  const profTaxV = rates.ptEnabled && sal.ptApplicable !== false
    ? professionalTaxFor(proratedGross, rates.ptSlabs as PtSlab[] | null, ps?.month ?? 6)
    : 0;
  const tds = ps?.tds ?? 0;
  const advanceRecovery = ps?.advanceRecovery ?? 0, otherDeduction = ps?.otherDeduction ?? 0;
  const totalDeductions = round2(pfEmployeeDed + profTaxV + tds + advanceRecovery + otherDeduction);

  const variableIncentive = ps?.variableIncentive ?? 0, salaryRevisionArrear = ps?.salaryRevisionArrear ?? 0, otherAddition = ps?.otherAddition ?? 0;
  const petrolReimb = ps?.petrolReimb ?? 0, driverReimb = ps?.driverReimb ?? 0;
  const netPay = round2(proratedGross + lta + mobileInternet + mealFuel + variableIncentive + salaryRevisionArrear + otherAddition - totalDeductions);
  const totalNetPay = round2(netPay + petrolReimb + driverReimb);
  const totalCashOutflow = round2(totalNetPay + pfEmployerDed + pfEmployeeDed + profTaxV + tds);

  return {
    lopDays, daysPayable, monthlyCtc, fullBasic, fullHra, fullSpecial, fullGross,
    fullPfEmployer, fullPfEmployee, lta, mobileInternet, mealFuel,
    proratedGross, proratedBasic, proratedHra, proratedSpecial,
    pfEmployerDed, pfEmployeeDed, profTax: profTaxV, tds, advanceRecovery, otherDeduction, totalDeductions,
    variableIncentive, salaryRevisionArrear, otherAddition, petrolReimb, driverReimb,
    netPay, totalNetPay, totalCashOutflow,
  };
}

function drawBanner(ws: ExcelJS.Worksheet, ctx: { org: string; monthLabel: string; lastLetter: string; calendarDays: number }): number {
  const { org, monthLabel, lastLetter, calendarDays } = ctx;
  ws.mergeCells(`A1:${lastLetter}1`);
  const title = ws.getCell('A1');
  title.value = `${org.toUpperCase()} — PAYROLL WORKING SHEET  |  ${monthLabel}  |  Only BLUE cells are inputs — all others auto-calculate`;
  title.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 24;

  ws.getCell('A2').value = 'PAYROLL MONTH →'; ws.getCell('A2').font = { bold: true };
  ws.getCell('B2').value = monthLabel; ws.getCell('B2').font = { bold: true, color: { argb: NAVY } };
  ws.getCell('D2').value = 'CALENDAR DAYS →'; ws.getCell('D2').font = { bold: true };
  ws.getCell('E2').value = calendarDays; // $E$2 — referenced by GREY formulas
  ws.getCell('E2').font = { bold: true }; ws.getCell('E2').alignment = { horizontal: 'center' };
  ws.getCell('F2').value = 'PAYOUT DATE →'; ws.getCell('F2').font = { bold: true };
  ws.getCell('G2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };

  ws.mergeCells(`A3:${lastLetter}3`);
  const legend = ws.getCell('A3');
  legend.value = '⚠ AUDIT:  BLUE = HR Input  |  GREY = Auto-calculated (do NOT edit)  |  YELLOW = Finance inputs TDS  |  Reconcile Grand Total before sending to HOD';
  legend.font = { bold: true, italic: true, size: 10, color: { argb: 'FFFFFFFF' } };
  legend.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
  legend.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  return 4;
}

export const medfinTemplate: SheetTemplate = {
  id: 'medfin-working-sheet',
  label: 'Working Sheet (colour-coded, CTC-based)',
  sheetName: 'Working Sheet',
  modes: ['template', 'snapshot'],
  freezeCols: 2,
  showGroupRow: true,
  columns: COLS,
  compute,
  drawBanner,
  totalSpan: 2,
  totalLabel: (n) => `GRAND TOTAL (${n} employees)`,
  groupFill: {
    'EMPLOYEE IDENTITY': NAVY,
    'ORGANISATION': 'FF2F5496',
    'FULL MONTH SALARY STRUCTURE (₹)': 'FF2F5496',
    'PRORATED EARNINGS (₹)': 'FF375623',
    'STATUTORY DEDUCTIONS (₹)': 'FFA51E22',
    'ONE-TIME ITEMS (₹)': 'FFBF6B04',
    'REIMBURSEMENTS (₹)': 'FF375623',
    'NET PAY (₹)': NAVY,
    'BANK DETAILS': NAVY,
    'REMARKS': NAVY,
  },
  roleFill: {
    calc: 'FFF2F2F2',
    inputHr: 'FFDDEBF7',
    inputFin: 'FFFFF2CC',
  },
};
