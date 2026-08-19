/**
 * READ-ONLY audit of PerformanceSummary rows. Makes no writes of any kind —
 * there is deliberately no --apply flag.
 *
 * Run from hr-backend/:
 *   npx ts-node src/scripts/performance-period-audit.ts
 *   npx ts-node src/scripts/performance-period-audit.ts --csv > audit.csv
 *
 * Reports three things:
 *
 *  A) DUPLICATE PAIRS — an employee holding several period rows in one cycle
 *     where some are empty and some are filled. This is the signature of the
 *     old bug: HR assigned (say) MONTH_6, the form recomputed the period from
 *     DOJ and decided YEAR_1, then submitted under YEAR_1 — creating a second
 *     row and leaving the assigned one on "Draft" forever.
 *
 *  B) PREMATURE FILLS — a period carrying marks whose milestone date had not
 *     been reached when it was recorded, i.e. performance rated for time the
 *     employee had not yet worked.
 *
 *  C) LEGACY CYCLES — rows whose cycle label matches no cycle derivable from
 *     the employee's DOJ and their department's configured basis. Informational:
 *     these predate derived cycles and are expected to exist.
 *
 * Nothing here decides what to do about any of it — that is a judgement call
 * once you can see the scale.
 */

import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { resolveCyclesForEmployee, findPlan } from '../lib/appraisal-cycle';

const asCsv = process.argv.includes('--csv');

type Row = {
  id: number;
  employeeId: number;
  cycle: string;
  period: string;
  templateId: number | null;
  marksScored: number | null;
  overallPerf: string | null;
  createdAt: Date;
  responses: number;
  filled: boolean;
};

function keyOf(r: { employeeId: number; cycle: string; templateId: number | null }) {
  return `${r.employeeId}|${r.cycle}|${r.templateId ?? 'null'}`;
}

async function main() {
  console.log('READ-ONLY audit — no rows will be modified.\n');

  const summaries = await prisma.performanceSummary.findMany({
    orderBy: [{ employeeId: 'asc' }, { cycle: 'asc' }, { createdAt: 'asc' }],
    include: {
      employee: {
        select: {
          id: true, firstName: true, lastName: true, employeeCode: true,
          dateOfJoining: true, departmentId: true,
          Department: {
            select: {
              name: true,
              appraisalCycleBasis: true,
              appraisalPeriodMonths: true,
              appraisalCalendarMonth: true,
            },
          },
        },
      },
      template: { select: { id: true, title: true } },
    },
  });

  if (!summaries.length) {
    console.log('No PerformanceSummary rows found.');
    return;
  }

  // Response counts keyed by employee+cycle+period — one query, grouped in JS.
  const responses = await prisma.performanceResponse.groupBy({
    by: ['employeeId', 'cycle', 'period'],
    _count: { _all: true },
  });
  const responseCount = new Map<string, number>();
  for (const r of responses) {
    responseCount.set(`${r.employeeId}|${r.cycle}|${r.period}`, r._count._all);
  }

  const empName = new Map<number, string>();
  const rows: Row[] = summaries.map((s) => {
    empName.set(
      s.employeeId,
      `${s.employee?.employeeCode ?? ''} ${s.employee?.firstName ?? ''} ${s.employee?.lastName ?? ''}`.trim()
        || `#${s.employeeId}`,
    );
    const responses = responseCount.get(`${s.employeeId}|${s.cycle}|${s.period}`) ?? 0;
    return {
      id: s.id,
      employeeId: s.employeeId,
      cycle: s.cycle,
      period: s.period as string,
      templateId: s.templateId,
      marksScored: s.marksScored,
      overallPerf: s.overallPerf,
      createdAt: s.createdAt,
      responses,
      filled: s.marksScored != null || !!s.overallPerf || responses > 0,
    };
  });

  // ── A) duplicate pairs ────────────────────────────────────────────────────
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const suspect = [...groups.entries()]
    .filter(([, g]) => g.length > 1 && g.some((r) => r.filled) && g.some((r) => !r.filled));

  console.log('══ A) DUPLICATE PAIRS (empty row + filled row in the same cycle) ══');
  if (!suspect.length) {
    console.log('  None.\n');
  } else {
    console.log(`  ${suspect.length} employee/cycle group(s) affected.\n`);
    for (const [, g] of suspect) {
      console.log(`  ${empName.get(g[0].employeeId)}  ·  cycle "${g[0].cycle}"  ·  template ${g[0].templateId ?? '—'}`);
      for (const r of g) {
        console.log(
          `      id=${String(r.id).padEnd(6)} ${r.period.padEnd(8)}` +
          ` marks=${String(r.marksScored ?? '—').padEnd(5)}` +
          ` perf=${(r.overallPerf ?? '—').padEnd(15)}` +
          ` responses=${String(r.responses).padEnd(4)}` +
          ` ${r.filled ? 'FILLED' : 'empty '}` +
          ` created=${r.createdAt.toISOString().slice(0, 10)}`,
        );
      }
      console.log('');
    }
  }

  // ── B) premature fills + C) legacy cycles ─────────────────────────────────
  // Plans are derived once per employee and reused across their rows.
  const planCache = new Map<number, ReturnType<typeof resolveCyclesForEmployee>>();
  const premature: Array<Row & { milestone: Date }> = [];
  const legacy: Row[] = [];

  for (const s of summaries) {
    const row = rows.find((r) => r.id === s.id)!;
    const doj = s.employee?.dateOfJoining ? new Date(s.employee.dateOfJoining) : null;
    if (!doj) continue;

    if (!planCache.has(s.employeeId)) {
      // Pauses are ignored here on purpose: this is a reporting pass, and
      // including them would need a query per employee.
      planCache.set(s.employeeId, resolveCyclesForEmployee(doj, s.employee?.Department, 0));
    }
    const plan = findPlan(planCache.get(s.employeeId)!, s.cycle);
    if (!plan) {
      legacy.push(row);
      continue;
    }
    const milestone = plan.periods.find((p) => p.period === row.period)?.milestoneDate;
    if (milestone && row.filled && row.createdAt < milestone) {
      premature.push({ ...row, milestone });
    }
  }

  console.log('══ B) PREMATURE FILLS (recorded before the milestone was reached) ══');
  if (!premature.length) {
    console.log('  None.\n');
  } else {
    console.log(`  ${premature.length} row(s).\n`);
    for (const r of premature) {
      console.log(
        `  ${empName.get(r.employeeId)}  id=${r.id}  ${r.period}` +
        `  recorded=${r.createdAt.toISOString().slice(0, 10)}` +
        `  milestone=${r.milestone.toISOString().slice(0, 10)}`,
      );
    }
    console.log('');
  }

  console.log('══ C) LEGACY CYCLE LABELS (no derivable cycle matches) ══');
  const legacyCycles = [...new Set(legacy.map((r) => r.cycle))];
  console.log(`  ${legacy.length} row(s) across ${legacyCycles.length} label(s): ${legacyCycles.join(', ') || '—'}`);
  console.log('  Expected for anything created before cycles were derived — informational only.\n');

  console.log('── SUMMARY ──');
  console.log(`  total summary rows      : ${rows.length}`);
  console.log(`  duplicate-pair groups   : ${suspect.length}`);
  console.log(`  premature fills         : ${premature.length}`);
  console.log(`  legacy-cycle rows       : ${legacy.length}`);

  if (asCsv) {
    console.log('\n--- CSV ---');
    console.log('finding,summaryId,employee,cycle,period,marks,perf,responses,createdAt');
    for (const [, g] of suspect) {
      for (const r of g) {
        console.log(`duplicate,${r.id},"${empName.get(r.employeeId)}","${r.cycle}",${r.period},${r.marksScored ?? ''},${r.overallPerf ?? ''},${r.responses},${r.createdAt.toISOString()}`);
      }
    }
    for (const r of premature) {
      console.log(`premature,${r.id},"${empName.get(r.employeeId)}","${r.cycle}",${r.period},${r.marksScored ?? ''},${r.overallPerf ?? ''},${r.responses},${r.createdAt.toISOString()}`);
    }
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
