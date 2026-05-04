/**
 * One-off backfill script.
 *
 * Reads the legacy `Interview.panelUserIds` CSV column and creates matching
 * `InterviewPanelMember` rows. Safe to re-run — it skips rows that already
 * have entries in the junction table.
 *
 * Run with:
 *    npx ts-node prisma/backfillInterviewPanelMembers.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("\n──────────────────────────────────────────────");
  console.log("🔄 Backfilling InterviewPanelMember from legacy CSV...");
  console.log("──────────────────────────────────────────────\n");

  // Pull every interview that has a non-empty CSV
  const interviews = await prisma.interview.findMany({
    where: {
      panelUserIds: { not: null },
      NOT: { panelUserIds: "" },
    },
    select: {
      id: true,
      panelUserIds: true,
      panel: { select: { employeeId: true } }, // existing junction rows (skip these)
    },
  });

  console.log(`Found ${interviews.length} interviews with CSV panel data.\n`);

  let createdRows = 0;
  let skippedInterviews = 0;
  let badIds = 0;

  for (const itv of interviews) {
    const csvIds = String(itv.panelUserIds ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

    // Skip entirely if junction is already populated and matches the CSV count
    if (itv.panel.length > 0) {
      skippedInterviews++;
      continue;
    }

    if (csvIds.length === 0) continue;

    // Verify the employees actually exist (CSV could contain stale IDs)
    const existingEmployees = await prisma.employee.findMany({
      where: { id: { in: csvIds } },
      select: { id: true },
    });
    const validIds = new Set(existingEmployees.map((e) => e.id));
    const skippedIds = csvIds.filter((id) => !validIds.has(id));
    badIds += skippedIds.length;

    if (skippedIds.length) {
      console.log(`   Interview #${itv.id}: skipped ${skippedIds.length} unknown IDs ${JSON.stringify(skippedIds)}`);
    }

    // Insert junction rows; createMany w/ skipDuplicates avoids the unique key
    const rows = [...validIds].map((employeeId) => ({
      interviewId: itv.id,
      employeeId,
    }));

    if (rows.length) {
      const result = await prisma.interviewPanelMember.createMany({
        data: rows,
        skipDuplicates: true,
      });
      createdRows += result.count;
      console.log(`   ✓ Interview #${itv.id}: inserted ${result.count} panel rows`);
    }
  }

  console.log("\n──────────────────────────────────────────────");
  console.log(`✅ Backfill complete`);
  console.log(`   Interviews scanned:   ${interviews.length}`);
  console.log(`   Skipped (already done): ${skippedInterviews}`);
  console.log(`   Junction rows created: ${createdRows}`);
  console.log(`   Stale/unknown IDs ignored: ${badIds}`);
  console.log("──────────────────────────────────────────────\n");
}

main()
  .catch((e) => {
    console.error("❌ Backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
