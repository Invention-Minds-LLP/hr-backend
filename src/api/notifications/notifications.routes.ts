import { Router } from "express";
import {
  createNotification,
  getNotifications,
  markAsRead,
  deleteNotification,
  registerForNotifications,
  saveDeviceToken,
  removeDeviceToken,
} from "./notifications.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

// ✅ Live updates (Server-Sent Events)
router.get("/stream", registerForNotifications);

router.get("/", authenticateToken, getNotifications);
router.post('/device-token', saveDeviceToken);
router.post("/remove-device-token", authenticateToken, removeDeviceToken);

router.put("/:id/read", authenticateToken, markAsRead);
router.delete("/:id", authenticateToken, deleteNotification);

export default router;
