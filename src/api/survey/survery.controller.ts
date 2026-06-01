import { Request, Response } from "express";
// import { PrismaClient } from "@prisma/client";
import cron from "node-cron";
import { EmploymentStatus } from "@prisma/client";

// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";

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
export async function submitSurvey(req: AuthenticatedRequest, res: Response) {
  try {
    const { surveyId, answers } = req.body;

    const tokenEmpId = Number(req.user?.empId ?? 0);
    if (!tokenEmpId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!surveyId || !Array.isArray(answers) || !answers.length) {
      return res.status(400).json({ error: "surveyId and answers[] are required" });
    }

    // 1️⃣ Check if survey exists and is still DRAFT
    const survey = await prisma.employeeSurvey.findUnique({
      where: { id: Number(surveyId) },
    });

    if (!survey) {
      return res.status(404).json({ error: "Survey not found" });
    }

    // Ownership: only the survey's own employee may submit it.
    if (survey.employeeId !== tokenEmpId) {
      return res.status(403).json({ error: "Forbidden: survey does not belong to you" });
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
        where: { id: tokenEmpId },
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

        for (const hrId of hrIds) {
          await createNotification(hrId, message);
        }
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

        // 4️⃣ If the next survey date is today or already past (catch-up for
        //    missed cron runs). Safe against duplicates: once a DRAFT exists,
        //    lastSurvey.date is that DRAFT's date, so the next due is 6 months
        //    out and the condition won't re-fire.
        if (nextSurveyStr <= todayStr) {
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

            await createNotification(emp.id, message);
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

// ====================================================================
// ============== HR SURVEY ANALYTICS DASHBOARD =======================
// ====================================================================
//
// Likert encoding used everywhere below:
//   "Fully Agree"        = 4
//   "Mostly Agree"       = 3
//   "Mostly Disagree"    = 2
//   "Strongly Disagree"  = 1
// "% positive" = agree-side / total;  "% negative" = disagree-side / total.
// Only SUBMITTED surveys feed analytics; DRAFTS only feed the Pending tab.

type Likert = "Fully Agree" | "Mostly Agree" | "Mostly Disagree" | "Strongly Disagree";

const SECTION_TITLES: Record<string, string> = {
  A: "Job Satisfaction",
  B: "Satisfaction with the Work",
  C: "Coworker Performance / Cooperation",
  D: "Pay and Benefits Satisfaction",
  E: "Promotions / Career Advancement",
  F: "Supervisory Consideration",
  G: "Supervisory Promotion of Team Work",
  H: "Communication",
  I: "Productivity / Efficiency",
  J: "Training & Development",
  K: "Concern for Patient Care / Customer Service",
  L: "Strategy / Mission",
};

function scoreOf(answer: string): number {
  switch (answer) {
    case "Fully Agree": return 4;
    case "Mostly Agree": return 3;
    case "Mostly Disagree": return 2;
    case "Strongly Disagree": return 1;
    default: return 0;
  }
}

function emptyCounts() {
  return { fullyAgree: 0, mostlyAgree: 0, mostlyDisagree: 0, stronglyDisagree: 0 };
}

function bump(c: ReturnType<typeof emptyCounts>, answer: string) {
  switch (answer) {
    case "Fully Agree": c.fullyAgree++; break;
    case "Mostly Agree": c.mostlyAgree++; break;
    case "Mostly Disagree": c.mostlyDisagree++; break;
    case "Strongly Disagree": c.stronglyDisagree++; break;
  }
}

function totalsFrom(c: ReturnType<typeof emptyCounts>) {
  const total = c.fullyAgree + c.mostlyAgree + c.mostlyDisagree + c.stronglyDisagree;
  const positive = c.fullyAgree + c.mostlyAgree;
  const negative = c.mostlyDisagree + c.stronglyDisagree;
  const sum = c.fullyAgree * 4 + c.mostlyAgree * 3 + c.mostlyDisagree * 2 + c.stronglyDisagree * 1;
  const avgScore = total ? +(sum / total).toFixed(2) : 0;
  const pctPositive = total ? +((positive / total) * 100).toFixed(1) : 0;
  const pctNegative = total ? +((negative / total) * 100).toFixed(1) : 0;
  return { total, positive, negative, avgScore, pctPositive, pctNegative };
}

/**
 * Parse the shared filter query string. All filters are optional.
 * Filters apply to surveys joined through their employee.
 */
function parseFilters(req: Request) {
  const q = req.query;
  const from = q.from ? new Date(String(q.from)) : undefined;
  const to = q.to ? new Date(String(q.to)) : undefined;
  const departmentId = q.departmentId ? Number(q.departmentId) : undefined;
  const departmentIds = q.departmentIds
    ? String(q.departmentIds).split(",").map((s) => Number(s.trim())).filter(Boolean)
    : undefined;
  const gender = q.gender ? String(q.gender).toUpperCase() : undefined;
  const designationId = q.designationId ? Number(q.designationId) : undefined;
  const sections = q.sections
    ? String(q.sections).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  return { from, to, departmentId, departmentIds, gender, designationId, sections };
}

function buildSurveyWhere(f: ReturnType<typeof parseFilters>) {
  const employeeWhere: any = {};
  if (f.departmentId) employeeWhere.departmentId = f.departmentId;
  if (f.departmentIds?.length) employeeWhere.departmentId = { in: f.departmentIds };
  if (f.gender) employeeWhere.gender = f.gender;
  if (f.designationId) employeeWhere.designationId = f.designationId;

  const where: any = { status: "SUBMITTED" };
  if (f.from || f.to) {
    where.submittedAt = {};
    if (f.from) where.submittedAt.gte = f.from;
    if (f.to) where.submittedAt.lte = f.to;
  }
  if (Object.keys(employeeWhere).length) where.employee = employeeWhere;
  return where;
}

/**
 * Master fetch: pulls submitted responses in the filter window, joined to
 * question + employee + department + designation. Every analytics endpoint
 * below derives its numbers from this slice. Trade-off: simpler code, one
 * round-trip per endpoint; not suitable for very large orgs without paging.
 */
async function fetchResponses(req: Request) {
  const filters = parseFilters(req);
  const surveyWhere = buildSurveyWhere(filters);

  const responses = await prisma.surveyResponse.findMany({
    where: {
      survey: surveyWhere,
      ...(filters.sections?.length ? { question: { section: { in: filters.sections } } } : {}),
    },
    include: {
      question: true,
      survey: {
        include: {
          employee: {
            include: {
              Department: { select: { id: true, name: true } },
              designation: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  return { responses, filters };
}

// ==================== SUMMARY ====================
export async function getAnalyticsSummary(req: Request, res: Response) {
  try {
    const filters = parseFilters(req);
    const surveyWhere = buildSurveyWhere(filters);

    const [submitted, drafts, responses] = await Promise.all([
      prisma.employeeSurvey.count({ where: surveyWhere }),
      prisma.employeeSurvey.count({ where: { ...surveyWhere, status: "DRAFT" } }),
      prisma.surveyResponse.findMany({
        where: { survey: surveyWhere },
        select: { answer: true },
      }),
    ]);

    const counts = emptyCounts();
    for (const r of responses) bump(counts, r.answer);
    const totals = totalsFrom(counts);

    // Previous-cycle delta: compare to the prior equal-length window.
    let prevAvgScore: number | null = null;
    let scoreDelta: number | null = null;
    if (filters.from && filters.to) {
      const span = filters.to.getTime() - filters.from.getTime();
      const prevTo = new Date(filters.from.getTime() - 1);
      const prevFrom = new Date(prevTo.getTime() - span);
      const prevResponses = await prisma.surveyResponse.findMany({
        where: {
          survey: {
            status: "SUBMITTED",
            submittedAt: { gte: prevFrom, lte: prevTo },
            ...(surveyWhere.employee ? { employee: surveyWhere.employee } : {}),
          },
        },
        select: { answer: true },
      });
      const pc = emptyCounts();
      for (const r of prevResponses) bump(pc, r.answer);
      const pt = totalsFrom(pc);
      prevAvgScore = pt.avgScore;
      scoreDelta = +(totals.avgScore - pt.avgScore).toFixed(2);
    }

    const totalSurveys = submitted + drafts;
    const completionPct = totalSurveys ? +((submitted / totalSurveys) * 100).toFixed(1) : 0;

    return res.json({
      totalSubmitted: submitted,
      totalDrafts: drafts,
      completionPct,
      avgScore: totals.avgScore,
      pctPositive: totals.pctPositive,
      pctNegative: totals.pctNegative,
      distribution: counts,
      prevAvgScore,
      scoreDelta,
    });
  } catch (e: any) {
    console.error("getAnalyticsSummary error:", e);
    return res.status(500).json({ error: e?.message || "Failed to compute summary" });
  }
}

// ==================== BY SECTION ====================
export async function getAnalyticsBySection(req: Request, res: Response) {
  try {
    const { responses } = await fetchResponses(req);
    const bySection: Record<string, ReturnType<typeof emptyCounts>> = {};
    for (const r of responses) {
      const sec = r.question.section;
      if (!bySection[sec]) bySection[sec] = emptyCounts();
      bump(bySection[sec], r.answer);
    }
    const out = Object.keys(bySection)
      .sort()
      .map((section) => {
        const t = totalsFrom(bySection[section]);
        return {
          section,
          title: SECTION_TITLES[section] ?? section,
          counts: bySection[section],
          ...t,
        };
      });
    return res.json(out);
  } catch (e: any) {
    console.error("getAnalyticsBySection error:", e);
    return res.status(500).json({ error: e?.message || "Failed to compute sections" });
  }
}

// ==================== BY QUESTION ====================
export async function getAnalyticsByQuestion(req: Request, res: Response) {
  try {
    const { responses } = await fetchResponses(req);
    const byQ: Record<number, { question: any; counts: ReturnType<typeof emptyCounts> }> = {};
    for (const r of responses) {
      const id = r.questionId;
      if (!byQ[id]) byQ[id] = { question: r.question, counts: emptyCounts() };
      bump(byQ[id].counts, r.answer);
    }
    const out = Object.values(byQ)
      .map(({ question, counts }) => {
        const t = totalsFrom(counts);
        return {
          id: question.id,
          section: question.section,
          sectionTitle: SECTION_TITLES[question.section] ?? question.section,
          questionText: question.questionText,
          orderNo: question.orderNo,
          counts,
          ...t,
        };
      })
      .sort((a, b) =>
        a.section === b.section ? a.orderNo - b.orderNo : a.section.localeCompare(b.section),
      );
    return res.json(out);
  } catch (e: any) {
    console.error("getAnalyticsByQuestion error:", e);
    return res.status(500).json({ error: e?.message || "Failed to compute questions" });
  }
}

// ==================== BY DEPARTMENT ====================
export async function getAnalyticsByDepartment(req: Request, res: Response) {
  try {
    const { responses, filters } = await fetchResponses(req);

    type Bucket = {
      departmentId: number;
      name: string;
      counts: ReturnType<typeof emptyCounts>;
      perQuestion: Map<number, { question: any; counts: ReturnType<typeof emptyCounts> }>;
      perSection: Record<string, ReturnType<typeof emptyCounts>>;
      submittedEmployees: Set<number>;
    };
    const byDept = new Map<number, Bucket>();

    for (const r of responses) {
      const emp = r.survey.employee;
      const deptId = emp.Department?.id ?? emp.departmentId;
      const deptName = emp.Department?.name ?? "—";
      if (!byDept.has(deptId)) {
        byDept.set(deptId, {
          departmentId: deptId,
          name: deptName,
          counts: emptyCounts(),
          perQuestion: new Map(),
          perSection: {},
          submittedEmployees: new Set<number>(),
        });
      }
      const b = byDept.get(deptId)!;
      bump(b.counts, r.answer);
      if (!b.perQuestion.has(r.questionId)) {
        b.perQuestion.set(r.questionId, { question: r.question, counts: emptyCounts() });
      }
      bump(b.perQuestion.get(r.questionId)!.counts, r.answer);
      const sec = r.question.section;
      if (!b.perSection[sec]) b.perSection[sec] = emptyCounts();
      bump(b.perSection[sec], r.answer);
      b.submittedEmployees.add(emp.id);
    }

    // Department headcounts for response rate. Honour the same employee filters.
    const empWhere: any = { employmentStatus: "ACTIVE" };
    if (filters.gender) empWhere.gender = filters.gender;
    if (filters.designationId) empWhere.designationId = filters.designationId;
    if (filters.departmentId) empWhere.departmentId = filters.departmentId;
    if (filters.departmentIds?.length) empWhere.departmentId = { in: filters.departmentIds };
    const headcounts = await prisma.employee.groupBy({
      by: ["departmentId"],
      where: empWhere,
      _count: { _all: true },
    });
    const headMap = new Map(headcounts.map((h) => [h.departmentId, h._count._all]));

    const departments = Array.from(byDept.values()).map((b) => {
      const t = totalsFrom(b.counts);
      const topConcerns = Array.from(b.perQuestion.values())
        .map(({ question, counts }) => ({ question, counts, ...totalsFrom(counts) }))
        .filter((q) => q.total > 0)
        .sort((a, b) => a.avgScore - b.avgScore)
        .slice(0, 3)
        .map((q) => ({
          questionId: q.question.id,
          section: q.question.section,
          questionText: q.question.questionText,
          avgScore: q.avgScore,
          pctNegative: q.pctNegative,
        }));
      const headcount = headMap.get(b.departmentId) ?? 0;
      const responseRate = headcount
        ? +((b.submittedEmployees.size / headcount) * 100).toFixed(1)
        : 0;
      return {
        departmentId: b.departmentId,
        name: b.name,
        headcount,
        submittedEmployees: b.submittedEmployees.size,
        responseRate,
        ...t,
        topConcerns,
      };
    });

    // Heatmap rows: dept × section avg score
    const heatmap = Array.from(byDept.values()).map((b) => {
      const sectionScores: Record<string, number> = {};
      for (const sec of Object.keys(b.perSection)) {
        sectionScores[sec] = totalsFrom(b.perSection[sec]).avgScore;
      }
      return { departmentId: b.departmentId, name: b.name, sectionScores };
    });

    return res.json({
      departments: departments.sort((a, b) => b.avgScore - a.avgScore),
      heatmap,
      sections: Object.keys(SECTION_TITLES).map((k) => ({ section: k, title: SECTION_TITLES[k] })),
    });
  } catch (e: any) {
    console.error("getAnalyticsByDepartment error:", e);
    return res.status(500).json({ error: e?.message || "Failed to compute departments" });
  }
}

// ==================== QUESTION DRILL-DOWN ====================
export async function getAnalyticsQuestionDrilldown(req: Request, res: Response) {
  try {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
      return res.status(400).json({ error: "Invalid questionId" });
    }
    const filters = parseFilters(req);
    const surveyWhere = buildSurveyWhere(filters);

    const question = await prisma.surveyQuestion.findUnique({ where: { id: questionId } });
    if (!question) return res.status(404).json({ error: "Question not found" });

    const rows = await prisma.surveyResponse.findMany({
      where: { questionId, survey: surveyWhere },
      include: {
        survey: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                photoUrl: true,
                gender: true,
                Department: { select: { id: true, name: true } },
                designation: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    const counts = emptyCounts();
    const byOption: Record<string, any[]> = {
      "Fully Agree": [],
      "Mostly Agree": [],
      "Mostly Disagree": [],
      "Strongly Disagree": [],
    };
    const deptMap = new Map<number, { name: string; counts: ReturnType<typeof emptyCounts> }>();

    for (const r of rows) {
      bump(counts, r.answer);
      const emp = r.survey.employee;
      if (byOption[r.answer]) {
        byOption[r.answer].push({
          id: emp.id,
          name: `${emp.firstName} ${emp.lastName}`,
          employeeCode: emp.employeeCode,
          photoUrl: emp.photoUrl,
          gender: emp.gender,
          department: emp.Department?.name ?? "—",
          designation: emp.designation?.name ?? "—",
        });
      }
      const did = emp.Department?.id ?? -1;
      if (!deptMap.has(did)) {
        deptMap.set(did, { name: emp.Department?.name ?? "—", counts: emptyCounts() });
      }
      bump(deptMap.get(did)!.counts, r.answer);
    }

    const byDepartment = Array.from(deptMap.entries()).map(([id, v]) => ({
      departmentId: id,
      name: v.name,
      counts: v.counts,
      ...totalsFrom(v.counts),
    }));

    return res.json({
      question: {
        id: question.id,
        section: question.section,
        sectionTitle: SECTION_TITLES[question.section] ?? question.section,
        questionText: question.questionText,
      },
      counts,
      ...totalsFrom(counts),
      byOption,
      byDepartment: byDepartment.sort((a, b) => a.avgScore - b.avgScore),
    });
  } catch (e: any) {
    console.error("getAnalyticsQuestionDrilldown error:", e);
    return res.status(500).json({ error: e?.message || "Failed to compute drilldown" });
  }
}

// ==================== AT-RISK EMPLOYEES ====================
export async function getAnalyticsAtRisk(req: Request, res: Response) {
  try {
    const { responses } = await fetchResponses(req);
    const byEmp = new Map<number, {
      employee: any;
      sum: number;
      n: number;
      answers: { questionText: string; section: string; answer: string; score: number }[];
    }>();
    for (const r of responses) {
      const emp = r.survey.employee;
      if (!byEmp.has(emp.id)) byEmp.set(emp.id, { employee: emp, sum: 0, n: 0, answers: [] });
      const b = byEmp.get(emp.id)!;
      const s = scoreOf(r.answer);
      b.sum += s;
      b.n += 1;
      b.answers.push({
        questionText: r.question.questionText,
        section: r.question.section,
        answer: r.answer,
        score: s,
      });
    }
    const result = Array.from(byEmp.values())
      .map(({ employee, sum, n, answers }) => ({
        employeeId: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        employeeCode: employee.employeeCode,
        photoUrl: employee.photoUrl,
        gender: employee.gender,
        department: employee.Department?.name ?? "—",
        designation: employee.designation?.name ?? "—",
        avgScore: n ? +(sum / n).toFixed(2) : 0,
        responses: n,
        lowestAnswers: answers.sort((a, b) => a.score - b.score).slice(0, 3),
      }))
      .filter((e) => e.avgScore > 0 && e.avgScore <= 2)
      .sort((a, b) => a.avgScore - b.avgScore);

    return res.json(result);
  } catch (e: any) {
    console.error("getAnalyticsAtRisk error:", e);
    return res.status(500).json({ error: e?.message || "Failed to compute at-risk" });
  }
}

// ==================== DEMOGRAPHIC CUTS ====================
export async function getAnalyticsDemographics(req: Request, res: Response) {
  try {
    const { responses } = await fetchResponses(req);
    type B = { sum: number; n: number; employees: Set<number> };
    const byGender: Record<string, B> = {};
    const byDesignation: Record<string, B> = {};
    const tenureBuckets: Record<string, B> = {
      "<1y": { sum: 0, n: 0, employees: new Set() },
      "1-3y": { sum: 0, n: 0, employees: new Set() },
      "3-5y": { sum: 0, n: 0, employees: new Set() },
      ">5y": { sum: 0, n: 0, employees: new Set() },
    };
    const now = new Date();

    for (const r of responses) {
      const emp = r.survey.employee;
      const s = scoreOf(r.answer);

      const g = emp.gender || "OTHER";
      if (!byGender[g]) byGender[g] = { sum: 0, n: 0, employees: new Set() };
      byGender[g].sum += s; byGender[g].n += 1; byGender[g].employees.add(emp.id);

      const d = emp.designation?.name || "—";
      if (!byDesignation[d]) byDesignation[d] = { sum: 0, n: 0, employees: new Set() };
      byDesignation[d].sum += s; byDesignation[d].n += 1; byDesignation[d].employees.add(emp.id);

      const years = emp.dateOfJoining
        ? (now.getTime() - new Date(emp.dateOfJoining).getTime()) / (365.25 * 24 * 3600 * 1000)
        : 0;
      const bucket = years < 1 ? "<1y" : years < 3 ? "1-3y" : years < 5 ? "3-5y" : ">5y";
      tenureBuckets[bucket].sum += s; tenureBuckets[bucket].n += 1; tenureBuckets[bucket].employees.add(emp.id);
    }

    const flat = (rec: Record<string, B>) =>
      Object.entries(rec).map(([key, v]) => ({
        key,
        employees: v.employees.size,
        responses: v.n,
        avgScore: v.n ? +(v.sum / v.n).toFixed(2) : 0,
      }));

    return res.json({
      byGender: flat(byGender),
      byDesignation: flat(byDesignation).sort((a, b) => b.employees - a.employees),
      byTenure: ["<1y", "1-3y", "3-5y", ">5y"].map((k) => ({
        key: k,
        employees: tenureBuckets[k].employees.size,
        responses: tenureBuckets[k].n,
        avgScore: tenureBuckets[k].n
          ? +(tenureBuckets[k].sum / tenureBuckets[k].n).toFixed(2)
          : 0,
      })),
    });
  } catch (e: any) {
    console.error("getAnalyticsDemographics error:", e);
    return res.status(500).json({ error: e?.message || "Failed to compute demographics" });
  }
}

// ==================== SCATTER: TENURE vs SCORE ====================
export async function getAnalyticsScatter(req: Request, res: Response) {
  try {
    const { responses } = await fetchResponses(req);
    const byEmp = new Map<number, { employee: any; sum: number; n: number }>();
    for (const r of responses) {
      const emp = r.survey.employee;
      if (!byEmp.has(emp.id)) byEmp.set(emp.id, { employee: emp, sum: 0, n: 0 });
      const b = byEmp.get(emp.id)!;
      b.sum += scoreOf(r.answer);
      b.n += 1;
    }
    const now = new Date();
    const points = Array.from(byEmp.values()).map(({ employee, sum, n }) => {
      const years = employee.dateOfJoining
        ? +(
          (now.getTime() - new Date(employee.dateOfJoining).getTime()) /
          (365.25 * 24 * 3600 * 1000)
        ).toFixed(2)
        : 0;
      return {
        employeeId: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        employeeCode: employee.employeeCode,
        department: employee.Department?.name ?? "—",
        departmentId: employee.Department?.id ?? null,
        tenureYears: years,
        avgScore: n ? +(sum / n).toFixed(2) : 0,
      };
    });
    return res.json(points);
  } catch (e: any) {
    console.error("getAnalyticsScatter error:", e);
    return res.status(500).json({ error: e?.message || "Failed to compute scatter" });
  }
}

// ==================== PENDING DRAFTS ====================
export async function getAnalyticsPending(req: Request, res: Response) {
  try {
    const filters = parseFilters(req);
    const employeeWhere: any = {};
    if (filters.departmentId) employeeWhere.departmentId = filters.departmentId;
    if (filters.departmentIds?.length) employeeWhere.departmentId = { in: filters.departmentIds };
    if (filters.gender) employeeWhere.gender = filters.gender;
    if (filters.designationId) employeeWhere.designationId = filters.designationId;

    const drafts = await prisma.employeeSurvey.findMany({
      where: {
        status: "DRAFT",
        ...(Object.keys(employeeWhere).length ? { employee: employeeWhere } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            photoUrl: true,
            gender: true,
            Department: { select: { id: true, name: true } },
            designation: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { date: "asc" },
    });

    const now = Date.now();
    const items = drafts.map((d) => {
      const created = new Date(d.date).getTime();
      const daysOverdue = Math.max(0, Math.floor((now - created) / (24 * 3600 * 1000)));
      return {
        surveyId: d.id,
        employeeId: d.employee.id,
        name: `${d.employee.firstName} ${d.employee.lastName}`,
        employeeCode: d.employee.employeeCode,
        photoUrl: d.employee.photoUrl,
        gender: d.employee.gender,
        department: d.employee.Department?.name ?? "—",
        departmentId: d.employee.Department?.id ?? null,
        designation: d.employee.designation?.name ?? "—",
        createdAt: d.date,
        daysOverdue,
      };
    });

    const byDept = new Map<string, number>();
    for (const it of items) byDept.set(it.department, (byDept.get(it.department) ?? 0) + 1);
    const perDepartment = Array.from(byDept.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return res.json({ items, perDepartment, total: items.length });
  } catch (e: any) {
    console.error("getAnalyticsPending error:", e);
    return res.status(500).json({ error: e?.message || "Failed to fetch pending" });
  }
}

// ==================== SEND REMINDERS ====================
export async function sendPendingReminders(req: Request, res: Response) {
  try {
    const surveyIds: number[] = Array.isArray(req.body?.surveyIds)
      ? req.body.surveyIds.map((n: any) => Number(n)).filter(Boolean)
      : [];
    if (!surveyIds.length) {
      return res.status(400).json({ error: "surveyIds[] required" });
    }

    const drafts = await prisma.employeeSurvey.findMany({
      where: { id: { in: surveyIds }, status: "DRAFT" },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    let notified = 0;
    for (const d of drafts) {
      const empName = `${d.employee.firstName} ${d.employee.lastName}`;
      const msg = `${empName}, reminder: your employee survey is still pending. Please complete it at your earliest convenience.`;
      try {
        await createNotification(d.employee.id, msg);
        notified++;
      } catch (err) {
        console.error(`Reminder notify failed for ${d.employee.id}:`, err);
      }
    }
    return res.json({ requested: surveyIds.length, notified });
  } catch (e: any) {
    console.error("sendPendingReminders error:", e);
    return res.status(500).json({ error: e?.message || "Failed to send reminders" });
  }
}
