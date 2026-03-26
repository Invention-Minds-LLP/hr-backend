import { Request, Response } from "express";
import { PrismaClient, WFHStatus } from "@prisma/client";
const prisma = new PrismaClient();
import { sendWhatsAppTemplate } from "../leave/leave.controller";
import { daysInclusive } from "../leave/leave.controller";
import { createNotification } from "../notifications/notifications.controller";


const WFH_APPLY_TEMPLATE_ID = '890419';
const WFH_STATUS_TEMPLATE_ID = "909807";

// Create WFH request
export const createWFHRequest = async (req: Request, res: Response) => {
  try {
    const { employeeId, startDate, endDate, reason } = req.body;
    if (!employeeId || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const newWFH = await prisma.wFHRequest.create({
      data: {
        employeeId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
      },
      include: { employee: true },
    });

    const name = [newWFH.employee.firstName, newWFH.employee.lastName]
      .filter(Boolean)
      .join(" ");

    const days = daysInclusive(newWFH.startDate, newWFH.endDate);
    const placeholders = [name, days, fmtDate(newWFH.startDate), fmtDate(newWFH.endDate)];

    let notifyStatus: "sent" | "skipped" | "failed" = "skipped";
    let notifyError: string | undefined;
    let mgrPhone: string | undefined;

    const mgrId = newWFH?.employee?.reportingManager;
    if (mgrId) {
      const manager = await prisma.employee.findUnique({
        where: { id: mgrId },
        select: { phone: true },
      });
      mgrPhone = manager?.phone ?? undefined;
    }

    if (mgrPhone) {
      try {
        await sendWhatsAppTemplate({
          to: formatPhoneNumber(mgrPhone),
          templateId: WFH_APPLY_TEMPLATE_ID, // use a separate WFH template ID if needed
          placeholders,
        });
        notifyStatus = "sent";
      } catch (e: any) {
        notifyStatus = "failed";
        notifyError = e?.message || "WhatsApp send failed";
        console.error("WFH notify (manager) failed:", e);
      }
    }

    // 🔔 In-app notification to manager/incharge
    const notifyTo = newWFH.employee.inchargeId ?? newWFH.employee.reportingManager;
    if (notifyTo) {
      const empName = [newWFH.employee.firstName, newWFH.employee.lastName].filter(Boolean).join(' ');
      await createNotification(
        notifyTo,
        `${empName} has applied for WFH from ${fmtDate(newWFH.startDate)} to ${fmtDate(newWFH.endDate)}. Please review and take action.`
      );
    }

    res.status(201).json(newWFH);
  } catch (error) {
    console.error("Error creating WFH request:", error);
    res.status(500).json({ error: "Failed to create WFH request" });
  }
};

// Get all WFH requests
export const getWFHRequests = async (_req: Request, res: Response) => {
  try {
    const requests = await prisma.wFHRequest.findMany({
      where: {
        status: "PENDING" // only approved leave requests
      },
      include: { employee: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(requests);
  } catch (error) {
    console.error("Error fetching WFH requests:", error);
    res.status(500).json({ error: "Failed to fetch WFH requests" });
  }
};

// // Update WFH request status
// export const updateWFHStatus = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const { status, userId, declineReason } = req.body;

//     if (!["Approved", "Declined"].includes(status)) {
//       return res.status(400).json({ error: "Invalid status value" });
//     }

//     const data: any = {
//       status: status === "APPROVED" ? WFHStatus.APPROVED : WFHStatus.REJECTED,
//       approvedBy: null,
//       declinedBy: null,
//       approvedDate: null,
//       declinedDate: null,
//       declineReason: null,
//     };

//     if (data.status === "APPROVED") {
//       data.approvedBy = userId;
//       data.approvedDate = new Date();
//     } else if (data.status === "REJECTED") {
//       data.declinedBy = userId;
//       data.declinedDate = new Date();
//       data.declineReason = declineReason;
//     }

//     const updatedWFH = await prisma.wFHRequest.update({
//       where: { id: Number(id) },
//       data,
//       include: { employee: true },
//     });

//     const employee = updatedWFH.employee;
//     const employeePhone = formatPhoneNumber(employee?.phone || "");
//     const employeeName = [employee?.firstName, employee?.lastName]
//       .filter(Boolean)
//       .join(" ");
//     const days = daysInclusive(updatedWFH.startDate, updatedWFH.endDate);
//     const start = fmtDate(updatedWFH.startDate);
//     const end = fmtDate(updatedWFH.endDate);
//     const statusLabel =
//       data.status === WFHStatus.APPROVED ? "Approved" : "Declined";

//     let notification: {
//       type: "WFH_STATUS_EMPLOYEE";
//       status: "sent" | "skipped" | "failed";
//       error?: string;
//     } = { type: "WFH_STATUS_EMPLOYEE", status: "skipped" };

//     if (employeePhone) {
//       try {
//         await sendWhatsAppTemplate({
//           to: employeePhone,
//           templateId: WFH_STATUS_TEMPLATE_ID, // define in your constants
//           placeholders: [employeeName, days, start, end, statusLabel],
//         });
//         notification.status = "sent";
//       } catch (e: any) {
//         console.error("WFH status WA send failed:", e);
//         notification.status = "failed";
//         notification.error = e?.message || "WhatsApp send failed";
//       }
//     }


//     res.json(updatedWFH);
//   } catch (error) {
//     console.error("Error updating WFH request status:", error);
//     res.status(500).json({ error: "Failed to update WFH request status" });
//   }
// };

export const updateWFHStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role, status, userId, declineReason } = req.body;

    if (!['MANAGER', 'HR'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    if (!['Approved', 'Declined'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const wfh = await prisma.wFHRequest.findUnique({ where: { id: Number(id) } });
    if (!wfh) return res.status(404).json({ error: 'WFH request not found' });

    const data: any = {};

    // --- Manager decision first ---
    if (role === 'MANAGER') {
      if (wfh.hodDecision !== 'PENDING') {
        return res.status(400).json({ error: 'Manager already decided' });
      }
      data.hodDecision = status === 'Approved' ? 'APPROVED' : 'REJECTED';
      data.hodDecidedAt = new Date();

      if (data.hodDecision === 'REJECTED') {
        data.status = WFHStatus.REJECTED;
        data.declinedBy = userId;
        data.declinedDate = new Date();
        data.declineReason = declineReason || null;
      }
    }

    // --- HR decision second ---
    if (role === 'HR') {
      if (wfh.hodDecision !== 'APPROVED') {
        return res.status(400).json({ error: 'Manager approval required first' });
      }
      if (wfh.hrDecision !== 'PENDING') {
        return res.status(400).json({ error: 'HR already decided' });
      }

      data.hrDecision = status === 'Approved' ? 'APPROVED' : 'REJECTED';
      data.hrDecidedAt = new Date();

      if (data.hrDecision === 'APPROVED') {
        data.status = WFHStatus.APPROVED;
        data.approvedBy = userId;
        data.approvedDate = new Date();
      } else {
        data.status = WFHStatus.REJECTED;
        data.declinedBy = userId;
        data.declinedDate = new Date();
        data.declineReason = declineReason || null;
      }
    }

    const updatedWFH = await prisma.wFHRequest.update({
      where: { id: Number(id) },
      data,
      include: { employee: true },
    });

    // --- WhatsApp notify employee ---
    const employee = updatedWFH.employee;
    const employeePhone = formatPhoneNumber(employee?.phone || '');
    const employeeName = [employee?.firstName, employee?.lastName].filter(Boolean).join(' ');
    const days = daysInclusive(updatedWFH.startDate, updatedWFH.endDate);
    const start = fmtDate(updatedWFH.startDate);
    const end = fmtDate(updatedWFH.endDate);
    const statusLabel =
      updatedWFH.status === WFHStatus.APPROVED ? 'Approved' :
      updatedWFH.status === WFHStatus.REJECTED ? 'Declined' : 'Pending';

    // if (employeePhone && (data.hodDecision === 'REJECTED' || data.hrDecision)) {
    //   try {
    //     await sendWhatsAppTemplate({
    //       to: employeePhone,
    //       templateId: WFH_STATUS_TEMPLATE_ID,
    //       placeholders: [employeeName, days, start, end, statusLabel],
    //     });
    //   } catch (e: any) {
    //     console.error('WFH status WA send failed:', e?.message || e);
    //   }
    // }

    // 🔔 Notify employee when a final decision is reached
    if (updatedWFH.status === WFHStatus.APPROVED || updatedWFH.status === WFHStatus.REJECTED) {
      const empName = [employee?.firstName, employee?.lastName].filter(Boolean).join(' ');
      await createNotification(
        updatedWFH.employeeId,
        `Your WFH request from ${fmtDate(updatedWFH.startDate)} to ${fmtDate(updatedWFH.endDate)} has been ${updatedWFH.status === WFHStatus.APPROVED ? 'Approved' : 'Declined'}.`
      );
    }

    res.json(updatedWFH);
  } catch (error) {
    console.error('Error updating WFH status:', error);
    res.status(500).json({ error: 'Failed to update WFH status' });
  }
};


// Reuse the same helpers you already have
function atStartOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function atEndOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function startOfISOWeek(d: Date) {
  const x = atStartOfDay(d); const day = x.getDay(); const diff = (day === 0 ? -6 : 1 - day);
  x.setDate(x.getDate() + diff); return x;
}
function endOfISOWeek(d: Date) { const s = startOfISOWeek(d); const e = new Date(s); e.setDate(s.getDate() + 6); return atEndOfDay(e); }
function startOfNextMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0); }
function endOfNextMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 2, 0, 23, 59, 59, 999); }
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) { return aEnd >= bStart && aStart <= bEnd; }

type Person = {
  id: number;
  name: string;
  title: string | null;
  photoUrl: string | null;
  startDate: string;
  endDate: string;
};

export async function getWhoIsOnWFHBuckets(req: Request, res: Response) {
  try {
    const base = req.query.date ? new Date(String(req.query.date)) : new Date();

    // Ranges
    const todayStart = atStartOfDay(base);
    const todayEnd = atEndOfDay(base);
    const weekStart = startOfISOWeek(base);
    const weekEnd = endOfISOWeek(base);
    const nextMonthStart = startOfNextMonth(base);
    const nextMonthEnd = endOfNextMonth(base);

    // Single fetch covering week → next month
    const minStart = weekStart;
    const maxEnd = nextMonthEnd;

    const rows = await prisma.wFHRequest.findMany({
      where: {
        status: 'APPROVED',
        AND: [
          { endDate: { gte: minStart } },
          { startDate: { lte: maxEnd } }
        ]
      },
      select: {
        startDate: true,
        endDate: true,
        employee: {
          select: { id: true, firstName: true, lastName: true, designation: true, photoUrl: true }
        }
      },
      orderBy: { startDate: 'asc' }
    });

    const today: Person[] = [];
    const thisWeek: Person[] = [];
    const nextMonth: Person[] = [];

    const seenToday = new Set<number>();
    const seenWeek = new Set<number>();
    const seenNext = new Set<number>();

    for (const r of rows) {
      const designationName = r.employee.designation?.name ?? 'Default';
      const s = new Date(r.startDate);
      const e = new Date(r.endDate);
      const person: Person = {
        id: r.employee.id,
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        title: designationName,
        photoUrl: r.employee.photoUrl || null,
        startDate: s.toISOString(),
        endDate: e.toISOString(),
      };

      if (overlaps(s, e, todayStart, todayEnd)) {
        if (!seenToday.has(person.id)) { today.push(person); seenToday.add(person.id); }
        continue;
      }
      if (overlaps(s, e, weekStart, weekEnd)) {
        if (!seenWeek.has(person.id)) { thisWeek.push(person); seenWeek.add(person.id); }
        continue;
      }
      if (overlaps(s, e, nextMonthStart, nextMonthEnd)) {
        if (!seenNext.has(person.id)) { nextMonth.push(person); seenNext.add(person.id); }
      }
    }

    res.json({ today, thisWeek, nextMonth });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message || 'Failed to fetch WFH buckets' });
  }
}
const TZ = "Asia/Kolkata";
const fmtDate = (d: Date | string | number) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(d));

function formatPhoneNumber(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("91")) return `+${digits}`;
  if (digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("+")) return digits;
  return `+${digits}`;
}