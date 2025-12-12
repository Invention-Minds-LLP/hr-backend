import { Request, Response } from "express";
// import { PrismaClient, LeaveStatus } from "@prisma/client";
import axios from "axios";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";
import cron from "node-cron";
import { da } from "date-fns/locale";

const LEAVE_APPLY_TEMPLATE_ID = "890321";
const LEAVE_STATUS_TEMPLATE_ID = "909803";
// Create Leave Request
export const createLeaveRequest = async (req: Request, res: Response) => {
  try {
    const { employeeId, leaveTypeId, startDate, endDate, reason } = req.body;

    if (!employeeId || !leaveTypeId || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const start = new Date(startDate);
    const leaveYear = start.getFullYear();
    const daysRequested = daysInclusive(start, new Date(endDate));
    // Fetch balance for that year & leave type
    const balance = await prisma.employeeLeaveBalance.findFirst({
      where: {
        employeeId: employeeId,
        leaveTypeId: leaveTypeId,
        year: leaveYear,
      }
    });


    if (!balance) {
      return res.status(400).json({
        error: `Leave balance not configured for ${leaveYear}`
      });
    }

    const remaining = balance.totalAllowed - balance.used;

    if (daysRequested > remaining) {
      return res.status(400).json({
        error: `Insufficient balance. You have only ${remaining} days available for this leave type.`
      });
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
      const name = [leaveRequest.employee.firstName, leaveRequest.employee.lastName]
        .filter(Boolean)
        .join(" ");
      const message = `${name} has applied for leave for ${days} day(s), from ${fmtDate(
        leaveRequest.startDate
      )} to ${fmtDate(leaveRequest.endDate)}. Please review and take the necessary action.`;

      await createNotification(mgrId, message);
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
      include: {
        leaveType: true,
        employee: {
          include: {
            Department: true,    // Gives departmentId + department name
            role: true           // Gives roleId + role name
          }
        }
      },
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

// export const updateLeaveStatus = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const { role, status, userId } = req.body;
//     // role = "MANAGER" or "HR"

//     if (!['MANAGER', 'HR'].includes(role)) {
//       return res.status(400).json({ error: 'Invalid role' });
//     }

//     if (!["Approved", "Declined"].includes(status)) {
//       return res.status(400).json({ error: "Invalid status value" });
//     }

//     const leave = await prisma.leaveRequest.findUnique({ where: { id: Number(id) } });
//     if (!leave) return res.status(404).json({ error: "Leave request not found" });

//     const data: any = {};

//     // --- Manager decision first ---
//     if (role === "MANAGER") {
//       if (leave.hodDecision !== "PENDING") {
//         return res.status(400).json({ error: "Manager already decided" });
//       }
//       data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//       data.hodDecidedAt = new Date();

//       if (data.hodDecision === "REJECTED") {
//         data.status = LeaveStatus.REJECTED;
//         data.declinedBy = userId;
//         data.declinedDate = new Date();
//       }
//     }

//     // --- HR decision second ---
//     else if (role === "HR") {
//       if (leave.hodDecision !== "APPROVED") {
//         return res.status(400).json({ error: "Manager approval required first" });
//       }
//       if (leave.hrDecision !== "PENDING") {
//         return res.status(400).json({ error: "HR already decided" });
//       }

//       data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//       data.hrDecidedAt = new Date();

//       if (data.hrDecision === "APPROVED") {
//         data.status = LeaveStatus.APPROVED;
//         data.approvedBy = userId;
//         data.approvedDate = new Date();
//         const leaveYear = leave.startDate.getFullYear();
//         const days = daysInclusive(leave.startDate, leave.endDate);

//         await prisma.employeeLeaveBalance.updateMany({
//           where: {
//             employeeId: leave.employeeId,
//             leaveTypeId: leave.leaveTypeId,
//             year: leaveYear
//           },
//           data: {
//             used: { increment: days }
//           }
//         });

//       } else {
//         data.status = LeaveStatus.REJECTED;
//         data.declinedBy = userId;
//         data.declinedDate = new Date();
//       }
//     }

//     const updatedLeave = await prisma.leaveRequest.update({
//       where: { id: Number(id) },
//       data,
//       include: { employee: true, leaveType: true },
//     });

//     // --- WhatsApp notify employee ---
//     const employee = updatedLeave.employee;
//     const employeePhone = formatPhoneNumber(employee?.phone || "");
//     const employeeName = [employee?.firstName, employee?.lastName].filter(Boolean).join(" ");
//     const days = daysInclusive(updatedLeave.startDate, updatedLeave.endDate);
//     const start = fmtDate(updatedLeave.startDate);
//     const end = fmtDate(updatedLeave.endDate);
//     const statusLabel =
//       updatedLeave.status === LeaveStatus.APPROVED ? "Approved" :
//         updatedLeave.status === LeaveStatus.REJECTED ? "Declined" : "Pending";

//     const message = `Your leave application for ${days} day(s), from ${start} to ${end}, has been ${statusLabel}. Please contact the concerned person for more details.`;

//     if(statusLabel === "Approved" || statusLabel === "Declined") {
//       await createNotification(updatedLeave.employeeId, message);
//     }

//     if (employeePhone && updatedLeave.status === "APPROVED" ||
//       (updatedLeave.status === "REJECTED" && (role === "HR" || role === "MANAGER"))) {
//       try {
//         await sendWhatsAppTemplate({
//           to: employeePhone,
//           templateId: LEAVE_STATUS_TEMPLATE_ID,
//           placeholders: [employeeName, days, start, end, statusLabel],
//         });
//       } catch (e: any) {
//         console.error("Leave status WA send failed:", e?.message || e);
//       }
//     }

//     res.json(updatedLeave);
//   } catch (error) {
//     console.error("Error updating leave status:", error);
//     res.status(500).json({ error: "Failed to update leave status" });
//   }
// };
export const updateLeaveStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role, status, userId } = req.body;
    // role = "REPORTING_MANAGER", "HR_MANAGER", "MANAGEMENT"

    if (!["Approved", "Declined"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Fetch leave with employee and department
    const leave = await prisma.leaveRequest.findUnique({
      where: { id: Number(id) },
      include: {
        employee: {
          include: {
            Department: true
          }
        }
      }
    });

    if (!leave) return res.status(404).json({ error: "Leave not found" });

    const emp = leave.employee;

    const roleId = emp.roleId;               // 1=HR Manager, 2=Employee, 3=Reporting Manager, 4=Management
    const deptId = emp.departmentId;         // HR department = 1
    const isHRDept = deptId === 1;           // HR Employee or HR Manager

    const data: any = {};

    // ================================================================
    //  1️⃣ HR EMPLOYEE (dept = 1, roleId ≠ HR Manager)
    // ================================================================
    if (isHRDept && roleId !== 1) {
      // Only HR Manager can approve at Level 1
      if (role !== "HR_MANAGER") {
        return res.status(400).json({ error: "Only HR Manager can approve HR employees" });
      }

      data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
      data.hodDecidedAt = new Date();

    
      data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
      data.hrDecidedAt = new Date();
      data.status = status === "Approved" ? "APPROVED" : "REJECTED";

      if (status === "Declined") {
        data.declinedBy = userId;
        data.declinedDate = new Date();
        data.declineReason = req.body.declineReason || null;
      }
    }

    // ================================================================
    //  2️⃣ HR MANAGER (roleId = 1)
    // ================================================================
    else if (roleId === 1) {
      if (role !== "MANAGEMENT") {
        return res.status(400).json({ error: "Only Management can approve HR Manager leave" });
      }

      data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
      data.hodDecidedAt = new Date();

      // No HR step for HR Manager

      data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
      data.hrDecidedAt = new Date();
      data.status = status === "Approved" ? "APPROVED" : "REJECTED";

      if (status === "Declined") {
        data.declinedBy = userId;
        data.declinedDate = new Date();
        data.declineReason = req.body.declineReason || null;
      }
    }

    // ================================================================
    //  3️⃣ REPORTING MANAGERS (roleId = 3) AND HOD (same logic)
    //    Level 1 = Management
    //    Level 2 = HR Manager
    // ================================================================
    else if (roleId === 3 || roleId === 5 /* HOD role if exists */) {

      // Level 1: Management
      if (role === "MANAGEMENT") {
        data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
        data.hodDecidedAt = new Date();

        if (status === "Declined") {
          data.status = "REJECTED";
          data.declinedBy = userId;
          data.declinedDate = new Date();
          data.declineReason = req.body.declineReason || null;
        }
      }

      // Level 2: HR Manager
      else if (role === "HR_MANAGER") {
        if (leave.hodDecision !== "APPROVED") {
          return res.status(400).json({ error: "Management approval required first" });
        }

        data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
        data.hrDecidedAt = new Date();

        data.status = status === "Approved" ? "APPROVED" : "REJECTED";

        if (status === "Declined") {
          data.declinedBy = userId;
          data.declinedDate = new Date();
          data.declineReason = req.body.declineReason || null;
        }
      }

      else {
        return res.status(400).json({ error: "Invalid approver for Reporting Manager/HOD" });
      }
    }

    // ================================================================
    //  4️⃣ NORMAL EMPLOYEE (roleId = 2)
    //    Level 1 = Reporting Manager
    //    Level 2 = HR Manager
    // ================================================================
    else if (roleId === 2) {
      // Level 1: Reporting Manager
      if (role === "REPORTING_MANAGER") {
        data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
        data.hodDecidedAt = new Date();

        if (status === "Declined") {
          data.status = "REJECTED";
          data.declinedBy = userId;
          data.declinedDate = new Date();
          data.declineReason = req.body.declineReason || null;
        }
      }

      // Level 2: HR Manager
      else if (role === "HR_MANAGER") {
        if (leave.hodDecision !== "APPROVED") {
          return res.status(400).json({ error: "Manager approval required first" });
        }

        data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
        data.hrDecidedAt = new Date();

        data.status = status === "Approved" ? "APPROVED" : "REJECTED";

        if (status === "Declined") {
          data.declinedBy = userId;
          data.declinedDate = new Date();
          data.declineReason = req.body.declineReason || null;
        }
      }

      else {
        return res.status(400).json({ error: "Unauthorized approver" });
      }
    }

    // ================================================================
    //  SAVE UPDATED LEAVE & UPDATE BALANCES
    // ================================================================
    const updatedLeave = await prisma.leaveRequest.update({
      where: { id: Number(id) },
      data,
      include: { employee: true, leaveType: true }
    });

    // If fully approved → deduct leave balance
    if (updatedLeave.status === "APPROVED") {
      const year = updatedLeave.startDate.getFullYear();
      const days = daysInclusive(updatedLeave.startDate, updatedLeave.endDate);

      await prisma.employeeLeaveBalance.updateMany({
        where: {
          employeeId: updatedLeave.employeeId,
          leaveTypeId: updatedLeave.leaveTypeId,
          year
        },
        data: {
          used: { increment: days }
        }
      });
    }

    // Notifications (optional)
    const employeePhone = formatPhoneNumber(updatedLeave.employee.phone);
    const employeeName = `${updatedLeave.employee.firstName} ${updatedLeave.employee.lastName}`;
    const start = fmtDate(updatedLeave.startDate);
    const end = fmtDate(updatedLeave.endDate);
    const days = daysInclusive(updatedLeave.startDate, updatedLeave.endDate);
    const statusLabel = updatedLeave.status;

    await createNotification(
      updatedLeave.employeeId,
      `Your leave request from ${start} to ${end} (${days} days) has been ${statusLabel}.`
    );

    res.json(updatedLeave);

  } catch (error) {
    console.error("Error updating leave:", error);
    res.status(500).json({ error: "Failed to update leave" });
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
export const getBlockedDates = async (req: Request, res: Response) => {
  const employeeId = Number(req.params.employeeId);

  const existing = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: { in: ["APPROVED", "PENDING"] }
    },
    select: { startDate: true, endDate: true }
  });

  return res.json(existing);
};
export const getLeaveBalance = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const year = Number(req.query.year) || new Date().getFullYear();

    const balances = await prisma.employeeLeaveBalance.findMany({
      where: { employeeId, year, category: 'LEAVE' },
      include: { leaveType: true }
    });

    res.json(
      balances.map(b => ({
        leaveTypeId: b.leaveTypeId,
        leaveType: b.leaveType?.name ?? null,
        totalAllowed: b.totalAllowed,
        used: b.used,
        remaining: b.totalAllowed - b.used,
        year: b.year
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch leave balance" });
  }
};
export const initLeaveEndSchedular = () => {
  cron.schedule("0 9 * * *", async () => {
    console.log("Running leave reminder cron...");

    const today = new Date();

    const leaves = await prisma.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        endDate: today
      },
      include: {
        employee: true,
        leaveType: true,
      }
    });

    for (const leave of leaves) {
      const start = new Date(leave.startDate);
      const end = new Date(leave.endDate);

      const duration =
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

      console.log(`Checking leave ID ${leave.id} for ${leave.employee.firstName}: ${fmtDate(start)} to ${fmtDate(end)} (${duration} days)`);

      // RULE: Only send if leave duration > 1 day
      if (duration <= 1) continue;

      // Last day check
      if (isSameDate(today, end)) {
        const emp = leave.employee;

        if (!emp.phone) continue;

        const message = `Hello ${emp.firstName}, today is the *last day of your approved leave*. Please be prepared to report tomorrow.`;

        console.log(`Leave End Reminder to ${emp.firstName} (${emp.phone}): ${message}`);

        // await sendWhatsAppMessage(emp.phone, message);
      }
    }
  });

}

function isSameDate(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}