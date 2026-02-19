import { Request, Response } from "express";
// import { PrismaClient } from "@prisma/client";
import cron from "node-cron";
import { EmploymentStatus } from "@prisma/client";

// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";

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
// export async function submitSurvey(req: Request, res: Response) {
//   try {
//     const { employeeId, answers } = req.body;

//     if (!employeeId || !Array.isArray(answers) || !answers.length) {
//       return res
//         .status(400)
//         .json({ error: "employeeId and answers[] are required" });
//     }

//     const survey = await prisma.employeeSurvey.create({
//         data: {
//           date: new Date(),
//           submittedAt: new Date(),
//           status: "SUBMITTED",
//           employee: {
//             connect: { id: Number(employeeId) } // or the correct unique field
//           },
//           responses: {
//             create: answers.map((a: any) => ({
//               questionId: a.questionId,
//               answer: a.answer,
//             })),
//           },
//         },
//       });
      

//     return res.json({ success: true, surveyId: survey.id });
//   } catch (e: any) {
//     console.error("submitSurvey error:", e);
//     return res
//       .status(500)
//       .json({ error: e?.message || "Failed to submit survey" });
//   }
// }
export async function submitSurvey(req: Request, res: Response) {
  try {
    const { surveyId, employeeId, answers } = req.body;

    if (!surveyId || !employeeId || !Array.isArray(answers) || !answers.length) {
      return res.status(400).json({ error: "surveyId, employeeId and answers[] are required" });
    }

    // 1️⃣ Check if survey exists and is still DRAFT
    const survey = await prisma.employeeSurvey.findUnique({
      where: { id: Number(surveyId) },
    });

    if (!survey) {
      return res.status(404).json({ error: "Survey not found" });
    }

    if (survey.status !== "DRAFT") {
      return res.status(400).json({ error: "Survey already submitted" });
    }

    // 2️⃣ Update survey + create responses
    const updatedSurvey = await prisma.employeeSurvey.update({
      where: { id: Number(surveyId) },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        responses: {
          create: answers.map((a: any) => ({
            questionId: a.questionId,
            answer: a.answer,
          })),
        },
      },
    });
    // 3️⃣ Notify HR
    try {
      // get employee details
      const emp = await prisma.employee.findUnique({
        where: { id: Number(employeeId) },
        select: {
          firstName: true,
          lastName: true,
          employeeCode: true,
        },
      });

      if (emp) {
        const hrIds = await getHRIds();
        const empName = `${emp.firstName} ${emp.lastName}`;
        const message = `Survey submitted by ${empName} (${emp.employeeCode}).`;

        // for (const hrId of hrIds) {
        //   await createNotification(hrId, message);
        // }
      }
    } catch (err) {
      console.error("Survey notification failed:", err);
    }
    return res.json({
      success: true,
      surveyId: updatedSurvey.id,
      message: "Survey submitted successfully",
    });

  } catch (e: any) {
    console.error("submitSurvey error:", e);
    return res.status(500).json({ error: e.message || "Failed to submit survey" });
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
            gender: true,
            photoUrl: true,
            Department: {   // ✅ use the relation name from schema
              select: { name: true }
            }
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
/**
 * Runs every day at midnight
 * Creates surveys for employees whose next survey date == today
 */
export const initSurveyScheduler = () => {
  cron.schedule("0 0 * * *", async () => {
    console.log("🕐 Running 6-month Employee Survey Scheduler...");

    try {
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0]; // YYYY-MM-DD

      // Get all active employees
      const activeEmployees = await prisma.employee.findMany({
        where: { employmentStatus: "ACTIVE" },
        select: { id: true, dateOfJoining: true, firstName: true, lastName: true },
      });

      for (const emp of activeEmployees) {
        // 1️⃣ Get the latest survey
        const lastSurvey = await prisma.employeeSurvey.findFirst({
          where: { employeeId: emp.id },
          orderBy: { date: "desc" },
        });

        // 2️⃣ Determine reference date
        const referenceDate = lastSurvey
          ? new Date(lastSurvey.date)
          : new Date(emp.dateOfJoining);

        // 3️⃣ Calculate the exact next due date
        const nextSurveyDate = new Date(referenceDate);
        nextSurveyDate.setMonth(nextSurveyDate.getMonth() + 6);

        const nextSurveyStr = nextSurveyDate.toISOString().split("T")[0];

        // 4️⃣ If today == nextSurveyDate (by date only, not time)
        if (todayStr === nextSurveyStr) {
          await prisma.employeeSurvey.create({
            data: {
              employeeId: emp.id,
              date: new Date(),
              status: "DRAFT",
            },
          });
          console.log(`✅ Created new survey for employee ${emp.id}`);
            // 🔔 Notify employee
          try {
            const empName = `${emp.firstName} ${emp.lastName}`;
            const message = `${empName}, your 6-month employee survey is now available. Please complete it at your earliest convenience.`;

            // await createNotification(emp.id, message);
          } catch (err) {
            console.error(`Notification failed for employee ${emp.id}:`, err);
          }
        }
      }

      console.log("🎯 Employee survey scheduling complete.");
    } catch (error) {
      console.error("❌ Error running survey scheduler:", error);
    }
  });
};
// ================== GET DRAFT SURVEYS (BY EMPLOYEE) ==================
export async function getDraftSurveys(req: Request, res: Response) {
  try {
    const employeeId = Number(req.query.employeeId);

    if (!employeeId || Number.isNaN(employeeId)) {
      return res.status(400).json({ error: "Invalid or missing employeeId" });
    }

    const drafts = await prisma.employeeSurvey.findMany({
      where: {
        employeeId,
        status: "DRAFT",
      },
      include: {
        responses: { include: { question: true } },
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            Department: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(drafts);
  } catch (error: any) {
    console.error("getDraftSurveys error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to fetch draft surveys" });
  }
}
async function getHRIds(): Promise<number[]> {
  const hrs = await prisma.employee.findMany({
    where: {
      departmentId: 1,
      employmentStatus: 'ACTIVE'
    },
    select: { id: true }
  });

  return hrs.map(h => h.id);
}