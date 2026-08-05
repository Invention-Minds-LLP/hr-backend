import { Response } from "express";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { resolvePermissions } from "../../lib/permissionResolver";

/**
 * GET /api/me/permissions
 *
 * Returns the permission keys for the caller. The frontend loads this once in
 * its app initializer and gates the navbar + routes on it, so role rules live
 * on the server instead of being re-derived from localStorage in the browser.
 *
 * Reads the caller's own identity from the token — never a query param, or one
 * user could enumerate another's access.
 */
export const getMyPermissions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const empId = Number(req.user?.empId ?? 0);

    // Candidate-portal tokens have no Employee row and no admin surface.
    if (!empId) {
      return res.json({ permissions: [] });
    }

    const permissions = await resolvePermissions(empId);
    return res.json({ permissions });
  } catch (error) {
    console.error("[me] failed to resolve permissions:", error);
    return res.status(500).json({ error: "Failed to load permissions" });
  }
};
