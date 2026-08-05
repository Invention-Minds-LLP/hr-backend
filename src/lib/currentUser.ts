// ─────────────────────────────────────────────────────────────────────────────
//  Reading the caller's identity off the JWT.
//
//  The access token payload (see api/user/auth.helpers.ts → signAccessToken) is:
//      { userId, role, empId, deptId, employeeCode, username, roleId }
//
//  Note the claim is `empId`, NOT `employeeId`. Several call sites historically
//  read `req.user.employeeId`, which is always undefined — one of them silently
//  fell back to employee 1 and stamped every payroll run with the wrong author.
//  This helper is the single correct reader; use it instead of reaching into
//  req.user directly.
// ─────────────────────────────────────────────────────────────────────────────

export interface JwtUserLike {
  empId?: unknown;
  employeeId?: unknown;
  userId?: unknown;
  role?: unknown;
  roleId?: unknown;
  deptId?: unknown;
  employeeCode?: unknown;
}

/**
 * The caller's Employee id, or null when the token has none (candidate-portal
 * tokens carry `candidateId` instead and legitimately have no employee).
 *
 * `employeeId` is accepted as a fallback so a future token shape that uses the
 * longer name keeps working.
 */
export function currentEmployeeId(req: { user?: JwtUserLike }): number | null {
  const raw = req.user?.empId ?? req.user?.employeeId;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Department id from the token, or null. Used by permission-ish checks. */
export function currentDeptId(req: { user?: JwtUserLike }): number | null {
  const id = Number(req.user?.deptId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Role name from the token, lowercased for comparison. */
export function currentRole(req: { user?: JwtUserLike }): string {
  return String(req.user?.role ?? '').toLowerCase();
}
