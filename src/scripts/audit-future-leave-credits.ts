// Read-only audit: leave credits posted to a month that had not ended when they
// were written. The manual EL accrual takes a FINANCIAL year, so running it with
// the calendar year for Jan–Mar (e.g. {year: 2026, month: 3} meaning March 2026)
// filed the credit under March 2027. The trigger now refuses such periods; this
// lists the rows already written so HR can decide what to do with each.
//
//   npx ts-node --transpile-only src/scripts/audit-future-leave-credits.ts
//   npx ts-node --transpile-only src/scripts/audit-future-leave-credits.ts --emp=JMRH175
//
// For every suspect credit it also says whether the month one financial year
// EARLIER (the one most likely intended) was credited too:
//   - "also credited"  → the employee probably received this month twice;
//                        HR should reverse one with a balance adjustment.
//   - "not credited"   → the credit was only filed under the wrong year; the
//                        balance is right, only the month label is wrong.
// Nothing is changed by this script.
import { prisma } from '../lib/prisma';
import { getCalendarYear } from '../api/leave/leave.controller';

const EMP_CODE = process.argv.find((a) => a.startsWith('--emp='))?.split('=')[1];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const label = (fy: number, m: number) => `${MONTHS[m - 1]}-${getCalendarYear(fy, m)}`;
const monthEnd = (fy: number, m: number) => new Date(getCalendarYear(fy, m), m, 0, 23, 59, 59);

async function main() {
  console.log('── Audit: credits posted before their month ended (read-only) ──\n');

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
  const suspects = accruals.filter((a) => a.createdAt < monthEnd(a.year, a.month!));

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
  const accrualKey = (e: number, t: number, y: number, m: number) => `${e}|${t}|${y}|${m}`;
  const existing = new Set(accruals.map((a) => accrualKey(a.employeeId, a.leaveTypeId, a.year, a.month!)));

  // `accruals` holds every month-level accrual in scope (all employees, or all
  // of one employee's), so the intended month is in the Set if it was credited.
  let duplicates = 0;
  for (const s of suspects) {
    const intendedFy = s.year - 1;
    const alsoCredited = existing.has(accrualKey(s.employeeId, s.leaveTypeId, intendedFy, s.month!));
    if (alsoCredited) duplicates++;
    console.log(
      `${code.get(s.employeeId) ?? `emp ${s.employeeId}`}  ${typeName.get(s.leaveTypeId) ?? s.leaveTypeId}  ` +
      `${s.daysCredited} day(s) filed under ${label(s.year, s.month!)}, written ${s.createdAt.toISOString().slice(0, 10)}  → ` +
      (alsoCredited
        ? `${label(intendedFy, s.month!)} was ALSO credited — probable double credit`
        : `${label(intendedFy, s.month!)} not credited — wrong label only, balance unaffected`),
    );
  }
  console.log(`\n  suspect credits: ${suspects.length}, probable double credits: ${duplicates}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
