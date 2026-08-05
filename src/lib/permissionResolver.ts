import { prisma } from "./prisma";
import { PERMISSION_KEYS, PermissionKey, computePermissions } from "./permissions";

/**
 * Resolve an employee's effective permissions from the database.
 *
 *   role grants  +  per-employee grants  −  per-employee denies
 *
 * Phase 2 made this the source of truth. `computePermissions()` in
 * permissions.ts survives as (a) the input to the seed script and (b) the
 * fallback below.
 *
 * FALLBACK: if the Permission catalog has never been seeded, every lookup
 * would return an empty set and the whole app would look broken. So an unseeded
 * database falls back to the phase-1 code rules — a deploy that lands before
 * `npm run seed:permissions` degrades to the old behaviour instead of blanking
 * everyone's menu.
 */

// The seeded check runs on every /me/permissions call; cache it. Same 60s TTL
// as the employee-access cache, so a fresh seed takes effect within a minute.
const SEEDED_CACHE_TTL_MS = 60 * 1000;
let seededCache: { value: boolean; expires: number } | null = null;

async function isCatalogSeeded(): Promise<boolean> {
  const now = Date.now();
  if (seededCache && seededCache.expires > now) return seededCache.value;

  const count = await prisma.permission.count();
  const value = count > 0;
  seededCache = { value, expires: now + SEEDED_CACHE_TTL_MS };
  return value;
}

/** Drop the cached "is it seeded" answer — call after seeding or editing. */
export function invalidatePermissionCache(): void {
  seededCache = null;
}

export async function resolvePermissions(empId: number): Promise<PermissionKey[]> {
  if (!empId) return [];

  const employee = await prisma.employee.findUnique({
    where: { id: empId },
    select: {
      roleId: true,
      departmentId: true,
      role: {
        select: {
          name: true,
          permissions: { select: { name: true } },
        },
      },
      designation: { select: { name: true } },
      Department: { select: { name: true } },
      permissionOverrides: {
        select: { granted: true, permission: { select: { name: true } } },
      },
    },
  });

  if (!employee) return [];

  if (!(await isCatalogSeeded())) {
    return computePermissions({
      empId,
      roleId: Number(employee.roleId ?? 0),
      deptId: Number(employee.departmentId ?? 0),
      roleName: employee.role?.name ?? "",
      designation: employee.designation?.name ?? "",
      departmentName: employee.Department?.name ?? "",
    });
  }

  const effective = new Set<string>(employee.role?.permissions.map((p) => p.name) ?? []);
  for (const override of employee.permissionOverrides) {
    if (override.granted) effective.add(override.permission.name);
    else effective.delete(override.permission.name);
  }

  // Filter through the catalog so a key deleted from the code can't linger in
  // the response just because a stale row still names it, and so the order is
  // stable for anyone eyeballing the payload.
  return PERMISSION_KEYS.filter((k) => effective.has(k));
}
