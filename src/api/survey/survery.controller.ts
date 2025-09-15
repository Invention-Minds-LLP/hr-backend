import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ================== GET QUESTIONS ==================
export async function getSurveyQuestions(req: Request, res: Response) {
  try {
    const questions = await prisma.surveyQuestion.findMany({
      orderBy: { orderNo: "asc" },
    });
    return res.json(questions);
  } catch (e: any) {
    console.error("getSurveyQuestions error:", e);
    return res
      .status(500)
      .json({ error: e?.message || "Failed to fetch questions" });
  }
}

// ================== SUBMIT SURVEY ==================
export async function submitSurvey(req: Request, res: Response) {
  try {
    const { employeeId, answers } = req.body;

    if (!employeeId || !Array.isArray(answers) || !answers.length) {
      return res
        .status(400)
        .json({ error: "employeeId and answers[] are required" });
    }

    const survey = await prisma.employeeSurvey.create({
        data: {
          date: new Date(),
          employee: {
            connect: { id: Number(employeeId) } // or the correct unique field
          },
          responses: {
            create: answers.map((a: any) => ({
              questionId: a.questionId,
              answer: a.answer,
            })),
          },
        },
      });
      

    return res.json({ success: true, surveyId: survey.id });
  } catch (e: any) {
    console.error("submitSurvey error:", e);
    return res
      .status(500)
      .json({ error: e?.message || "Failed to submit survey" });
  }
}

// ================== GET SURVEY RESULTS ==================
export async function getSurveyResults(req: Request, res: Response) {
  try {
    const surveyId = Number(req.params.surveyId);
    if (Number.isNaN(surveyId)) {
      return res.status(400).json({ error: "Invalid surveyId" });
    }

    const survey = await prisma.employeeSurvey.findUnique({
      where: { id: surveyId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            departmentId: true,
            designation: true,
          },
        },
        responses: { include: { question: true } },
      },
    });

    if (!survey) return res.status(404).json({ error: "Survey not found" });
    return res.json(survey);
  } catch (e: any) {
    console.error("getSurveyResults error:", e);
    return res
      .status(500)
      .json({ error: e?.message || "Failed to fetch survey" });
  }
}

// ================== ADMIN: ALL SURVEYS ==================
export async function getAllSurveys(_req: Request, res: Response) {
  try {
    const all = await prisma.employeeSurvey.findMany({
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            departmentId: true,
          },
        },
        responses: { include: { question: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json(all);
  } catch (e: any) {
    console.error("getAllSurveys error:", e);
    return res
      .status(500)
      .json({ error: e?.message || "Failed to fetch surveys" });
  }
}
