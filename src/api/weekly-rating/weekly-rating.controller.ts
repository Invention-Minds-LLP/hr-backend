import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";
import { HOD_ROLE_ID, HR_ROLE_ID, isDepartmentHead } from "../../lib/departmentHeads";
import { isInScope, scopedEmployeeWhere } from "../../lib/dataScope";
import { MGMT_DASHBOARD_EMPID_ALLOWLIST } from "../../lib/permissions";
import { resolvePermissions } from "../../lib/permissionResolver";

// ── Access control ────────────────────────────────────────────────────────────
// Identity always comes from the verified token, never from the request body or
// query (same model as weekly-tracker.controller.ts). HR = HR Manager role or the
// HR department (dept 1); Management = role 4 or the Management allow-list. HR /
// Management reach is limited to their branch/department data scope.
type Viewer = { empId: number; roleId: number | null; deptId: number | null; isHR: boolean; isHRManager: boolean; isMgmt: boolean };

async function getViewer(req: Request): Promise<Viewer | null> {
  const empId = Number((req as any).user?.empId ?? 0);
  if (!empId) return null;
  const me = await prisma.employee.findUnique({ where: { id: empId }, select: { roleId: true, departmentId: true } });
  if (!me) return null;
  return {
    empId,
    roleId: me.roleId ?? null,
    deptId: me.departmentId ?? null,
    isHR: me.roleId === HR_ROLE_ID || me.departmentId === 1,
    isHRManager: me.roleId === HR_ROLE_ID,
    isMgmt: me.roleId === 4 || MGMT_DASHBOARD_EMPID_ALLOWLIST.includes(empId),
  };
}

type RatedEmployee = { id: number; reportingManager: number | null; departmentId: number | null };

async function ratedEmployee(id: number): Promise<RatedEmployee | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return prisma.employee.findUnique({ where: { id }, select: { id: true, reportingManager: true, departmentId: true } });
}

/**
 * May `v` rate / review employee `emp` as a manager? Matches the web rating
 * overview (roleIds 1/3/4): their reporting manager · a role-3 HOD heading their
 * department · the HR Manager (role 1) or Management (role 4) within scope.
 */
async function canRateOthers(v: Viewer, emp: RatedEmployee): Promise<boolean> {
  if (v.empId === emp.id) return false;
  if (emp.reportingManager && v.empId === emp.reportingManager) return true;
  if (v.roleId === HOD_ROLE_ID && (await isDepartmentHead(v.empId, emp.departmentId))) return true;
  if (v.isHRManager || v.isMgmt) return isInScope(v.empId, emp.id);
  return false;
}

/** Question masters: HR, or the existing Masters-menu permission (the rating-questions page has no own key). */
async function canManageQuestions(v: Viewer): Promise<boolean> {
  if (v.isHR) return true;
  return (await resolvePermissions(v.empId)).includes("masters.section.view" as any);
}

const unauthorized = (res: Response) => res.status(401).json({ error: "Unauthorized" });
const forbidden = (res: Response, msg: string) => res.status(403).json({ error: msg });

// ── Helper: ISO week label ──────────────────────────────────────────────
function getWeekLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// Current IST week's Monday at 00:00 IST — matches how weekStartDate is stored.
function istWeekStart(now: Date = new Date()): Date {
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const back = (ist.getDay() + 6) % 7; // days since Monday (0=Sun..6=Sat)
  const mon = new Date(ist);
  mon.setDate(ist.getDate() - back);
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}T00:00:00+05:30`);
}

// Saturday-5pm reminder: nudge every ACTIVE employee who has NOT submitted their
// weekly SELF rating for the current (IST) week — i.e. no self rating row, or
// one still in DRAFT.
export const sendSelfRatingSubmissionReminders = async () => {
  const start = istWeekStart();
  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  const submitted = await prisma.weeklyPerformanceRating.findMany({
    where: {
      raterType: "SELF",
      status: "SUBMITTED",
      weekStartDate: { gte: start, lt: end },
    },
    select: { employeeId: true },
  });
  const submittedSet = new Set(submitted.map(r => r.employeeId));

  const employees = await prisma.employee.findMany({
    where: { employmentStatus: "ACTIVE" },
    select: { id: true },
  });

  let notified = 0;
  for (const e of employees) {
    if (submittedSet.has(e.id)) continue;
    await createNotification(
      e.id,
      "Reminder: you haven't submitted your weekly self rating for this week. Please submit it."
    );
    notified++;
  }
  return { notified };
};

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

    const where: any = {
      isActive: true,
      OR: [{ designationId: null, isDefault: true }],
    };

    // Only add designation filter if employee actually has one assigned
    if (emp.designationId) {
      where.OR.push({ designationId: emp.designationId });
    }

    const questions = await prisma.weeklyRatingQuestion.findMany({
      where,
      orderBy: [{ isDefault: "desc" }, { displayOrder: "asc" }],
    });

    return res.json({
      designationId: emp.designationId ?? null,
      questions,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createQuestion = async (req: Request, res: Response) => {
  try {
    const v = await getViewer(req);
    if (!v) return unauthorized(res);
    if (!(await canManageQuestions(v))) return forbidden(res, "Only HR can manage rating questions");
    const { text, designationId } = req.body;
    const createdBy = v.empId;
    if (!text?.trim()) return res.status(400).json({ error: "Question text is required" });
    if (!designationId) return res.status(400).json({ error: "Designation is required for custom questions" });

    // Check max 10 active questions total (defaults + custom for this designation)
    const activeDefaults = await prisma.weeklyRatingQuestion.count({
      where: { isDefault: true, isActive: true },
    });
    const activeCustom = await prisma.weeklyRatingQuestion.count({
      where: { designationId: Number(designationId), isActive: true },
    });
    if (activeDefaults + activeCustom >= 10) {
      return res.status(400).json({ error: "Maximum 10 questions allowed (default + custom combined)" });
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
    const v = await getViewer(req);
    if (!v) return unauthorized(res);
    if (!(await canManageQuestions(v))) return forbidden(res, "Only HR can manage rating questions");
    const id = Number(req.params.id);
    const { isActive } = req.body;

    const q = await prisma.weeklyRatingQuestion.findUnique({ where: { id } });
    if (!q) return res.status(404).json({ error: "Question not found" });

    if (isActive && q.designationId) {
      const activeDefaults = await prisma.weeklyRatingQuestion.count({
        where: { isDefault: true, isActive: true },
      });
      const activeCustom = await prisma.weeklyRatingQuestion.count({
        where: { designationId: q.designationId, isActive: true },
      });
      if (activeDefaults + activeCustom >= 10) {
        return res.status(400).json({ error: "Maximum 10 questions allowed (default + custom combined)" });
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
export const seedDefaultQuestions = async (req: Request, res: Response) => {
  try {
    const v = await getViewer(req);
    if (!v) return unauthorized(res);
    if (!(await canManageQuestions(v))) return forbidden(res, "Only HR can manage rating questions");
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
    const v = await getViewer(req);
    if (!v) return unauthorized(res);
    // Ordinary managers always get their own team; only HR / Management may look
    // at another manager's team, and only within their data scope.
    const requested = Number(req.query.managerId) || v.empId;
    let managerId = v.empId;
    if (requested !== v.empId) {
      if (!(v.isHR || v.isMgmt)) return forbidden(res, "You can only view your own team");
      if (!(await isInScope(v.empId, requested))) return forbidden(res, "That manager is outside your scope");
      managerId = requested;
    }
    // Normalize so the exact-match lookup below finds the canonically-stored row.
    const weekStartDate = req.query.weekStartDate ? istWeekStart(new Date(String(req.query.weekStartDate))) : null;

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

    // If weekStartDate given, check which employees already have MANAGER ratings
    let ratingMap: Record<number, any> = {};
    if (weekStartDate) {
      const ratings = await prisma.weeklyPerformanceRating.findMany({
        where: {
          employeeId: { in: team.map(e => e.id) },
          weekStartDate,
          raterType: "MANAGER" as any,
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
// Self-rating: ratedBy === employeeId → raterType = SELF
// Manager rating: ratedBy !== employeeId → raterType = MANAGER
export const submitRating = async (req: Request, res: Response) => {
  try {
    const v = await getViewer(req);
    if (!v) return unauthorized(res);
    // The rater is always the caller (body `ratedBy` is ignored, so nobody can
    // forge someone else's self-rating or rate under another manager's name).
    const { employeeId, weekStartDate, weekEndDate, managerRemarks, answers, status } = req.body;
    const ratedBy = v.empId;

    if (!employeeId || !weekStartDate || !weekEndDate || !answers?.length) {
      return res.status(400).json({ error: "employeeId, weekStartDate, weekEndDate, answers are required" });
    }

    if (Number(employeeId) !== v.empId) {
      const emp = await ratedEmployee(Number(employeeId));
      if (!emp) return res.status(404).json({ error: "Employee not found" });
      if (!(await canRateOthers(v, emp))) {
        return forbidden(res, "Only this employee's reporting manager, department head, HR Manager or Management can rate them");
      }
    }

    if (answers.length > 10) {
      return res.status(400).json({ error: "Maximum 10 questions allowed per rating" });
    }

    for (const a of answers) {
      if (!a.questionId || a.score < 1 || a.score > 10) {
        return res.status(400).json({ error: "Each answer must have questionId and score between 1-10" });
      }
    }

    // Normalize to the canonical IST week-start (Monday 00:00 IST) so SELF and
    // MANAGER rows for the same week share an identical weekStartDate regardless
    // of how the client serialized it (date-only vs full ISO). weekEndDate is
    // derived as Monday+6 (Sunday) for the same reason.
    const start = istWeekStart(new Date(weekStartDate));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const raterType = Number(employeeId) === Number(ratedBy) ? "SELF" : "MANAGER";
    const overallScore = Math.round((answers.reduce((sum: number, a: any) => sum + a.score, 0) / answers.length) * 10);

    const existing = await prisma.weeklyPerformanceRating.findUnique({
      where: {
        employeeId_weekStartDate_raterType: {
          employeeId: Number(employeeId),
          weekStartDate: start,
          raterType: raterType as any,
        },
      },
    });

    let rating;
    if (existing) {
      await prisma.weeklyRatingAnswer.deleteMany({ where: { ratingId: existing.id } });
      rating = await prisma.weeklyPerformanceRating.update({
        where: { id: existing.id },
        data: {
          // Record who last rated (e.g. HOD revising the reporting manager's draft).
          ratedBy,
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
          raterType: raterType as any,
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
    const v = await getViewer(req);
    if (!v) return unauthorized(res);
    const rating = await prisma.weeklyPerformanceRating.findUnique({
      where: { id },
      include: {
        employee: { select: { employeeCode: true, firstName: true, lastName: true, Department: { select: { name: true } } } },
        answers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
      },
    });
    if (!rating) return res.status(404).json({ error: "Rating not found" });

    // The rated employee sees only their own SELF rating (manager ratings are
    // private, as the web says). The rater, anyone allowed to rate this employee
    // (manager prefill), and HR / Management in scope may read it.
    const isOwnSelf = rating.employeeId === v.empId && (rating as any).raterType === "SELF";
    let allowed = isOwnSelf || rating.ratedBy === v.empId;
    if (!allowed && rating.employeeId !== v.empId) {
      const emp = await ratedEmployee(rating.employeeId);
      allowed = !!emp && ((await canRateOthers(v, emp)) || ((v.isHR || v.isMgmt) && (await isInScope(v.empId, emp.id))));
    }
    if (!allowed) return forbidden(res, "You do not have access to this rating");
    return res.json(rating);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// Employee: Get weekly ratings RECEIVED FROM MANAGER (only manager-type, not own self ratings)
export const getMyRatings = async (req: Request, res: Response) => {
  try {
    const empId = Number((req as any).user?.empId);
    if (!empId) return res.status(401).json({ error: "Unauthorized" });

    const ratings = await prisma.weeklyPerformanceRating.findMany({
      where: { employeeId: empId, status: "SUBMITTED", raterType: "MANAGER" as any },
      include: {
        answers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
      },
      orderBy: { weekStartDate: "desc" },
    });

    const raterIds = [...new Set(ratings.map(r => r.ratedBy))];
    const raters = await prisma.employee.findMany({
      where: { id: { in: raterIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const raterMap = new Map(raters.map(r => [r.id, `${r.firstName} ${r.lastName}`]));

    return res.json(ratings.map(r => ({ ...r, ratedByName: raterMap.get(r.ratedBy) ?? '' })));
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// HR: Get all ratings (filterable)
export const getAllRatings = async (req: Request, res: Response) => {
  try {
    // HR / Management only — this exposes manager ratings, which are private to
    // the employee. Limited to the caller's branch/department data scope.
    const v = await getViewer(req);
    if (!v) return unauthorized(res);
    if (!(v.isHR || v.isMgmt)) return forbidden(res, "Only HR or Management can view all ratings");

    const { employeeId, ratedBy, weekStartDate, departmentId, status } = req.query;
    const where: any = {};
    if (employeeId) where.employeeId = Number(employeeId);
    if (ratedBy) where.ratedBy = Number(ratedBy);
    if (status) where.status = String(status);
    if (weekStartDate) where.weekStartDate = istWeekStart(new Date(String(weekStartDate)));
    const empScope = await scopedEmployeeWhere(v.empId);
    const empFilters = [departmentId ? { departmentId: Number(departmentId) } : null, Object.keys(empScope).length ? empScope : null].filter(Boolean);
    if (empFilters.length === 1) where.employee = empFilters[0];
    else if (empFilters.length > 1) where.employee = { AND: empFilters };

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
    const v = await getViewer(req);
    if (!v) return unauthorized(res);
    const id = Number(req.params.id);
    const rating = await prisma.weeklyPerformanceRating.findUnique({ where: { id } });
    if (!rating) return res.status(404).json({ error: "Rating not found" });
    // The person who wrote it, or HR (within scope).
    const mayDelete = rating.ratedBy === v.empId || (v.isHR && (await isInScope(v.empId, rating.employeeId)));
    if (!mayDelete) return forbidden(res, "You can only delete ratings you wrote");
    if (rating.status !== "DRAFT") return res.status(400).json({ error: "Can only delete DRAFT ratings" });

    await prisma.weeklyPerformanceRating.delete({ where: { id } });
    return res.json({ message: "Rating deleted" });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SELF-RATING (Employee fills for themselves)
// ═══════════════════════════════════════════════════════════════════════════

// Get logged-in employee's self-rating for a specific week (to resume / view)
export const getMySelfRatingForWeek = async (req: Request, res: Response) => {
  try {
    const empId = Number((req as any).user?.empId);
    if (!empId) return res.status(401).json({ error: "Unauthorized" });
    const weekStartDate = req.query.weekStartDate ? istWeekStart(new Date(String(req.query.weekStartDate))) : null;
    if (!weekStartDate) return res.status(400).json({ error: "weekStartDate is required" });

    const rating = await prisma.weeklyPerformanceRating.findUnique({
      where: {
        employeeId_weekStartDate_raterType: {
          employeeId: empId,
          weekStartDate,
          raterType: "SELF" as any,
        },
      },
      include: {
        answers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
      },
    });
    return res.json(rating);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// Get all self-ratings for the logged-in employee (history)
export const getMySelfRatings = async (req: Request, res: Response) => {
  try {
    const empId = Number((req as any).user?.empId);
    if (!empId) return res.status(401).json({ error: "Unauthorized" });

    const ratings = await prisma.weeklyPerformanceRating.findMany({
      where: { employeeId: empId, raterType: "SELF" as any },
      include: {
        answers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
      },
      orderBy: { weekStartDate: "desc" },
    });
    return res.json(ratings);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// MANAGEMENT — Side-by-side comparison of self vs manager ratings
// ═══════════════════════════════════════════════════════════════════════════
export const getComparison = async (req: Request, res: Response) => {
  try {
    const v = await getViewer(req);
    if (!v) return unauthorized(res);
    const employeeId = Number(req.params.employeeId);
    const emp = await ratedEmployee(employeeId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    // Self vs manager side by side: Management / HR within scope, or the
    // employee's reporting manager / department head. Not the employee themselves
    // (it reveals the private manager rating).
    const isReviewer =
      (emp.reportingManager != null && v.empId === emp.reportingManager) ||
      (v.roleId === HOD_ROLE_ID && (await isDepartmentHead(v.empId, emp.departmentId)));
    const isAdmin = (v.isHR || v.isMgmt) && v.empId !== emp.id && (await isInScope(v.empId, emp.id));
    if (!isReviewer && !isAdmin) return forbidden(res, "You do not have access to this comparison");
    const weekStartParam = req.query.weekStartDate ? String(req.query.weekStartDate) : null;

    const where: any = { employeeId };
    if (weekStartParam) {
      // Match by date-range to avoid IST vs UTC mismatches in storage.
      // A week starting on "2026-04-20" in IST may be stored as "2026-04-19 18:30 UTC".
      // So we match anything within a 48-hour window around the requested date.
      const base = new Date(weekStartParam + "T00:00:00.000Z");
      const rangeStart = new Date(base.getTime() - 12 * 3600000);  // 12h before UTC midnight
      const rangeEnd   = new Date(base.getTime() + 36 * 3600000);  // 36h after UTC midnight
      where.weekStartDate = { gte: rangeStart, lte: rangeEnd };
    }

    const ratings = await prisma.weeklyPerformanceRating.findMany({
      where,
      include: {
        answers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
      },
      orderBy: { weekStartDate: "desc" },
    });

    // Group by IST calendar date of weekStartDate so self & manager ratings
    // for the same week merge even if stored at slightly different timestamps
    // (e.g. self at 18:30 UTC = IST midnight, manager at 00:00 UTC).
    const istDateKey = (d: Date) => {
      const ist = new Date(d.getTime() + 5.5 * 3600000);
      return ist.toISOString().slice(0, 10); // YYYY-MM-DD (IST)
    };

    const byWeek: Record<string, { self: any | null; manager: any | null; weekStartDate: Date; weekEndDate: Date }> = {};
    for (const r of ratings) {
      const key = istDateKey(r.weekStartDate);
      if (!byWeek[key]) {
        byWeek[key] = { self: null, manager: null, weekStartDate: r.weekStartDate, weekEndDate: r.weekEndDate };
      }
      if ((r as any).raterType === "SELF") byWeek[key].self = r;
      else byWeek[key].manager = r;
    }

    // Build per-question comparison for each week
    const result = Object.values(byWeek).map((wk) => {
      const allQuestions = new Map<number, { id: number; text: string }>();
      const selfAnswers = new Map<number, { score: number; remarks: string | null }>();
      const mgrAnswers = new Map<number, { score: number; remarks: string | null }>();

      if (wk.self) {
        for (const a of wk.self.answers) {
          allQuestions.set(a.questionId, { id: a.question.id, text: a.question.text });
          selfAnswers.set(a.questionId, { score: a.score, remarks: a.remarks });
        }
      }
      if (wk.manager) {
        for (const a of wk.manager.answers) {
          allQuestions.set(a.questionId, { id: a.question.id, text: a.question.text });
          mgrAnswers.set(a.questionId, { score: a.score, remarks: a.remarks });
        }
      }

      const comparison = Array.from(allQuestions.values()).map((q) => {
        const s = selfAnswers.get(q.id) ?? null;
        const m = mgrAnswers.get(q.id) ?? null;
        return {
          questionId: q.id,
          questionText: q.text,
          selfScore: s?.score ?? null,
          managerScore: m?.score ?? null,
          delta: s && m ? m.score - s.score : null,
          selfRemarks: s?.remarks ?? null,
          managerRemarks: m?.remarks ?? null,
        };
      });

      return {
        weekStartDate: wk.weekStartDate,
        weekEndDate: wk.weekEndDate,
        weekLabel: wk.self?.weekLabel ?? wk.manager?.weekLabel ?? null,
        selfOverallScore: wk.self?.overallScore ?? null,
        managerOverallScore: wk.manager?.overallScore ?? null,
        managerRemarks: wk.manager?.managerRemarks ?? null,
        selfRemarks: wk.self?.managerRemarks ?? null, // self uses same remarks field
        comparison,
      };
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
