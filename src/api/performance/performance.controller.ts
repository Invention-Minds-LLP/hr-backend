import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";
import { assertNotPausedOrHR, getPausedDaysBetween } from "../appraisal/appraisal-pause.controller";
import {
  resolveCyclesForEmployee,
  findPlan,
  fallbackMilestones,
  labelForCyclePeriod,
  CyclePlan,
} from "../../lib/appraisal-cycle";
import { buildPerformanceSheetPdf } from "./performanceSheetPdf";
import { managerIdsAmong } from "../appraisal/appraisal.controller";
import { performanceEditGate, consumeEditRequest } from "./performanceEditRequest.controller";
import {
  resolveReviewerRole,
  isReviewerRole,
  isHRViewer,
  canSeeReviewerScore,
  reviewerProgressState,
  parseScoreBands,
  templateMaxMarks,
  bandFor,
  ReviewerRole,
  REVIEWER_ROLES,
  LEGACY_REVIEWER_ROLE,
} from "../../lib/performance-scoring";

/**
 * Which column the caller may write on this employee's sheet. Falls back to the
 * legacy single-score row so pre-existing data stays editable by whoever could
 * edit it before.
 */
async function callerReviewerRole(req: Request, employeeId: number): Promise<ReviewerRole | null> {
  const user = (req as any).user;
  const subject = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, departmentId: true, inchargeId: true, reportingManager: true },
  });
  if (!subject) return null;
  return resolveReviewerRole(
    {
      empId: user?.empId ?? null,
      role: user?.role ?? "",
      deptId: user?.deptId ?? null,
      roleId: user?.roleId ?? null,
    },
    subject,
  );
}

/**
 * The caller's role if they may write scores, else an error message explaining
 * why not. SELF never scores here — that is the self-appraisal.
 */
async function scoringRoleOrReason(
  req: Request,
  employeeId: number,
): Promise<{ role: string } | { error: string }> {
  const role = await callerReviewerRole(req, employeeId);
  if (role === "SELF") {
    return { error: "Score your own performance through Self Appraisal, not here." };
  }
  if (!role) {
    return {
      error: "You are not a reviewer for this employee. Only their in-charge, "
        + "reporting manager (HOD) or Management can score.",
    };
  }
  return { role };
}

/**
 * Load the assignable cycle plans for one employee: the FIRST_YEAR track (four
 * DOJ-derived milestones in a single cycle) plus any RECURRING annual cycles
 * that have arrived. Paused days push every milestone forward.
 */
async function loadPlansForEmployee(employeeId: number, asOf = new Date()) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true, firstName: true, lastName: true, employeeCode: true,
      dateOfJoining: true, departmentId: true,
      Department: {
        select: {
          id: true, name: true,
          appraisalCycleBasis: true,
          appraisalPeriodMonths: true,
          appraisalCalendarMonth: true,
        },
      },
    },
  });
  if (!employee) return { employee: null, plans: [] as CyclePlan[], pausedDays: 0 };
  if (!employee.dateOfJoining) return { employee, plans: [] as CyclePlan[], pausedDays: 0 };

  const doj = new Date(employee.dateOfJoining);
  const pausedDays = await getPausedDaysBetween(employeeId, doj, asOf);
  const plans = resolveCyclesForEmployee(doj, employee.Department, pausedDays, asOf);
  return { employee, plans, pausedDays };
}

/**
 * GET /performance/cycles?employeeId=
 * The assign dialog renders exactly what this returns — cycles are derived from
 * the employee's DOJ and their department's configured basis, never typed by
 * hand, so a summary can no longer be filed under the wrong cycle.
 */
export const getEmployeeCycles = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.query.employeeId);
    if (!employeeId) return res.status(400).json({ error: "employeeId is required" });

    const { employee, plans, pausedDays } = await loadPlansForEmployee(employeeId);
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    if (!employee.dateOfJoining) {
      return res.status(400).json({ error: "Employee has no date of joining — cycles cannot be derived." });
    }

    res.json({
      employeeId,
      dateOfJoining: employee.dateOfJoining,
      pausedDays,
      // For rows whose stored cycle matches no plan above, so the form can still
      // show milestone dates and lock a period that hasn't opened.
      fallbackMilestones: fallbackMilestones(new Date(employee.dateOfJoining), pausedDays),
      department: employee.Department
        ? {
            id: employee.Department.id,
            name: employee.Department.name,
            basis: employee.Department.appraisalCycleBasis || "DOJ",
            periodMonths: employee.Department.appraisalPeriodMonths || 12,
            calendarMonth: employee.Department.appraisalCalendarMonth ?? null,
          }
        : null,
      plans,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Templates are no longer scoped to a cycle — a question set doesn't change
 * because the financial year rolled over, and under DOJ-based cycles the label
 * is per-employee, which would have meant one template per employee. The column
 * is kept (existing rows hold real labels) and new rows get this constant.
 */
export const TEMPLATE_CYCLE_ANY = "ALL";

/**
 * ScoreBand[] is structurally valid JSON but nominally incompatible with
 * Prisma's InputJsonValue, which requires an index signature. Widen at the
 * boundary rather than contorting the domain type.
 */
const bandsAsJson = (raw: unknown): Prisma.InputJsonValue =>
  parseScoreBands(raw) as unknown as Prisma.InputJsonValue;

// Create a template
export const createTemplate = async (req: Request, res: Response) => {
  try {
    const { departmentId, cycle, title, questions, scoreBands } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    if (!departmentId) {
      return res.status(400).json({ error: "departmentId is required" });
    }
    const template = await prisma.performanceFormTemplate.create({
      data: {
        departmentId: Number(departmentId),
        cycle: cycle ? String(cycle) : TEMPLATE_CYCLE_ANY,
        title: String(title).trim(),
        scoreBands: scoreBands ? bandsAsJson(scoreBands) : undefined,
        questions: {
          create: (questions || []).map((q: any, i: number) => ({
            category: q.category,
            section: q.section ?? null,
            text: q.text,
            orderNo: q.orderNo ?? i,
            weight: q.weight ?? null,
          })),
        },
      },
      include: { questions: true }
    });
    res.json(template);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// Fetch ONE template — kept for backward compatibility. Prefers templateId,
// falls back to (departmentId, cycle) and returns the first match.
export const getTemplateByDept = async (req: Request, res: Response) => {
  try {
    const { departmentId } = req.params;
    const { cycle, templateId } = req.query as { cycle?: string; templateId?: string };

    if (templateId) {
      const template = await prisma.performanceFormTemplate.findUnique({
        where: { id: Number(templateId) },
        include: { questions: { orderBy: { orderNo: 'asc' } }, department: true }
      });
      return res.json(template);
    }

    const template = await prisma.performanceFormTemplate.findFirst({
      where: { departmentId: Number(departmentId), ...(cycle ? { cycle } : {}) },
      include: { questions: { orderBy: { orderNo: 'asc' } }, department: true }
    });
    res.json(template);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Copy a template — questions, groupings, weights and score bands — into a new
 * one, optionally under a different department.
 *
 * Two reasons this exists: reusing a long question set across departments
 * (the Patient Relation sheet is 38 criteria), and giving people a way out of
 * the "already has responses, clone it instead of editing" refusal that
 * updateTemplate and deleteTemplate have always returned with no clone to reach
 * for. The copy starts with no responses or assignments, so it is editable.
 */
export const cloneTemplate = async (req: Request, res: Response) => {
  try {
    const sourceId = Number(req.params.id);
    const { departmentId, title } = req.body as { departmentId?: number; title?: string };

    const source = await prisma.performanceFormTemplate.findUnique({
      where: { id: sourceId },
      include: { questions: { orderBy: { orderNo: 'asc' } } },
    });
    if (!source) return res.status(404).json({ error: 'Template not found' });

    const targetDeptId = departmentId ? Number(departmentId) : source.departmentId;
    const dept = await prisma.department.findUnique({ where: { id: targetDeptId } });
    if (!dept) return res.status(404).json({ error: 'Target department not found' });

    // Strip any existing suffix so cloning a clone doesn't stack "(copy) (copy)".
    const baseTitle = source.title.replace(/\s*\(copy\)\s*$/i, '').trim() || 'Default';
    const newTitle = String(title ?? '').trim() || `${baseTitle} (copy)`;

    const clone = await prisma.performanceFormTemplate.create({
      data: {
        departmentId: targetDeptId,
        cycle: TEMPLATE_CYCLE_ANY,
        title: newTitle,
        // Prisma returns Json as JsonValue; it round-trips unchanged.
        ...(source.scoreBands ? { scoreBands: source.scoreBands as Prisma.InputJsonValue } : {}),
        questions: {
          create: source.questions.map((q, i) => ({
            category: q.category,
            section: q.section,
            text: q.text,
            orderNo: q.orderNo ?? i,
            weight: q.weight,
          })),
        },
      },
      include: { questions: { orderBy: { orderNo: 'asc' } }, department: true },
    });

    res.json(clone);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// Single template + ordered questions, for the builder when editing.
export const getTemplateDetail = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const template = await prisma.performanceFormTemplate.findUnique({
      where: { id: Number(id) },
      include: {
        questions: { orderBy: { orderNo: 'asc' } },
        department: true,
        _count: { select: { summaries: true } },
      }
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const responseCount = await prisma.performanceResponse.count({
      where: { questionId: { in: template.questions.map(q => q.id) } },
    });

    res.json({ ...template, responseCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// Replace title + questions on an existing template. Refuses if any response
// has been recorded against the template's questions (clone instead).
export const updateTemplate = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { title, questions, scoreBands } = req.body as {
      title?: string;
      questions?: Array<{ category: string; section?: string | null; text: string; orderNo: number; weight?: number | null }>;
      scoreBands?: unknown;
    };

    const template = await prisma.performanceFormTemplate.findUnique({
      where: { id },
      include: { questions: { select: { id: true } } },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const responseCount = await prisma.performanceResponse.count({
      where: { questionId: { in: template.questions.map(q => q.id) } },
    });
    if (responseCount > 0) {
      return res.status(409).json({
        error: 'This template already has employee responses. Clone it instead of editing.',
        responseCount,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (title !== undefined || scoreBands !== undefined) {
        await tx.performanceFormTemplate.update({
          where: { id },
          data: {
            ...(title !== undefined ? { title: String(title).trim() || 'Default' } : {}),
            ...(scoreBands !== undefined ? { scoreBands: bandsAsJson(scoreBands) } : {}),
          },
        });
      }
      if (Array.isArray(questions)) {
        await tx.performanceQuestion.deleteMany({ where: { templateId: id } });
        if (questions.length) {
          await tx.performanceQuestion.createMany({
            data: questions.map((q, i) => ({
              templateId: id,
              category: q.category,
              section: q.section ?? null,
              text: q.text,
              orderNo: q.orderNo ?? i,
              weight: q.weight ?? null,
            })),
          });
        }
      }
      return tx.performanceFormTemplate.findUnique({
        where: { id },
        include: { questions: { orderBy: { orderNo: 'asc' } } },
      });
    });

    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// Refuses delete if the template has been assigned to anyone or has any
// recorded responses; otherwise removes questions then the template.
export const deleteTemplate = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const template = await prisma.performanceFormTemplate.findUnique({
      where: { id },
      include: { questions: { select: { id: true } }, _count: { select: { summaries: true } } },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    if (template._count.summaries > 0) {
      return res.status(409).json({ error: 'Template is assigned to employees and cannot be deleted.' });
    }

    const responseCount = await prisma.performanceResponse.count({
      where: { questionId: { in: template.questions.map(q => q.id) } },
    });
    if (responseCount > 0) {
      return res.status(409).json({ error: 'Template has recorded responses and cannot be deleted.' });
    }

    await prisma.$transaction([
      prisma.performanceQuestion.deleteMany({ where: { templateId: id } }),
      prisma.performanceFormTemplate.delete({ where: { id } }),
    ]);

    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// List a department's templates so HR can pick by name. `cycle` is accepted
// only as an optional legacy filter — templates are no longer cycle-scoped, so
// callers should omit it and get every template the department owns.
export const listTemplatesByDept = async (req: Request, res: Response) => {
  try {
    const { departmentId, cycle } = req.query as { departmentId?: string; cycle?: string };
    if (!departmentId) return res.status(400).json({ error: "departmentId is required" });

    const templates = await prisma.performanceFormTemplate.findMany({
      where: {
        departmentId: Number(departmentId),
        ...(cycle ? { OR: [{ cycle }, { cycle: TEMPLATE_CYCLE_ANY }] } : {})
      },
      orderBy: [{ title: 'asc' }],
      include: {
        _count: { select: { questions: true } }
      }
    });
    res.json(templates);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// Submit per-question responses — upsert per (employee, cycle, period, question)
export const submitResponses = async (req: Request, res: Response) => {
  try {
    const { employeeId, departmentId, cycle, responses } = req.body;
    const callerEmpId = (req as any).user?.empId ?? null;
    const guard = await assertNotPausedOrHR(Number(employeeId), callerEmpId);
    if (guard.blocked) return res.status(423).json({ error: guard.message });
    // Interactive form (not the array form) so maxWait/timeout can be set —
    // a full template is questions x periods upserts against a slow remote DB
    // and blows the 5s default.
    // The caller writes their own column only — they cannot overwrite another
    // reviewer's scores.
    const resolved = await scoringRoleOrReason(req, Number(employeeId));
    if ("error" in resolved) return res.status(403).json({ error: resolved.error });
    const reviewerRole = resolved.role;

    await prisma.$transaction(async (tx) => {
      for (const r of (responses || [])) {
        await tx.performanceResponse.upsert({
          where: {
            employeeId_cycle_period_questionId_reviewerRole: {
              employeeId,
              cycle,
              period: r.period,
              questionId: r.questionId,
              reviewerRole,
            },
          },
          create: {
            employeeId,
            departmentId,
            cycle,
            questionId: r.questionId,
            period: r.period,
            score: r.score,
            reviewerId: callerEmpId,
            reviewerRole,
            comments: r.comments,
          },
          update: {
            score: r.score,
            reviewerId: callerEmpId,
            comments: r.comments,
          },
        });
      }
    }, { maxWait: 15000, timeout: 60000 });
    res.json({ success: true, reviewerRole });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// Submit summary — idempotent per (employee, cycle, period, templateId)
export const submitSummary = async (req: Request, res: Response) => {
  try {
    const { employeeId, departmentId, cycle, templateId, summaries } = req.body;
    const callerEmpId = (req as any).user?.empId ?? null;
    const guard = await assertNotPausedOrHR(Number(employeeId), callerEmpId);
    if (guard.blocked) return res.status(423).json({ error: guard.message });
    const tid: number | null = templateId ?? null;
    await prisma.$transaction(async (tx) => {
      for (const s of (summaries || [])) {
        await upsertSummary(tx, { employeeId, departmentId, cycle, templateId: tid, summary: s });
      }
    }, { maxWait: 15000, timeout: 60000 });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// Internal helper — MySQL treats NULL as distinct in unique indexes, so the
// compound `employeeId_cycle_period_templateId` upsert doesn't work when
// templateId is null. findFirst + create/update covers both cases.
async function upsertSummary(
  tx: any,
  args: {
    employeeId: number;
    departmentId: number;
    cycle: string;
    templateId: number | null;
    summary: any;
  }
) {
  const { employeeId, departmentId, cycle, templateId, summary: s } = args;
  const existing = await tx.performanceSummary.findFirst({
    where: { employeeId, cycle, period: s.period, templateId },
  });
  const fields = {
    marksScored: s.marksScored,
    overallPerf: s.overallPerf,
    employeeSig: s.employeeSig,
    supervisorSig: s.supervisorSig,
    hodSig: s.hodSig,
  };
  if (existing) {
    return tx.performanceSummary.update({ where: { id: existing.id }, data: fields });
  }
  return tx.performanceSummary.create({
    data: {
      employeeId,
      departmentId,
      cycle,
      templateId,
      period: s.period,
      ...fields,
    },
  });
}

// True when a final-review payload actually carries something worth storing.
// The frontend always sends the object (pre-initialised with empty strings), so
// without this check every period submit wrote a blank PerformanceFinalReview
// row and suppressed the "HOD submitted, please review" notification to HR.
function hasFinalReviewContent(fr: any): boolean {
  if (!fr) return false;
  return ['appreciations', 'talents', 'overallComments', 'employeeSig', 'supervisorSig', 'hrSig']
    .some((k) => String(fr[k] ?? '').trim() !== '');
}

// Internal helper — one final review per (employee, department, cycle).
// There is no unique constraint backing this (nullable-free but never added),
// so reads take the newest row and writes update it instead of piling on.
async function upsertFinalReview(
  tx: any,
  args: { employeeId: number; departmentId: number; cycle: string; finalReview: any }
) {
  const { employeeId, departmentId, cycle, finalReview: fr } = args;
  const fields = {
    appreciations: fr.appreciations,
    talents: fr.talents,
    overallComments: fr.overallComments,
    employeeSig: fr.employeeSig,
    supervisorSig: fr.supervisorSig,
    hrSig: fr.hrSig,
  };
  const existing = await tx.performanceFinalReview.findFirst({
    where: { employeeId, departmentId, cycle },
    orderBy: { id: 'desc' },
  });
  if (existing) {
    return tx.performanceFinalReview.update({ where: { id: existing.id }, data: fields });
  }
  return tx.performanceFinalReview.create({
    data: { employeeId, departmentId, cycle, ...fields },
  });
}

// Submit final review
export const submitFinalReview = async (req: Request, res: Response) => {
  try {
    const { employeeId, departmentId, cycle, appreciations, talents, overallComments, employeeSig, supervisorSig, hrSig } = req.body;
    const callerEmpId = (req as any).user?.empId ?? null;
    const guard = await assertNotPausedOrHR(Number(employeeId), callerEmpId);
    if (guard.blocked) return res.status(423).json({ error: guard.message });

    const finalReview = { appreciations, talents, overallComments, employeeSig, supervisorSig, hrSig };
    if (!hasFinalReviewContent(finalReview)) {
      return res.status(400).json({ error: 'Final review is empty — nothing to save.' });
    }

    const review = await upsertFinalReview(prisma, {
      employeeId: Number(employeeId),
      departmentId: Number(departmentId),
      cycle,
      finalReview,
    });
    res.json(review);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// Returns template + employee + saved responses/summaries/finalReview.
// Accepts templateId as a query param (preferred). Falls back to dept+cycle.
export const getEmployeeForm = async (req: Request, res: Response) => {
  try {
    const { employeeId, departmentId } = req.params;
    const { cycle, templateId } = req.query as { cycle?: string; templateId?: string };

    let template;
    if (templateId) {
      template = await prisma.performanceFormTemplate.findUnique({
        where: { id: Number(templateId) },
        include: { questions: { orderBy: { orderNo: 'asc' } }, department: true }
      });
    } else {
      template = await prisma.performanceFormTemplate.findFirst({
        where: { departmentId: Number(departmentId), ...(cycle ? { cycle } : {}) },
        include: { questions: { orderBy: { orderNo: 'asc' } }, department: true }
      });
    }

    if (!template) return res.status(404).json({ error: "Template not found" });

    const employee = await prisma.employee.findUnique({
      where: { id: Number(employeeId) },
      include: { Department: true }
    });

    const responses = await prisma.performanceResponse.findMany({
      where: {
        employeeId: Number(employeeId),
        departmentId: Number(departmentId),
        ...(cycle ? { cycle } : {}),
        questionId: { in: template.questions.map(q => q.id) },
      }
    });

    const summaries = await prisma.performanceSummary.findMany({
      where: {
        employeeId: Number(employeeId),
        departmentId: Number(departmentId),
        ...(cycle ? { cycle } : {}),
        ...(templateId ? { templateId: Number(templateId) } : {}),
      }
    });

    // Newest wins — historic duplicates exist (see scripts/performance-dedupe.ts)
    // and an unordered findFirst returns the oldest, i.e. stale, row.
    const finalReview = await prisma.performanceFinalReview.findFirst({
      where: { employeeId: Number(employeeId), departmentId: Number(departmentId), ...(cycle ? { cycle } : {}) },
      orderBy: { id: 'desc' }
    });

    const reviewerRole = await callerReviewerRole(req, Number(employeeId));
    const bands = parseScoreBands(template.scoreBands);

    // Scores are confidential between each reviewer and HR. Filter BEFORE
    // responding — hiding them in the UI would still ship them to the browser.
    const user = (req as any).user;
    const isHR = isHRViewer({
      empId: user?.empId ?? null,
      role: user?.role ?? "",
      deptId: user?.deptId ?? null,
      roleId: user?.roleId ?? null,
    });
    const visibleResponses = responses.filter((r) =>
      canSeeReviewerScore(reviewerRole, isHR, r.reviewerRole),
    );

    res.json({
      template,
      employee,
      // The summary total and band still come back in `summaries` — that is the
      // row the employee signs on the paper form. Only the per-question
      // breakdown is withheld.
      responses: visibleResponses,
      summaries,
      finalReview,
      reviewerRole,
      canSeeAllScores: isHR,
      reviewerRoles: REVIEWER_ROLES,
      scoreBands: bands,
      maxMarks: templateMaxMarks(template.questions),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const submitFullForm = async (req: Request, res: Response) => {
  try {
    const data = req.body as any;
    const callerEmpId = (req as any).user?.empId ?? null;
    const guard = await assertNotPausedOrHR(Number(data.employeeId), callerEmpId);
    if (guard.blocked) return res.status(423).json({ error: guard.message });
    const templateId: number | null = data.templateId ?? null;

    // Only score if this caller has a column. Refusing here rather than writing
    // to a fallback keeps one reviewer's marks from landing in another's row.
    const resolvedRole = await scoringRoleOrReason(req, Number(data.employeeId));
    if ("error" in resolvedRole) return res.status(403).json({ error: resolvedRole.error });
    const reviewerRole = resolvedRole.role;

    // A period can only be filled once its milestone has passed — you cannot
    // rate performance for time the employee hasn't worked yet. Backfilling a
    // past milestone stays allowed; only future ones are refused.
    const { employee: subject, plans, pausedDays } = await loadPlansForEmployee(Number(data.employeeId));
    const plan = findPlan(plans, data.cycle);
    const subjectDoj = subject?.dateOfJoining ? new Date(subject.dateOfJoining) : null;

    // A row whose stored cycle matches no derived plan — a legacy label, or one
    // orphaned by a department changing its basis — still gets checked, against
    // milestones computed straight from the joining date.
    const fallback = subjectDoj && !plan ? fallbackMilestones(subjectDoj, pausedDays) : null;

    const milestoneFor = (period: string): Date | null => {
      if (plan) return plan.periods.find((p) => p.period === period)?.milestoneDate ?? null;
      return fallback?.[period] ?? null;
    };

    const submitted = new Set<string>([
      ...(data.responses || []).map((r: any) => r.period),
      ...(data.summaries || []).map((s: any) => s.period),
    ]);

    const now = Date.now();
    const blocked: Array<{ period: string; when: Date }> = [];
    for (const period of submitted) {
      const when = milestoneFor(period);
      if (when && when.getTime() > now) blocked.push({ period, when });
    }

    if (blocked.length) {
      return res.status(400).json({
        error: `${blocked.map((b) => b.period).join(", ")} cannot be filled yet — ` +
          `that milestone is reached on ${blocked[0].when.toISOString().slice(0, 10)}.`,
        periods: blocked.map((b) => b.period),
      });
    }

    // Once HR has marked a period reviewed, changing it needs an approved edit
    // request for this reviewer's own column. Checked per period, since each is
    // signed off separately. The approval is consumed after a successful save.
    const consumeAfterSave: number[] = [];
    for (const period of submitted) {
      const row = await prisma.performanceSummary.findFirst({
        where: {
          employeeId: Number(data.employeeId),
          cycle: data.cycle,
          period: period as any,
          ...(templateId ? { templateId } : {}),
        },
        select: { id: true },
      });
      if (!row) continue;

      const gate = await performanceEditGate(row.id, reviewerRole);
      if (!gate.allowed) {
        return res.status(423).json({ error: gate.message, period, summaryId: row.id });
      }
      if (gate.requestId) consumeAfterSave.push(gate.requestId);
    }

    // Evaluate once — the notification below and the write inside the
    // transaction must agree on whether a real final review was supplied.
    const finalReviewSupplied = hasFinalReviewContent(data.finalReview);

    await prisma.$transaction(async (tx) => {
      // 1) Upsert per-question responses (idempotent on re-submit). Scoped to
      // the caller's own reviewer column — an in-charge submitting cannot
      // disturb the supervisor's or the employee's own scores.
      if (data.responses?.length) {
        for (const r of data.responses) {
          await tx.performanceResponse.upsert({
            where: {
              employeeId_cycle_period_questionId_reviewerRole: {
                employeeId: data.employeeId,
                cycle: data.cycle,
                period: r.period,
                questionId: r.questionId,
                reviewerRole,
              },
            },
            create: {
              employeeId: data.employeeId,
              departmentId: data.departmentId,
              cycle: data.cycle,
              questionId: r.questionId,
              period: r.period,
              score: r.score,
              reviewerId: callerEmpId,
              reviewerRole,
              comments: r.comments,
            },
            update: {
              score: r.score,
              reviewerId: callerEmpId,
              comments: r.comments,
            },
          });
        }
      }

      // 2) Upsert period summaries (idempotent on re-submit)
      if (data.summaries?.length) {
        for (const s of data.summaries) {
          await upsertSummary(tx, {
            employeeId: data.employeeId,
            departmentId: data.departmentId,
            cycle: data.cycle,
            templateId,
            summary: s,
          });
        }
      }

      // 3) Final review (one per cycle+employee) — only when non-empty
      if (finalReviewSupplied) {
        await upsertFinalReview(tx, {
          employeeId: data.employeeId,
          departmentId: data.departmentId,
          cycle: data.cycle,
          finalReview: data.finalReview,
        });
      }
    }, { maxWait: 15000, timeout: 60000 });

    // Approvals buy one correction each — stamped only after the write lands.
    for (const requestId of consumeAfterSave) {
      await consumeEditRequest(requestId);
    }

    // 4) Notify HR when summaries are submitted without a final review yet.
    if (!finalReviewSupplied && data.summaries?.length) {
      const employee = await prisma.employee.findUnique({
        where: { id: data.employeeId },
        select: { firstName: true, lastName: true, employeeCode: true },
      });

      const employeeName = employee
        ? `${employee.firstName} ${employee.lastName}`
        : `Employee #${data.employeeId}`;

      const hrUsers = await prisma.employee.findMany({
        where: { departmentId: 1, employmentStatus: 'ACTIVE' },
        select: { id: true },
      });

      const period = data.summaries[0]?.period ?? '';
      const message = `HOD has submitted appraisal for ${employeeName} for ${data.cycle}${period ? ` – ${period}` : ''}. Please review.`;

      for (const hr of hrUsers) {
        await createNotification(hr.id, message);
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Assign a whole track to one or more employees.
 *
 *   FIRST_YEAR — creates all four probation rows (M1/M3/M6/YEAR_1) in one go,
 *                under a single DOJ-derived cycle so the first year is never
 *                split across two reporting years. Rows are created up front;
 *                each becomes fillable when its milestone date arrives.
 *   RECURRING  — creates the single annual row for the requested cycle (or the
 *                most recent one that has arrived).
 *
 * The cycle is DERIVED here, never taken from the request, so a summary cannot
 * be filed under a cycle that doesn't belong to the employee.
 */
export const assignFormToEmployee = async (req: Request, res: Response) => {
  try {
    const { employeeId, employeeIds, templateId } = req.body;
    const track: string = req.body.track === "RECURRING" ? "RECURRING" : "FIRST_YEAR";
    const requestedCycle: string | undefined = req.body.cycle;

    if (!templateId) return res.status(400).json({ error: "templateId is required" });

    const template = await prisma.performanceFormTemplate.findUnique({ where: { id: Number(templateId) } });
    if (!template) return res.status(404).json({ error: "Template not found" });

    const ids: number[] = (employeeIds?.length ? employeeIds : employeeId ? [employeeId] : []).map(Number);
    if (!ids.length) return res.status(400).json({ error: "No employees provided" });

    // The mirror of the managerial guard: anyone who manages someone belongs in
    // Managerial Appraisal, not here. Same helper decides both, so the two
    // modules can never disagree about who is a manager.
    const managerSet = await managerIdsAmong(ids);

    const results: any[] = [];

    for (const id of ids) {
      const { employee, plans } = await loadPlansForEmployee(id);

      if (!employee) {
        results.push({ employeeId: id, assigned: false, message: "Employee not found" });
        continue;
      }
      if (!employee.dateOfJoining) {
        results.push({ employeeId: id, assigned: false, message: "No date of joining — cannot derive a cycle" });
        continue;
      }
      if (managerSet.has(id)) {
        results.push({
          employeeId: id,
          assigned: false,
          employeeName: `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim(),
          message: "Manages other employees — appraise through Managerial Appraisal instead",
        });
        continue;
      }
      // The question set belongs to the employee's own department.
      if (template.departmentId !== employee.departmentId) {
        results.push({
          employeeId: id,
          assigned: false,
          message: "Template belongs to a different department",
        });
        continue;
      }

      const tracked = plans.filter((p) => p.track === track);
      const plan = requestedCycle
        ? findPlan(tracked, requestedCycle)
        : track === "FIRST_YEAR"
          ? tracked[0]
          // Newest recurring cycle whose review date has actually arrived,
          // falling back to the earliest upcoming one.
          : [...tracked].reverse().find((p) => p.periods[0]?.reached) ?? tracked[0];

      if (!plan) {
        results.push({
          employeeId: id,
          assigned: false,
          message: track === "FIRST_YEAR"
            ? "No first-year cycle available"
            : "No recurring cycle has started for this employee yet",
        });
        continue;
      }

      // First-year track for someone whose first year is already over: allowed
      // (the paper reviews may never have been recorded) but flagged so the UI
      // can say so, since a batch can mix tenures.
      const yearOne = plan.periods.find((p) => p.period === "YEAR_1");
      const isBackfill = plan.track === "FIRST_YEAR" && !!yearOne?.reached;

      // Only periods the employee has actually reached. Assigning a milestone
      // months before it opens leaves Draft rows cluttering the list with
      // nothing to do; catching up happens naturally, because every reached
      // period that isn't already assigned gets created on the next assign.
      const due = plan.periods.filter((p) => p.reached);
      const notOpen = plan.periods.filter((p) => !p.reached);

      if (!due.length) {
        const next = notOpen[0];
        results.push({
          employeeId: id,
          assigned: false,
          track: plan.track,
          cycle: plan.cycle,
          employeeName: `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim(),
          message: next
            ? `No period has opened yet — the first one opens on ${next.milestoneDate.toISOString().slice(0, 10)}.`
            : "No period has opened yet.",
        });
        continue;
      }

      const created: string[] = [];
      const skipped: string[] = [];

      for (const p of due) {
        const exists = await prisma.performanceSummary.findFirst({
          where: {
            employeeId: id,
            departmentId: employee.departmentId,
            cycle: plan.cycle,
            period: p.period,
            templateId: Number(templateId),
          },
        });
        if (exists) {
          skipped.push(p.period);
          continue;
        }
        await prisma.performanceSummary.create({
          data: {
            employeeId: id,
            departmentId: employee.departmentId,
            cycle: plan.cycle,
            period: p.period,
            templateId: Number(templateId),
          },
        });
        created.push(p.period);
      }

      results.push({
        employeeId: id,
        assigned: created.length > 0,
        track: plan.track,
        cycle: plan.cycle,
        created,
        skipped,
        // Periods that exist in this cycle but haven't opened yet — they get
        // created by a later assign, once their milestone arrives.
        notOpen: notOpen.map((p) => p.period),
        backfill: isBackfill,
        employeeName: `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim(),
        message: created.length ? undefined : "Already assigned",
      });
    }

    res.json(results);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};


// Attach (or re-attach) a template to a summary that was created before
// templateId became required. Refuses if the summary already has recorded
// responses, because those responses are keyed by questionId from whatever
// template was active at the time and would orphan against the new template.
export const assignSummaryTemplate = async (req: Request, res: Response) => {
  try {
    const summaryId = Number(req.params.id);
    const { templateId } = req.body as { templateId?: number };
    if (!templateId) return res.status(400).json({ error: 'templateId is required' });

    const summary = await prisma.performanceSummary.findUnique({
      where: { id: summaryId },
    });
    if (!summary) return res.status(404).json({ error: 'Summary not found' });

    const template = await prisma.performanceFormTemplate.findUnique({
      where: { id: Number(templateId) },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    if (template.departmentId !== summary.departmentId) {
      return res.status(400).json({ error: 'Template does not belong to this summary\'s department' });
    }
    // No cycle check — see TEMPLATE_CYCLE_ANY.

    // Only this row's own period matters. The previous check counted every
    // response for the employee+cycle, so one filled MONTH_1 row permanently
    // blocked attaching a template to their YEAR_1 row in the same cycle.
    const responseCount = await prisma.performanceResponse.count({
      where: {
        employeeId: summary.employeeId,
        cycle: summary.cycle,
        period: summary.period,
      },
    });
    if (responseCount > 0) {
      return res.status(409).json({
        error: 'This row already has recorded responses for this period and the template cannot be reassigned.',
        responseCount,
      });
    }

    const updated = await prisma.performanceSummary.update({
      where: { id: summaryId },
      data: { templateId: Number(templateId) },
      include: { template: { select: { id: true, title: true } } },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};


/**
 * GET /performance/export/:employeeId?scope=cycle|tenure&cycle=...
 * The printed sheet. "cycle" covers the periods in one cycle; "tenure" spans
 * every cycle, which is what the paper form's five columns represent.
 */
export const exportPerformanceSheet = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    if (!employeeId) return res.status(400).json({ error: "employeeId is required" });

    const scope = req.query.scope === "tenure" ? "tenure" : "cycle";
    const cycle = typeof req.query.cycle === "string" ? req.query.cycle : undefined;
    if (scope === "cycle" && !cycle) {
      return res.status(400).json({ error: "cycle is required when scope is 'cycle'" });
    }

    // Same visibility rule as the list: you may export what you may see.
    const user = (req as any).user;
    const allowed = await canViewEmployeeSheet(user, employeeId);
    if (!allowed) return res.status(403).json({ error: "You cannot export this employee's sheet" });

    // The sheet shows only what this caller may see — an employee's own copy
    // carries their self-scores and the summary totals, not their reviewers'.
    const viewerCtx = {
      empId: user?.empId ?? null,
      role: user?.role ?? "",
      deptId: user?.deptId ?? null,
    };
    const built = await buildPerformanceSheetPdf({
      employeeId,
      scope,
      cycle,
      viewer: {
        role: await callerReviewerRole(req, employeeId),
        isHR: isHRViewer(viewerCtx),
      },
    });
    if (!built) return res.status(404).json({ error: "No performance records found for this employee" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${built.filename}"`);
    res.send(built.pdf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** Mirrors getAllSummaries' scoping so export can't leak what the list hides. */
async function canViewEmployeeSheet(user: any, employeeId: number): Promise<boolean> {
  const role: string = user?.role || "";
  const empId = Number(user?.empId);
  const deptId = Number(user?.deptId);

  if (role === "HR Manager" || role === "HR" || role === "Management") return true;
  if (empId === employeeId) return true;

  const subject = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { departmentId: true, inchargeId: true, reportingManager: true },
  });
  if (!subject) return false;

  if (deptId === 1) return subject.departmentId !== 1;
  if (subject.reportingManager === empId || subject.inchargeId === empId) return true;
  return Number.isFinite(deptId) && subject.departmentId === deptId;
}

// Get all summaries with employee & department + template title for display.
// Scoped server-side by role — mirrors getAllAppraisalsWithManagerReview in
// appraisal.controller.ts. The frontend used to be the only filter, which meant
// any authenticated caller could read every employee's performance data.
export const getAllSummaries = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const userRole: string = user?.role || '';
    const empId: number = Number(user?.empId);
    const deptId: number = Number(user?.deptId);

    const isHRManager = userRole === 'HR Manager' || userRole === 'HR';
    const isManagement = userRole === 'Management';
    const isReportingManager = userRole === 'Reporting Manager';
    // HR dept (dept 1), any non-HR-Manager role — handles all other departments
    const isHRExecutive = deptId === 1 && !isHRManager && !isManagement && !isReportingManager;

    let whereClause: any;
    if (isHRManager || isManagement) {
      whereClause = {}; // see all
    } else if (isHRExecutive) {
      // HR executives handle other departments + can see their own row
      whereClause = {
        OR: [
          { employee: { departmentId: { not: 1 } } },
          { employeeId: empId },
        ],
      };
    } else if (isReportingManager) {
      whereClause = {
        OR: [
          { employee: { reportingManager: empId } },
          { employee: { inchargeId: empId } },
          { employeeId: empId },
        ],
      };
    } else {
      // In-charges and plain executives: the people they are in-charge of, plus
      // their own row. Deliberately NOT the whole department — an executive has
      // no business seeing every colleague's appraisal.
      //
      // NOTE: this returns nothing for an in-charge until `inchargeId` is set on
      // their reports. That field is editable on the employee form; it is empty
      // across the board today.
      whereClause = {
        OR: [
          { employee: { inchargeId: empId } },
          { employeeId: empId },
        ],
      };
    }

    const summaries = await prisma.performanceSummary.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            email: true,
            dateOfJoining: true,
            reportingManager: true,
            gender: true,
            photoUrl: true,
          }
        },
        department: {
          select: {
            id: true, name: true,
            appraisalCycleBasis: true,
            appraisalPeriodMonths: true,
            appraisalCalendarMonth: true,
          }
        },
        template: {
          select: { id: true, title: true, _count: { select: { questions: true } } }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    // Who has finished their part. Derived, not stored — two grouped queries
    // rather than one per row. Only sent to HR/Management: completion status is
    // not a score, but it is still not a reviewer's business who else has filed.
    const showProgress = isHRManager || isManagement || isHRExecutive;
    let progressFor: (s: (typeof summaries)[number]) => Record<string, string> | undefined =
      () => undefined;

    if (showProgress && summaries.length) {
      const empIds = [...new Set(summaries.map((s) => s.employeeId))];

      // Scored answers per (employee, cycle, period, reviewer).
      const scored = await prisma.performanceResponse.groupBy({
        by: ["employeeId", "cycle", "period", "reviewerRole"],
        where: { employeeId: { in: empIds }, score: { not: null } },
        _count: { _all: true },
      });
      const scoredMap = new Map<string, number>();
      for (const r of scored) {
        scoredMap.set(`${r.employeeId}|${r.cycle}|${r.period}|${r.reviewerRole}`, r._count._all);
      }

      // Self-appraisal is per period now, like the reviewer columns, so each
      // row reports its own state rather than repeating the cycle's.
      const selfs = await prisma.performanceSelfAppraisal.findMany({
        where: { employeeId: { in: empIds } },
        select: { employeeId: true, cycle: true, period: true, submittedAt: true },
      });
      const selfMap = new Map(
        selfs.map((s) => [
          `${s.employeeId}|${s.cycle}|${s.period}`,
          s.submittedAt ? "done" : "partial",
        ]),
      );

      progressFor = (s) => {
        const total = s.template?._count?.questions ?? 0;
        const state = (role: string) =>
          reviewerProgressState(
            scoredMap.get(`${s.employeeId}|${s.cycle}|${s.period}|${role}`) ?? 0,
            total,
          );
        return {
          SELF: selfMap.get(`${s.employeeId}|${s.cycle}|${s.period}`) ?? "none",
          INCHARGE: state("INCHARGE"),
          HOD: state("HOD"),
          MANAGEMENT: state("MANAGEMENT"),
          REVIEWER: state(LEGACY_REVIEWER_ROLE),
        };
      };
    }

    // A recurring review is stored as YEAR_1 whatever year it covers, so the raw
    // period would show "1 Year" on a third-year row. Label each row by the year
    // its cycle actually represents.
    const rows = summaries.map((s) => ({
      ...s,
      periodLabel: labelForCyclePeriod(
        s.employee?.dateOfJoining ? new Date(s.employee.dateOfJoining) : null,
        s.cycle,
        s.period as string,
      ),
      // Absent for non-HR callers, so the column simply doesn't render.
      progress: progressFor(s),
    }));

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
