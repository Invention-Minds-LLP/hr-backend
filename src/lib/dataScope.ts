/**
 * Row-level data scope
 * ────────────────────
 * The WHOSE-DATA axis. `permissionResolver.ts` decides which SCREENS a person
 * can open; this decides which EMPLOYEES they see once they are on one.
 *
 * The contract, and the reason this is safe to deploy to existing clients:
 *
 *   ZERO SCOPE ROWS = GLOBAL ACCESS.
 *
 * Every employee in every current deployment has zero rows, so every one of
 * them keeps seeing exactly what they see today. Branch isolation switches on
 * per person, the moment HR adds the first row from the Data Scope screen.
 * Nothing here changes behaviour until someone deliberately configures it.
 *
 * Combining rules:
 *   • Several BRANCH rows are OR-ed      → "HR for Chennai and Coimbatore"
 *   • Several DEPARTMENT rows are OR-ed  → "handles Nursing and Housekeeping"
 *   • BRANCH and DEPARTMENT are AND-ed   → "Nursing, but only at Chennai"
 *
 * The AND is deliberate. For a security boundary the narrower reading is the
 * safe default: if the combination is wrong, someone is denied data they should
 * have seen (visible, reported, fixed in a minute) rather than shown data they
 * should not have (silent, and a compliance problem).
 *
 * Self is always in scope. An HR scoped to Chennai who is themselves posted at
 * Coimbatore must still be able to see their own record.
 */

import { Response } from 'express';
import { prisma } from './prisma';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

export type DataScope =
  | { global: true; branchIds: number[]; departmentIds: number[] }
  | { global: false; branchIds: number[]; departmentIds: number[] };

// Same 60s TTL as employeeAccess.ts — a scope change from the admin screen
// takes effect within a minute, and `invalidateScopeCache` makes it immediate
// for the person who was just edited.
const SCOPE_CACHE_TTL_MS = 60 * 1000;
const scopeCache = new Map<number, { value: DataScope; expires: number }>();

/**
 * Read an employee's effective scope. Cached for SCOPE_CACHE_TTL_MS.
 *
 * A non-employee caller (empId 0 — candidate-portal tokens carry no empId)
 * resolves to a NON-global, EMPTY scope, i.e. matches nothing. Fail closed:
 * such a token has no business reading the employee directory, and the failure
 * mode is a visible empty list rather than a silent full disclosure.
 */
export async function resolveScope(employeeId: number): Promise<DataScope> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return { global: false, branchIds: [], departmentIds: [] };
  }

  const cached = scopeCache.get(employeeId);
  if (cached && cached.expires > Date.now()) return cached.value;

  const rows = await (prisma as any).employeeDataScope.findMany({
    where: { employeeId },
    select: { branchId: true, departmentId: true },
  });

  const branchIds = rows
    .map((r: any) => r.branchId)
    .filter((id: number | null): id is number => typeof id === 'number');
  const departmentIds = rows
    .map((r: any) => r.departmentId)
    .filter((id: number | null): id is number => typeof id === 'number');

  // No rows at all → global. This is the untouched-client path.
  const value: DataScope = rows.length === 0
    ? { global: true, branchIds: [], departmentIds: [] }
    : { global: false, branchIds, departmentIds };

  scopeCache.set(employeeId, { value, expires: Date.now() + SCOPE_CACHE_TTL_MS });
  return value;
}

/** Forget a cached scope — call after editing someone's scope rows. */
export function invalidateScopeCache(employeeId?: number): void {
  if (employeeId === undefined) scopeCache.clear();
  else scopeCache.delete(employeeId);
}

/**
 * A Prisma `where` fragment for the Employee model, or `{}` when the viewer is
 * global. Prefer `withEmployeeScope()` — it merges safely with a `where` that
 * already uses OR for search.
 */
export async function scopedEmployeeWhere(viewerId: number): Promise<Record<string, any>> {
  const scope = await resolveScope(viewerId);
  if (scope.global) return {};

  const clauses: any[] = [];
  if (scope.branchIds.length) clauses.push({ branchId: { in: scope.branchIds } });
  if (scope.departmentIds.length) clauses.push({ departmentId: { in: scope.departmentIds } });

  // Rows existed but every target was deleted, or the caller has no empId.
  // Narrow to self rather than widening back to everyone.
  if (!clauses.length) return { id: viewerId };

  return { OR: [{ id: viewerId }, { AND: clauses }] };
}

/**
 * Merge the viewer's scope into an existing Employee `where`.
 *
 * Wrapping both sides in an outer AND matters: several list endpoints already
 * put an `OR` on `where` for free-text search, and assigning a second `OR` onto
 * the same object would overwrite it — silently turning a scoped search into an
 * unscoped one.
 */
export async function withEmployeeScope(
  viewerId: number,
  where: Record<string, any>,
): Promise<Record<string, any>> {
  const scope = await scopedEmployeeWhere(viewerId);
  if (Object.keys(scope).length === 0) return where;
  if (Object.keys(where).length === 0) return scope;
  return { AND: [where, scope] };
}

/**
 * Can `viewerId` see `targetId`? Used by single-record endpoints, where
 * scoping the list view alone would be cosmetic — the row is still one
 * guessable id away.
 */
export async function isInScope(viewerId: number, targetId: number): Promise<boolean> {
  if (!Number.isFinite(targetId) || targetId <= 0) return false;
  if (viewerId === targetId) return true;

  const scope = await resolveScope(viewerId);
  if (scope.global) return true;
  if (!scope.branchIds.length && !scope.departmentIds.length) return false;

  const target = await prisma.employee.findUnique({
    where: { id: targetId },
    select: { branchId: true, departmentId: true },
  });
  if (!target) return false;

  // AND across the two dimensions — see the header note on why narrow wins.
  if (scope.branchIds.length && !scope.branchIds.includes(target.branchId)) return false;
  if (scope.departmentIds.length && !scope.departmentIds.includes(target.departmentId)) return false;
  return true;
}

/**
 * Guard for single-record routes. Writes the 403 itself and returns false, so
 * a call site reads:
 *
 *   if (!(await guardInScope(req, res, employeeId))) return;
 *
 * It does NOT throw: the global error handler in index.ts turns every thrown
 * error into a 500, which would misreport an authorisation failure as a server
 * fault and break the client's 401/403 handling.
 */
export async function guardInScope(
  req: AuthenticatedRequest,
  res: Response,
  targetEmployeeId: number,
): Promise<boolean> {
  const viewerId = Number(req.user?.empId ?? 0);
  if (await isInScope(viewerId, targetEmployeeId)) return true;

  // Deliberately identical to a "not found" in tone — telling a scoped HR that
  // the employee exists but belongs to another branch leaks headcount.
  res.status(403).json({
    message: 'Forbidden: this employee is outside your assigned branch/department.',
    code: 'OUT_OF_SCOPE',
  });
  return false;
}

/** Convenience for controllers that already have the viewer id to hand. */
export async function isViewerGlobal(viewerId: number): Promise<boolean> {
  return (await resolveScope(viewerId)).global;
}
