import { Request, Response } from "express";
import { PrismaClient, LeaveStatus } from "@prisma/client";
import axios from "axios";
const prisma = new PrismaClient();

const LEAVE_APPLY_TEMPLATE_ID = "890321";
const LEAVE_STATUS_TEMPLATE_ID = "888267";
// Create Leave Request
export const createLeaveRequest = async (req: Request, res: Response) => {
  try {
    const { employeeId, leaveTypeId, startDate, endDate, reason } = req.body;

    if (!employeeId || !leaveTypeId || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
      },
      include: {
        leaveType: true,
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true, reportingManager: true }
        }
      }
    });
    const name = [leaveRequest.employee.firstName, leaveRequest.employee.lastName].filter(Boolean).join(" ");
    const days = daysInclusive(leaveRequest.startDate, leaveRequest.endDate);
    const placeholders = [name, days, fmtDate(leaveRequest.startDate), fmtDate(leaveRequest.endDate)];

    // Try to send to the manager right here
    let notifyStatus: "sent" | "skipped" | "failed" = "skipped";
    let notifyError: string | undefined;
    let mgrPhone: string | undefined;
    const mgrId = leaveRequest?.employee?.reportingManager;
    if (mgrId) {
      const manager = await prisma.employee.findUnique({
        where: { id: mgrId },
        select: { phone: true, firstName: true, lastName: true }
      });
      mgrPhone = manager?.phone ?? undefined;
    }

    if (mgrPhone) {
      try {
        await sendWhatsAppTemplate({
          to: formatPhoneNumber(mgrPhone),
          templateId: LEAVE_APPLY_TEMPLATE_ID,
          placeholders,
        });
        notifyStatus = "sent";
      } catch (e: any) {
        notifyStatus = "failed";
        notifyError = e?.message || "WhatsApp send failed";
        // log but do NOT fail the API just because notification failed
        console.error("WFH notify (manager) failed:", e);
      }
    }

    res.status(201).json(leaveRequest);
  } catch (error) {
    console.error("Error creating leave request:", error);
    res.status(500).json({ error: "Failed to create leave request" });
  }
};

// Get All Leave Requests (optional)
export const getLeaveRequests = async (_req: Request, res: Response) => {
  try {
    const leaves = await prisma.leaveRequest.findMany({
      where: {
        status: "PENDING" // only approved leave requests
      },
      include: { leaveType: true, employee: true },
      orderBy: { createdAt: "desc" }
    });
    res.json(leaves);
  } catch (error) {
    console.error("Error fetching leave requests:", error);
    res.status(500).json({ error: "Failed to fetch leave requests" });
  }
};
export const createLeaveType = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Leave type name is required" });
    }

    const leaveType = await prisma.leaveType.create({
      data: { name },
    });

    res.status(201).json(leaveType);
  } catch (error) {
    console.error("Error creating leave type:", error);
    res.status(500).json({ error: "Failed to create leave type" });
  }
};

// Get All Leave Types
export const getLeaveTypes = async (_req: Request, res: Response) => {
  try {
    const leaveTypes = await prisma.leaveType.findMany({
      orderBy: { name: "asc" }
    });
    res.json(leaveTypes);
  } catch (error) {
    console.error("Error fetching leave types:", error);
    res.status(500).json({ error: "Failed to fetch leave types" });
  }
};

export const updateLeaveStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, declineReason, userId } = req.body; // userId = logged-in admin

    if (!['Approved', 'Declined'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const data: any = {
      status: status === 'Approved' ? LeaveStatus.APPROVED : LeaveStatus.REJECTED,
      approvedBy: null,
      declinedBy: null,
      declineReason: null
    };

    if (data.status === "APPROVED") {
      data.approvedBy = userId;
      data.approvedDate = new Date();
    } else if (data.status === "REJECTED") {
      data.declinedBy = userId;
      data.declinedDate = new Date();
      data.declineReason = declineReason;
    }
    console.log(data, status)

    const updatedLeave = await prisma.leaveRequest.update({
      where: { id: Number(id) },
      data,
      include: {
        employee: true,
        leaveType: true,
      }
    });
    console.log(updatedLeave.employee)
    const employee = updatedLeave.employee;
    const employeePhone = formatPhoneNumber(employee?.phone || "");
    const employeeName = [employee?.firstName, employee?.lastName].filter(Boolean).join(" ");
    const days = daysInclusive(updatedLeave.startDate, updatedLeave.endDate);
    const start = fmtDate(updatedLeave.startDate);
    const end = fmtDate(updatedLeave.endDate);
    const statusLabel = data.status === LeaveStatus.APPROVED ? "Approved" : "Declined";

    console.log(employeeName, employeePhone, statusLabel)

    // Try to send WA; don't fail the API if this errors
    let notification = { type: "LEAVE_STATUS_EMPLOYEE", status: "skipped" as "sent" | "skipped" | "failed", error: undefined as string | undefined };
    if (employeePhone) {
      try {
        await sendWhatsAppTemplate({
          to: employeePhone,
          templateId: LEAVE_STATUS_TEMPLATE_ID,
          placeholders: [employeeName, days, start, end, statusLabel]
        });
        notification.status = "sent";
      } catch (e: any) {
        console.error("Leave status WA send failed:", e);
        notification.status = "failed";
        notification.error = e?.message || "WhatsApp send failed";
      }
    }

    res.json(updatedLeave);
  } catch (error) {
    console.error("Error updating leave status:", error);
    res.status(500).json({ error: "Failed to update leave status" });
  }
};


const MS_PER_DAY = 86400000;

export function daysInclusive(s: Date, e: Date) {
  const ss = new Date(s); ss.setHours(0, 0, 0, 0);
  const ee = new Date(e); ee.setHours(0, 0, 0, 0);
  return Math.floor((ee.getTime() - ss.getTime()) / MS_PER_DAY) + 1;
}

export async function getLeaveDashboard(req: Request, res: Response) {
  try {
    const employeeId = Number(req.params.id);
    const today = req.query.date ? new Date(String(req.query.date)) : new Date();
    const y = today.getFullYear();
    const yearStart = new Date(y, 0, 1);
    const yearEnd = new Date(y, 11, 31, 23, 59, 59);
    const monthStart = new Date(y, today.getMonth(), 1);
    const monthEnd = new Date(y, today.getMonth() + 1, 0, 23, 59, 59);

    // Entitlement for this year
    const policy = await prisma.entitlementPolicy.findFirst({ where: { year: y } });
    const entitlement = policy?.leaveEntitlement ?? 0;

    // Approved leave requests (clamped to year)
    const leaves = await prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: 'APPROVED',
        AND: [{ endDate: { gte: yearStart } }, { startDate: { lte: yearEnd } }],
      },
      select: { startDate: true, endDate: true }
    });

    const takenYtd = leaves.reduce((sum, r) => {
      const s = r.startDate < yearStart ? yearStart : r.startDate;
      const e = r.endDate > yearEnd ? yearEnd : r.endDate;
      return sum + daysInclusive(s, e);
    }, 0);

    const takenThisMonth = leaves.reduce((sum, r) => {
      // overlap with current month
      const s = r.startDate < monthStart ? monthStart : r.startDate;
      const e = r.endDate > monthEnd ? monthEnd : r.endDate;
      return e >= s ? sum + daysInclusive(s, e) : sum;
    }, 0);

    const remaining = Math.max(0, entitlement - takenYtd);

    res.json({ entitlement, takenYtd, takenThisMonth, remaining });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message || 'Failed to compute dashboard' });
  }
}

export async function getWhoIsOnLeaveToday(req: Request, res: Response) {
  try {
    const today = req.query.date ? new Date(String(req.query.date)) : new Date();
    const start = new Date(today); start.setHours(0, 0, 0, 0);
    const end = new Date(today); end.setHours(23, 59, 59, 999);

    const rows = await prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: end },
        endDate: { gte: start },
      },
      select: {
        employee: { select: { id: true, firstName: true, lastName: true, designation: true, photoUrl: true } },
      },
      orderBy: { startDate: 'asc' }
    });

    const people = rows.map(r => ({
      id: r.employee.id,
      name: `${r.employee.firstName} ${r.employee.lastName}`,
      title: r.employee.designation,
      photoUrl: r.employee.photoUrl || null
    }));

    res.json(people);
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message || 'Failed to fetch today leave list' });
  }
}
type Person = {
  id: number;
  name: string;
  title: string | null;
  photoUrl: string | null;
  startDate: string; // ISO
  endDate: string;   // ISO
};

function atStartOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function atEndOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

function startOfISOWeek(d: Date) { // Monday as week start
  const x = atStartOfDay(d);
  const day = x.getDay(); // 0 Sun..6 Sat
  const diff = (day === 0 ? -6 : 1 - day); // move to Monday
  x.setDate(x.getDate() + diff);
  return x;
}
function endOfISOWeek(d: Date) {
  const s = startOfISOWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return atEndOfDay(e);
}

function startOfNextMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
}
function endOfNextMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 2, 0, 23, 59, 59, 999);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aEnd >= bStart && aStart <= bEnd;
}

export async function getWhoIsOnLeaveBuckets(req: Request, res: Response) {
  try {
    const base = req.query.date ? new Date(String(req.query.date)) : new Date();

    // Ranges
    const todayStart = atStartOfDay(base);
    const todayEnd = atEndOfDay(base);

    const weekStart = startOfISOWeek(base);
    const weekEnd = endOfISOWeek(base);

    const nextMonthStart = startOfNextMonth(base);
    const nextMonthEnd = endOfNextMonth(base);

    // Single fetch covering all ranges
    const minStart = weekStart;           // earliest we care about
    const maxEnd = nextMonthEnd;        // latest we care about

    const rows = await prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        AND: [
          { endDate: { gte: minStart } },  // overlaps window
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

    // Buckets with precedence: today > thisWeek > nextMonth
    const today: Person[] = [];
    const thisWeek: Person[] = [];
    const nextMonth: Person[] = [];

    // de-dupe per bucket (employee might have multiple requests)
    const seenToday = new Set<number>();
    const seenWeek = new Set<number>();
    const seenNext = new Set<number>();

    for (const r of rows) {
      const s = new Date(r.startDate);
      const e = new Date(r.endDate);
      const person: Person = {
        id: r.employee.id,
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        title: r.employee.designation,
        photoUrl: r.employee.photoUrl || null,
        startDate: new Date(r.startDate).toISOString(),
        endDate: new Date(r.endDate).toISOString(),
      };

      if (overlaps(s, e, todayStart, todayEnd)) {
        if (!seenToday.has(person.id)) { today.push(person); seenToday.add(person.id); }
        continue; // precedence
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
    res.status(500).json({ error: e?.message || 'Failed to fetch leave buckets' });
  }
}
function formatPhoneNumber(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("91")) return `+${digits}`;
  if (digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("+")) return digits;
  return `+${digits}`;
}

const TZ = "Asia/Kolkata";
const fmtDate = (d: Date | string | number) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(d));

function atStart(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export async function sendWhatsAppTemplate({
  to,
  templateId,
  placeholders
}: {
  to: string;
  templateId: string;
  placeholders: (string | number)[];
}) {
  const payload = {
    from: process.env.WHATSAPP_FROM_PHONE_NUMBER,
    to: formatPhoneNumber(to),
    type: "template",
    message: {
      templateid: templateId,
      placeholders: placeholders.map(String),
    },
  };
  const headers = {
    "Content-Type": "application/json",
    apikey: process.env.WHATSAPP_AUTH_TOKEN,
  };
  const url = process.env.WHATSAPP_API_URL!;
  const resp = await axios.post(url, payload, { headers });
  if (resp?.data?.code !== "200") {
    throw new Error(`WhatsApp send failed: ${JSON.stringify(resp.data)}`);
  }
  return resp.data;
}
