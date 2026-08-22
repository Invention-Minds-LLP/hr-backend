// ─────────────────────────────────────────────────────────────────────────────
//  Comp-off requests — two-stage approval before anything is credited.
//
//  Until now a comp-off credit appeared on its own the moment someone punched in
//  on a holiday or week-off. Nobody sanctioned it, so every disputed balance
//  turned into an argument about whether the system had invented the credit.
//
//  The lifecycle:
//    worked a full shift on a holiday/week-off  → PENDING_MANAGER
//    reporting manager approves                 → PENDING_HR
//    HR approves                                → APPROVED + CompOffCredit issued
//    either rejects                             → REJECTED (no credit, ever)
//
//  The credit is created ONLY at HR approval, and expires
//  COMP_OFF_VALIDITY_DAYS after the day that was worked — not after approval, so
//  a slow approval cannot silently stretch the entitlement.
// ─────────────────────────────────────────────────────────────────────────────

import { Response } from "express";
import { prisma } from "../../lib/prisma";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { currentEmployeeId } from "../../lib/currentUser";
import { createNotification } from "../notifications/notifications.controller";
import { COMP_OFF_VALIDITY_DAYS, getShiftMinutes } from "../../services/comOff.service";

/** HR is department 1, matching how the appraisal module routes HR notifications. */
const HR_DEPARTMENT_ID = 1;

const fmt = (d: Date) => new Date(d).toLocaleDateString("en-IN");

function dayOf(raw: unknown): Date {
  const d = new Date(String(raw));
  d.setHours(0, 0, 0, 0);
  return d;
}

export function expiryFor(workDate: Date): Date {
  const e = new Date(workDate);
  e.setDate(e.getDate() + COMP_OFF_VALIDITY_DAYS);
  return e;
}

async function notifyHr(message: string, title: string) {
  const hr = await prisma.employee.findMany({
    where: { departmentId: HR_DEPARTMENT_ID, employmentStatus: "ACTIVE" },
    select: { id: true },
  });
  for (const h of hr) {
    await createNotification(h.id, message, title).catch(() => undefined);
  }
}

const employeeCard = {
  select: { id: true, firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } },
};

/**
 * GET /api/comp-off/requests/my
 * The employee's own claims, whatever their state.
 */
export const listMyCompOffRequests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = currentEmployeeId(req);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    const rows = await prisma.compOffRequest.findMany({
      where: { employeeId },
      orderBy: { workDate: "desc" },
      take: 100,
    });
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/comp-off/requests/pending
 * The reporting manager's queue.
 */
export const listPendingForManager = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managerId = currentEmployeeId(req);
    if (!managerId) return res.status(401).json({ error: "Unauthorized" });

    // Direct reports, plus anything explicitly routed to this manager — an
    // employee's reportingManager can change after the request was raised.
    const reports = await prisma.employee.findMany({
      where: { reportingManager: managerId },
      select: { id: true },
    });
    const reportIds = reports.map(r => r.id);

    const rows = await prisma.compOffRequest.findMany({
      where: {
        status: "PENDING_MANAGER",
        OR: [
          { managerId },
          ...(reportIds.length ? [{ employeeId: { in: reportIds } }] : []),
        ],
      },
      include: { employee: employeeCard },
      orderBy: { workDate: "asc" },
    });

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/comp-off/requests/hr-pending
 * HR's queue — only what a manager has already sanctioned.
 */
export const listPendingForHr = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await prisma.compOffRequest.findMany({
      where: { status: "PENDING_HR" },
      include: { employee: employeeCard },
      orderBy: { workDate: "asc" },
    });
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/comp-off/requests
 * Everything, for the HR overview grid. ?status= filters to one state.
 */
export const listAllCompOffRequests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, employeeId } = req.query;
    const where: any = {};
    if (status) where.status = String(status);
    if (employeeId) where.employeeId = Number(employeeId);

    const rows = await prisma.compOffRequest.findMany({
      where,
      include: { employee: employeeCard },
      orderBy: { workDate: "desc" },
      take: 500,
    });
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/comp-off/requests
 * HR raises a claim the punch data missed (biometric outage, field work).
 * Detection normally does this by itself.
 */
export const createCompOffRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const raisedBy = currentEmployeeId(req);
    const { employeeId, workDate, reason } = req.body;

    if (!employeeId || !workDate) {
      return res.status(400).json({ error: "employeeId and workDate are required" });
    }

    const date = dayOf(workDate);

    const [dupRequest, dupCredit] = await Promise.all([
      prisma.compOffRequest.findFirst({ where: { employeeId: Number(employeeId), workDate: date } }),
      prisma.compOffCredit.findFirst({ where: { employeeId: Number(employeeId), workDate: date } }),
    ]);
    if (dupRequest) {
      return res.status(409).json({
        error: `A comp-off request for ${fmt(date)} already exists (status: ${dupRequest.status}).`,
      });
    }
    if (dupCredit) {
      return res.status(409).json({ error: `A comp-off credit for ${fmt(date)} already exists.` });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: Number(employeeId) },
      select: { firstName: true, lastName: true, reportingManager: true },
    });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    // Record what was worked when the punches are there; HR-raised claims are
    // allowed without them, since the usual reason for raising one by hand is
    // that the punch never landed.
    const attendance = await prisma.attendance.findFirst({
      where: { employeeId: Number(employeeId), date },
      select: { checkIn: true, checkOut: true },
    });
    const worked = attendance?.checkIn && attendance?.checkOut
      ? Math.round((attendance.checkOut.getTime() - attendance.checkIn.getTime()) / 60000)
      : null;

    const created = await prisma.compOffRequest.create({
      data: {
        employeeId: Number(employeeId),
        workDate: date,
        source: "HR",
        workedMinutes: worked,
        shiftMinutes: await getShiftMinutes(Number(employeeId), date),
        reason: reason ? String(reason) : null,
        status: "PENDING_MANAGER",
        managerId: employee.reportingManager ?? null,
      },
    });

    if (employee.reportingManager) {
      await createNotification(
        employee.reportingManager,
        `HR raised a comp-off request for ${employee.firstName} ${employee.lastName} for ${fmt(date)}. ` +
        `It needs your approval.`,
        "Comp-off request",
      ).catch(() => undefined);
    }

    console.log(`[comp-off] request #${created.id} raised by employee ${raisedBy ?? "?"} for ${employeeId}`);
    return res.status(201).json(created);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

/**
 * PATCH /api/comp-off/requests/:id/manager-decide
 * Body: { approve: boolean, note?: string }
 */
export const managerDecideCompOff = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managerId = currentEmployeeId(req);
    if (!managerId) return res.status(401).json({ error: "Unauthorized" });

    const id = Number(req.params.id);
    const approve = req.body?.approve !== false;
    const note = req.body?.note ? String(req.body.note) : null;

    const request = await prisma.compOffRequest.findUnique({
      where: { id },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    });
    if (!request) return res.status(404).json({ error: "Comp-off request not found" });

    if (request.status !== "PENDING_MANAGER") {
      return res.status(409).json({
        error: `This request is already at ${request.status} and cannot be decided by a manager again.`,
      });
    }
    if (!approve && !note) {
      return res.status(400).json({ error: "Give a reason when rejecting a comp-off request" });
    }

    // Stage one belongs to the reporting manager. Without that check the two
    // stages collapse into one and the module is decoration.
    const employee = await prisma.employee.findUnique({
      where: { id: request.employeeId },
      select: { reportingManager: true },
    });
    const isManager = request.managerId === managerId || employee?.reportingManager === managerId;
    if (!isManager) {
      return res.status(403).json({
        error: employee?.reportingManager || request.managerId
          ? "Only this employee's reporting manager can approve their comp-off."
          : "This employee has no reporting manager set — HR must assign one before the comp-off can be approved.",
      });
    }

    const updated = await prisma.compOffRequest.update({
      where: { id },
      data: {
        status: approve ? "PENDING_HR" : "REJECTED",
        managerStatus: approve ? "APPROVED" : "REJECTED",
        managerId,
        managerDecidedAt: new Date(),
        managerNote: note,
      },
    });

    const who = `${request.employee.firstName} ${request.employee.lastName} (${request.employee.employeeCode})`;

    if (approve) {
      await notifyHr(
        `${who} has a manager-approved comp-off for ${fmt(request.workDate)} awaiting HR approval.`,
        "Comp-off request",
      );
      await createNotification(
        request.employeeId,
        `Your manager approved your comp-off for ${fmt(request.workDate)}. It is now with HR.`,
        "Comp-off approved by manager",
      ).catch(() => undefined);
    } else {
      await createNotification(
        request.employeeId,
        `Your manager rejected your comp-off for ${fmt(request.workDate)}: ${note}`,
        "Comp-off rejected",
      ).catch(() => undefined);
    }

    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

/**
 * PATCH /api/comp-off/requests/:id/hr-decide
 * Body: { approve: boolean, note?: string }
 * The only path that issues a CompOffCredit.
 */
export const hrDecideCompOff = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const hrId = currentEmployeeId(req);
    if (!hrId) return res.status(401).json({ error: "Unauthorized" });

    const id = Number(req.params.id);
    const approve = req.body?.approve !== false;
    const note = req.body?.note ? String(req.body.note) : null;

    const request = await prisma.compOffRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ error: "Comp-off request not found" });

    if (request.status !== "PENDING_HR") {
      return res.status(409).json({
        error: request.status === "PENDING_MANAGER"
          ? "The reporting manager has not approved this request yet."
          : `This request is already ${request.status} and cannot be decided again.`,
      });
    }
    if (!approve && !note) {
      return res.status(400).json({ error: "Give a reason when rejecting a comp-off request" });
    }

    if (!approve) {
      const rejected = await prisma.compOffRequest.update({
        where: { id },
        data: { status: "REJECTED", hrStatus: "REJECTED", hrId, hrDecidedAt: new Date(), hrNote: note },
      });
      await createNotification(
        request.employeeId,
        `HR rejected your comp-off for ${fmt(request.workDate)}: ${note}`,
        "Comp-off rejected",
      ).catch(() => undefined);
      return res.json(rejected);
    }

    const expiryDate = expiryFor(request.workDate);

    // Credit and approval land together — a request marked APPROVED with no
    // credit behind it is exactly the inconsistency this module exists to stop.
    const { updated, credit } = await prisma.$transaction(async tx => {
      const credit = await tx.compOffCredit.create({
        data: {
          employeeId: request.employeeId,
          workDate: request.workDate,
          expiryDate,
          requestId: request.id,
          grantedBy: hrId,
          grantReason: note ?? `Approved comp-off for ${fmt(request.workDate)}`,
        },
      });

      const updated = await tx.compOffRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          hrStatus: "APPROVED",
          hrId,
          hrDecidedAt: new Date(),
          hrNote: note,
          creditId: credit.id,
        },
      });

      return { updated, credit };
    }, { maxWait: 10000, timeout: 20000 });

    await createNotification(
      request.employeeId,
      `Your comp-off for ${fmt(request.workDate)} is approved and credited. ` +
      `Use it on or before ${fmt(expiryDate)} — it expires after that.`,
      "Comp-off credited",
    ).catch(() => undefined);

    return res.json({ ...updated, credit });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE /api/comp-off/requests/:id
 * The employee withdraws their own claim, before anyone has acted on it.
 */
export const withdrawCompOffRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = currentEmployeeId(req);
    const id = Number(req.params.id);

    const request = await prisma.compOffRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ error: "Comp-off request not found" });
    if (request.employeeId !== employeeId) {
      return res.status(403).json({ error: "You can only withdraw your own comp-off request" });
    }
    if (request.status !== "PENDING_MANAGER") {
      return res.status(409).json({ error: `This request is already ${request.status} and cannot be withdrawn.` });
    }

    const updated = await prisma.compOffRequest.update({
      where: { id },
      data: { status: "WITHDRAWN" },
    });
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};
