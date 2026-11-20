// Replays JMRH175 through relabelEarlyCredit against an in-memory stand-in for
// the tables it touches. Starting state is production as found: the March 2026
// credit filed under FY 2026 / March (= March 2027) and stale May–Oct summaries.
//   npx ts-node --transpile-only src/scripts/verify-early-credit-relabel.ts
import { relabelEarlyCredit, SuspectCredit } from './audit-future-leave-credits';

const EMP = 175, EL = 3, FY = 2026;
let nextId = 1000;

type Ledger = { id: number; employeeId: number; leaveTypeId: number; year: number; month: number; credit: number; debit: number; action: string; referenceType: string };
const L = (month: number, credit: number, debit: number, action: string, referenceType: string): Ledger =>
  ({ id: nextId++, employeeId: EMP, leaveTypeId: EL, year: FY, month, credit, debit, action, referenceType });

const ledger: Ledger[] = [
  L(4, 49.5, 0, 'OPENING_BALANCE', 'MANUAL'),
  L(3, 1.5, 0, 'CREDIT', 'ACCRUAL'),           // March 2026 credit, filed as FY 2026 / March
  L(4, 0, 6, 'DEBIT', 'LEAVE_REQUEST'),
  ...[5, 6, 7, 8, 9, 10].map((m) => L(m, 1.5, 0, 'CREDIT', 'ACCRUAL')),
  L(9, 0, 25.5, 'ENCASHMENT', 'ENCASHMENT'),
];
const MARCH_LEDGER_ID = ledger[1].id;

const accruals = [
  // Written 1 Apr 2026 02:10 IST = 31 Mar 2026 20:40 UTC.
  { id: 1, employeeId: EMP, leaveTypeId: EL, year: FY, month: 3, daysCredited: 1.5, createdAt: new Date('2026-03-31T20:40:00Z') },
  ...[5, 6, 7, 8, 9, 10].map((m, i) => ({ id: 2 + i, employeeId: EMP, leaveTypeId: EL, year: FY, month: m, daysCredited: 1.5, createdAt: new Date(2026, m, 1, 2, 10) })),
];

type Summary = { employeeId: number; leaveTypeId: number; year: number; month: number; opening: number; credited: number; used: number; lapsed: number; closing: number };
let summaries: Summary[] = [
  [3, 0, 1.5, 0, 1.5],                                    // the row filed under March 2027
  [4, 0, 49.5, 6, 43.5], [5, 49.5, 1.5, 0, 51], [6, 51, 1.5, 0, 52.5], [7, 52.5, 1.5, 0, 54],
  [8, 54, 1.5, 0, 55.5], [9, 55.5, 1.5, 25.5, 31.5], [10, 31.5, 1.5, 0, 33],
].map(([month, opening, credited, used, closing]) =>
  ({ employeeId: EMP, leaveTypeId: EL, year: FY, month, opening, credited, used, lapsed: 0, closing }));
const yearly: any[] = [];

const matches = (row: any, where: any) => Object.entries(where).every(([k, v]: [string, any]) =>
  v && typeof v === 'object' && 'in' in v ? v.in.includes(row[k]) : row[k] === v);

const tx: any = {
  leaveAccrual: {
    findUnique: async ({ where }: any) => accruals.find((a) => matches(a, where.employeeId_leaveTypeId_year_month)) ?? null,
    update: async ({ where, data }: any) => Object.assign(accruals.find((a) => a.id === where.id)!, data),
  },
  leaveLedger: {
    findMany: async ({ where, distinct }: any) => {
      const rows = ledger.filter((e) => matches(e, where));
      return distinct ? Array.from(new Map(rows.map((r) => [r.month, r])).values()) : rows;
    },
    update: async ({ where, data }: any) => Object.assign(ledger.find((e) => e.id === where.id)!, data),
    count: async ({ where }: any) => ledger.filter((e) => matches(e, where)).length,
  },
  leaveMonthlySummary: {
    findUnique: async ({ where }: any) => summaries.find((s) => matches(s, where.employeeId_leaveTypeId_year_month)) ?? null,
    findMany: async ({ where }: any) => summaries.filter((s) => matches(s, where)),
    upsert: async ({ where, update, create }: any) => {
      const s = summaries.find((r) => matches(r, where.employeeId_leaveTypeId_year_month));
      if (s) Object.assign(s, update); else summaries.push({ ...create });
    },
    deleteMany: async ({ where }: any) => { summaries = summaries.filter((s) => !matches(s, where)); },
  },
  leaveYearlySummary: { upsert: async ({ update }: any) => { yearly.push(update); } },
};

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function main() {
  const suspect = accruals[0] as SuspectCredit;
  const r = await relabelEarlyCredit(tx, { ...suspect });

  const row = (m: number) => summaries.find((s) => s.month === m);
  check('correction accepted', r.ok, r.ok ? '' : r.reason);
  check('credit record moved to March 2026 (FY 2025)', accruals[0].year === 2025, `year ${accruals[0].year}`);
  check('March 2027 credit slot is free again',
    !accruals.some((a) => a.year === FY && a.month === 3));
  check('ledger credit moved to April, same year and amount',
    (() => { const e = ledger.find((x) => x.id === MARCH_LEDGER_ID)!; return e.month === 4 && e.year === FY && e.credit === 1.5; })());
  check('summary row filed under March 2027 removed', !row(3));
  check('April now credits 51 (49.5 carried + 1.5 March credit)', row(4)?.credited === 51, `got ${row(4)?.credited}`);
  check('October closes at 28.5 — matches the balance screen', row(10)?.closing === 28.5, `got ${row(10)?.closing}`);
  check('every month opens at the previous closing',
    [5, 6, 7, 8, 9, 10].every((m) => row(m)?.opening === row(m - 1)?.closing));
  const y = yearly[yearly.length - 1];
  check('yearly closing 28.5, used 6, encashed 25.5',
    y?.closing === 28.5 && y?.used === 6 && y?.encashed === 25.5, `closing ${y?.closing}, used ${y?.used}, encashed ${y?.encashed}`);
  check('reported closing 33 → 28.5', r.ok && r.closingBefore === 33 && r.closingAfter === 28.5,
    r.ok ? `${r.closingBefore} → ${r.closingAfter}` : '');

  // A second run on the corrected data must refuse rather than move anything.
  const again = await relabelEarlyCredit(tx, { ...suspect, year: FY });
  check('re-running on corrected data changes nothing', !again.ok, again.ok ? 'it ran again' : again.reason);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
