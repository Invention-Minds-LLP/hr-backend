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
exports.getAssignedTestOverview = exports.getAssignedTests = exports.assignTestToEmployees = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const leave_controller_1 = require("../leave/leave.controller");
const TEST_ASSIGNED_TEMPLATE_ID = '888289';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
function formatPhoneNumber(raw) {
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.startsWith("91"))
        return `+${digits}`;
    if (digits.startsWith("0"))
        return `+91${digits.slice(1)}`;
    if (digits.length === 10)
        return `+91${digits}`;
    if (digits.startsWith("+"))
        return digits;
    return `+${digits}`;
}
const assignTestToEmployees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { testId, employeeIds, assignedBy, deadlineDate, testDate } = req.body;
        const data = employeeIds.map((employeeId) => ({
            testId,
            employeeId,
            assignedBy,
            deadlineDate,
            testDate,
            status: 'NotStarted'
        }));
        yield prisma.assignedTest.createMany({ data });
        // Fetch test name (and fallback schedule)
        const test = yield prisma.evaluationTest.findUnique({
            where: { id: Number(testId) },
            select: { name: true, activeFrom: true }
        });
        // Fetch employees’ names & phones
        const employees = yield prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: { firstName: true, lastName: true, phone: true }
        });
        const scheduleSrc = (_a = testDate !== null && testDate !== void 0 ? testDate : test === null || test === void 0 ? void 0 : test.activeFrom) !== null && _a !== void 0 ? _a : null;
        const dateLabel = fmtDate(scheduleSrc) || "-";
        const timeLabel = fmtTime(scheduleSrc) || "-";
        const testName = (test === null || test === void 0 ? void 0 : test.name) || "-";
        // Fire-and-forget WhatsApp (don’t fail API if a send fails)
        yield Promise.all(employees.map((emp) => __awaiter(void 0, void 0, void 0, function* () {
            const to = formatPhoneNumber(emp.phone || "");
            if (!to)
                return;
            const employeeName = [emp.firstName, emp.lastName].filter(Boolean).join(" ");
            try {
                yield (0, leave_controller_1.sendWhatsAppTemplate)({
                    to,
                    templateId: TEST_ASSIGNED_TEMPLATE_ID,
                    placeholders: [employeeName, testName, dateLabel]
                });
            }
            catch (e) {
                console.error("Test assignment WA send failed:", e);
            }
        })));
        res.json({ message: 'Test assigned to employees' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to assign test' });
    }
});
exports.assignTestToEmployees = assignTestToEmployees;
// export const getAssignedTests = async (req: Request, res: Response) => {
//   try {
//     const assignments = await prisma.assignedTest.findMany({
//       include: { employee: true, test: true }
//     });
//     res.json(assignments);
//   } catch (error) {
//     res.status(500).json({ error: 'Failed to fetch assignments' });
//   }
// };
const getAssignedTests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1) Assignments with employee & test (need passingPercent)
        const assignments = yield prisma.assignedTest.findMany({
            include: { employee: true, test: true },
            orderBy: { assignedAt: 'desc' },
        });
        if (assignments.length === 0)
            return res.json([]);
        // 2) Pull all attempts for the employee/test pairs, newest first
        const employeeIds = Array.from(new Set(assignments.map(a => a.employeeId)));
        const testIds = Array.from(new Set(assignments.map(a => a.testId)));
        const attempts = yield prisma.evaluationAttempt.findMany({
            where: {
                employeeId: { in: employeeIds },
                testId: { in: testIds },
            },
            orderBy: { createdAt: 'desc' }, // newest first
            select: { id: true, employeeId: true, testId: true, score: true, status: true, createdAt: true },
        });
        // 3) Latest attempt per (employeeId:testId)
        const latestAttemptMap = new Map();
        for (const att of attempts) {
            const key = `${att.employeeId}:${att.testId}`;
            if (!latestAttemptMap.has(key))
                latestAttemptMap.set(key, att); // first (newest) wins
        }
        // 4) Enrich each assignment
        const enriched = assignments.map(a => {
            var _a, _b, _c;
            const key = `${a.employeeId}:${a.testId}`;
            const latest = latestAttemptMap.get(key) || null;
            const score = (_a = latest === null || latest === void 0 ? void 0 : latest.score) !== null && _a !== void 0 ? _a : null;
            const passThreshold = (_c = (_b = a.test) === null || _b === void 0 ? void 0 : _b.passingPercent) !== null && _c !== void 0 ? _c : null;
            // Assumes score is already a percentage (0–100). If not, adjust here.
            const pass = score !== null && passThreshold !== null ? Number(score) >= Number(passThreshold) : null;
            return Object.assign(Object.assign({}, a), { latestAttempt: latest, latestScore: score, result: pass === null ? null : pass ? 'Pass' : 'Fail' });
        });
        res.json(enriched);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch assignments' });
    }
});
exports.getAssignedTests = getAssignedTests;
const getAssignedTestOverview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const assignedTestId = Number(req.params.id);
        const assignment = yield prisma.assignedTest.findUnique({
            where: { id: assignedTestId },
            include: { employee: true, test: true },
        });
        if (!assignment)
            return res.status(404).json({ error: 'Assignment not found' });
        // latest attempt for this employee+test
        const attempt = yield prisma.evaluationAttempt.findFirst({
            where: { employeeId: assignment.employeeId, testId: assignment.testId },
            orderBy: { createdAt: 'desc' },
        });
        if (!attempt) {
            return res.json({
                assignmentId: assignment.id,
                attemptId: null,
                startedAt: assignment.startedAt,
                completedAt: assignment.completedAt,
                employeeName: `${assignment.employee.firstName} ${assignment.employee.lastName}`,
                testId: assignment.testId,
                testName: assignment.test.name,
                timeTakenSec: timeDiffSec(assignment.startedAt, assignment.completedAt),
                totals: { total: 0, autoGradable: 0, correct: 0, wrong: 0, unanswered: 0 },
                rows: [],
            });
        }
        // questions from the bank used by this test
        const questions = yield prisma.question.findMany({
            where: { questionBankId: assignment.test.questionBankId },
            include: { options: true },
        });
        const responses = (_a = safeParse(attempt.response)) !== null && _a !== void 0 ? _a : [];
        const byQ = new Map(responses.map(r => [Number(r.questionId), r]));
        let correct = 0, wrong = 0, unanswered = 0, autoGradable = 0;
        const rows = questions.map((q, idx) => {
            var _a;
            const r = byQ.get(q.id);
            const type = (q.type || '').toUpperCase(); // 'MCQ'|'DESCRIPTIVE'
            const correctIds = q.options.filter(o => o.isCorrect).map(o => o.id).sort((a, b) => a - b);
            let selectedIds = [];
            if (r) {
                if (Array.isArray(r.answer))
                    selectedIds = r.answer.map(Number).sort((a, b) => a - b);
                else if (typeof r.answer === 'string' && r.answer.trim())
                    selectedIds = []; // descriptive text
            }
            let isCorrect = null;
            if (type === 'MCQ') {
                autoGradable++;
                if (!r || (Array.isArray(r.answer) && r.answer.length === 0)) {
                    unanswered++;
                    isCorrect = false;
                }
                else {
                    isCorrect = JSON.stringify(selectedIds) === JSON.stringify(correctIds);
                    isCorrect ? correct++ : wrong++;
                }
            }
            else {
                // descriptive → not auto-graded here
                isCorrect = null;
            }
            return {
                no: idx + 1,
                questionId: q.id,
                text: q.text,
                type,
                selectedOptionIds: selectedIds,
                selectedOptionTexts: q.options.filter(o => selectedIds.includes(o.id)).map(o => o.text),
                correctOptionIds: correctIds,
                correctOptionTexts: q.options.filter(o => correctIds.includes(o.id)).map(o => o.text),
                isCorrect, // true/false/null
                rawAnswer: !Array.isArray(r === null || r === void 0 ? void 0 : r.answer) ? ((_a = r === null || r === void 0 ? void 0 : r.answer) !== null && _a !== void 0 ? _a : '') : null, // descriptive text if any
            };
        });
        const startedAt = assignment.startedAt;
        const completedAt = assignment.completedAt;
        const timeTakenSec = timeDiffSec(startedAt, completedAt);
        res.json({
            assignmentId: assignment.id,
            attemptId: attempt.id,
            startedAt,
            completedAt,
            timeTakenSec,
            totals: {
                total: questions.length,
                autoGradable,
                correct,
                wrong,
                unanswered,
            },
            rows,
            employeeName: `${assignment.employee.firstName} ${assignment.employee.lastName}`,
            testId: assignment.testId,
            testName: assignment.test.name,
        });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to build overview' });
    }
});
exports.getAssignedTestOverview = getAssignedTestOverview;
function safeParse(s) {
    try {
        return typeof s === 'string' ? JSON.parse(s) : s;
    }
    catch (_a) {
        return null;
    }
}
function timeDiffSec(start, end) {
    if (!start || !end)
        return null;
    return Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}
