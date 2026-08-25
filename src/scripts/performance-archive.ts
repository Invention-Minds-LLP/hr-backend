/**
 * Retire Dept Performance Indicator rows without deleting them.
 *
 * Rows assigned before the derived cycles went live were created against the
 * old hand-typed cycle strings and no longer line up with the milestones the
 * module now derives from DOJ. They still hold real appraisal history, so they
 * are archived — hidden from the working lists, excluded from the printed
 * sheet, and no longer blocking a fresh assignment for the same period — rather
 * than deleted. HR can still see them with the "Include inactive" toggle, and
 * restore any row from the list.
 *
 * Nothing else is touched: the responses, final reviews and self-appraisals
 * belonging to an archived row stay exactly where they are. Archiving is only a
 * timestamp on PerformanceSummary.
 *
 * Run from hr-backend/:
 *   Dry-run (lists what would be archived, writes nothing):
 *     npx ts-node src/scripts/performance-archive.ts
 *   Apply:
 *     npx ts-node src/scripts/performance-archive.ts --apply
 *
 * Scope (combined with AND; no scope means every active row):
 *     --employee=74                      only this employee
 *     --cycle="APR-2025 TO MAR-2026"     only this cycle
 *     --before=2026-08-24                only rows created before this date
 *     --by=12                            record this employee id as archivedBy
 *
 * Reverse it:
 *     npx ts-node src/scripts/performance-archive.ts --restore --apply [scope]
 */

import 'dotenv/config';
import { prisma } from '../lib/prisma';

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const restore = process.argv.includes('--restore');
  const employeeId = argValue('employee') ? Number(argValue('employee')) : undefined;
  const cycle = argValue('cycle');
  const beforeRaw = argValue('before');
  const archivedBy = argValue('by') ? Number(argValue('by')) : null;

  let before: Date | undefined;
  if (beforeRaw) {
    before = new Date(beforeRaw);
    if (Number.isNaN(before.getTime())) {
      console.error(`❌ --before="${beforeRaw}" is not a date. Use YYYY-MM-DD.`);
      process.exit(1);
    }
  }

  // Archiving looks at active rows; restoring looks at archived ones.
  const scope: any = { archivedAt: restore ? { not: null } : null };
  if (employeeId) scope.employeeId = employeeId;
  if (cycle) scope.cycle = cycle;
  if (before) scope.createdAt = { lt: before };

  const scopeLabel =
    [
      employeeId ? `employee ${employeeId}` : null,
      cycle ? `cycle "${cycle}"` : null,
      before ? `created before ${before.toISOString().slice(0, 10)}` : null,
    ].filter(Boolean).join(', ') || 'EVERY ACTIVE ROW';

  const verb = restore ? 'RESTORE' : 'ARCHIVE';
  console.log(
    apply
      ? `⚠️  APPLY MODE — rows will be ${restore ? 'restored' : 'archived'}.`
      : '🔍 DRY RUN — nothing will be written.',
  );
  console.log(`   action: ${verb}`);
  console.log(`   scope:  ${scopeLabel}\n`);

  const rows = await prisma.performanceSummary.findMany({
    where: scope,
    select: {
      id: true,
      cycle: true,
      period: true,
      createdAt: true,
      archivedAt: true,
      employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
    },
    orderBy: [{ employeeId: 'asc' }, { cycle: 'asc' }, { createdAt: 'asc' }],
  });

  if (!rows.length) {
    console.log(`Nothing to ${restore ? 'restore' : 'archive'}.`);
    return;
  }

  console.log(`WILL ${verb}  (${rows.length} row${rows.length === 1 ? '' : 's'})`);
  for (const r of rows) {
    const who = `${r.employee?.employeeCode ?? '-'} ${r.employee?.firstName ?? ''} ${r.employee?.lastName ?? ''}`.trim();
    console.log(
      `  #${String(r.id).padEnd(5)} emp ${String(r.employee?.id ?? '-').padEnd(4)} ${who.padEnd(28)} ` +
      `${r.cycle.padEnd(26)} ${String(r.period).padEnd(8)} created ${r.createdAt.toISOString().slice(0, 10)}`,
    );
  }

  // What stays put, so it is obvious this is not a delete.
  const ids = rows.map((r) => r.id);
  const keys = rows.map((r) => ({ employeeId: r.employee!.id, cycle: r.cycle, period: r.period }));
  const [responses, finalReviews, selfAppraisals] = await Promise.all([
    prisma.performanceResponse.count({ where: { OR: keys } }),
    prisma.performanceFinalReview.count({
      where: { OR: keys.map((k) => ({ employeeId: k.employeeId, cycle: k.cycle })) },
    }),
    prisma.performanceSelfAppraisal.count({ where: { OR: keys } }),
  ]);
  console.log('\nUNTOUCHED (kept, not deleted)');
  console.log(`  PerformanceResponse        ${responses}`);
  console.log(`  PerformanceFinalReview     ${finalReviews}`);
  console.log(`  PerformanceSelfAppraisal   ${selfAppraisals}`);

  if (!apply) {
    console.log(`\nRe-run with --apply to ${restore ? 'restore' : 'archive'}.`);
    return;
  }

  // Restoring can resurrect a duplicate when a fresh row was assigned for the
  // same milestone in the meantime. Skip those and name them.
  let targets = ids;
  if (restore) {
    const active = await prisma.performanceSummary.findMany({
      where: { OR: keys, archivedAt: null },
      select: { employeeId: true, cycle: true, period: true },
    });
    const taken = new Set(active.map((a) => `${a.employeeId}|${a.cycle}|${a.period}`));
    const blocked = rows.filter((r) => taken.has(`${r.employee!.id}|${r.cycle}|${r.period}`));
    if (blocked.length) {
      console.log('\n⏭️  Skipped — an active row already holds that milestone:');
      for (const b of blocked) console.log(`  #${b.id}  emp ${b.employee!.id}  ${b.cycle}  ${b.period}`);
    }
    targets = rows.filter((r) => !taken.has(`${r.employee!.id}|${r.cycle}|${r.period}`)).map((r) => r.id);
  }

  if (!targets.length) {
    console.log('\nNothing left to write.');
    return;
  }

  const result = await prisma.performanceSummary.updateMany({
    where: { id: { in: targets } },
    data: restore
      ? { archivedAt: null, archivedBy: null }
      : { archivedAt: new Date(), archivedBy },
  });

  console.log(`\n✅ ${restore ? 'Restored' : 'Archived'} ${result.count} PerformanceSummary row(s).`);
  if (!restore) {
    console.log('   They are hidden from the lists and the printed sheet, and no longer block');
    console.log('   a fresh assignment. HR can see them with "Include inactive".');
  }
}

main()
  .catch((e) => {
    console.error('❌ Archive script failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
