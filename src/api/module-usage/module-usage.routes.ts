import { Router } from "express";
import { authenticateToken, requirePermission } from "../../middleware/authMiddleware";
import { getModuleUsageSummary } from "./module-usage.controller";

const router = Router();

// Same key the navbar and the /admin/module-utilization route check, so
// granting it from the Role Permissions screen opens both the page and its data.
router.get("/summary", authenticateToken, requirePermission("admin.moduleUtilization.view"), getModuleUsageSummary);

export default router;
