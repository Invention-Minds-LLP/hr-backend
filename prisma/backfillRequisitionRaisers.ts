/**
 * One-off backfill script.
 *
 * Populates the new strong-FK columns on `ManpowerRequisition`
 *   - raisedByEmployeeId
 *   - approvedByHoDEmpId
 *   - approvedBySMOEmpId
 *   - receivedByHREmpId
 *
 * by looking up matches against the legacy display-name columns
 * (`raisedBy`, `approvedByHoD`, `approvedBySMO`, `receivedByHR`).
 *
 * Match strategy (in order of confidence):
 *   1. Case-insensitive equality on full name "First Last"
 *   2. Case-insensitive equality on first name only (when uniquely identifying)
 *   3. Skip — leaves the FK NULL and reports it
 *
 * Safe to re-run: it never overwrites a row whose FK is already populated.
 *
 * Run with:
 *    npx ts-node prisma/backfillRequisitionRaisers.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type EmpRow = { id: number; firstName: string; lastName: string };

function buildFullNameMap(employees: EmpRow[]) {
  // full-name → empId   (case-insensitive, trimmed)
  const fullMap = new Map<string, number>();
  // first-name → [empIds]   (so we can detect ambiguity)
  const firstMap = new Map<string, number[]>();

  for (const e of employees) {
    const full = `${e.firstName} ${e.lastName}`.trim().toLowerCase();
    if (!fullMap.has(full)) fullMap.set(full, e.id);

    const first = e.firstName.trim().toLowerCase();
    const arr = firstMap.get(first) ?? [];
    arr.push(e.id);
    firstMap.set(first, arr);
  }
  return { fullMap, firstMap };
}

function resolveEmpId(
  rawName: string | null | undefined,
  maps: { fullMap: Map<string, number>; firstMap: Map<string, number[]> },
): { id: number | null; reason: string } {
  if (!rawName) return { id: null, reason: 'empty' };
  const cleaned = String(rawName).trim().toLowerCase();
  if (!cleaned) return { id: null, reason: 'empty' };

  // 1. Full-name exact
  const fullHit = maps.fullMap.get(cleaned);
  if (fullHit) return { id: fullHit, reason: 'full-name match' };

  // 2. First name (only when unambiguous)
  const firstHits = maps.firstMap.get(cleaned);
  if (firstHits && firstHits.length === 1) {
    return { id: firstHits[0], reason: 'first-name unique match' };
  }
  if (firstHits && firstHits.length > 1) {
    return { id: null, reason: `first-name ambiguous (${firstHits.length} candidates)` };
  }

  return { id: null, reason: 'no match' };
}

async function main() {
  console.log("\n──────────────────────────────────────────────");
  console.log("🔄 Backfilling ManpowerRequisition employee FKs...");
  console.log("──────────────────────────────────────────────\n");

  const employees = await prisma.employee.findMany({
    select: { id: true, firstName: true, lastName: true },
  });
  console.log(`Loaded ${employees.length} employees for matching.`);
  const maps = buildFullNameMap(employees);

  // Pull only requisitions that still have at least one missing FK we could fill.
  const reqs = await prisma.manpowerRequisition.findMany({
    where: {
      OR: [
        { raisedByEmployeeId: null,  raisedBy:      { not: null } },
        { approvedByHoDEmpId: null,  approvedByHoD: { not: null } },
        { approvedBySMOEmpId: null,  approvedBySMO: { not: null } },
        { receivedByHREmpId:  null,  receivedByHR:  { not: null } },
      ],
    },
    select: {
      id: true,
      raisedBy: true,            raisedByEmployeeId: true,
      approvedByHoD: true,       approvedByHoDEmpId: true,
      approvedBySMO: true,       approvedBySMOEmpId: true,
      receivedByHR: true,        receivedByHREmpId:  true,
    },
  });

  console.log(`Found ${reqs.length} requisition(s) with at least one missing FK.\n`);

  const summary = {
    updatedRows: 0,
    raisedFilled: 0,
    hodFilled: 0,
    smoFilled: 0,
    hrFilled: 0,
    unresolved: [] as { id: number; field: string; value: string; reason: string }[],
  };

  for (const r of reqs) {
    const data: Record<string, number> = {};

    const checks: { field: 'raisedBy' | 'approvedByHoD' | 'approvedBySMO' | 'receivedByHR'; idField: keyof typeof data; existingId: number | null; }[] = [
      { field: 'raisedBy',      idField: 'raisedByEmployeeId', existingId: r.raisedByEmployeeId },
      { field: 'approvedByHoD', idField: 'approvedByHoDEmpId', existingId: r.approvedByHoDEmpId },
      { field: 'approvedBySMO', idField: 'approvedBySMOEmpId', existingId: r.approvedBySMOEmpId },
      { field: 'receivedByHR',  idField: 'receivedByHREmpId',  existingId: r.receivedByHREmpId  },
    ];

    for (const c of checks) {
      if (c.existingId) continue;                             // already populated, skip
      const name = (r as any)[c.field] as string | null | undefined;
      if (!name) continue;
      const { id, reason } = resolveEmpId(name, maps);
      if (id) {
        data[c.idField] = id;
        if (c.field === 'raisedBy')      summary.raisedFilled++;
        if (c.field === 'approvedByHoD') summary.hodFilled++;
        if (c.field === 'approvedBySMO') summary.smoFilled++;
        if (c.field === 'receivedByHR')  summary.hrFilled++;
      } else {
        summary.unresolved.push({ id: r.id, field: c.field, value: name, reason });
      }
    }

    if (Object.keys(data).length) {
      await prisma.manpowerRequisition.update({
        where: { id: r.id },
        data,
      });
      summary.updatedRows++;
    }
  }

  console.log("\n──────────────────────────────────────────────");
  console.log(`✅ Updated ${summary.updatedRows} row(s).`);
  console.log(`   raisedByEmployeeId  filled: ${summary.raisedFilled}`);
  console.log(`   approvedByHoDEmpId  filled: ${summary.hodFilled}`);
  console.log(`   approvedBySMOEmpId  filled: ${summary.smoFilled}`);
  console.log(`   receivedByHREmpId   filled: ${summary.hrFilled}`);
  console.log(`   Unresolved entries: ${summary.unresolved.length}`);
  if (summary.unresolved.length) {
    console.log("\n⚠️  Sample unresolved (review manually):");
    for (const u of summary.unresolved.slice(0, 20)) {
      console.log(`   req#${u.id}  ${u.field}="${u.value}"  → ${u.reason}`);
    }
    if (summary.unresolved.length > 20) {
      console.log(`   ...and ${summary.unresolved.length - 20} more.`);
    }
  }
  console.log("──────────────────────────────────────────────\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
