import { Router } from "express";
import {
  getMatrix,
  getCatalog,
  setRolePermissions,
  listOverriddenEmployees,
  searchEmployees,
  getEmployeeOverrides,
  setEmployeeOverrides,
} from "./access.controller";
import {
  getScopeOptions,
  listScopedEmployees,
  getEmployeeScope,
  setEmployeeScope,
} from "./dataScope.controller";
import { authenticateToken, requirePermission } from "../../middleware/authMiddleware";

const router = Router();

// Holding this key means being able to grant yourself every other key, so it
// gates the whole module.
const canManage = requirePermission("masters.permissions.manage");

router.get("/matrix", authenticateToken, canManage, getMatrix);
router.get("/catalog", authenticateToken, canManage, getCatalog);
router.put("/roles/:roleId/permissions", authenticateToken, canManage, setRolePermissions);
router.get("/overrides", authenticateToken, canManage, listOverriddenEmployees);
router.get("/employees", authenticateToken, canManage, searchEmployees);
router.get("/employees/:employeeId/overrides", authenticateToken, canManage, getEmployeeOverrides);
router.put("/employees/:employeeId/overrides", authenticateToken, canManage, setEmployeeOverrides);

// ── Data scope (which branches/departments a person's data is limited to) ────
// Separate key from `canManage`: narrowing an HR to a branch is a different
// (and less dangerous) act than being able to grant every permission, so it can
// be delegated independently.
const canManageScope = requirePermission("masters.dataScope.manage");

router.get("/scopes/options", authenticateToken, canManageScope, getScopeOptions);
router.get("/scopes", authenticateToken, canManageScope, listScopedEmployees);
router.get("/scopes/:employeeId", authenticateToken, canManageScope, getEmployeeScope);
router.put("/scopes/:employeeId", authenticateToken, canManageScope, setEmployeeScope);

export default router;
