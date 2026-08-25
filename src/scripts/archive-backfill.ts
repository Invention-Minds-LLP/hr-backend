/**
 * Write ArchiveLog rows for records that were archived before the central
 * Archive screen existed.
 *
 * Anything retired through lib/archivable.ts writes its log row at the same
 * time, so this only has work to do for records archived earlier — the
 * PerformanceSummary rows retired by scripts/performance-archive.ts before this
 * table was added. Without it, those records are hidden from their module but
 * invisible on the Archive screen, so nobody can restore them from there.
 *
 * It only ever ADDS log rows for records whose own `archivedAt` is already set.
 * It never archives anything, and it deliberately does NOT treat business
 * states as archives: a DEACTIVATED employee, a CLOSED job and a RETIRED asset
 * are facts their modules still show, not retired records.
 *
 * Run from hr-backend/:
 *   Dry-run (default):  npx ts-node src/scripts/archive-backfill.ts
 *   Apply:              npx ts-node src/scripts/archive-backfill.ts --apply
 *   One module:         npx ts-node src/scripts/archive-backfill.ts --module=PERFORMANCE_SUMMARY
 */

import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { ARCHIVE_MODULES, archiveModule } from '../lib/archivable';

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const only = argValue('module');

  if (only && !archiveModule(only)) {
    console.error(`❌ Unknown module "${only}". Known: ${ARCHIVE_MODULES.map((m) => m.key).join(', ')}`);
    process.exit(1);
  }

  const modules = only ? [archiveModule(only)!] : ARCHIVE_MODULES;

  console.log(apply ? '⚠️  APPLY MODE — ArchiveLog rows will be created.' : '🔍 DRY RUN — nothing will be written.');
  console.log(`   modules: ${modules.map((m) => m.key).join(', ')}\n`);

  let totalMissing = 0;
  let totalCreated = 0;

  for (const mod of modules) {
    const delegate = (prisma as any)[mod.delegate];

    const archived = await delegate.findMany({
      where: { archivedAt: { not: null } },
      select: { ...mod.select, archivedAt: true, archivedBy: true },
    });

    if (!archived.length) {
      console.log(`${mod.key.padEnd(22)} nothing archived`);
      continue;
    }

    const existing = await prisma.archiveLog.findMany({
      where: { module: mod.key, recordId: { in: archived.map((r: any) => r.id) } },
      select: { recordId: true },
    });
    const have = new Set(existing.map((e) => e.recordId));
    const missing = archived.filter((r: any) => !have.has(r.id));

    console.log(
      `${mod.key.padEnd(22)} ${String(archived.length).padStart(4)} archived, ` +
      `${String(missing.length).padStart(4)} missing a log row`,
    );
    totalMissing += missing.length;

    for (const r of missing) {
      const { employeeId, label } = mod.describe(r);
      console.log(`    + #${r.id}  ${label || `${mod.label} #${r.id}`}`);
      if (!apply) continue;

      // createMany would be faster, but the labels are built per record anyway
      // and these volumes are small. create, not upsert: the missing set is
      // exactly the records with no row.
      await prisma.archiveLog.create({
        data: {
          module: mod.key,
          recordId: r.id,
          employeeId,
          label: label || `${mod.label} #${r.id}`,
          reason: 'Backfilled — archived before the Archive screen existed',
          archivedAt: r.archivedAt,
          archivedBy: r.archivedBy ?? null,
        },
      });
      totalCreated++;
    }
  }

  console.log();
  if (!totalMissing) {
    console.log('✅ Every archived record already has a log row. Nothing to do.');
    return;
  }
  if (!apply) {
    console.log(`${totalMissing} log row(s) would be created. Re-run with --apply.`);
    return;
  }
  console.log(`✅ Created ${totalCreated} ArchiveLog row(s).`);
}

main()
  .catch((e) => {
    console.error('❌ Backfill failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
