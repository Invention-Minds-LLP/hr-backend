import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your_default_secret"; // make sure to store in .env

export interface AuthenticatedRequest extends Request {
  user?: any; // you can type this properly if you like
}

export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
     res.status(401).json({ message: "Unauthorized: No token provided" });
     return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // attach decoded payload to request
    next();
     return
  } catch (error) {
    console.error("JWT verification failed:", error);
     res.status(403).json({ message: "Forbidden: Invalid token" });
    return;
  }
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
