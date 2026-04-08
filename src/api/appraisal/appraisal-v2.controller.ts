import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";

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

    const updated = await prisma.appraisalForm.update({
      where: { id },
      data: {
        status: "PENDING_FILL",
        appraisalStartDate: appraisalStartDate ? new Date(appraisalStartDate) : undefined,
        appraisalEndDate: appraisalEndDate ? new Date(appraisalEndDate) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        hrVerifiedBy: hrVerifiedBy ? Number(hrVerifiedBy) : null,
        hrVerifiedAt: new Date(),
      },
    });

    // Notify employee
    const empName = `${appraisal.employee.firstName} ${appraisal.employee.lastName}`;
    await createNotification(appraisal.employeeId, `Your appraisal for cycle "${appraisal.cycle}" has been initiated. Please complete your self-appraisal.`);

    // Notify manager — fill in parallel
    if (appraisal.managerId) {
      await createNotification(appraisal.managerId, `Appraisal initiated for ${empName} (${appraisal.cycle}). Please complete your manager review.`);
    }

    return res.json(updated);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE: SUBMIT SELF-APPRAISAL
// ═══════════════════════════════════════════════════════════════════════════════
export const submitSelfAppraisal = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { answers, achievements, goalsObjective, challenges, trainingNeeds, isDraft } = req.body;

    const appraisal = await prisma.appraisalForm.findUnique({ where: { id } });
    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });

    // Allow self-appraisal during PENDING_FILL or if already submitted (edit after approval)
    if (!["PENDING_FILL", "SELF_APPRAISAL_PENDING", "HR_VERIFIED"].includes(appraisal.status)) {
      return res.status(400).json({ error: "Self-appraisal cannot be submitted at this stage" });
    }

    // Check due date (allow drafts even after due date)
    if (!isDraft && appraisal.dueDate && new Date(appraisal.dueDate) < new Date()) {
      return res.status(400).json({ error: "Due date has passed. You can no longer submit self-appraisal." });
    }

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
      // All three must submit → HR_REVIEW
      const managerAlreadySubmitted = !!appraisal.managerAppraisalSubmittedAt;
      const managementAlreadySubmitted = !!appraisal.managementAppraisalSubmittedAt;
      const allSubmitted = managerAlreadySubmitted && managementAlreadySubmitted;
      const newStatus = allSubmitted ? "HR_REVIEW" : "PENDING_FILL";

      await prisma.appraisalForm.update({
        where: { id },
        data: {
          selfAppraisalSubmittedAt: new Date(),
          status: newStatus,
        },
      });

      // Update edit history with new values (if this is a re-submission after edit approval)
      const latestEditHistory = await prisma.appraisalEditHistory.findFirst({
        where: { appraisalFormId: id, editType: "SELF_APPRAISAL", newValues: { equals: {} } },
        orderBy: { editedAt: "desc" },
      });
      if (latestEditHistory) {
        const selfData = await prisma.selfAppraisal.findUnique({ where: { appraisalFormId: id } });
        const answerData = await prisma.selfAppraisalAnswer.findMany({ where: { appraisalFormId: id } });
        await prisma.appraisalEditHistory.update({
          where: { id: latestEditHistory.id },
          data: { newValues: { selfAppraisal: selfData, answers: answerData } },
        });
      }

      // Notify HR
      const hrEmployees = await prisma.employee.findMany({
        where: { departmentId: 1, employmentStatus: "ACTIVE" },
        select: { id: true },
      });

      if (allSubmitted) {
        for (const hr of hrEmployees) {
          await createNotification(hr.id, `All appraisal sections submitted for appraisal #${id} (${appraisal.cycle}). Please review.`);
        }
      } else {
        for (const hr of hrEmployees) {
          await createNotification(hr.id, `Self-appraisal submitted for appraisal #${id} (${appraisal.cycle}).`);
        }
      }
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

    const appraisal = await prisma.appraisalForm.findUnique({ where: { id } });
    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });

    // Allow manager to fill during PENDING_FILL (parallel) or after self-appraisal submitted
    if (!["PENDING_FILL", "SELF_APPRAISAL_SUBMITTED", "MANAGER_APPRAISAL_PENDING", "MANAGER_APPRAISAL_SUBMITTED"].includes(appraisal.status)) {
      return res.status(400).json({ error: "Manager appraisal cannot be submitted at this stage" });
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
      const allSubmitted = selfAlreadySubmitted && managementAlreadySubmitted;
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

      // Update edit history with new values (if re-submission after edit approval)
      const latestMgrEditHistory = await prisma.appraisalEditHistory.findFirst({
        where: { appraisalFormId: id, editType: "MANAGER_APPRAISAL", newValues: { equals: {} } },
        orderBy: { editedAt: "desc" },
      });
      if (latestMgrEditHistory) {
        const mgrData = await prisma.managerAppraisal.findUnique({ where: { appraisalFormId: id } });
        await prisma.appraisalEditHistory.update({
          where: { id: latestMgrEditHistory.id },
          data: { newValues: { managerAppraisal: mgrData } },
        });
      }

      const hrEmployees = await prisma.employee.findMany({
        where: { departmentId: 1, employmentStatus: "ACTIVE" },
        select: { id: true },
      });
      if (allSubmitted) {
        for (const hr of hrEmployees) {
          await createNotification(hr.id, `All appraisal sections submitted for appraisal #${id} (${appraisal.cycle}). Please review.`);
        }
      } else {
        for (const hr of hrEmployees) {
          await createNotification(hr.id, `Manager review submitted for appraisal #${id} (${appraisal.cycle}).`);
        }
      }
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

    const appraisal = await prisma.appraisalForm.findUnique({ where: { id } });
    if (!appraisal) return res.status(404).json({ error: "Appraisal not found" });

    if (!["PENDING_FILL", "SELF_APPRAISAL_PENDING", "MANAGER_APPRAISAL_PENDING", "MANAGER_APPRAISAL_SUBMITTED"].includes(appraisal.status)) {
      return res.status(400).json({ error: "Management appraisal cannot be submitted at this stage" });
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
      const allSubmitted = selfAlreadySubmitted && managerAlreadySubmitted;
      const newStatus = allSubmitted ? "HR_REVIEW" : "PENDING_FILL";

      await prisma.appraisalForm.update({
        where: { id },
        data: { status: newStatus, managementAppraisalSubmittedAt: new Date() },
      });

      // Update edit history newValues if this is re-submission after edit approval
      const latestMgmtEditHistory = await prisma.appraisalEditHistory.findFirst({
        where: { appraisalFormId: id, editType: "MANAGEMENT_APPRAISAL", newValues: { equals: {} } },
        orderBy: { editedAt: "desc" },
      });
      if (latestMgmtEditHistory) {
        const mgmtData = await prisma.managementAppraisal.findUnique({ where: { appraisalFormId: id } });
        await prisma.appraisalEditHistory.update({
          where: { id: latestMgmtEditHistory.id },
          data: { newValues: { managementAppraisal: mgmtData } },
        });
      }

      const hrEmployees = await prisma.employee.findMany({
        where: { departmentId: 1, employmentStatus: "ACTIVE" },
        select: { id: true },
      });
      if (allSubmitted) {
        for (const hr of hrEmployees) {
          await createNotification(hr.id, `All appraisal sections submitted for appraisal #${id} (${appraisal.cycle}). Please review.`);
        }
      } else {
        for (const hr of hrEmployees) {
          await createNotification(hr.id, `Management review submitted for appraisal #${id} (${appraisal.cycle}).`);
        }
      }
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
    if (!["SELF", "MANAGER", "MANAGEMENT"].includes(requestType)) return res.status(400).json({ error: "requestType must be SELF, MANAGER, or MANAGEMENT" });

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
    const typeLabel = requestType === "SELF" ? "self-appraisal" : "manager review";
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
    const typeLabel = editReq.requestType === "SELF" ? "self-appraisal" : editReq.requestType === "MANAGER" ? "manager review" : "management review";

    if (action === "APPROVE") {
      // Save current values as edit history snapshot
      const appraisal = editReq.appraisalForm;
      let previousValues: any = {};

      if (editReq.requestType === "SELF") {
        const selfData = await prisma.selfAppraisal.findUnique({ where: { appraisalFormId: appraisal.id } });
        const answers = await prisma.selfAppraisalAnswer.findMany({ where: { appraisalFormId: appraisal.id } });
        previousValues = { selfAppraisal: selfData, answers };
      } else if (editReq.requestType === "MANAGER") {
        const managerData = await prisma.managerAppraisal.findUnique({ where: { appraisalFormId: appraisal.id } });
        previousValues = { managerAppraisal: managerData };
      } else {
        const mgmtData = await prisma.managementAppraisal.findUnique({ where: { appraisalFormId: appraisal.id } });
        previousValues = { managementAppraisal: mgmtData };
      }

      const editTypeMap: Record<string, string> = { SELF: "SELF_APPRAISAL", MANAGER: "MANAGER_APPRAISAL", MANAGEMENT: "MANAGEMENT_APPRAISAL" };

      await prisma.appraisalEditHistory.create({
        data: {
          appraisalFormId: appraisal.id,
          editedBy: editReq.requestedBy,
          editType: editTypeMap[editReq.requestType] || "MANAGER_APPRAISAL",
          previousValues,
          newValues: {},
          editReason: editReq.reason,
          approvedBy: approvedBy ? Number(approvedBy) : null,
        },
      });

      const clearData: any = { status: "PENDING_FILL" };
      if (editReq.requestType === "SELF") {
        clearData.selfAppraisalSubmittedAt = null;
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

    const result = { ...appraisal, editRequests: enrichedEditRequests };

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
        const monthsSinceJoining = (today.getFullYear() - doj.getFullYear()) * 12 + (today.getMonth() - doj.getMonth());

        // Create appraisal at 11 months, 23 months, 35 months, etc.
        if (monthsSinceJoining >= 11 && monthsSinceJoining % 12 === 11) {
          const yearNum = Math.floor(monthsSinceJoining / 12) + 1;
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

    // Incidents during the period
    const incidents = await prisma.incident.findMany({
      where: {
        employeeId: appraisal.employeeId,
        createdAt: { gte: startDate, lte: endDate },
      },
      select: { id: true, title: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    // Weekly ratings during the period
    const weeklyRatings = await prisma.weeklyPerformanceRating.findMany({
      where: {
        employeeId: appraisal.employeeId,
        status: "SUBMITTED",
        weekStartDate: { gte: startDate, lte: endDate },
      },
      select: { weekStartDate: true, weekLabel: true, overallScore: true },
      orderBy: { weekStartDate: "asc" },
    });

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
