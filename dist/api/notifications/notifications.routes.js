"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notifications_controller_1 = require("./notifications.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
// ✅ Live updates (Server-Sent Events)
router.get("/stream", notifications_controller_1.registerForNotifications);
router.get("/", authMiddleware_1.authenticateToken, notifications_controller_1.getNotifications);
router.put("/:id/read", authMiddleware_1.authenticateToken, notifications_controller_1.markAsRead);
router.delete("/:id", authMiddleware_1.authenticateToken, notifications_controller_1.deleteNotification);
exports.default = router;
