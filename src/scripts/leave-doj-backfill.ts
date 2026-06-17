/**
 * Leave DOJ backfill (CL & SL) — report + safe apply.
 *
 * Purpose: existing employees whose CL/SL was credited based on the PROBATION
 * end date (legacy behavior) need their balance recomputed from the Date of
 * Joining (DOJ), per the leave policy. This script reports the difference and
 * can apply the clean cases.
 *
 * Run from hr-backend/ :
 *   Dry-run (report only), specific employees:
 *     npx ts-node src/scripts/leave-doj-backfill.ts 123 456
 *   Dry-run, all active employees:
 *     npx ts-node src/scripts/leave-doj-backfill.ts --all
 *   Apply (allocate the CLEAN-ALLOCATE rows):
 *     npx ts-node src/scripts/leave-doj-backfill.ts 123 456 --apply
 *
 * Safety:
 *   - DRY-RUN by default. Nothing is written unless --apply is passed.
 *   - Only "CLEAN-ALLOCATE" rows (current-FY joiner, no existing SYSTEM
 *     OPENING_BALANCE for the FY) are allocated on --apply.
 *   - "NEEDS-MANUAL-ADJ" rows (already have a system opening balance) are NOT
 *     touched — correct them via the Manual Leave Balance Adjustment option so
 *     the existing ledger history is preserved.
 */

import 'dotenv/config';
import { prisma } from '../lib/prisma';
import {
  getNewJoineeEntitlement,
  allocateNewJoineeLeave,
  getFinancialYear,
} from '../api/leave/leave.controller';

async function getLeaveTypeId(name: string) {
  const lt = await prisma.leaveType.findFirst({ where: { name } });
  if (!lt) throw new Error(`Leave type "${name}" not found`);
  return lt.id;
}

async function currentBalance(employeeId: number, leaveTypeId: number, year: number) {
  const last = await prisma.leaveLedger.findFirst({
    where: { employeeId, leaveTypeId, year },
    orderBy: { id: 'desc' },
    select: { balanceAfter: true },
  });
  return last?.balanceAfter ?? null;
}

async function hasSystemOpening(employeeId: number, leaveTypeId: number, year: number) {
  const row = await prisma.leaveLedger.findFirst({
    where: { employeeId, leaveTypeId, year, action: 'OPENING_BALANCE', source: 'SYSTEM' },
    select: { id: true },
  });
  return !!row;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const all = args.includes('--all');
  const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);

  if (!all && ids.length === 0) {
    console.error('Usage: ts-node src/scripts/leave-doj-backfill.ts <empId...> [--apply]');
    console.error('   or: ts-node src/scripts/leave-doj-backfill.ts --all [--apply]');
    process.exit(1);
  }

  const today = new Date();
  const currentFY = getFinancialYear(today);

  const clId = await getLeaveTypeId('CL');
  const slId = await getLeaveTypeId('SL');

  const employees = await prisma.employee.findMany({
    where: {
      employmentStatus: 'ACTIVE',
      ...(all ? {} : { id: { in: ids } }),
    },
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      dateOfJoining: true,
    },
    orderBy: { id: 'asc' },
  });

  console.log(
    `\nLeave DOJ backfill — FY ${currentFY}, mode=${apply ? 'APPLY' : 'DRY-RUN'}, ` +
    `${employees.length} employee(s)\n`
  );

  const cleanToApply: { id: number; doj: Date }[] = [];

  for (const emp of employees) {
    const doj = new Date(emp.dateOfJoining as Date);
    const joinFY = getFinancialYear(doj);

    // Target for the current FY: prorated from DOJ if they joined this FY,
    // otherwise a full year (earlier joiners should already be on the rollover).
    let targetCL: number;
    let targetSL: number;
    if (joinFY === currentFY) {
      const ent = getNewJoineeEntitlement(doj);
      targetCL = ent.cl;
      targetSL = ent.sl;
    } else {
      targetCL = 12;
      targetSL = 12;
    }

    const [curCL, curSL, openCL, openSL] = await Promise.all([
      currentBalance(emp.id, clId, currentFY),
      currentBalance(emp.id, slId, currentFY),
      hasSystemOpening(emp.id, clId, currentFY),
      hasSystemOpening(emp.id, slId, currentFY),
    ]);

    const name = `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim();
    const alreadyAllocated = openCL || openSL;
    const cleanCase = !alreadyAllocated && joinFY === currentFY;
    const status = alreadyAllocated
      ? 'NEEDS-MANUAL-ADJ'
      : cleanCase
        ? 'CLEAN-ALLOCATE'
        : 'REVIEW';

    console.log(
      `#${emp.id} ${emp.employeeCode ?? '-'} ${name} | DOJ ${doj.toISOString().slice(0, 10)} | ` +
      `CL ${curCL ?? '-'}→${targetCL} | SL ${curSL ?? '-'}→${targetSL} | ${status}`
    );

    if (cleanCase) cleanToApply.push({ id: emp.id, doj });
  }

  if (apply) {
    console.log(`\nApplying clean allocations for ${cleanToApply.length} employee(s)...`);
    for (const e of cleanToApply) {
      const r = await allocateNewJoineeLeave(e.id, e.doj);
      console.log(`  ✅ emp ${e.id}: CL=${r.cl} SL=${r.sl}`);
    }
    console.log(
      '\nNEEDS-MANUAL-ADJ / REVIEW employees were NOT modified. Correct them via the ' +
      'Manual Leave Balance Adjustment option so existing ledger history is preserved.'
    );
  } else {
    console.log(
      `\nDRY-RUN only. ${cleanToApply.length} employee(s) would be allocated on --apply. ` +
      'No data was changed.'
    );
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('crashed:', e);
  process.exit(1);
});
