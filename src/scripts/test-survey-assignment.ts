/**
 * End-to-end dry run of the survey cycle engine, safe to run against a live DB.
 *
 *   npm run test:survey-assignment
 *
 * Creates a THROWAWAY cycle dated today, walks it through assign → close, and
 * deletes everything it made. Notifications are suppressed throughout, so no
 * employee is messaged and no push is fired.
 *
 * The real Sep-2026 cycle is never touched: it starts in the future, so neither
 * the open query (startDate <= today) nor the close query (endDate < today)
 * can match it. The script asserts that before it finishes.
 */
import { prisma } from "../lib/prisma";
import { openDueCycles, closeFinishedCycles, excludedEmployees } from "../schedulers/survey-cycle.scheduler";

const fmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${expected}, got ${actual}`);
}

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

async function main() {
  const today = new Date();
  const realCycles = await prisma.surveyCycle.findMany({ select: { id: true, status: true } });
  const realIds = new Set(realCycles.map((c) => c.id));

  console.log("Setting up a throwaway cycle dated today...\n");
  const temp = await prisma.surveyCycle.create({
    data: {
      name: "TEST CYCLE — delete me",
      startDate: startOfDay(today),
      endDate: endOfDay(today),
      status: "SCHEDULED",
      exclusionDays: 15,
      recurrenceMonths: 6,
    },
  });
  console.log(`  temp cycle #${temp.id}  ${fmt(temp.startDate)} → ${fmt(temp.endDate)}`);

  try {
    // ── 1. ASSIGNMENT ──────────────────────────────────────────────────────
    console.log("\n1. Assignment (openDueCycles, notifications OFF)\n");

    const activeCount = await prisma.employee.count({ where: { employmentStatus: "ACTIVE" } });
    const excluded = await excludedEmployees(temp.startDate, temp.exclusionDays);
    const expectedAssigned = activeCount - excluded.length;

    const opened = await openDueCycles({ notify: false });

    check("one cycle opened", opened.opened, 1);
    check(`assigned = active(${activeCount}) - excluded(${excluded.length})`, opened.assigned, expectedAssigned);

    const afterOpen = await prisma.surveyCycle.findUnique({ where: { id: temp.id } });
    check("cycle status is now OPEN", afterOpen?.status, "OPEN");

    const assigned = await prisma.employeeSurvey.findMany({
      where: { cycleId: temp.id },
      include: {
        employee: {
          select: { employeeCode: true, firstName: true, lastName: true, dateOfJoining: true },
        },
      },
    });
    check("survey rows created", assigned.length, expectedAssigned);
    check("all created as DRAFT", assigned.every((s) => s.status === "DRAFT"), true);

    console.log("\n  Assigned to:");
    for (const s of assigned) {
      console.log(
        `     ${s.employee.employeeCode}  ${s.employee.firstName} ${s.employee.lastName}` +
        `  (joined ${fmt(s.employee.dateOfJoining)})  survey #${s.id}`,
      );
    }
    if (excluded.length) {
      console.log("\n  Excluded as recent joiners:");
      for (const e of excluded) {
        console.log(`     ${e.employeeCode}  ${e.firstName} ${e.lastName}  (joined ${fmt(e.dateOfJoining)})`);
      }
    } else {
      console.log("\n  Excluded as recent joiners: none");
    }

    // ── 2. IDEMPOTENCE ─────────────────────────────────────────────────────
    console.log("\n2. Re-running must not double-assign\n");
    const again = await openDueCycles({ notify: false });
    check("no cycle re-opened", again.opened, 0);
    const countAfter = await prisma.employeeSurvey.count({ where: { cycleId: temp.id } });
    check("survey count unchanged", countAfter, assigned.length);

    // ── 3. CLOSE + EXPIRY ──────────────────────────────────────────────────
    console.log("\n3. Close after the deadline (closeFinishedCycles)\n");
    // Push the window into the past so the close query matches, exactly as it
    // would on the morning after the real deadline.
    await prisma.surveyCycle.update({
      where: { id: temp.id },
      data: {
        startDate: new Date(startOfDay(today).getTime() - 2 * 86400000),
        endDate: new Date(startOfDay(today).getTime() - 86400000),
      },
    });

    const closed = await closeFinishedCycles({ notify: false });
    check("one cycle closed", closed.closed, 1);
    check("all unsubmitted expired", closed.expired, assigned.length);

    const afterClose = await prisma.surveyCycle.findUnique({ where: { id: temp.id } });
    check("cycle status is now CLOSED", afterClose?.status, "CLOSED");

    const statuses = await prisma.employeeSurvey.groupBy({
      by: ["status"],
      where: { cycleId: temp.id },
      _count: { _all: true },
    });
    check(
      "every survey is EXPIRED",
      statuses.every((s) => s.status === "EXPIRED"),
      true,
    );

    // ── 4. NEXT CYCLE CHAINED ──────────────────────────────────────────────
    console.log("\n4. Next cycle auto-created\n");
    const spawned = await prisma.surveyCycle.findMany({
      where: { id: { notIn: [...realIds, temp.id] } },
    });
    check("exactly one follow-on cycle", spawned.length, 1);
    if (spawned[0]) {
      console.log(`     ${spawned[0].name}  ${fmt(spawned[0].startDate)} → ${fmt(spawned[0].endDate)}`);
      check("it is SCHEDULED", spawned[0].status, "SCHEDULED");
    }

    // ── 5. REAL CYCLE UNTOUCHED ────────────────────────────────────────────
    console.log("\n5. The real Sep-2026 cycle was not touched\n");
    for (const rc of realCycles) {
      const now = await prisma.surveyCycle.findUnique({ where: { id: rc.id } });
      check(`cycle #${rc.id} still ${rc.status}`, now?.status, rc.status);
    }
    const realAssigned = await prisma.employeeSurvey.count({
      where: { cycleId: { in: [...realIds] } },
    });
    check("no surveys assigned to real cycles", realAssigned, 0);
  } finally {
    // ── CLEANUP ──────────────────────────────────────────────────────────────
    console.log("\nCleaning up...");
    const del = await prisma.employeeSurvey.deleteMany({ where: { cycleId: temp.id } });
    const spawned = await prisma.surveyCycle.deleteMany({
      where: { id: { notIn: [...realIds] } },
    });
    console.log(`  deleted ${del.count} survey row(s), ${spawned.count} temp cycle(s)`);
  }

  const leftover = await prisma.employeeSurvey.count({ where: { cycleId: { not: null } } });
  check("no cycle-linked surveys left behind", leftover, 0);

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed — assignment works end to end");
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
