import { Request, Response } from "express";
import { PrismaClient, PermissionStatus } from "@prisma/client";
const prisma = new PrismaClient();
import { sendWhatsAppTemplate } from "../leave/leave.controller";

const PERMISSION_APPLY_TEMPLATE_ID = '';
const PERMISSION_STATUS_TEMPLATE_ID = '';
const TZ = "Asia/Kolkata";
const fmtDate = (d: Date | string | number) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(d));

const fmtTime = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

function formatPhoneNumber(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("91")) return `+${digits}`;
  if (digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("+")) return digits;
  return `+${digits}`;
}

export const createPermissionRequest = async (req: Request, res: Response) => {
  try {
    const { employeeId, permissionType, timing, day, startTime, endTime, reason } = req.body;

    if (!employeeId || !permissionType || !timing || !day || !reason) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const request = await prisma.permissionRequest.create({
      data: {
        employeeId,
        permissionType,
        timing,
        day: new Date(day),
        startTime: startTime ? new Date(startTime) : undefined,
        endTime: endTime ? new Date(endTime) : undefined,
        reason
      },
      include: { employee: true }
    });
    const employeeName = [request.employee.firstName, request.employee.lastName]
      .filter(Boolean)
      .join(" ");

    const dayLabel = fmtDate(request.day);
    let timeRange = "";
    let startLabel = '';
    let endLabel = '';
    if (timing === "HOURLY" || timing === "HALFDAY") {
      startLabel = request.startTime ? fmtTime(request.startTime) : "";
      endLabel = request.endTime ? fmtTime(request.endTime) : "";
      timeRange = startLabel && endLabel ? `${startLabel} - ${endLabel}` : "";
    }


    // Try to send to the manager
    let notifyStatus: "sent" | "skipped" | "failed" = "skipped";
    let notifyError: string | undefined;
    let mgrPhone: string | undefined;

    const mgrId = request?.employee?.reportingManager;
    if (mgrId) {
      const manager = await prisma.employee.findUnique({
        where: { id: mgrId },
        select: { phone: true }
      });
      mgrPhone = manager?.phone ?? undefined;
    }

    if (mgrPhone) {
      try {
        await sendWhatsAppTemplate({
          to: formatPhoneNumber(mgrPhone),
          templateId: PERMISSION_APPLY_TEMPLATE_ID, // define in constants
          placeholders: [
            employeeName,
            permissionType,
            timing,
            dayLabel,
            startLabel,
            endLabel
          ]
        });
        notifyStatus = "sent";
      } catch (e: any) {
        notifyStatus = "failed";
        notifyError = e?.message || "WhatsApp send failed";
        console.error("Permission notify (manager) failed:", e);
      }
    }

    res.status(201).json(request);
  } catch (error) {
    console.error("Error creating permission request:", error);
    res.status(500).json({ error: "Failed to create permission request" });
  }
};
export const getPermissionRequests = async (_req: Request, res: Response) => {
  try {
    const requests = await prisma.permissionRequest.findMany({
      where: {
        status: "PENDING" // only approved leave requests
      },
      include: { employee: true },
      orderBy: { createdAt: "desc" }
    });
    res.json(requests);
  } catch (error) {
    console.error("Error fetching permission requests:", error);
    res.status(500).json({ error: "Failed to fetch permission requests" });
  }
};
export const updatePermissionStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, userId, declineReason } = req.body;

    if (!['APPROVED', 'Declined'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const data: any = {
      status: status === 'APPROVED' ? PermissionStatus.APPROVED : PermissionStatus.REJECTED,
      approvedBy: null,
      declinedBy: null,
      declineReason: null,
      approvedDate: null,
      declinedDate: null
    };

    if (data.status === 'APPROVED') {
      data.approvedBy = userId;
      data.approvedDate = new Date();
    } else if (data.status === 'REJECTED') {
      data.declinedBy = userId;
      data.declinedDate = new Date();
      data.declineReason = declineReason;
    }

    const updated = await prisma.permissionRequest.update({
      where: { id: Number(id) },
      data,
      include: { employee: true }
    });
    // ---------- WhatsApp to employee ----------
    const emp = updated.employee;
    const employeePhone = formatPhoneNumber(emp?.phone || "");
    const employeeName = [emp?.firstName, emp?.lastName].filter(Boolean).join(" ");
    const dateLabel = fmtDate(updated.day); // e.g. 15-08-2025 if your fmtDate is en-GB

    // For FULLDAY we can send "-" for times; for HOURLY/HALFDAY send actual times.
    const fromTime =
      updated.timing === "HOURLY" || updated.timing === "HALFDAY"
        ? fmtTime(updated.startTime)
        : "-";
    const toTime =
      updated.timing === "HOURLY" || updated.timing === "HALFDAY"
        ? fmtTime(updated.endTime)
        : "-";

    const statusLabel = data.status === PermissionStatus.APPROVED ? "Approved" : "Declined";

    let notification: { status: "sent" | "skipped" | "failed"; error?: string } = {
      status: "skipped",
    };

    // if (employeePhone) {
    //   try {
    //     await sendWhatsAppTemplate({
    //       to: employeePhone,
    //       templateId: PERMISSION_STATUS_TEMPLATE_ID,
    //       placeholders: [employeeName, dateLabel, fromTime || "-", toTime || "-", statusLabel],
    //     });
    //     notification.status = "sent";
    //   } catch (e: any) {
    //     console.error("Permission status WA send failed:", e);
    //     notification.status = "failed";
    //     notification.error = e?.message || "WhatsApp send failed";
    //   }
    // }


    res.json(updated);
  } catch (error) {
    console.error("Error updating permission status:", error);
    res.status(500).json({ error: "Failed to update permission status" });
  }

};
