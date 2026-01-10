import express from "express";
import {
  createPermissionRequest,
  getPermissionBalance,
  getPermissionRequests,
  updatePermissionStatus,
  getMonthlyPermissionUsage
} from "./permission.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.post("/", authenticateToken,createPermissionRequest);
router.get("/", authenticateToken,getPermissionRequests);
router.patch("/:id/status",authenticateToken, updatePermissionStatus);
router.get('/balance/:employeeId', authenticateToken, getPermissionBalance);

router.get(
  '/monthly-usage/:employeeId',
  authenticateToken,
  getMonthlyPermissionUsage
);

export default router;
