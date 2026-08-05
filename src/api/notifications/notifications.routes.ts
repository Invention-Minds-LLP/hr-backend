import { Router } from "express";
import {
  createNotification,
  getNotifications,
  markAsRead,
  deleteNotification,
  registerForNotifications,
  issueStreamTicket,
  saveDeviceToken,
  removeDeviceToken,
} from "./notifications.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

// ✅ Live updates (Server-Sent Events)
// EventSource can't send an Authorization header, so the client first calls
// /stream-ticket (authenticated) and passes the short-lived ticket to /stream.
router.get("/stream-ticket", authenticateToken, issueStreamTicket);
router.get("/stream", registerForNotifications);

router.get("/", authenticateToken, getNotifications);
router.post('/device-token', authenticateToken, saveDeviceToken);
router.post("/remove-device-token", authenticateToken, removeDeviceToken);

router.put("/:id/read", authenticateToken, markAsRead);
router.delete("/:id", authenticateToken, deleteNotification);

export default router;
