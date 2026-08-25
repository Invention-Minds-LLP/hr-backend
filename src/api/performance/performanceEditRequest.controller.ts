/**
 * HR sign-off and edit requests for the Dept Performance Indicator.
 *
 * Reviewers edit a period freely until HR marks it reviewed. After that a
 * change needs an approved request for that reviewer's own column, and the
 * approval is consumed by the edit it unlocks — so one approval buys one
 * correction, not open season.
 *
 * Mirrors the managerial flow's edit-request behaviour; separate tables because
 * AppraisalEditRequest is FK'd to AppraisalForm.
 */

import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import {
  isHRViewer,
  resolvePerformanceEditGate,
  resolveReviewerRole,
  REVIEWER_ROLE_LABELS,
} from "../../lib/performance-scoring";
import { createNotification } from "../notifications/notifications.controller";

function viewerOf(req: Request) {
  const user = (req as any).user;
  return {
    empId: user?.empId ? Number(user.empId) : null,
    role: user?.role ?? "",
    deptId: user?.deptId ? Number(user.deptId) : null,
    roleId: user?.roleId ? Number(user.roleId) : null,
  };
}

/**
 * The gate for one reviewer on one row, plus the approved request that opened
 * it (so the caller can consume it after a successful save).
 */
export async function performanceEditGate(summaryId: number, role: string) {
  const summary = await prisma.performanceSummary.findUnique({
    where: { id: summaryId },
    select: { id: true, hrReviewedAt: true },
  });
  if (!summary) return { allowed: true as const };

  const approved = await prisma.performanceEditRequest.findFirst({
    where: { summaryId, requestedRole: role, status: "APPROVED", consumedAt: null },
    orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });

  return resolvePerformanceEditGate(summary, approved);
}

/** Stamp the approval that unlocked an edit, so it cannot be reused. */
export async function consumeEditRequest(requestId: number) {
  await prisma.performanceEditRequest.update({
    where: { id: requestId },
    data: { consumedAt: new Date() },
  });
}

/**
 * PATCH /performance/summary/:id/review
 * HR marks a period's review complete, or reopens it. Body: { reviewed: bool }.
 */
export const setHrReviewed = async (req: Request, res: Response) => {
  try {
    const viewer = viewerOf(req);
    if (!isHRViewer(viewer)) {
      return res.status(403).json({ error: "Only HR can mark a review complete" });
    }

    const id = Number(req.params.id);
    const reviewed = req.body.reviewed !== false;

    const summary = await prisma.performanceSummary.findUnique({
      where: { id },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (!summary) return res.status(404).json({ error: "Row not found" });

    const updated = await prisma.performanceSummary.update({
      where: { id },
      data: {
        hrReviewedAt: reviewed ? new Date() : null,
        hrReviewedBy: reviewed ? viewer.empId : null,
      },
    });

    res.json({
      success: true,
      hrReviewedAt: updated.hrReviewedAt,
      message: reviewed
        ? "Review marked complete — reviewers now need an approved request to edit."
        : "Review reopened — reviewers can edit freely again.",
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * POST /performance/summary/:id/edit-request
 * A reviewer asks HR to reopen a period they can no longer edit.
 */
export const requestEdit = async (req: Request, res: Response) => {
  try {
    const viewer = viewerOf(req);
    const summaryId = Number(req.params.id);
    const reason = String(req.body.reason ?? "").trim();
    if (!reason) return res.status(400).json({ error: "A reason is required" });

    const summary = await prisma.performanceSummary.findUnique({
      where: { id: summaryId },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true,
            departmentId: true, inchargeId: true, reportingManager: true,
          },
        },
      },
    });
    if (!summary) return res.status(404).json({ error: "Row not found" });

    const role = resolveReviewerRole(viewer, summary.employee);
    if (!role || role === "SELF") {
      return res.status(403).json({ error: "You are not a reviewer for this employee" });
    }
    if (!summary.hrReviewedAt) {
      return res.status(400).json({ error: "This period is still open — you can edit it directly." });
    }

    const pending = await prisma.performanceEditRequest.findFirst({
      where: { summaryId, requestedRole: role, status: "PENDING" },
    });
    if (pending) {
      return res.status(400).json({ error: "You already have a request awaiting HR's decision." });
    }

    const created = await prisma.performanceEditRequest.create({
      data: { summaryId, requestedBy: viewer.empId!, requestedRole: role, reason },
    });

    // Tell HR there is something to action.
    const hrTeam = await prisma.employee.findMany({
      where: { departmentId: 1, employmentStatus: "ACTIVE" },
      select: { id: true },
    });
    const who = `${summary.employee.firstName ?? ""} ${summary.employee.lastName ?? ""}`.trim();
    const label = REVIEWER_ROLE_LABELS[role] ?? role;
    for (const hr of hrTeam) {
      await createNotification(
        hr.id,
        `${label} has requested to edit ${who}'s ${summary.period} review (${summary.cycle}). Reason: ${reason}`,
      );
    }

    res.json({ success: true, id: created.id, message: "Request sent to HR." });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /performance/edit-requests?status=PENDING
 * HR's queue.
 */
export const listEditRequests = async (req: Request, res: Response) => {
  try {
    if (!isHRViewer(viewerOf(req))) {
      return res.status(403).json({ error: "Only HR can view edit requests" });
    }
    const status = String(req.query.status ?? "PENDING").toUpperCase();

    const rows = await prisma.performanceEditRequest.findMany({
      where: status === "ALL" ? {} : { status },
      orderBy: [{ requestedAt: "desc" }],
      include: {
        summary: {
          select: {
            id: true, cycle: true, period: true,
            employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    const byId = new Map(
      (await prisma.employee.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.requestedBy))] } },
        select: { id: true, firstName: true, lastName: true, employeeCode: true },
      })).map((e) => [e.id, e]),
    );

    res.json(rows.map((r) => ({
      ...r,
      roleLabel: REVIEWER_ROLE_LABELS[r.requestedRole] ?? r.requestedRole,
      requester: byId.get(r.requestedBy) ?? null,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * PATCH /performance/edit-requests/:id
 * HR approves or rejects. Body: { approve: bool, rejectionReason?: string }.
 */
export const decideEditRequest = async (req: Request, res: Response) => {
  try {
    const viewer = viewerOf(req);
    if (!isHRViewer(viewer)) {
      return res.status(403).json({ error: "Only HR can decide an edit request" });
    }

    const id = Number(req.params.id);
    const approve = req.body.approve !== false;
    const rejectionReason = String(req.body.rejectionReason ?? "").trim() || null;

    const request = await prisma.performanceEditRequest.findUnique({
      where: { id },
      include: { summary: { select: { cycle: true, period: true } } },
    });
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (request.status !== "PENDING") {
      return res.status(400).json({ error: `This request is already ${request.status.toLowerCase()}.` });
    }

    await prisma.performanceEditRequest.update({
      where: { id },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        approvedBy: viewer.empId,
        approvedAt: new Date(),
        rejectionReason: approve ? null : rejectionReason,
      },
    });

    await createNotification(
      request.requestedBy,
      approve
        ? `Your edit request for the ${request.summary.period} review (${request.summary.cycle}) was approved. You can now make one change.`
        : `Your edit request for the ${request.summary.period} review (${request.summary.cycle}) was declined.`
        + (rejectionReason ? ` Reason: ${rejectionReason}` : ""),
    );

    res.json({ success: true, status: approve ? "APPROVED" : "REJECTED" });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};
