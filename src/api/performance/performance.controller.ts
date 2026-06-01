import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";

// Create a template
export const createTemplate = async (req: Request, res: Response) => {
  try {
    const { departmentId, cycle, title, questions } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    const template = await prisma.performanceFormTemplate.create({
      data: {
        departmentId,
        cycle,
        title: String(title).trim(),
        questions: { create: questions }
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
    const { title, questions } = req.body as {
      title?: string;
      questions?: Array<{ category: string; text: string; orderNo: number; weight?: number | null }>;
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
      if (title !== undefined) {
        await tx.performanceFormTemplate.update({
          where: { id },
          data: { title: String(title).trim() || 'Default' },
        });
      }
      if (Array.isArray(questions)) {
        await tx.performanceQuestion.deleteMany({ where: { templateId: id } });
        if (questions.length) {
          await tx.performanceQuestion.createMany({
            data: questions.map((q, i) => ({
              templateId: id,
              category: q.category,
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

// List templates for a department + cycle so HR can pick by name.
export const listTemplatesByDept = async (req: Request, res: Response) => {
  try {
    const { departmentId, cycle } = req.query as { departmentId?: string; cycle?: string };
    if (!departmentId) return res.status(400).json({ error: "departmentId is required" });

    const templates = await prisma.performanceFormTemplate.findMany({
      where: {
        departmentId: Number(departmentId),
        ...(cycle ? { cycle } : {})
      },
      orderBy: [{ cycle: 'desc' }, { title: 'asc' }],
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
    await prisma.$transaction(
      (responses || []).map((r: any) =>
        prisma.performanceResponse.upsert({
          where: {
            employeeId_cycle_period_questionId: {
              employeeId,
              cycle,
              period: r.period,
              questionId: r.questionId,
            },
          },
          create: {
            employeeId,
            departmentId,
            cycle,
            questionId: r.questionId,
            period: r.period,
            score: r.score,
            reviewerId: r.reviewerId,
            comments: r.comments,
          },
          update: {
            score: r.score,
            reviewerId: r.reviewerId,
            comments: r.comments,
          },
        })
      )
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// Submit summary — idempotent per (employee, cycle, period, templateId)
export const submitSummary = async (req: Request, res: Response) => {
  try {
    const { employeeId, departmentId, cycle, templateId, summaries } = req.body;
    const tid: number | null = templateId ?? null;
    await prisma.$transaction(async (tx) => {
      for (const s of (summaries || [])) {
        await upsertSummary(tx, { employeeId, departmentId, cycle, templateId: tid, summary: s });
      }
    });
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

// Submit final review
export const submitFinalReview = async (req: Request, res: Response) => {
  try {
    const { employeeId, departmentId, cycle, appreciations, talents, overallComments, employeeSig, supervisorSig, hrSig } = req.body;
    const review = await prisma.performanceFinalReview.create({
      data: { employeeId, departmentId, cycle, appreciations, talents, overallComments, employeeSig, supervisorSig, hrSig }
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

    const finalReview = await prisma.performanceFinalReview.findFirst({
      where: { employeeId: Number(employeeId), departmentId: Number(departmentId), ...(cycle ? { cycle } : {}) }
    });

    res.json({
      template,
      employee,
      responses,
      summaries,
      finalReview
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const submitFullForm = async (req: Request, res: Response) => {
  try {
    const data = req.body as any;
    const templateId: number | null = data.templateId ?? null;

    await prisma.$transaction(async (tx) => {
      // 1) Upsert per-question responses (idempotent on re-submit)
      if (data.responses?.length) {
        for (const r of data.responses) {
          await tx.performanceResponse.upsert({
            where: {
              employeeId_cycle_period_questionId: {
                employeeId: data.employeeId,
                cycle: data.cycle,
                period: r.period,
                questionId: r.questionId,
              },
            },
            create: {
              employeeId: data.employeeId,
              departmentId: data.departmentId,
              cycle: data.cycle,
              questionId: r.questionId,
              period: r.period,
              score: r.score,
              reviewerId: r.reviewerId,
              comments: r.comments,
            },
            update: {
              score: r.score,
              reviewerId: r.reviewerId,
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

      // 3) Final review (one per cycle+employee)
      if (data.finalReview) {
        const existing = await tx.performanceFinalReview.findFirst({
          where: {
            employeeId: data.employeeId,
            departmentId: data.departmentId,
            cycle: data.cycle,
          },
        });
        if (existing) {
          await tx.performanceFinalReview.update({
            where: { id: existing.id },
            data: {
              appreciations: data.finalReview.appreciations,
              talents: data.finalReview.talents,
              overallComments: data.finalReview.overallComments,
              employeeSig: data.finalReview.employeeSig,
              supervisorSig: data.finalReview.supervisorSig,
              hrSig: data.finalReview.hrSig,
            },
          });
        } else {
          await tx.performanceFinalReview.create({
            data: {
              employeeId: data.employeeId,
              departmentId: data.departmentId,
              cycle: data.cycle,
              appreciations: data.finalReview.appreciations,
              talents: data.finalReview.talents,
              overallComments: data.finalReview.overallComments,
              employeeSig: data.finalReview.employeeSig,
              supervisorSig: data.finalReview.supervisorSig,
              hrSig: data.finalReview.hrSig,
            },
          });
        }
      }
    });

    // 4) Notify HR when summaries are submitted without a final review yet.
    if (!data.finalReview && data.summaries?.length) {
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

export const assignFormToEmployee = async (req: Request, res: Response) => {
  try {
    const { employeeId, employeeIds, departmentId, cycle, period, templateId } = req.body;

    if (!templateId) return res.status(400).json({ error: "templateId is required" });

    const template = await prisma.performanceFormTemplate.findUnique({ where: { id: Number(templateId) } });
    if (!template) return res.status(404).json({ error: "Template not found" });
    if (template.departmentId !== Number(departmentId)) {
      return res.status(400).json({ error: "Template does not belong to the selected department" });
    }
    if (template.cycle !== cycle) {
      return res.status(400).json({ error: "Template cycle does not match" });
    }

    const ids = employeeIds || (employeeId ? [employeeId] : []);
    if (!ids.length) {
      return res.status(400).json({ error: "No employees provided" });
    }

    const results = [];
    for (const id of ids) {
      const exists = await prisma.performanceSummary.findFirst({
        where: { employeeId: id, departmentId, cycle, period, templateId: Number(templateId) }
      });

      if (!exists) {
        const summary = await prisma.performanceSummary.create({
          data: {
            employeeId: id,
            departmentId,
            cycle,
            period,
            templateId: Number(templateId),
          }
        });
        results.push({ employeeId: id, assigned: true, summary });
      } else {
        results.push({ employeeId: id, assigned: false, message: "Already assigned" });
      }
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
    if (template.cycle !== summary.cycle) {
      return res.status(400).json({ error: 'Template cycle does not match summary cycle' });
    }

    const responseCount = await prisma.performanceResponse.count({
      where: {
        employeeId: summary.employeeId,
        cycle: summary.cycle,
      },
    });
    if (responseCount > 0) {
      return res.status(409).json({
        error: 'This row already has recorded responses and the template cannot be reassigned.',
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


// Get all summaries with employee & department + template title for display
export const getAllSummaries = async (req: Request, res: Response) => {
  try {
    const summaries = await prisma.performanceSummary.findMany({
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
          select: { id: true, name: true }
        },
        template: {
          select: { id: true, title: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(summaries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
