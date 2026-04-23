import { Request, Response } from "express";
// import { PrismaClient, PermissionStatus } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { sendWhatsAppTemplate } from "../leave/leave.controller";
import { createNotification } from "../notifications/notifications.controller";
import { BalanceCategory } from "@prisma/client";

const PERMISSION_APPLY_TEMPLATE_ID = '888273';
const PERMISSION_STATUS_TEMPLATE_ID = '909821';
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

    const year = getFinancialYear(new Date(day));

    // Each permission counts as 1 unit
    const unitsRequested = 1;

    // Fetch balance
    const balance = await prisma.employeeLeaveBalance.findFirst({
      where: {
        employeeId,
        category: "PERMISSION",
        permissionType,
        year
      }
    });


    // if (!balance) {
    //   return res.status(400).json({ error: "Permission balance not configured." });
    // }

    // if (!balance.isUnlimited) {
    //   const remaining = balance.totalAllowed - balance.used;

    //   if (remaining < unitsRequested) {
    //     return res.status(400).json({
    //       error: `You have only ${remaining} permission(s) remaining for ${permissionType}`
    //     });
    //   }
    // }

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
    // let mgrPhone: string | undefined;

    // const mgrId = request?.employee?.reportingManager;
    // if (mgrId) {
    //   const manager = await prisma.employee.findUnique({
    //     where: { id: mgrId },
    //     select: { phone: true }
    //   });
    //   mgrPhone = manager?.phone ?? undefined;
    //   const message = `Dear Concern,\n${employeeName} has requested ${permissionType} permission on ${dayLabel} from ${startLabel} to ${endLabel}.\nKindly review and take appropriate action.\n\nRegards,\nTeam Rashtrotthana`;
    //   await createNotification(mgrId, message);
    // }

    // if (mgrPhone) {
    //   try {
    //     await sendWhatsAppTemplate({
    //       to: formatPhoneNumber(mgrPhone),
    //       templateId: PERMISSION_APPLY_TEMPLATE_ID, // define in constants
    //       placeholders: [
    //         employeeName,
    //         permissionType,
    //         timing,
    //         dayLabel,
    //         startLabel,
    //         endLabel
    //       ]
    //     });
    //     notifyStatus = "sent";
    //   } catch (e: any) {
    //     notifyStatus = "failed";
    //     notifyError = e?.message || "WhatsApp send failed";
    //     console.error("Permission notify (manager) failed:", e);
    //   }
    // }
    const emp = request.employee;
    const notifyTo = emp.inchargeId ?? emp.reportingManager;

    if (notifyTo) {
      const approver = await prisma.employee.findUnique({
        where: { id: notifyTo },
        select: { phone: true }
      });

      const message = `${employeeName} has requested ${permissionType} permission on ${dayLabel}${timeRange ? ` (${timeRange})` : ""
        }. Kindly review and take appropriate action.`;

      await createNotification(notifyTo, message);

      // if (approver?.phone) {
      //   try {
      //     await sendWhatsAppTemplate({
      //       to: formatPhoneNumber(approver.phone),
      //       templateId: PERMISSION_APPLY_TEMPLATE_ID,
      //       placeholders: [
      //         employeeName,
      //         permissionType,
      //         timing,
      //         dayLabel,
      //         startLabel,
      //         endLabel
      //       ]
      //     });
      //   } catch (e) {
      //     console.error("Permission notify failed:", e);
      //   }
      // }
    }

    res.status(201).json(request);
  } catch (error) {
    console.error("Error creating permission request:", error);
    res.status(500).json({ error: "Failed to create permission request" });
  }
};

// ─────────────────────────────────────────────────────────────────
// EDIT a pending permission request
// Allowed only when no approver has acted (incharge / RM/HOD / HR all PENDING).
// ─────────────────────────────────────────────────────────────────
export const updatePermissionRequest = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { day, startTime, endTime, reason, permissionType, timing } = req.body;
    const userId = (req as any).user?.empId ?? null;

    const existing = await prisma.permissionRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Permission request not found" });

    if (userId && existing.employeeId !== Number(userId)) {
      return res.status(403).json({ error: "You can only edit your own permission request" });
    }

    if (existing.status !== "PENDING") {
      return res.status(400).json({ error: `Cannot edit a ${existing.status.toLowerCase()} permission request` });
    }
    if (
      existing.inChargeDecision !== "PENDING" ||
      existing.hodDecision      !== "PENDING" ||
      existing.hrDecision       !== "PENDING"
    ) {
      return res.status(400).json({ error: "Cannot edit — at least one approver has already acted" });
    }

    const data: any = { updatedAt: new Date() };
    if (day)                          data.day            = new Date(day);
    if (startTime !== undefined)      data.startTime      = startTime ? new Date(startTime) : null;
    if (endTime   !== undefined)      data.endTime        = endTime ? new Date(endTime) : null;
    if (reason !== undefined)         data.reason         = reason;
    if (permissionType !== undefined) data.permissionType = permissionType;
    if (timing !== undefined)         data.timing         = timing;

    const updated = await prisma.permissionRequest.update({ where: { id }, data });
    return res.json(updated);
  } catch (err: any) {
    console.error("Error updating permission request:", err);
    return res.status(500).json({ error: err.message || "Failed to update permission request" });
  }
};

// ─────────────────────────────────────────────────────────────────
// CANCEL a pending permission request
// ─────────────────────────────────────────────────────────────────
export const cancelPermissionRequest = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body ?? {};
    const userId = (req as any).user?.empId ?? null;

    const existing = await prisma.permissionRequest.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            firstName: true, lastName: true,
            reportingManager: true, inchargeId: true,
          },
        },
      },
    });
    if (!existing) return res.status(404).json({ error: "Permission request not found" });

    if (userId && existing.employeeId !== Number(userId)) {
      return res.status(403).json({ error: "You can only cancel your own permission request" });
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

    const updated = await prisma.permissionRequest.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: userId ? Number(userId) : null,
        cancellationReason: reason ?? "Cancelled by employee",
      },
    });

    // ── Notify the approver who would have reviewed this request ─────
    // Matches createPermissionRequest: notify incharge (preferred) or reporting manager.
    const emp = existing.employee;
    const notifyTo = emp?.inchargeId ?? emp?.reportingManager;
    if (notifyTo) {
      const name = [emp?.firstName, emp?.lastName].filter(Boolean).join(" ");
      const dayLabel = new Date(existing.day).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
      });
      const message =
        `${name} has CANCELLED their permission request for ${dayLabel}. ` +
        `Reason: ${reason ?? "Cancelled by employee"}.`;
      try {
        await createNotification(notifyTo, message);
      } catch (notifyErr) {
        console.error(`Failed to notify ${notifyTo}:`, notifyErr);
        // Don't fail the cancellation if notification delivery fails
      }
    }

    return res.json(updated);
  } catch (err: any) {
    console.error("Error cancelling permission request:", err);
    return res.status(500).json({ error: err.message || "Failed to cancel permission request" });
  }
};

export const getPermissionRequests = async (_req: Request, res: Response) => {
  try {
    const requests = await prisma.permissionRequest.findMany({
      include: {
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
      orderBy: { createdAt: "desc" }
    });
    res.json(requests);
  } catch (error) {
    console.error("Error fetching permission requests:", error);
    res.status(500).json({ error: "Failed to fetch permission requests" });
  }
};
// export const updatePermissionStatus = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const { status, userId, declineReason } = req.body;

//     if (!['APPROVED', 'Declined'].includes(status)) {
//       return res.status(400).json({ error: 'Invalid status value' });
//     }

//     const data: any = {
//       status: status === 'APPROVED' ? PermissionStatus.APPROVED : PermissionStatus.REJECTED,
//       approvedBy: null,
//       declinedBy: null,
//       declineReason: null,
//       approvedDate: null,
//       declinedDate: null
//     };

//     if (data.status === 'APPROVED') {
//       data.approvedBy = userId;
//       data.approvedDate = new Date();
//     } else if (data.status === 'REJECTED') {
//       data.declinedBy = userId;
//       data.declinedDate = new Date();
//       data.declineReason = declineReason;
//     }

//     const updated = await prisma.permissionRequest.update({
//       where: { id: Number(id) },
//       data,
//       include: { employee: true }
//     });
//     // ---------- WhatsApp to employee ----------
//     const emp = updated.employee;
//     const employeePhone = formatPhoneNumber(emp?.phone || "");
//     const employeeName = [emp?.firstName, emp?.lastName].filter(Boolean).join(" ");
//     const dateLabel = fmtDate(updated.day); // e.g. 15-08-2025 if your fmtDate is en-GB

//     // For FULLDAY we can send "-" for times; for HOURLY/HALFDAY send actual times.
//     const fromTime =
//       updated.timing === "HOURLY" || updated.timing === "HALFDAY"
//         ? fmtTime(updated.startTime)
//         : "-";
//     const toTime =
//       updated.timing === "HOURLY" || updated.timing === "HALFDAY"
//         ? fmtTime(updated.endTime)
//         : "-";

//     const statusLabel = data.status === PermissionStatus.APPROVED ? "Approved" : "Declined";

//     let notification: { status: "sent" | "skipped" | "failed"; error?: string } = {
//       status: "skipped",
//     };

//     // if (employeePhone) {
//     //   try {
//     //     await sendWhatsAppTemplate({
//     //       to: employeePhone,
//     //       templateId: PERMISSION_STATUS_TEMPLATE_ID,
//     //       placeholders: [employeeName, dateLabel, fromTime || "-", toTime || "-", statusLabel],
//     //     });
//     //     notification.status = "sent";
//     //   } catch (e: any) {
//     //     console.error("Permission status WA send failed:", e);
//     //     notification.status = "failed";
//     //     notification.error = e?.message || "WhatsApp send failed";
//     //   }
//     // }


//     res.json(updated);
//   } catch (error) {
//     console.error("Error updating permission status:", error);
//     res.status(500).json({ error: "Failed to update permission status" });
//   }

// };
// export const updatePermissionStatus = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const { status, userId, role, declineReason } = req.body; // role = MANAGER | HR

//     if (!["APPROVED", "REJECTED"].includes(status)) {
//       return res.status(400).json({ error: "Invalid status value" });
//     }
//     if (!["MANAGER", "HR"].includes(role)) {
//       return res.status(400).json({ error: "Invalid role" });
//     }

//     const perm = await prisma.permissionRequest.findUnique({ where: { id: Number(id) } });
//     if (!perm) return res.status(404).json({ error: "Permission request not found" });

//     const data: any = {};

//     // --- Manager decision ---
//     if (role === "MANAGER") {
//       if (perm.hodDecision !== "PENDING") {
//         return res.status(400).json({ error: "Manager already decided" });
//       }
//       data.hodDecision = status;
//       data.hodDecidedAt = new Date();

//       if (status === "REJECTED") {
//         data.status = "REJECTED";
//         data.declinedBy = userId;
//         data.declinedDate = new Date();
//         data.declineReason = declineReason ?? null;
//       } else {
//         // manager approved → wait for HR
//         data.status = "PENDING";
//       }
//     }

//     // --- HR decision ---
//     if (role === "HR") {
//       if (perm.hodDecision !== "APPROVED") {
//         return res.status(400).json({ error: "Manager approval required first" });
//       }
//       if (perm.hrDecision !== "PENDING") {
//         return res.status(400).json({ error: "HR already decided" });
//       }
//       data.hrDecision = status;
//       data.hrDecidedAt = new Date();

//       if (status === "APPROVED") {

//         data.status = "APPROVED";
//         data.approvedBy = userId;
//         data.approvedDate = new Date();
//         const year = perm.day.getFullYear();
//         const units = 1; // each permission = 1 unit

//         const balanceKey = {
//           employeeId: perm.employeeId,
//           category: BalanceCategory.PERMISSION,   // ✅ FIXED
//           leaveTypeId: null,
//           permissionType: perm.permissionType,
//           year
//         };


//         // Fetch balance
//         const balance = await prisma.employeeLeaveBalance.findFirst({
//           where: balanceKey
//         });


//         if (!balance) {
//           return res.status(400).json({
//             error: `Permission balance not configured for ${perm.permissionType} (${year})`
//           });
//         }

//         if (balance.used + units > balance.totalAllowed) {
//           return res.status(400).json({
//             error: `Insufficient permission balance. Only ${
//               balance.totalAllowed - balance.used
//             } remaining`
//           });
//         }

//         // Deduct balance
//         await prisma.employeeLeaveBalance.updateMany({
//           where: balanceKey,
//           data: {
//             used: { increment: units }
//           }
//         });


//       } else {
//         data.status = "REJECTED";
//         data.declinedBy = userId;
//         data.declinedDate = new Date();
//         data.declineReason = declineReason ?? null;
//       }
//     }

//     const updated = await prisma.permissionRequest.update({
//       where: { id: Number(id) },
//       data,
//       include: { employee: true },
//     });
//     try {
//       const employee = updated.employee;
//       const employeePhone = formatPhoneNumber(employee?.phone || "");
//       const employeeName = [employee?.firstName, employee?.lastName].filter(Boolean).join(" ");
//       const type = updated.permissionType ?? '';
//       const timing = updated.timing ?? '';
//       const day = fmtDate(updated.day);
//       const start = updated.startTime ? fmtTime(updated.startTime) : "";
//       const end = updated.endTime ? fmtTime(updated.endTime) : "";

//       // Send only if final decision reached (HR approved/rejected OR HOD rejected)
//       if (
//         updated.status === "APPROVED" ||
//         (updated.status === "REJECTED" && (role === "HR" || role === "MANAGER"))
//       ) {
//         await sendWhatsAppTemplate({
//           to: employeePhone,
//           templateId: PERMISSION_STATUS_TEMPLATE_ID,
//           placeholders: [
//             employeeName,
//             type,
//             day,
//             start,
//             end,
//             updated.status // "APPROVED" / "REJECTED"
//           ],
//         });
//         const message = `Hello ${employeeName},\n\nYour ${type} permission request on ${day}, from ${start} to ${end}, has been ${updated.status}.\n\nPlease contact the concerned person for more details.\n\nThank you.`;

//         await createNotification(updated.employeeId, message);
//       }
//     } catch (e: any) {
//       console.error("Permission status WA send failed:", e?.message || e);
//     }

//     res.json(updated);
//   } catch (error) {
//     console.error("Error updating permission status:", error);
//     res.status(500).json({ error: "Failed to update permission status" });
//   }
// };
export const updatePermissionStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, userId, role, declineReason } = req.body;
    // role = REPORTING_MANAGER | HR_MANAGER | MANAGEMENT

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    if (!["INCHARGE", "REPORTING_MANAGER", "HR_MANAGER", "MANAGEMENT"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const perm = await prisma.permissionRequest.findUnique({
      where: { id: Number(id) },
      include: {
        employee: {
          include: { Department: true, role: true }
        }
      }
    });

    if (!perm) {
      return res.status(404).json({ error: "Permission request not found" });
    }

    const emp = perm.employee;
    const hasIncharge = !!emp.inchargeId;
    const roleId = emp.roleId;        // 1=HR Manager, 2=Employee, 3=RM, 5=HOD
    const deptId = emp.departmentId;  // HR = 1
    const isHRDept = deptId === 1;

    const data: any = {};
    if (hasIncharge && role === "INCHARGE") {

      data.inChargeDecision = status;
      data.inChargeDecidedAt = new Date();

      if (status === "REJECTED") {
        data.status = "REJECTED";
        data.declineReason = declineReason ?? null;
        data.declinedBy = userId;
        data.declinedDate = new Date();
      }

      const updated = await prisma.permissionRequest.update({
        where: { id: Number(id) },
        data,
        include: { employee: true }
      });

      return res.json(updated);
    }

    if (hasIncharge && perm.inChargeDecision !== "APPROVED") {
      return res.status(400).json({ error: "Incharge approval required first" });
    }
    // ---------------------------------------------------------------
    // 1️⃣ HR EMPLOYEE (dept = 1 and not HR Manager)
    // Level 1 approver = HR Manager
    // No Level 2
    // ---------------------------------------------------------------
    if (isHRDept && roleId !== 1) {

      if (role !== "HR_MANAGER") {
        return res.status(400).json({ error: "Only HR Manager can approve HR employees" });
      }

      data.hodDecision = status;
      data.hodDecidedAt = new Date();

      data.status = status;
      if (status === "REJECTED") {
        data.declineReason = declineReason ?? null;
        data.declinedBy = userId;
        data.declinedDate = new Date();
      }
    }

    // ---------------------------------------------------------------
    // 2️⃣ HR MANAGER (roleId = 1)
    // Level 1 approver = Management
    // No Level 2
    // ---------------------------------------------------------------
    else if (roleId === 1) {

      if (role !== "MANAGEMENT") {
        return res.status(400).json({ error: "Only Management can approve HR Manager permissions" });
      }

      data.hodDecision = status;
      data.hodDecidedAt = new Date();

      data.status = status;
      if (status === "REJECTED") {
        data.declineReason = declineReason ?? null;
        data.declinedBy = userId;
        data.declinedDate = new Date();
      }
    }

    // ---------------------------------------------------------------
    // 3️⃣ REPORTING MANAGER or HOD (roleId = 3 or 5)
    // L1 = MANAGEMENT
    // L2 = HR_MANAGER
    // ---------------------------------------------------------------
    else if (roleId === 3 || roleId === 5) {

      // Level 1
      if (role === "MANAGEMENT") {
        data.hodDecision = status;
        data.hodDecidedAt = new Date();

        if (status === "REJECTED") {
          data.status = "REJECTED";
          data.declineReason = declineReason ?? null;
          data.declinedBy = userId;
          data.declinedDate = new Date();
        }
      }

      // Level 2
      else if (role === "HR_MANAGER") {

        if (perm.hodDecision !== "APPROVED") {
          return res.status(400).json({ error: "Management approval required first" });
        }

        data.hrDecision = status;
        data.hrDecidedAt = new Date();

        data.status = status;
        if (status === "REJECTED") {
          data.declineReason = declineReason ?? null;
          data.declinedBy = userId;
          data.declinedDate = new Date();
        }
      }

      else {
        return res.status(400).json({ error: "Invalid approver for this employee role" });
      }
    }

    // ---------------------------------------------------------------
    // 4️⃣ NORMAL EMPLOYEE (roleId = 2)
    // L1 = REPORTING_MANAGER
    // L2 = HR_MANAGER
    // ---------------------------------------------------------------
    else if (roleId === 2) {

      // Level 1
      if (role === "REPORTING_MANAGER") {
        data.hodDecision = status;
        data.hodDecidedAt = new Date();

        if (status === "REJECTED") {
          data.status = "REJECTED";
          data.declineReason = declineReason ?? null;
          data.declinedBy = userId;
          data.declinedDate = new Date();
        }
      }

      // Level 2
      else if (role === "HR_MANAGER") {

        if (perm.hodDecision !== "APPROVED") {
          return res.status(400).json({ error: "Reporting Manager approval required first" });
        }

        data.hrDecision = status;
        data.hrDecidedAt = new Date();

        data.status = status;

        if (status === "REJECTED") {
          data.declineReason = declineReason ?? null;
          data.declinedBy = userId;
          data.declinedDate = new Date();
        }
      }

      else {
        return res.status(400).json({ error: "Unauthorized approver" });
      }
    }

    // ---------------------------------------------------------------
    // SAVE UPDATE
    // ---------------------------------------------------------------
    const updated = await prisma.permissionRequest.update({
      where: { id: Number(id) },
      data,
      include: { employee: true }
    });

    // ---------------------------------------------------------------
    // NOTIFICATION + WhatsApp
    // ---------------------------------------------------------------
    const employee = updated.employee;
    const phone = formatPhoneNumber(employee.phone);
    const name = `${employee.firstName} ${employee.lastName}`;

    const day = fmtDate(updated.day);
    const start = updated.startTime ? fmtTime(updated.startTime) : '';
    const end = updated.endTime ? fmtTime(updated.endTime) : '';
    const type = updated.permissionType ?? '';

    await createNotification(
      updated.employeeId,
      `Your ${type} permission on ${day} (${start}-${end}) has been ${updated.status}.`
    );

    // try {
    //   await sendWhatsAppTemplate({
    //     to: phone,
    //     templateId: PERMISSION_STATUS_TEMPLATE_ID,
    //     placeholders: [name, type, day, start, end, updated.status]
    //   });
    // } catch (err) {
    //   console.error("WhatsApp send failed:", err);
    // }

    res.json(updated);

  } catch (error) {
    console.error("Error updating permission:", error);
    res.status(500).json({ error: "Failed to update permission" });
  }
};

// export const getPermissionBalance = async (req: Request, res: Response) => {
//   try {
//     const employeeId = Number(req.params.empId);
//     const year = Number(req.query.year) || new Date().getFullYear();

//     const balances = await prisma.employeeLeaveBalance.findMany({
//       where: { employeeId, year, category: "PERMISSION" },
//     });

//     res.json(
//       balances.map(b => ({
//         permissionType: b.permissionType,
//         totalAllowed: b.totalAllowed,
//         used: b.used,
//         remaining: b.totalAllowed - b.used
//       }))
//     );
//   } catch (e) {
//     res.status(500).json({ error: "Failed to fetch permission balance" });
//   }
// };
const ALL_PERMISSION_TYPES = ['PERSONAL', 'OFFICIAL'];
export const getPermissionBalance = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    // const year = Number(req.query.year) || getFinancialYear(new Date());
    const yearParam = Number(req.query.year);

    const year = Number.isFinite(yearParam)
      ? yearParam
      : getFinancialYear(new Date());

    const balances = await prisma.employeeLeaveBalance.findMany({
      where: { employeeId, year, category: "PERMISSION" },
    });
    console.log(balances)
    const balanceMap = new Map<string, any>();
    balances.forEach(b => {
      if (b.permissionType) balanceMap.set(b.permissionType, b);
    });

    const result = ALL_PERMISSION_TYPES.map(type => {
      const b = balanceMap.get(type);

      return {
        permissionType: type,
        totalAllowed: b?.totalAllowed ?? 0,
        used: b?.used ?? 0,
        // remaining: (b?.totalAllowed ?? 0) - (b?.used ?? 0),
        remaining: b?.isUnlimited ? null : (b?.totalAllowed ?? 0) - (b?.used ?? 0),
        isUnlimited: b?.isUnlimited ?? false,
        year
      };
    });

    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch permission balance" });
  }
};

export const getMonthlyPermissionUsage = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const monthStart = new Date(year, month, 1, 0, 0, 0);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);

    const permissions = await prisma.permissionRequest.findMany({
      where: {
        employeeId,
        status: {
          in: ['APPROVED', 'PENDING']
        },
        permissionType: 'PERSONAL',
        day: {
          gte: monthStart,
          lte: monthEnd
        },
        startTime: { not: null },
        endTime: { not: null }
      },
      select: {
        startTime: true,
        endTime: true
      }
    });

    // 🔢 Calculate total hours
    let usedHours = 0;

    for (const p of permissions) {
      const diff =
        (new Date(p.endTime!).getTime() -
          new Date(p.startTime!).getTime()) /
        (1000 * 60 * 60);

      if (diff > 0) usedHours += diff;
    }

    console.log(permissions, usedHours)
    res.json({
      usedHours: Number(usedHours.toFixed(2)),
      maxHours: 2
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch permission usage' });
  }
};

function getFinancialYear(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  return month >= 4 ? year : year - 1;
}