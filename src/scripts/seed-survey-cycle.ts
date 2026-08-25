/**
 * Seeds the first Employee Satisfaction Survey cycle.
 *
 * The client asked for 1–5 September 2026, repeating every six months, with
 * employees who joined in the 15 days before the start date left out. Only the
 * FIRST cycle needs seeding — closing a cycle schedules its successor
 * automatically (see src/schedulers/survey-cycle.scheduler.ts).
 *
 *   npm run seed:survey-cycle
 *
 * Idempotent: re-running reports the existing cycle instead of creating a
 * second one. Prints the eligible/excluded split so HR can sanity-check the
 * 15-day rule before the window opens.
 */
import { prisma } from "../lib/prisma";
import { excludedEmployees } from "../schedulers/survey-cycle.scheduler";

const START = new Date(2026, 8, 1); // 1 Sep 2026, local time
const END = new Date(2026, 8, 5);
const EXCLUSION_DAYS = 15;
const RECURRENCE_MONTHS = 6;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

const fmt = (d: Date) => new Date(d).toLocaleDateString("en-IN");

async function main() {
  const startDate = startOfDay(START);
  const endDate = endOfDay(END);

  const existing = await prisma.surveyCycle.findFirst({
    where: { startDate: { gte: startDate, lte: endOfDay(startDate) } },
  });

  const cycle =
    existing ??
    (await prisma.surveyCycle.create({
      data: {
        name: "Employee Satisfaction Survey — Sep 2026",
        startDate,
        endDate,
        status: "SCHEDULED",
        exclusionDays: EXCLUSION_DAYS,
        recurrenceMonths: RECURRENCE_MONTHS,
      },
    }));

  console.log(existing ? "Cycle already exists:" : "Cycle created:");
  console.log(`  #${cycle.id}  ${cycle.name}`);
  console.log(`  window     : ${fmt(cycle.startDate)} → ${fmt(cycle.endDate)}`);
  console.log(`  status     : ${cycle.status}`);
  console.log(`  exclusion  : joined within ${cycle.exclusionDays} days before start`);
  console.log(`  repeats    : every ${cycle.recurrenceMonths} months`);

  // Dry-run of the eligibility rule, so the split can be checked before the
  // window opens rather than discovered afterwards.
  const cutoff = new Date(startOfDay(cycle.startDate).getTime() - cycle.exclusionDays * 86400000);
  const eligible = await prisma.employee.count({
    where: { employmentStatus: "ACTIVE", dateOfJoining: { lte: endOfDay(cutoff) } },
  });
  const excluded = await excludedEmployees(cycle.startDate, cycle.exclusionDays);

  console.log(`\nEligibility as of today (joining cut-off ${fmt(cutoff)}):`);
  console.log(`  eligible   : ${eligible} active employee(s)`);
  console.log(`  excluded   : ${excluded.length} recent joiner(s)`);
  for (const e of excluded) {
    console.log(`     - ${e.employeeCode} ${e.firstName} ${e.lastName} (joined ${fmt(e.dateOfJoining)})`);
  }
  console.log(
    `\nNothing is assigned yet — the scheduler opens this cycle on ${fmt(cycle.startDate)}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
