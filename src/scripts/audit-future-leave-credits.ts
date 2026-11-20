// Audit (and optionally correct) leave credits posted to a month that had not
// ended when they were written. An old version of the monthly EL accrual filed
// the 1 April 2026 run (March 2026's credit) under FY 2026 / March, i.e. March
// 2027. Balances are right, but the LeaveAccrual row for "March 2027" would
// make the real March 2027 accrual skip those employees next April.
//
//   npx ts-node --transpile-only src/scripts/audit-future-leave-credits.ts                    (report)
//   npx ts-node --transpile-only src/scripts/audit-future-leave-credits.ts --emp=JMRH175      (one employee)
//   npx ts-node --transpile-only src/scripts/audit-future-leave-credits.ts --apply            (correct)
//
// For every suspect credit it says whether the month one financial year
// EARLIER (the one intended) was credited too:
//   - "also credited"  → probable double credit. Never touched by --apply;
//                        HR decides and reverses with a balance adjustment.
//   - "not credited"   → wrong label only. --apply relabels it (see
//                        relabelEarlyCredit). Balances do not change.
//
// Without --apply nothing is written: each correction runs inside a
// transaction that is rolled back, so the dry run shows the real result.
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getCalendarYear, rebuildSummaryChainTx } from '../api/leave/leave.controller';

type Tx = Prisma.TransactionClient;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const label = (fy: number, m: number) => `${MONTHS[m - 1]}-${getCalendarYear(fy, m)}`;
const monthEnd = (fy: number, m: number) => new Date(getCalendarYear(fy, m), m, 0, 23, 59, 59);
const fyIdx = (m: number) => (m >= 4 ? m - 4 : m + 8);

export interface SuspectCredit {
  id: number;
  employeeId: number;
  leaveTypeId: number;
  year: number;   // financial year it is filed under
  month: number;  // month it is filed under
  daysCredited: number;
  createdAt: Date;
}

export type RelabelResult =
  | { ok: true; ledgerId: number; toMonth: number; closingBefore: number | null; closingAfter: number | null; lastMonth: number | null }
  | { ok: false; reason: string };

/** Calendar year/month of a timestamp in IST, whatever the server's timezone. */
function istYearMonth(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
}

/** Closing of the latest summary month that isn't `skipMonth`, in FY order. */
async function latestClosing(tx: Tx, employeeId: number, leaveTypeId: number, year: number, skipMonth: number) {
  const rows = await tx.leaveMonthlySummary.findMany({
    where: { employeeId, leaveTypeId, year },
    select: { month: true, closing: true },
  });
  const kept = rows.filter((r) => r.month !== skipMonth).sort((a, b) => fyIdx(a.month) - fyIdx(b.month));
  const last = kept[kept.length - 1];
  return { closing: last?.closing ?? null, month: last?.month ?? null };
}

/**
 * Correct one "wrong label only" credit:
 *   - LeaveAccrual  → moved to the month it was really for (one FY earlier),
 *                     freeing the future slot so that month's real accrual runs.
 *   - LeaveLedger   → its single matching ACCRUAL credit moves to the month it
 *                     actually entered the balance (the month it was written).
 *                     Year, amount and balance are untouched.
 *   - Summary       → the row for the future month is removed if nothing else
 *                     is filed there, and the FY chain is rebuilt from the
 *                     ledger's new month.
 * Refuses anything that doesn't match exactly, rather than guessing.
 */
export async function relabelEarlyCredit(tx: Tx, s: SuspectCredit): Promise<RelabelResult> {
  const intendedFy = s.year - 1;
  const written = istYearMonth(s.createdAt);
  const writtenFy = written.month >= 4 ? written.year : written.year - 1;
  if (writtenFy !== s.year) {
    return { ok: false, reason: `written in FY ${writtenFy}, filed under FY ${s.year} — not the known pattern` };
  }
  const toMonth = written.month;

  const intended = await tx.leaveAccrual.findUnique({
    where: { employeeId_leaveTypeId_year_month: { employeeId: s.employeeId, leaveTypeId: s.leaveTypeId, year: intendedFy, month: s.month } },
  });
  if (intended) return { ok: false, reason: `${label(intendedFy, s.month)} already credited — probable double credit, left for HR` };

  const ledgers = await tx.leaveLedger.findMany({
    where: {
      employeeId: s.employeeId, leaveTypeId: s.leaveTypeId, year: s.year, month: s.month,
      action: 'CREDIT', referenceType: 'ACCRUAL',
    },
    select: { id: true, credit: true },
  });
  if (ledgers.length !== 1 || Number(ledgers[0].credit) !== Number(s.daysCredited)) {
    return { ok: false, reason: `expected one ${s.daysCredited}-day accrual ledger credit, found ${ledgers.length}` };
  }

  const before = await latestClosing(tx, s.employeeId, s.leaveTypeId, s.year, s.month);

  await tx.leaveAccrual.update({ where: { id: s.id }, data: { year: intendedFy } });
  await tx.leaveLedger.update({ where: { id: ledgers[0].id }, data: { month: toMonth } });

  const leftInMonth = await tx.leaveLedger.count({
    where: { employeeId: s.employeeId, leaveTypeId: s.leaveTypeId, year: s.year, month: s.month },
  });
  if (leftInMonth === 0) {
    await tx.leaveMonthlySummary.deleteMany({
      where: { employeeId: s.employeeId, leaveTypeId: s.leaveTypeId, year: s.year, month: s.month },
    });
  }

  await rebuildSummaryChainTx(tx, s.employeeId, s.leaveTypeId, s.year, toMonth);

  const after = await latestClosing(tx, s.employeeId, s.leaveTypeId, s.year, s.month);
  return {
    ok: true, ledgerId: ledgers[0].id, toMonth,
    closingBefore: before.closing, closingAfter: after.closing, lastMonth: after.month,
  };
}

const ROLLBACK = Symbol('rollback');

async function main() {
  const APPLY = process.argv.includes('--apply');
  const EMP_CODE = process.argv.find((a) => a.startsWith('--emp='))?.split('=')[1];
  console.log(APPLY
    ? '── Audit + CORRECT wrong-label credits (writing) ──\n'
    : '── Audit: credits posted before their month ended (dry run, nothing is written) ──\n');

  let employeeId: number | undefined;
  if (EMP_CODE) {
    const emp = await prisma.employee.findFirst({ where: { employeeCode: EMP_CODE }, select: { id: true } });
    if (!emp) throw new Error(`Employee ${EMP_CODE} not found`);
    employeeId = emp.id;
  }

  const accruals = await prisma.leaveAccrual.findMany({
    where: { month: { not: null }, ...(employeeId ? { employeeId } : {}) },
    select: { id: true, employeeId: true, leaveTypeId: true, year: true, month: true, daysCredited: true, createdAt: true },
    orderBy: [{ employeeId: 'asc' }, { year: 'asc' }, { month: 'asc' }],
  });
  const suspects = accruals.filter((a) => a.createdAt < monthEnd(a.year, a.month!)) as SuspectCredit[];

  if (!suspects.length) {
    console.log('  none found');
    return;
  }

  const [emps, types] = await Promise.all([
    prisma.employee.findMany({
      where: { id: { in: Array.from(new Set(suspects.map((s) => s.employeeId))) } },
      select: { id: true, employeeCode: true },
    }),
    prisma.leaveType.findMany({ select: { id: true, name: true } }),
  ]);
  const code = new Map(emps.map((e) => [e.id, e.employeeCode]));
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  // `accruals` holds every month-level accrual in scope (all employees, or all
  // of one employee's), so the intended month is in the Set if it was credited.
  const key = (e: number, t: number, y: number, m: number) => `${e}|${t}|${y}|${m}`;
  const existing = new Set(accruals.map((a) => key(a.employeeId, a.leaveTypeId, a.year, a.month!)));

  let duplicates = 0, corrected = 0, refused = 0, failed = 0;
  for (const s of suspects) {
    const who = `${code.get(s.employeeId) ?? `emp ${s.employeeId}`}  ${typeName.get(s.leaveTypeId) ?? s.leaveTypeId}`;
    const intendedFy = s.year - 1;
    const head = `${who}  ${s.daysCredited} day(s) filed under ${label(s.year, s.month)}, written ${s.createdAt.toISOString().slice(0, 10)}`;

    if (existing.has(key(s.employeeId, s.leaveTypeId, intendedFy, s.month))) {
      duplicates++;
      console.log(`${head}  → ${label(intendedFy, s.month)} was ALSO credited — probable double credit (left for HR)`);
      continue;
    }

    let result: RelabelResult | undefined;
    try {
      await prisma.$transaction(async (tx) => {
        result = await relabelEarlyCredit(tx, s);
        if (!APPLY || !result.ok) throw ROLLBACK;
      }, { maxWait: 20000, timeout: 120000 });
    } catch (err) {
      if (err !== ROLLBACK) {
        failed++;
        console.error(`${head}  → FAILED: ${(err as Error)?.message ?? err}`);
        continue;
      }
    }

    if (!result) continue;
    if (!result.ok) {
      refused++;
      console.log(`${head}  → not corrected: ${result.reason}`);
      continue;
    }
    corrected++;
    console.log(
      `${head}  → ${APPLY ? 'corrected' : 'would correct'}: credit record → ${label(intendedFy, s.month)}, ` +
      `ledger → ${label(s.year, result.toMonth)}; summary ${result.lastMonth ? label(s.year, result.lastMonth) : ''} ` +
      `closing ${result.closingBefore} → ${result.closingAfter}`,
    );
  }

  console.log(
    `\n  suspect credits: ${suspects.length}, ${APPLY ? 'corrected' : 'correctable'}: ${corrected}, ` +
    `probable double credits (left for HR): ${duplicates}, not corrected: ${refused}, failed: ${failed}`,
  );
  if (!APPLY && corrected) console.log('  re-run with --apply to write these corrections');
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
