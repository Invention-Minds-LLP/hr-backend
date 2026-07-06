import { Router } from "express";
import { authenticateToken, requireRoleOrDept } from "../../middleware/authMiddleware";
import { getModuleUsageSummary } from "./module-usage.controller";

const router = Router();

// Management / HR only — same gate style as recruiting & survey admin routes:
// role names HR_MANAGER / ADMIN / MANAGEMENT, roleIds 1 (HR Manager) and
// 4 (Management), plus anyone in the HR department (deptId 1).
const managementOnly = requireRoleOrDept(
  ["HR_MANAGER", "ADMIN", "MANAGEMENT", 1, 4],
  [1],
);

router.get("/summary", authenticateToken, managementOnly, getModuleUsageSummary);

export default router;
