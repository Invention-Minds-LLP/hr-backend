/**
 * Clear Dept Performance Indicator test data so the flow can be exercised from
 * "assign" onwards. Templates and their questions are KEPT.
 *
 * Run from hr-backend/:
 *   Dry-run (counts only, deletes nothing):
 *     npx ts-node src/scripts/performance-reset.ts
 *   Destructive (actually delete):
 *     npx ts-node src/scripts/performance-reset.ts --apply
 *
 * Optionally limit the blast radius:
 *     --employee=74            only this employee
 *     --cycle="APR-2026 TO MAR-2027"   only this cycle
 *
 * DELETED
 *   PerformanceResponse              per-question scores
 *   PerformanceSummary               the assigned rows
 *   PerformanceFinalReview           appreciations / talents / comments
 *   PerformanceSelfAppraisal         the indicator's self-appraisal
 *   PerformanceSelfAppraisalAnswer   (cascades from the row above)
 *
 * KEPT
 *   PerformanceFormTemplate + PerformanceQuestion   the templates
 *   SelfAppraisalQuestion                           the 75-question master
 *   AppraisalForm / SelfAppraisal / SelfAppraisalAnswer
 *       the MANAGERIAL appraisal — a different module, never touched here
 */

import 'dotenv/config';
import { prisma } from '../lib/prisma';

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const employeeId = argValue('employee') ? Number(argValue('employee')) : undefined;
  const cycle = argValue('cycle');

  const scope: any = {};
  if (employeeId) scope.employeeId = employeeId;
  if (cycle) scope.cycle = cycle;
  const scopeLabel =
    [employeeId ? `employee ${employeeId}` : null, cycle ? `cycle "${cycle}"` : null]
      .filter(Boolean).join(', ') || 'EVERYTHING';

  console.log(apply ? '⚠️  APPLY MODE — rows will be deleted.' : '🔍 DRY RUN — nothing will be deleted.');
  console.log(`   scope: ${scopeLabel}\n`);

  const [responses, summaries, finalReviews, selfAppraisals] = await Promise.all([
    prisma.performanceResponse.count({ where: scope }),
    prisma.performanceSummary.count({ where: scope }),
    prisma.performanceFinalReview.count({ where: scope }),
    prisma.performanceSelfAppraisal.count({ where: scope }),
  ]);
  const selfAnswers = await prisma.performanceSelfAppraisalAnswer.count({
    where: { selfAppraisal: scope },
  });

  console.log('WILL DELETE');
  console.log(`  PerformanceResponse             ${responses}`);
  console.log(`  PerformanceSummary              ${summaries}`);
  console.log(`  PerformanceFinalReview          ${finalReviews}`);
  console.log(`  PerformanceSelfAppraisal        ${selfAppraisals}`);
  console.log(`  PerformanceSelfAppraisalAnswer  ${selfAnswers}  (cascades)`);

  const [templates, questions, selfQuestions] = await Promise.all([
    prisma.performanceFormTemplate.count(),
    prisma.performanceQuestion.count(),
    prisma.selfAppraisalQuestion.count({ where: { isActive: true } }),
  ]);
  const [forms, mgrSelf, mgrAnswers] = await Promise.all([
    prisma.appraisalForm.count(),
    prisma.selfAppraisal.count(),
    prisma.selfAppraisalAnswer.count(),
  ]);

  console.log('\nWILL KEEP');
  console.log(`  PerformanceFormTemplate         ${templates}`);
  console.log(`  PerformanceQuestion             ${questions}`);
  console.log(`  SelfAppraisalQuestion (active)  ${selfQuestions}`);
  console.log(`  AppraisalForm                   ${forms}   (managerial module)`);
  console.log(`  SelfAppraisal                   ${mgrSelf}   (managerial module)`);
  console.log(`  SelfAppraisalAnswer             ${mgrAnswers}  (managerial module)`);

  if (!apply) {
    console.log('\nRe-run with --apply to delete.');
    return;
  }

  if (!responses && !summaries && !finalReviews && !selfAppraisals) {
    console.log('\nNothing to delete.');
    return;
  }

  // Answers cascade from their parent, so the parent goes last among the
  // self-appraisal pair. Nothing else here references anything else.
  const r1 = await prisma.performanceResponse.deleteMany({ where: scope });
  const r2 = await prisma.performanceFinalReview.deleteMany({ where: scope });
  const r3 = await prisma.performanceSelfAppraisal.deleteMany({ where: scope });
  const r4 = await prisma.performanceSummary.deleteMany({ where: scope });

  console.log('\n✅ Deleted');
  console.log(`  PerformanceResponse       ${r1.count}`);
  console.log(`  PerformanceFinalReview    ${r2.count}`);
  console.log(`  PerformanceSelfAppraisal  ${r3.count}  (answers cascaded)`);
  console.log(`  PerformanceSummary        ${r4.count}`);
  console.log('\nTemplates untouched — assign a fresh appraisal to start testing.');
}

main()
  .catch((e) => {
    console.error('❌ Reset failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
