/**
 * Read-only report on where the database stands against schema.prisma.
 *
 * Written for the `db push` failure "Duplicate foreign key constraint name
 * 'X_employeeId_fkey'". In MySQL a foreign-key name is unique across the whole
 * database, so when Prisma's diff decides to drop and re-add an FK — which it
 * does for a column that carries both an explicit @@index and a relation — the
 * re-add collides with the constraint that is still in place. The push aborts
 * mid-way, which is why the first question is always "what actually landed?".
 *
 * This ONLY reads: information_schema queries and a table/column existence
 * check. It changes nothing, so it is safe to run on production.
 *
 * Run from hr-backend/:
 *   npx ts-node src/scripts/schema-drift-check.ts
 */

import 'dotenv/config';
import { prisma } from '../lib/prisma';

/** Columns this release adds, so we can see whether the push got that far. */
const EXPECTED_COLUMNS: Array<[string, string]> = [
  ['PerformanceSummary', 'archivedAt'],
  ['PerformanceSummary', 'archivedBy'],
  ['AppraisalForm', 'archivedAt'],
  ['AppraisalForm', 'archivedBy'],
  ['Employee', 'archivedAt'],
  ['Employee', 'archivedBy'],
  ['Job', 'archivedAt'],
  ['Job', 'archivedBy'],
  ['Asset', 'archivedAt'],
  ['Asset', 'archivedBy'],
  ['Announcement', 'archivedAt'],
  ['Announcement', 'archivedBy'],
  ['LetterIssued', 'archivedAt'],
  ['LetterIssued', 'archivedBy'],
];

const EXPECTED_TABLES = ['ArchiveLog'];

/** Tables known to carry both @@index([employeeId]) and a relation on it. */
const FK_SUSPECTS = ['LateLoginLog', 'ShiftApproval', 'PerformanceResponse', 'EmployeeSurvey'];

async function main() {
  const [{ db }] = await prisma.$queryRawUnsafe<Array<{ db: string }>>(
    'SELECT DATABASE() AS db',
  );
  console.log(`Database: ${db}\n`);

  // ── 1. Did this release's objects land? ──────────────────────────────────
  console.log('── New tables ───────────────────────────────────────────────');
  for (const t of EXPECTED_TABLES) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      t,
    );
    console.log(`  ${t.padEnd(24)} ${Number(rows[0].n) ? 'present' : 'MISSING'}`);
  }

  console.log('\n── New columns ──────────────────────────────────────────────');
  let missingCols = 0;
  for (const [table, column] of EXPECTED_COLUMNS) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      table,
      column,
    );
    const ok = Number(rows[0].n) > 0;
    if (!ok) missingCols++;
    console.log(`  ${`${table}.${column}`.padEnd(34)} ${ok ? 'present' : 'MISSING'}`);
  }

  // ── 2. Foreign keys on the tables that collide ───────────────────────────
  console.log('\n── Foreign keys on the suspect tables ───────────────────────');
  for (const t of FK_SUSPECTS) {
    const fks = await prisma.$queryRawUnsafe<
      Array<{ name: string; col: string; refTable: string; refCol: string }>
    >(
      `SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS col,
              k.REFERENCED_TABLE_NAME AS refTable, k.REFERENCED_COLUMN_NAME AS refCol
         FROM information_schema.KEY_COLUMN_USAGE k
        WHERE k.TABLE_SCHEMA = DATABASE()
          AND k.TABLE_NAME = ?
          AND k.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
      t,
    );
    if (!fks.length) {
      console.log(`  ${t.padEnd(22)} NO FOREIGN KEYS  <-- a push may have dropped one`);
      continue;
    }
    console.log(`  ${t}`);
    for (const f of fks) {
      console.log(`      ${f.name.padEnd(42)} ${f.col} -> ${f.refTable}.${f.refCol}`);
    }
  }

  // ── 3. Anything sharing the colliding names, anywhere in the database ────
  console.log('\n── Constraints named *_employeeId_fkey on the suspects ──────');
  const clashes = await prisma.$queryRawUnsafe<
    Array<{ name: string; table: string; type: string }>
  >(
    `SELECT CONSTRAINT_NAME AS name, TABLE_NAME AS \`table\`, CONSTRAINT_TYPE AS type
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND CONSTRAINT_NAME IN (${FK_SUSPECTS.map(() => '?').join(', ')})`,
    ...FK_SUSPECTS.map((t) => `${t}_employeeId_fkey`),
  );
  if (!clashes.length) {
    console.log('  none — the names Prisma wants are free');
  }
  for (const c of clashes) {
    console.log(`  ${c.name.padEnd(42)} on ${c.table} (${c.type})`);
  }

  // ── 4. Tables the schema expects an employee FK on, that have none ───────
  console.log('\n── Any table missing every foreign key (drift left behind) ──');
  const orphans = await prisma.$queryRawUnsafe<Array<{ table: string }>>(
    `SELECT t.TABLE_NAME AS \`table\`
       FROM information_schema.TABLES t
      WHERE t.TABLE_SCHEMA = DATABASE()
        AND t.TABLE_TYPE = 'BASE TABLE'
        AND EXISTS (
              SELECT 1 FROM information_schema.COLUMNS c
               WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA
                 AND c.TABLE_NAME = t.TABLE_NAME
                 AND c.COLUMN_NAME = 'employeeId')
        AND NOT EXISTS (
              SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k
               WHERE k.TABLE_SCHEMA = t.TABLE_SCHEMA
                 AND k.TABLE_NAME = t.TABLE_NAME
                 AND k.COLUMN_NAME = 'employeeId'
                 AND k.REFERENCED_TABLE_NAME IS NOT NULL)
      ORDER BY t.TABLE_NAME`,
  );
  if (!orphans.length) {
    console.log('  none — every table with an employeeId column has an FK on it');
  }
  for (const o of orphans) console.log(`  ${o.table}`);

  // ── 5. Will the pending unique constraints actually apply? ───────────────
  // `db push` warns that these "will fail if there are existing duplicate
  // values" and then asks a yes/no question that only silences the warning —
  // it does not make the duplicates go away. Check before pushing, not after.
  console.log('\n── Duplicates blocking the pending unique constraints ───────');

  const perfDupes = await prisma.$queryRawUnsafe<
    Array<{ employeeId: number; cycle: string; period: string; questionId: number; reviewerRole: string; n: bigint }>
  >(
    `SELECT employeeId, cycle, period, questionId, reviewerRole, COUNT(*) AS n
       FROM PerformanceResponse
      GROUP BY employeeId, cycle, period, questionId, reviewerRole
     HAVING COUNT(*) > 1
      ORDER BY n DESC
      LIMIT 20`,
  ).catch(() => []);

  if (!perfDupes.length) {
    console.log('  PerformanceResponse    clean — the unique constraint will apply');
  } else {
    console.log(`  PerformanceResponse    ${perfDupes.length} duplicate group(s) — the push WILL fail here:`);
    for (const d of perfDupes) {
      console.log(
        `      emp ${String(d.employeeId).padEnd(5)} q${String(d.questionId).padEnd(5)} ` +
        `${String(d.reviewerRole).padEnd(10)} ${d.period} ${d.cycle}  x${Number(d.n)}`,
      );
    }
  }

  const surveyDupes = await prisma.$queryRawUnsafe<
    Array<{ cycleId: number; employeeId: number; n: bigint }>
  >(
    // cycleId is nullable, and MySQL treats NULLs as distinct in a unique
    // index — (NULL, 1) twice does not collide. Only non-null pairs can block.
    `SELECT cycleId, employeeId, COUNT(*) AS n
       FROM EmployeeSurvey
      WHERE cycleId IS NOT NULL
      GROUP BY cycleId, employeeId
     HAVING COUNT(*) > 1
      ORDER BY n DESC
      LIMIT 20`,
  ).catch(() => []);

  if (!surveyDupes.length) {
    console.log('  EmployeeSurvey         clean — the unique constraint will apply');
  } else {
    console.log(`  EmployeeSurvey         ${surveyDupes.length} duplicate group(s) — the push WILL fail here:`);
    for (const d of surveyDupes) {
      console.log(`      cycle ${String(d.cycleId).padEnd(5)} emp ${String(d.employeeId).padEnd(5)} x${Number(d.n)}`);
    }
  }

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(
    missingCols
      ? `${missingCols} of ${EXPECTED_COLUMNS.length} new columns are missing — the push did not finish.`
      : 'All new columns are present.',
  );
}

main()
  .catch((e) => {
    console.error('Drift check failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
