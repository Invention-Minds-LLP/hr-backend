// One-off: usedOn on a consumed comp-off credit used to be stamped with the
// approval instant (new Date()) instead of the leave day it was consumed for.
// Rewrite it from the linked LeaveRequest.startDate.
//   npm run fix:compoff-usedon            (dry run)
//   npm run fix:compoff-usedon -- --apply
import { prisma } from '../lib/prisma';

const APPLY = process.argv.includes('--apply');

const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : 'null');

async function main() {
  console.log(APPLY ? '── Applying ──' : '── DRY RUN ──');

  const credits = await prisma.compOffCredit.findMany({
    where: { used: true, leaveId: { not: null } },
    select: { id: true, employeeId: true, leaveId: true, usedOn: true },
    orderBy: { id: 'asc' },
  });

  const leaveIds = [...new Set(credits.map(c => c.leaveId).filter((id): id is number => !!id))];
  const leaves = await prisma.leaveRequest.findMany({
    where: { id: { in: leaveIds } },
    select: { id: true, startDate: true },
  });
  const startById = new Map(leaves.map(l => [l.id, l.startDate]));

  let changed = 0;
  let orphaned = 0;

  for (const c of credits) {
    const start = startById.get(c.leaveId!);
    if (!start) {
      orphaned++;
      console.log(`  credit #${c.id} emp ${c.employeeId}: leave #${c.leaveId} not found — skipped`);
      continue;
    }
    if (c.usedOn && c.usedOn.getTime() === start.getTime()) continue;

    changed++;
    console.log(`  credit #${c.id} emp ${c.employeeId}: usedOn ${d(c.usedOn)} → ${d(start)} (leave #${c.leaveId})`);
    if (APPLY) {
      await prisma.compOffCredit.update({ where: { id: c.id }, data: { usedOn: start } });
    }
  }

  const noLink = await prisma.compOffCredit.count({ where: { used: true, leaveId: null } });

  console.log(`\n  used credits with a linked leave: ${credits.length}`);
  console.log(`  ${APPLY ? 'corrected' : 'would correct'}: ${changed}`);
  if (orphaned) console.log(`  linked leave missing: ${orphaned}`);
  console.log(`  used credits with no leaveId (left untouched, unrecoverable): ${noLink}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
