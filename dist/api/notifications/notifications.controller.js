"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteNotification = exports.markAsRead = exports.getNotifications = exports.createNotification = exports.broadcastNotification = exports.registerForNotifications = void 0;
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
// --- SSE Client list (for live updates) ---
let clients = [];
/**
 * Server-Sent Events registration endpoint.
 * Clients connect here to receive real-time notifications.
 */
const registerForNotifications = (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.flushHeaders();
    // Extract employeeId from query params (required)
    const employeeId = Number(req.query.employeeId);
    if (!employeeId) {
        res.write(`event: error\ndata: "Missing employeeId"\n\n`);
        res.end();
        return;
    }
    // Add client to the active list
    clients.push({ employeeId, res });
    console.log(`🔗 Employee ${employeeId} connected. Total clients: ${clients.length}`);
    // Handle disconnect
    req.on("close", () => {
        clients = clients.filter(c => c.res !== res);
        console.log(`❌ Employee ${employeeId} disconnected. Remaining: ${clients.length}`);
    });
};
exports.registerForNotifications = registerForNotifications;
/**
 * Notify all connected clients about a new notification.
 */
const broadcastNotification = (notification) => {
    if (!notification.employeeId)
        return; // 🧱 Skip invalid notifications
    console.log("📢 Broadcasting to employee:", notification.employeeId);
    clients.forEach(client => {
        if (client.employeeId === notification.employeeId) {
            console.log('   ✉️ Sending to employee:', client.employeeId);
            client.res.write(`event: notification\n`);
            client.res.write(`data: ${JSON.stringify(notification)}\n\n`);
        }
    });
};
exports.broadcastNotification = broadcastNotification;
// -------------------------
// CRUD CONTROLLERS
// -------------------------
const createNotification = (employeeId, message) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const notification = yield prisma_1.prisma.notification.create({
            data: {
                employeeId,
                message,
                isRead: false,
                channel: 'PUSH'
            },
        });
        // Immediately broadcast it to the correct employee
        (0, exports.broadcastNotification)(notification);
        return notification;
    }
    catch (error) {
        console.error("❌ Failed to create notification:", error);
    }
});
exports.createNotification = createNotification;
// GET all notifications (optionally filtered by employeeId)
const getNotifications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId } = req.query;
        console.log(employeeId);
        const notifications = yield prisma_1.prisma.notification.findMany({
            where: {
                employeeId: Number(employeeId),
                isRead: false,
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(notifications);
    }
    catch (error) {
        console.error("❌ Failed to fetch notifications:", error);
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
});
exports.getNotifications = getNotifications;
// MARK notification as read
const markAsRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const updated = yield prisma_1.prisma.notification.update({
            where: { id: Number(id) },
            data: { isRead: true },
        });
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to mark notification as read" });
    }
});
exports.markAsRead = markAsRead;
// DELETE notification
const deleteNotification = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma_1.prisma.notification.delete({
            where: { id: Number(id) },
        });
        res.json({ message: "Notification deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ error: "Failed to delete notification" });
    }
});
exports.deleteNotification = deleteNotification;
