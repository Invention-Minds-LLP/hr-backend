// One-off: re-chain LeaveMonthlySummary so each month opens at the previous
// month's closing. Summaries used to be rebuilt only for the month a change
// landed in, so later months kept a stale opening (JMRH175: April leave of 6
// days never reached May–October). Reads the ledger, rewrites summary rows only
// — balances, leave requests and the ledger itself are not touched.
//
//   npx ts-node --transpile-only src/scripts/repair-leave-summary-chain.ts                 (dry run, everyone)
//   npx ts-node --transpile-only src/scripts/repair-leave-summary-chain.ts --emp=JMRH175   (dry run, one employee)
//   npx ts-node --transpile-only src/scripts/repair-leave-summary-chain.ts --apply         (write)
//
// The dry run executes the real rebuild inside a transaction and rolls it back,
// so what it prints is exactly what --apply would write.
import { prisma } from '../lib/prisma';
import {
  rebuildSummaryChainTx, earliestFyMonth, getFinancialYear, getCalendarYear,
} from '../api/leave/leave.controller';

const APPLY = process.argv.includes('--apply');
const EMP_CODE = process.argv.find((a) => a.startsWith('--emp='))?.split('=')[1];
const ROLLBACK = Symbol('rollback');
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

type Row = { month: number; opening: number; credited: number; used: number; lapsed: number; closing: number };

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const fyIdx = (m: number) => (m >= 4 ? m - 4 : m + 8);
const label = (fy: number, m: number) => `${MONTHS[m - 1]}-${getCalendarYear(fy, m)}`;

async function main() {
  console.log(APPLY ? '── Applying ──' : '── DRY RUN (nothing is written) ──');

  let employeeFilter: number | undefined;
  if (EMP_CODE) {
    const emp = await prisma.employee.findFirst({ where: { employeeCode: EMP_CODE }, select: { id: true } });
    if (!emp) throw new Error(`Employee ${EMP_CODE} not found`);
    employeeFilter = emp.id;
  }

  const currentFy = getFinancialYear(new Date());
  const keys = await prisma.leaveMonthlySummary.groupBy({
    by: ['employeeId', 'leaveTypeId', 'year'],
    where: { year: { lte: currentFy }, ...(employeeFilter ? { employeeId: employeeFilter } : {}) },
    orderBy: [{ employeeId: 'asc' }, { leaveTypeId: 'asc' }, { year: 'asc' }],
  });

  const [types, emps] = await Promise.all([
    prisma.leaveType.findMany({ select: { id: true, name: true } }),
    prisma.employee.findMany({
      where: { id: { in: Array.from(new Set(keys.map((k) => k.employeeId))) } },
      select: { id: true, employeeCode: true },
    }),
  ]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const empCode = new Map(emps.map((e) => [e.id, e.employeeCode]));

  console.log(`  ${keys.length} employee / leave type / year chain(s) to check\n`);

  let changedChains = 0;
  let changedRows = 0;
  let failed = 0;

  for (const k of keys) {
    const { employeeId, leaveTypeId, year } = k;
    try {
      await prisma.$transaction(async (tx) => {
        const before: Row[] = await tx.leaveMonthlySummary.findMany({
          where: { employeeId, leaveTypeId, year },
          select: { month: true, opening: true, credited: true, used: true, lapsed: true, closing: true },
        });
        if (!before.length) return;

        // The first month keeps its stored opening (it may be a carried or
        // overridden figure); April always opens at 0 by the FY rule.
        const firstMonth = earliestFyMonth(before.map((r) => r.month));
        const first = before.find((r) => r.month === firstMonth)!;
        await rebuildSummaryChainTx(tx, employeeId, leaveTypeId, year, firstMonth,
          firstMonth === 4 ? undefined : first.opening);

        const after: Row[] = await tx.leaveMonthlySummary.findMany({
          where: { employeeId, leaveTypeId, year },
          select: { month: true, opening: true, credited: true, used: true, lapsed: true, closing: true },
        });

        const byMonth = new Map(before.map((r) => [r.month, r]));
        const diffs = after
          .sort((a, b) => fyIdx(a.month) - fyIdx(b.month))
          .filter((r) => {
            const o = byMonth.get(r.month);
            return !o || !same(o.opening, r.opening) || !same(o.closing, r.closing)
              || !same(o.credited, r.credited) || !same(o.used, r.used) || !same(o.lapsed, r.lapsed);
          });

        if (diffs.length) {
          changedChains++;
          changedRows += diffs.length;
          console.log(`${empCode.get(employeeId) ?? `emp ${employeeId}`}  ${typeName.get(leaveTypeId) ?? leaveTypeId}  FY ${year}-${String(year + 1).slice(2)}`);
          for (const r of diffs) {
            const o = byMonth.get(r.month);
            console.log(o
              ? `    ${label(year, r.month)}: opening ${o.opening} → ${r.opening}, closing ${o.closing} → ${r.closing}`
              : `    ${label(year, r.month)}: new row (gap filled) opening ${r.opening}, closing ${r.closing}`);
          }
        }

        if (!APPLY) throw ROLLBACK;
      }, { maxWait: 20000, timeout: 120000 });
    } catch (err) {
      if (err === ROLLBACK) continue;
      failed++;
      console.error(`  FAILED emp ${employeeId} type ${leaveTypeId} FY ${year}:`, (err as Error)?.message ?? err);
    }
  }

  console.log(`\n  chains with changes: ${changedChains}, month rows changed/added: ${changedRows}, failed: ${failed}`);
  if (!APPLY && changedChains) console.log('  re-run with --apply to write these changes');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
