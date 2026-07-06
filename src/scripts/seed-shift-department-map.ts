/**
 * One-shot seed — populate the new ShiftTemplate ↔ Department mapping from the
 * old hard-coded `getShiftTypeByDepartment` logic, so the manager-shift dialog
 * keeps returning the same shifts per department after the refactor.
 *
 * Old behaviour (department → shiftType):
 *   dept 9 → NURSING,  dept 4 → MOD,  dept 1 → REPORTING_MANAGER,  else → EXECUTIVE
 * So we map each shift to the department(s) whose old type matched:
 *   NURSING shift → dept 9,  MOD → dept 4,  REPORTING_MANAGER → dept 1,
 *   EXECUTIVE → every department except 9/4/1.
 * MORNING/EVENING/NIGHT/FLEXIBLE shifts were never returned to that dialog, so
 * they're left unmapped (admins can map them via the new master multi-select).
 *
 * Run:
 *   npx ts-node src/scripts/seed-shift-department-map.ts          # DRY RUN
 *   npx ts-node src/scripts/seed-shift-department-map.ts --apply  # write
 */

import 'dotenv/config';
import { prisma } from '../lib/prisma';

const DEPT_NURSING = 9;
const DEPT_MOD = 4;
const DEPT_RM = 1;

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`[seed-shift-dept] ${apply ? 'APPLY' : 'DRY RUN'} — mapping shifts to departments…`);

  const allDepts = await prisma.department.findMany({ select: { id: true } });
  const execDeptIds = allDepts.map(d => d.id).filter(id => ![DEPT_NURSING, DEPT_MOD, DEPT_RM].includes(id));

  const shifts = await prisma.shiftTemplate.findMany({
    select: { id: true, name: true, shiftType: true },
    orderBy: { id: 'asc' },
  });

  let mapped = 0;
  let skipped = 0;
  for (const s of shifts) {
    let deptIds: number[] = [];
    switch (s.shiftType) {
      case 'NURSING': deptIds = [DEPT_NURSING]; break;
      case 'MOD': deptIds = [DEPT_MOD]; break;
      case 'REPORTING_MANAGER': deptIds = [DEPT_RM]; break;
      case 'EXECUTIVE': deptIds = execDeptIds; break;
      default: deptIds = []; // MORNING/EVENING/NIGHT/FLEXIBLE — leave unmapped
    }

    if (!deptIds.length) { skipped++; continue; }

    console.log(`[seed-shift-dept] shift #${s.id} "${s.name}" (${s.shiftType}) → depts [${deptIds.join(', ')}]`);
    if (apply) {
      await prisma.shiftTemplate.update({
        where: { id: s.id },
        data: { departments: { set: deptIds.map(id => ({ id })) } },
      });
    }
    mapped++;
  }

  console.log(`[seed-shift-dept] done. mapped=${mapped}, skipped(non-manager types)=${skipped}, total=${shifts.length}`);
  if (!apply) console.log('[seed-shift-dept] DRY RUN only — re-run with --apply to write.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
