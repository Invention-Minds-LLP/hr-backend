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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateAttempt = exports.reviewAttempt = exports.getAllAttempts = exports.submitAttemptDescriptive = void 0;
exports.getAssignedTest = getAssignedTest;
exports.submitAttempt = submitAttempt;
exports.getAssignedTestsForEmployee = getAssignedTestsForEmployee;
exports.startAssignedTestAttempt = startAssignedTestAttempt;
// import { PrismaClient } from "@prisma/client";
const formidable_1 = __importDefault(require("formidable"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const basic_ftp_1 = require("basic-ftp");
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const FTP_CONFIG = {
    host: "srv680.main-hosting.eu", // Your FTP hostname
    user: "u948610439.hrproindia.in", // Your FTP username
    password: "Bsrenuk@1993", // Your FTP password
    secure: false // Set to true if using FTPS
};
const TEMP_FOLDER = path_1.default.join(__dirname, '../temp'); // absolute path
if (!fs_1.default.existsSync(TEMP_FOLDER)) {
    fs_1.default.mkdirSync(TEMP_FOLDER, { recursive: true });
}
function getAssignedTest(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const assignmentId = Number(req.params.id);
        const assignment = yield prisma_1.prisma.assignedTest.findUnique({
            where: { id: assignmentId },
            include: {
                test: {
                    include: { questions: false } // No need here, you load questionBank separately
                }
            }
        });
        if (!assignment) {
            return res.status(404).json({ error: 'Assigned test not found' });
        }
        // ✅ Fetch questions using the test's questionBankId
        const questions = yield prisma_1.prisma.question.findMany({
            where: { questionBankId: assignment.test.questionBankId },
            include: { options: true }
        });
        const totalAttempts = assignment.test.maxAttempts; // Allowed attempts from test
        const attemptsTaken = assignment.attempts; // Attempts used
        res.json(Object.assign(Object.assign({}, assignment), { attemptsInfo: {
                totalAttempts,
                attemptsTaken,
                attemptsLeft: totalAttempts - attemptsTaken
            }, test: Object.assign(Object.assign({}, assignment.test), { questions // attach questions dynamically
             }) }));
    });
}
// POST /api/attempts/submit
// body: { attemptId, assignedTestId, responses, score }
function submitAttempt(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { attemptId, assignedTestId, responses, score } = req.body;
        try {
            yield prisma_1.prisma.$transaction([
                prisma_1.prisma.evaluationAttempt.update({
                    where: { id: Number(attemptId) },
                    data: {
                        score: Number(score) || 0,
                        status: 'Completed',
                        response: JSON.stringify(responses !== null && responses !== void 0 ? responses : {}),
                    },
                }),
                prisma_1.prisma.assignedTest.update({
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
function sanitizeFileName(fileName) {
    return fileName.replace(/\s+/g, '_'); // replace spaces with underscore
}
function uploadToFTP(localFilePath, remoteFileName) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = false;
        try {
            yield client.access(FTP_CONFIG);
            const folder = path_1.default.dirname(remoteFileName);
            yield client.ensureDir(folder);
            console.log(remoteFileName);
            yield client.uploadFrom(localFilePath, remoteFileName);
            yield client.close();
            // return `https://hrproindia.in/documents/${remoteFileName}`; // public URL
        }
        catch (error) {
            console.error("FTP Upload Error:", error);
            throw new Error("FTP upload failed");
        }
    });
}
const submitAttemptDescriptive = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const form = (0, formidable_1.default)({
            uploadDir: TEMP_FOLDER,
            keepExtensions: true,
            multiples: true,
        });
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            if (err)
                return res.status(500).json({ error: err.message });
            const attemptId = Number(fields.attemptId);
            const assignedTestId = Number(fields.assignedTestId);
            const testId = Number(fields.testId);
            const rawResponses = Array.isArray(fields.responses)
                ? fields.responses[0] // formidable sometimes gives array
                : (_a = fields.responses) !== null && _a !== void 0 ? _a : '[]'; // fallback if undefined
            let responses = JSON.parse(rawResponses);
            // process uploaded files
            for (const [field, fileData] of Object.entries(files)) {
                const file = Array.isArray(fileData) ? fileData[0] : fileData;
                if (!file)
                    continue; // skip if undefined/null
                const tempFilePath = file.filepath;
                const qid = Number(field.replace('file_', ''));
                const fileName = sanitizeFileName((_b = file.originalFilename) !== null && _b !== void 0 ? _b : `ans_${qid}_${Date.now()}.pdf`);
                const remoteFilePath = `/public_html/test-answers/${fileName}`;
                yield uploadToFTP(tempFilePath, remoteFilePath);
                const fileUrl = `https://hrproindia.in/test-answers/${fileName}`;
                fs_1.default.unlinkSync(tempFilePath);
                // inject fileUrl into response
                const r = responses.find((x) => x.questionId === qid);
                if (r)
                    r.fileUrl = fileUrl;
            }
            // detect if descriptive exists
            const hasDescriptive = responses.some((r) => r.fileUrl || (typeof r.answer === 'string' && r.answer.trim().length > 0));
            let score = 0;
            let status = 'Completed';
            if (hasDescriptive) {
                // manual HR scoring later
                status = 'Pending Review';
            }
            else {
                // pure MCQ auto-score
                score = yield calcMCQScore(responses, testId); // implement like your quick scoring
            }
            yield prisma_1.prisma.$transaction([
                prisma_1.prisma.evaluationAttempt.update({
                    where: { id: attemptId },
                    data: {
                        response: JSON.stringify(responses),
                        score,
                        status,
                    },
                }),
                prisma_1.prisma.assignedTest.update({
                    where: { id: assignedTestId },
                    data: { status, completedAt: new Date() },
                }),
            ]);
            return res.json({ ok: true, score, status });
        }));
    }
    catch (error) {
        console.error('Submit Attempt Error:', error);
        return res.status(500).json({ error: 'Failed to submit attempt' });
    }
});
exports.submitAttemptDescriptive = submitAttemptDescriptive;
function calcMCQScore(responses, testId) {
    return __awaiter(this, void 0, void 0, function* () {
        // fetch questions + correct answers from DB
        const test = yield prisma_1.prisma.evaluationTest.findUnique({
            where: { id: testId },
            include: { questions: { include: { options: true } } },
        });
        if (!test)
            return 0;
        let total = 0;
        let correctCount = 0;
        for (const q of test.questions) {
            if (q.type !== 'MCQ')
                continue;
            total++;
            // correct options
            const correct = q.options.filter((o) => o.isCorrect).map((o) => o.id).sort();
            // given options
            const r = responses.find((x) => x.questionId === q.id);
            const selected = Array.isArray(r === null || r === void 0 ? void 0 : r.answer) ? r.answer.slice().sort() : [];
            if (JSON.stringify(correct) === JSON.stringify(selected)) {
                correctCount++;
            }
        }
        return total > 0 ? Math.round((correctCount / total) * 100) : 0;
    });
}
function getAssignedTestsForEmployee(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const employeeId = Number(req.params.employeeId);
        const assignedTests = yield prisma_1.prisma.assignedTest.findMany({
            where: { employeeId },
            include: { test: true },
            orderBy: { assignedAt: 'desc' },
        });
        // count attempts by (employeeId,testId)
        const counts = yield prisma_1.prisma.evaluationAttempt.groupBy({
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
        const attempts = yield prisma_1.prisma.evaluationAttempt.findMany({
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
            const assigned = yield prisma_1.prisma.assignedTest.findUnique({
                where: { id: assignedTestId },
                include: { test: true },
            });
            if (!assigned)
                return res.status(404).json({ error: 'Assigned test not found' });
            // If you use auth, derive employeeId from token; otherwise trust the row
            const employeeId = assigned.employeeId;
            // Count current attempts (by employee+test)
            const attemptsMade = yield prisma_1.prisma.evaluationAttempt.count({
                where: { employeeId, testId: assigned.testId },
            });
            if (attemptsMade >= ((_a = assigned.test.maxAttempts) !== null && _a !== void 0 ? _a : 1)) {
                return res.status(409).json({ error: 'Max attempts reached' });
            }
            // Do both actions together
            const [attempt] = yield prisma_1.prisma.$transaction([
                prisma_1.prisma.evaluationAttempt.create({
                    data: {
                        employeeId,
                        testId: assigned.testId,
                        score: 0, // placeholder until submit
                        status: 'InProgress',
                        response: null, // fill on submit
                    },
                }),
                prisma_1.prisma.assignedTest.update({
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
// POST /api/tests/attempts/:id/review
const reviewAttempt = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const attemptId = Number(req.params.id);
        const { scores, finalScore } = req.body;
        // update scores in responses JSON
        const attempt = yield prisma_1.prisma.evaluationAttempt.findUnique({
            where: { id: attemptId },
        });
        if (!attempt)
            return res.status(404).json({ error: 'Attempt not found' });
        let responses = JSON.parse(attempt.response || '[]');
        for (const s of scores) {
            const r = responses.find((x) => x.questionId === s.questionId);
            if (r)
                r.hrScore = s.hrScore;
        }
        const updated = yield prisma_1.prisma.evaluationAttempt.update({
            where: { id: attemptId },
            data: {
                response: JSON.stringify(responses),
                score: finalScore,
                status: 'Reviewed',
                // reviewedAt: new Date(),
                // reviewedBy: req.user?.id || null, // assuming you have auth
            }
        });
        res.json({ ok: true, attempt: updated });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to review attempt' });
    }
});
exports.reviewAttempt = reviewAttempt;
const evaluateAttempt = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { attemptId, evaluations } = req.body;
        const attempt = yield prisma_1.prisma.evaluationAttempt.findUnique({
            where: { id: attemptId }
        });
        if (!attempt)
            return res.status(404).json({ error: "Attempt not found" });
        let responses = attempt.response ? JSON.parse(attempt.response) : [];
        console.log("Initial Responses:", responses);
        // merge manual scores into responses
        for (const ev of evaluations) {
            const r = responses.find((x) => x.questionId === ev.questionId);
            if (r) {
                r.manualScore = ev.manualScore;
                r.remarks = ev.remarks;
            }
        }
        const test = yield prisma_1.prisma.evaluationTest.findUnique({
            where: { id: attempt.testId },
            include: {
                questions: { include: { options: true } }
            }
        });
        if (!test)
            throw new Error("Test not found");
        let questions = test.questions;
        if (questions.length === 0) {
            const bank = yield prisma_1.prisma.questionBank.findUnique({
                where: { id: test.questionBankId },
                include: { questions: { include: { options: true } } }
            });
            questions = (_a = bank === null || bank === void 0 ? void 0 : bank.questions) !== null && _a !== void 0 ? _a : [];
        }
        // weighted score calculation
        let totalMarks = 0;
        let obtainedMarks = 0;
        for (const q of questions) {
            const qMarks = q.weight || 1; // default 1 if not set
            console.log(`Question ID: ${q.id}, Type: ${q.type}, Weight: ${qMarks}`);
            totalMarks += qMarks;
            console.log(`Accumulated Total Marks: ${totalMarks}`);
            console.log(`Evaluating QID ${q.id}`, responses);
            const r = responses.find((x) => x.questionId === q.id);
            console.log(`Response for QID ${q.id}:`, r);
            if (q.type === "MCQ") {
                const correctIds = q.options.filter(o => o.isCorrect).map(o => o.id).sort();
                const selected = Array.isArray(r === null || r === void 0 ? void 0 : r.answer) ? r.answer.slice().sort() : [];
                if (JSON.stringify(correctIds) === JSON.stringify(selected)) {
                    obtainedMarks += qMarks;
                    if (r)
                        r.isCorrect = true;
                }
                else {
                    if (r)
                        r.isCorrect = false;
                }
            }
            else if (q.type === "DESCRIPTIVE") {
                console.log(`Evaluating Descriptive QID ${q.id}`, r.manualScore, r);
                if ((r === null || r === void 0 ? void 0 : r.manualScore) != null) {
                    console.log(`Descriptive QID ${q.id} has manual score: ${r.manualScore}`);
                    // manualScore is awarded out of qMarks
                    obtainedMarks += Math.min(r.manualScore, qMarks);
                    console.log(`Descriptive QID ${q.id} awarded ${r.manualScore}/${qMarks}`);
                }
            }
        }
        console.log(`Total Marks: ${totalMarks}, Obtained Marks: ${obtainedMarks}`);
        const finalScore = totalMarks > 0
            ? Math.round((obtainedMarks / totalMarks) * 100)
            : 0;
        yield prisma_1.prisma.evaluationAttempt.update({
            where: { id: attemptId },
            data: {
                response: JSON.stringify(responses),
                score: finalScore,
                status: "Reviewed", // better than "Completed"
            }
        });
        res.json({ ok: true, finalScore, obtainedMarks, totalMarks });
    }
    catch (err) {
        console.error("Manual evaluation error:", err);
        res.status(500).json({ error: "Failed to evaluate" });
    }
});
exports.evaluateAttempt = evaluateAttempt;
