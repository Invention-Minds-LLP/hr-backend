import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getEmployeeAccess } from "../lib/employeeAccess";
import { resolvePermissions } from "../lib/permissionResolver";
import { config } from "../config";

const JWT_SECRET = config.jwtSecret;
if (!JWT_SECRET) {
  // Fail fast: a missing/known-default secret means anyone can forge tokens.
  throw new Error("JWT_SECRET is not set. Refusing to start without a signing secret.");
}

export interface AuthenticatedRequest extends Request {
  user?: any; // you can type this properly if you like
}

/**
 * Authenticate the request and ensure the holder still has system access.
 *
 * Three layers of defence:
 *   1. JWT signature must verify against JWT_SECRET.
 *   2. The employee must currently be in ACTIVE / NOTICE_PERIOD status.
 *   3. The token's `iat` (issued-at) must be ≥ employee.accessRevokedAt
 *      — so revoking access kills every existing token instantly.
 *
 * Candidate-portal tokens (no `empId` claim) bypass employee checks since
 * they aren't backed by an Employee row. They're authenticated only via
 * the JWT signature, which is correct for the candidate flows.
 */
export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    res.status(401).json({ message: "Unauthorized: No token provided" });
    return;
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error: any) {
    // 401, never 403. The client contract is strict:
    //   401 = the session is dead → try a silent refresh, then log out.
    //   403 = authenticated but not allowed here → keep the session.
    // Access tokens are short-lived now, so an expired one is the NORMAL case
    // and must not tear down a perfectly good session.
    console.error("JWT verification failed:", error);
    const expired = error?.name === "TokenExpiredError";
    res.status(401).json({
      message: expired ? "Session expired. Please log in again." : "Unauthorized: Invalid token",
      code: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
    });
    return;
  }

  // Employee-backed tokens have an empId claim. Candidate-portal tokens
  // don't and skip the employment-status / revoke check.
  const empId = Number(decoded?.empId ?? 0);
  if (empId > 0) {
    try {
      const access = await getEmployeeAccess(empId);
      // 401, not 403: these are session-terminating conditions, and the client
      // only tears a session down on 401 (403 is reserved for "you're logged
      // in but this route isn't yours" — see requireRole below).
      if (!access.exists) {
        res.status(401).json({ message: "Unauthorized: account not found", code: "ACCOUNT_MISSING" });
        return;
      }
      if (!access.active) {
        res.status(401).json({
          message: `Your account is ${access.status?.toLowerCase() ?? 'inactive'}. Please contact HR.`,
          code: "ACCOUNT_INACTIVE",
        });
        return;
      }
      // Compare the token's iat (in seconds) against accessRevokedAt.
      // A token issued BEFORE the revoke timestamp is no longer trusted.
      if (access.accessRevokedAt && typeof decoded.iat === 'number') {
        const tokenIssuedMs = decoded.iat * 1000;
        if (tokenIssuedMs < access.accessRevokedAt.getTime()) {
          res.status(401).json({ message: "Session expired. Please log in again.", code: "ACCESS_REVOKED" });
          return;
        }
      }
    } catch (e) {
      // If the access check itself errors (DB hiccup), we fail-open with a
      // warning rather than locking everyone out. The signature was already
      // verified, so this only widens the existing risk window briefly.
      console.error("[auth] access check failed, allowing request:", e);
    }
  }

  req.user = decoded;
  next();
};

/**
 * Role-based access guard. Use AFTER `authenticateToken`.
 * Accepts either role names ('HR_MANAGER', 'ADMIN', etc.) or numeric roleIds.
 * The JWT payload is expected to include `roleId` and/or `role` (role name).
 *
 * Example:
 *   router.post('/jobs', authenticateToken, requireRole(['HR_MANAGER', 'ADMIN']), createJob);
 */
export const requireRole = (allowed: (string | number)[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userRoleName = String(user.role ?? user.roleName ?? '').toUpperCase();
    const userRoleId   = Number(user.roleId);

    const allowedNames = allowed
      .filter((a) => typeof a === 'string')
      .map((a) => String(a).toUpperCase());
    const allowedIds = allowed.filter((a) => typeof a === 'number');

    if (allowedNames.includes(userRoleName) || allowedIds.includes(userRoleId)) {
      return next();
    }
    return res.status(403).json({ message: "Forbidden: insufficient role" });
  };
};

/**
 * Permission-based guard. Use AFTER `authenticateToken`.
 *
 * Prefer this over `requireRole` for anything new: role checks hardcode WHO,
 * permission checks state WHAT, and the WHO is editable from the Role
 * Permissions screen without a deploy.
 *
 *   router.get('/payroll', authenticateToken,
 *     requirePermission('admin.payroll.view'), handler);
 *
 * Passing several keys means any-of.
 */
export const requirePermission = (...required: string[]) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const empId = Number(req.user?.empId ?? 0);
    if (!empId) {
      // Candidate tokens have no Employee row, so no permissions to hold.
      return res.status(403).json({ message: "Forbidden: insufficient permission" });
    }
    try {
      const held = await resolvePermissions(empId);
      if (required.some((key) => held.includes(key as any))) return next();
      return res.status(403).json({ message: "Forbidden: insufficient permission" });
    } catch (e) {
      // Unlike the access check above, fail CLOSED — this guard is the whole
      // reason the route is protected.
      console.error("[auth] permission check failed:", e);
      return res.status(500).json({ message: "Permission check failed" });
    }
  };
};

/**
 * Same as `requireRole`, but also lets through users whose `deptId` is in
 * the given department allowlist. Used for "any role in the list, OR anyone
 * in this department" gates — e.g. recruiting endpoints where any HR-dept
 * employee should have access regardless of their role tier.
 *
 * Example:
 *   router.get('/recruiter-dashboard', authenticateToken,
 *     requireRoleOrDept(['HR_MANAGER', 'ADMIN', 1, 4], [1]), handler);
 */
export const requireRoleOrDept = (
  allowedRoles: (string | number)[],
  allowedDepts: number[],
) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userRoleName = String(user.role ?? user.roleName ?? '').toUpperCase();
    const userRoleId   = Number(user.roleId);
    const userDeptId   = Number(user.deptId ?? user.departmentId ?? 0);

    const allowedNames = allowedRoles
      .filter((a) => typeof a === 'string')
      .map((a) => String(a).toUpperCase());
    const allowedIds = allowedRoles.filter((a) => typeof a === 'number');

    if (
      allowedNames.includes(userRoleName) ||
      allowedIds.includes(userRoleId) ||
      (Number.isFinite(userDeptId) && allowedDepts.includes(userDeptId))
    ) {
      return next();
    }
    return res.status(403).json({ message: "Forbidden: insufficient role / department" });
  };
};
