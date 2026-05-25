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
exports.getEmployeeInsights = exports.initAppraisalAutoDraftCron = exports.getEditHistory = exports.getAppraisalDetail = exports.respondEditRequest = exports.requestEdit = exports.hrReviewAppraisal = exports.submitManagementAppraisal = exports.submitManagerAppraisalV2 = exports.submitSelfAppraisal = exports.hrVerifyAppraisal = exports.toggleSelfAppraisalQuestion = exports.createSelfAppraisalQuestion = exports.getSelfAppraisalQuestions = void 0;
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
// ═══════════════════════════════════════════════════════════════════════════════
// SELF-APPRAISAL QUESTIONS (Master)
// ═══════════════════════════════════════════════════════════════════════════════
const getSelfAppraisalQuestions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const appraisalId = req.query.appraisalId ? Number(req.query.appraisalId) : null;
        let employeeType = null;
        if (appraisalId) {
            const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
                where: { id: appraisalId },
                include: { employee: { select: { employeeType: true } } },
            });
            employeeType = (_c = (_b = (_a = appraisal === null || appraisal === void 0 ? void 0 : appraisal.employee) === null || _a === void 0 ? void 0 : _a.employeeType) === null || _b === void 0 ? void 0 : _b.toUpperCase()) !== null && _c !== void 0 ? _c : null;
        }
        const questions = yield prisma_1.prisma.selfAppraisalQuestion.findMany({
            where: Object.assign({ isActive: true }, (employeeType ? { category: employeeType } : {})),
            orderBy: { displayOrder: "asc" },
        });
        return res.json(questions);
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.getSelfAppraisalQuestions = getSelfAppraisalQuestions;
const createSelfAppraisalQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { text, category, section } = req.body;
        if (!(text === null || text === void 0 ? void 0 : text.trim()))
            return res.status(400).json({ error: "Question text required" });
        const maxOrder = yield prisma_1.prisma.selfAppraisalQuestion.aggregate({ _max: { displayOrder: true } });
        const question = yield prisma_1.prisma.selfAppraisalQuestion.create({
            data: {
                text: text.trim(),
                category: category || null,
                section: section || null,
                displayOrder: ((_a = maxOrder._max.displayOrder) !== null && _a !== void 0 ? _a : 0) + 1,
            },
        });
        return res.status(201).json(question);
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.createSelfAppraisalQuestion = createSelfAppraisalQuestion;
const toggleSelfAppraisalQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { isActive } = req.body;
        const q = yield prisma_1.prisma.selfAppraisalQuestion.update({ where: { id }, data: { isActive } });
        return res.json(q);
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.toggleSelfAppraisalQuestion = toggleSelfAppraisalQuestion;
// ═══════════════════════════════════════════════════════════════════════════════
// HR: VERIFY DRAFT → SEND TO EMPLOYEE & MANAGER
// ═══════════════════════════════════════════════════════════════════════════════
const hrVerifyAppraisal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { appraisalStartDate, appraisalEndDate, dueDate, hrVerifiedBy } = req.body;
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id },
            include: { employee: { select: { firstName: true, lastName: true, reportingManager: true, inchargeId: true } } },
        });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        if (appraisal.status !== "AUTO_DRAFT" && appraisal.status !== "Draft") {
            return res.status(400).json({ error: "Only AUTO_DRAFT appraisals can be verified" });
        }
        const updated = yield prisma_1.prisma.appraisalForm.update({
            where: { id },
            data: {
                status: "PENDING_FILL",
                appraisalStartDate: appraisalStartDate ? new Date(appraisalStartDate) : undefined,
                appraisalEndDate: appraisalEndDate ? new Date(appraisalEndDate) : undefined,
                dueDate: dueDate ? new Date(dueDate) : undefined,
                hrVerifiedBy: hrVerifiedBy ? Number(hrVerifiedBy) : null,
                hrVerifiedAt: new Date(),
            },
        });
        // Notify employee
        const empName = `${appraisal.employee.firstName} ${appraisal.employee.lastName}`;
        yield (0, notifications_controller_1.createNotification)(appraisal.employeeId, `Your appraisal for cycle "${appraisal.cycle}" has been initiated. Please complete your self-appraisal.`);
        // Notify assigned manager and find their reporting manager (Management, role 4)
        if (appraisal.managerId) {
            yield (0, notifications_controller_1.createNotification)(appraisal.managerId, `Appraisal initiated for ${empName} (${appraisal.cycle}). Please complete your manager review.`);
            // The assigned manager's reporting manager is the Management reviewer (role 4)
            const assignedManager = yield prisma_1.prisma.employee.findUnique({
                where: { id: appraisal.managerId },
                select: { reportingManager: true },
            });
            if (assignedManager === null || assignedManager === void 0 ? void 0 : assignedManager.reportingManager) {
                yield (0, notifications_controller_1.createNotification)(assignedManager.reportingManager, `Appraisal initiated for ${empName} (${appraisal.cycle}). Please complete your management review.`);
            }
        }
        return res.json(updated);
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.hrVerifyAppraisal = hrVerifyAppraisal;
// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Notify correct HR staff based on the appraisal employee's department
//   - HR Manager (roleId 1) → always notified (all departments)
//   - HR Executive (roleId 2) → only notified for non-HR-dept (departmentId !== 1) appraisals
// ═══════════════════════════════════════════════════════════════════════════════
const notifyHRTeam = (employeeDeptId, message) => __awaiter(void 0, void 0, void 0, function* () {
    const hrStaff = yield prisma_1.prisma.employee.findMany({
        where: {
            departmentId: 1,
            employmentStatus: "ACTIVE",
            roleId: employeeDeptId === 1
                ? 1 // HR dept appraisal → only HR Manager
                : { in: [1, 2] }, // other dept appraisal → HR Manager + HR Executives
        },
        select: { id: true },
    });
    for (const staff of hrStaff) {
        yield (0, notifications_controller_1.createNotification)(staff.id, message);
    }
});
// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE: SUBMIT SELF-APPRAISAL
// ═══════════════════════════════════════════════════════════════════════════════
const submitSelfAppraisal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const id = Number(req.params.id);
        const { answers, achievements, goalsObjective, challenges, trainingNeeds, isDraft } = req.body;
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id },
            include: { employee: { select: { departmentId: true, firstName: true, lastName: true } } },
        });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        // Allow self-appraisal during PENDING_FILL or if already submitted (edit after approval)
        if (!["PENDING_FILL", "SELF_APPRAISAL_PENDING", "HR_VERIFIED"].includes(appraisal.status)) {
            return res.status(400).json({ error: "Self-appraisal cannot be submitted at this stage" });
        }
        // Check due date (allow drafts even after due date)
        if (!isDraft && appraisal.dueDate && new Date(appraisal.dueDate) < new Date()) {
            return res.status(400).json({ error: "Due date has passed. You can no longer submit self-appraisal." });
        }
        // Upsert SelfAppraisal (free-text fields)
        yield prisma_1.prisma.selfAppraisal.upsert({
            where: { appraisalFormId: id },
            create: {
                appraisalFormId: id,
                achievements: achievements || null,
                goalsObjective: goalsObjective || null,
                challenges: challenges || null,
                trainingNeeds: trainingNeeds || null,
            },
            update: {
                achievements: achievements || null,
                goalsObjective: goalsObjective || null,
                challenges: challenges || null,
                trainingNeeds: trainingNeeds || null,
            },
        });
        // Upsert answers (question-based)
        if (answers === null || answers === void 0 ? void 0 : answers.length) {
            for (const a of answers) {
                yield prisma_1.prisma.selfAppraisalAnswer.upsert({
                    where: {
                        appraisalFormId_questionId: { appraisalFormId: id, questionId: a.questionId },
                    },
                    create: {
                        appraisalFormId: id,
                        questionId: a.questionId,
                        rating: (_a = a.rating) !== null && _a !== void 0 ? _a : null,
                        comments: a.comments || null,
                    },
                    update: {
                        rating: (_b = a.rating) !== null && _b !== void 0 ? _b : null,
                        comments: a.comments || null,
                    },
                });
            }
        }
        // Update status if not saving as draft
        if (!isDraft) {
            // All three must submit → HR_REVIEW
            const managerAlreadySubmitted = !!appraisal.managerAppraisalSubmittedAt;
            const managementAlreadySubmitted = !!appraisal.managementAppraisalSubmittedAt;
            const allSubmitted = managerAlreadySubmitted && managementAlreadySubmitted;
            const newStatus = allSubmitted ? "HR_REVIEW" : "PENDING_FILL";
            yield prisma_1.prisma.appraisalForm.update({
                where: { id },
                data: {
                    selfAppraisalSubmittedAt: new Date(),
                    status: newStatus,
                },
            });
            // Update edit history with new values (if this is a re-submission after edit approval)
            const latestEditHistory = yield prisma_1.prisma.appraisalEditHistory.findFirst({
                where: { appraisalFormId: id, editType: "SELF_APPRAISAL", newValues: { equals: {} } },
                orderBy: { editedAt: "desc" },
            });
            if (latestEditHistory) {
                const selfData = yield prisma_1.prisma.selfAppraisal.findUnique({ where: { appraisalFormId: id } });
                const answerData = yield prisma_1.prisma.selfAppraisalAnswer.findMany({ where: { appraisalFormId: id } });
                yield prisma_1.prisma.appraisalEditHistory.update({
                    where: { id: latestEditHistory.id },
                    data: { newValues: { selfAppraisal: selfData, answers: answerData } },
                });
            }
            const employeeDeptId = (_d = (_c = appraisal.employee) === null || _c === void 0 ? void 0 : _c.departmentId) !== null && _d !== void 0 ? _d : 0;
            const empName = `${(_e = appraisal.employee) === null || _e === void 0 ? void 0 : _e.firstName} ${(_f = appraisal.employee) === null || _f === void 0 ? void 0 : _f.lastName}`;
            const selfMsg = allSubmitted
                ? `All appraisal sections submitted for ${empName} (${appraisal.cycle}). Please review.`
                : `Self-appraisal submitted by ${empName} (${appraisal.cycle}).`;
            yield notifyHRTeam(employeeDeptId, selfMsg);
        }
        return res.json({ message: isDraft ? "Self-appraisal saved as draft" : "Self-appraisal submitted" });
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.submitSelfAppraisal = submitSelfAppraisal;
// ═══════════════════════════════════════════════════════════════════════════════
// MANAGER: SUBMIT MANAGER APPRAISAL (enhanced — status-aware)
// ═══════════════════════════════════════════════════════════════════════════════
const submitManagerAppraisalV2 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const id = Number(req.params.id);
        const { qualityOfWorkRating, qualityOfWorkComments, knowledgeOfJobRating, knowledgeOfJobComments, teamworkRating, teamworkComments, independenceRating, independenceComments, recordsRating, recordsComments, guestServiceRating, guestServiceComments, safetyRating, safetyComments, attendanceRating, attendanceComments, leadershipRating, leadershipComments, overallScore, comments, recommendations, finalDecision, finalComments, isDraft, } = req.body;
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id },
            include: { employee: { select: { departmentId: true, firstName: true, lastName: true } } },
        });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        // Allow manager to fill during PENDING_FILL (parallel) or after self-appraisal submitted
        if (!["PENDING_FILL", "SELF_APPRAISAL_SUBMITTED", "MANAGER_APPRAISAL_PENDING", "MANAGER_APPRAISAL_SUBMITTED"].includes(appraisal.status)) {
            return res.status(400).json({ error: "Manager appraisal cannot be submitted at this stage" });
        }
        // Store previous values for audit if already exists
        const existing = yield prisma_1.prisma.managerAppraisal.findUnique({ where: { appraisalFormId: id } });
        // Upsert manager appraisal
        yield prisma_1.prisma.managerAppraisal.upsert({
            where: { appraisalFormId: id },
            create: {
                appraisalFormId: id,
                qualityOfWorkRating, qualityOfWorkComments,
                knowledgeOfJobRating, knowledgeOfJobComments,
                teamworkRating, teamworkComments,
                independenceRating, independenceComments,
                recordsRating, recordsComments,
                guestServiceRating, guestServiceComments,
                safetyRating, safetyComments,
                attendanceRating, attendanceComments,
                leadershipRating, leadershipComments,
                overallScore, comments, recommendations,
            },
            update: {
                qualityOfWorkRating, qualityOfWorkComments,
                knowledgeOfJobRating, knowledgeOfJobComments,
                teamworkRating, teamworkComments,
                independenceRating, independenceComments,
                recordsRating, recordsComments,
                guestServiceRating, guestServiceComments,
                safetyRating, safetyComments,
                attendanceRating, attendanceComments,
                leadershipRating, leadershipComments,
                overallScore, comments, recommendations,
            },
        });
        if (!isDraft) {
            const selfAlreadySubmitted = !!appraisal.selfAppraisalSubmittedAt;
            const managementAlreadySubmitted = !!appraisal.managementAppraisalSubmittedAt;
            const allSubmitted = selfAlreadySubmitted && managementAlreadySubmitted;
            const newStatus = allSubmitted ? "HR_REVIEW" : "PENDING_FILL";
            yield prisma_1.prisma.appraisalForm.update({
                where: { id },
                data: {
                    status: newStatus,
                    managerAppraisalSubmittedAt: new Date(),
                    overallScore,
                    finalDecision,
                    finalComments,
                },
            });
            // Update edit history with new values (if re-submission after edit approval)
            const latestMgrEditHistory = yield prisma_1.prisma.appraisalEditHistory.findFirst({
                where: { appraisalFormId: id, editType: "MANAGER_APPRAISAL", newValues: { equals: {} } },
                orderBy: { editedAt: "desc" },
            });
            if (latestMgrEditHistory) {
                const mgrData = yield prisma_1.prisma.managerAppraisal.findUnique({ where: { appraisalFormId: id } });
                yield prisma_1.prisma.appraisalEditHistory.update({
                    where: { id: latestMgrEditHistory.id },
                    data: { newValues: { managerAppraisal: mgrData } },
                });
            }
            const employeeDeptId = (_b = (_a = appraisal.employee) === null || _a === void 0 ? void 0 : _a.departmentId) !== null && _b !== void 0 ? _b : 0;
            const empName = `${(_c = appraisal.employee) === null || _c === void 0 ? void 0 : _c.firstName} ${(_d = appraisal.employee) === null || _d === void 0 ? void 0 : _d.lastName}`;
            const mgrMsg = allSubmitted
                ? `All appraisal sections submitted for ${empName} (${appraisal.cycle}). Please review.`
                : `Manager review submitted for ${empName} (${appraisal.cycle}).`;
            yield notifyHRTeam(employeeDeptId, mgrMsg);
        }
        return res.json({ message: isDraft ? "Manager appraisal saved as draft" : "Manager appraisal submitted" });
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.submitManagerAppraisalV2 = submitManagerAppraisalV2;
// ═══════════════════════════════════════════════════════════════════════════════
// MANAGEMENT: SUBMIT MANAGEMENT APPRAISAL
// ═══════════════════════════════════════════════════════════════════════════════
const submitManagementAppraisal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const id = Number(req.params.id);
        const { qualityOfWorkRating, qualityOfWorkComments, knowledgeOfJobRating, knowledgeOfJobComments, teamworkRating, teamworkComments, independenceRating, independenceComments, recordsRating, recordsComments, guestServiceRating, guestServiceComments, safetyRating, safetyComments, attendanceRating, attendanceComments, leadershipRating, leadershipComments, overallScore, comments, recommendations, isDraft, } = req.body;
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id },
            include: { employee: { select: { departmentId: true, firstName: true, lastName: true } } },
        });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        if (!["PENDING_FILL", "SELF_APPRAISAL_PENDING", "MANAGER_APPRAISAL_PENDING", "MANAGER_APPRAISAL_SUBMITTED"].includes(appraisal.status)) {
            return res.status(400).json({ error: "Management appraisal cannot be submitted at this stage" });
        }
        yield prisma_1.prisma.managementAppraisal.upsert({
            where: { appraisalFormId: id },
            create: {
                appraisalFormId: id,
                qualityOfWorkRating, qualityOfWorkComments,
                knowledgeOfJobRating, knowledgeOfJobComments,
                teamworkRating, teamworkComments,
                independenceRating, independenceComments,
                recordsRating, recordsComments,
                guestServiceRating, guestServiceComments,
                safetyRating, safetyComments,
                attendanceRating, attendanceComments,
                leadershipRating, leadershipComments,
                overallScore, comments, recommendations,
            },
            update: {
                qualityOfWorkRating, qualityOfWorkComments,
                knowledgeOfJobRating, knowledgeOfJobComments,
                teamworkRating, teamworkComments,
                independenceRating, independenceComments,
                recordsRating, recordsComments,
                guestServiceRating, guestServiceComments,
                safetyRating, safetyComments,
                attendanceRating, attendanceComments,
                leadershipRating, leadershipComments,
                overallScore, comments, recommendations,
            },
        });
        if (!isDraft) {
            const selfAlreadySubmitted = !!appraisal.selfAppraisalSubmittedAt;
            const managerAlreadySubmitted = !!appraisal.managerAppraisalSubmittedAt;
            const allSubmitted = selfAlreadySubmitted && managerAlreadySubmitted;
            const newStatus = allSubmitted ? "HR_REVIEW" : "PENDING_FILL";
            yield prisma_1.prisma.appraisalForm.update({
                where: { id },
                data: { status: newStatus, managementAppraisalSubmittedAt: new Date() },
            });
            // Update edit history newValues if this is re-submission after edit approval
            const latestMgmtEditHistory = yield prisma_1.prisma.appraisalEditHistory.findFirst({
                where: { appraisalFormId: id, editType: "MANAGEMENT_APPRAISAL", newValues: { equals: {} } },
                orderBy: { editedAt: "desc" },
            });
            if (latestMgmtEditHistory) {
                const mgmtData = yield prisma_1.prisma.managementAppraisal.findUnique({ where: { appraisalFormId: id } });
                yield prisma_1.prisma.appraisalEditHistory.update({
                    where: { id: latestMgmtEditHistory.id },
                    data: { newValues: { managementAppraisal: mgmtData } },
                });
            }
            const employeeDeptId = (_b = (_a = appraisal.employee) === null || _a === void 0 ? void 0 : _a.departmentId) !== null && _b !== void 0 ? _b : 0;
            const empName = `${(_c = appraisal.employee) === null || _c === void 0 ? void 0 : _c.firstName} ${(_d = appraisal.employee) === null || _d === void 0 ? void 0 : _d.lastName}`;
            const mgmtMsg = allSubmitted
                ? `All appraisal sections submitted for ${empName} (${appraisal.cycle}). Please review.`
                : `Management review submitted for ${empName} (${appraisal.cycle}).`;
            yield notifyHRTeam(employeeDeptId, mgmtMsg);
        }
        return res.json({ message: isDraft ? "Management appraisal saved as draft" : "Management appraisal submitted" });
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.submitManagementAppraisal = submitManagementAppraisal;
// ═══════════════════════════════════════════════════════════════════════════════
// HR: FINAL REVIEW & APPROVE
// ═══════════════════════════════════════════════════════════════════════════════
const hrReviewAppraisal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { hrReviewComments, hrRecommendations, hrApprovedBy, action } = req.body;
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id },
            include: { employee: { select: { firstName: true, lastName: true } } },
        });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        if (action === "APPROVE") {
            yield prisma_1.prisma.appraisalForm.update({
                where: { id },
                data: {
                    status: "COMPLETED",
                    hrReviewComments,
                    hrRecommendations,
                    hrApprovedBy: hrApprovedBy ? Number(hrApprovedBy) : null,
                    hrApprovedAt: new Date(),
                },
            });
            const empName = `${appraisal.employee.firstName} ${appraisal.employee.lastName}`;
            yield (0, notifications_controller_1.createNotification)(appraisal.employeeId, `Your appraisal for "${appraisal.cycle}" has been completed and approved by HR.`);
            if (appraisal.managerId) {
                yield (0, notifications_controller_1.createNotification)(appraisal.managerId, `Appraisal for ${empName} (${appraisal.cycle}) has been approved by HR.`);
            }
            return res.json({ message: "Appraisal approved" });
        }
        // Just save HR comments without approving
        yield prisma_1.prisma.appraisalForm.update({
            where: { id },
            data: {
                status: "HR_REVIEW",
                hrReviewComments,
                hrRecommendations,
            },
        });
        return res.json({ message: "HR review saved" });
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.hrReviewAppraisal = hrReviewAppraisal;
// ═══════════════════════════════════════════════════════════════════════════════
// EDIT REQUEST
// ═══════════════════════════════════════════════════════════════════════════════
const requestEdit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const appraisalId = Number(req.params.id);
        const { requestedBy, reason, requestType } = req.body;
        if (!(reason === null || reason === void 0 ? void 0 : reason.trim()))
            return res.status(400).json({ error: "Reason required" });
        if (!["SELF", "MANAGER", "MANAGEMENT"].includes(requestType))
            return res.status(400).json({ error: "requestType must be SELF, MANAGER, or MANAGEMENT" });
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id: appraisalId },
            include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
        });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        // Can only request edit before HR approves
        if (["COMPLETED", "HR_APPROVED"].includes(appraisal.status)) {
            return res.status(400).json({ error: "Cannot request edit after HR approval" });
        }
        // Get requester name
        const requester = yield prisma_1.prisma.employee.findUnique({
            where: { id: Number(requestedBy) },
            select: { firstName: true, lastName: true, employeeCode: true },
        });
        const requesterName = requester ? `${requester.firstName} ${requester.lastName} (${requester.employeeCode})` : `Employee #${requestedBy}`;
        const empName = `${appraisal.employee.firstName} ${appraisal.employee.lastName} (${appraisal.employee.employeeCode})`;
        const editRequest = yield prisma_1.prisma.appraisalEditRequest.create({
            data: {
                appraisalFormId: appraisalId,
                requestedBy: Number(requestedBy),
                reason,
                requestType,
            },
        });
        // Notify HR with names
        const hrEmployees = yield prisma_1.prisma.employee.findMany({
            where: { departmentId: 1, employmentStatus: "ACTIVE" },
            select: { id: true },
        });
        const typeLabel = requestType === "SELF" ? "self-appraisal" : "manager review";
        for (const hr of hrEmployees) {
            yield (0, notifications_controller_1.createNotification)(hr.id, `${requesterName} has requested to edit their ${typeLabel} for ${empName}'s appraisal (${appraisal.cycle}). Reason: ${reason}`);
        }
        return res.status(201).json(editRequest);
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.requestEdit = requestEdit;
const respondEditRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const requestId = Number(req.params.requestId);
        const { action, approvedBy, rejectionReason } = req.body;
        const editReq = yield prisma_1.prisma.appraisalEditRequest.findUnique({
            where: { id: requestId },
            include: {
                appraisalForm: {
                    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
                },
            },
        });
        if (!editReq)
            return res.status(404).json({ error: "Edit request not found" });
        if (editReq.status !== "PENDING")
            return res.status(400).json({ error: "Already processed" });
        // Get requester name
        const requester = yield prisma_1.prisma.employee.findUnique({
            where: { id: editReq.requestedBy },
            select: { firstName: true, lastName: true, employeeCode: true },
        });
        const requesterName = requester ? `${requester.firstName} ${requester.lastName}` : `Employee`;
        const empName = `${editReq.appraisalForm.employee.firstName} ${editReq.appraisalForm.employee.lastName}`;
        const typeLabel = editReq.requestType === "SELF" ? "self-appraisal" : editReq.requestType === "MANAGER" ? "manager review" : "management review";
        if (action === "APPROVE") {
            // Save current values as edit history snapshot
            const appraisal = editReq.appraisalForm;
            let previousValues = {};
            if (editReq.requestType === "SELF") {
                const selfData = yield prisma_1.prisma.selfAppraisal.findUnique({ where: { appraisalFormId: appraisal.id } });
                const answers = yield prisma_1.prisma.selfAppraisalAnswer.findMany({ where: { appraisalFormId: appraisal.id } });
                previousValues = { selfAppraisal: selfData, answers };
            }
            else if (editReq.requestType === "MANAGER") {
                const managerData = yield prisma_1.prisma.managerAppraisal.findUnique({ where: { appraisalFormId: appraisal.id } });
                previousValues = { managerAppraisal: managerData };
            }
            else {
                const mgmtData = yield prisma_1.prisma.managementAppraisal.findUnique({ where: { appraisalFormId: appraisal.id } });
                previousValues = { managementAppraisal: mgmtData };
            }
            const editTypeMap = { SELF: "SELF_APPRAISAL", MANAGER: "MANAGER_APPRAISAL", MANAGEMENT: "MANAGEMENT_APPRAISAL" };
            yield prisma_1.prisma.appraisalEditHistory.create({
                data: {
                    appraisalFormId: appraisal.id,
                    editedBy: editReq.requestedBy,
                    editType: editTypeMap[editReq.requestType] || "MANAGER_APPRAISAL",
                    previousValues,
                    newValues: {},
                    editReason: editReq.reason,
                    approvedBy: approvedBy ? Number(approvedBy) : null,
                },
            });
            const clearData = { status: "PENDING_FILL" };
            if (editReq.requestType === "SELF") {
                clearData.selfAppraisalSubmittedAt = null;
            }
            else if (editReq.requestType === "MANAGER") {
                clearData.managerAppraisalSubmittedAt = null;
            }
            else {
                clearData.managementAppraisalSubmittedAt = null;
            }
            yield prisma_1.prisma.appraisalForm.update({
                where: { id: appraisal.id },
                data: clearData,
            });
            yield prisma_1.prisma.appraisalEditRequest.update({
                where: { id: requestId },
                data: { status: "APPROVED", approvedBy: Number(approvedBy), approvedAt: new Date() },
            });
            yield (0, notifications_controller_1.createNotification)(editReq.requestedBy, `Your edit request for ${empName}'s ${typeLabel} (${editReq.appraisalForm.cycle}) has been approved. You can now edit.`);
        }
        else {
            yield prisma_1.prisma.appraisalEditRequest.update({
                where: { id: requestId },
                data: { status: "REJECTED", approvedBy: Number(approvedBy), approvedAt: new Date(), rejectionReason },
            });
            // No status change needed on rejection — status stays as-is
            yield (0, notifications_controller_1.createNotification)(editReq.requestedBy, `Your edit request for ${empName}'s ${typeLabel} (${editReq.appraisalForm.cycle}) has been rejected. Reason: ${rejectionReason || "N/A"}`);
        }
        return res.json({ message: `Edit request ${action.toLowerCase()}` });
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.respondEditRequest = respondEditRequest;
// ═══════════════════════════════════════════════════════════════════════════════
// GET APPRAISAL DETAIL (role-aware — hides self-appraisal from manager)
// ═══════════════════════════════════════════════════════════════════════════════
const getAppraisalDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const viewerRole = req.query.viewerRole; // HR, MANAGER, EMPLOYEE
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true, employeeCode: true, firstName: true, lastName: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                        dateOfJoining: true, reportingManager: true,
                    },
                },
                selfAppraisal: true,
                selfAnswers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
                managerReview: true,
                managementReview: true,
                hrReview: true,
                editRequests: { orderBy: { requestedAt: "desc" } },
                editHistory: { orderBy: { editedAt: "desc" } },
            },
        });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        // Enrich edit requests with requester names
        const requesterIds = [...new Set(appraisal.editRequests.map(r => r.requestedBy))];
        const requesters = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: requesterIds } },
            select: { id: true, firstName: true, lastName: true, employeeCode: true },
        });
        const requesterMap = new Map(requesters.map(r => [r.id, `${r.firstName} ${r.lastName} (${r.employeeCode})`]));
        const enrichedEditRequests = appraisal.editRequests.map(r => (Object.assign(Object.assign({}, r), { requestedByName: requesterMap.get(r.requestedBy) || `Employee #${r.requestedBy}` })));
        const result = Object.assign(Object.assign({}, appraisal), { editRequests: enrichedEditRequests });
        // Manager/Management cannot see self-appraisal
        if (viewerRole === "MANAGER") {
            return res.json(Object.assign(Object.assign({}, result), { selfAppraisal: null, selfAnswers: [] }));
        }
        return res.json(result);
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.getAppraisalDetail = getAppraisalDetail;
// ═══════════════════════════════════════════════════════════════════════════════
// GET EDIT HISTORY
// ═══════════════════════════════════════════════════════════════════════════════
const getEditHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const appraisalId = Number(req.params.id);
        const history = yield prisma_1.prisma.appraisalEditHistory.findMany({
            where: { appraisalFormId: appraisalId },
            orderBy: { editedAt: "desc" },
        });
        return res.json(history);
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.getEditHistory = getEditHistory;
// ═══════════════════════════════════════════════════════════════════════════════
// CRON: AUTO-CREATE APPRAISAL AT 11 MONTHS
// ═══════════════════════════════════════════════════════════════════════════════
const initAppraisalAutoDraftCron = () => {
    node_cron_1.default.schedule("0 3 * * *", () => __awaiter(void 0, void 0, void 0, function* () {
        console.log("Running appraisal auto-draft cron...");
        try {
            const today = new Date();
            const employees = yield prisma_1.prisma.employee.findMany({
                where: { employmentStatus: "ACTIVE" },
                select: { id: true, dateOfJoining: true, reportingManager: true },
            });
            let created = 0;
            for (const emp of employees) {
                const doj = new Date(emp.dateOfJoining);
                const monthsSinceJoining = (today.getFullYear() - doj.getFullYear()) * 12 + (today.getMonth() - doj.getMonth());
                // Create appraisal at 11 months, 23 months, 35 months, etc.
                if (monthsSinceJoining >= 11 && monthsSinceJoining % 12 === 11) {
                    const yearNum = Math.floor(monthsSinceJoining / 12) + 1;
                    const cycle = `Year ${yearNum} - Annual Review`;
                    // Check if already exists
                    const existing = yield prisma_1.prisma.appraisalForm.findFirst({
                        where: { employeeId: emp.id, cycle },
                    });
                    if (!existing) {
                        const startDate = new Date(doj);
                        startDate.setFullYear(startDate.getFullYear() + yearNum - 1);
                        const endDate = new Date(startDate);
                        endDate.setFullYear(endDate.getFullYear() + 1);
                        yield prisma_1.prisma.appraisalForm.create({
                            data: {
                                employeeId: emp.id,
                                managerId: emp.reportingManager || null,
                                cycle,
                                status: "AUTO_DRAFT",
                                appraisalStartDate: startDate,
                                appraisalEndDate: endDate,
                                dueDate: new Date(endDate.getTime() + 30 * 24 * 60 * 60 * 1000), // +30 days
                            },
                        });
                        created++;
                    }
                }
            }
            // Notify HR about new drafts
            if (created > 0) {
                const hrEmployees = yield prisma_1.prisma.employee.findMany({
                    where: { departmentId: 1, employmentStatus: "ACTIVE" },
                    select: { id: true },
                });
                for (const hr of hrEmployees) {
                    yield (0, notifications_controller_1.createNotification)(hr.id, `${created} new appraisal draft(s) created. Please verify and send to employees.`);
                }
            }
            console.log(`✅ Appraisal auto-draft: created ${created} drafts`);
        }
        catch (e) {
            console.error("❌ Appraisal auto-draft cron error:", e);
        }
    }));
};
exports.initAppraisalAutoDraftCron = initAppraisalAutoDraftCron;
// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE INSIGHTS — incidents + weekly rating averages for appraisal period
// ═══════════════════════════════════════════════════════════════════════════════
const getEmployeeInsights = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const appraisalId = Number(req.params.id);
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({ where: { id: appraisalId } });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        const startDate = appraisal.appraisalStartDate || new Date(new Date().setFullYear(new Date().getFullYear() - 1));
        const endDate = appraisal.appraisalEndDate || new Date();
        // Incidents during the period
        const incidents = yield prisma_1.prisma.incident.findMany({
            where: {
                employeeId: appraisal.employeeId,
                createdAt: { gte: startDate, lte: endDate },
            },
            select: { id: true, title: true, status: true, createdAt: true },
            orderBy: { createdAt: "desc" },
        });
        // Weekly ratings during the period
        const weeklyRatings = yield prisma_1.prisma.weeklyPerformanceRating.findMany({
            where: {
                employeeId: appraisal.employeeId,
                status: "SUBMITTED",
                weekStartDate: { gte: startDate, lte: endDate },
            },
            select: { weekStartDate: true, weekLabel: true, overallScore: true },
            orderBy: { weekStartDate: "asc" },
        });
        // Calculate monthly averages
        const monthlyMap = {};
        for (const r of weeklyRatings) {
            const d = new Date(r.weekStartDate);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            if (!monthlyMap[key])
                monthlyMap[key] = { total: 0, count: 0 };
            monthlyMap[key].total += r.overallScore || 0;
            monthlyMap[key].count++;
        }
        const monthlyAverages = Object.entries(monthlyMap)
            .map(([month, data]) => ({
            month,
            average: Math.round((data.total / data.count) * 10) / 10,
            count: data.count,
        }))
            .sort((a, b) => a.month.localeCompare(b.month));
        // Overall average
        const overallAvg = weeklyRatings.length
            ? Math.round((weeklyRatings.reduce((s, r) => s + (r.overallScore || 0), 0) / weeklyRatings.length) * 10) / 10
            : null;
        return res.json({
            period: { start: startDate, end: endDate },
            incidents: { count: incidents.length, list: incidents },
            weeklyRatings: {
                totalWeeks: weeklyRatings.length,
                overallAverage: overallAvg,
                monthlyAverages,
                raw: weeklyRatings,
            },
        });
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.getEmployeeInsights = getEmployeeInsights;
const node_cron_1 = __importDefault(require("node-cron"));
