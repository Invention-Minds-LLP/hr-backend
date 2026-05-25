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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushNotification = exports.removeDeviceToken = exports.saveDeviceToken = exports.deleteNotification = exports.markAsRead = exports.getNotifications = exports.createNotification = exports.broadcastNotification = exports.registerForNotifications = void 0;
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const employeeAccess_1 = require("../../lib/employeeAccess");
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
    var _a;
    try {
        // Don't write notifications for ex-employees / suspended / sabbatical.
        // They can't see them (auth gate blocks login) and storing them just
        // pollutes the DB + fires a wasted socket broadcast and push.
        const access = yield (0, employeeAccess_1.getEmployeeAccess)(employeeId);
        if (!access.active) {
            console.log(`[notify] skipping notification for emp ${employeeId} — status=${(_a = access.status) !== null && _a !== void 0 ? _a : 'missing'}`);
            return null;
        }
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
        // 🔹 Mobile Push
        yield (0, exports.sendPushNotification)(employeeId, message);
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
const saveDeviceToken = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { employeeId, token, platform } = req.body;
    if (!employeeId || !token) {
        return res.status(400).json({ error: 'Missing data' });
    }
    yield prisma_1.prisma.deviceToken.upsert({
        where: { token },
        update: { employeeId },
        create: { employeeId, token, platform }
    });
    res.json({ success: true });
});
exports.saveDeviceToken = saveDeviceToken;
const removeDeviceToken = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ error: "Token required" });
    }
    yield prisma_1.prisma.deviceToken.deleteMany({
        where: { token }
    });
    res.json({ success: true });
});
exports.removeDeviceToken = removeDeviceToken;
const firebase_1 = __importDefault(require("../../lib/firebase"));
const sendPushNotification = (employeeId, message) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // Belt-and-braces — if someone calls this directly (bypassing
    // createNotification), still refuse to push to inactive accounts.
    const access = yield (0, employeeAccess_1.getEmployeeAccess)(employeeId);
    if (!access.active) {
        console.log(`[push] skipping push for emp ${employeeId} — status=${(_a = access.status) !== null && _a !== void 0 ? _a : 'missing'}`);
        return;
    }
    const tokens = yield prisma_1.prisma.deviceToken.findMany({
        where: { employeeId }
    });
    if (!tokens.length)
        return;
    const payload = {
        notification: {
            title: 'New Notification',
            body: message,
        },
        data: {
            route: '/notifications'
        }
    };
    const response = yield firebase_1.default.messaging().sendEachForMulticast(Object.assign({ tokens: tokens.map(t => t.token) }, payload));
    // Cleanup invalid tokens
    response.responses.forEach((r, i) => __awaiter(void 0, void 0, void 0, function* () {
        if (!r.success) {
            yield prisma_1.prisma.deviceToken.delete({
                where: { token: tokens[i].token }
            });
        }
    }));
});
exports.sendPushNotification = sendPushNotification;
