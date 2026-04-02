import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

// ── Helper: ISO week label ──────────────────────────────────────────────
function getWeekLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

const DEFAULT_QUESTIONS = [
  { text: "Quality of Work", displayOrder: 1 },
  { text: "Punctuality & Attendance", displayOrder: 2 },
  { text: "Team Collaboration", displayOrder: 3 },
  { text: "Initiative & Ownership", displayOrder: 4 },
  { text: "Communication Skills", displayOrder: 5 },
];

// ═══════════════════════════════════════════════════════════════════════════
// QUESTIONS CRUD
// ═══════════════════════════════════════════════════════════════════════════

// Get all questions (optionally filter by designation)
export const getQuestions = async (req: Request, res: Response) => {
  try {
    const { designationId } = req.query;
    const where: any = {};
    if (designationId) {
      // Return defaults (no designation) + questions for this designation
      where.OR = [
        { designationId: null, isDefault: true },
        { designationId: Number(designationId) },
      ];
    }

    const questions = await prisma.weeklyRatingQuestion.findMany({
      where,
      include: { designation: { select: { id: true, name: true } } },
      orderBy: [{ isDefault: "desc" }, { displayOrder: "asc" }],
    });
    return res.json(questions);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// Get questions for a specific employee (by their designation)
export const getQuestionsForEmployee = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { designationId: true },
    });

    if (!emp) return res.status(404).json({ error: "Employee not found" });

    const questions = await prisma.weeklyRatingQuestion.findMany({
      where: {
        isActive: true,
        OR: [
          { designationId: null, isDefault: true },
          { designationId: emp.designationId },
        ],
      },
      orderBy: [{ isDefault: "desc" }, { displayOrder: "asc" }],
    });

    return res.json(questions);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createQuestion = async (req: Request, res: Response) => {
  try {
    const { text, createdBy, designationId } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: "Question text is required" });
    if (!designationId) return res.status(400).json({ error: "Designation is required for custom questions" });

    // Check max 10 active questions per designation (5 default + 5 custom)
    const activeCustom = await prisma.weeklyRatingQuestion.count({
      where: { designationId: Number(designationId), isActive: true },
    });
    if (activeCustom >= 5) {
      return res.status(400).json({ error: "Maximum 5 custom questions per designation allowed" });
    }

    const maxOrder = await prisma.weeklyRatingQuestion.aggregate({ _max: { displayOrder: true } });
    const question = await prisma.weeklyRatingQuestion.create({
      data: {
        text: text.trim(),
        isDefault: false,
        isActive: true,
        displayOrder: (maxOrder._max.displayOrder ?? 0) + 1,
        designationId: Number(designationId),
        createdBy: createdBy ? Number(createdBy) : null,
      },
      include: { designation: { select: { id: true, name: true } } },
    });
    return res.status(201).json(question);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const toggleQuestion = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { isActive } = req.body;

    const q = await prisma.weeklyRatingQuestion.findUnique({ where: { id } });
    if (!q) return res.status(404).json({ error: "Question not found" });

    if (isActive && q.designationId) {
      const activeCustom = await prisma.weeklyRatingQuestion.count({
        where: { designationId: q.designationId, isActive: true },
      });
      if (activeCustom >= 5) {
        return res.status(400).json({ error: "Maximum 5 custom questions per designation allowed" });
      }
    }

    const question = await prisma.weeklyRatingQuestion.update({
      where: { id },
      data: { isActive },
      include: { designation: { select: { id: true, name: true } } },
    });
    return res.json(question);
  } catch (error: any) {
    if (error.code === "P2025") return res.status(404).json({ error: "Question not found" });
    return res.status(500).json({ error: error.message });
  }
};

// Delete removed — questions can only be deactivated, not deleted

// Seed defaults if not present
export const seedDefaultQuestions = async (_req: Request, res: Response) => {
  try {
    const existing = await prisma.weeklyRatingQuestion.count({ where: { isDefault: true } });
    if (existing > 0) return res.json({ message: "Default questions already exist", count: existing });

    await prisma.weeklyRatingQuestion.createMany({
      data: DEFAULT_QUESTIONS.map(q => ({ ...q, isDefault: true, isActive: true })),
    });
    return res.json({ message: "Default questions seeded", count: DEFAULT_QUESTIONS.length });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// RATINGS — Manager fills weekly for each employee
// ═══════════════════════════════════════════════════════════════════════════

// Get team members for the manager to rate
export const getTeamForRating = async (req: Request, res: Response) => {
  try {
    const managerId = Number(req.query.managerId);
    const weekStartDate = req.query.weekStartDate ? new Date(String(req.query.weekStartDate)) : null;

    if (!managerId) return res.status(400).json({ error: "managerId is required" });

    const team = await prisma.employee.findMany({
      where: {
        OR: [
          { reportingManager: managerId },
          { inchargeId: managerId },
        ],
        employmentStatus: "ACTIVE",
      },
      select: {
        id: true, employeeCode: true, firstName: true, lastName: true,
        Department: { select: { name: true } },
        designation: { select: { name: true } },
      },
      orderBy: { firstName: "asc" },
    });

    // If weekStartDate given, check which employees already have ratings
    let ratingMap: Record<number, any> = {};
    if (weekStartDate) {
      const ratings = await prisma.weeklyPerformanceRating.findMany({
        where: {
          employeeId: { in: team.map(e => e.id) },
          weekStartDate,
        },
        select: { employeeId: true, id: true, status: true, overallScore: true },
      });
      for (const r of ratings) {
        ratingMap[r.employeeId] = r;
      }
    }

    const result = team.map(e => ({
      ...e,
      rating: ratingMap[e.id] || null,
    }));

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// Create or update rating with answers
export const submitRating = async (req: Request, res: Response) => {
  try {
    const { employeeId, ratedBy, weekStartDate, weekEndDate, managerRemarks, answers, status } = req.body;

    if (!employeeId || !ratedBy || !weekStartDate || !weekEndDate || !answers?.length) {
      return res.status(400).json({ error: "employeeId, ratedBy, weekStartDate, weekEndDate, answers are required" });
    }

    // Validate scores 1-10
    for (const a of answers) {
      if (!a.questionId || a.score < 1 || a.score > 10) {
        return res.status(400).json({ error: "Each answer must have questionId and score between 1-10" });
      }
    }

    const start = new Date(weekStartDate);
    const end = new Date(weekEndDate);
    const overallScore = Math.round((answers.reduce((sum: number, a: any) => sum + a.score, 0) / answers.length) * 10) / 10;

    // Upsert rating
    const existing = await prisma.weeklyPerformanceRating.findUnique({
      where: { employeeId_weekStartDate: { employeeId: Number(employeeId), weekStartDate: start } },
    });

    let rating;
    if (existing) {
      // Delete old answers and re-create
      await prisma.weeklyRatingAnswer.deleteMany({ where: { ratingId: existing.id } });
      rating = await prisma.weeklyPerformanceRating.update({
        where: { id: existing.id },
        data: {
          overallScore,
          managerRemarks: managerRemarks || null,
          status: status || "SUBMITTED",
          answers: {
            create: answers.map((a: any) => ({
              questionId: a.questionId,
              score: a.score,
              remarks: a.remarks || null,
            })),
          },
        },
        include: { answers: { include: { question: true } } },
      });
    } else {
      rating = await prisma.weeklyPerformanceRating.create({
        data: {
          employeeId: Number(employeeId),
          ratedBy: Number(ratedBy),
          weekStartDate: start,
          weekEndDate: end,
          weekLabel: getWeekLabel(start),
          overallScore,
          managerRemarks: managerRemarks || null,
          status: status || "SUBMITTED",
          answers: {
            create: answers.map((a: any) => ({
              questionId: a.questionId,
              score: a.score,
              remarks: a.remarks || null,
            })),
          },
        },
        include: { answers: { include: { question: true } } },
      });
    }

    return res.json(rating);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// Get single rating detail
export const getRatingDetail = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const rating = await prisma.weeklyPerformanceRating.findUnique({
      where: { id },
      include: {
        employee: { select: { employeeCode: true, firstName: true, lastName: true, Department: { select: { name: true } } } },
        answers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
      },
    });
    if (!rating) return res.status(404).json({ error: "Rating not found" });
    return res.json(rating);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// HR: Get all ratings (filterable)
export const getAllRatings = async (req: Request, res: Response) => {
  try {
    const { employeeId, ratedBy, weekStartDate, departmentId, status } = req.query;
    const where: any = {};
    if (employeeId) where.employeeId = Number(employeeId);
    if (ratedBy) where.ratedBy = Number(ratedBy);
    if (status) where.status = String(status);
    if (weekStartDate) where.weekStartDate = new Date(String(weekStartDate));
    if (departmentId) where.employee = { departmentId: Number(departmentId) };

    const ratings = await prisma.weeklyPerformanceRating.findMany({
      where,
      include: {
        employee: {
          select: {
            employeeCode: true, firstName: true, lastName: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
        answers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
      },
      orderBy: [{ weekStartDate: "desc" }, { employeeId: "asc" }],
    });

    // Add ratedBy name
    const raterIds = [...new Set(ratings.map(r => r.ratedBy))];
    const raters = await prisma.employee.findMany({
      where: { id: { in: raterIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const raterMap = new Map(raters.map(r => [r.id, `${r.firstName} ${r.lastName}`]));

    const result = ratings.map(r => ({
      ...r,
      ratedByName: raterMap.get(r.ratedBy) ?? '',
    }));

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// Delete rating (only DRAFT)
export const deleteRating = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const rating = await prisma.weeklyPerformanceRating.findUnique({ where: { id } });
    if (!rating) return res.status(404).json({ error: "Rating not found" });
    if (rating.status !== "DRAFT") return res.status(400).json({ error: "Can only delete DRAFT ratings" });

    await prisma.weeklyPerformanceRating.delete({ where: { id } });
    return res.json({ message: "Rating deleted" });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
