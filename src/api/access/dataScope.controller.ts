import { Response } from "express";
import { prisma } from "../../lib/prisma";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { resolveScope, invalidateScopeCache } from "../../lib/dataScope";

/**
 * Data Scope admin API — the backing service for the "which branches can this
 * person see" screen.
 *
 * Gated on `masters.dataScope.manage`. Narrowing is stored as rows; the absence
 * of rows means global access, so an employee who has never been touched by
 * this screen behaves exactly as they always have.
 *
 * See lib/dataScope.ts for the combining rules (branches OR-ed, departments
 * OR-ed, the two AND-ed).
 */

/** Branches + departments to populate the assignment UI. */
export const getScopeOptions = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [branches, departments] = await Promise.all([
      prisma.branch.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, location: true },
      }),
      prisma.department.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    return res.json({ branches, departments });
  } catch (error) {
    console.error("[dataScope] getScopeOptions failed:", error);
    return res.status(500).json({ error: "Failed to load scope options" });
  }
};

/**
 * Everyone who currently has a scope configured — i.e. everyone who is NOT
 * global. This is the landing list, because the interesting set is always the
 * small number of restricted people, not the whole directory.
 */
export const listScopedEmployees = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await (prisma as any).employeeDataScope.findMany({
      select: {
        employeeId: true,
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            role: { select: { name: true } },
            Branch: { select: { name: true } },
          },
        },
      },
      orderBy: { employeeId: "asc" },
    });

    // Collapse the rows into one entry per employee.
    const byEmployee = new Map<number, any>();
    for (const r of rows) {
      if (!byEmployee.has(r.employeeId)) {
        byEmployee.set(r.employeeId, {
          employeeId: r.employeeId,
          name: `${r.employee?.firstName ?? ""} ${r.employee?.lastName ?? ""}`.trim(),
          employeeCode: r.employee?.employeeCode ?? null,
          roleName: r.employee?.role?.name ?? null,
          ownBranch: r.employee?.Branch?.name ?? null,
          branches: [] as { id: number; name: string }[],
          departments: [] as { id: number; name: string }[],
        });
      }
      const entry = byEmployee.get(r.employeeId);
      if (r.branch) entry.branches.push(r.branch);
      if (r.department) entry.departments.push(r.department);
    }

    return res.json({ employees: [...byEmployee.values()] });
  } catch (error) {
    console.error("[dataScope] listScopedEmployees failed:", error);
    return res.status(500).json({ error: "Failed to load scoped employees" });
  }
};

/** One employee's scope, plus whether they are currently global. */
export const getEmployeeScope = async (req: AuthenticatedRequest, res: Response) => {
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
        branchId: true,
        departmentId: true,
        role: { select: { id: true, name: true } },
        Branch: { select: { id: true, name: true } },
        Department: { select: { id: true, name: true } },
      },
    });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const scope = await resolveScope(employeeId);

    return res.json({
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName ?? ""}`.trim(),
        employeeCode: employee.employeeCode,
        roleName: employee.role?.name ?? null,
        ownBranch: employee.Branch ?? null,
        ownDepartment: employee.Department ?? null,
      },
      // true = sees everyone. The UI shows this prominently, because switching
      // it off is the moment a person starts losing visibility.
      isGlobal: scope.global,
      branchIds: scope.branchIds,
      departmentIds: scope.departmentIds,
    });
  } catch (error) {
    console.error("[dataScope] getEmployeeScope failed:", error);
    return res.status(500).json({ error: "Failed to load employee scope" });
  }
};

/**
 * Replace one employee's scope.
 * Body: { branchIds: number[], departmentIds: number[] }
 *
 * Sending both arrays empty CLEARS the scope, which restores global access.
 * That is the documented way to undo an isolation, so it is allowed — but it
 * widens access, so it is logged like a grant.
 */
export const setEmployeeScope = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    if (!employeeId) return res.status(400).json({ error: "Invalid employeeId" });

    const rawBranches: unknown = req.body?.branchIds;
    const rawDepartments: unknown = req.body?.departmentIds;
    if (!Array.isArray(rawBranches) || !Array.isArray(rawDepartments)) {
      return res
        .status(400)
        .json({ error: "`branchIds` and `departmentIds` must both be arrays" });
    }

    // Dedupe — the unique indexes would reject repeats anyway, and a repeated
    // id in the payload is a UI bug, not something to fail the save over.
    const branchIds = [...new Set(rawBranches.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const departmentIds = [...new Set(rawDepartments.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    // Validate the targets exist before writing. Without this a typo'd id
    // silently produces a scope that matches nothing and locks the person out
    // of everything — which looks like a bug in the app, not a bad input.
    if (branchIds.length) {
      const found = await prisma.branch.count({ where: { id: { in: branchIds } } });
      if (found !== branchIds.length) {
        return res.status(400).json({ error: "One or more branchIds do not exist" });
      }
    }
    if (departmentIds.length) {
      const found = await prisma.department.count({ where: { id: { in: departmentIds } } });
      if (found !== departmentIds.length) {
        return res.status(400).json({ error: "One or more departmentIds do not exist" });
      }
    }

    const grantedBy = Number(req.user?.empId ?? 0) || null;

    // Delete-then-insert in a transaction so a failed save can't leave a
    // half-written scope — which would silently be a DIFFERENT scope, not an
    // obviously broken one. Explicit timeouts because the remote DB trips the
    // 5s default.
    await prisma.$transaction(
      async (tx) => {
        await (tx as any).employeeDataScope.deleteMany({ where: { employeeId } });
        const data = [
          ...branchIds.map((branchId) => ({
            employeeId,
            branchId,
            departmentId: null,
            createdBy: grantedBy,
          })),
          ...departmentIds.map((departmentId) => ({
            employeeId,
            branchId: null,
            departmentId,
            createdBy: grantedBy,
          })),
        ];
        if (data.length) {
          await (tx as any).employeeDataScope.createMany({ data, skipDuplicates: true });
        }
      },
      { maxWait: 15000, timeout: 30000 },
    );

    // Make the change take effect now rather than after the 60s TTL.
    invalidateScopeCache(employeeId);

    const scope = await resolveScope(employeeId);
    console.log(
      `[dataScope] employee ${employeeId} scope set to ` +
        `${branchIds.length} branch(es) / ${departmentIds.length} department(s) ` +
        `by emp ${grantedBy}${scope.global ? " — now GLOBAL" : ""}`,
    );

    return res.json({
      employeeId,
      isGlobal: scope.global,
      branchIds: scope.branchIds,
      departmentIds: scope.departmentIds,
    });
  } catch (error) {
    console.error("[dataScope] setEmployeeScope failed:", error);
    return res.status(500).json({ error: "Failed to update employee scope" });
  }
};
