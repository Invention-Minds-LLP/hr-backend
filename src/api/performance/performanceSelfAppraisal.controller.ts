/**
 * Self-appraisal for the Dept Performance Indicator.
 *
 * The executive fills this; their in-charge and supervisor score the indicator
 * itself. Managers keep the AppraisalForm-based SelfAppraisal — the two share
 * the SelfAppraisalQuestion master (so it is the same questionnaire, filtered by
 * employeeType) but never the same tables, so neither flow can disturb the other.
 *
 * Keyed by employee + cycle, like PerformanceFinalReview. There is no FK to
 * PerformanceSummary — an employee has one summary row per milestone and none of
 * them owns the self-appraisal — but creation is gated on at least one summary
 * row existing, so a self-appraisal can never float free of an assigned cycle.
 */

import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { assertNotPausedOrHR, getPausedDaysBetween } from "../appraisal/appraisal-pause.controller";
import { isHRViewer } from "../../lib/performance-scoring";
import { labelForCyclePeriod, resolveCyclesForEmployee } from "../../lib/appraisal-cycle";

function viewerOf(req: Request) {
  const user = (req as any).user;
  return {
    empId: user?.empId ? Number(user.empId) : null,
    role: user?.role ?? "",
    deptId: user?.deptId ? Number(user.deptId) : null,
  };
}

/**
 * A self-appraisal is between the employee and HR. In-charge and supervisor
 * score the indicator; they do not read the employee's own words.
 */
function canAccess(req: Request, employeeId: number): boolean {
  const viewer = viewerOf(req);
  return viewer.empId === employeeId || isHRViewer(viewer);
}

/**
 * GET /performance/self-appraisal/cycles?employeeId=
 * One entry per assessment period the employee has been assigned — the
 * reviewers score at every milestone, so the employee self-assesses at every
 * milestone too. They never type or pick a cycle themselves.
 */
export const listSelfAppraisalCycles = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.query.employeeId) || viewerOf(req).empId;
    if (!employeeId) return res.status(400).json({ error: "employeeId is required" });
    if (!canAccess(req, employeeId)) {
      return res.status(403).json({ error: "You cannot view this employee's self-appraisal" });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true, dateOfJoining: true, employeeType: true,
        Department: {
          select: {
            appraisalCycleBasis: true,
            appraisalPeriodMonths: true,
            appraisalCalendarMonth: true,
          },
        },
      },
    });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const summaries = await prisma.performanceSummary.findMany({
      // Archived periods drop out of the employee's list entirely.
      where: { employeeId, archivedAt: null },
      select: { cycle: true, period: true },
      orderBy: [{ cycle: "asc" }, { createdAt: "asc" }],
    });

    const existing = await prisma.performanceSelfAppraisal.findMany({
      where: { employeeId },
      select: { cycle: true, period: true, submittedAt: true, updatedAt: true },
    });
    const byKey = new Map(existing.map((e) => [`${e.cycle}|${e.period}`, e]));

    const doj = employee.dateOfJoining ? new Date(employee.dateOfJoining) : null;
    const pausedDays = await getPausedDaysBetween(employeeId, doj ?? new Date(), new Date());
    const plans = doj
      ? resolveCyclesForEmployee(doj, employee.Department, pausedDays)
      : [];

    // One row per assigned (cycle, period), each with its own status and its
    // own milestone — a period the employee has not reached yet cannot be filled.
    const seen = new Set<string>();
    const cycles = summaries
      .filter((s) => {
        const k = `${s.cycle}|${s.period}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((s) => {
        const row = byKey.get(`${s.cycle}|${s.period}`);
        const milestone = plans
          .find((p) => p.cycle === s.cycle)
          ?.periods.find((p) => p.period === s.period);
        return {
          cycle: s.cycle,
          period: s.period as string,
          periodLabel: labelForCyclePeriod(doj, s.cycle, s.period as string),
          milestoneDate: milestone?.milestoneDate ?? null,
          // Falls back to open when no plan matches — legacy cycles have no
          // derivable milestone and must not be locked out entirely.
          open: milestone ? milestone.reached : true,
          submitted: !!row?.submittedAt,
          submittedAt: row?.submittedAt ?? null,
          started: !!row,
          lastSaved: row?.updatedAt ?? null,
        };
      });

    // Which self-appraisal a person gets is decided by what HR actually
    // assigned them, not by their role: the Role table holds both "Incharge"
    // and "Incharges", and new roles keep being added, so a role-string branch
    // would quietly give some people nothing. An AppraisalForm means the
    // managerial flow owns their self-appraisal; a PerformanceSummary means
    // this one does. Anyone holding both is surfaced so they don't fill two.
    const managerial = await prisma.appraisalForm.findMany({
      where: { employeeId, archivedAt: null, status: { notIn: ["AUTO_DRAFT", "Draft"] } },
      select: { id: true, cycle: true, status: true, selfAppraisalSubmittedAt: true },
      orderBy: { id: "desc" },
    });

    res.json({
      employeeId,
      employeeType: employee.employeeType ?? null,
      cycles,
      managerialAppraisals: managerial.map((m) => ({
        id: m.id,
        cycle: m.cycle,
        status: m.status,
        submitted: !!m.selfAppraisalSubmittedAt,
      })),
      hasBoth: cycles.length > 0 && managerial.length > 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /performance/self-appraisal?employeeId=&cycle=
 * The questionnaire for this employee plus whatever they have already saved.
 */
export const getSelfAppraisal = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.query.employeeId) || viewerOf(req).empId;
    const cycle = String(req.query.cycle ?? "").trim();
    const period = String(req.query.period ?? "").trim();
    if (!employeeId || !cycle || !period) {
      return res.status(400).json({ error: "employeeId, cycle and period are required" });
    }
    if (!canAccess(req, employeeId)) {
      return res.status(403).json({ error: "You cannot view this employee's self-appraisal" });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true,
        employeeType: true, dateOfJoining: true,
      },
    });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const assigned = await prisma.performanceSummary.findFirst({
      where: { employeeId, cycle, period: period as any, archivedAt: null },
      select: { id: true },
    });
    if (!assigned) {
      return res.status(400).json({
        error: "No performance indicator has been assigned for this cycle and period.",
      });
    }

    // Same rule the managerial flow uses: an employee sees the question set for
    // their own employeeType. No type set means they see everything, which is
    // existing behaviour rather than something introduced here.
    const employeeType = employee.employeeType?.toUpperCase() ?? null;
    const questions = await prisma.selfAppraisalQuestion.findMany({
      where: { isActive: true, ...(employeeType ? { category: employeeType } : {}) },
      orderBy: { displayOrder: "asc" },
    });

    const record = await prisma.performanceSelfAppraisal.findUnique({
      where: { employeeId_cycle_period: { employeeId, cycle, period: period as any } },
      include: { answers: true },
    });

    res.json({
      employee,
      cycle,
      period,
      periodLabel: labelForCyclePeriod(
        employee.dateOfJoining ? new Date(employee.dateOfJoining) : null, cycle, period,
      ),
      questions,
      selfAppraisal: record
        ? {
            id: record.id,
            achievements: record.achievements,
            goalsObjective: record.goalsObjective,
            challenges: record.challenges,
            trainingNeeds: record.trainingNeeds,
            submittedAt: record.submittedAt,
          }
        : null,
      answers: record?.answers ?? [],
      // Only the employee writes their own; HR reads but does not fill it in.
      canEdit: viewerOf(req).empId === employeeId && !record?.submittedAt,
      readOnly: viewerOf(req).empId !== employeeId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /performance/self-appraisal
 * Save a draft or submit. Submitting locks it — HR reopens by clearing
 * submittedAt, mirroring how the managerial flow gates re-edits.
 */
export const submitSelfAppraisal = async (req: Request, res: Response) => {
  try {
    const viewer = viewerOf(req);
    const employeeId = Number(req.body.employeeId) || viewer.empId;
    const cycle = String(req.body.cycle ?? "").trim();
    const period = String(req.body.period ?? "").trim();
    const { answers, achievements, goalsObjective, challenges, trainingNeeds, isDraft } = req.body;

    if (!employeeId || !cycle || !period) {
      return res.status(400).json({ error: "employeeId, cycle and period are required" });
    }
    // Nobody self-appraises on somebody else's behalf.
    if (viewer.empId !== employeeId) {
      return res.status(403).json({ error: "You can only fill in your own self-appraisal" });
    }

    const guard = await assertNotPausedOrHR(employeeId, viewer.empId);
    if (guard.blocked) return res.status(423).json({ error: guard.message });

    const assigned = await prisma.performanceSummary.findFirst({
      where: { employeeId, cycle, period: period as any, archivedAt: null },
      select: { id: true },
    });
    if (!assigned) {
      return res.status(400).json({
        error: "No performance indicator has been assigned for this cycle and period.",
      });
    }

    // A period can't be self-assessed before the employee has reached it — the
    // same rule the reviewers' scores are held to.
    const subject = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        dateOfJoining: true,
        Department: {
          select: {
            appraisalCycleBasis: true,
            appraisalPeriodMonths: true,
            appraisalCalendarMonth: true,
          },
        },
      },
    });
    if (subject?.dateOfJoining) {
      const doj = new Date(subject.dateOfJoining);
      const pausedDays = await getPausedDaysBetween(employeeId, doj, new Date());
      const plan = resolveCyclesForEmployee(doj, subject.Department, pausedDays)
        .find((p) => p.cycle === cycle);
      const milestone = plan?.periods.find((p) => p.period === period);
      if (milestone && !milestone.reached) {
        return res.status(400).json({
          error: `This period opens on ${milestone.milestoneDate.toISOString().slice(0, 10)}.`,
        });
      }
    }

    const existing = await prisma.performanceSelfAppraisal.findUnique({
      where: { employeeId_cycle_period: { employeeId, cycle, period: period as any } },
      select: { id: true, submittedAt: true },
    });
    if (existing?.submittedAt) {
      return res.status(400).json({
        error: "This self-appraisal has already been submitted. Ask HR to reopen it.",
      });
    }

    const fields = {
      achievements: achievements || null,
      goalsObjective: goalsObjective || null,
      challenges: challenges || null,
      trainingNeeds: trainingNeeds || null,
      submittedAt: isDraft ? null : new Date(),
    };

    const saved = await prisma.$transaction(async (tx) => {
      const record = existing
        ? await tx.performanceSelfAppraisal.update({ where: { id: existing.id }, data: fields })
        : await tx.performanceSelfAppraisal.create({
            data: { employeeId, cycle, period: period as any, ...fields },
          });

      for (const a of (answers || [])) {
        if (!a?.questionId) continue;
        await tx.performanceSelfAppraisalAnswer.upsert({
          where: {
            selfAppraisalId_questionId: { selfAppraisalId: record.id, questionId: Number(a.questionId) },
          },
          create: {
            selfAppraisalId: record.id,
            questionId: Number(a.questionId),
            rating: a.rating ?? null,
            comments: a.comments || null,
          },
          update: { rating: a.rating ?? null, comments: a.comments || null },
        });
      }
      return record;
    }, { maxWait: 15000, timeout: 60000 });

    res.json({
      success: true,
      id: saved.id,
      submitted: !isDraft,
      message: isDraft ? "Draft saved" : "Self-appraisal submitted",
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * PATCH /performance/self-appraisal/:id/reopen
 * HR only — clears submittedAt so the employee can edit again.
 */
export const reopenSelfAppraisal = async (req: Request, res: Response) => {
  try {
    if (!isHRViewer(viewerOf(req))) {
      return res.status(403).json({ error: "Only HR can reopen a submitted self-appraisal" });
    }
    const id = Number(req.params.id);
    const record = await prisma.performanceSelfAppraisal.findUnique({ where: { id } });
    if (!record) return res.status(404).json({ error: "Self-appraisal not found" });

    await prisma.performanceSelfAppraisal.update({ where: { id }, data: { submittedAt: null } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};
