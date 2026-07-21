import { Request, Response } from "express";
// import { PrismaClient, LeaveStatus } from "@prisma/client";
import axios from "axios";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";
import cron from "node-cron";
import { Prisma } from "@prisma/client";
import formidable from "formidable";
import { File } from "formidable";
import * as XLSX from "xlsx";
import pLimit from "p-limit";
import { PermissionType } from "@prisma/client";
import fs from "fs";
// Legacy FTP upload (kept for reference / fallback). Files now go to local disk.
// import { Client } from "basic-ftp";
import { saveLocal, publicUrl } from "../../lib/fileStorage";
import path from "path";
import { max } from "date-fns";
import { config } from "../../config";

// Legacy FTP credentials — no longer used now that uploads are stored locally.
// const FTP_CONFIG = {
//   host: config.ftp.host,
//   user: config.ftp.user,
//   password: config.ftp.pass,
//   secure: config.ftp.secure,
// };

type Tx = Prisma.TransactionClient;

const LEAVE_APPLY_TEMPLATE_ID = "890321";
const LEAVE_STATUS_TEMPLATE_ID = "909803";


// Create Leave Request
export const createLeaveRequest = async (req: Request, res: Response) => {
  try {
    const { employeeId, leaveTypeId, startDate, endDate, reason, isHalfDay, halfDaySession } = req.body;

    if (!employeeId || !leaveTypeId || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const start = new Date(startDate);
    const year = getFinancialYear(start);
    // const leaveYear = getFinancialYear(start);
    // const daysRequested = daysInclusive(start, new Date(endDate));
    const end = new Date(endDate);
    if (end < start) return res.status(400).json({ error: "endDate cannot be before startDate" });

    // validate leave type exists
    const lt = await prisma.leaveType.findUnique({ where: { id: Number(leaveTypeId) } });
    if (!lt) return res.status(400).json({ error: "Invalid leave type" });

    if (lt.name === "CO" && isHalfDay) {
      return res.status(400).json({ error: "Half-day not allowed for CO" });
    }

    // ── Rule A: one leave TYPE per ISO week ──────────────────────────
    // If the employee already has a PENDING/APPROVED leave of a DIFFERENT
    // type touching any week of this request, block it. (RH / CO exempt.)
    const weeklyClash = await findWeeklyTypeConflict(
      Number(employeeId), Number(leaveTypeId), lt.name, start, end,
    );
    if (weeklyClash) {
      const wkLabel = startOfISOWeek(new Date(weeklyClash.startDate))
        .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      return res.status(400).json({
        error: `You already have a ${weeklyClash.leaveType.name} leave in the week of ${wkLabel}. `
             + `Only one leave type is allowed per week — please use ${weeklyClash.leaveType.name} for these dates `
             + `or pick dates in a different week.`,
      });
    }

    // Allow advance applications for the next FY when rollover hasn't run yet
    // (e.g., applying for April leave while still in March)
    const currentFY = getFinancialYear(new Date());
    // const isAdvanceNextFY = !balance && year === currentFY + 1;

    // NOTE: a missing balance row no longer blocks the application. For
    // balance-based types the shortfall (or the whole leave, if no balance is
    // configured) is booked as LOP at approval. CO/RH/LOP never use a balance.

    // const year = start.getFullYear();
    // EL counts week-offs that fall inside the range (sandwich rule).
    const isEarnedLeave = lt.name === "EL";
    const requestedUnits = isHalfDay
      ? 0.5
      : await countWorkingDays(employeeId, start, end, { includeWeekOffs: isEarnedLeave });
    if (isHalfDay && !isSameDate(new Date(startDate), new Date(endDate))) {
      return res.status(400).json({ error: "Half-day must be a single date" });
    }
    if (isHalfDay && !halfDaySession) {
      return res.status(400).json({ error: "halfDaySession is required for half-day" });
    }

    if (lt.name === "CL" && requestedUnits > 2) {
      return res.status(400).json({
        error: "Casual Leave (CL) can be applied for a maximum of 2 days at a time",
      });
    }

    // ── RH (Restricted Holiday) validations ───────────────────────────────
    if (lt.name === "RH") {
      // RH must be exactly 1 day
      if (requestedUnits > 1) {
        return res.status(400).json({ error: "RH can only be applied for 1 day at a time" });
      }

      // RH date must fall on an optional holiday
      // The start date from frontend is IST midnight in UTC (e.g. 2026-04-02T18:30:00Z for April 3rd IST)
      // Holiday dates are stored as UTC midnight (e.g. 2026-04-03T00:00:00Z)
      // So we need to check a window around the start date to account for timezone
      const rhDateStart = new Date(start.getTime() - 6 * 60 * 60 * 1000); // -6 hours buffer
      const rhDateEnd = new Date(start.getTime() + 24 * 60 * 60 * 1000);   // +24 hours buffer

      const optionalHoliday = await prisma.holiday.findFirst({
        where: {
          isOptional: true,
          date: {
            gte: rhDateStart,
            lt: rhDateEnd,
          },
        },
      });

      if (!optionalHoliday) {
        return res.status(400).json({
          error: "RH can only be applied on a Restricted Holiday (optional holiday) date",
        });
      }

      // Max 2 RH allowed per financial year (out of available optional holidays)
      const MAX_RH_PER_YEAR = 2;

      const rhUsedCount = await prisma.leaveRequest.count({
        where: {
          employeeId: Number(employeeId),
          leaveTypeId: Number(leaveTypeId),
          status: { in: ["PENDING", "APPROVED"] },
          startDate: { gte: new Date(Date.UTC(year, 3, 1)) },
          endDate: { lt: new Date(Date.UTC(year + 1, 3, 1)) },
        },
      });

      if (rhUsedCount >= MAX_RH_PER_YEAR) {
        return res.status(400).json({
          error: `Maximum ${MAX_RH_PER_YEAR} Restricted Holidays allowed per financial year. You have already used ${rhUsedCount}.`,
        });
      }
    }

    // Compute the paid-vs-LOP preview (informational only — the authoritative
    // split is recomputed and persisted at final approval, since the balance
    // can change in between). We no longer block on insufficient balance:
    // the shortfall is simply booked as LOP. CO consumes comp-off credits and
    // RH consumes optional holidays, so neither has a balance-based LOP; the
    // explicit LOP type is always fully unpaid.
    let lopPreview = 0;
    if (lt.name === "LOP") {
      lopPreview = requestedUnits;
    } else if (lt.name !== "CO" && lt.name !== "RH") {
      const bal = await getBalance(Number(employeeId), Number(leaveTypeId), year);
      const remaining = bal ? (bal.totalAllowed ?? 0) - computeTotalUsed(bal) : 0;
      lopPreview = Math.max(0, requestedUnits - Math.max(0, remaining));
    }

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
        isHalfDay,
        halfDaySession
      },
      include: {
        leaveType: true,
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true, reportingManager: true, inchargeId: true, departmentId: true }
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
    const emp = leaveRequest.employee;
    const notifyTo = emp.inchargeId ?? emp.reportingManager;
    const mgrId = leaveRequest?.employee?.reportingManager;
    // if (mgrId) {
    //   const manager = await prisma.employee.findUnique({
    //     where: { id: mgrId },
    //     select: { phone: true, firstName: true, lastName: true }
    //   });
    //   mgrPhone = manager?.phone ?? undefined;
    //   const name = [leaveRequest.employee.firstName, leaveRequest.employee.lastName]
    //     .filter(Boolean)
    //     .join(" ");
    //   const message = `${name} has applied for leave for ${days} day(s), from ${fmtDate(
    //     leaveRequest.startDate
    //   )} to ${fmtDate(leaveRequest.endDate)}. Please review and take the necessary action.`;

    //   await createNotification(mgrId, message);
    // }

    // if (mgrPhone) {
    //   try {
    //     await sendWhatsAppTemplate({
    //       to: formatPhoneNumber(mgrPhone),
    //       templateId: LEAVE_APPLY_TEMPLATE_ID,
    //       placeholders,
    //     });
    //     notifyStatus = "sent";
    //   } catch (e: any) {
    //     notifyStatus = "failed";
    //     notifyError = e?.message || "WhatsApp send failed";
    //     // log but do NOT fail the API just because notification failed
    //     console.error("WFH notify (manager) failed:", e);
    //   }
    // }
    const recipients = new Set<number>();

    // If employee is HR (dept 1)
    if (emp.departmentId === 1) {
      if (emp.reportingManager) {
        recipients.add(emp.reportingManager);
      }
    } else {
      // Normal employee

      if (emp.inchargeId) {
        recipients.add(emp.inchargeId);
      }

      if (emp.reportingManager) {
        recipients.add(emp.reportingManager);
      }

      // Add HR managers (dept 1)
      const hrManagers = await prisma.employee.findMany({
        where: {
          departmentId: 1,
          employmentStatus: "ACTIVE"
        },
        select: { id: true }
      });

      hrManagers.forEach(hr => recipients.add(hr.id));
    }
    // const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ");

    const message = `${name} has applied for leave for ${days} day(s), from ${fmtDate(
      leaveRequest.startDate
    )} to ${fmtDate(leaveRequest.endDate)}. Please review and take action.`;

    for (const id of recipients) {
      await createNotification(id, message);
    }

    if (notifyTo) {
      const approver = await prisma.employee.findUnique({
        where: { id: notifyTo },
        select: { phone: true }
      });
      const name = [leaveRequest.employee.firstName, leaveRequest.employee.lastName]
        .filter(Boolean)
        .join(" ");

      // const message = `${name} has applied for leave for ${days} day(s), from ${fmtDate(
      //   leaveRequest.startDate
      // )} to ${fmtDate(leaveRequest.endDate)}. Please review and take the necessary action.`;

      // await createNotification(notifyTo, message);

      // if (approver?.phone) {
      //   await sendWhatsAppTemplate({
      //     to: formatPhoneNumber(approver.phone),
      //     templateId: LEAVE_APPLY_TEMPLATE_ID,
      //     placeholders,
      //   });
      // }
    }


    res.status(201).json({ ...leaveRequest, lopPreview });
  } catch (error) {
    console.error("Error creating leave request:", error);
    res.status(500).json({ error: "Failed to create leave request" });
  }
};

// ─────────────────────────────────────────────────────────────────
// EDIT a pending leave request
// Only allowed when no approver (incharge / RM/HOD / HR) has acted yet,
// AND the overall status is still PENDING.
// ─────────────────────────────────────────────────────────────────
export const updateLeaveRequest = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { startDate, endDate, reason, isHalfDay, halfDaySession, leaveTypeId } = req.body;
    const userId = (req as any).user?.empId ?? null;

    const existing = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Leave request not found" });

    // Only the owner may edit
    if (userId && existing.employeeId !== Number(userId)) {
      return res.status(403).json({ error: "You can only edit your own leave request" });
    }

    // Block edit once any approver has acted
    if (existing.status !== "PENDING") {
      return res.status(400).json({ error: `Cannot edit a ${existing.status.toLowerCase()} leave request` });
    }
    if (
      existing.inChargeDecision !== "PENDING" ||
      existing.hodDecision      !== "PENDING" ||
      existing.hrDecision       !== "PENDING"
    ) {
      return res.status(400).json({ error: "Cannot edit — at least one approver has already acted" });
    }

    // Build a partial update payload; only include fields the user actually sent
    const data: any = { updatedAt: new Date() };
    if (startDate)         data.startDate = new Date(startDate);
    if (endDate)           data.endDate   = new Date(endDate);
    if (reason !== undefined)         data.reason         = reason;
    if (isHalfDay !== undefined)      data.isHalfDay      = !!isHalfDay;
    if (halfDaySession !== undefined) data.halfDaySession = halfDaySession;
    if (leaveTypeId)       data.leaveTypeId = Number(leaveTypeId);

    if (data.startDate && data.endDate && data.endDate < data.startDate) {
      return res.status(400).json({ error: "endDate cannot be before startDate" });
    }

    const updated = await prisma.leaveRequest.update({ where: { id }, data });
    return res.json(updated);
  } catch (err: any) {
    console.error("Error updating leave request:", err);
    return res.status(500).json({ error: err.message || "Failed to update leave request" });
  }
};

// ─────────────────────────────────────────────────────────────────
// CANCEL a pending leave request
// Same rule as edit — disallowed once any approver has acted.
// ─────────────────────────────────────────────────────────────────
export const cancelLeaveRequest = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body ?? {};
    const userId = (req as any).user?.empId ?? null;

    const existing = await prisma.leaveRequest.findUnique({
      where: { id },
      include: {
        leaveType: true,
        employee: {
          select: {
            firstName: true, lastName: true, employeeCode: true,
            reportingManager: true, inchargeId: true, departmentId: true,
          },
        },
      },
    });
    if (!existing) return res.status(404).json({ error: "Leave request not found" });

    if (userId && existing.employeeId !== Number(userId)) {
      return res.status(403).json({ error: "You can only cancel your own leave request" });
    }
    if (existing.status === "CANCELLED") {
      return res.status(400).json({ error: "Already cancelled" });
    }
    if (
      existing.status !== "PENDING" ||
      existing.inChargeDecision !== "PENDING" ||
      existing.hodDecision      !== "PENDING" ||
      existing.hrDecision       !== "PENDING"
    ) {
      return res.status(400).json({ error: "Cannot cancel — request has already been actioned" });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: userId ? Number(userId) : null,
        cancellationReason: reason ?? "Cancelled by employee",
      },
    });

    // ── Notify the same people who were notified on creation ────────
    const emp = existing.employee;
    const recipients = new Set<number>();
    if (emp.departmentId === 1) {
      // HR employee → only their reporting manager
      if (emp.reportingManager) recipients.add(emp.reportingManager);
    } else {
      if (emp.inchargeId)       recipients.add(emp.inchargeId);
      if (emp.reportingManager) recipients.add(emp.reportingManager);
      const hrManagers = await prisma.employee.findMany({
        where: { departmentId: 1, employmentStatus: "ACTIVE" },
        select: { id: true },
      });
      hrManagers.forEach((hr) => recipients.add(hr.id));
    }

    const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ");
    const days = daysInclusive(existing.startDate, existing.endDate);
    const message =
      `${name} has CANCELLED their ${existing.leaveType?.name ?? "leave"} request for ${days} day(s), ` +
      `from ${fmtDate(existing.startDate)} to ${fmtDate(existing.endDate)}. ` +
      `Reason: ${reason ?? "Cancelled by employee"}.`;

    for (const rid of recipients) {
      try {
        await createNotification(rid, message);
      } catch (notifyErr) {
        console.error(`Failed to notify recipient ${rid}:`, notifyErr);
        // Don't fail the cancellation if notification delivery fails
      }
    }

    return res.json(updated);
  } catch (err: any) {
    console.error("Error cancelling leave request:", err);
    return res.status(500).json({ error: err.message || "Failed to cancel leave request" });
  }
};

// Get All Leave Requests (optional)
export const getLeaveRequests = async (_req: Request, res: Response) => {
  try {
    const leaves = await prisma.leaveRequest.findMany({
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        reason: true,
        declineReason: true,
        hodDecision: true,
        hrDecision: true,
        inChargeDecision: true,
        createdAt: true,
        isHalfDay: true,
        halfDaySession: true,
        prescriptionUrl: true,

        leaveType: {
          select: {
            name: true,
          },
        },

        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            email: true,
            departmentId: true,
            reportingManager: true,
            inchargeId: true,
            roleId: true,
            gender: true,
            photoUrl: true,

            designation: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(leaves);
  } catch (error) {
    console.error('Error fetching leave requests:', error);
    res.status(500).json({ error: 'Failed to fetch leave requests' });
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
//     // role = "REPORTING_MANAGER", "HR_MANAGER", "MANAGEMENT"

//     if (!["Approved", "Declined"].includes(status)) {
//       return res.status(400).json({ error: "Invalid status" });
//     }

//     // Fetch leave with employee and department
//     const leave = await prisma.leaveRequest.findUnique({
//       where: { id: Number(id) },
//       include: {
//         employee: {
//           include: {
//             Department: true
//           }
//         }
//       }
//     });

//     if (!leave) return res.status(404).json({ error: "Leave not found" });

//     const emp = leave.employee;

//     const roleId = emp.roleId;               // 1=HR Manager, 2=Employee, 3=Reporting Manager, 4=Management
//     const deptId = emp.departmentId;         // HR department = 1
//     const isHRDept = deptId === 1;           // HR Employee or HR Manager
//     const hasIncharge = !!emp.inchargeId;
//     const approved = status === "Approved";

//     const data: any = {};


//     /* ================================================================
//   NEW INCHARGE LEVEL (ONLY IF EXISTS)
// ================================================================ */
//     if (hasIncharge && role === "INCHARGE") {
//       data.inChargeDecision = approved ? "APPROVED" : "REJECTED";
//       data.inChargeDecidedAt = new Date();

//       if (!approved) {
//         data.status = "REJECTED";
//         data.declinedBy = userId;
//         data.declinedDate = new Date();
//         data.declineReason = req.body.declineReason || null;
//       }

//       const updated = await prisma.leaveRequest.update({
//         where: { id: Number(id) },
//         data
//       });

//       return res.json(updated);
//     }

//     /* ================================================================
//         BLOCK OTHERS IF INCHARGE EXISTS & NOT APPROVED YET
//     ================================================================ */
//     if (hasIncharge && leave.inChargeDecision !== "APPROVED") {
//       return res.status(400).json({
//         error: "Incharge approval required first"
//       });
//     }

//     // ================================================================
//     //   HR EMPLOYEE (dept = 1, roleId ≠ HR Manager)
//     // ================================================================
//     if (isHRDept && roleId !== 1) {
//       // Only HR Manager can approve at Level 1
//       if (role !== "HR_MANAGER") {
//         return res.status(400).json({ error: "Only HR Manager can approve HR employees" });
//       }

//       data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//       data.hodDecidedAt = new Date();


//       data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//       data.hrDecidedAt = new Date();
//       data.status = status === "Approved" ? "APPROVED" : "REJECTED";

//       if (status === "Declined") {
//         data.declinedBy = userId;
//         data.declinedDate = new Date();
//         data.declineReason = req.body.declineReason || null;
//       }
//     }

//     // ================================================================
//     //   HR MANAGER (roleId = 1)
//     // ================================================================
//     else if (roleId === 1) {
//       if (role !== "MANAGEMENT") {
//         return res.status(400).json({ error: "Only Management can approve HR Manager leave" });
//       }

//       data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//       data.hodDecidedAt = new Date();

//       // No HR step for HR Manager

//       data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//       data.hrDecidedAt = new Date();
//       data.status = status === "Approved" ? "APPROVED" : "REJECTED";

//       if (status === "Declined") {
//         data.declinedBy = userId;
//         data.declinedDate = new Date();
//         data.declineReason = req.body.declineReason || null;
//       }
//     }

//     // ================================================================
//     //   REPORTING MANAGERS (roleId = 3) AND HOD (same logic)
//     //    Level 1 = Management
//     //    Level 2 = HR Manager
//     // ================================================================
//     else if (roleId === 3 || roleId === 5 /* HOD role if exists */) {

//       // Level 1: Management
//       if (role === "MANAGEMENT") {
//         data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//         data.hodDecidedAt = new Date();

//         if (status === "Declined") {
//           data.status = "REJECTED";
//           data.declinedBy = userId;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//       }

//       // Level 2: HR Manager
//       else if (role === "HR_MANAGER") {
//         if (leave.hodDecision !== "APPROVED") {
//           return res.status(400).json({ error: "Management approval required first" });
//         }

//         data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//         data.hrDecidedAt = new Date();

//         data.status = status === "Approved" ? "APPROVED" : "REJECTED";

//         if (status === "Declined") {
//           data.declinedBy = userId;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//       }

//       else {
//         return res.status(400).json({ error: "Invalid approver for Reporting Manager/HOD" });
//       }
//     }

//     // ================================================================
//     //   NORMAL EMPLOYEE (roleId = 2)
//     //    Level 1 = Reporting Manager
//     //    Level 2 = HR Manager
//     // ================================================================
//     else if (roleId === 2) {
//       // Level 1: Reporting Manager
//       if (role === "REPORTING_MANAGER") {
//         data.hodDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//         data.hodDecidedAt = new Date();

//         if (status === "Declined") {
//           data.status = "REJECTED";
//           data.declinedBy = userId;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//       }

//       // Level 2: HR Manager
//       else if (role === "HR_MANAGER") {
//         if (leave.hodDecision !== "APPROVED") {
//           return res.status(400).json({ error: "Manager approval required first" });
//         }

//         data.hrDecision = status === "Approved" ? "APPROVED" : "REJECTED";
//         data.hrDecidedAt = new Date();

//         data.status = status === "Approved" ? "APPROVED" : "REJECTED";

//         if (status === "Declined") {
//           data.declinedBy = userId;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//       }

//       else {
//         return res.status(400).json({ error: "Unauthorized approver" });
//       }
//     }

//     // ================================================================
//     //  SAVE UPDATED LEAVE & UPDATE BALANCES
//     // ================================================================
//     const updatedLeave = await prisma.leaveRequest.update({
//       where: { id: Number(id) },
//       data,
//       include: { employee: true, leaveType: true }
//     });

//     console.log("Updated Leave:", updatedLeave);

//     // If fully approved → deduct leave balance
//     if (updatedLeave.status === "APPROVED") {
//       if (updatedLeave.leaveType.name === "CO") {
//         const today = new Date();
//         today.setHours(0, 0, 0, 0);

//         // Always full day for CO
//         const requiredDays = daysInclusive(
//           updatedLeave.startDate,
//           updatedLeave.endDate
//         );

//         // Fetch valid credits (earliest expiry first)
//         const credits = await prisma.compOffCredit.findMany({
//           where: {
//             employeeId: updatedLeave.employeeId,
//             used: false,
//             expiryDate: { gte: today }
//           },
//           orderBy: {
//             expiryDate: "asc"
//           }
//         });

//         if (credits.length < requiredDays) {
//           throw new Error("Not enough comp-off credits");
//         }

//         const toUse = credits.slice(0, requiredDays);

//         for (const credit of toUse) {
//           await prisma.compOffCredit.update({
//             where: { id: credit.id },
//             data: {
//               used: true,
//               usedOn: new Date(),
//               leaveId: updatedLeave.id
//             }
//           });
//         }
//       }



//       if (updatedLeave.leaveType.name !== "CO") {
//         const year = updatedLeave.startDate.getFullYear();

//         if (updatedLeave.isHalfDay) {
//           await prisma.employeeLeaveBalance.updateMany({
//             where: {
//               employeeId: updatedLeave.employeeId,
//               leaveTypeId: updatedLeave.leaveTypeId,
//               year
//             },
//             data: {
//               halfDayUsed: { increment: 1 }
//             }
//           });
//         } else {
//           const days = daysInclusive(updatedLeave.startDate, updatedLeave.endDate);

//           await prisma.employeeLeaveBalance.updateMany({
//             where: {
//               employeeId: updatedLeave.employeeId,
//               leaveTypeId: updatedLeave.leaveTypeId,
//               year
//             },
//             data: {
//               used: { increment: days }
//             }
//           });
//         }
//       }



//     }

//     // Notifications (optional)
//     const employeePhone = formatPhoneNumber(updatedLeave.employee.phone);
//     const employeeName = `${updatedLeave.employee.firstName} ${updatedLeave.employee.lastName}`;
//     const start = fmtDate(updatedLeave.startDate);
//     const end = fmtDate(updatedLeave.endDate);
//     const days = daysInclusive(updatedLeave.startDate, updatedLeave.endDate);
//     const statusLabel = updatedLeave.status;

//     // await createNotification(
//     //   updatedLeave.employeeId,
//     //   `Your leave request from ${start} to ${end} (${days} days) has been ${statusLabel}.`
//     // );

//     res.json(updatedLeave);

//   } catch (error) {
//     console.error("Error updating leave:", error);
//     res.status(500).json({ error: "Failed to update leave" });
//   }
// };


// export const createLeaveBalances = async (req: Request, res: Response) => {
//   try {
//     const { employeeId, year, leaves = [], permissions = [] } = req.body;

//     if (!employeeId || !year) {
//       return res.status(400).json({ error: "employeeId and year are required" });
//     }

//     const rows: any[] = [];

//     // LEAVES
//     for (const l of leaves) {
//       rows.push({
//         employeeId,
//         leaveTypeId: l.leaveTypeId,
//         permissionType: null,
//         category: "LEAVE",
//         year,
//         totalAllowed: l.totalAllowed,
//         used: 0
//       });
//     }

//     // PERMISSIONS
//     for (const p of permissions) {
//       rows.push({
//         employeeId,
//         leaveTypeId: null,
//         permissionType: p.permissionType,
//         category: "PERMISSION",
//         year,
//         totalAllowed: p.totalAllowed,
//         used: 0
//       });
//     }

//     // Upsert to avoid duplicates
//     for (const row of rows) {
//       await prisma.employeeLeaveBalance.upsert({
//         where: {
//           employeeId_leaveTypeId_permissionType_year: {
//             employeeId: row.employeeId,
//             leaveTypeId: row.leaveTypeId,
//             permissionType: row.permissionType,
//             year: row.year
//           }
//         },
//         update: {
//           totalAllowed: row.totalAllowed
//         },
//         create: row
//       });
//     }

//     res.json({ message: "Leave balances saved successfully" });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to create leave balances" });
//   }
// };
// export const createLeaveBalances = async (req: Request, res: Response) => {
//   try {
//     const { employeeId, year, leaves = [], permissions = [] } = req.body;

//     if (!employeeId || !year) {
//       return res.status(400).json({ error: "employeeId and year are required" });
//     }

//     const rows: any[] = [];

//     // LEAVES
//     for (const l of leaves) {
//       rows.push({
//         employeeId,
//         leaveTypeId: l.leaveTypeId,
//         permissionType: null,
//         category: "LEAVE",
//         year,
//         totalAllowed: l.totalAllowed,
//         used: l.used ?? 0 // ✅ IMPORTANT
//       });
//     }

//     // PERMISSIONS
//     for (const p of permissions) {
//       rows.push({
//         employeeId,
//         leaveTypeId: null,
//         permissionType: p.permissionType,
//         category: "PERMISSION",
//         year,
//         totalAllowed: p.totalAllowed,
//         used: p.used ?? 0 // ✅ IMPORTANT
//       });
//     }

//     for (const row of rows) {
//       await prisma.employeeLeaveBalance.upsert({
//         where: {
//           employeeId_leaveTypeId_permissionType_year: {
//             employeeId: row.employeeId,
//             leaveTypeId: row.leaveTypeId,
//             permissionType: row.permissionType,
//             year: row.year
//           }
//         },
//         update: {
//           totalAllowed: row.totalAllowed,
//           used: row.used // ✅ UPDATE USED
//         },
//         create: row
//       });
//     }

//     res.json({ message: "Leave balances saved successfully" });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to create leave balances" });
//   }
// };
// export const updateLeaveStatus = async (req: Request, res: Response) => {
//   try {
//     const leaveId = Number(req.params.id);
//     const { role, status, userId } = req.body as {
//       role: "INCHARGE" | "REPORTING_MANAGER" | "HR_MANAGER" | "MANAGEMENT";
//       status: "Approved" | "Declined";
//       userId?: number;
//       declineReason?: string;
//     };

//     if (!leaveId || !role || !status) {
//       return res.status(400).json({ error: "id, role, status are required" });
//     }

//     if (!["Approved", "Declined"].includes(status)) {
//       return res.status(400).json({ error: "Invalid status" });
//     }



//     const approved = status === "Approved";

//     const result = await prisma.$transaction(async (tx: Tx) => {
//       const leave = await tx.leaveRequest.findUnique({
//         where: { id: leaveId },
//         include: {
//           leaveType: true,
//           employee: true,
//         },
//       });

//       if (!leave) {
//         return { kind: "ERR" as const, status: 404, body: { error: "Leave not found" } };
//       }

//       // Already final? (optional hard guard)
//       if (leave.status === "APPROVED" || leave.status === "REJECTED") {
//         return { kind: "ERR" as const, status: 400, body: { error: "Leave already finalized" } };
//       }

//       const emp = leave.employee;
//       const roleId = emp.roleId; // your mapping
//       const deptId = emp.departmentId;
//       const isHRDept = deptId === 1;
//       const hasIncharge = !!emp.inchargeId;

//       const data: any = {};

//       // --------------------------
//       // INCHARGE LEVEL (if exists)
//       // --------------------------
//       if (hasIncharge && role === "INCHARGE") {
//         data.inChargeDecision = approved ? "APPROVED" : "REJECTED";
//         data.inChargeDecidedAt = new Date();

//         if (!approved) {
//           data.status = "REJECTED";
//           data.declinedBy = userId ?? null;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }

//         const updated = await tx.leaveRequest.update({
//           where: { id: leaveId },
//           data,
//           include: { leaveType: true, employee: true },
//         });

//         return { kind: "OK" as const, status: 200, body: updated };
//       }

//       // If incharge exists, block others until incharge approves
//       if (hasIncharge && leave.inChargeDecision !== "APPROVED") {
//         return {
//           kind: "ERR" as const,
//           status: 400,
//           body: { error: "Incharge approval required first" },
//         };
//       }

//       // ================================================================
//       // HR EMPLOYEE (dept = 1, roleId ≠ HR Manager)
//       // Level1: HR_MANAGER only. Direct final.
//       // ================================================================
//       if (isHRDept && roleId !== 1) {
//         if (role !== "HR_MANAGER") {
//           return {
//             kind: "ERR" as const,
//             status: 400,
//             body: { error: "Only HR Manager can approve HR employees" },
//           };
//         }

//         data.hodDecision = approved ? "APPROVED" : "REJECTED";
//         data.hodDecidedAt = new Date();
//         data.hrDecision = approved ? "APPROVED" : "REJECTED";
//         data.hrDecidedAt = new Date();
//         data.status = approved ? "APPROVED" : "REJECTED";

//         if (!approved) {
//           data.declinedBy = userId ?? null;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//       }

//       // ================================================================
//       // HR MANAGER (roleId = 1)
//       // Level1: MANAGEMENT only. Direct final.
//       // ================================================================
//       else if (roleId === 1) {
//         if (role !== "MANAGEMENT") {
//           return {
//             kind: "ERR" as const,
//             status: 400,
//             body: { error: "Only Management can approve HR Manager leave" },
//           };
//         }

//         data.hodDecision = approved ? "APPROVED" : "REJECTED";
//         data.hodDecidedAt = new Date();
//         data.hrDecision = approved ? "APPROVED" : "REJECTED";
//         data.hrDecidedAt = new Date();
//         data.status = approved ? "APPROVED" : "REJECTED";

//         if (!approved) {
//           data.declinedBy = userId ?? null;
//           data.declinedDate = new Date();
//           data.declineReason = req.body.declineReason || null;
//         }
//       }

//       // ================================================================
//       // REPORTING MANAGER / HOD (roleId = 3 or 5)
//       // Level1: MANAGEMENT
//       // Level2: HR_MANAGER
//       // ================================================================
//       else if (roleId === 3 || roleId === 5) {
//         if (role === "MANAGEMENT") {
//           data.hodDecision = approved ? "APPROVED" : "REJECTED";
//           data.hodDecidedAt = new Date();

//           if (!approved) {
//             data.status = "REJECTED";
//             data.declinedBy = userId ?? null;
//             data.declinedDate = new Date();
//             data.declineReason = req.body.declineReason || null;
//           }
//         } else if (role === "HR_MANAGER") {
//           if (leave.hodDecision !== "APPROVED") {
//             return {
//               kind: "ERR" as const,
//               status: 400,
//               body: { error: "Management approval required first" },
//             };
//           }

//           data.hrDecision = approved ? "APPROVED" : "REJECTED";
//           data.hrDecidedAt = new Date();
//           data.status = approved ? "APPROVED" : "REJECTED";

//           if (!approved) {
//             data.declinedBy = userId ?? null;
//             data.declinedDate = new Date();
//             data.declineReason = req.body.declineReason || null;
//           }
//         } else {
//           return {
//             kind: "ERR" as const,
//             status: 400,
//             body: { error: "Invalid approver for Reporting Manager/HOD" },
//           };
//         }
//       }

//       // ================================================================
//       // NORMAL EMPLOYEE (roleId = 2)
//       // Level1: REPORTING_MANAGER
//       // Level2: HR_MANAGER
//       // ================================================================
//       else if (roleId === 2) {
//         if (role === "REPORTING_MANAGER") {
//           data.hodDecision = approved ? "APPROVED" : "REJECTED";
//           data.hodDecidedAt = new Date();

//           if (!approved) {
//             data.status = "REJECTED";
//             data.declinedBy = userId ?? null;
//             data.declinedDate = new Date();
//             data.declineReason = req.body.declineReason || null;
//           }
//         } else if (role === "HR_MANAGER") {
//           if (leave.hodDecision !== "APPROVED") {
//             return {
//               kind: "ERR" as const,
//               status: 400,
//               body: { error: "Manager approval required first" },
//             };
//           }

//           data.hrDecision = approved ? "APPROVED" : "REJECTED";
//           data.hrDecidedAt = new Date();
//           data.status = approved ? "APPROVED" : "REJECTED";

//           if (!approved) {
//             data.declinedBy = userId ?? null;
//             data.declinedDate = new Date();
//             data.declineReason = req.body.declineReason || null;
//           }
//         } else {
//           return {
//             kind: "ERR" as const,
//             status: 400,
//             body: { error: "Unauthorized approver" },
//           };
//         }
//       } else {
//         return { kind: "ERR" as const, status: 400, body: { error: "Unsupported employee roleId" } };
//       }

//       // Save decisions
//       const updatedLeave = await tx.leaveRequest.update({
//         where: { id: leaveId },
//         data,
//         include: { employee: true, leaveType: true },
//       });

//       // If not finally approved, stop here
//       if (updatedLeave.status !== "APPROVED") {
//         return { kind: "OK" as const, status: 200, body: updatedLeave };
//       }

//       // ================================================================
//       // FINAL APPROVAL: CONSUME CO OR DEBIT BALANCE + LEDGER + SUMMARIES
//       // ================================================================
//       const startDate = new Date(updatedLeave.startDate);
//       const endDate = new Date(updatedLeave.endDate);
//       // const year = startDate.getFullYear();
//       const year = getFinancialYear(startDate);
//       const month = startDate.getMonth() + 1;

//       const requestedUnits = updatedLeave.isHalfDay ? 0.5 : daysInclusive(startDate, endDate);


//       // ---- CO: consume credits only (leave balance table untouched)
//       if (updatedLeave.leaveType.name === "CO") {
//         const today = atStartOfDay(new Date());

//         // CO always full day credits
//         const requiredDays = Math.ceil(requestedUnits);

//         const credits = await tx.compOffCredit.findMany({
//           where: {
//             employeeId: updatedLeave.employeeId,
//             used: false,
//             expiryDate: { gte: today },
//           },
//           orderBy: { expiryDate: "asc" },
//         });

//         if (credits.length < requiredDays) {
//           return {
//             kind: "ERR" as const,
//             status: 400,
//             body: { error: "Not enough comp-off credits" },
//           };
//         }

//         const toUse = credits.slice(0, requiredDays);
//         for (const c of toUse) {
//           await tx.compOffCredit.update({
//             where: { id: c.id },
//             data: { used: true, usedOn: new Date(), leaveId: updatedLeave.id },
//           });
//         }

//         // OPTIONAL: if you want a ledger trail for CO also, you can add a separate leaveType for CO balance.
//         // For now, returning as-is (like your previous behavior).
//         return { kind: "OK" as const, status: 200, body: { ...updatedLeave, requestedUnits } };
//       }

//       // ---- Other leaves: validate & debit EmployeeLeaveBalance + ledger + summaries
//       const bal = await getBalance(updatedLeave.employeeId, updatedLeave.leaveTypeId, year);
//       if (!bal) {
//         return {
//           kind: "ERR" as const,
//           status: 400,
//           body: { error: `Leave balance not configured for ${year}` },
//         };
//       }

//       const totalUsedBefore = computeTotalUsed(bal);
//       const remainingBefore = (bal.totalAllowed ?? 0) - totalUsedBefore;

//       // extra guard (in case frontend bypasses)
//       if (requestedUnits > remainingBefore) {
//         return {
//           kind: "ERR" as const,
//           status: 400,
//           body: { error: "Insufficient balance at approval time" },
//         };
//       }

//       const ledgerBalance = await getLastLedgerBalanceTx(tx, updatedLeave.employeeId, updatedLeave.leaveTypeId, year);

//       if (requestedUnits > ledgerBalance) {
//         return {
//           kind: "ERR" as const,
//           status: 400,
//           body: { error: "Insufficient balance (ledger)" }
//         };
//       }

//       // 1) Update EmployeeLeaveBalance usage
//       if (updatedLeave.isHalfDay) {
//         await tx.employeeLeaveBalance.updateMany({
//           where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year },
//           data: { halfDayUsed: { increment: 1 } },
//         });
//       } else {
//         await tx.employeeLeaveBalance.updateMany({
//           where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year },
//           data: { used: { increment: requestedUnits } },
//         });
//       }

//       // 3) Rebuild monthly summaries for ALL touched months (important for cross-month leave)
//       const touched = getTouchedMonths(startDate, endDate);

//       // ensure previous month summary exists chain-wise:
//       // rebuild in chronological order
//       touched.sort((a, b) => (a.year - b.year) || (a.month - b.month));

//       let runningBalance = await getLastLedgerBalanceTx(
//         tx,
//         updatedLeave.employeeId,
//         updatedLeave.leaveTypeId,
//         year
//       );

//       for (const m of touched) {
//         const days = calculateDaysForMonth(startDate, endDate, m.year, m.month);

//         if (days <= 0) continue;

//         runningBalance = runningBalance - days;

//         await insertLedgerTx(tx, {
//           employeeId: updatedLeave.employeeId,
//           leaveTypeId: updatedLeave.leaveTypeId,
//           year: m.year,
//           month: m.month,
//           debit: days,
//           credit: 0,
//           balanceAfter: runningBalance,
//           action: "DEBIT",
//           referenceType: "LEAVE_REQUEST",
//           referenceId: updatedLeave.id,
//           performedBy: userId ?? null,
//           source: "ADMIN",
//           remarks: `Leave part for ${m.month}/${m.year}`
//         });
//       }

//       for (const m of touched) {
//         await rebuildMonthlySummaryTx(tx, updatedLeave.employeeId, updatedLeave.leaveTypeId, m.year, m.month);
//       }

//       // 4) Rebuild yearly summary
//       // (if leave spans years, rebuild both)
//       const yearsTouched = Array.from(new Set(touched.map((t) => t.year)));
//       for (const y of yearsTouched) {
//         await rebuildYearlySummaryTx(tx, updatedLeave.employeeId, updatedLeave.leaveTypeId, y);
//       }

//       return { kind: "OK" as const, status: 200, body: { ...updatedLeave, requestedUnits } };
//     });

//     if (result.kind === "ERR") {
//       return res.status(result.status).json(result.body);
//     }
//     return res.status(result.status).json(result.body);
//   } catch (error) {
//     console.error("Error updating leave:", error);
//     return res.status(500).json({ error: "Failed to update leave" });
//   }
// };
export const updateLeaveStatus = async (req: Request, res: Response) => {
  try {
    const leaveId = Number(req.params.id);
    const { role, status, userId, declineReason } = req.body as {
      role: "INCHARGE" | "REPORTING_MANAGER" | "HR_MANAGER" | "MANAGEMENT";
      status: "Approved" | "Declined";
      userId?: number;
      declineReason?: string;
    };

    if (!leaveId || !role || !status) {
      return res.status(400).json({ error: "id, role, status are required" });
    }
    if (!["Approved", "Declined"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const approved = status === "Approved";

    // We will rebuild summaries OUTSIDE transaction to avoid P2028 timeouts.
    let touchedMonths: Array<{ year: number; month: number }> = [];
    let yearsTouched: number[] = [];
    let rebuildEmployeeId: number | null = null;
    let rebuildLeaveTypeId: number | null = null;

    const result = await prisma.$transaction(
      async (tx: Tx) => {
        const leave = await tx.leaveRequest.findUnique({
          where: { id: leaveId },
          include: { leaveType: true, employee: true },
        });

        if (!leave) {
          return { kind: "ERR" as const, status: 404, body: { error: "Leave not found" } };
        }

        if (leave.status === "APPROVED" || leave.status === "REJECTED") {
          return { kind: "ERR" as const, status: 400, body: { error: "Leave already finalized" } };
        }

        const emp = leave.employee;
        const roleId = emp.roleId;
        const deptId = emp.departmentId;
        const isHRDept = deptId === 1;
        const hasIncharge = !!emp.inchargeId;

        const data: any = {};

        // --------------------------
        // INCHARGE LEVEL (if exists)
        // --------------------------
        if (hasIncharge && role === "INCHARGE") {
          data.inChargeDecision = approved ? "APPROVED" : "REJECTED";
          data.inChargeDecidedAt = new Date();

          if (!approved) {
            data.status = "REJECTED";
            data.declinedBy = userId ?? null;
            data.declinedDate = new Date();
            data.declineReason = declineReason || null;
          }

          const updated = await tx.leaveRequest.update({
            where: { id: leaveId },
            data,
            include: { leaveType: true, employee: true },
          });

          return { kind: "OK" as const, status: 200, body: updated };
        }

        // Block others until incharge approves
        if (hasIncharge && leave.inChargeDecision !== "APPROVED") {
          return {
            kind: "ERR" as const,
            status: 400,
            body: { error: "Incharge approval required first" },
          };
        }

        // ================================================================
        // HR EMPLOYEE (dept=1, roleId != 1) -> HR_MANAGER final
        // ================================================================
        if (isHRDept && roleId !== 1) {
          if (role !== "HR_MANAGER") {
            return {
              kind: "ERR" as const,
              status: 400,
              body: { error: "Only HR Manager can approve HR employees" },
            };
          }

          data.hodDecision = approved ? "APPROVED" : "REJECTED";
          data.hodDecidedAt = new Date();
          data.hrDecision = approved ? "APPROVED" : "REJECTED";
          data.hrDecidedAt = new Date();
          data.status = approved ? "APPROVED" : "REJECTED";

          if (!approved) {
            data.declinedBy = userId ?? null;
            data.declinedDate = new Date();
            data.declineReason = declineReason || null;
          }
        }

        // ================================================================
        // HR MANAGER (roleId=1) -> MANAGEMENT final
        // ================================================================
        else if (roleId === 1) {
          if (role !== "MANAGEMENT") {
            return {
              kind: "ERR" as const,
              status: 400,
              body: { error: "Only Management can approve HR Manager leave" },
            };
          }

          data.hodDecision = approved ? "APPROVED" : "REJECTED";
          data.hodDecidedAt = new Date();
          data.hrDecision = approved ? "APPROVED" : "REJECTED";
          data.hrDecidedAt = new Date();
          data.status = approved ? "APPROVED" : "REJECTED";

          if (!approved) {
            data.declinedBy = userId ?? null;
            data.declinedDate = new Date();
            data.declineReason = declineReason || null;
          }
        }

        // ================================================================
        // REPORTING MANAGER / HOD (roleId 3 or 5)
        //   Level1: MANAGEMENT
        //   Level2: HR_MANAGER
        // ================================================================
        else if (roleId === 3) {
          if (role === "MANAGEMENT") {
            data.hodDecision = approved ? "APPROVED" : "REJECTED";
            data.hodDecidedAt = new Date();

            if (!approved) {
              data.status = "REJECTED";
              data.declinedBy = userId ?? null;
              data.declinedDate = new Date();
              data.declineReason = declineReason || null;
            }
          } else if (role === "HR_MANAGER") {
            if (leave.hodDecision !== "APPROVED") {
              return {
                kind: "ERR" as const,
                status: 400,
                body: { error: "Management approval required first" },
              };
            }

            data.hrDecision = approved ? "APPROVED" : "REJECTED";
            data.hrDecidedAt = new Date();
            data.status = approved ? "APPROVED" : "REJECTED";

            if (!approved) {
              data.declinedBy = userId ?? null;
              data.declinedDate = new Date();
              data.declineReason = declineReason || null;
            }
          } else {
            return {
              kind: "ERR" as const,
              status: 400,
              body: { error: "Invalid approver for Reporting Manager/HOD" },
            };
          }
        }

        // ================================================================
        // NORMAL EMPLOYEE (roleId=2)
        //   Level1: REPORTING_MANAGER
        //   Level2: HR_MANAGER
        // ================================================================
        else if (roleId === 2 || roleId === 5) {
          // Level 1: the employee's assigned reportingManager approves —
          // regardless of whether that manager's own role is 3 (Reporting
          // Manager) or 4 (Management). Frontend may send either label, so
          // we authorize by identity (userId === emp.reportingManager), not
          // by the role string.
          if (role === "REPORTING_MANAGER" || role === "MANAGEMENT") {
            if (!emp.reportingManager) {
              return {
                kind: "ERR" as const,
                status: 400,
                body: { error: "No reporting manager assigned for this employee" },
              };
            }
            if (!userId || userId !== emp.reportingManager) {
              return {
                kind: "ERR" as const,
                status: 403,
                body: { error: "Only the assigned reporting manager can approve this leave" },
              };
            }

            data.hodDecision = approved ? "APPROVED" : "REJECTED";
            data.hodDecidedAt = new Date();

            if (!approved) {
              data.status = "REJECTED";
              data.declinedBy = userId ?? null;
              data.declinedDate = new Date();
              data.declineReason = declineReason || null;
            }
          } else if (role === "HR_MANAGER") {
            if (leave.hodDecision !== "APPROVED") {
              return {
                kind: "ERR" as const,
                status: 400,
                body: { error: "Manager approval required first" },
              };
            }

            data.hrDecision = approved ? "APPROVED" : "REJECTED";
            data.hrDecidedAt = new Date();
            data.status = approved ? "APPROVED" : "REJECTED";

            if (!approved) {
              data.declinedBy = userId ?? null;
              data.declinedDate = new Date();
              data.declineReason = declineReason || null;
            }
          } else {
            return {
              kind: "ERR" as const,
              status: 400,
              body: { error: "Unauthorized approver" },
            };
          }
        } else {
          return {
            kind: "ERR" as const,
            status: 400,
            body: { error: "Unsupported employee roleId" },
          };
        }

        // Save decisions
        const updatedLeave = await tx.leaveRequest.update({
          where: { id: leaveId },
          data,
          include: { employee: true, leaveType: true },
        });

        // If not finally approved, stop here (NO ledger work)
        if (updatedLeave.status !== "APPROVED") {
          return { kind: "OK" as const, status: 200, body: updatedLeave };
        }

        // ================================================================
        // FINAL APPROVAL: CONSUME CO OR DEBIT BALANCE + LEDGER
        // ================================================================
        const startDate = new Date(updatedLeave.startDate);
        const endDate = new Date(updatedLeave.endDate);

        // ── Rule A re-check at approval (catches legacy / race conflicts).
        // If a different-type leave now occupies the same ISO week, refuse.
        const weeklyClashOnApprove = await findWeeklyTypeConflict(
          updatedLeave.employeeId,
          updatedLeave.leaveTypeId,
          updatedLeave.leaveType.name,
          startDate, endDate,
          updatedLeave.id,                 // exclude this request itself
        );
        if (weeklyClashOnApprove) {
          return {
            kind: "ERR" as const,
            status: 400,
            body: {
              error: `Cannot approve — employee already has a ${weeklyClashOnApprove.leaveType.name} `
                   + `leave in the same week. Only one leave type is allowed per week.`,
            },
          };
        }

        const year = getFinancialYear(startDate);
        // EL counts week-offs inside the range (sandwich rule); other types don't.
        const isEarnedLeave = updatedLeave.leaveType.name === "EL";
        const requestedUnits = updatedLeave.isHalfDay
          ? 0.5
          : await countWorkingDays(updatedLeave.employeeId, startDate, endDate, { includeWeekOffs: isEarnedLeave });

        // ---- CO: consume credits only (leave balance untouched)
        if (updatedLeave.leaveType.name === "CO") {
          const today = atStartOfDay(new Date());
          const requiredDays = Math.ceil(requestedUnits);

          const credits = await tx.compOffCredit.findMany({
            where: {
              employeeId: updatedLeave.employeeId,
              used: false,
              expiryDate: { gte: today },
            },
            orderBy: { expiryDate: "asc" },
          });

          if (credits.length < requiredDays) {
            return {
              kind: "ERR" as const,
              status: 400,
              body: { error: "Not enough comp-off credits" },
            };
          }

          for (const c of credits.slice(0, requiredDays)) {
            await tx.compOffCredit.update({
              where: { id: c.id },
              data: { used: true, usedOn: new Date(), leaveId: updatedLeave.id },
            });
          }

          return { kind: "OK" as const, status: 200, body: { ...updatedLeave, requestedUnits } };
        }

        // ---- RH: no balance table, just approve (validated at creation)
        if (updatedLeave.leaveType.name === "RH") {
          return { kind: "OK" as const, status: 200, body: { ...updatedLeave, requestedUnits } };
        }

        // ---- LOP: explicit unpaid leave — no balance, entire request is LOP.
        if (updatedLeave.leaveType.name === "LOP") {
          await tx.leaveRequest.update({
            where: { id: leaveId },
            data: { paidUnits: 0, lopUnits: requestedUnits },
          });
          return {
            kind: "OK" as const,
            status: 200,
            body: { ...updatedLeave, requestedUnits, paidUnits: 0, lopUnits: requestedUnits },
          };
        }

        // ---- Non-CO/RH/LOP: split into paid (from balance) + LOP (overflow).
        // A missing balance row or insufficient balance no longer blocks the
        // approval — the shortfall is booked as LOP and captured on the request
        // for payroll. Only the paid portion is deducted from balance + ledger.
        const bal = await tx.employeeLeaveBalance.findFirst({
          where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year, category: "LEAVE" },
        });

        const remainingBefore = bal ? (bal.totalAllowed ?? 0) - computeTotalUsed(bal) : 0;
        const ledgerBalance = await getLastLedgerBalanceTx(tx, updatedLeave.employeeId, updatedLeave.leaveTypeId, year);

        // Paid capacity is bounded by BOTH the balance table and the ledger so
        // the two stay consistent; anything beyond it is LOP.
        const paidCapacity = Math.max(0, Math.min(remainingBefore, ledgerBalance));
        const paidUnits = Math.min(requestedUnits, paidCapacity);
        const lopUnits = requestedUnits - paidUnits;

        // Deduct only the paid portion from EmployeeLeaveBalance.
        if (paidUnits > 0) {
          if (updatedLeave.isHalfDay) {
            // A paid half-day is 0.5 → exactly one half-day unit.
            await tx.employeeLeaveBalance.updateMany({
              where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year },
              data: { halfDayUsed: { increment: 1 } },
            });
          } else {
            await tx.employeeLeaveBalance.updateMany({
              where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year },
              data: { used: { increment: paidUnits } },
            });
          }
        }

        // Persist the split on the request for payroll + reporting.
        await tx.leaveRequest.update({
          where: { id: leaveId },
          data: { paidUnits, lopUnits },
        });

        // Ledger DEBITs per touched month — only for the PAID budget, allocated
        // chronologically. Days beyond the paid budget in a month are LOP and
        // are not ledgered (there is no balance to debit).
        const touched = getTouchedMonths(startDate, endDate);
        touched.sort((a, b) => a.year - b.year || a.month - b.month);

        let runningBalance = ledgerBalance;
        let paidBudget = paidUnits;

        for (const m of touched) {
          const calYear = getCalendarYear(m.year, m.month);
          const monthStart = new Date(calYear, m.month - 1, 1);
          const monthEnd = new Date(calYear, m.month, 0);
          const from = startDate > monthStart ? startDate : monthStart;
          const to = endDate < monthEnd ? endDate : monthEnd;
          const days = await countWorkingDays(updatedLeave.employeeId, from, to, { includeWeekOffs: isEarnedLeave });
          if (days <= 0) continue;

          const paidForMonth = Math.min(days, paidBudget);
          if (paidForMonth <= 0) continue; // fully-LOP month
          paidBudget -= paidForMonth;
          runningBalance -= paidForMonth;

          await insertLedgerTx(tx, {
            employeeId: updatedLeave.employeeId,
            leaveTypeId: updatedLeave.leaveTypeId,
            year: m.year,
            month: m.month,
            debit: paidForMonth,
            credit: 0,
            balanceAfter: runningBalance,
            action: "DEBIT",
            referenceType: "LEAVE_REQUEST",
            referenceId: updatedLeave.id,
            performedBy: userId ?? null,
            source: "ADMIN",
            remarks: `Leave part for ${m.month}/${m.year}`,
          });
        }

        // Pass rebuild info OUTSIDE the transaction
        return {
          kind: "OK" as const,
          status: 200,
          body: { ...updatedLeave, requestedUnits, paidUnits, lopUnits, __touched: touched },
        };
      },
      {
        // optional, but helps (still keep rebuild OUTSIDE)
        timeout: 15000,
      }
    );

    if (result.kind === "ERR") {
      return res.status(result.status).json(result.body);
    }

    // =========================
    // ✅ OUTSIDE TRANSACTION: REBUILD SUMMARIES (NO tx)
    // =========================
    const body: any = result.body;

    if (body?.status === "APPROVED" && body?.leaveType?.name !== "CO" && Array.isArray(body.__touched)) {
      touchedMonths = body.__touched;
      yearsTouched = Array.from(new Set(touchedMonths.map((t: any) => t.year)));

      rebuildEmployeeId = body.employeeId;
      rebuildLeaveTypeId = body.leaveTypeId;

      // Rebuild in order (month chain)
      touchedMonths.sort((a, b) => a.year - b.year || a.month - b.month);
      if (
        rebuildEmployeeId !== null &&
        rebuildLeaveTypeId !== null
      ) {
        for (const m of touchedMonths) {
          await rebuildMonthlySummaryTx(
            prisma,
            rebuildEmployeeId,
            rebuildLeaveTypeId,
            m.year,
            m.month
          );
        }

        for (const y of yearsTouched) {
          await rebuildYearlySummaryTx(
            prisma,
            rebuildEmployeeId,
            rebuildLeaveTypeId,
            y
          );
        }
      }
    }

    // cleanup helper key
    if (body?.__touched) delete body.__touched;

    // 🔔 Notify employee of final decision
    if (body?.status === 'APPROVED' || body?.status === 'REJECTED') {
      try {
        const start = fmtDate(body.startDate);
        const end   = fmtDate(body.endDate);
        const days  = daysInclusive(new Date(body.startDate), new Date(body.endDate));
        await createNotification(
          body.employeeId,
          `Your leave request from ${start} to ${end} (${days} day(s)) has been ${body.status}.`
        );
      } catch (err) {
        console.error("Leave status notification failed:", err);
      }
    }

    return res.status(result.status).json(body);
  } catch (error) {
    console.error("Error updating leave:", error);
    return res.status(500).json({ error: "Failed to update leave" });
  }
};

// export const createLeaveBalances = async (req: Request, res: Response) => {
//   try {
//     const { employeeId, year, leaves = [], permissions = [] } = req.body;

//     if (!employeeId || !year) {
//       return res.status(400).json({ error: "employeeId and year are required" });
//     }

//     // 🔹 LEAVES
//     for (const l of leaves) {
//       await prisma.employeeLeaveBalance.upsert({
//         where: {
//           employeeId_leaveTypeId_year: {
//             employeeId,
//             leaveTypeId: l.leaveTypeId,
//             year
//           }
//         },
//         update: {
//           totalAllowed: l.totalAllowed,
//           used: l.used ?? 0,
//           halfDayUsed: l.halfDayUsed ?? 0
//         },
//         create: {
//           employeeId,
//           leaveTypeId: l.leaveTypeId,
//           permissionType: null,
//           category: "LEAVE",
//           year,
//           totalAllowed: l.totalAllowed,
//           used: l.used ?? 0,
//           halfDayUsed: l.halfDayUsed ?? 0
//         }
//       });
//     }

//     // 🔹 PERMISSIONS
//     for (const p of permissions) {
//       await prisma.employeeLeaveBalance.upsert({
//         where: {
//           employeeId_permissionType_year: {
//             employeeId,
//             permissionType: p.permissionType,
//             year
//           }
//         },
//         update: {
//           totalAllowed: p.totalAllowed,
//           used: p.used ?? 0
//         },
//         create: {
//           employeeId,
//           leaveTypeId: null,
//           permissionType: p.permissionType,
//           category: "PERMISSION",
//           year,
//           totalAllowed: p.totalAllowed,
//           used: p.used ?? 0
//         }
//       });
//     }

//     res.json({ message: "Leave balances saved successfully" });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to create leave balances" });
//   }
// };
export const createLeaveBalances = async (req: Request, res: Response) => {
  try {
    const { employeeId, year, leaves = [] } = req.body;

    if (!employeeId || !year) {
      return res.status(400).json({ error: "employeeId and year are required" });
    }

    const affectedLeaveTypes = new Set<number>();
    const month = new Date().getMonth() + 1;

    // =========================
    // 🔁 PROCESS LEAVES (SMALL TX PER ITEM)
    // =========================
    for (const l of leaves) {

      await prisma.$transaction(async (tx) => {

        const existing = await tx.employeeLeaveBalance.findFirst({
          where: {
            employeeId,
            leaveTypeId: l.leaveTypeId,
            year
          }
        });

        // =========================
        // 🔢 CALCULATIONS
        // =========================
        const prevTotal = existing?.totalAllowed ?? 0;
        const newTotal = Number(l.totalAllowed ?? 0);
        const totalDelta = newTotal - prevTotal;

        const prevUsed = (existing?.used ?? 0) + ((existing?.halfDayUsed ?? 0) * 0.5);
        const newUsed = (Number(l.used ?? 0)) + ((Number(l.halfDayUsed ?? 0)) * 0.5);
        const usedDelta = newUsed - prevUsed;

        // =========================
        // 💾 UPSERT BALANCE
        // =========================
        await tx.employeeLeaveBalance.upsert({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId,
              leaveTypeId: l.leaveTypeId,
              year
            }
          },
          update: {
            totalAllowed: newTotal,
            used: Number(l.used ?? 0),
            halfDayUsed: Number(l.halfDayUsed ?? 0)
          },
          create: {
            employeeId,
            leaveTypeId: l.leaveTypeId,
            permissionType: null,
            category: "LEAVE",
            year,
            totalAllowed: newTotal,
            used: Number(l.used ?? 0),
            halfDayUsed: Number(l.halfDayUsed ?? 0)
          }
        });

        // =========================
        // 📊 LEDGER
        // =========================
        let prevLedgerBalance = await getLastLedgerBalanceTx(
          tx,
          employeeId,
          l.leaveTypeId,
          year
        );

        let newLedgerBalance = prevLedgerBalance;

        // 🔹 TOTAL CHANGE
        if (totalDelta !== 0) {
          newLedgerBalance += totalDelta;

          await insertLedgerTx(tx, {
            employeeId,
            leaveTypeId: l.leaveTypeId,
            year,
            month,
            credit: totalDelta > 0 ? totalDelta : 0,
            debit: totalDelta < 0 ? Math.abs(totalDelta) : 0,
            balanceAfter: newLedgerBalance,
            action: "ADJUSTMENT",
            referenceType: "MANUAL",
            source: "ADMIN",
            remarks: "Total allocation updated"
          });
        }

        // 🔹 USED CHANGE (🔥 IMPORTANT)
        if (usedDelta !== 0) {
          newLedgerBalance -= usedDelta;

          await insertLedgerTx(tx, {
            employeeId,
            leaveTypeId: l.leaveTypeId,
            year,
            month,
            credit: usedDelta < 0 ? Math.abs(usedDelta) : 0,
            debit: usedDelta > 0 ? usedDelta : 0,
            balanceAfter: newLedgerBalance,
            action: "DEBIT",
            referenceType: "MANUAL",
            source: "ADMIN",
            remarks: "Used updated manually"
          });
        }

        // ✅ TRACK FOR SUMMARY REBUILD
        if (totalDelta !== 0 || usedDelta !== 0) {
          affectedLeaveTypes.add(l.leaveTypeId);
        }

      }, { timeout: 10000 }); // ⬅️ avoid timeout issues
    }

    // =========================
    // 🔹 PERMISSIONS (NO LEDGER)
    // =========================
    // for (const p of permissions) {
    //   await prisma.employeeLeaveBalance.upsert({
    //     where: {
    //       employeeId_permissionType_year: {
    //         employeeId,
    //         permissionType: p.permissionType,
    //         year
    //       }
    //     },
    //     update: {
    //       totalAllowed: Number(p.totalAllowed ?? 0),
    //       used: Number(p.used ?? 0)
    //     },
    //     create: {
    //       employeeId,
    //       leaveTypeId: null,
    //       permissionType: p.permissionType,
    //       category: "PERMISSION",
    //       year,
    //       totalAllowed: Number(p.totalAllowed ?? 0),
    //       used: Number(p.used ?? 0)
    //     }
    //   });
    // }

    // =========================
    // 🔁 REBUILD SUMMARIES (OUTSIDE TX)
    // =========================
    for (const leaveTypeId of affectedLeaveTypes) {
      await rebuildMonthlySummaryTx(prisma, employeeId, leaveTypeId, year, month);
      await rebuildYearlySummaryTx(prisma, employeeId, leaveTypeId, year);
    }

    return res.json({ message: "Leave balances updated successfully" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to update leave balances" });
  }
};

const MS_PER_DAY = 86400000;

export function daysInclusive(s: Date, e: Date) {
  const ss = new Date(s); ss.setHours(0, 0, 0, 0);
  const ee = new Date(e); ee.setHours(0, 0, 0, 0);
  return Math.floor((ee.getTime() - ss.getTime()) / MS_PER_DAY) + 1;
}

// Counts leave days between start and end (inclusive).
// By default, excludes:
//   - week-offs (per employee shift config, fallback Sunday)
//   - mandatory national holidays (isOptional = false)
// Optional holidays (RH) are always counted as working days.
//
// When opts.includeWeekOffs is true, week-offs that fall inside the range ARE
// counted as leave days. This implements the "Earned Leave sandwich rule" —
// if an employee takes EL spanning a weekend, the weekend is deducted too.
// Mandatory national holidays are still excluded even in that mode.
export async function countWorkingDays(
  employeeId: number,
  start: Date,
  end: Date,
  opts?: { includeWeekOffs?: boolean },
): Promise<number> {
  if (start > end) return 0;
  const includeWeekOffs = !!opts?.includeWeekOffs;

  // Fetch all mandatory holidays in the date range once
  const mandatoryHolidays = await prisma.holiday.findMany({
    where: {
      isOptional: false,
      date: { gte: start, lte: end }
    },
    select: { date: true }
  });

  const holidaySet = new Set(
    mandatoryHolidays.map(h => {
      const d = new Date(h.date);
      d.setHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    })
  );

  const monthConfigs = new Map<string, any>();
  let total = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const current = new Date(d);
    current.setHours(0, 0, 0, 0);
    const dateKey = current.toISOString().slice(0, 10);

    // Skip mandatory national holidays — always, even for EL.
    if (holidaySet.has(dateKey)) continue;

    // For EL (includeWeekOffs), don't even bother resolving the week-off
    // config — every non-holiday day counts.
    if (includeWeekOffs) { total++; continue; }

    const month = current.getMonth() + 1;
    const year = current.getFullYear();
    const monthKey = `${year}-${month}`;

    if (!monthConfigs.has(monthKey)) {
      const approval = await prisma.shiftApproval.findFirst({
        where: {
          employeeId,
          month,
          year,
          status: "APPROVED",
          weekOffConfig: { not: Prisma.DbNull }
        }
      });
      monthConfigs.set(monthKey, approval?.weekOffConfig ?? null);
    }

    const config = monthConfigs.get(monthKey);
    if (!isWeeklyOffFromConfig(config, current)) {
      total++;
    }
  }

  return total;
}

export async function getLeaveDashboard(req: Request, res: Response) {
  try {
    const employeeId = Number(req.params.id);
    const today = req.query.date ? new Date(String(req.query.date)) : new Date();
    const fyYear = getFinancialYear(today);
    const yearStart = new Date(fyYear, 3, 1);                    // April 1 of FY
    const yearEnd   = new Date(fyYear + 1, 2, 31, 23, 59, 59);  // March 31 end of FY
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

    // Entitlement for this financial year
    const policy = await prisma.entitlementPolicy.findFirst({ where: { year: fyYear } });
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

function atStartOfDay(d: Date) { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; }
function atEndOfDay(d: Date) { const x = new Date(d); x.setUTCHours(23, 59, 59, 999); return x; }

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

/** Every ISO week (Mon..Sun) that the date range [start, end] overlaps. */
function isoWeeksTouched(start: Date, end: Date): { weekStart: Date; weekEnd: Date }[] {
  const out: { weekStart: Date; weekEnd: Date }[] = [];
  let cur = startOfISOWeek(start);
  const lastWeekStart = startOfISOWeek(end);
  // Walk Monday → Monday until we've covered the week containing `end`.
  while (cur.getTime() <= lastWeekStart.getTime()) {
    const ws = new Date(cur);
    const we = endOfISOWeek(cur);
    out.push({ weekStart: ws, weekEnd: we });
    cur = new Date(cur);
    cur.setDate(cur.getDate() + 7);
  }
  return out;
}

/**
 * Rule A — one leave TYPE per ISO week.
 * Checks whether the employee already has a PENDING/APPROVED leave of a
 * DIFFERENT type in any ISO week the new request touches. RH and CO are
 * exempt (special-case leaves: tied to a fixed holiday / earned by working).
 * Returns the conflicting record (with leaveType) or null if clear.
 *
 * Pass `excludeRequestId` when re-checking on approval so the request being
 * approved doesn't conflict with itself.
 */
async function findWeeklyTypeConflict(
  employeeId: number,
  leaveTypeId: number,
  leaveTypeName: string,
  start: Date,
  end: Date,
  excludeRequestId?: number,
): Promise<{ leaveType: { name: string }; startDate: Date; endDate: Date } | null> {
  const WEEKLY_RULE_EXEMPT = ['RH', 'CO'];
  // The leave being applied for is itself exempt → no restriction.
  if (WEEKLY_RULE_EXEMPT.includes(leaveTypeName)) return null;

  for (const w of isoWeeksTouched(start, end)) {
    const clash = await prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: w.weekEnd },
        endDate:   { gte: w.weekStart },
        leaveTypeId: { not: leaveTypeId },                 // different type only
        leaveType: { name: { notIn: WEEKLY_RULE_EXEMPT } }, // an existing RH/CO doesn't block
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      },
      include: { leaveType: { select: { name: true } } },
      orderBy: { startDate: 'asc' },
    });
    if (clash) return clash as any;
  }
  return null;
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

    // Optional scope: when a leave-detail view passes the applicant's
    // departmentId, restrict buckets to that department only. Without it,
    // behavior is unchanged (org-wide buckets).
    const deptIdRaw = req.query.departmentId;
    const departmentId =
      deptIdRaw !== undefined && deptIdRaw !== '' && !Number.isNaN(Number(deptIdRaw))
        ? Number(deptIdRaw)
        : null;

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
        ],
        ...(departmentId !== null
          ? { employee: { is: { departmentId } } }
          : {}),
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
      const designationName = r.employee.designation?.name ?? 'Default';
      const person: Person = {
        id: r.employee.id,
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        title: designationName,
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
  // ── WhatsApp sending DISABLED for now ──────────────────────────────────────
  // We don't want any WhatsApp messages going out at the moment. Every WhatsApp
  // send in the app routes through this function (leave/wfh/appraisal/permission/
  // test-assign notifications + mobile-login OTP), so disabling it here turns
  // them all off. To re-enable, delete the two lines below and uncomment block.
  console.log(`[whatsapp] disabled — skipping send to ${to} (template ${templateId}, ${placeholders.length} placeholders)`);
  return null;

  // const payload = {
  //   from: config.whatsapp.fromPhoneNumber,
  //   to: formatPhoneNumber(to),
  //   type: "template",
  //   message: {
  //     templateid: templateId,
  //     placeholders: placeholders.map(String),
  //   },
  // };
  // const headers = {
  //   "Content-Type": "application/json",
  //   apikey: config.whatsapp.authToken,
  // };
  // const url = config.whatsapp.apiUrl;
  // const resp = await axios.post(url, payload, { headers });
  // if (resp?.data?.code !== "200") {
  //   throw new Error(`WhatsApp send failed: ${JSON.stringify(resp.data)}`);
  // }
  // return resp.data;
}
export const getBlockedDates = async (req: Request, res: Response) => {
  const employeeId = Number(req.params.employeeId);

  const existing = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: { in: ["APPROVED", "PENDING"] }
    },
    select: { id: true, startDate: true, endDate: true }
  });

  return res.json(existing);
};
// export const getLeaveBalance = async (req: Request, res: Response) => {
//   try {
//     const employeeId = Number(req.params.employeeId);
//     const year = Number(req.query.year) || new Date().getFullYear();

//     const balances = await prisma.employeeLeaveBalance.findMany({
//       where: { employeeId, year, category: 'LEAVE' },
//       include: { leaveType: true }
//     });

//     res.json(
//       balances.map(b => ({
//         leaveTypeId: b.leaveTypeId,
//         leaveType: b.leaveType?.name ?? null,
//         totalAllowed: b.totalAllowed,
//         used: b.used,
//         remaining: b.totalAllowed - b.used,
//         year: b.year
//       }))
//     );
//   } catch (err) {
//     res.status(500).json({ error: "Failed to fetch leave balance" });
//   }
// };
export const getLeaveBalance = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    // const year = Number(req.query.year) || getFinancialYear(new Date());
    const yearParam = Number(req.query.year);

    const year = Number.isFinite(yearParam)
      ? yearParam
      : getFinancialYear(new Date());

    // 1️⃣ Fetch ALL leave types (master)
    const leaveTypes = await prisma.leaveType.findMany({
      select: { id: true, name: true }
    });

    // 2️⃣ Fetch existing balances
    const balances = await prisma.employeeLeaveBalance.findMany({
      where: { employeeId, year, category: 'LEAVE' },
    });

    // 3️⃣ Map balances by leaveTypeId
    const balanceMap = new Map<number, any>();
    balances.forEach(b => {
      if (b.leaveTypeId) balanceMap.set(b.leaveTypeId, b);
    });

    // 4️⃣ Merge master + balance
    const result = leaveTypes.map(lt => {
      const b = balanceMap.get(lt.id);
      const usedFull = b?.used ?? 0;
      const usedHalfCount = b?.halfDayUsed ?? 0;
      const usedHalfDays = usedHalfCount * 0.5;
      const totalUsed = usedFull + usedHalfDays;



      // return {
      //   leaveTypeId: lt.id,
      //   leaveType: lt.name,
      //   totalAllowed: b?.totalAllowed ?? 0,
      //   used: totalUsed ?? 0,
      //   remaining: (b?.totalAllowed ?? 0) - totalUsed,
      //   year
      // };
      return {
        leaveTypeId: lt.id,
        leaveType: lt.name,
        totalAllowed: b?.totalAllowed ?? 0,
        used: usedFull,
        usedHalf: usedHalfCount,
        totalUsed,
        remaining: (b?.totalAllowed ?? 0) - totalUsed,
        year
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch leave balance" });
  }
};

export const initLeaveEndScheduler = () => {
  cron.schedule("0 9 * * *", async () => {
    console.log("Running leave reminder cron...");

    const today = atStartOfDay(new Date());
    const todayEnd = atEndOfDay(new Date());

    const leaves = await prisma.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        endDate: { gte: today, lte: todayEnd },
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
        const message = `Hello ${emp.firstName}, today is the *last day of your approved leave*. Please be prepared to report tomorrow.`;
        try {
          await createNotification(
            emp.id,
            message
          );
        } catch (err) {
          console.error("Error creating notification:", err);
        }

        if (!emp.phone) continue;


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

export const updateLeaveType = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // leaveRequestId
    const { newLeaveTypeId } = req.body;

    if (!newLeaveTypeId) {
      return res.status(400).json({ error: "New leave type is required" });
    }

    const leave = await prisma.leaveRequest.findUnique({
      where: { id: Number(id) },
      include: {
        employee: true,
        leaveType: true
      }
    });

    if (!leave) {
      return res.status(404).json({ error: "Leave request not found" });
    }

    // Optional safety: don't allow changing approved leave
    if (leave.status === "APPROVED") {
      return res.status(400).json({
        error: "Cannot change leave type after approval"
      });
    }

    if (leave.leaveTypeId === newLeaveTypeId) {
      return res.status(400).json({
        error: "New leave type is same as existing leave type"
      });
    }

    const newLeaveType = await prisma.leaveType.findUnique({
      where: { id: Number(newLeaveTypeId) }
    });

    if (!newLeaveType) {
      return res.status(400).json({ error: "Invalid leave type" });
    }

    // Update leave type
    const updatedLeave = await prisma.leaveRequest.update({
      where: { id: Number(id) },
      data: {
        leaveTypeId: Number(newLeaveTypeId),
        updatedAt: new Date()
      },
      include: {
        employee: true,
        leaveType: true
      }
    });

    const employee = updatedLeave.employee;
    const employeeName = `${employee.firstName} ${employee.lastName}`;
    const start = fmtDate(updatedLeave.startDate);
    const end = fmtDate(updatedLeave.endDate);

    // In-app notification
    const message = `Your leave type for the leave from ${start} to ${end} has been changed to "${newLeaveType.name}".`;

    await createNotification(employee.id, message);


    res.json({
      message: "Leave type updated successfully",
      leave: updatedLeave
    });

  } catch (error) {
    console.error("Error updating leave type:", error);
    res.status(500).json({ error: "Failed to update leave type" });
  }
};
// GET /leaves/casual/monthly-usage
export const getMonthlyCasualUsage = async (req: Request, res: Response) => {
  const employeeId = Number(req.query.employeeId);
  // const year = Number(req.query.year);
  const yearParam = Number(req.query.year);

  const year = Number.isFinite(yearParam)
    ? yearParam
    : getFinancialYear(new Date());
  const month = Number(req.query.month);

  const leaveType = await prisma.leaveType.findFirst({
    where: { name: 'CL' }
  });

  const used = await getUsedCasualLeaveDays(
    employeeId,
    leaveType!.id,
    year,
    month
  );

  res.json({
    used,
    remaining: Math.max(0, 2 - used)
  });
};
async function getUsedCasualLeaveDays(
  employeeId: number,
  leaveTypeId: number,
  year: number,
  month: number
) {
  const calYear = getCalendarYear(year, month);

  const monthStart = new Date(calYear, month - 1, 1);
  const monthEnd = new Date(calYear, month, 0, 23, 59, 59);

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      leaveTypeId,
      status: { in: ['PENDING', 'APPROVED'] },
      startDate: { lte: monthEnd },
      endDate: { gte: monthStart }
    }
  });

  let used = 0;

  for (const l of leaves) {
    const from = new Date(Math.max(l.startDate.getTime(), monthStart.getTime()));
    const to = new Date(Math.min(l.endDate.getTime(), monthEnd.getTime()));

    used += Math.floor(
      (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;
  }

  return used;
}
export const getCompOffCredits = async (req: Request, res: Response) => {
  const employeeId = Number(req.query.employeeId);
  const today = new Date();

  const credits = await prisma.compOffCredit.findMany({
    where: {
      employeeId,
      used: false,
      expiryDate: { gte: today }
    },
    orderBy: { workDate: "asc" }
  });

  res.json(credits);
};


async function getActivePolicy(leaveTypeId: number, onDate: Date) {
  // Your schema has: effectiveFrom/effectiveTo nullable, isActive, financialYearStart etc.
  // Basic: pick latest active policy effective for the date.
  const policies = await prisma.leavePolicy.findMany({
    where: {
      leaveTypeId,
      isActive: true,
      OR: [
        { effectiveFrom: null },
        { effectiveFrom: { lte: onDate } }
      ],
      AND: [
        {
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: onDate } }
          ]
        }
      ]
    },
    orderBy: { createdAt: "desc" },
    take: 1
  });

  return policies[0] ?? null;
}



async function insertLedgerRow(params: {
  employeeId: number;
  leaveTypeId: number;
  year: number;
  month?: number | null;
  credit?: number;
  debit?: number;
  balanceAfter: number;
  action: "CREDIT" | "DEBIT" | "LAPSE" | "ENCASHMENT" | "ADJUSTMENT" | "OPENING_BALANCE";
  referenceType: "ACCRUAL" | "LEAVE_REQUEST" | "LAPSE" | "ENCASHMENT" | "MANUAL";
  referenceId?: number | null;
  performedBy?: number | null;
  source?: "SYSTEM" | "ADMIN" | "EMPLOYEE" | "IMPORT" | null;
  remarks?: string | null;
  metadata?: any;
}) {
  const {
    employeeId, leaveTypeId, year, month,
    credit = 0, debit = 0, balanceAfter,
    action, referenceType, referenceId = null,
    performedBy = null, source = null, remarks = null, metadata = null
  } = params;

  await prisma.leaveLedger.create({
    data: {
      employeeId,
      leaveTypeId,
      year,
      month: month ?? null,
      transactionDate: new Date(),
      referenceType,
      referenceId,
      credit,
      debit,
      balanceAfter,
      action,
      performedBy,
      source,
      remarks,
      metadata
    }
  });
}
export function computeTotalUsed(balance: { used: number; halfDayUsed: number | null }) {
  const usedFull = balance.used ?? 0;
  const halfCount = balance.halfDayUsed ?? 0; // count of half-days
  return usedFull + halfCount * 0.5;
}

async function getBalance(employeeId: number, leaveTypeId: number, year: number) {
  return prisma.employeeLeaveBalance.findFirst({
    where: { employeeId, leaveTypeId, year, category: "LEAVE" }
  });
}

async function getLastLedgerBalance(employeeId: number, leaveTypeId: number) {
  const last = await prisma.leaveLedger.findFirst({
    where: { employeeId, leaveTypeId },
    orderBy: { id: "desc" }, // id autoinc is safe ordering
    select: { balanceAfter: true },
  });
  return last?.balanceAfter ?? 0;
}

/**
 * Rebuild 1 month summary from ledger + previous month closing.
 * IMPORTANT: Opening comes from previous summary closing (or 0 if none).
 */
async function rebuildMonthlySummaryTx(
  tx: Tx,
  employeeId: number,
  leaveTypeId: number,
  year: number,
  month: number,
  openingOverride?: number
) {
  let opening: number;

  if (openingOverride !== undefined) {
    // Caller knows the correct opening (e.g. rollover passing pre-lapse balance)
    opening = openingOverride;
  } else if (month === 4) {
    // Start of financial year — each FY ledger starts from 0.
    // The OPENING_BALANCE credit in April is captured in `credited` below,
    // so opening must be 0. Using March-prev-year closing would double-count
    // any carried balance.
    opening = 0;
  } else {
    const { year: prevYear, month: prevMonth } = getPrevMonthFY(year, month);
    const prev = await tx.leaveMonthlySummary.findUnique({
      where: {
        employeeId_leaveTypeId_year_month: {
          employeeId,
          leaveTypeId,
          year: prevYear,
          month: prevMonth,
        },
      },
    });
    opening = prev?.closing ?? 0;
  }

  const entries = await tx.leaveLedger.findMany({
    where: { employeeId, leaveTypeId, year, month },
    select: { credit: true, debit: true, action: true },
  });

  let credited = 0;
  let used = 0;
  let lapsed = 0;

  for (const e of entries) {
    credited += Number(e.credit ?? 0);

    if (e.action === "LAPSE") {
      lapsed += Number(e.debit ?? 0);
    } else {
      used += Number(e.debit ?? 0);
    }
  }

  const closing = opening + credited - used - lapsed; // (lapsed already part of debit/used)

  await tx.leaveMonthlySummary.upsert({
    where: {
      employeeId_leaveTypeId_year_month: {
        employeeId,
        leaveTypeId,
        year,
        month,
      },
    },
    update: { opening, credited, used, lapsed, closing },
    create: { employeeId, leaveTypeId, year, month, opening, credited, used, lapsed, closing },
  });

  return { opening, credited, used, lapsed, closing };
}
async function rebuildYearlySummaryTx(
  tx: Tx,
  employeeId: number,
  leaveTypeId: number,
  year: number
) {
  const months = await tx.leaveMonthlySummary.findMany({
    where: { employeeId, leaveTypeId, year },
    orderBy: { month: "asc" },
  });

  // const opening = months.find((m) => m.month === 1)?.opening ?? 0;
  const opening = months.find((m) => m.month === 4)?.opening ?? 0;
  const credited = months.reduce((s, m) => s + Number(m.credited ?? 0), 0);
  const used = months.reduce((s, m) => s + Number(m.used ?? 0), 0);
  const lapsed = months.reduce((s, m) => s + Number(m.lapsed ?? 0), 0);

  // Sum encashment debits from the ledger for this year
  const encashmentEntries = await tx.leaveLedger.findMany({
    where: { employeeId, leaveTypeId, year, action: "ENCASHMENT" },
    select: { debit: true },
  });
  const encashed = encashmentEntries.reduce((s, e) => s + Number(e.debit ?? 0), 0);

  const closing = opening + credited - used - lapsed - encashed;

  await tx.leaveYearlySummary.upsert({
    where: {
      employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year },
    },
    update: { opening, credited, used, lapsed, encashed, closing },
    create: { employeeId, leaveTypeId, year, opening, credited, used, lapsed, encashed, closing },
  });

  return { opening, credited, used, lapsed, closing };
}
/**
 * If a leave spans multiple months, you should rebuild all touched months.
 */
export function getTouchedMonths(startDate: Date, endDate: Date) {
  const s = atStartOfDay(startDate);
  const e = atStartOfDay(endDate);

  const out: Array<{ year: number; month: number }> = [];
  const cursor = new Date(s);

  cursor.setDate(1);
  while (cursor <= e) {
    out.push({ year: getFinancialYear(cursor), month: cursor.getMonth() + 1 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // de-dupe (safe)
  const keySet = new Set<string>();
  return out.filter((x) => {
    const k = `${x.year}-${x.month}`;
    if (keySet.has(k)) return false;
    keySet.add(k);
    return true;
  });
}

export async function insertLedgerTx(
  tx: Tx,
  params: {
    employeeId: number;
    leaveTypeId: number;
    year: number;
    month?: number | null;
    credit?: number;
    debit?: number;
    balanceAfter: number;
    action: "CREDIT" | "DEBIT" | "LAPSE" | "ENCASHMENT" | "ADJUSTMENT" | "OPENING_BALANCE";
    referenceType: "ACCRUAL" | "LEAVE_REQUEST" | "LAPSE" | "ENCASHMENT" | "MANUAL";
    referenceId?: number | null;
    performedBy?: number | null;
    source?: "SYSTEM" | "ADMIN" | "EMPLOYEE" | "IMPORT" | null;
    remarks?: string | null;
    metadata?: any;
  }
) {
  const {
    employeeId,
    leaveTypeId,
    year,
    month,
    credit = 0,
    debit = 0,
    balanceAfter,
    action,
    referenceType,
    referenceId = null,
    performedBy = null,
    source = null,
    remarks = null,
    metadata = null,
  } = params;

  return tx.leaveLedger.create({
    data: {
      employeeId,
      leaveTypeId,
      year,
      month: month ?? null,
      transactionDate: new Date(),
      referenceType,
      referenceId,
      credit,
      debit,
      balanceAfter,
      action,
      performedBy,
      source,
      remarks,
      metadata,
    },
  });
}
// ── Core EL accrual logic — called by cron AND manual trigger ──────────────
async function runELAccrual(overrideYear?: number, overrideMonth?: number) {
  const today = atStartOfDay(new Date());
  const year = overrideYear ?? getFinancialYear(today);
  const month = overrideMonth ?? (today.getMonth() + 1);

  // 1️⃣ EL Leave Type
  const el = await prisma.leaveType.findFirst({
    where: { name: "EL" },
    select: { id: true }
  });

  if (!el) return { error: "EL leave type not found" };

  // 2️⃣ Policy
  const policy = await getActivePolicy(el.id, today);
  console.log("Active EL policy:", policy);
  if (!policy) return { error: "No active EL policy found" };

  if (policy.accrualType !== "MONTHLY") return { error: "EL policy is not MONTHLY accrual" };

  const monthlyCredit = Number(policy.accrualRate ?? 0);
  if (!monthlyCredit) return { error: "EL accrual rate is 0" };

  const workingDaysRequired = policy.workingDaysRequired ?? 0;
  const maxBalance = policy.maxBalance ?? null;

  // 3️⃣ Employees — only those who have completed 1 year of service
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const employees = await prisma.employee.findMany({
    where: {
      employmentStatus: "ACTIVE",
      dateOfJoining: { lte: oneYearAgo },
    },
    select: { id: true },
  });

  let credited = 0, skipped = 0;
  const errors: string[] = [];

  // 4️⃣ Loop employees
  for (const emp of employees) {
    try {
      let didCredit = false;

      await prisma.$transaction(async (tx) => {
        // ❗ Skip if already credited
        const exists = await tx.leaveAccrual.findUnique({
          where: {
            employeeId_leaveTypeId_year_month: {
              employeeId: emp.id,
              leaveTypeId: el.id,
              year,
              month
            }
          }
        });

        if (exists) { skipped++; return; }

        // 4.1️⃣ & 4.2️⃣ Working days check — PAUSED for now
        // TODO: Uncomment when attendance data is ready
        // const shift = await tx.shiftApproval.findFirst({
        //   where: { employeeId: emp.id, status: "APPROVED", month, year },
        //   select: { weekOffConfig: true }
        // });
        // const weekOffConfig = shift?.weekOffConfig ?? null;
        // const workedDays = await getWorkedDaysOptimized(emp.id, year, month, weekOffConfig);
        // if (workingDaysRequired && workedDays < workingDaysRequired) {
        //   console.log(`❌ Skipping EL for emp ${emp.id}, worked: ${workedDays}`);
        //   skipped++;
        //   return;
        // }
        const workedDays = 'N/A (check paused)';

        // 4.3️⃣ Balance row
        const bal = await tx.employeeLeaveBalance.upsert({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId: emp.id,
              leaveTypeId: el.id,
              year
            }
          },
          update: {},
          create: {
            employeeId: emp.id,
            leaveTypeId: el.id,
            category: "LEAVE",
            year,
            totalAllowed: 0,
            used: 0,
            halfDayUsed: 0
          }
        });

        // 4.4️⃣ Ledger balance
        const prevBalance = await getLastLedgerBalanceTx(tx, emp.id, el.id, year);

        const credit = monthlyCredit;
        if (credit <= 0) { skipped++; return; }

        // 4.5️⃣ Accrual record
        await tx.leaveAccrual.create({
          data: {
            employeeId: emp.id,
            leaveTypeId: el.id,
            year,
            month,
            accrualType: "MONTHLY",
            daysCredited: credit
          }
        });

        // 4.6️⃣ Balance update
        await tx.employeeLeaveBalance.update({
          where: { id: bal.id },
          data: {
            totalAllowed: { increment: credit }
          }
        });

        // 4.7️⃣ Ledger — credit
        const balanceAfterCredit = prevBalance + credit;

        await insertLedgerTx(tx, {
          employeeId: emp.id,
          leaveTypeId: el.id,
          year,
          month,
          credit,
          debit: 0,
          balanceAfter: balanceAfterCredit,
          action: "CREDIT",
          referenceType: "ACCRUAL",
          source: "SYSTEM",
          remarks: `EL credited (worked ${workedDays} days)`
        });

        // 4.7b️⃣ Auto-encash excess over maxBalance
        if (maxBalance != null && balanceAfterCredit > maxBalance) {
          const excessDays = balanceAfterCredit - maxBalance;

          await tx.employeeLeaveBalance.update({
            where: { id: bal.id },
            data: {
              totalAllowed: { decrement: excessDays }
            }
          });

          await insertLedgerTx(tx, {
            employeeId: emp.id,
            leaveTypeId: el.id,
            year,
            month,
            credit: 0,
            debit: excessDays,
            balanceAfter: maxBalance,
            action: "ENCASHMENT",
            referenceType: "ENCASHMENT",
            source: "SYSTEM",
            remarks: `EL auto-encashed ${excessDays} days (exceeded max balance ${maxBalance})`
          });

          console.log(`💰 EL auto-encashed ${excessDays} days for emp ${emp.id}`);
        }

        credited++;
        didCredit = true;
      }, { timeout: 15000 });

      // 4.8️⃣ Summaries — outside transaction to avoid timeout
      if (didCredit) {
        await rebuildMonthlySummaryTx(prisma, emp.id, el.id, year, month);
        await rebuildYearlySummaryTx(prisma, emp.id, el.id, year);
      }
    } catch (err: any) {
      errors.push(`emp ${emp.id}: ${err?.message ?? "unknown"}`);
    }
  }

  console.log(`✅ EL accrual done for ${year}-${month}: credited=${credited}, skipped=${skipped}`);
  return { year, month, totalEmployees: employees.length, credited, skipped, errors };
}

// ── Manual trigger endpoint ────────────────────────────────────────────────
export const triggerELAccrual = async (req: Request, res: Response) => {
  try {
    const year = req.body.year ? Number(req.body.year) : undefined;
    const month = req.body.month ? Number(req.body.month) : undefined;
    const result = await runELAccrual(year, month);
    return res.json(result);
  } catch (e: any) {
    console.error("Manual EL accrual error:", e);
    return res.status(500).json({ error: e.message });
  }
};

// ── Cron wrapper ───────────────────────────────────────────────────────────
export const initELAccrualCron = () => {
  cron.schedule("10 2 1 * *", async () => {
    try {
      await runELAccrual();
    } catch (e) {
      console.error("EL CRON ERROR:", e);
    }
  });
};
export async function getLastLedgerBalanceTx(
  tx: Tx,
  employeeId: number,
  leaveTypeId: number,
  year: number
) {
  const last = await tx.leaveLedger.findFirst({
    where: { employeeId, leaveTypeId, year },
    orderBy: { id: "desc" },
    select: { balanceAfter: true },
  });
  return last?.balanceAfter ?? 0;
}


function getWeekOfMonth(date: Date) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const dayOfMonth = date.getDate();
  const adjusted = dayOfMonth + firstDay.getDay();
  return Math.ceil(adjusted / 7);
}

function isWeeklyOffFromConfig(config: any, date: Date) {
  const day = date.getDay();

  if (!config) {
    return day === 0; // Sunday fallback
  }

  // Fixed weekly off
  if (config.fixedDays && Array.isArray(config.fixedDays)) {
    return config.fixedDays.includes(day);
  }

  // Rotational
  if (config.weeks && Array.isArray(config.weeks)) {
    const weekIndex = getWeekOfMonth(date) - 1;
    const offDay = config.weeks[weekIndex];

    if (offDay !== undefined) {
      return day === offDay;
    }
  }

  return day === 0;
}
async function getWorkedDaysOptimized(
  employeeId: number,
  year: number,
  month: number,
  weekOffConfig: any
) {
  const calYear = getCalendarYear(year, month);

  const start = new Date(calYear, month - 1, 1);
  const end = new Date(calYear, month, 0, 23, 59, 59);

  console.log(`Calculating worked days for emp ${employeeId} in ${year}-${month}...`);
  console.log(`Date range: ${fmtDate(start)} to ${fmtDate(end)}`);

  const workedDates = new Set<string>();

  // 1️⃣ Attendance
  const attendance = await prisma.attendance.findMany({
    where: {
      employeeId,
      date: { gte: start, lte: end },
      status: "PRESENT"
    },
    select: { date: true }
  });

  console.log(`Attendance records for emp ${employeeId} in ${year}-${month}:`, attendance.length);

  attendance.forEach(a => {
    workedDates.add(atStartOfDay(a.date).toISOString());
  });

  // 2️⃣ Approved Leave
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: "APPROVED",
      startDate: { lte: end },
      endDate: { gte: start }
    }
  });

  for (const l of leaves) {
    const from = new Date(Math.max(l.startDate.getTime(), start.getTime()));
    const to = new Date(Math.min(l.endDate.getTime(), end.getTime()));

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      workedDates.add(atStartOfDay(d).toISOString());
    }
  }

  // 3️⃣ Remove weekly offs (NO DB CALL HERE 🔥)
  let finalCount = 0;

  for (const dateStr of workedDates) {
    const d = new Date(dateStr);

    if (!isWeeklyOffFromConfig(weekOffConfig, d)) {
      finalCount++;
    }
  }

  console.log(`Final worked days for emp ${employeeId} in ${year}-${month}: ${finalCount}`);

  return finalCount;
}

export type LeaveStartMode = "DOJ" | "PROBATION_END";

/**
 * Controls when a new employee's CL/SL is credited:
 *  - "DOJ" (default): pro-rata from the Date of Joining, at employee creation.
 *    The probation period is ignored for leave accrual — matches the leave
 *    policy ("1 CL & 1 SL per month from DOJ").
 *  - "PROBATION_END": pro-rata from the probation end date, via the daily cron
 *    below (legacy behavior).
 * Set LEAVE_BALANCE_START_MODE=PROBATION_END in .env to use the legacy behavior.
 */
export function getLeaveStartMode(): LeaveStartMode {
  return config.leave.balanceStartMode === "PROBATION_END"
    ? "PROBATION_END"
    : "DOJ";
}

/**
 * Pro-rata CL/SL entitlement counting from `baseDate` to the end of that
 * financial year. Half-month rule: if `baseDate` is after the 15th, that month
 * is not counted (start shifts to the 1st of the next month).
 */
export function getNewJoineeEntitlement(baseDate: Date) {
  const fy = getFinancialYearBounds(baseDate);

  // ✅ APPLY HALF-MONTH RULE
  let effectiveStart = new Date(baseDate);
  if (baseDate.getDate() > 15) {
    // skip current month → move to next month 1st
    effectiveStart = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth() + 1,
      1
    );
  }

  const months = getRemainingMonths(effectiveStart, fy.end);

  const CL_ANNUAL = 12;
  const SL_ANNUAL = 12;

  return {
    fyYear: fy.fyYear,
    effectiveStart,
    months,
    cl: (CL_ANNUAL / 12) * months,
    sl: (SL_ANNUAL / 12) * months,
  };
}

/**
 * Allocate pro-rata CL & SL for a new joinee, counting from `baseDate`.
 * Idempotent per (employee, leaveType, FY) via the OPENING_BALANCE guard in
 * allocateLeave, so re-running it will not double-credit.
 */
export async function allocateNewJoineeLeave(employeeId: number, baseDate: Date) {
  const { cl, sl, fyYear, effectiveStart } = getNewJoineeEntitlement(baseDate);

  await prisma.$transaction(async (tx) => {
    await allocateLeave(tx, employeeId, "CL", cl, fyYear, effectiveStart);
    await allocateLeave(tx, employeeId, "SL", sl, fyYear, effectiveStart);
  });

  return { cl, sl, fyYear };
}

export const initNewJoineeLeaveAllocationCron = () => {
  cron.schedule("0 2 * * *", async () => {
    // In DOJ mode, CL/SL is credited at employee creation (createEmployee),
    // not at probation end — so this cron is a no-op.
    if (getLeaveStartMode() !== "PROBATION_END") return;

    console.log("Running New Joinee Leave Allocation Cron...");

    const today = new Date();

    const employees = await prisma.employee.findMany({
      where: {
        employmentStatus: "ACTIVE",
        probationEndDate: {
          lte: today
        }
      }
    });

    for (const emp of employees) {
      if (!emp.probationEndDate) continue;

      const eligibleDate = new Date(emp.probationEndDate as Date);

      // 👉 Only trigger ONCE, on the probation end date
      if (!isSameDate(eligibleDate, today)) continue;

      const { cl, sl } = await allocateNewJoineeLeave(emp.id, eligibleDate);

      console.log(`✅ Leave allocated for emp ${emp.id}: CL=${cl}, SL=${sl}`);
    }
  });
};

function getRemainingMonths(from: Date, to: Date) {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth()) + 1
  );
}

function getFinancialYearBounds(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  if (month >= 4) {
    return {
      start: new Date(year, 3, 1),
      end: new Date(year + 1, 2, 31),
      fyYear: year
    };
  } else {
    return {
      start: new Date(year - 1, 3, 1),
      end: new Date(year, 2, 31),
      fyYear: year - 1
    };
  }
}
async function allocateLeave(
  tx: Tx,
  employeeId: number,
  leaveName: string,
  amount: number,
  year: number,
  date: Date
) {
  const lt = await tx.leaveType.findFirst({
    where: { name: leaveName }
  });

  if (!lt) return;

  // Idempotency: don't re-allocate if a system opening balance already exists
  // for this employee + leave type + financial year (e.g. cron + DOJ paths, or
  // a re-run). Prevents double-crediting.
  const alreadyAllocated = await tx.leaveLedger.findFirst({
    where: {
      employeeId,
      leaveTypeId: lt.id,
      year,
      action: "OPENING_BALANCE",
      source: "SYSTEM",
    },
  });
  if (alreadyAllocated) return;

  const prevBalance = await getLastLedgerBalanceTx(tx, employeeId, lt.id, year);
  const newBalance = prevBalance + amount;

  // 1️⃣ Balance Table
  await tx.employeeLeaveBalance.upsert({
    where: {
      employeeId_leaveTypeId_year: {
        employeeId,
        leaveTypeId: lt.id,
        year
      }
    },
    update: {
      totalAllowed: amount
    },
    create: {
      employeeId,
      leaveTypeId: lt.id,
      category: "LEAVE",
      year,
      totalAllowed: amount,
      used: 0,
      halfDayUsed: 0
    }
  });

  // 2️⃣ Ledger Entry
  await insertLedgerTx(tx, {
    employeeId,
    leaveTypeId: lt.id,
    year,
    month: date.getMonth() + 1,
    credit: amount,
    debit: 0,
    balanceAfter: newBalance,
    action: "OPENING_BALANCE",
    referenceType: "MANUAL",
    source: "SYSTEM",
    remarks: "Auto allocation after probation"
  });

  // 3️⃣ Summaries
  await rebuildMonthlySummaryTx(tx, employeeId, lt.id, year, date.getMonth() + 1);
  await rebuildYearlySummaryTx(tx, employeeId, lt.id, year);
}
export function getFinancialYear(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  return month >= 4 ? year : year - 1;
}

function getPrevMonthFY(year: number, month: number) {
  if (month === 4) {
    return { year: year - 1, month: 3 }; // March of previous FY
  }
  return { year, month: month - 1 };
}
export function getCalendarYear(fyYear: number, month: number) {
  return month >= 4 ? fyYear : fyYear + 1;
}



export const bulkUploadLeaveBalancesExcel = async (req: Request, res: Response) => {
  try {
    const form = formidable({ multiples: false, keepExtensions: true });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        return res.status(500).json({ error: "File parsing error" });
      }

      const fileObj = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!fileObj) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      // =========================
      // 📥 READ EXCEL
      // =========================
      const workbook = XLSX.readFile(fileObj.filepath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);

      // =========================
      // 🔧 PREP DATA
      // =========================
      const year = fields.year ? Number(fields.year) : getFinancialYear(new Date());
      const month = fields.month ? Number(fields.month) : new Date().getMonth() + 1;

      const [leaveTypes, employees] = await Promise.all([
        prisma.leaveType.findMany(),
        prisma.employee.findMany({
          select: { id: true, employeeCode: true }
        })
      ]);

      const leaveTypeMap: Record<string, number> = {};
      leaveTypes.forEach(lt => {
        leaveTypeMap[lt.name.toUpperCase()] = lt.id;
      });

      const employeeMap = new Map<string, number>();
      employees.forEach(emp => {
        employeeMap.set(emp.employeeCode, emp.id);
      });

      const logs: string[] = [];
      const errorRows: any[] = [];
      const affected = new Set<string>();

      const limit = pLimit(5); // prevent DB overload

      // =========================
      // PROCESS EACH ROW
      // =========================
      const processRow = async (row: any, index: number) => {
        // Normalize: find the employee code regardless of header casing/spacing
        const code = row.employeeCode
          || row["Emp Code"]
          || row["emp code"]
          || row["EmpCode"]
          || row["empCode"]
          || row["Employee Code"]
          || row["employee code"]
          || Object.entries(row).find(([k]) => k.trim().toLowerCase().replace(/\s+/g, '') === 'empcode')?.[1];

        console.log(code)

        try {
          if (!code) throw new Error("employeeCode missing");

          const employeeId = employeeMap.get(String(code).trim());

          if (!employeeId) {
            throw new Error(`Employee not found: ${code}`);
          }

          for (const key of ["CL", "SL", "EL"]) {
            const leaveTypeId = leaveTypeMap[key];
            if (!leaveTypeId) continue;

            // const newTotal = Number(row[key] ?? 0);

            const rawValue = row[key];

            // SKIP empty cells (IMPORTANT FIX)
            if (
              rawValue === undefined ||
              rawValue === null ||
              String(rawValue).trim() === ""
            ) {
              continue;
            }

            const newTotal = Number(rawValue);

            //Validate numeric
            if (isNaN(newTotal)) {
              throw new Error(`${key} must be a valid number`);
            }


            await prisma.$transaction(async (tx) => {

              const existing = await tx.employeeLeaveBalance.findFirst({
                where: { employeeId, leaveTypeId, year }
              });

              const prevTotal = existing?.totalAllowed ?? 0;
              const delta = newTotal - prevTotal;

              // UPSERT BALANCE
              await tx.employeeLeaveBalance.upsert({
                where: {
                  employeeId_leaveTypeId_year: {
                    employeeId,
                    leaveTypeId,
                    year
                  }
                },
                update: {
                  totalAllowed: newTotal
                },
                create: {
                  employeeId,
                  leaveTypeId,
                  category: "LEAVE",
                  year,
                  totalAllowed: newTotal,
                  used: 0,
                  halfDayUsed: 0
                }
              });

              // LEDGER
              if (delta !== 0) {
                const prevBalance = await getLastLedgerBalanceTx(
                  tx,
                  employeeId,
                  leaveTypeId,
                  year
                );

                const newBalance = prevBalance + delta;

                await insertLedgerTx(tx, {
                  employeeId,
                  leaveTypeId,
                  year,
                  month,
                  credit: delta > 0 ? delta : 0,
                  debit: delta < 0 ? Math.abs(delta) : 0,
                  balanceAfter: newBalance,
                  action: "ADJUSTMENT",
                  referenceType: "MANUAL",
                  source: "IMPORT",
                  remarks: "Excel bulk upload"
                });
              }

            }, { timeout: 10000 });

            affected.add(`${employeeId}-${leaveTypeId}`);
          }

          logs.push(`Row ${index + 1}: SUCCESS (${code})`);

        } catch (error: any) {
          errorRows.push({
            rowNumber: index + 1,
            employeeCode: code,
            error: error.message,
            ...row,
          });

          logs.push(`Row ${index + 1}: FAILED → ${error.message}`);
        }
      };

      //  Controlled parallel execution
      await Promise.all(
        rows.map((row, i) => limit(() => processRow(row, i)))
      );

      // =========================
      // REBUILD SUMMARIES (ONCE)
      // =========================
      for (const key of affected) {
        const [employeeId, leaveTypeId] = key.split("-").map(Number);

        await rebuildMonthlySummaryTx(
          prisma,
          employeeId,
          leaveTypeId,
          year,
          month
        );

        await rebuildYearlySummaryTx(
          prisma,
          employeeId,
          leaveTypeId,
          year
        );
      }

      return res.json({
        totalRows: rows.length,
        successCount: rows.length - errorRows.length,
        failedCount: errorRows.length,
        logs,
        errors: errorRows
      });
    });

  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: "Excel bulk upload failed" });
  }
};

// ── Core rollover logic — called by cron AND manual trigger ──────────────────
export async function runFYRollover(
  overrideYear?: number
): Promise<{ processed: number; skipped: number; errors: string[] }> {
  const today = atStartOfDay(new Date());
  const newYear = overrideYear ?? getFinancialYear(today);
  const prevYear = newYear - 1;
  const month = 4; // April — first month of Indian FY

  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];

  const [employees, leaveTypes] = await Promise.all([
    prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: { id: true },
    }),
    prisma.leaveType.findMany(),
  ]);

  console.log('hi')

  const leaveTypeMap: Record<string, number> = {};
  leaveTypes.forEach(lt => { leaveTypeMap[lt.name.toUpperCase()] = lt.id; });

  for (const emp of employees) {
    try {
      // ── Idempotency: read-only check outside any transaction ──────────────
      const alreadyProcessed = await prisma.leaveLedger.findFirst({
        where: { employeeId: emp.id, year: newYear, action: "OPENING_BALANCE", source: "SYSTEM" },
        select: { id: true },
      });
      if (alreadyProcessed) { skipped++; continue; }

      // =====================================================
      // 🔹 CL — NO CARRY FORWARD (policy: lapses at year-end)
      // ── Small tx: writes only. Rebuilds happen outside. ──
      // =====================================================
      const clId = leaveTypeMap["CL"];
      let clLapsedPrev = false;
      let clPrevRemaining = 0;
      if (clId) {
        await prisma.$transaction(async (tx) => {
          // Use ledger balance as source of truth — balance table may be out of sync
          const prevCLLedger = await getLastLedgerBalanceTx(tx, emp.id, clId, prevYear);
          clPrevRemaining = Math.max(0, prevCLLedger);

          if (clPrevRemaining > 0) {
            await insertLedgerTx(tx, {
              employeeId: emp.id, leaveTypeId: clId, year: prevYear, month: 3,
              credit: 0, debit: clPrevRemaining, balanceAfter: 0,
              action: "LAPSE", referenceType: "LAPSE", source: "SYSTEM", remarks: "CL year-end lapse",
            });
            clLapsedPrev = true;
          }
          const totalCL = 12;
          await tx.employeeLeaveBalance.upsert({
            where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: clId, year: newYear } },
            update: { totalAllowed: totalCL, used: 0, halfDayUsed: 0 },
            create: { employeeId: emp.id, leaveTypeId: clId, category: "LEAVE", year: newYear, totalAllowed: totalCL, used: 0, halfDayUsed: 0 },
          });
          const clPrevBal = await getLastLedgerBalanceTx(tx, emp.id, clId, newYear);
          await insertLedgerTx(tx, {
            employeeId: emp.id, leaveTypeId: clId, year: newYear, month,
            credit: totalCL, debit: 0, balanceAfter: clPrevBal + totalCL,
            action: "OPENING_BALANCE", referenceType: "MANUAL", source: "SYSTEM", remarks: "CL yearly allocation",
          });
        }, { timeout: 8000 });

        // Rebuild OUTSIDE transaction (avoids P2028 / P1017 timeout)
        if (clLapsedPrev) {
          // Pass clPrevRemaining as openingOverride so March opening is correct
          // even when earlier monthly summaries are missing.
          await rebuildMonthlySummaryTx(prisma, emp.id, clId, prevYear, 3, clPrevRemaining);
          await rebuildYearlySummaryTx(prisma, emp.id, clId, prevYear);
        }
        await rebuildMonthlySummaryTx(prisma, emp.id, clId, newYear, month);
        await rebuildYearlySummaryTx(prisma, emp.id, clId, newYear);
      }

      // =====================================================
      // 🔹 SL — CARRY FORWARD MAX 60 DAYS
      // =====================================================
      const slId = leaveTypeMap["SL"];
      let slLapsedPrev = false;
      let slPrevRemaining = 0;
      if (slId) {
        await prisma.$transaction(async (tx) => {
          // Use ledger balance as source of truth — balance table may be out of sync
          const prevSLLedger = await getLastLedgerBalanceTx(tx, emp.id, slId, prevYear);
          slPrevRemaining = Math.max(0, prevSLLedger);
          const slCarry  = Math.min(slPrevRemaining, 60);
          const slLapsed = slPrevRemaining - slCarry;

          if (slLapsed > 0) {
            await insertLedgerTx(tx, {
              employeeId: emp.id, leaveTypeId: slId, year: prevYear, month: 3,
              credit: 0, debit: slLapsed, balanceAfter: prevSLLedger - slLapsed,
              action: "LAPSE", referenceType: "LAPSE", source: "SYSTEM",
              remarks: "SL year-end lapse (excess over 60-day carry limit)",
            });
            slLapsedPrev = true;
          }
          const totalSL = 12 + slCarry;
          await tx.employeeLeaveBalance.upsert({
            where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: slId, year: newYear } },
            update: { totalAllowed: totalSL, used: 0, halfDayUsed: 0 },
            create: { employeeId: emp.id, leaveTypeId: slId, category: "LEAVE", year: newYear, totalAllowed: totalSL, used: 0, halfDayUsed: 0 },
          });
          const slPrevBal = await getLastLedgerBalanceTx(tx, emp.id, slId, newYear);
          await insertLedgerTx(tx, {
            employeeId: emp.id, leaveTypeId: slId, year: newYear, month,
            credit: totalSL, debit: 0, balanceAfter: slPrevBal + totalSL,
            action: "OPENING_BALANCE", referenceType: "MANUAL", source: "SYSTEM",
            remarks: `SL yearly allocation (12 fresh + ${slCarry} carried)`,
          });
        }, { timeout: 8000 });

        if (slLapsedPrev) {
          await rebuildMonthlySummaryTx(prisma, emp.id, slId, prevYear, 3, slPrevRemaining);
          await rebuildYearlySummaryTx(prisma, emp.id, slId, prevYear);
        }
        await rebuildMonthlySummaryTx(prisma, emp.id, slId, newYear, month);
        await rebuildYearlySummaryTx(prisma, emp.id, slId, newYear);
      }

      // =====================================================
      // 🔹 EL — POLICY-BASED CARRY FORWARD
      // =====================================================
      const elId = leaveTypeMap["EL"];
      let elLapsedPrev = false;
      let elPrevRemaining = 0;
      if (elId) {
        // Fetch policy OUTSIDE tx (read-only, no need to hold a connection)
        const elPolicy = await getActivePolicy(elId, today);

        await prisma.$transaction(async (tx) => {
          // Use ledger balance as source of truth — balance table may be out of sync
          const prevELLedger = await getLastLedgerBalanceTx(tx, emp.id, elId, prevYear);
          elPrevRemaining = Math.max(0, prevELLedger);

          let elCarry = 0;
          console.log(`EL rollover for emp ${emp.id}: prevRemaining=${elPrevRemaining}, policy carryForward=${elPolicy?.carryForward}, maxCarryForward=${elPolicy?.maxCarryForward}`);
          if (elPolicy?.carryForward) {
            elCarry = elPolicy.maxCarryForward
              ? Math.min(elPrevRemaining, elPolicy.maxCarryForward)
              : elPrevRemaining;

          console.log(`EL policy for emp ${emp.id}: carryForward=${elPolicy.carryForward}, maxCarryForward=${elPolicy.maxCarryForward}, prevRemaining=${elPrevRemaining}, calculatedCarry=${elCarry}`);
          }

          const elLapsed = elPrevRemaining - elCarry;
          if (elLapsed > 0) {
            await insertLedgerTx(tx, {
              employeeId: emp.id, leaveTypeId: elId, year: prevYear, month: 3,
              credit: 0, debit: elLapsed, balanceAfter: prevELLedger - elLapsed,
              action: "LAPSE", referenceType: "LAPSE", source: "SYSTEM",
              remarks: "EL year-end lapse (excess over carry limit)",
            });
            elLapsedPrev = true;
          }

          await tx.employeeLeaveBalance.upsert({
            where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: elId, year: newYear } },
            update: { totalAllowed: elCarry, used: 0, halfDayUsed: 0 },
            create: { employeeId: emp.id, leaveTypeId: elId, category: "LEAVE", year: newYear, totalAllowed: elCarry, used: 0, halfDayUsed: 0 },
          });

          if (elCarry > 0) {
            const elPrevBal = await getLastLedgerBalanceTx(tx, emp.id, elId, newYear);
            await insertLedgerTx(tx, {
              employeeId: emp.id, leaveTypeId: elId, year: newYear, month,
              credit: elCarry, debit: 0, balanceAfter: elPrevBal + elCarry,
              action: "OPENING_BALANCE", referenceType: "MANUAL", source: "SYSTEM",
              remarks: "EL carry forward",
            });
          }
        }, { timeout: 8000 });

        if (elLapsedPrev) {
          await rebuildMonthlySummaryTx(prisma, emp.id, elId, prevYear, 3, elPrevRemaining);
          await rebuildYearlySummaryTx(prisma, emp.id, elId, prevYear);
        }
        await rebuildMonthlySummaryTx(prisma, emp.id, elId, newYear, month);
        await rebuildYearlySummaryTx(prisma, emp.id, elId, newYear);
      }

      processed++;
    } catch (err: any) {
      errors.push(`emp ${emp.id}: ${err?.message ?? "unknown error"}`);
      console.error(`❌ FY rollover failed for emp ${emp.id}:`, err);
    }
  }

  return { processed, skipped, errors };
}

// ── Cron wrapper ─────────────────────────────────────────────────────────────
export const initFinancialYearRolloverCron = () => {
  cron.schedule("0 2 1 4 *", async () => {
    console.log("🚀 Running FY Rollover Cron...");
    const result = await runFYRollover();
    console.log(`✅ FY rollover done — processed: ${result.processed}, skipped: ${result.skipped}, errors: ${result.errors.length}`);
    if (result.errors.length) console.error("FY rollover errors:", result.errors);
  });
};

// ── Purge wrong rollover data + re-run ───────────────────────────────────────
export const purgeAndRerunFYRollover = async (req: Request, res: Response) => {
  const year: number = req.body?.year ? Number(req.body.year) : 2026;
  const prevYear = year - 1;

  try {
    console.log(`🗑️ Purging FY ${year} rollover data (prev year lapse entries from ${prevYear})...`);

    // 1. Delete all ledger entries for the target year (opening balances etc.)
    const deletedLedger2026 = await prisma.leaveLedger.deleteMany({
      where: { year },
    });

    // 2. Delete LAPSE entries added for prevYear month=3 during the wrong rollover
    const deletedLapse2025 = await prisma.leaveLedger.deleteMany({
      where: {
        year: prevYear,
        month: 3,
        action: 'LAPSE',
        source: 'SYSTEM',
      },
    });

    // 3. Delete EmployeeLeaveBalance for target year
    const deletedBalance = await prisma.employeeLeaveBalance.deleteMany({
      where: { year },
    });

    // 4. Delete monthly/yearly summaries for target year
    const deletedMonthly2026 = await prisma.leaveMonthlySummary.deleteMany({
      where: { year },
    });
    const deletedYearly2026 = await prisma.leaveYearlySummary.deleteMany({
      where: { year },
    });

    // 5. Delete prevYear month=3 summaries (rebuilt wrongly during bad rollover)
    const deletedMonthly2025 = await prisma.leaveMonthlySummary.deleteMany({
      where: { year: prevYear, month: 3 },
    });
    const deletedYearly2025 = await prisma.leaveYearlySummary.deleteMany({
      where: { year: prevYear },
    });

    console.log(`✅ Purge complete — ledger:${deletedLedger2026.count}, lapse:${deletedLapse2025.count}, balance:${deletedBalance.count}, monthly2026:${deletedMonthly2026.count}, yearly2026:${deletedYearly2026.count}, monthly2025march:${deletedMonthly2025.count}, yearly2025:${deletedYearly2025.count}`);

    // 6. Re-run rollover with clean data
    console.log(`🚀 Re-running FY rollover for year ${year}...`);
    const result = await runFYRollover(year);

    return res.json({
      message: `FY ${year} data purged and rollover re-run successfully`,
      purged: {
        ledger2026: deletedLedger2026.count,
        lapse2025: deletedLapse2025.count,
        balance2026: deletedBalance.count,
        monthly2026: deletedMonthly2026.count,
        yearly2026: deletedYearly2026.count,
        monthly2025March: deletedMonthly2025.count,
        yearly2025: deletedYearly2025.count,
      },
      rollover: result,
    });
  } catch (err: any) {
    console.error('Purge + re-run failed:', err);
    return res.status(500).json({ error: 'Purge failed', message: err?.message });
  }
};

// ── Manual trigger (admin endpoint handler) ───────────────────────────────────
export const triggerFYRollover = async (req: Request, res: Response) => {
  try {
    const overrideYear = req.body?.year ? Number(req.body.year) : undefined;
    console.log(`🔧 Manual FY rollover triggered${overrideYear ? ` for year ${overrideYear}` : ""}`);
    const result = await runFYRollover(overrideYear);
    return res.json({
      message: "FY rollover completed",
      year: overrideYear ?? getFinancialYear(new Date()),
      ...result,
    });
  } catch (err: any) {
    console.error("Manual FY rollover failed:", err);
    return res.status(500).json({ error: "FY rollover failed", message: err?.message });
  }
};


async function uploadToFTP(localFilePath: string, remoteFileName: string): Promise<any> {
  // Local disk storage (current). remoteFileName is a legacy
  // "/public_html/<folder>/<file>" path; saveLocal stores it under UPLOADS_DIR.
  await saveLocal(localFilePath, remoteFileName);

  // ── Legacy FTP upload (kept for reference / fallback) ─────────────────────
  // const client = new Client();
  // client.ftp.verbose = false;
  // try {
  //   await client.access(FTP_CONFIG);
  //   const folder = path.dirname(remoteFileName);
  //   await client.ensureDir(folder);
  //   console.log(remoteFileName)
  //   await client.uploadFrom(localFilePath, remoteFileName);
  //   await client.close();
  //
  //   // return `https://hrproindia.in/documents/${remoteFileName}`; // public URL
  // } catch (error) {
  //   console.error("FTP Upload Error:", error);
  //   throw new Error("FTP upload failed");
  // }
}

export const uploadPrescription = async (req: Request, res: Response) => {
  try {
    const { leaveId } = req.params;

    const leave = await prisma.leaveRequest.findUnique({
      where: { id: Number(leaveId) },
      include: { leaveType: true }
    });

    if (!leave) {
      return res.status(404).json({ error: "Leave not found" });
    }

    if (leave.leaveType.name !== "SL") {
      return res.status(400).json({
        error: "Prescription allowed only for Sick Leave"
      });
    }

    const form = formidable({
      multiples: false,
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024,
      filter: part => part.mimetype?.startsWith("image/") ?? false,
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        return res.status(400).json({ error: "Upload failed" });
      }

      const prescription = files.prescription;

      if (!prescription) {
        return res.status(400).json({
          error: "Prescription image is required"
        });
      }

      // ✅ Safely handle File | File[]
      const file: File = Array.isArray(prescription)
        ? prescription[0]
        : prescription;

      if (!file.filepath) {
        return res.status(400).json({ error: "Invalid file" });
      }

      const ext = path.extname(file.originalFilename || "") || ".jpg";
      const safeName = `prescription_${Date.now()}${ext}`;
      const remotePath = `/public_html/leave-prescriptions/${safeName}`;
      // const publicUrl = `https://hrproindia.in/leave-prescriptions/${safeName}`; // legacy FTP URL
      const fileUrl = publicUrl(remotePath);

      await uploadToFTP(file.filepath, remotePath);

      fs.unlinkSync(file.filepath);

      await prisma.leaveRequest.update({
        where: { id: Number(leaveId) },
        data: { prescriptionUrl: fileUrl }
      });

      return res.status(200).json({
        message: "Prescription uploaded successfully",
        prescriptionUrl: fileUrl
      });
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Upload failed" });
  }
};