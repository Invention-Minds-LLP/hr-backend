import express from "express";
import {
  createPermissionRequest,
  getPermissionBalance,
  getPermissionRequests,
  updatePermissionStatus,
  getMonthlyPermissionUsage,
  updatePermissionRequest,
  cancelPermissionRequest,
} from "./permission.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.post("/", authenticateToken,createPermissionRequest);
router.get("/", authenticateToken,getPermissionRequests);
router.patch("/:id/status",authenticateToken, updatePermissionStatus);
// Edit / cancel a pending permission (only allowed when no approver has acted)
router.put("/:id", authenticateToken, updatePermissionRequest);
router.patch("/:id/cancel", authenticateToken, cancelPermissionRequest);
router.get('/balance/:employeeId', authenticateToken, getPermissionBalance);

router.get(
  '/monthly-usage/:employeeId',
  authenticateToken,
  getMonthlyPermissionUsage
);

export default router;
