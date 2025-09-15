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
exports.getAllAttempts = void 0;
exports.getAssignedTest = getAssignedTest;
exports.submitAttempt = submitAttempt;
exports.getAssignedTestsForEmployee = getAssignedTestsForEmployee;
exports.startAssignedTestAttempt = startAssignedTestAttempt;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
function getAssignedTest(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const assignmentId = Number(req.params.id);
        const assignment = yield prisma.assignedTest.findUnique({
            where: { id: assignmentId },
            include: {
                test: true
            }
        });
        if (!assignment) {
            return res.status(404).json({ error: 'Assigned test not found' });
        }
        // ✅ Fetch questions using the test's questionBankId
        const questions = yield prisma.question.findMany({
            where: { questionBankId: assignment.test.questionBankId },
            include: { options: true }
        });
        res.json(Object.assign(Object.assign({}, assignment), { test: Object.assign(Object.assign({}, assignment.test), { questions // attach questions dynamically
             }) }));
    });
}
// POST /api/attempts/submit
// body: { attemptId, assignedTestId, responses, score }
function submitAttempt(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { attemptId, assignedTestId, responses, score } = req.body;
        try {
            yield prisma.$transaction([
                prisma.evaluationAttempt.update({
                    where: { id: Number(attemptId) },
                    data: {
                        score: Number(score) || 0,
                        status: 'Completed',
                        response: JSON.stringify(responses !== null && responses !== void 0 ? responses : {}),
                    },
                }),
                prisma.assignedTest.update({
                    where: { id: Number(assignedTestId) },
                    data: { status: 'Completed', completedAt: new Date() },
                }),
            ]);
            res.json({ ok: true });
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to submit attempt' });
        }
    });
}
function getAssignedTestsForEmployee(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const employeeId = Number(req.params.employeeId);
        const assignedTests = yield prisma.assignedTest.findMany({
            where: { employeeId },
            include: { test: true },
            orderBy: { assignedAt: 'desc' },
        });
        // count attempts by (employeeId,testId)
        const counts = yield prisma.evaluationAttempt.groupBy({
            by: ['testId'],
            where: { employeeId },
            _count: { _all: true },
        });
        const countMap = new Map();
        counts.forEach(c => countMap.set(c.testId, c._count._all));
        const enriched = assignedTests.map(a => {
            var _a, _b;
            const attemptsMade = (_a = countMap.get(a.testId)) !== null && _a !== void 0 ? _a : 0;
            return Object.assign(Object.assign({}, a), { attemptsMade, canStart: attemptsMade < ((_b = a.test.maxAttempts) !== null && _b !== void 0 ? _b : 1) });
        });
        res.json(enriched);
    });
}
// GET /api/evaluation-attempts
const getAllAttempts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const attempts = yield prisma.evaluationAttempt.findMany({
            include: {
                employee: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(attempts);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch attempts' });
    }
});
exports.getAllAttempts = getAllAttempts;
function startAssignedTestAttempt(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const assignedTestId = Number(req.params.id);
        try {
            const assigned = yield prisma.assignedTest.findUnique({
                where: { id: assignedTestId },
                include: { test: true },
            });
            if (!assigned)
                return res.status(404).json({ error: 'Assigned test not found' });
            // If you use auth, derive employeeId from token; otherwise trust the row
            const employeeId = assigned.employeeId;
            // Count current attempts (by employee+test)
            const attemptsMade = yield prisma.evaluationAttempt.count({
                where: { employeeId, testId: assigned.testId },
            });
            if (attemptsMade >= ((_a = assigned.test.maxAttempts) !== null && _a !== void 0 ? _a : 1)) {
                return res.status(409).json({ error: 'Max attempts reached' });
            }
            // Do both actions together
            const [attempt] = yield prisma.$transaction([
                prisma.evaluationAttempt.create({
                    data: {
                        employeeId,
                        testId: assigned.testId,
                        score: 0, // placeholder until submit
                        status: 'InProgress',
                        response: null, // fill on submit
                    },
                }),
                prisma.assignedTest.update({
                    where: { id: assignedTestId },
                    data: {
                        attempts: { increment: 1 }, // keep counter in sync
                        status: 'InProgress',
                        startedAt: new Date(),
                    },
                }),
            ]);
            return res.status(201).json({ attemptId: attempt.id });
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ error: 'Failed to start attempt' });
        }
    });
}
