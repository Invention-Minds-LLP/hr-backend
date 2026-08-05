import { Response } from "express";
import { prisma } from "../../lib/prisma";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { PERMISSION_CATALOG, PERMISSION_KEYS } from "../../lib/permissions";
import { resolvePermissions } from "../../lib/permissionResolver";

/**
 * Role Permissions admin API — the backing service for the checkbox matrix.
 *
 * Every route here is gated on `masters.permissions.manage`, which is the
 * narrowest grant in the catalog: holding it means being able to grant yourself
 * anything else.
 */

/** Catalog + every role's current grants, in one payload for the matrix. */
export const getMatrix = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [permissions, roles] = await Promise.all([
      prisma.permission.findMany({
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, name: true, label: true, module: true },
      }),
      prisma.role.findMany({
        orderBy: { id: "asc" },
        select: { id: true, name: true, permissions: { select: { name: true } } },
      }),
    ]);

    // An unseeded catalog would render an empty grid with no explanation.
    if (permissions.length === 0) {
      return res.status(409).json({
        error: "Permission catalog is empty. Run `npm run seed:permissions` first.",
        code: "CATALOG_NOT_SEEDED",
      });
    }

    return res.json({
      permissions,
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        permissions: r.permissions.map((p) => p.name),
      })),
    });
  } catch (error) {
    console.error("[access] getMatrix failed:", error);
    return res.status(500).json({ error: "Failed to load permission matrix" });
  }
};

/** Replace one role's grants wholesale. Body: { permissions: string[] } */
export const setRolePermissions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const roleId = Number(req.params.roleId);
    if (!roleId) return res.status(400).json({ error: "Invalid roleId" });

    const requested: unknown = req.body?.permissions;
    if (!Array.isArray(requested)) {
      return res.status(400).json({ error: "`permissions` must be an array of keys" });
    }

    // Reject unknown keys rather than silently dropping them — a typo in the
    // client would otherwise look like a successful save that revoked access.
    const unknown = requested.filter((k) => !PERMISSION_KEYS.includes(k as any));
    if (unknown.length) {
      return res.status(400).json({ error: `Unknown permission keys: ${unknown.join(", ")}` });
    }

    const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true } });
    if (!role) return res.status(404).json({ error: "Role not found" });

    const rows = await prisma.permission.findMany({
      where: { name: { in: requested as string[] } },
      select: { id: true },
    });

    await prisma.role.update({
      where: { id: roleId },
      data: { permissions: { set: rows.map((r) => ({ id: r.id })) } },
    });

    console.log(
      `[access] role ${roleId} permissions set to ${rows.length} keys by emp ${req.user?.empId}`,
    );
    return res.json({ roleId, permissions: requested });
  } catch (error) {
    console.error("[access] setRolePermissions failed:", error);
    return res.status(500).json({ error: "Failed to update role permissions" });
  }
};

/**
 * Everyone who deviates from their role. Without this the matrix lies by
 * omission — you'd edit a role and not know five people are exceptions to it.
 */
export const listOverriddenEmployees = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await prisma.employeePermission.findMany({
      orderBy: [{ employeeId: "asc" }],
      select: {
        granted: true,
        note: true,
        permission: { select: { name: true } },
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            role: { select: { name: true } },
            Department: { select: { name: true } },
          },
        },
      },
    });

    const byEmployee = new Map<number, any>();
    for (const row of rows) {
      const e = row.employee;
      if (!byEmployee.has(e.id)) {
        byEmployee.set(e.id, {
          id: e.id,
          name: `${e.firstName} ${e.lastName ?? ""}`.trim(),
          employeeCode: e.employeeCode,
          roleName: e.role?.name ?? null,
          departmentName: e.Department?.name ?? null,
          overrides: [],
        });
      }
      byEmployee.get(e.id).overrides.push({
        name: row.permission.name,
        granted: row.granted,
        note: row.note,
      });
    }

    return res.json({ employees: [...byEmployee.values()] });
  } catch (error) {
    console.error("[access] listOverriddenEmployees failed:", error);
    return res.status(500).json({ error: "Failed to load employee overrides" });
  }
};

/**
 * Employee lookup for the "add exception" picker. Deliberately lives here
 * rather than reusing /api/employees: this module is already gated on
 * `masters.permissions.manage`, and it returns only the few fields the picker
 * shows instead of a full employee record.
 */
export const searchEmployees = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const search = String(req.query.search ?? "").trim();

    const employees = await prisma.employee.findMany({
      where: {
        employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] as any },
        ...(search
          ? {
              OR: [
                { firstName: { contains: search } },
                { lastName: { contains: search } },
                { employeeCode: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { employeeCode: "asc" },
      take: 25,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        role: { select: { name: true } },
        Department: { select: { name: true } },
      },
    });

    return res.json({
      employees: employees.map((e) => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName ?? ""}`.trim(),
        employeeCode: e.employeeCode,
        roleName: e.role?.name ?? null,
        departmentName: e.Department?.name ?? null,
      })),
    });
  } catch (error) {
    console.error("[access] searchEmployees failed:", error);
    return res.status(500).json({ error: "Failed to search employees" });
  }
};

/** One employee's overrides plus what they currently resolve to. */
export const getEmployeeOverrides = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    if (!employeeId) return res.status(400).json({ error: "Invalid employeeId" });

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        role: { select: { id: true, name: true, permissions: { select: { name: true } } } },
        permissionOverrides: {
          select: { granted: true, note: true, permission: { select: { name: true } } },
        },
      },
    });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    return res.json({
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        employeeCode: employee.employeeCode,
        roleId: employee.role?.id ?? null,
        roleName: employee.role?.name ?? null,
      },
      fromRole: employee.role?.permissions.map((p) => p.name) ?? [],
      overrides: employee.permissionOverrides.map((o) => ({
        name: o.permission.name,
        granted: o.granted,
        note: o.note,
      })),
      effective: await resolvePermissions(employeeId),
    });
  } catch (error) {
    console.error("[access] getEmployeeOverrides failed:", error);
    return res.status(500).json({ error: "Failed to load employee overrides" });
  }
};

/**
 * Replace one employee's overrides.
 * Body: { overrides: [{ name: string, granted: boolean, note?: string }] }
 */
export const setEmployeeOverrides = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    if (!employeeId) return res.status(400).json({ error: "Invalid employeeId" });

    const requested: unknown = req.body?.overrides;
    if (!Array.isArray(requested)) {
      return res.status(400).json({ error: "`overrides` must be an array" });
    }

    const items = requested as { name: string; granted: boolean; note?: string }[];
    const unknown = items.filter((o) => !PERMISSION_KEYS.includes(o.name as any));
    if (unknown.length) {
      return res
        .status(400)
        .json({ error: `Unknown permission keys: ${unknown.map((u) => u.name).join(", ")}` });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const ids = new Map(
      (
        await prisma.permission.findMany({
          where: { name: { in: items.map((o) => o.name) } },
          select: { id: true, name: true },
        })
      ).map((p) => [p.name, p.id]),
    );

    // Delete-then-insert inside a transaction so a half-applied save can't leave
    // someone with a partial permission set. Explicit timeouts because the
    // remote DB is slow enough to trip the 5s default.
    await prisma.$transaction(
      async (tx) => {
        await tx.employeePermission.deleteMany({ where: { employeeId } });
        if (items.length) {
          await tx.employeePermission.createMany({
            data: items.map((o) => ({
              employeeId,
              permissionId: ids.get(o.name)!,
              granted: !!o.granted,
              note: o.note ?? null,
              createdBy: Number(req.user?.empId ?? 0) || null,
            })),
            skipDuplicates: true,
          });
        }
      },
      { maxWait: 15000, timeout: 30000 },
    );

    console.log(
      `[access] employee ${employeeId} overrides set to ${items.length} by emp ${req.user?.empId}`,
    );
    return res.json({ employeeId, effective: await resolvePermissions(employeeId) });
  } catch (error) {
    console.error("[access] setEmployeeOverrides failed:", error);
    return res.status(500).json({ error: "Failed to update employee overrides" });
  }
};

/** The code-side catalog — lets the UI show keys that exist but aren't seeded. */
export const getCatalog = async (_req: AuthenticatedRequest, res: Response) => {
  return res.json({ catalog: PERMISSION_CATALOG });
};
