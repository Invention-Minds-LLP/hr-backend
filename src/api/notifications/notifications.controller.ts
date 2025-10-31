import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// --- SSE Client list (for live updates) ---
let clients: Client[] = [];

interface Client {
    employeeId: number;
    res: Response;
}

/**
 * Server-Sent Events registration endpoint.
 * Clients connect here to receive real-time notifications.
 */
export const registerForNotifications = (req: Request, res: Response): void => {
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

/**
 * Notify all connected clients about a new notification.
 */
export const broadcastNotification = (notification: { employeeId: number | null; message: string }) => {
    if (!notification.employeeId) return; // 🧱 Skip invalid notifications
  
    console.log("📢 Broadcasting to employee:", notification.employeeId);
  
    clients.forEach(client => {

      if (client.employeeId === notification.employeeId) {
        console.log('   ✉️ Sending to employee:', client.employeeId);
        client.res.write(`event: notification\n`);
        client.res.write(`data: ${JSON.stringify(notification)}\n\n`);
      }
    });
  };
  
// -------------------------
// CRUD CONTROLLERS
// -------------------------

export const createNotification = async (employeeId: number, message: string) => {
    try {
      const notification = await prisma.notification.create({
        data: {
          employeeId,
          message,
          isRead: false,
          channel: 'PUSH'
        },
      });
  
      // Immediately broadcast it to the correct employee
      broadcastNotification(notification);
      return notification;
    } catch (error) {
      console.error("❌ Failed to create notification:", error);
    }
  };
  

// GET all notifications (optionally filtered by employeeId)
export const getNotifications = async (req: Request, res: Response) => {
    try {
        const { employeeId } = req.query;
        console.log(employeeId)

        const notifications = await prisma.notification.findMany({
            where: {
                employeeId: Number(employeeId),
                isRead: false,
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json(notifications);
    } catch (error) {
        console.error("❌ Failed to fetch notifications:", error);
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
};

// MARK notification as read
export const markAsRead = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const updated = await prisma.notification.update({
            where: { id: Number(id) },
            data: { isRead: true },
        });

        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: "Failed to mark notification as read" });
    }
};

// DELETE notification
export const deleteNotification = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        await prisma.notification.delete({
            where: { id: Number(id) },
        });

        res.json({ message: "Notification deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete notification" });
    }
};
