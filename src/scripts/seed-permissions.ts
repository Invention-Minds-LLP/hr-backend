/**
 * Seed the permission catalog, wire it to roles, and reconcile every employee.
 *
 * Run:  npm run seed:permissions            (apply)
 *       npm run seed:permissions -- --dry   (report only, writes nothing)
 *
 * Idempotent — safe to re-run after adding keys to PERMISSION_CATALOG.
 *
 * ── Why the reconcile pass exists ───────────────────────────────────────────
 * The phase-1 rules keyed off role AND department AND designation AND empId.
 * A Role→Permission table only knows about role, so a naive seed would quietly
 * change what people see: every Executive would get whatever the "typical"
 * Executive gets, including the HR-department ones who legitimately have more,
 * and the Nurse Educators who legitimately have less.
 *
 * So: seed each role from its MODAL department (the context most of its holders
 * are actually in), then walk every active employee, compare the old computed
 * set against what their role now grants, and write the difference as an
 * EmployeePermission row. Result: nobody's menu changes on the day you deploy,
 * and everything is editable from that day on.
 *
 * Expect a handful of overrides (HR-dept executives, nurse educators, the
 * empId allowlist), not hundreds. The summary prints the count — if it is large,
 * a role is badly seeded and worth splitting rather than papering over.
 */

import { prisma } from "../lib/prisma";
import { PERMISSION_CATALOG, computePermissions, PermissionKey } from "../lib/permissions";

const DRY_RUN = process.argv.includes("--dry");

const ACTIVE_STATUSES = ["ACTIVE", "NOTICE_PERIOD"] as const;

type EmployeeRow = {
  id: number;
  roleId: number;
  departmentId: number;
  role: { name: string } | null;
  designation: { name: string } | null;
  Department: { name: string } | null;
};

/** The department most holders of this role sit in — the fairest default. */
function modalDepartment(rows: EmployeeRow[]): { deptId: number; deptName: string } {
  const tally = new Map<number, { count: number; name: string }>();
  for (const r of rows) {
    const id = Number(r.departmentId ?? 0);
    const entry = tally.get(id) ?? { count: 0, name: r.Department?.name ?? "" };
    entry.count += 1;
    tally.set(id, entry);
  }
  let best = { deptId: 0, deptName: "", count: -1 };
  for (const [deptId, { count, name }] of tally) {
    if (count > best.count) best = { deptId, deptName: name, count };
  }
  return { deptId: best.deptId, deptName: best.deptName };
}

async function main() {
  console.log(DRY_RUN ? "── DRY RUN — nothing will be written ──" : "── Seeding permissions ──");

  // 1. Catalog ---------------------------------------------------------------
  for (const [index, entry] of PERMISSION_CATALOG.entries()) {
    const data = { label: entry.label, module: entry.module, sortOrder: index };
    if (!DRY_RUN) {
      await prisma.permission.upsert({
        where: { name: entry.name },
        create: { name: entry.name, ...data },
        update: data,
      });
    }
  }
  console.log(`Catalog: ${PERMISSION_CATALOG.length} permissions upserted`);

  const permissionIdByName = new Map<string, number>();
  if (!DRY_RUN) {
    for (const p of await prisma.permission.findMany({ select: { id: true, name: true } })) {
      permissionIdByName.set(p.name, p.id);
    }
  }

  // 2. Role grants -----------------------------------------------------------
  const roles = await prisma.role.findMany({ select: { id: true, name: true } });
  const employees = (await prisma.employee.findMany({
    where: { employmentStatus: { in: ACTIVE_STATUSES as any } },
    select: {
      id: true,
      roleId: true,
      departmentId: true,
      role: { select: { name: true } },
      designation: { select: { name: true } },
      Department: { select: { name: true } },
    },
  })) as EmployeeRow[];

  const roleGrants = new Map<number, Set<string>>();

  for (const role of roles) {
    const holders = employees.filter((e) => Number(e.roleId) === role.id);
    const { deptId, deptName } = modalDepartment(holders);

    // Canonical holder of this role: modal department, no special designation,
    // no empId allowlist entry.
    const granted = computePermissions({
      empId: 0,
      roleId: role.id,
      deptId,
      roleName: role.name,
      designation: "",
      departmentName: deptName,
    });
    roleGrants.set(role.id, new Set(granted));

    console.log(
      `Role ${role.id} ${role.name.padEnd(20)} holders=${String(holders.length).padStart(4)} ` +
        `modalDept=${deptId} → ${granted.length} permissions`,
    );

    if (!DRY_RUN) {
      await prisma.role.update({
        where: { id: role.id },
        data: {
          permissions: {
            set: granted.map((name) => ({ id: permissionIdByName.get(name)! })),
          },
        },
      });
    }
  }

  // 3. Per-employee reconciliation ------------------------------------------
  type Diff = { employeeId: number; name: string; granted: boolean };
  const diffs: Diff[] = [];

  for (const emp of employees) {
    const legacy = new Set<string>(
      computePermissions({
        empId: emp.id,
        roleId: Number(emp.roleId ?? 0),
        deptId: Number(emp.departmentId ?? 0),
        roleName: emp.role?.name ?? "",
        designation: emp.designation?.name ?? "",
        departmentName: emp.Department?.name ?? "",
      }) as PermissionKey[],
    );
    const fromRole = roleGrants.get(Number(emp.roleId)) ?? new Set<string>();

    for (const key of legacy) {
      if (!fromRole.has(key)) diffs.push({ employeeId: emp.id, name: key, granted: true });
    }
    for (const key of fromRole) {
      if (!legacy.has(key)) diffs.push({ employeeId: emp.id, name: key, granted: false });
    }
  }

  const affected = new Set(diffs.map((d) => d.employeeId));
  console.log(
    `\nReconcile: ${diffs.length} overrides across ${affected.size} of ${employees.length} employees`,
  );

  if (!DRY_RUN && diffs.length) {
    // Replace this script's previous output wholesale, but only for the
    // employees it is about to rewrite — hand-made overrides for anyone else
    // survive a re-run.
    await prisma.employeePermission.deleteMany({
      where: { employeeId: { in: [...affected] } },
    });

    // Chunked: the remote DB is slow enough that one giant createMany times out.
    const CHUNK = 500;
    const rows = diffs.map((d) => ({
      employeeId: d.employeeId,
      permissionId: permissionIdByName.get(d.name)!,
      granted: d.granted,
      note: "seeded from phase-1 rules",
    }));
    for (let i = 0; i < rows.length; i += CHUNK) {
      await prisma.employeePermission.createMany({
        data: rows.slice(i, i + CHUNK),
        skipDuplicates: true,
      });
      console.log(`  wrote ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
    }
  }

  // 4. Proof: DB-derived set must equal the phase-1 set for every employee ----
  let mismatches = 0;
  if (!DRY_RUN) {
    const overrideByEmp = new Map<number, Map<string, boolean>>();
    for (const row of await prisma.employeePermission.findMany({
      select: { employeeId: true, granted: true, permission: { select: { name: true } } },
    })) {
      const m = overrideByEmp.get(row.employeeId) ?? new Map<string, boolean>();
      m.set(row.permission.name, row.granted);
      overrideByEmp.set(row.employeeId, m);
    }

    for (const emp of employees) {
      const legacy = new Set<string>(
        computePermissions({
          empId: emp.id,
          roleId: Number(emp.roleId ?? 0),
          deptId: Number(emp.departmentId ?? 0),
          roleName: emp.role?.name ?? "",
          designation: emp.designation?.name ?? "",
          departmentName: emp.Department?.name ?? "",
        }) as PermissionKey[],
      );
      const effective = new Set(roleGrants.get(Number(emp.roleId)) ?? []);
      for (const [name, granted] of overrideByEmp.get(emp.id) ?? []) {
        if (granted) effective.add(name);
        else effective.delete(name);
      }
      const same =
        effective.size === legacy.size && [...legacy].every((k) => effective.has(k));
      if (!same) {
        mismatches += 1;
        if (mismatches <= 5) {
          console.error(
            `  MISMATCH emp ${emp.id}: expected [${[...legacy].sort().join(",")}] ` +
              `got [${[...effective].sort().join(",")}]`,
          );
        }
      }
    }
    console.log(
      mismatches === 0
        ? "\nVerified: every active employee resolves to exactly their phase-1 permissions."
        : `\nFAILED: ${mismatches} employees resolve differently than before.`,
    );
  }

  await prisma.$disconnect();
  process.exit(mismatches > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
