import { Request, Response } from "express";
// import { PrismaClient } from "@prisma/client";

// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";

// Create a template
export const createTemplate = async (req: Request, res: Response) => {
  try {
    const { departmentId, cycle, questions } = req.body;
    const template = await prisma.performanceFormTemplate.create({
      data: {
        departmentId,
        cycle,
        questions: { create: questions }
      },
      include: { questions: true }
    });
    res.json(template);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// Fetch template
export const getTemplateByDept = async (req: Request, res: Response) => {
  try {
    const { departmentId, cycle } = req.params; // or req.query if you switched
    const template = await prisma.performanceFormTemplate.findFirst({
      where: { departmentId: Number(departmentId), cycle },
      include: {
        questions: true,
        department: true   // 👈 include department details
      }
    });
    res.json(template);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};


// Submit per-question responses
export const submitResponses = async (req: Request, res: Response) => {
  try {
    const { employeeId, departmentId, cycle, responses } = req.body;
    await prisma.performanceResponse.createMany({
      data: responses.map((r: any) => ({
        employeeId,
        departmentId,
        cycle,
        questionId: r.questionId,
        period: r.period,
        score: r.score,
        reviewerId: r.reviewerId,
        comments: r.comments
      }))
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// Submit summary
export const submitSummary = async (req: Request, res: Response) => {
  try {
    const { employeeId, departmentId, cycle, summaries } = req.body;
    await prisma.performanceSummary.createMany({
      data: summaries.map((s: any) => ({
        employeeId,
        departmentId,
        cycle,
        period: s.period,
        marksScored: s.marksScored,
        overallPerf: s.overallPerf,
        employeeSig: s.employeeSig,
        supervisorSig: s.supervisorSig,
        hodSig: s.hodSig
      }))
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

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
export const getEmployeeForm = async (req: Request, res: Response) => {
  try {
    const { employeeId, departmentId, cycle } = req.params;

    const template = await prisma.performanceFormTemplate.findFirst({
      where: { departmentId: Number(departmentId), cycle },
      include: { questions: true, department: true }
    });

    if (!template) return res.status(404).json({ error: "Template not found" });

    const employee = await prisma.employee.findUnique({
      where: { id: Number(employeeId) },
      include: { Department: true }
    });

    const responses = await prisma.performanceResponse.findMany({
      where: { employeeId: Number(employeeId), departmentId: Number(departmentId), cycle }
    });

    const summaries = await prisma.performanceSummary.findMany({
      where: { employeeId: Number(employeeId), departmentId: Number(departmentId), cycle }
    });

    const finalReview = await prisma.performanceFinalReview.findFirst({
      where: { employeeId: Number(employeeId), departmentId: Number(departmentId), cycle }
    });

    res.json({
      template,
      employee,   // 👈 added
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

    // 1) Save question responses
    if (data.responses?.length) {
      await prisma.performanceResponse.createMany({
        data: data.responses.map((r: any) => ({
          employeeId: data.employeeId,
          departmentId: data.departmentId,
          cycle: data.cycle,
          questionId: r.questionId,
          period: r.period,
          score: r.score,
          reviewerId: r.reviewerId,
          comments: r.comments
        }))
      });
    }

    // 2) Save overall summaries
    if (data.summaries?.length) {
      await prisma.performanceSummary.createMany({
        data: data.summaries.map((s: any) => ({
          employeeId: data.employeeId,
          departmentId: data.departmentId,
          cycle: data.cycle,
          period: s.period,
          marksScored: s.marksScored,
          overallPerf: s.overallPerf,
          employeeSig: s.employeeSig,
          supervisorSig: s.supervisorSig,
          hodSig: s.hodSig
        }))
      });
    }

    if (!data.finalReview) {
      // get employee info
      const employee = await prisma.employee.findUnique({
        where: { id: data.employeeId },
        select: { firstName: true, lastName: true, employeeCode: true }
      });

      const employeeName = employee
        ? `${employee.firstName} ${employee.lastName}`
        : `Employee #${data.employeeCode}`;

      // get HR employees (departmentId = 1 OR roleId = HR)
      const hrUsers = await prisma.employee.findMany({
        where: {
          departmentId: 1, // adjust if your HR dept id is different
          employmentStatus: 'ACTIVE'
        },
        select: { id: true }
      });

      const hrIds = hrUsers.map(u => u.id);

      const messages = `HOD has submitted appraisal for ${employeeName} for ${data.cycle} – ${data.summaries[0].period}. Please review`;

      if (hrIds.length) {
        for (const hrId of hrIds) {
          await createNotification(hrId, messages)
        }
      }
    }

    // 3) Save final review
    if (data.finalReview) {
      await prisma.performanceFinalReview.create({
        data: {
          employeeId: data.employeeId,
          departmentId: data.departmentId,
          cycle: data.cycle,
          appreciations: data.finalReview.appreciations,
          talents: data.finalReview.talents,
          overallComments: data.finalReview.overallComments,
          employeeSig: data.finalReview.employeeSig,
          supervisorSig: data.finalReview.supervisorSig,
          hrSig: data.finalReview.hrSig
        }
      });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const assignFormToEmployee = async (req: Request, res: Response) => {
  try {
    const { employeeId, employeeIds, departmentId, cycle, period } = req.body;

    const ids = employeeIds || (employeeId ? [employeeId] : []);
    if (!ids.length) {
      return res.status(400).json({ error: "No employees provided" });
    }

    const results = [];
    for (const id of ids) {
      // check if already assigned
      const exists = await prisma.performanceSummary.findFirst({
        where: { employeeId: id, departmentId, cycle, period }
      });

      if (!exists) {
        const summary = await prisma.performanceSummary.create({
          data: {
            employeeId: id,
            departmentId,
            cycle,
            period
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


// Get all summaries with employee & department
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
        }
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(summaries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};