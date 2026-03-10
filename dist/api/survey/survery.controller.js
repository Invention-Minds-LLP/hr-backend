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
exports.initSurveyScheduler = void 0;
exports.getSurveyQuestions = getSurveyQuestions;
exports.submitSurvey = submitSurvey;
exports.getSurveyResults = getSurveyResults;
exports.getAllSurveys = getAllSurveys;
exports.getDraftSurveys = getDraftSurveys;
// import { PrismaClient } from "@prisma/client";
const node_cron_1 = __importDefault(require("node-cron"));
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
// ================== GET QUESTIONS ==================
function getSurveyQuestions(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const questions = yield prisma_1.prisma.surveyQuestion.findMany({
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
function submitSurvey(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { surveyId, employeeId, answers } = req.body;
            if (!surveyId || !employeeId || !Array.isArray(answers) || !answers.length) {
                return res.status(400).json({ error: "surveyId, employeeId and answers[] are required" });
            }
            // 1️⃣ Check if survey exists and is still DRAFT
            const survey = yield prisma_1.prisma.employeeSurvey.findUnique({
                where: { id: Number(surveyId) },
            });
            if (!survey) {
                return res.status(404).json({ error: "Survey not found" });
            }
            if (survey.status !== "DRAFT") {
                return res.status(400).json({ error: "Survey already submitted" });
            }
            // 2️⃣ Update survey + create responses
            const updatedSurvey = yield prisma_1.prisma.employeeSurvey.update({
                where: { id: Number(surveyId) },
                data: {
                    status: "SUBMITTED",
                    submittedAt: new Date(),
                    responses: {
                        create: answers.map((a) => ({
                            questionId: a.questionId,
                            answer: a.answer,
                        })),
                    },
                },
            });
            // 3️⃣ Notify HR
            try {
                // get employee details
                const emp = yield prisma_1.prisma.employee.findUnique({
                    where: { id: Number(employeeId) },
                    select: {
                        firstName: true,
                        lastName: true,
                        employeeCode: true,
                    },
                });
                if (emp) {
                    const hrIds = yield getHRIds();
                    const empName = `${emp.firstName} ${emp.lastName}`;
                    const message = `Survey submitted by ${empName} (${emp.employeeCode}).`;
                    // for (const hrId of hrIds) {
                    //   await createNotification(hrId, message);
                    // }
                }
            }
            catch (err) {
                console.error("Survey notification failed:", err);
            }
            return res.json({
                success: true,
                surveyId: updatedSurvey.id,
                message: "Survey submitted successfully",
            });
        }
        catch (e) {
            console.error("submitSurvey error:", e);
            return res.status(500).json({ error: e.message || "Failed to submit survey" });
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
            const survey = yield prisma_1.prisma.employeeSurvey.findUnique({
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
            const all = yield prisma_1.prisma.employeeSurvey.findMany({
                include: {
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            gender: true,
                            photoUrl: true,
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
/**
 * Runs every day at midnight
 * Creates surveys for employees whose next survey date == today
 */
const initSurveyScheduler = () => {
    node_cron_1.default.schedule("0 0 * * *", () => __awaiter(void 0, void 0, void 0, function* () {
        console.log("🕐 Running 6-month Employee Survey Scheduler...");
        try {
            const today = new Date();
            const todayStr = today.toISOString().split("T")[0]; // YYYY-MM-DD
            // Get all active employees
            const activeEmployees = yield prisma_1.prisma.employee.findMany({
                where: { employmentStatus: "ACTIVE" },
                select: { id: true, dateOfJoining: true, firstName: true, lastName: true },
            });
            for (const emp of activeEmployees) {
                // 1️⃣ Get the latest survey
                const lastSurvey = yield prisma_1.prisma.employeeSurvey.findFirst({
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
                    yield prisma_1.prisma.employeeSurvey.create({
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
                    }
                    catch (err) {
                        console.error(`Notification failed for employee ${emp.id}:`, err);
                    }
                }
            }
            console.log("🎯 Employee survey scheduling complete.");
        }
        catch (error) {
            console.error("❌ Error running survey scheduler:", error);
        }
    }));
};
exports.initSurveyScheduler = initSurveyScheduler;
// ================== GET DRAFT SURVEYS (BY EMPLOYEE) ==================
function getDraftSurveys(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const employeeId = Number(req.query.employeeId);
            if (!employeeId || Number.isNaN(employeeId)) {
                return res.status(400).json({ error: "Invalid or missing employeeId" });
            }
            const drafts = yield prisma_1.prisma.employeeSurvey.findMany({
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
        }
        catch (error) {
            console.error("getDraftSurveys error:", error);
            return res
                .status(500)
                .json({ error: error.message || "Failed to fetch draft surveys" });
        }
    });
}
function getHRIds() {
    return __awaiter(this, void 0, void 0, function* () {
        const hrs = yield prisma_1.prisma.employee.findMany({
            where: {
                departmentId: 1,
                employmentStatus: 'ACTIVE'
            },
            select: { id: true }
        });
        return hrs.map(h => h.id);
    });
}
