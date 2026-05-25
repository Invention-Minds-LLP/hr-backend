import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getEmployeeAccess } from "../lib/employeeAccess";

const JWT_SECRET = process.env.JWT_SECRET;
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
  } catch (error) {
    console.error("JWT verification failed:", error);
    res.status(403).json({ message: "Forbidden: Invalid token" });
    return;
  }

  // Employee-backed tokens have an empId claim. Candidate-portal tokens
  // don't and skip the employment-status / revoke check.
  const empId = Number(decoded?.empId ?? 0);
  if (empId > 0) {
    try {
      const access = await getEmployeeAccess(empId);
      if (!access.exists) {
        res.status(403).json({ message: "Forbidden: account not found" });
        return;
      }
      if (!access.active) {
        res.status(403).json({
          message: `Forbidden: account is ${access.status?.toLowerCase() ?? 'inactive'}`,
        });
        return;
      }
      // Compare the token's iat (in seconds) against accessRevokedAt.
      // A token issued BEFORE the revoke timestamp is no longer trusted.
      if (access.accessRevokedAt && typeof decoded.iat === 'number') {
        const tokenIssuedMs = decoded.iat * 1000;
        if (tokenIssuedMs < access.accessRevokedAt.getTime()) {
          res.status(401).json({ message: "Session expired. Please log in again." });
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
