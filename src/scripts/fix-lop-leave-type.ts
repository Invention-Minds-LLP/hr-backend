// One-off: flag unpaid leave types and repair requests that were being paid.
//   npm run fix:lop            (dry run)
//   npm run fix:lop -- --apply
import { prisma } from '../lib/prisma';
import { backfillLopTypeRequests, leaveDuration } from '../lib/leaveLop';

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(APPLY ? '── Applying ──' : '── DRY RUN ──');

  // 1. Flag types that are unpaid by definition.
  const types = await prisma.leaveType.findMany({ select: { id: true, name: true, isLop: true } as any });
  const shouldFlag = (types as any[]).filter(t => /^(lop|loss of pay|lwp|leave without pay)$/i.test(t.name) && !t.isLop);
  for (const t of shouldFlag) {
    console.log(`  flag as unpaid: "${t.name}" (id ${t.id})`);
    if (APPLY) await prisma.leaveType.update({ where: { id: t.id }, data: { isLop: true } as any });
  }
  if (!shouldFlag.length) console.log('  no new types to flag');

  // 2. Repair requests on an unpaid type that still carry lopUnits = 0.
  const report = await backfillLopTypeRequests(!APPLY);
  console.log(`\n  requests on an unpaid type with lopUnits = 0: ${report.scanned}`);
  for (const r of report.rows) {
    console.log(`    request #${r.id} emp ${r.employeeId}: ${r.days} day(s) were PAID, now LOP (paidUnits was ${r.wasPaid})`);
  }
  if (APPLY) console.log(`  corrected: ${report.corrected}`);

  const flagged = await prisma.leaveType.findMany({ where: { isLop: true } as any, select: { name: true } });
  console.log(`\n  unpaid leave types now: ${flagged.map(f => f.name).join(', ') || 'none'}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
