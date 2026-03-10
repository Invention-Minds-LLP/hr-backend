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
exports.getAllSummaries = exports.assignFormToEmployee = exports.submitFullForm = exports.getEmployeeForm = exports.submitFinalReview = exports.submitSummary = exports.submitResponses = exports.getTemplateByDept = exports.createTemplate = void 0;
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
// Create a template
const createTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { departmentId, cycle, questions } = req.body;
        const template = yield prisma_1.prisma.performanceFormTemplate.create({
            data: {
                departmentId,
                cycle,
                questions: { create: questions }
            },
            include: { questions: true }
        });
        res.json(template);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.createTemplate = createTemplate;
// Fetch template
const getTemplateByDept = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { departmentId, cycle } = req.params; // or req.query if you switched
        const template = yield prisma_1.prisma.performanceFormTemplate.findFirst({
            where: { departmentId: Number(departmentId), cycle },
            include: {
                questions: true,
                department: true // 👈 include department details
            }
        });
        res.json(template);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getTemplateByDept = getTemplateByDept;
// Submit per-question responses
const submitResponses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, departmentId, cycle, responses } = req.body;
        yield prisma_1.prisma.performanceResponse.createMany({
            data: responses.map((r) => ({
                employeeId,
                departmentId,
                cycle,
                questionId: r.questionId,
                period: r.period,
                score: r.score,
                reviewerId: r.reviewerId,
                comments: r.comments
            }))
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.submitResponses = submitResponses;
// Submit summary
const submitSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, departmentId, cycle, summaries } = req.body;
        yield prisma_1.prisma.performanceSummary.createMany({
            data: summaries.map((s) => ({
                employeeId,
                departmentId,
                cycle,
                period: s.period,
                marksScored: s.marksScored,
                overallPerf: s.overallPerf,
                employeeSig: s.employeeSig,
                supervisorSig: s.supervisorSig,
                hodSig: s.hodSig
            }))
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.submitSummary = submitSummary;
// Submit final review
const submitFinalReview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, departmentId, cycle, appreciations, talents, overallComments, employeeSig, supervisorSig, hrSig } = req.body;
        const review = yield prisma_1.prisma.performanceFinalReview.create({
            data: { employeeId, departmentId, cycle, appreciations, talents, overallComments, employeeSig, supervisorSig, hrSig }
        });
        res.json(review);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.submitFinalReview = submitFinalReview;
const getEmployeeForm = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, departmentId, cycle } = req.params;
        const template = yield prisma_1.prisma.performanceFormTemplate.findFirst({
            where: { departmentId: Number(departmentId), cycle },
            include: { questions: true, department: true }
        });
        if (!template)
            return res.status(404).json({ error: "Template not found" });
        const employee = yield prisma_1.prisma.employee.findUnique({
            where: { id: Number(employeeId) },
            include: { Department: true }
        });
        const responses = yield prisma_1.prisma.performanceResponse.findMany({
            where: { employeeId: Number(employeeId), departmentId: Number(departmentId), cycle }
        });
        const summaries = yield prisma_1.prisma.performanceSummary.findMany({
            where: { employeeId: Number(employeeId), departmentId: Number(departmentId), cycle }
        });
        const finalReview = yield prisma_1.prisma.performanceFinalReview.findFirst({
            where: { employeeId: Number(employeeId), departmentId: Number(departmentId), cycle }
        });
        res.json({
            template,
            employee, // 👈 added
            responses,
            summaries,
            finalReview
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getEmployeeForm = getEmployeeForm;
const submitFullForm = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const data = req.body;
        // 1) Save question responses
        if ((_a = data.responses) === null || _a === void 0 ? void 0 : _a.length) {
            yield prisma_1.prisma.performanceResponse.createMany({
                data: data.responses.map((r) => ({
                    employeeId: data.employeeId,
                    departmentId: data.departmentId,
                    cycle: data.cycle,
                    questionId: r.questionId,
                    period: r.period,
                    score: r.score,
                    reviewerId: r.reviewerId,
                    comments: r.comments
                }))
            });
        }
        // 2) Save overall summaries
        if ((_b = data.summaries) === null || _b === void 0 ? void 0 : _b.length) {
            yield prisma_1.prisma.performanceSummary.createMany({
                data: data.summaries.map((s) => ({
                    employeeId: data.employeeId,
                    departmentId: data.departmentId,
                    cycle: data.cycle,
                    period: s.period,
                    marksScored: s.marksScored,
                    overallPerf: s.overallPerf,
                    employeeSig: s.employeeSig,
                    supervisorSig: s.supervisorSig,
                    hodSig: s.hodSig
                }))
            });
        }
        if (!data.finalReview) {
            // get employee info
            const employee = yield prisma_1.prisma.employee.findUnique({
                where: { id: data.employeeId },
                select: { firstName: true, lastName: true, employeeCode: true }
            });
            const employeeName = employee
                ? `${employee.firstName} ${employee.lastName}`
                : `Employee #${data.employeeCode}`;
            // get HR employees (departmentId = 1 OR roleId = HR)
            const hrUsers = yield prisma_1.prisma.employee.findMany({
                where: {
                    departmentId: 1, // adjust if your HR dept id is different
                    employmentStatus: 'ACTIVE'
                },
                select: { id: true }
            });
            const hrIds = hrUsers.map(u => u.id);
            const messages = `HOD has submitted appraisal for ${employeeName} for ${data.cycle} – ${data.summaries[0].period}. Please review`;
            // if (hrIds.length) {
            //   for (const hrId of hrIds) {
            //     await createNotification(hrId, messages)
            //   }
            // }
        }
        // 3) Save final review
        if (data.finalReview) {
            yield prisma_1.prisma.performanceFinalReview.create({
                data: {
                    employeeId: data.employeeId,
                    departmentId: data.departmentId,
                    cycle: data.cycle,
                    appreciations: data.finalReview.appreciations,
                    talents: data.finalReview.talents,
                    overallComments: data.finalReview.overallComments,
                    employeeSig: data.finalReview.employeeSig,
                    supervisorSig: data.finalReview.supervisorSig,
                    hrSig: data.finalReview.hrSig
                }
            });
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.submitFullForm = submitFullForm;
const assignFormToEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, employeeIds, departmentId, cycle, period } = req.body;
        const ids = employeeIds || (employeeId ? [employeeId] : []);
        if (!ids.length) {
            return res.status(400).json({ error: "No employees provided" });
        }
        const results = [];
        for (const id of ids) {
            // check if already assigned
            const exists = yield prisma_1.prisma.performanceSummary.findFirst({
                where: { employeeId: id, departmentId, cycle, period }
            });
            if (!exists) {
                const summary = yield prisma_1.prisma.performanceSummary.create({
                    data: {
                        employeeId: id,
                        departmentId,
                        cycle,
                        period
                    }
                });
                results.push({ employeeId: id, assigned: true, summary });
            }
            else {
                results.push({ employeeId: id, assigned: false, message: "Already assigned" });
            }
        }
        res.json(results);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.assignFormToEmployee = assignFormToEmployee;
// Get all summaries with employee & department
const getAllSummaries = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const summaries = yield prisma_1.prisma.performanceSummary.findMany({
            include: {
                employee: {
                    select: {
                        id: true,
                        employeeCode: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        dateOfJoining: true,
                        reportingManager: true,
                        gender: true,
                        photoUrl: true,
                    }
                },
                department: {
                    select: { id: true, name: true }
                }
            },
            orderBy: { createdAt: "desc" }
        });
        res.json(summaries);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getAllSummaries = getAllSummaries;
