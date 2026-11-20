// Replays JMRH175's FY 2026-27 EL ledger through rebuildSummaryChainTx against
// an in-memory stand-in for the four tables it touches, starting from the stale
// summary rows found in production (May–Oct each 6 days too high).
//   npx ts-node --transpile-only src/scripts/verify-leave-summary-chain.ts
import { rebuildSummaryChainTx } from '../api/leave/leave.controller';

type Ledger = { employeeId: number; leaveTypeId: number; year: number; month: number; credit: number; debit: number; action: string };
type Summary = { employeeId: number; leaveTypeId: number; year: number; month: number; opening: number; credited: number; used: number; lapsed: number; closing: number };

const EMP = 175, EL = 3, FY = 2026;

const ledger: Ledger[] = [
  { month: 4, credit: 49.5, debit: 0, action: 'OPENING_BALANCE' },
  { month: 4, credit: 0, debit: 6, action: 'DEBIT' },
  // A month's credit is posted on the 1st of the next month, so on 20 Nov the
  // last credit is October's.
  ...[5, 6, 7, 8, 9, 10].map((m) => ({ month: m, credit: 1.5, debit: 0, action: 'CREDIT' })),
  { month: 9, credit: 0, debit: 25.5, action: 'ENCASHMENT' },
].map((e) => ({ employeeId: EMP, leaveTypeId: EL, year: FY, ...e }));

// Stale rows exactly as exported from production.
const summaries: Summary[] = [
  [4, 0, 49.5, 6, 43.5], [5, 49.5, 1.5, 0, 51], [6, 51, 1.5, 0, 52.5], [7, 52.5, 1.5, 0, 54],
  [8, 54, 1.5, 0, 55.5], [9, 55.5, 1.5, 25.5, 31.5], [10, 31.5, 1.5, 0, 33],
].map(([month, opening, credited, used, closing]) =>
  ({ employeeId: EMP, leaveTypeId: EL, year: FY, month, opening, credited, used, lapsed: 0, closing }));
const yearly: any[] = [];

const matches = (row: any, where: any) => Object.entries(where).every(([k, v]: [string, any]) =>
  v && typeof v === 'object' && 'in' in v ? v.in.includes(row[k]) : row[k] === v);

const tx: any = {
  leaveMonthlySummary: {
    findUnique: async ({ where }: any) => summaries.find((s) => matches(s, where.employeeId_leaveTypeId_year_month)) ?? null,
    findMany: async ({ where }: any) => summaries.filter((s) => matches(s, where)),
    upsert: async ({ where, update, create }: any) => {
      const s = summaries.find((r) => matches(r, where.employeeId_leaveTypeId_year_month));
      if (s) Object.assign(s, update); else summaries.push({ ...create });
    },
  },
  leaveLedger: {
    findMany: async ({ where, distinct }: any) => {
      const rows = ledger.filter((e) => matches(e, where));
      return distinct ? Array.from(new Map(rows.map((r) => [r.month, r])).values()) : rows;
    },
  },
  leaveYearlySummary: { upsert: async ({ update }: any) => { yearly.push(update); } },
};

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function main() {
  // A change landing in April — exactly how the April leave was recorded.
  await rebuildSummaryChainTx(tx, EMP, EL, FY, 4);

  const close = (m: number) => summaries.find((s) => s.month === m)?.closing;
  const open = (m: number) => summaries.find((s) => s.month === m)?.opening;

  check('April closes at 43.5', close(4) === 43.5, `got ${close(4)}`);
  check('May opens at April closing (43.5), not 49.5', open(5) === 43.5, `got ${open(5)}`);
  check('September closes at 25.5 after the encashment', close(9) === 25.5, `got ${close(9)}`);
  check('October closes at 27', close(10) === 27, `got ${close(10)}`);
  check('every month opens at the previous closing',
    [5, 6, 7, 8, 9, 10].every((m) => open(m) === close(m - 1)));
  check('no month without data and none after the current one is created',
    !summaries.some((s) => s.month === 11 || s.month === 12 || s.month <= 3));

  const y = yearly[yearly.length - 1];
  check('yearly summary rebuilt', yearly.length === 1);
  check('yearly encashed column = 25.5', y?.encashed === 25.5, `got ${y?.encashed}`);
  check('yearly used is leave taken only (6), not leave + encashment', y?.used === 6, `got ${y?.used}`);
  check('yearly closing equals October closing (27) — encashment not subtracted twice', y?.closing === 27, `got ${y?.closing}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
