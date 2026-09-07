/**
 * Which managerial appraisals belong to people who don't manage anyone.
 *
 * Managerial appraisal is now for employees with direct reports; everyone else
 * is appraised through the Dept Performance Indicator. That rule is enforced
 * when an appraisal is CREATED — see managerIdsAmong / createAppraisalsForEmployees
 * — and deliberately not on the read or submit paths, so forms assigned before
 * the rule existed keep working to the end of their cycle.
 *
 * This lists those pre-existing forms so you can decide what to do with each:
 * leave it to finish, or archive it and assign a Dept Performance Indicator
 * instead. It changes nothing.
 *
 * "Manages someone" is decided by direct reports (Employee.reportingManager),
 * not by role name — the Role table holds both "Incharge" and "Incharges", so
 * a name check would misclassify people.
 *
 * Run from hr-backend/:
 *   npx ts-node src/scripts/appraisal-audience-audit.ts
 */

import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { managerIdsAmong } from '../api/appraisal/appraisal.controller';

async function main() {
  const forms = await prisma.appraisalForm.findMany({
    where: { archivedAt: null },
    select: {
      id: true, employeeId: true, cycle: true, status: true, managerId: true,
      selfAppraisalSubmittedAt: true,
      inchargeAppraisalSubmittedAt: true,
      managerAppraisalSubmittedAt: true,
      managementAppraisalSubmittedAt: true,
      hrApprovedAt: true,
      employee: {
        select: {
          id: true, employeeCode: true, firstName: true, lastName: true,
          employmentStatus: true,
          role: { select: { id: true, name: true } },
          Department: { select: { name: true } },
        },
      },
    },
    orderBy: [{ employeeId: 'asc' }, { id: 'asc' }],
  });

  if (!forms.length) {
    console.log('No active managerial appraisals at all.');
    return;
  }

  const subjectIds = [...new Set(forms.map((f) => f.employeeId))];
  const managers = await managerIdsAmong(subjectIds);

  // How many active reports each subject has, so the output says why.
  const reportCounts = await prisma.employee.groupBy({
    by: ['reportingManager'],
    where: { reportingManager: { in: subjectIds }, employmentStatus: 'ACTIVE' },
    _count: { _all: true },
  });
  const reportsBy = new Map(
    reportCounts
      .filter((r) => r.reportingManager != null)
      .map((r) => [r.reportingManager as number, r._count._all]),
  );

  const misfiled = forms.filter((f) => !managers.has(f.employeeId));

  console.log(`Active managerial appraisals: ${forms.length}`);
  console.log(`Subjects who manage someone:  ${managers.size} of ${subjectIds.length}`);
  console.log(`Assigned to non-managers:     ${misfiled.length}\n`);

  if (!misfiled.length) {
    console.log('Every managerial appraisal belongs to someone with direct reports.');
    return;
  }

  console.log('These were assigned before the manager-only rule. They still work —');
  console.log('nothing on the fill/submit/review path checks direct reports.\n');

  for (const f of misfiled) {
    const e = f.employee;
    const who = `${e?.employeeCode ?? '-'} ${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim();
    const stage = [
      f.selfAppraisalSubmittedAt ? 'self' : null,
      f.inchargeAppraisalSubmittedAt ? 'incharge' : null,
      f.managerAppraisalSubmittedAt ? 'manager' : null,
      f.managementAppraisalSubmittedAt ? 'mgmt' : null,
      f.hrApprovedAt ? 'hr-approved' : null,
    ].filter(Boolean).join('+') || 'nothing submitted';

    console.log(
      `  form #${String(f.id).padEnd(5)} emp ${String(f.employeeId).padEnd(4)} ${who.padEnd(26)}` +
      ` ${(e?.role?.name ?? '-').padEnd(18)} ${(e?.Department?.name ?? '-').padEnd(16)}`,
    );
    console.log(
      `        cycle ${f.cycle.padEnd(26)} status ${String(f.status).padEnd(12)} ` +
      `reports ${reportsBy.get(f.employeeId) ?? 0}  [${stage}]`,
    );
  }

  // Does the same person also have a Dept Performance Indicator? That is the
  // case to look at first — two appraisals running for one person at once.
  const summaries = await prisma.performanceSummary.findMany({
    where: { employeeId: { in: misfiled.map((f) => f.employeeId) }, archivedAt: null },
    select: { employeeId: true, cycle: true, period: true },
  });
  const both = new Map<number, number>();
  for (const s of summaries) both.set(s.employeeId, (both.get(s.employeeId) ?? 0) + 1);

  console.log();
  if (!both.size) {
    console.log('None of them also has a Dept Performance Indicator assigned.');
  } else {
    console.log('Also has a Dept Performance Indicator — running in both modules:');
    for (const [empId, n] of both) {
      const f = misfiled.find((x) => x.employeeId === empId);
      const e = f?.employee;
      console.log(
        `  emp ${String(empId).padEnd(4)} ${`${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim().padEnd(24)}` +
        ` ${n} indicator period(s)`,
      );
    }
    console.log('\nThese people will see two self-appraisals in the Individual module.');
  }
}

main()
  .catch((e) => {
    console.error('Audit failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
