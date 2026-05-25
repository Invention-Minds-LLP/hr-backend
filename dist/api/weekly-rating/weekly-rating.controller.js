"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getComparison = exports.getMySelfRatings = exports.getMySelfRatingForWeek = exports.deleteRating = exports.getAllRatings = exports.getMyRatings = exports.getRatingDetail = exports.submitRating = exports.getTeamForRating = exports.seedDefaultQuestions = exports.toggleQuestion = exports.createQuestion = exports.getQuestionsForEmployee = exports.getQuestions = void 0;
const prisma_1 = require("../../lib/prisma");
// ── Helper: ISO week label ──────────────────────────────────────────────
function getWeekLabel(date) {
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
const getQuestions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { designationId } = req.query;
        const where = {};
        if (designationId) {
            // Return defaults (no designation) + questions for this designation
            where.OR = [
                { designationId: null, isDefault: true },
                { designationId: Number(designationId) },
            ];
        }
        const questions = yield prisma_1.prisma.weeklyRatingQuestion.findMany({
            where,
            include: { designation: { select: { id: true, name: true } } },
            orderBy: [{ isDefault: "desc" }, { displayOrder: "asc" }],
        });
        return res.json(questions);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getQuestions = getQuestions;
// Get questions for a specific employee (by their designation)
const getQuestionsForEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const employeeId = Number(req.params.employeeId);
        const emp = yield prisma_1.prisma.employee.findUnique({
            where: { id: employeeId },
            select: { designationId: true },
        });
        if (!emp)
            return res.status(404).json({ error: "Employee not found" });
        const where = {
            isActive: true,
            OR: [{ designationId: null, isDefault: true }],
        };
        // Only add designation filter if employee actually has one assigned
        if (emp.designationId) {
            where.OR.push({ designationId: emp.designationId });
        }
        const questions = yield prisma_1.prisma.weeklyRatingQuestion.findMany({
            where,
            orderBy: [{ isDefault: "desc" }, { displayOrder: "asc" }],
        });
        return res.json({
            designationId: (_a = emp.designationId) !== null && _a !== void 0 ? _a : null,
            questions,
        });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getQuestionsForEmployee = getQuestionsForEmployee;
const createQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { text, createdBy, designationId } = req.body;
        if (!(text === null || text === void 0 ? void 0 : text.trim()))
            return res.status(400).json({ error: "Question text is required" });
        if (!designationId)
            return res.status(400).json({ error: "Designation is required for custom questions" });
        // Check max 10 active questions total (defaults + custom for this designation)
        const activeDefaults = yield prisma_1.prisma.weeklyRatingQuestion.count({
            where: { isDefault: true, isActive: true },
        });
        const activeCustom = yield prisma_1.prisma.weeklyRatingQuestion.count({
            where: { designationId: Number(designationId), isActive: true },
        });
        if (activeDefaults + activeCustom >= 10) {
            return res.status(400).json({ error: "Maximum 10 questions allowed (default + custom combined)" });
        }
        const maxOrder = yield prisma_1.prisma.weeklyRatingQuestion.aggregate({ _max: { displayOrder: true } });
        const question = yield prisma_1.prisma.weeklyRatingQuestion.create({
            data: {
                text: text.trim(),
                isDefault: false,
                isActive: true,
                displayOrder: ((_a = maxOrder._max.displayOrder) !== null && _a !== void 0 ? _a : 0) + 1,
                designationId: Number(designationId),
                createdBy: createdBy ? Number(createdBy) : null,
            },
            include: { designation: { select: { id: true, name: true } } },
        });
        return res.status(201).json(question);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.createQuestion = createQuestion;
const toggleQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { isActive } = req.body;
        const q = yield prisma_1.prisma.weeklyRatingQuestion.findUnique({ where: { id } });
        if (!q)
            return res.status(404).json({ error: "Question not found" });
        if (isActive && q.designationId) {
            const activeDefaults = yield prisma_1.prisma.weeklyRatingQuestion.count({
                where: { isDefault: true, isActive: true },
            });
            const activeCustom = yield prisma_1.prisma.weeklyRatingQuestion.count({
                where: { designationId: q.designationId, isActive: true },
            });
            if (activeDefaults + activeCustom >= 10) {
                return res.status(400).json({ error: "Maximum 10 questions allowed (default + custom combined)" });
            }
        }
        const question = yield prisma_1.prisma.weeklyRatingQuestion.update({
            where: { id },
            data: { isActive },
            include: { designation: { select: { id: true, name: true } } },
        });
        return res.json(question);
    }
    catch (error) {
        if (error.code === "P2025")
            return res.status(404).json({ error: "Question not found" });
        return res.status(500).json({ error: error.message });
    }
});
exports.toggleQuestion = toggleQuestion;
// Delete removed — questions can only be deactivated, not deleted
// Seed defaults if not present
const seedDefaultQuestions = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const existing = yield prisma_1.prisma.weeklyRatingQuestion.count({ where: { isDefault: true } });
        if (existing > 0)
            return res.json({ message: "Default questions already exist", count: existing });
        yield prisma_1.prisma.weeklyRatingQuestion.createMany({
            data: DEFAULT_QUESTIONS.map(q => (Object.assign(Object.assign({}, q), { isDefault: true, isActive: true }))),
        });
        return res.json({ message: "Default questions seeded", count: DEFAULT_QUESTIONS.length });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.seedDefaultQuestions = seedDefaultQuestions;
// ═══════════════════════════════════════════════════════════════════════════
// RATINGS — Manager fills weekly for each employee
// ═══════════════════════════════════════════════════════════════════════════
// Get team members for the manager to rate
const getTeamForRating = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = Number(req.query.managerId);
        const weekStartDate = req.query.weekStartDate ? new Date(String(req.query.weekStartDate)) : null;
        if (!managerId)
            return res.status(400).json({ error: "managerId is required" });
        const team = yield prisma_1.prisma.employee.findMany({
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
        let ratingMap = {};
        if (weekStartDate) {
            const ratings = yield prisma_1.prisma.weeklyPerformanceRating.findMany({
                where: {
                    employeeId: { in: team.map(e => e.id) },
                    weekStartDate,
                    raterType: "MANAGER",
                },
                select: { employeeId: true, id: true, status: true, overallScore: true },
            });
            for (const r of ratings) {
                ratingMap[r.employeeId] = r;
            }
        }
        const result = team.map(e => (Object.assign(Object.assign({}, e), { rating: ratingMap[e.id] || null })));
        return res.json(result);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getTeamForRating = getTeamForRating;
// Create or update rating with answers
// Self-rating: ratedBy === employeeId → raterType = SELF
// Manager rating: ratedBy !== employeeId → raterType = MANAGER
const submitRating = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, ratedBy, weekStartDate, weekEndDate, managerRemarks, answers, status } = req.body;
        if (!employeeId || !ratedBy || !weekStartDate || !weekEndDate || !(answers === null || answers === void 0 ? void 0 : answers.length)) {
            return res.status(400).json({ error: "employeeId, ratedBy, weekStartDate, weekEndDate, answers are required" });
        }
        if (answers.length > 10) {
            return res.status(400).json({ error: "Maximum 10 questions allowed per rating" });
        }
        for (const a of answers) {
            if (!a.questionId || a.score < 1 || a.score > 10) {
                return res.status(400).json({ error: "Each answer must have questionId and score between 1-10" });
            }
        }
        const start = new Date(weekStartDate);
        const end = new Date(weekEndDate);
        const raterType = Number(employeeId) === Number(ratedBy) ? "SELF" : "MANAGER";
        const overallScore = Math.round((answers.reduce((sum, a) => sum + a.score, 0) / answers.length) * 10);
        const existing = yield prisma_1.prisma.weeklyPerformanceRating.findUnique({
            where: {
                employeeId_weekStartDate_raterType: {
                    employeeId: Number(employeeId),
                    weekStartDate: start,
                    raterType: raterType,
                },
            },
        });
        let rating;
        if (existing) {
            yield prisma_1.prisma.weeklyRatingAnswer.deleteMany({ where: { ratingId: existing.id } });
            rating = yield prisma_1.prisma.weeklyPerformanceRating.update({
                where: { id: existing.id },
                data: {
                    overallScore,
                    managerRemarks: managerRemarks || null,
                    status: status || "SUBMITTED",
                    answers: {
                        create: answers.map((a) => ({
                            questionId: a.questionId,
                            score: a.score,
                            remarks: a.remarks || null,
                        })),
                    },
                },
                include: { answers: { include: { question: true } } },
            });
        }
        else {
            rating = yield prisma_1.prisma.weeklyPerformanceRating.create({
                data: {
                    employeeId: Number(employeeId),
                    ratedBy: Number(ratedBy),
                    raterType: raterType,
                    weekStartDate: start,
                    weekEndDate: end,
                    weekLabel: getWeekLabel(start),
                    overallScore,
                    managerRemarks: managerRemarks || null,
                    status: status || "SUBMITTED",
                    answers: {
                        create: answers.map((a) => ({
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
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.submitRating = submitRating;
// Get single rating detail
const getRatingDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const rating = yield prisma_1.prisma.weeklyPerformanceRating.findUnique({
            where: { id },
            include: {
                employee: { select: { employeeCode: true, firstName: true, lastName: true, Department: { select: { name: true } } } },
                answers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
            },
        });
        if (!rating)
            return res.status(404).json({ error: "Rating not found" });
        return res.json(rating);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getRatingDetail = getRatingDetail;
// Employee: Get weekly ratings RECEIVED FROM MANAGER (only manager-type, not own self ratings)
const getMyRatings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const empId = Number((_a = req.user) === null || _a === void 0 ? void 0 : _a.empId);
        if (!empId)
            return res.status(401).json({ error: "Unauthorized" });
        const ratings = yield prisma_1.prisma.weeklyPerformanceRating.findMany({
            where: { employeeId: empId, status: "SUBMITTED", raterType: "MANAGER" },
            include: {
                answers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
            },
            orderBy: { weekStartDate: "desc" },
        });
        const raterIds = [...new Set(ratings.map(r => r.ratedBy))];
        const raters = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: raterIds } },
            select: { id: true, firstName: true, lastName: true },
        });
        const raterMap = new Map(raters.map(r => [r.id, `${r.firstName} ${r.lastName}`]));
        return res.json(ratings.map(r => { var _a; return (Object.assign(Object.assign({}, r), { ratedByName: (_a = raterMap.get(r.ratedBy)) !== null && _a !== void 0 ? _a : '' })); }));
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getMyRatings = getMyRatings;
// HR: Get all ratings (filterable)
const getAllRatings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, ratedBy, weekStartDate, departmentId, status } = req.query;
        const where = {};
        if (employeeId)
            where.employeeId = Number(employeeId);
        if (ratedBy)
            where.ratedBy = Number(ratedBy);
        if (status)
            where.status = String(status);
        if (weekStartDate)
            where.weekStartDate = new Date(String(weekStartDate));
        if (departmentId)
            where.employee = { departmentId: Number(departmentId) };
        const ratings = yield prisma_1.prisma.weeklyPerformanceRating.findMany({
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
        const raters = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: raterIds } },
            select: { id: true, firstName: true, lastName: true },
        });
        const raterMap = new Map(raters.map(r => [r.id, `${r.firstName} ${r.lastName}`]));
        const result = ratings.map(r => {
            var _a;
            return (Object.assign(Object.assign({}, r), { ratedByName: (_a = raterMap.get(r.ratedBy)) !== null && _a !== void 0 ? _a : '' }));
        });
        return res.json(result);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getAllRatings = getAllRatings;
// Delete rating (only DRAFT)
const deleteRating = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const rating = yield prisma_1.prisma.weeklyPerformanceRating.findUnique({ where: { id } });
        if (!rating)
            return res.status(404).json({ error: "Rating not found" });
        if (rating.status !== "DRAFT")
            return res.status(400).json({ error: "Can only delete DRAFT ratings" });
        yield prisma_1.prisma.weeklyPerformanceRating.delete({ where: { id } });
        return res.json({ message: "Rating deleted" });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.deleteRating = deleteRating;
// ═══════════════════════════════════════════════════════════════════════════
// SELF-RATING (Employee fills for themselves)
// ═══════════════════════════════════════════════════════════════════════════
// Get logged-in employee's self-rating for a specific week (to resume / view)
const getMySelfRatingForWeek = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const empId = Number((_a = req.user) === null || _a === void 0 ? void 0 : _a.empId);
        if (!empId)
            return res.status(401).json({ error: "Unauthorized" });
        const weekStartDate = req.query.weekStartDate ? new Date(String(req.query.weekStartDate)) : null;
        if (!weekStartDate)
            return res.status(400).json({ error: "weekStartDate is required" });
        const rating = yield prisma_1.prisma.weeklyPerformanceRating.findUnique({
            where: {
                employeeId_weekStartDate_raterType: {
                    employeeId: empId,
                    weekStartDate,
                    raterType: "SELF",
                },
            },
            include: {
                answers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
            },
        });
        return res.json(rating);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getMySelfRatingForWeek = getMySelfRatingForWeek;
// Get all self-ratings for the logged-in employee (history)
const getMySelfRatings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const empId = Number((_a = req.user) === null || _a === void 0 ? void 0 : _a.empId);
        if (!empId)
            return res.status(401).json({ error: "Unauthorized" });
        const ratings = yield prisma_1.prisma.weeklyPerformanceRating.findMany({
            where: { employeeId: empId, raterType: "SELF" },
            include: {
                answers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
            },
            orderBy: { weekStartDate: "desc" },
        });
        return res.json(ratings);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getMySelfRatings = getMySelfRatings;
// ═══════════════════════════════════════════════════════════════════════════
// MANAGEMENT — Side-by-side comparison of self vs manager ratings
// ═══════════════════════════════════════════════════════════════════════════
const getComparison = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        const weekStartParam = req.query.weekStartDate ? String(req.query.weekStartDate) : null;
        const where = { employeeId };
        if (weekStartParam) {
            // Match by date-range to avoid IST vs UTC mismatches in storage.
            // A week starting on "2026-04-20" in IST may be stored as "2026-04-19 18:30 UTC".
            // So we match anything within a 48-hour window around the requested date.
            const base = new Date(weekStartParam + "T00:00:00.000Z");
            const rangeStart = new Date(base.getTime() - 12 * 3600000); // 12h before UTC midnight
            const rangeEnd = new Date(base.getTime() + 36 * 3600000); // 36h after UTC midnight
            where.weekStartDate = { gte: rangeStart, lte: rangeEnd };
        }
        const ratings = yield prisma_1.prisma.weeklyPerformanceRating.findMany({
            where,
            include: {
                answers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
            },
            orderBy: { weekStartDate: "desc" },
        });
        // Group by IST calendar date of weekStartDate so self & manager ratings
        // for the same week merge even if stored at slightly different timestamps
        // (e.g. self at 18:30 UTC = IST midnight, manager at 00:00 UTC).
        const istDateKey = (d) => {
            const ist = new Date(d.getTime() + 5.5 * 3600000);
            return ist.toISOString().slice(0, 10); // YYYY-MM-DD (IST)
        };
        const byWeek = {};
        for (const r of ratings) {
            const key = istDateKey(r.weekStartDate);
            if (!byWeek[key]) {
                byWeek[key] = { self: null, manager: null, weekStartDate: r.weekStartDate, weekEndDate: r.weekEndDate };
            }
            if (r.raterType === "SELF")
                byWeek[key].self = r;
            else
                byWeek[key].manager = r;
        }
        // Build per-question comparison for each week
        const result = Object.values(byWeek).map((wk) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
            const allQuestions = new Map();
            const selfAnswers = new Map();
            const mgrAnswers = new Map();
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
                var _a, _b, _c, _d, _e, _f;
                const s = (_a = selfAnswers.get(q.id)) !== null && _a !== void 0 ? _a : null;
                const m = (_b = mgrAnswers.get(q.id)) !== null && _b !== void 0 ? _b : null;
                return {
                    questionId: q.id,
                    questionText: q.text,
                    selfScore: (_c = s === null || s === void 0 ? void 0 : s.score) !== null && _c !== void 0 ? _c : null,
                    managerScore: (_d = m === null || m === void 0 ? void 0 : m.score) !== null && _d !== void 0 ? _d : null,
                    delta: s && m ? m.score - s.score : null,
                    selfRemarks: (_e = s === null || s === void 0 ? void 0 : s.remarks) !== null && _e !== void 0 ? _e : null,
                    managerRemarks: (_f = m === null || m === void 0 ? void 0 : m.remarks) !== null && _f !== void 0 ? _f : null,
                };
            });
            return {
                weekStartDate: wk.weekStartDate,
                weekEndDate: wk.weekEndDate,
                weekLabel: (_d = (_b = (_a = wk.self) === null || _a === void 0 ? void 0 : _a.weekLabel) !== null && _b !== void 0 ? _b : (_c = wk.manager) === null || _c === void 0 ? void 0 : _c.weekLabel) !== null && _d !== void 0 ? _d : null,
                selfOverallScore: (_f = (_e = wk.self) === null || _e === void 0 ? void 0 : _e.overallScore) !== null && _f !== void 0 ? _f : null,
                managerOverallScore: (_h = (_g = wk.manager) === null || _g === void 0 ? void 0 : _g.overallScore) !== null && _h !== void 0 ? _h : null,
                managerRemarks: (_k = (_j = wk.manager) === null || _j === void 0 ? void 0 : _j.managerRemarks) !== null && _k !== void 0 ? _k : null,
                selfRemarks: (_m = (_l = wk.self) === null || _l === void 0 ? void 0 : _l.managerRemarks) !== null && _m !== void 0 ? _m : null, // self uses same remarks field
                comparison,
            };
        });
        return res.json(result);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getComparison = getComparison;
