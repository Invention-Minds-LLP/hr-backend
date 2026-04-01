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
import { Client } from "basic-ftp";
import path from "path";

const FTP_CONFIG = {
  host: process.env.FTP_HOST ?? "",
  user: process.env.FTP_USER ?? "",
  password: process.env.FTP_PASSWORD ?? "",
  secure: false,
};

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


    // Fetch balance for that year & leave type
    const balance = await prisma.employeeLeaveBalance.findFirst({
      where: {
        employeeId: employeeId,
        leaveTypeId: leaveTypeId,
        year: year,
      }
    });


    // Allow advance applications for the next FY when rollover hasn't run yet
    // (e.g., applying for April leave while still in March)
    const currentFY = getFinancialYear(new Date());
    const isAdvanceNextFY = !balance && year === currentFY + 1;

    if (!balance && !isAdvanceNextFY) {
      return res.status(400).json({
        error: `Leave balance not configured for ${year}`
      });
    }

    // const year = start.getFullYear();
    const requestedUnits = isHalfDay ? 0.5 : daysInclusive(start, end);
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

    if (lt.name !== "CO" && !isAdvanceNextFY) {
      const bal = await getBalance(Number(employeeId), Number(leaveTypeId), year);
      if (!bal) return res.status(400).json({ error: `Leave balance not configured for ${year}` });

      const totalUsed = computeTotalUsed(bal);
      const remaining = (bal.totalAllowed ?? 0) - totalUsed;

      if (requestedUnits > remaining) {
        return res.status(400).json({
          error: `Insufficient balance. Available: ${remaining}, requested: ${requestedUnits}`
        });
      }
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
        else if (roleId === 3 || roleId === 5) {
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
        else if (roleId === 2) {
          if (role === "REPORTING_MANAGER") {
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

        const year = getFinancialYear(startDate);
        const requestedUnits = updatedLeave.isHalfDay ? 0.5 : daysInclusive(startDate, endDate);

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

        // ---- Non-CO: validate balance
        const bal = await tx.employeeLeaveBalance.findFirst({
          where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year, category: "LEAVE" },
        });

        if (!bal) {
          return {
            kind: "ERR" as const,
            status: 400,
            body: { error: `Leave balance not configured for ${year}` },
          };
        }

        const totalUsedBefore = computeTotalUsed(bal);
        const remainingBefore = (bal.totalAllowed ?? 0) - totalUsedBefore;

        if (requestedUnits > remainingBefore) {
          return {
            kind: "ERR" as const,
            status: 400,
            body: { error: "Insufficient balance at approval time" },
          };
        }

        // ledger balance check
        const ledgerBalance = await getLastLedgerBalanceTx(tx, updatedLeave.employeeId, updatedLeave.leaveTypeId, year);
        if (requestedUnits > ledgerBalance) {
          return { kind: "ERR" as const, status: 400, body: { error: "Insufficient balance (ledger)" } };
        }

        // Update EmployeeLeaveBalance usage
        if (updatedLeave.isHalfDay) {
          await tx.employeeLeaveBalance.updateMany({
            where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year },
            data: { halfDayUsed: { increment: 1 } },
          });
        } else {
          await tx.employeeLeaveBalance.updateMany({
            where: { employeeId: updatedLeave.employeeId, leaveTypeId: updatedLeave.leaveTypeId, year },
            data: { used: { increment: requestedUnits } },
          });
        }

        // Create ledger DEBITs per touched month (FAST enough; summary rebuild moved out)
        const touched = getTouchedMonths(startDate, endDate);
        touched.sort((a, b) => a.year - b.year || a.month - b.month);

        // IMPORTANT: start running balance from current ledger AFTER the debit inserts base
        let runningBalance = ledgerBalance;

        for (const m of touched) {
          const days = calculateDaysForMonth(startDate, endDate, m.year, m.month);
          if (days <= 0) continue;

          runningBalance -= days;

          await insertLedgerTx(tx, {
            employeeId: updatedLeave.employeeId,
            leaveTypeId: updatedLeave.leaveTypeId,
            year: m.year,
            month: m.month,
            debit: days,
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
          body: { ...updatedLeave, requestedUnits, __touched: touched },
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
function computeTotalUsed(balance: { used: number; halfDayUsed: number | null }) {
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
function getTouchedMonths(startDate: Date, endDate: Date) {
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

async function insertLedgerTx(
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
export const initELAccrualCron = () => {
  cron.schedule("10 2 1 * *", async () => {
    const today = atStartOfDay(new Date());
    const year = getFinancialYear(today);
    const month = today.getMonth() + 1;

    try {
      // 1️⃣ EL Leave Type
      const el = await prisma.leaveType.findFirst({
        where: { name: "EL" },
        select: { id: true }
      });

      if (!el) return;

      // 2️⃣ Policy
      const policy = await getActivePolicy(el.id, today);
      if (!policy) return;

      if (policy.accrualType !== "MONTHLY") return;

      const monthlyCredit = Number(policy.accrualRate ?? 0);
      if (!monthlyCredit) return;

      const workingDaysRequired = policy.workingDaysRequired ?? 0;
      const maxBalance = policy.maxBalance ?? null;

      // 3️⃣ Employees — only those who have completed 1 year of service
      const oneYearAgo = new Date(today);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const employees = await prisma.employee.findMany({
        where: {
          employmentStatus: "ACTIVE",
          dateOfJoining: { lte: oneYearAgo },  // joined at least 1 year ago
        },
        select: { id: true },
      });

      // 4️⃣ Loop employees
      for (const emp of employees) {
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

          if (exists) return;

          // 4.1️⃣ Get shift config ONCE
          const shift = await tx.shiftApproval.findFirst({
            where: {
              employeeId: emp.id,
              status: "APPROVED",
              month,
              year
            },
            select: { weekOffConfig: true }
          });

          const weekOffConfig = shift?.weekOffConfig ?? null;

          // 4.2️⃣ Calculate worked days
          const workedDays = await getWorkedDaysOptimized(
            emp.id,
            year,
            month,
            weekOffConfig
          );

          // ❗ POLICY CHECK
          if (workingDaysRequired && workedDays < workingDaysRequired) {
            console.log(`❌ Skipping EL for emp ${emp.id}, worked: ${workedDays}`);
            return;
          }

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

          let credit = monthlyCredit;

          if (maxBalance != null) {
            const remaining = maxBalance - prevBalance;
            if (remaining <= 0) return;

            credit = Math.min(credit, remaining);
          }

          if (credit <= 0) return;

          // 4.5️⃣ Accrual
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

          // 4.7️⃣ Ledger
          const newBalance = prevBalance + credit;

          await insertLedgerTx(tx, {
            employeeId: emp.id,
            leaveTypeId: el.id,
            year,
            month,
            credit,
            debit: 0,
            balanceAfter: newBalance,
            action: "CREDIT",
            referenceType: "ACCRUAL",
            source: "SYSTEM",
            remarks: `EL credited (worked ${workedDays} days)`
          });

          // 4.8️⃣ Summaries
          await rebuildMonthlySummaryTx(tx, emp.id, el.id, year, month);
          await rebuildYearlySummaryTx(tx, emp.id, el.id, year);
        });
      }

      console.log(`✅ EL accrual done for ${year}-${month}`);
    } catch (e) {
      console.error("EL CRON ERROR:", e);
    }
  });
};
async function getLastLedgerBalanceTx(
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
function calculateDaysForMonth(
  start: Date,
  end: Date,
  year: number,
  month: number
) {
  const calYear = getCalendarYear(year, month);

  const monthStart = new Date(calYear, month - 1, 1);
  const monthEnd = new Date(calYear, month, 0);


  const from = start > monthStart ? start : monthStart;
  const to = end < monthEnd ? end : monthEnd;

  return daysInclusive(from, to);
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

  return finalCount;
}

export const initNewJoineeLeaveAllocationCron = () => {
  cron.schedule("0 2 * * *", async () => {
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
      // const eligibleDate = new Date(emp.probationEndDate);

      // 👉 Only trigger ONCE
      if (!isSameDate(eligibleDate, today)) continue;

      const fy = getFinancialYearBounds(eligibleDate);

      // ✅ APPLY HALF-MONTH RULE
      let effectiveStart = new Date(eligibleDate);

      if (eligibleDate.getDate() > 15) {
        // skip current month → move to next month 1st
        effectiveStart = new Date(
          eligibleDate.getFullYear(),
          eligibleDate.getMonth() + 1,
          1
        );
      }

      const months = getRemainingMonths(effectiveStart, fy.end);

      const CL_ANNUAL = 12;
      const SL_ANNUAL = 12;

      const cl = (CL_ANNUAL / 12) * months;
      const sl = (SL_ANNUAL / 12) * months;

      await prisma.$transaction(async (tx) => {
        await allocateLeave(tx, emp.id, "CL", cl, fy.fyYear, effectiveStart);
        await allocateLeave(tx, emp.id, "SL", sl, fy.fyYear, effectiveStart);
      });

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
function getFinancialYear(date: Date) {
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
function getCalendarYear(fyYear: number, month: number) {
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
      const year = getFinancialYear(new Date());
      const month = new Date().getMonth() + 1;

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
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(FTP_CONFIG);
    const folder = path.dirname(remoteFileName);
    await client.ensureDir(folder);
    console.log(remoteFileName)
    await client.uploadFrom(localFilePath, remoteFileName);
    await client.close();

    // return `https://hrproindia.in/documents/${remoteFileName}`; // public URL
  } catch (error) {
    console.error("FTP Upload Error:", error);
    throw new Error("FTP upload failed");
  }
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
      const publicUrl = `https://hrproindia.in/leave-prescriptions/${safeName}`;

      await uploadToFTP(file.filepath, remotePath);

      fs.unlinkSync(file.filepath);

      await prisma.leaveRequest.update({
        where: { id: Number(leaveId) },
        data: { prescriptionUrl: publicUrl }
      });

      return res.status(200).json({
        message: "Prescription uploaded successfully",
        prescriptionUrl: publicUrl
      });
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Upload failed" });
  }
};