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
exports.getSurveyQuestions = getSurveyQuestions;
exports.submitSurvey = submitSurvey;
exports.getSurveyResults = getSurveyResults;
exports.getAllSurveys = getAllSurveys;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// ================== GET QUESTIONS ==================
function getSurveyQuestions(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const questions = yield prisma.surveyQuestion.findMany({
                orderBy: { orderNo: "asc" },
            });
            return res.json(questions);
        }
        catch (e) {
            console.error("getSurveyQuestions error:", e);
            return res
                .status(500)
                .json({ error: (e === null || e === void 0 ? void 0 : e.message) || "Failed to fetch questions" });
        }
    });
}
// ================== SUBMIT SURVEY ==================
function submitSurvey(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { employeeId, answers } = req.body;
            if (!employeeId || !Array.isArray(answers) || !answers.length) {
                return res
                    .status(400)
                    .json({ error: "employeeId and answers[] are required" });
            }
            const survey = yield prisma.employeeSurvey.create({
                data: {
                    date: new Date(),
                    employee: {
                        connect: { id: Number(employeeId) } // or the correct unique field
                    },
                    responses: {
                        create: answers.map((a) => ({
                            questionId: a.questionId,
                            answer: a.answer,
                        })),
                    },
                },
            });
            return res.json({ success: true, surveyId: survey.id });
        }
        catch (e) {
            console.error("submitSurvey error:", e);
            return res
                .status(500)
                .json({ error: (e === null || e === void 0 ? void 0 : e.message) || "Failed to submit survey" });
        }
    });
}
// ================== GET SURVEY RESULTS ==================
function getSurveyResults(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const surveyId = Number(req.params.surveyId);
            if (Number.isNaN(surveyId)) {
                return res.status(400).json({ error: "Invalid surveyId" });
            }
            const survey = yield prisma.employeeSurvey.findUnique({
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
            if (!survey)
                return res.status(404).json({ error: "Survey not found" });
            return res.json(survey);
        }
        catch (e) {
            console.error("getSurveyResults error:", e);
            return res
                .status(500)
                .json({ error: (e === null || e === void 0 ? void 0 : e.message) || "Failed to fetch survey" });
        }
    });
}
// ================== ADMIN: ALL SURVEYS ==================
function getAllSurveys(_req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const all = yield prisma.employeeSurvey.findMany({
                include: {
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            Department: {
                                select: { name: true }
                            }
                        },
                    },
                    responses: { include: { question: true } },
                },
                orderBy: { createdAt: "desc" },
            });
            return res.json(all);
        }
        catch (e) {
            console.error("getAllSurveys error:", e);
            return res
                .status(500)
                .json({ error: (e === null || e === void 0 ? void 0 : e.message) || "Failed to fetch surveys" });
        }
    });
}
