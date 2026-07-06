/**
 * One-shot fix — for every APPROVED weekly report, flip any task still left
 * IN_PROGRESS to COMPLETED. Report id 27 is explicitly excluded.
 *
 * Run from the repo root (or `node dist/scripts/...` inside the container):
 *   npx ts-node src/scripts/complete-approved-report-tasks.ts          # DRY RUN (no writes)
 *   npx ts-node src/scripts/complete-approved-report-tasks.ts --apply  # actually update
 */

import 'dotenv/config';
import { prisma } from '../lib/prisma';

const EXCLUDE_REPORT_ID = 27;

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`[complete-tasks] ${apply ? 'APPLY' : 'DRY RUN'} — scanning IN_PROGRESS tasks under APPROVED reports (excluding report #${EXCLUDE_REPORT_ID})…`);

  const tasks = await prisma.weeklyTaskEntry.findMany({
    where: {
      taskStatus: 'IN_PROGRESS',
      report: { status: 'APPROVED', id: { not: EXCLUDE_REPORT_ID } },
    },
    select: { id: true, reportId: true, taskDescription: true },
    orderBy: { id: 'asc' },
  });

  for (const t of tasks) {
    console.log(`  task #${t.id} (report #${t.reportId}): ${(t.taskDescription ?? '').slice(0, 60)}`);
  }
  console.log(`[complete-tasks] ${tasks.length} task(s) match.`);

  if (apply && tasks.length) {
    const r = await prisma.weeklyTaskEntry.updateMany({
      where: { id: { in: tasks.map(t => t.id) } },
      data: { taskStatus: 'COMPLETED' },
    });
    console.log(`[complete-tasks] updated ${r.count} task(s) → COMPLETED.`);
  } else if (!apply) {
    console.log('[complete-tasks] DRY RUN only — re-run with --apply to write changes.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
