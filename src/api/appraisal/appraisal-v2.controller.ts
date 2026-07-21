import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";
import { getEffectiveMonthsSinceJoining, getPausedDaysBetween, assertNotPausedOrHR } from "./appraisal-pause.controller";

// ═══════════════════════════════════════════════════════════════════════════════
// SELF-APPRAISAL QUESTIONS (Master)
// ═══════════════════════════════════════════════════════════════════════════════
export const getSelfAppraisalQuestions = async (req: Request, res: Response) => {
  try {
    const appraisalId = req.query.appraisalId ? Number(req.query.appraisalId) : null;

    let employeeType: string | null = null;

    if (appraisalId) {
      const appraisal = await prisma.appraisalForm.findUnique({
        where: { id: appraisalId },
        include: { employee: { select: { employeeType: true } } },
      });
      employeeType = appraisal?.employee?.employeeType?.toUpperCase() ?? null;
    }

    const questions = await prisma.selfAppraisalQuestion.findMany({
      where: {
        isActive: true,
        ...(employeeType ? { category: employeeType } : {}),
      },
      orderBy: { displayOrder: "asc" },
    });

    return res.json(questions);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

export const createSelfAppraisalQuestion = async (req: Request, res: Response) => {
  try {
    const { text, category, section } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: "Question text required" });

    const maxOrder = await prisma.selfAppraisalQuestion.aggregate({ _max: { displayOrder: true } });
    const question = await prisma.selfAppraisalQuestion.create({
      data: {
        text: text.trim(),
        category: category || null,
        section: section || null,
        displayOrder: (maxOrder._max.displayOrder ?? 0) + 1,
      },
    });
    return res.status(201).json(question);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

export const toggleSelfAppraisalQuestion = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { isActive } = req.body;
    const q = await prisma.selfAppraisalQuestion.update({ where: { id }, data: { isActive } });
    return res.json(q);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// HR: VERIFY DRAFT → SEND TO EMPLOYEE & MANAGER
// ═══════════════════════════════════════════════════════════════════════════════
export const hrVerifyAppraisal = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { appraisalStartDate, appraisalEndDate, dueDate, hrVerifiedBy } = req.body;

    const appraisal = await prisma.appraisalForm.findUnique({
      where: { id },
      include: { employee: { select: { firstName: true, lastName: true, reportingManager: true, inchargeId: true } } },
    });

    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });
    if (appraisal.status !== "AUTO_DRAFT" && appraisal.status !== "Draft") {
      return res.status(400).json({ error: "Only AUTO_DRAFT appraisals can be verified" });
    }

    // Snapshot the employee's in-charge at verification time so the appraisal
    // routes to the right person even if the in-charge changes later.
    const inchargeIdSnapshot = appraisal.employee?.inchargeId ?? null;

    const updated = await prisma.appraisalForm.update({
      where: { id },
      data: {
        status: "PENDING_FILL",
        appraisalStartDate: appraisalStartDate ? new Date(appraisalStartDate) : undefined,
        appraisalEndDate: appraisalEndDate ? new Date(appraisalEndDate) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        hrVerifiedBy: hrVerifiedBy ? Number(hrVerifiedBy) : null,
        hrVerifiedAt: new Date(),
        inchargeId: inchargeIdSnapshot,
      },
    });

    // Notify employee
    const empName = `${appraisal.employee.firstName} ${appraisal.employee.lastName}`;
    await createNotification(appraisal.employeeId, `Your appraisal for cycle "${appraisal.cycle}" has been initiated. Please complete your self-appraisal.`);

    // Notify in-charge first (when present). Manager fills only after the
    // in-charge submits — the dynamic review form gates this client-side and
    // the new submit endpoints enforce it server-side.
    if (inchargeIdSnapshot) {
      await createNotification(inchargeIdSnapshot, `Appraisal initiated for ${empName} (${appraisal.cycle}). Please complete your in-charge review.`);
    }

    // Notify assigned manager and find their reporting manager (Management, role 4)
    if (appraisal.managerId) {
      await createNotification(appraisal.managerId, `Appraisal initiated for ${empName} (${appraisal.cycle}). Please complete your manager review.`);

      // The assigned manager's reporting manager is the Management reviewer (role 4)
      const assignedManager = await prisma.employee.findUnique({
        where: { id: appraisal.managerId },
        select: { reportingManager: true },
      });
      if (assignedManager?.reportingManager) {
        await createNotification(assignedManager.reportingManager, `Appraisal initiated for ${empName} (${appraisal.cycle}). Please complete your management review.`);
      }
    }

    return res.json(updated);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Notify correct HR staff based on the appraisal employee's department
//   - HR Manager (roleId 1) → always notified (all departments)
//   - HR Executive (roleId 2) → only notified for non-HR-dept (departmentId !== 1) appraisals
// ═══════════════════════════════════════════════════════════════════════════════
const notifyHRTeam = async (employeeDeptId: number, message: string) => {
  const hrStaff = await prisma.employee.findMany({
    where: {
      departmentId: 1,
      employmentStatus: "ACTIVE",
      roleId: employeeDeptId === 1
        ? 1              // HR dept appraisal → only HR Manager
        : { in: [1, 2] }, // other dept appraisal → HR Manager + HR Executives
    },
    select: { id: true },
  });
  for (const staff of hrStaff) {
    await createNotification(staff.id, message);
  }
};

/**
 * Whether the appraisal needs an In-charge review at all.
 * True when the appraisal has a snapshotted inchargeId (HR verify already ran)
 * OR the employee currently has an in-charge assigned (pre-verification rows).
 */
const inchargeRequired = (a: { inchargeId?: number | null; employee?: { inchargeId?: number | null } | null }) =>
  !!(a?.inchargeId || a?.employee?.inchargeId);

/** True when the In-charge step is either not required, or has been submitted. */
const inchargeDone = (a: {
  inchargeId?: number | null;
  inchargeAppraisalSubmittedAt?: Date | null;
  employee?: { inchargeId?: number | null } | null;
}) => !inchargeRequired(a) || !!a?.inchargeAppraisalSubmittedAt;

type EditLevel = "SELF" | "INCHARGE" | "MANAGER" | "MANAGEMENT";

const editTypeForLevel: Record<EditLevel, string> = {
  SELF: "SELF_APPRAISAL",
  INCHARGE: "INCHARGE_APPRAISAL",
  MANAGER: "MANAGER_APPRAISAL",
  MANAGEMENT: "MANAGEMENT_APPRAISAL",
};

/** The submittedAt timestamp that marks a given level as already filled. */
const levelSubmittedAt = (level: EditLevel, a: any): Date | null => {
  switch (level) {
    case "SELF": return a?.selfAppraisalSubmittedAt ?? null;
    case "INCHARGE": return a?.inchargeAppraisalSubmittedAt ?? null;
    case "MANAGER": return a?.managerAppraisalSubmittedAt ?? null;
    case "MANAGEMENT": return a?.managementAppraisalSubmittedAt ?? null;
  }
};

/**
 * Decide whether a non-draft (re)submit is allowed, and whether it flows
 * through the edit-request path.
 *
 * Rules:
 *  - First-time fill: allowed until the due date passes (blocked after — no
 *    late first-fill). A null due date does not block first fill.
 *  - Re-edit before the due date: free, unlimited, no request needed.
 *  - Re-edit after the due date, or with no due date set: needs an APPROVED
 *    edit request for that level.
 *  - An APPROVED (unconsumed) edit request always unlocks a submit regardless
 *    of the due date; the caller consumes it on success.
 */
const resolveEditGate = async (
  appraisalId: number,
  level: EditLevel,
  appraisal: any,
): Promise<{ allowed: boolean; message?: string; requestId?: number; request?: any }> => {
  const now = new Date();

  const approvedReq = await prisma.appraisalEditRequest.findFirst({
    where: { appraisalFormId: appraisalId, requestType: level, status: "APPROVED" },
    orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
  });
  if (approvedReq) return { allowed: true, requestId: approvedReq.id, request: approvedReq };

  const dueSet = appraisal.dueDate != null;
  const duePassed = dueSet && new Date(appraisal.dueDate) <= now;
  const alreadySubmitted = !!levelSubmittedAt(level, appraisal);

  if (!alreadySubmitted) {
    if (duePassed) return { allowed: false, message: "Due date has passed. You can no longer submit." };
    return { allowed: true };
  }

  // Re-edit of an already-submitted level.
  if (dueSet && !duePassed) return { allowed: true }; // free edit window

  return {
    allowed: false,
    message: dueSet
      ? "Due date has passed. Please submit an edit request to make changes."
      : "The edit window is closed. Please submit an edit request to make changes.",
  };
};

/**
 * Write the audit trail for an edit. Called on every non-draft submit; only
 * actual re-edits are logged (isEdit === true), never the first submission.
 * A free edit records editReason/approvedBy = null; a request-based edit
 * carries the reason and approver from the approved request.
 */
const recordAppraisalEdit = async (params: {
  appraisalFormId: number;
  level: EditLevel;
  editedBy: number;
  isEdit: boolean;
  previousValues: any;
  newValues: any;
  editReason?: string | null;
  approvedBy?: number | null;
}): Promise<void> => {
  console.log(`[appraisal-edit] recordAppraisalEdit called for ${params.level} appraisal=${params.appraisalFormId} by=${params.editedBy} isEdit=${params.isEdit}`);
  if (!params.isEdit) return;
  try {
    await prisma.appraisalEditHistory.create({
      data: {
        appraisalFormId: params.appraisalFormId,
        editedBy: params.editedBy,
        editType: editTypeForLevel[params.level],
        previousValues: params.previousValues,
        newValues: params.newValues,
        editReason: params.editReason ?? null,
        approvedBy: params.approvedBy ?? null,
      },
    });
  } catch (err) {
    // Never let audit logging break the submit — surface it in the console.
    console.error(`[appraisal-edit] FAILED to log ${params.level} edit for appraisal=${params.appraisalFormId}:`, err);
  }
};

// ── Edit-history diff (what changed, before → after) ─────────────────────────
const scalarChangeLabels: Record<string, string> = {
  overallScore: "Overall Score",
  comments: "Comments",
  recommendations: "Recommendations",
  inchargeOverallScore: "Overall Score",
  inchargeOverallComments: "Overall Comments",
  achievements: "Key Achievements",
  goalsObjective: "Goals & Objectives",
  challenges: "Challenges",
  trainingNeeds: "Training Needs",
};

/** Per-question answer array out of a stored snapshot, per level. */
const snapshotAnswers = (vals: any, editType: string): any[] => {
  if (!vals) return [];
  if (editType === "INCHARGE_APPRAISAL") return Array.isArray(vals.inchargeAnswers) ? vals.inchargeAnswers : [];
  return Array.isArray(vals.answers) ? vals.answers : []; // SELF / MANAGER / MANAGEMENT
};

/** Scalar (non-question) fields out of a stored snapshot, per level. */
const snapshotScalars = (vals: any, editType: string): Record<string, any> => {
  if (!vals) return {};
  if (editType === "SELF_APPRAISAL") {
    const s = vals.selfAppraisal ?? {};
    return { achievements: s.achievements, goalsObjective: s.goalsObjective, challenges: s.challenges, trainingNeeds: s.trainingNeeds };
  }
  if (editType === "INCHARGE_APPRAISAL") {
    return { inchargeOverallScore: vals.inchargeOverallScore, inchargeOverallComments: vals.inchargeOverallComments };
  }
  const m = vals.managerAppraisal ?? vals.managementAppraisal ?? {};
  return { overallScore: m.overallScore, comments: m.comments, recommendations: m.recommendations };
};

const displayVal = (v: any): string => (v === null || v === undefined || v === "" ? "—" : String(v));

/**
 * Field-level change list (before → after) for one edit-history row. Per-question
 * rating/comment changes are labelled with the question text; scalar overall
 * fields use friendly labels. Older rows without an `answers` snapshot simply
 * yield scalar-only diffs.
 */
const computeEditChanges = (
  h: any,
  reviewQMap: Map<number, string>,
  selfQMap: Map<number, string>,
): { label: string; from: string; to: string }[] => {
  const changes: { label: string; from: string; to: string }[] = [];
  const qMap = h.editType === "SELF_APPRAISAL" ? selfQMap : reviewQMap;

  const prevByQ = new Map<number, any>(snapshotAnswers(h.previousValues, h.editType).map((a: any) => [a.questionId, a]));
  const nextByQ = new Map<number, any>(snapshotAnswers(h.newValues, h.editType).map((a: any) => [a.questionId, a]));
  for (const qid of new Set<number>([...prevByQ.keys(), ...nextByQ.keys()])) {
    const p = prevByQ.get(qid), n = nextByQ.get(qid);
    const label = qMap.get(qid) || `Question #${qid}`;
    const pr = p?.rating ?? null, nr = n?.rating ?? null;
    if (pr !== nr) changes.push({ label, from: displayVal(pr), to: displayVal(nr) });
    const pc = p?.comments ?? "", nc = n?.comments ?? "";
    if (pc !== nc) changes.push({ label: `${label} (comment)`, from: displayVal(pc), to: displayVal(nc) });
  }

  const prevSc = snapshotScalars(h.previousValues, h.editType);
  const nextSc = snapshotScalars(h.newValues, h.editType);
  for (const key of new Set([...Object.keys(prevSc), ...Object.keys(nextSc)])) {
    if (displayVal(prevSc[key]) !== displayVal(nextSc[key])) {
      changes.push({ label: scalarChangeLabels[key] || key, from: displayVal(prevSc[key]), to: displayVal(nextSc[key]) });
    }
  }
  return changes;
};

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE: SUBMIT SELF-APPRAISAL
// ═══════════════════════════════════════════════════════════════════════════════
export const submitSelfAppraisal = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { answers, achievements, goalsObjective, challenges, trainingNeeds, isDraft } = req.body;

    const appraisal = await prisma.appraisalForm.findUnique({
      where: { id },
      include: { employee: { select: { departmentId: true, firstName: true, lastName: true, inchargeId: true } } },
    });
    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });

    // Pause guard — block when the employee is in an open pause window.
    // HR (roleId 1 or dept 1 + roleId 2) overrides.
    const callerEmpId = (req as any).user?.empId ?? null;
    const guard = await assertNotPausedOrHR(appraisal.employeeId, callerEmpId);
    if (guard.blocked) return res.status(423).json({ error: guard.message });

    // Allow self-appraisal during PENDING_FILL or if already submitted (edit after approval)
    if (!["PENDING_FILL", "SELF_APPRAISAL_PENDING", "HR_VERIFIED"].includes(appraisal.status)) {
      return res.status(400).json({ error: "Self-appraisal cannot be submitted at this stage" });
    }

    // Gate: unlimited free edits before the due date; after it (or with no due
    // date) a re-edit needs an APPROVED edit request. Drafts are never gated.
    let selfGate: { allowed: boolean; message?: string; requestId?: number; request?: any } = { allowed: true };
    if (!isDraft) {
      selfGate = await resolveEditGate(id, "SELF", appraisal);
      if (!selfGate.allowed) {
        return res.status(400).json({ error: selfGate.message });
      }
    }

    // Snapshot prior values for the audit trail before the upsert overwrites them.
    const prevSelf = await prisma.selfAppraisal.findUnique({ where: { appraisalFormId: id } });
    const prevSelfAnswers = await prisma.selfAppraisalAnswer.findMany({ where: { appraisalFormId: id } });

    // Upsert SelfAppraisal (free-text fields)
    await prisma.selfAppraisal.upsert({
      where: { appraisalFormId: id },
      create: {
        appraisalFormId: id,
        achievements: achievements || null,
        goalsObjective: goalsObjective || null,
        challenges: challenges || null,
        trainingNeeds: trainingNeeds || null,
      },
      update: {
        achievements: achievements || null,
        goalsObjective: goalsObjective || null,
        challenges: challenges || null,
        trainingNeeds: trainingNeeds || null,
      },
    });

    // Upsert answers (question-based)
    if (answers?.length) {
      for (const a of answers) {
        await prisma.selfAppraisalAnswer.upsert({
          where: {
            appraisalFormId_questionId: { appraisalFormId: id, questionId: a.questionId },
          },
          create: {
            appraisalFormId: id,
            questionId: a.questionId,
            rating: a.rating ?? null,
            comments: a.comments || null,
          },
          update: {
            rating: a.rating ?? null,
            comments: a.comments || null,
          },
        });
      }
    }

    // Update status if not saving as draft
    if (!isDraft) {
      // All required levels must submit → HR_REVIEW. In-charge only counts
      // when the appraisal has an in-charge assigned.
      const managerAlreadySubmitted = !!appraisal.managerAppraisalSubmittedAt;
      const managementAlreadySubmitted = !!appraisal.managementAppraisalSubmittedAt;
      const allSubmitted = managerAlreadySubmitted && managementAlreadySubmitted && inchargeDone(appraisal);
      const newStatus = allSubmitted ? "HR_REVIEW" : "PENDING_FILL";

      await prisma.appraisalForm.update({
        where: { id },
        data: {
          selfAppraisalSubmittedAt: new Date(),
          status: newStatus,
        },
      });

      // Audit trail: fill the request-based row, or log a free edit.
      const selfData = await prisma.selfAppraisal.findUnique({ where: { appraisalFormId: id } });
      const answerData = await prisma.selfAppraisalAnswer.findMany({ where: { appraisalFormId: id } });
      await recordAppraisalEdit({
        appraisalFormId: id,
        level: "SELF",
        editedBy: Number(callerEmpId) || appraisal.employeeId,
        isEdit: !!appraisal.selfAppraisalSubmittedAt || !!selfGate.requestId,
        previousValues: { selfAppraisal: prevSelf, answers: prevSelfAnswers },
        newValues: { selfAppraisal: selfData, answers: answerData },
        editReason: selfGate.request?.reason ?? null,
        approvedBy: selfGate.request?.approvedBy ?? null,
      });

      // Consume the approved edit request, if this submit used one.
      if (selfGate.requestId) {
        await prisma.appraisalEditRequest.update({
          where: { id: selfGate.requestId },
          data: { status: "COMPLETED" },
        });
      }

      const employeeDeptId = appraisal.employee?.departmentId ?? 0;
      const empName = `${appraisal.employee?.firstName} ${appraisal.employee?.lastName}`;
      const selfMsg = allSubmitted
        ? `All appraisal sections submitted for ${empName} (${appraisal.cycle}). Please review.`
        : `Self-appraisal submitted by ${empName} (${appraisal.cycle}).`;
      await notifyHRTeam(employeeDeptId, selfMsg);
    }

    return res.json({ message: isDraft ? "Self-appraisal saved as draft" : "Self-appraisal submitted" });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MANAGER: SUBMIT MANAGER APPRAISAL (enhanced — status-aware)
// ═══════════════════════════════════════════════════════════════════════════════
export const submitManagerAppraisalV2 = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const {
      qualityOfWorkRating, qualityOfWorkComments,
      knowledgeOfJobRating, knowledgeOfJobComments,
      teamworkRating, teamworkComments,
      independenceRating, independenceComments,
      recordsRating, recordsComments,
      guestServiceRating, guestServiceComments,
      safetyRating, safetyComments,
      attendanceRating, attendanceComments,
      leadershipRating, leadershipComments,
      overallScore, comments, recommendations,
      finalDecision, finalComments, isDraft,
    } = req.body;

    const appraisal = await prisma.appraisalForm.findUnique({
      where: { id },
      include: { employee: { select: { departmentId: true, firstName: true, lastName: true, inchargeId: true } } },
    });
    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });

    const callerEmpId = (req as any).user?.empId ?? null;
    const guard = await assertNotPausedOrHR(appraisal.employeeId, callerEmpId);
    if (guard.blocked) return res.status(423).json({ error: guard.message });

    // Allow manager to fill during PENDING_FILL (parallel) or after self-appraisal submitted
    if (!["PENDING_FILL", "SELF_APPRAISAL_SUBMITTED", "MANAGER_APPRAISAL_PENDING", "MANAGER_APPRAISAL_SUBMITTED"].includes(appraisal.status)) {
      return res.status(400).json({ error: "Manager appraisal cannot be submitted at this stage" });
    }

    // Gate: unlimited free edits before the due date; after it (or with no due
    // date) a re-edit needs an APPROVED edit request. Drafts are never gated.
    let mgrGate: { allowed: boolean; message?: string; requestId?: number; request?: any } = { allowed: true };
    if (!isDraft) {
      mgrGate = await resolveEditGate(id, "MANAGER", appraisal);
      if (!mgrGate.allowed) return res.status(400).json({ error: mgrGate.message });
    }

    // Snapshot prior per-question answers for the audit diff (before overwrite).
    const prevMgrAnswers = await prisma.appraisalReviewAnswer.findMany({ where: { appraisalFormId: id, level: "MANAGER" } });

    // New dynamic form sends an `answers` array. Persist to the unified
    // AppraisalReviewAnswer table (level=MANAGER) in addition to the legacy
    // column upsert below, so both old and new clients work during cutover.
    const answers = (req.body as any)?.answers;
    if (Array.isArray(answers)) {
      await saveReviewAnswers(id, "MANAGER", answers);
    }

    // Store previous values for audit if already exists
    const existing = await prisma.managerAppraisal.findUnique({ where: { appraisalFormId: id } });

    // Upsert manager appraisal
    await prisma.managerAppraisal.upsert({
      where: { appraisalFormId: id },
      create: {
        appraisalFormId: id,
        qualityOfWorkRating, qualityOfWorkComments,
        knowledgeOfJobRating, knowledgeOfJobComments,
        teamworkRating, teamworkComments,
        independenceRating, independenceComments,
        recordsRating, recordsComments,
        guestServiceRating, guestServiceComments,
        safetyRating, safetyComments,
        attendanceRating, attendanceComments,
        leadershipRating, leadershipComments,
        overallScore, comments, recommendations,
      },
      update: {
        qualityOfWorkRating, qualityOfWorkComments,
        knowledgeOfJobRating, knowledgeOfJobComments,
        teamworkRating, teamworkComments,
        independenceRating, independenceComments,
        recordsRating, recordsComments,
        guestServiceRating, guestServiceComments,
        safetyRating, safetyComments,
        attendanceRating, attendanceComments,
        leadershipRating, leadershipComments,
        overallScore, comments, recommendations,
      },
    });

    if (!isDraft) {
      const selfAlreadySubmitted = !!appraisal.selfAppraisalSubmittedAt;
      const managementAlreadySubmitted = !!appraisal.managementAppraisalSubmittedAt;
      // In-charge only blocks when the appraisal has one assigned.
      const allSubmitted = selfAlreadySubmitted && managementAlreadySubmitted && inchargeDone(appraisal);
      const newStatus = allSubmitted ? "HR_REVIEW" : "PENDING_FILL";

      await prisma.appraisalForm.update({
        where: { id },
        data: {
          status: newStatus,
          managerAppraisalSubmittedAt: new Date(),
          overallScore,
          finalDecision,
          finalComments,
        },
      });

      // Audit trail: fill the request-based row, or log a free edit.
      const mgrData = await prisma.managerAppraisal.findUnique({ where: { appraisalFormId: id } });
      const newMgrAnswers = await prisma.appraisalReviewAnswer.findMany({ where: { appraisalFormId: id, level: "MANAGER" } });
      await recordAppraisalEdit({
        appraisalFormId: id,
        level: "MANAGER",
        editedBy: Number(callerEmpId) || appraisal.managerId || 0,
        isEdit: !!appraisal.managerAppraisalSubmittedAt || !!mgrGate.requestId,
        previousValues: { managerAppraisal: existing, answers: prevMgrAnswers },
        newValues: { managerAppraisal: mgrData, answers: newMgrAnswers },
        editReason: mgrGate.request?.reason ?? null,
        approvedBy: mgrGate.request?.approvedBy ?? null,
      });
      if (mgrGate.requestId) {
        await prisma.appraisalEditRequest.update({
          where: { id: mgrGate.requestId },
          data: { status: "COMPLETED" },
        });
      }

      const employeeDeptId = appraisal.employee?.departmentId ?? 0;
      const empName = `${appraisal.employee?.firstName} ${appraisal.employee?.lastName}`;
      const mgrMsg = allSubmitted
        ? `All appraisal sections submitted for ${empName} (${appraisal.cycle}). Please review.`
        : `Manager review submitted for ${empName} (${appraisal.cycle}).`;
      await notifyHRTeam(employeeDeptId, mgrMsg);
    }

    return res.json({ message: isDraft ? "Manager appraisal saved as draft" : "Manager appraisal submitted" });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MANAGEMENT: SUBMIT MANAGEMENT APPRAISAL
// ═══════════════════════════════════════════════════════════════════════════════
export const submitManagementAppraisal = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const {
      qualityOfWorkRating, qualityOfWorkComments,
      knowledgeOfJobRating, knowledgeOfJobComments,
      teamworkRating, teamworkComments,
      independenceRating, independenceComments,
      recordsRating, recordsComments,
      guestServiceRating, guestServiceComments,
      safetyRating, safetyComments,
      attendanceRating, attendanceComments,
      leadershipRating, leadershipComments,
      overallScore, comments, recommendations, isDraft,
    } = req.body;

    const appraisal = await prisma.appraisalForm.findUnique({
      where: { id },
      include: { employee: { select: { departmentId: true, firstName: true, lastName: true, inchargeId: true } } },
    });
    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });

    const callerEmpId = (req as any).user?.empId ?? null;
    const guard = await assertNotPausedOrHR(appraisal.employeeId, callerEmpId);
    if (guard.blocked) return res.status(423).json({ error: guard.message });

    if (!["PENDING_FILL", "SELF_APPRAISAL_PENDING", "MANAGER_APPRAISAL_PENDING", "MANAGER_APPRAISAL_SUBMITTED"].includes(appraisal.status)) {
      return res.status(400).json({ error: "Management appraisal cannot be submitted at this stage" });
    }

    // Gate: unlimited free edits before the due date; after it (or with no due
    // date) a re-edit needs an APPROVED edit request. Drafts are never gated.
    let mgmtGate: { allowed: boolean; message?: string; requestId?: number; request?: any } = { allowed: true };
    if (!isDraft) {
      mgmtGate = await resolveEditGate(id, "MANAGEMENT", appraisal);
      if (!mgmtGate.allowed) return res.status(400).json({ error: mgmtGate.message });
    }
    const existingMgmt = await prisma.managementAppraisal.findUnique({ where: { appraisalFormId: id } });

    // Snapshot prior per-question answers for the audit diff (before overwrite).
    const prevMgmtAnswers = await prisma.appraisalReviewAnswer.findMany({ where: { appraisalFormId: id, level: "MANAGEMENT" } });

    // New dynamic form sends an `answers` array. Persist to AppraisalReviewAnswer
    // (level=MANAGEMENT) in addition to the legacy column upsert below.
    const mgmtAnswers = (req.body as any)?.answers;
    if (Array.isArray(mgmtAnswers)) {
      await saveReviewAnswers(id, "MANAGEMENT", mgmtAnswers);
    }

    await prisma.managementAppraisal.upsert({
      where: { appraisalFormId: id },
      create: {
        appraisalFormId: id,
        qualityOfWorkRating, qualityOfWorkComments,
        knowledgeOfJobRating, knowledgeOfJobComments,
        teamworkRating, teamworkComments,
        independenceRating, independenceComments,
        recordsRating, recordsComments,
        guestServiceRating, guestServiceComments,
        safetyRating, safetyComments,
        attendanceRating, attendanceComments,
        leadershipRating, leadershipComments,
        overallScore, comments, recommendations,
      },
      update: {
        qualityOfWorkRating, qualityOfWorkComments,
        knowledgeOfJobRating, knowledgeOfJobComments,
        teamworkRating, teamworkComments,
        independenceRating, independenceComments,
        recordsRating, recordsComments,
        guestServiceRating, guestServiceComments,
        safetyRating, safetyComments,
        attendanceRating, attendanceComments,
        leadershipRating, leadershipComments,
        overallScore, comments, recommendations,
      },
    });

    if (!isDraft) {
      const selfAlreadySubmitted = !!appraisal.selfAppraisalSubmittedAt;
      const managerAlreadySubmitted = !!appraisal.managerAppraisalSubmittedAt;
      // In-charge only blocks when the appraisal has one assigned.
      const allSubmitted = selfAlreadySubmitted && managerAlreadySubmitted && inchargeDone(appraisal);
      const newStatus = allSubmitted ? "HR_REVIEW" : "PENDING_FILL";

      await prisma.appraisalForm.update({
        where: { id },
        data: { status: newStatus, managementAppraisalSubmittedAt: new Date() },
      });

      // Audit trail: fill the request-based row, or log a free edit.
      const mgmtData = await prisma.managementAppraisal.findUnique({ where: { appraisalFormId: id } });
      const newMgmtAnswers = await prisma.appraisalReviewAnswer.findMany({ where: { appraisalFormId: id, level: "MANAGEMENT" } });
      await recordAppraisalEdit({
        appraisalFormId: id,
        level: "MANAGEMENT",
        editedBy: Number(callerEmpId) || 0,
        isEdit: !!appraisal.managementAppraisalSubmittedAt || !!mgmtGate.requestId,
        previousValues: { managementAppraisal: existingMgmt, answers: prevMgmtAnswers },
        newValues: { managementAppraisal: mgmtData, answers: newMgmtAnswers },
        editReason: mgmtGate.request?.reason ?? null,
        approvedBy: mgmtGate.request?.approvedBy ?? null,
      });
      if (mgmtGate.requestId) {
        await prisma.appraisalEditRequest.update({
          where: { id: mgmtGate.requestId },
          data: { status: "COMPLETED" },
        });
      }

      const employeeDeptId = appraisal.employee?.departmentId ?? 0;
      const empName = `${appraisal.employee?.firstName} ${appraisal.employee?.lastName}`;
      const mgmtMsg = allSubmitted
        ? `All appraisal sections submitted for ${empName} (${appraisal.cycle}). Please review.`
        : `Management review submitted for ${empName} (${appraisal.cycle}).`;
      await notifyHRTeam(employeeDeptId, mgmtMsg);
    }

    return res.json({ message: isDraft ? "Management appraisal saved as draft" : "Management appraisal submitted" });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// HR: FINAL REVIEW & APPROVE
// ═══════════════════════════════════════════════════════════════════════════════
export const hrReviewAppraisal = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { hrReviewComments, hrRecommendations, hrApprovedBy, action } = req.body;

    const appraisal = await prisma.appraisalForm.findUnique({
      where: { id },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });

    if (action === "APPROVE") {
      await prisma.appraisalForm.update({
        where: { id },
        data: {
          status: "COMPLETED",
          hrReviewComments,
          hrRecommendations,
          hrApprovedBy: hrApprovedBy ? Number(hrApprovedBy) : null,
          hrApprovedAt: new Date(),
        },
      });

      const empName = `${appraisal.employee.firstName} ${appraisal.employee.lastName}`;
      await createNotification(appraisal.employeeId, `Your appraisal for "${appraisal.cycle}" has been completed and approved by HR.`);
      if (appraisal.managerId) {
        await createNotification(appraisal.managerId, `Appraisal for ${empName} (${appraisal.cycle}) has been approved by HR.`);
      }

      return res.json({ message: "Appraisal approved" });
    }

    // Just save HR comments without approving
    await prisma.appraisalForm.update({
      where: { id },
      data: {
        status: "HR_REVIEW",
        hrReviewComments,
        hrRecommendations,
      },
    });

    return res.json({ message: "HR review saved" });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// EDIT REQUEST
// ═══════════════════════════════════════════════════════════════════════════════
export const requestEdit = async (req: Request, res: Response) => {
  try {
    const appraisalId = Number(req.params.id);
    const { requestedBy, reason, requestType } = req.body;

    if (!reason?.trim()) return res.status(400).json({ error: "Reason required" });
    if (!["SELF", "INCHARGE", "MANAGER", "MANAGEMENT"].includes(requestType)) {
      return res.status(400).json({ error: "requestType must be SELF, INCHARGE, MANAGER, or MANAGEMENT" });
    }

    const appraisal = await prisma.appraisalForm.findUnique({
      where: { id: appraisalId },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    });
    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });

    // Can only request edit before HR approves
    if (["COMPLETED", "HR_APPROVED"].includes(appraisal.status)) {
      return res.status(400).json({ error: "Cannot request edit after HR approval" });
    }

    // Get requester name
    const requester = await prisma.employee.findUnique({
      where: { id: Number(requestedBy) },
      select: { firstName: true, lastName: true, employeeCode: true },
    });
    const requesterName = requester ? `${requester.firstName} ${requester.lastName} (${requester.employeeCode})` : `Employee #${requestedBy}`;
    const empName = `${appraisal.employee.firstName} ${appraisal.employee.lastName} (${appraisal.employee.employeeCode})`;

    const editRequest = await prisma.appraisalEditRequest.create({
      data: {
        appraisalFormId: appraisalId,
        requestedBy: Number(requestedBy),
        reason,
        requestType,
      },
    });

    // Notify HR with names
    const hrEmployees = await prisma.employee.findMany({
      where: { departmentId: 1, employmentStatus: "ACTIVE" },
      select: { id: true },
    });
    const typeLabel = requestType === "SELF" ? "self-appraisal"
      : requestType === "INCHARGE" ? "in-charge review"
      : requestType === "MANAGEMENT" ? "management review"
      : "manager review";
    for (const hr of hrEmployees) {
      await createNotification(hr.id, `${requesterName} has requested to edit their ${typeLabel} for ${empName}'s appraisal (${appraisal.cycle}). Reason: ${reason}`);
    }

    return res.status(201).json(editRequest);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

export const respondEditRequest = async (req: Request, res: Response) => {
  try {
    const requestId = Number(req.params.requestId);
    const { action, approvedBy, rejectionReason } = req.body;

    const editReq = await prisma.appraisalEditRequest.findUnique({
      where: { id: requestId },
      include: {
        appraisalForm: {
          include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
        },
      },
    });

    if (!editReq) return res.status(404).json({ error: "Edit request not found" });
    if (editReq.status !== "PENDING") return res.status(400).json({ error: "Already processed" });

    // Get requester name
    const requester = await prisma.employee.findUnique({
      where: { id: editReq.requestedBy },
      select: { firstName: true, lastName: true, employeeCode: true },
    });
    const requesterName = requester ? `${requester.firstName} ${requester.lastName}` : `Employee`;
    const empName = `${editReq.appraisalForm.employee.firstName} ${editReq.appraisalForm.employee.lastName}`;
    const typeLabel = editReq.requestType === "SELF" ? "self-appraisal"
      : editReq.requestType === "INCHARGE" ? "in-charge review"
      : editReq.requestType === "MANAGEMENT" ? "management review"
      : "manager review";

    if (action === "APPROVE") {
      // The before/after audit row is written when the requester actually
      // re-submits (see recordAppraisalEdit in the submit handlers), carrying
      // this request's reason and approver. Approval only unlocks the edit.
      const appraisal = editReq.appraisalForm;

      const clearData: any = { status: "PENDING_FILL" };
      if (editReq.requestType === "SELF") {
        clearData.selfAppraisalSubmittedAt = null;
      } else if (editReq.requestType === "INCHARGE") {
        clearData.inchargeAppraisalSubmittedAt = null;
      } else if (editReq.requestType === "MANAGER") {
        clearData.managerAppraisalSubmittedAt = null;
      } else {
        clearData.managementAppraisalSubmittedAt = null;
      }
      await prisma.appraisalForm.update({
        where: { id: appraisal.id },
        data: clearData,
      });

      await prisma.appraisalEditRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED", approvedBy: Number(approvedBy), approvedAt: new Date() },
      });

      await createNotification(editReq.requestedBy, `Your edit request for ${empName}'s ${typeLabel} (${editReq.appraisalForm.cycle}) has been approved. You can now edit.`);
    } else {
      await prisma.appraisalEditRequest.update({
        where: { id: requestId },
        data: { status: "REJECTED", approvedBy: Number(approvedBy), approvedAt: new Date(), rejectionReason },
      });

      // No status change needed on rejection — status stays as-is

      await createNotification(editReq.requestedBy, `Your edit request for ${empName}'s ${typeLabel} (${editReq.appraisalForm.cycle}) has been rejected. Reason: ${rejectionReason || "N/A"}`);
    }

    return res.json({ message: `Edit request ${action.toLowerCase()}` });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET APPRAISAL DETAIL (role-aware — hides self-appraisal from manager)
// ═══════════════════════════════════════════════════════════════════════════════
export const getAppraisalDetail = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const viewerRole = req.query.viewerRole as string; // HR, MANAGER, EMPLOYEE

    const appraisal = await prisma.appraisalForm.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true, employeeCode: true, firstName: true, lastName: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } },
            dateOfJoining: true, reportingManager: true,
          },
        },
        selfAppraisal: true,
        selfAnswers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
        managerReview: true,
        managementReview: true,
        // Unified review answers from the new dynamic form (In-charge / Manager
        // / Management). Frontend filters by `level` as needed.
        reviewAnswers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
        hrReview: true,
        editRequests: { orderBy: { requestedAt: "desc" } },
        editHistory: { orderBy: { editedAt: "desc" } },
      },
    });

    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });

    // Enrich edit requests with requester names
    const requesterIds = [...new Set(appraisal.editRequests.map(r => r.requestedBy))];
    const requesters = await prisma.employee.findMany({
      where: { id: { in: requesterIds } },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
    });
    const requesterMap = new Map(requesters.map(r => [r.id, `${r.firstName} ${r.lastName} (${r.employeeCode})`]));

    const enrichedEditRequests = appraisal.editRequests.map(r => ({
      ...r,
      requestedByName: requesterMap.get(r.requestedBy) || `Employee #${r.requestedBy}`,
    }));

    // Enrich edit history with editor names for the audit-log display.
    const editorIds = [...new Set(appraisal.editHistory.map(h => h.editedBy).filter(Boolean))];
    const editors = await prisma.employee.findMany({
      where: { id: { in: editorIds } },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
    });
    const editorMap = new Map(editors.map(e => [e.id, `${e.firstName} ${e.lastName} (${e.employeeCode})`]));

    // Collect question ids referenced by the history snapshots to label the diff.
    const selfQids = new Set<number>();
    const reviewQids = new Set<number>();
    for (const h of appraisal.editHistory) {
      for (const arr of [snapshotAnswers(h.previousValues, h.editType), snapshotAnswers(h.newValues, h.editType)]) {
        for (const a of arr) {
          if (a?.questionId == null) continue;
          (h.editType === "SELF_APPRAISAL" ? selfQids : reviewQids).add(a.questionId);
        }
      }
    }
    const [selfQs, reviewQs] = await Promise.all([
      prisma.selfAppraisalQuestion.findMany({ where: { id: { in: [...selfQids] } }, select: { id: true, text: true } }),
      prisma.appraisalReviewQuestion.findMany({ where: { id: { in: [...reviewQids] } }, select: { id: true, title: true } }),
    ]);
    const selfQMap = new Map<number, string>(selfQs.map(q => [q.id, q.text]));
    const reviewQMap = new Map<number, string>(reviewQs.map(q => [q.id, q.title]));

    const enrichedEditHistory = appraisal.editHistory.map(h => ({
      ...h,
      editedByName: editorMap.get(h.editedBy) || `Employee #${h.editedBy}`,
      changes: computeEditChanges(h, reviewQMap, selfQMap),
    }));

    const result = { ...appraisal, editRequests: enrichedEditRequests, editHistory: enrichedEditHistory };

    // Manager/Management cannot see self-appraisal
    if (viewerRole === "MANAGER") {
      return res.json({
        ...result,
        selfAppraisal: null,
        selfAnswers: [],
      });
    }

    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET EDIT HISTORY
// ═══════════════════════════════════════════════════════════════════════════════
export const getEditHistory = async (req: Request, res: Response) => {
  try {
    const appraisalId = Number(req.params.id);
    const history = await prisma.appraisalEditHistory.findMany({
      where: { appraisalFormId: appraisalId },
      orderBy: { editedAt: "desc" },
    });
    return res.json(history);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

/**
 * POST /api/appraisals/:id/reassign-manager
 * HR override: reassign the manager on an open appraisal. Blocked once the
 * manager has already submitted (use the edit-request flow for that case).
 * Body: { newManagerId: number, reason?: string }
 */
export const reassignAppraisalManager = async (req: Request, res: Response) => {
  try {
    const appraisalId = Number(req.params.id);
    const { newManagerId, reason } = req.body as { newManagerId: number; reason?: string };
    const editedBy = (req as any).user?.empId ?? null;

    if (!appraisalId || !newManagerId) {
      return res.status(400).json({ error: "appraisalId and newManagerId are required" });
    }

    const appraisal = await prisma.appraisalForm.findUnique({
      where: { id: appraisalId },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });

    if (appraisal.managerAppraisalSubmittedAt) {
      return res.status(400).json({
        error: "Manager has already submitted this appraisal. Use the edit-request flow.",
      });
    }
    if (appraisal.managerId === Number(newManagerId)) {
      return res.status(400).json({ error: "That employee is already the appraisal's manager." });
    }

    const newMgr = await prisma.employee.findUnique({
      where: { id: Number(newManagerId) },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!newMgr) return res.status(404).json({ error: "New manager not found" });

    const oldManagerId = appraisal.managerId;

    await prisma.$transaction(async (tx) => {
      await tx.appraisalForm.update({
        where: { id: appraisalId },
        data: { managerId: Number(newManagerId) },
      });
      await tx.appraisalEditHistory.create({
        data: {
          appraisalFormId: appraisalId,
          editedBy: editedBy ?? Number(newManagerId), // fall back so the FK is satisfied
          editType: "MANAGER_REASSIGN",
          previousValues: { managerId: oldManagerId },
          newValues: { managerId: Number(newManagerId) },
          editReason: reason || null,
        },
      });
    });

    const empName = `${appraisal.employee.firstName} ${appraisal.employee.lastName}`.trim();
    const cycleLabel = appraisal.cycle ? ` (${appraisal.cycle})` : "";
    await createNotification(
      Number(newManagerId),
      `You have been assigned as the appraiser for ${empName}${cycleLabel}. Please complete the manager review.`,
    );
    if (oldManagerId) {
      await createNotification(
        oldManagerId,
        `The appraisal for ${empName}${cycleLabel} has been reassigned to another manager.`,
      );
    }

    return res.json({ success: true, appraisalId, oldManagerId, newManagerId: Number(newManagerId) });
  } catch (e: any) {
    console.error("reassignAppraisalManager error:", e);
    return res.status(500).json({ error: e.message || "Failed to reassign manager" });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// REVIEW QUESTIONS (Master pool shared by In-charge / Manager / Management)
// ═══════════════════════════════════════════════════════════════════════════════

type ReviewLevel = "INCHARGE" | "MANAGER" | "MANAGEMENT";
const REVIEW_LEVELS: readonly ReviewLevel[] = ["INCHARGE", "MANAGER", "MANAGEMENT"];

const isReviewLevel = (v: unknown): v is ReviewLevel =>
  typeof v === "string" && (REVIEW_LEVELS as readonly string[]).includes(v);

/** Normalise the `levels` field (Json) to a string array, defaulting to all. */
const normaliseLevels = (raw: unknown): ReviewLevel[] => {
  if (Array.isArray(raw)) {
    const arr = raw.filter(isReviewLevel) as ReviewLevel[];
    return arr.length ? arr : [...REVIEW_LEVELS];
  }
  return [...REVIEW_LEVELS];
};

/** Coerce a Json target field to a clean, deduped number[] (empty = no restriction). */
const normaliseIdArray = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return [];
  const nums = raw
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  return Array.from(new Set(nums));
};

type QuestionSubject = {
  id: number;
  departmentId: number | null;
  designationId: number | null;
  roleId: number | null;
};

/**
 * Does this master question apply to the employee being appraised?
 * All four target arrays empty => applies to everyone (global). Otherwise the
 * employee must match at least one non-empty axis (OR/union).
 */
const questionAppliesToEmployee = (
  q: { targetDepartmentIds: unknown; targetDesignationIds: unknown; targetRoleIds: unknown; targetEmployeeIds: unknown },
  emp: QuestionSubject,
): boolean => {
  const dept = normaliseIdArray(q.targetDepartmentIds);
  const desig = normaliseIdArray(q.targetDesignationIds);
  const role = normaliseIdArray(q.targetRoleIds);
  const emps = normaliseIdArray(q.targetEmployeeIds);
  if (!dept.length && !desig.length && !role.length && !emps.length) return true;
  if (dept.length && emp.departmentId != null && dept.includes(emp.departmentId)) return true;
  if (desig.length && emp.designationId != null && desig.includes(emp.designationId)) return true;
  if (role.length && emp.roleId != null && role.includes(emp.roleId)) return true;
  if (emps.length && emps.includes(emp.id)) return true;
  return false;
};

/** Shape a master question for the API response, normalising all Json arrays. */
const shapeReviewQuestion = (q: any) => ({
  ...q,
  levels: normaliseLevels(q.levels),
  targetDepartmentIds: normaliseIdArray(q.targetDepartmentIds),
  targetDesignationIds: normaliseIdArray(q.targetDesignationIds),
  targetRoleIds: normaliseIdArray(q.targetRoleIds),
  targetEmployeeIds: normaliseIdArray(q.targetEmployeeIds),
});

/**
 * GET /review-questions?level=INCHARGE|MANAGER|MANAGEMENT&includeInactive=true
 * Lists master review questions. When `level` is provided, only questions
 * whose `levels` array includes that level are returned.
 */
export const listReviewQuestions = async (req: Request, res: Response) => {
  try {
    const level = req.query.level as string | undefined;
    const includeInactive = req.query.includeInactive === "true";
    const appraisalId = req.query.appraisalId ? Number(req.query.appraisalId) : undefined;
    const where = includeInactive ? {} : { isActive: true };
    const all = await prisma.appraisalReviewQuestion.findMany({
      where,
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    });

    // When an appraisal is supplied, scope the master pool to the appraised
    // employee's department / designation / role / specific-employee targets.
    let subject: QuestionSubject | null = null;
    // Questions the reviewer has already answered for this appraisal must stay
    // visible even if they no longer match the scope (else a filled answer would
    // vanish). "Answered" = an answer row with a rating or non-empty comment.
    const answeredQuestionIds = new Set<number>();
    if (appraisalId && !Number.isNaN(appraisalId)) {
      const form = await prisma.appraisalForm.findUnique({
        where: { id: appraisalId },
        include: {
          employee: { select: { id: true, departmentId: true, designationId: true, roleId: true } },
        },
      });
      if (form?.employee) subject = form.employee;

      const answers = await prisma.appraisalReviewAnswer.findMany({
        where: { appraisalFormId: appraisalId, ...(level ? { level } : {}) },
        select: { questionId: true, rating: true, comments: true },
      });
      for (const a of answers) {
        if (a.rating != null || (a.comments && a.comments.trim() !== "")) {
          answeredQuestionIds.add(a.questionId);
        }
      }
    }

    const filtered = all.filter((q) => {
      // Already-answered questions for this appraisal/level are always kept, so a
      // filled-in answer never disappears if scope or levels later change.
      if (answeredQuestionIds.has(q.id)) return true;
      if (level && !normaliseLevels(q.levels).includes(level as ReviewLevel)) return false;
      if (subject && !questionAppliesToEmployee(q, subject)) return false;
      return true;
    });

    return res.json(filtered.map(shapeReviewQuestion));
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

/** POST /review-questions — create a master question. */
export const createReviewQuestion = async (req: Request, res: Response) => {
  try {
    const {
      title, description, prompts, aboveAverage, average, belowAverage,
      category, section, levels, displayOrder, isActive,
      targetDepartmentIds, targetDesignationIds, targetRoleIds, targetEmployeeIds,
    } = req.body || {};
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    const normalisedLevels = Array.isArray(levels) && levels.length
      ? (levels.filter(isReviewLevel) as ReviewLevel[])
      : [...REVIEW_LEVELS];

    const q = await prisma.appraisalReviewQuestion.create({
      data: {
        title: title.trim(),
        description: description ?? null,
        prompts: Array.isArray(prompts) ? (prompts as any) : null,
        aboveAverage: aboveAverage ?? null,
        average: average ?? null,
        belowAverage: belowAverage ?? null,
        category: category ?? null,
        section: section ?? null,
        levels: normalisedLevels as any,
        targetDepartmentIds: normaliseIdArray(targetDepartmentIds) as any,
        targetDesignationIds: normaliseIdArray(targetDesignationIds) as any,
        targetRoleIds: normaliseIdArray(targetRoleIds) as any,
        targetEmployeeIds: normaliseIdArray(targetEmployeeIds) as any,
        displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
        isActive: typeof isActive === "boolean" ? isActive : true,
      },
    });
    return res.json(shapeReviewQuestion(q));
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

/** PATCH /review-questions/:id — update a master question. */
export const updateReviewQuestion = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const {
      title, description, prompts, aboveAverage, average, belowAverage,
      category, section, levels, displayOrder, isActive,
      targetDepartmentIds, targetDesignationIds, targetRoleIds, targetEmployeeIds,
    } = req.body || {};

    const data: any = {};
    if (title !== undefined) data.title = String(title).trim();
    if (description !== undefined) data.description = description;
    if (prompts !== undefined) data.prompts = Array.isArray(prompts) ? prompts : null;
    if (aboveAverage !== undefined) data.aboveAverage = aboveAverage;
    if (average !== undefined) data.average = average;
    if (belowAverage !== undefined) data.belowAverage = belowAverage;
    if (category !== undefined) data.category = category;
    if (section !== undefined) data.section = section;
    if (levels !== undefined) {
      const arr = Array.isArray(levels) ? (levels.filter(isReviewLevel) as ReviewLevel[]) : [];
      data.levels = (arr.length ? arr : [...REVIEW_LEVELS]) as any;
    }
    if (targetDepartmentIds !== undefined) data.targetDepartmentIds = normaliseIdArray(targetDepartmentIds) as any;
    if (targetDesignationIds !== undefined) data.targetDesignationIds = normaliseIdArray(targetDesignationIds) as any;
    if (targetRoleIds !== undefined) data.targetRoleIds = normaliseIdArray(targetRoleIds) as any;
    if (targetEmployeeIds !== undefined) data.targetEmployeeIds = normaliseIdArray(targetEmployeeIds) as any;
    if (displayOrder !== undefined) data.displayOrder = Number(displayOrder);
    if (isActive !== undefined) data.isActive = !!isActive;

    const q = await prisma.appraisalReviewQuestion.update({ where: { id }, data });
    return res.json(shapeReviewQuestion(q));
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

/** PATCH /review-questions/:id/toggle — flip the isActive flag. */
export const toggleReviewQuestion = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.appraisalReviewQuestion.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: "Question not found" });
    const q = await prisma.appraisalReviewQuestion.update({
      where: { id },
      data: { isActive: !current.isActive },
    });
    return res.json(shapeReviewQuestion(q));
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

/**
 * DELETE /review-questions/:id — hard delete. If answers reference this
 * question we deactivate instead, to keep the audit trail.
 */
export const deleteReviewQuestion = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const referenced = await prisma.appraisalReviewAnswer.count({ where: { questionId: id } });
    if (referenced > 0) {
      const q = await prisma.appraisalReviewQuestion.update({
        where: { id }, data: { isActive: false },
      });
      return res.json({ deactivated: true, question: shapeReviewQuestion(q) });
    }
    await prisma.appraisalReviewQuestion.delete({ where: { id } });
    return res.json({ deleted: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// IN-CHARGE: SUBMIT REVIEW
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Persist an array of review answers for one (appraisal, level) bucket.
 * Used by the new In-charge / Manager / Management review flow.
 */
const saveReviewAnswers = async (
  appraisalId: number,
  level: ReviewLevel,
  answers: Array<{ questionId: number; rating?: number | null; comments?: string | null }>,
) => {
  for (const a of answers || []) {
    if (!a?.questionId) continue;
    await prisma.appraisalReviewAnswer.upsert({
      where: {
        appraisalFormId_questionId_level: {
          appraisalFormId: appraisalId,
          questionId: Number(a.questionId),
          level,
        },
      },
      create: {
        appraisalFormId: appraisalId,
        questionId: Number(a.questionId),
        level,
        rating: a.rating ?? null,
        comments: a.comments ?? null,
      },
      update: {
        rating: a.rating ?? null,
        comments: a.comments ?? null,
      },
    });
  }
};

/**
 * POST /:id/incharge-appraisal
 * Body: { answers: [{questionId, rating, comments}], overallScore?, comments?, recommendations?, isDraft? }
 * Authorized: the appraisal's in-charge only.
 */
export const submitInchargeAppraisal = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { answers, overallScore, comments, isDraft } = req.body || {};
    const callerEmpId = (req as any).user?.empId ?? null;

    const appraisal = await prisma.appraisalForm.findUnique({
      where: { id },
      include: { employee: { select: { departmentId: true, firstName: true, lastName: true, inchargeId: true } } },
    });
    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });

    const guard = await assertNotPausedOrHR(appraisal.employeeId, callerEmpId);
    if (guard.blocked) return res.status(423).json({ error: guard.message });

    // Fall back to the employee's current in-charge for appraisals created
    // before the snapshot field existed. Snapshot it now so subsequent calls
    // (and the table display) are consistent.
    const effectiveInchargeId = appraisal.inchargeId ?? appraisal.employee?.inchargeId ?? null;
    if (!effectiveInchargeId) {
      return res.status(400).json({ error: "This appraisal has no in-charge assigned" });
    }
    if (callerEmpId && Number(callerEmpId) !== effectiveInchargeId) {
      return res.status(403).json({ error: "Only the assigned in-charge can submit this review" });
    }
    if (!appraisal.inchargeId) {
      await prisma.appraisalForm.update({
        where: { id },
        data: { inchargeId: effectiveInchargeId },
      });
    }
    if (!["PENDING_FILL", "SELF_APPRAISAL_SUBMITTED"].includes(appraisal.status)) {
      return res.status(400).json({ error: "In-charge review cannot be submitted at this stage" });
    }

    // Gate: unlimited free edits before the due date; after it (or with no due
    // date) a re-edit needs an APPROVED edit request. Drafts are never gated.
    let inchargeGate: { allowed: boolean; message?: string; requestId?: number; request?: any } = { allowed: true };
    if (!isDraft) {
      inchargeGate = await resolveEditGate(id, "INCHARGE", appraisal);
      if (!inchargeGate.allowed) return res.status(400).json({ error: inchargeGate.message });
    }

    if (!Array.isArray(answers)) {
      return res.status(400).json({ error: "answers array is required" });
    }

    // Snapshot prior in-charge values for the audit trail before overwrite.
    const prevInchargeAnswers = await prisma.appraisalReviewAnswer.findMany({
      where: { appraisalFormId: id, level: "INCHARGE" },
    });
    const prevInchargeOverall = {
      inchargeOverallScore: appraisal.inchargeOverallScore,
      inchargeOverallComments: appraisal.inchargeOverallComments,
    };
    await saveReviewAnswers(id, "INCHARGE", answers);

    // Persist In-charge's supplementary summary (score + comments) on both
    // draft and submit. We DON'T touch appraisal.overallScore — that's the
    // final score the manager owns.
    const inchargeOverallScore = typeof overallScore === "number" ? overallScore : null;
    const inchargeOverallComments = typeof comments === "string" && comments.trim() ? comments : null;

    // Save the overall fields on every call (draft + submit) so resume-from-
    // draft works. The submittedAt timestamp is only set on the final submit.
    await prisma.appraisalForm.update({
      where: { id },
      data: { inchargeOverallScore, inchargeOverallComments },
    });

    if (!isDraft) {
      // If self + manager + management are already done, the in-charge is the
      // last gate → advance to HR_REVIEW. Otherwise stay PENDING_FILL.
      const selfDone = !!appraisal.selfAppraisalSubmittedAt;
      const managerDone = !!appraisal.managerAppraisalSubmittedAt;
      const managementDone = !!appraisal.managementAppraisalSubmittedAt;
      const newStatus = selfDone && managerDone && managementDone ? "HR_REVIEW" : appraisal.status;

      await prisma.appraisalForm.update({
        where: { id },
        data: {
          inchargeAppraisalSubmittedAt: new Date(),
          ...(newStatus !== appraisal.status ? { status: newStatus } : {}),
        },
      });

      // Audit trail: fill the request-based row, or log a free edit.
      const newInchargeAnswers = await prisma.appraisalReviewAnswer.findMany({
        where: { appraisalFormId: id, level: "INCHARGE" },
      });
      await recordAppraisalEdit({
        appraisalFormId: id,
        level: "INCHARGE",
        editedBy: Number(callerEmpId) || effectiveInchargeId,
        isEdit: !!appraisal.inchargeAppraisalSubmittedAt || !!inchargeGate.requestId,
        previousValues: { inchargeAnswers: prevInchargeAnswers, ...prevInchargeOverall },
        newValues: { inchargeAnswers: newInchargeAnswers, inchargeOverallScore, inchargeOverallComments },
        editReason: inchargeGate.request?.reason ?? null,
        approvedBy: inchargeGate.request?.approvedBy ?? null,
      });
      if (inchargeGate.requestId) {
        await prisma.appraisalEditRequest.update({
          where: { id: inchargeGate.requestId },
          data: { status: "COMPLETED" },
        });
      }

      // Notify the manager that it's their turn.
      const empName = `${appraisal.employee?.firstName ?? ""} ${appraisal.employee?.lastName ?? ""}`.trim();
      if (appraisal.managerId) {
        await createNotification(
          appraisal.managerId,
          `In-charge review submitted for ${empName} (${appraisal.cycle}). Please complete your manager review.`,
        );
      }
      await notifyHRTeam(appraisal.employee?.departmentId ?? 0,
        `In-charge review submitted for ${empName} (${appraisal.cycle}).`);
    }

    return res.json({ message: isDraft ? "In-charge review saved as draft" : "In-charge review submitted" });
  } catch (e: any) {
    console.error("submitInchargeAppraisal error:", e);
    return res.status(500).json({ error: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CRON: AUTO-CREATE APPRAISAL AT 11 MONTHS
// ═══════════════════════════════════════════════════════════════════════════════
export const initAppraisalAutoDraftCron = () => {
  cron.schedule("0 3 * * *", async () => {
    console.log("Running appraisal auto-draft cron...");
    try {
      const today = new Date();
      const employees = await prisma.employee.findMany({
        where: { employmentStatus: "ACTIVE" },
        select: { id: true, dateOfJoining: true, reportingManager: true },
      });

      let created = 0;

      for (const emp of employees) {
        const doj = new Date(emp.dateOfJoining);

        // EFFECTIVE months = calendar months elapsed minus the sum of any
        // EmployeeAppraisalPause windows (maternity, long medical leave …).
        // A 6-month pause delays the annual draft by 6 calendar months — the
        // cycle name still matches the employee's effective year.
        const effectiveMonths = await getEffectiveMonthsSinceJoining(emp.id, doj, today);

        // Eligible from 11 effective months. yearNum keeps the original
        // semantics: 11→Y1, 23→Y2, 35→Y3. The `existing` check below
        // prevents duplicates while we're inside an eligibility window.
        if (effectiveMonths >= 11) {
          const yearNum = Math.floor((effectiveMonths + 1) / 12);
          if (yearNum < 1) continue;
          const cycle = `Year ${yearNum} - Annual Review`;

          // Check if already exists
          const existing = await prisma.appraisalForm.findFirst({
            where: { employeeId: emp.id, cycle },
          });

          if (!existing) {
            const startDate = new Date(doj);
            startDate.setFullYear(startDate.getFullYear() + yearNum - 1);
            const endDate = new Date(startDate);
            endDate.setFullYear(endDate.getFullYear() + 1);

            await prisma.appraisalForm.create({
              data: {
                employeeId: emp.id,
                managerId: emp.reportingManager || null,
                cycle,
                status: "AUTO_DRAFT",
                appraisalStartDate: startDate,
                appraisalEndDate: endDate,
                dueDate: new Date(endDate.getTime() + 30 * 24 * 60 * 60 * 1000), // +30 days
              },
            });
            created++;
          }
        }
      }

      // Notify HR about new drafts
      if (created > 0) {
        const hrEmployees = await prisma.employee.findMany({
          where: { departmentId: 1, employmentStatus: "ACTIVE" },
          select: { id: true },
        });
        for (const hr of hrEmployees) {
          await createNotification(hr.id, `${created} new appraisal draft(s) created. Please verify and send to employees.`);
        }
      }

      console.log(`✅ Appraisal auto-draft: created ${created} drafts`);
    } catch (e) {
      console.error("❌ Appraisal auto-draft cron error:", e);
    }
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE INSIGHTS — incidents + weekly rating averages for appraisal period
// ═══════════════════════════════════════════════════════════════════════════════
export const getEmployeeInsights = async (req: Request, res: Response) => {
  try {
    const appraisalId = Number(req.params.id);
    const appraisal = await prisma.appraisalForm.findUnique({ where: { id: appraisalId } });
    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });

    const startDate = appraisal.appraisalStartDate || new Date(new Date().setFullYear(new Date().getFullYear() - 1));
    const endDate = appraisal.appraisalEndDate || new Date();

    // Pull pause windows so we can exclude incidents / ratings that fell
    // inside a maternity / sabbatical period.
    const pauses = await prisma.employeeAppraisalPause.findMany({
      where: {
        employeeId: appraisal.employeeId,
        startDate: { lte: endDate },
        OR: [{ endDate: null }, { endDate: { gte: startDate } }],
      },
      select: { startDate: true, endDate: true, reason: true },
    });
    const pausedDays = await getPausedDaysBetween(appraisal.employeeId, startDate, endDate);
    const isInPause = (d: Date) =>
      pauses.some(p => d >= p.startDate && d <= (p.endDate ?? endDate));

    // Incidents during the period (excluding paused windows)
    const incidentsRaw = await prisma.incident.findMany({
      where: {
        employeeId: appraisal.employeeId,
        createdAt: { gte: startDate, lte: endDate },
      },
      select: { id: true, title: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const incidents = incidentsRaw.filter(i => !isInPause(i.createdAt));

    // Weekly ratings during the period (excluding paused windows)
    const ratingsRaw = await prisma.weeklyPerformanceRating.findMany({
      where: {
        employeeId: appraisal.employeeId,
        status: "SUBMITTED",
        weekStartDate: { gte: startDate, lte: endDate },
      },
      select: { weekStartDate: true, weekLabel: true, overallScore: true },
      orderBy: { weekStartDate: "asc" },
    });
    const weeklyRatings = ratingsRaw.filter(r => !isInPause(r.weekStartDate));

    // Calculate monthly averages
    const monthlyMap: Record<string, { total: number; count: number }> = {};
    for (const r of weeklyRatings) {
      const d = new Date(r.weekStartDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!monthlyMap[key]) monthlyMap[key] = { total: 0, count: 0 };
      monthlyMap[key].total += r.overallScore || 0;
      monthlyMap[key].count++;
    }

    const monthlyAverages = Object.entries(monthlyMap)
      .map(([month, data]) => ({
        month,
        average: Math.round((data.total / data.count) * 10) / 10,
        count: data.count,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Overall average
    const overallAvg = weeklyRatings.length
      ? Math.round((weeklyRatings.reduce((s, r) => s + (r.overallScore || 0), 0) / weeklyRatings.length) * 10) / 10
      : null;

    return res.json({
      period: { start: startDate, end: endDate },
      pause: { totalDays: pausedDays, windows: pauses },
      incidents: { count: incidents.length, list: incidents },
      weeklyRatings: {
        totalWeeks: weeklyRatings.length,
        overallAverage: overallAvg,
        monthlyAverages,
        raw: weeklyRatings,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

import cron from "node-cron";
