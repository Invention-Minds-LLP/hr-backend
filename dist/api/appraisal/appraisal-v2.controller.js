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
exports.getEmployeeInsights = exports.initAppraisalAutoDraftCron = exports.submitInchargeAppraisal = exports.deleteReviewQuestion = exports.toggleReviewQuestion = exports.updateReviewQuestion = exports.createReviewQuestion = exports.listReviewQuestions = exports.reassignAppraisalManager = exports.getEditHistory = exports.getAppraisalDetail = exports.respondEditRequest = exports.requestEdit = exports.hrReviewAppraisal = exports.submitManagementAppraisal = exports.submitManagerAppraisalV2 = exports.submitSelfAppraisal = exports.hrVerifyAppraisal = exports.toggleSelfAppraisalQuestion = exports.createSelfAppraisalQuestion = exports.getSelfAppraisalQuestions = void 0;
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
const appraisal_pause_controller_1 = require("./appraisal-pause.controller");
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
    var _a, _b;
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
        // Snapshot the employee's in-charge at verification time so the appraisal
        // routes to the right person even if the in-charge changes later.
        const inchargeIdSnapshot = (_b = (_a = appraisal.employee) === null || _a === void 0 ? void 0 : _a.inchargeId) !== null && _b !== void 0 ? _b : null;
        const updated = yield prisma_1.prisma.appraisalForm.update({
            where: { id },
            data: {
                status: "PENDING_FILL",
                appraisalStartDate: appraisalStartDate ? new Date(appraisalStartDate) : undefined,
                appraisalEndDate: appraisalEndDate ? new Date(appraisalEndDate) : undefined,
                dueDate: dueDate ? new Date(dueDate) : undefined,
                hrVerifiedBy: hrVerifiedBy ? Number(hrVerifiedBy) : null,
                hrVerifiedAt: new Date(),
                inchargeId: inchargeIdSnapshot,
            },
        });
        // Notify employee
        const empName = `${appraisal.employee.firstName} ${appraisal.employee.lastName}`;
        yield (0, notifications_controller_1.createNotification)(appraisal.employeeId, `Your appraisal for cycle "${appraisal.cycle}" has been initiated. Please complete your self-appraisal.`);
        // Notify in-charge first (when present). Manager fills only after the
        // in-charge submits — the dynamic review form gates this client-side and
        // the new submit endpoints enforce it server-side.
        if (inchargeIdSnapshot) {
            yield (0, notifications_controller_1.createNotification)(inchargeIdSnapshot, `Appraisal initiated for ${empName} (${appraisal.cycle}). Please complete your in-charge review.`);
        }
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
/**
 * Whether the appraisal needs an In-charge review at all.
 * True when the appraisal has a snapshotted inchargeId (HR verify already ran)
 * OR the employee currently has an in-charge assigned (pre-verification rows).
 */
const inchargeRequired = (a) => { var _a; return !!((a === null || a === void 0 ? void 0 : a.inchargeId) || ((_a = a === null || a === void 0 ? void 0 : a.employee) === null || _a === void 0 ? void 0 : _a.inchargeId)); };
/** True when the In-charge step is either not required, or has been submitted. */
const inchargeDone = (a) => !inchargeRequired(a) || !!(a === null || a === void 0 ? void 0 : a.inchargeAppraisalSubmittedAt);
// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE: SUBMIT SELF-APPRAISAL
// ═══════════════════════════════════════════════════════════════════════════════
const submitSelfAppraisal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const id = Number(req.params.id);
        const { answers, achievements, goalsObjective, challenges, trainingNeeds, isDraft } = req.body;
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id },
            include: { employee: { select: { departmentId: true, firstName: true, lastName: true, inchargeId: true } } },
        });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        // Pause guard — block when the employee is in an open pause window.
        // HR (roleId 1 or dept 1 + roleId 2) overrides.
        const callerEmpId = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        const guard = yield (0, appraisal_pause_controller_1.assertNotPausedOrHR)(appraisal.employeeId, callerEmpId);
        if (guard.blocked)
            return res.status(423).json({ error: guard.message });
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
                        rating: (_c = a.rating) !== null && _c !== void 0 ? _c : null,
                        comments: a.comments || null,
                    },
                    update: {
                        rating: (_d = a.rating) !== null && _d !== void 0 ? _d : null,
                        comments: a.comments || null,
                    },
                });
            }
        }
        // Update status if not saving as draft
        if (!isDraft) {
            // All required levels must submit → HR_REVIEW. In-charge only counts
            // when the appraisal has an in-charge assigned.
            const managerAlreadySubmitted = !!appraisal.managerAppraisalSubmittedAt;
            const managementAlreadySubmitted = !!appraisal.managementAppraisalSubmittedAt;
            const allSubmitted = managerAlreadySubmitted && managementAlreadySubmitted && inchargeDone(appraisal);
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
            const employeeDeptId = (_f = (_e = appraisal.employee) === null || _e === void 0 ? void 0 : _e.departmentId) !== null && _f !== void 0 ? _f : 0;
            const empName = `${(_g = appraisal.employee) === null || _g === void 0 ? void 0 : _g.firstName} ${(_h = appraisal.employee) === null || _h === void 0 ? void 0 : _h.lastName}`;
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
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const id = Number(req.params.id);
        const { qualityOfWorkRating, qualityOfWorkComments, knowledgeOfJobRating, knowledgeOfJobComments, teamworkRating, teamworkComments, independenceRating, independenceComments, recordsRating, recordsComments, guestServiceRating, guestServiceComments, safetyRating, safetyComments, attendanceRating, attendanceComments, leadershipRating, leadershipComments, overallScore, comments, recommendations, finalDecision, finalComments, isDraft, } = req.body;
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id },
            include: { employee: { select: { departmentId: true, firstName: true, lastName: true, inchargeId: true } } },
        });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        const callerEmpId = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        const guard = yield (0, appraisal_pause_controller_1.assertNotPausedOrHR)(appraisal.employeeId, callerEmpId);
        if (guard.blocked)
            return res.status(423).json({ error: guard.message });
        // Allow manager to fill during PENDING_FILL (parallel) or after self-appraisal submitted
        if (!["PENDING_FILL", "SELF_APPRAISAL_SUBMITTED", "MANAGER_APPRAISAL_PENDING", "MANAGER_APPRAISAL_SUBMITTED"].includes(appraisal.status)) {
            return res.status(400).json({ error: "Manager appraisal cannot be submitted at this stage" });
        }
        // New dynamic form sends an `answers` array. Persist to the unified
        // AppraisalReviewAnswer table (level=MANAGER) in addition to the legacy
        // column upsert below, so both old and new clients work during cutover.
        const answers = (_c = req.body) === null || _c === void 0 ? void 0 : _c.answers;
        if (Array.isArray(answers)) {
            yield saveReviewAnswers(id, "MANAGER", answers);
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
            // In-charge only blocks when the appraisal has one assigned.
            const allSubmitted = selfAlreadySubmitted && managementAlreadySubmitted && inchargeDone(appraisal);
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
            const employeeDeptId = (_e = (_d = appraisal.employee) === null || _d === void 0 ? void 0 : _d.departmentId) !== null && _e !== void 0 ? _e : 0;
            const empName = `${(_f = appraisal.employee) === null || _f === void 0 ? void 0 : _f.firstName} ${(_g = appraisal.employee) === null || _g === void 0 ? void 0 : _g.lastName}`;
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
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const id = Number(req.params.id);
        const { qualityOfWorkRating, qualityOfWorkComments, knowledgeOfJobRating, knowledgeOfJobComments, teamworkRating, teamworkComments, independenceRating, independenceComments, recordsRating, recordsComments, guestServiceRating, guestServiceComments, safetyRating, safetyComments, attendanceRating, attendanceComments, leadershipRating, leadershipComments, overallScore, comments, recommendations, isDraft, } = req.body;
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id },
            include: { employee: { select: { departmentId: true, firstName: true, lastName: true, inchargeId: true } } },
        });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        const callerEmpId = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        const guard = yield (0, appraisal_pause_controller_1.assertNotPausedOrHR)(appraisal.employeeId, callerEmpId);
        if (guard.blocked)
            return res.status(423).json({ error: guard.message });
        if (!["PENDING_FILL", "SELF_APPRAISAL_PENDING", "MANAGER_APPRAISAL_PENDING", "MANAGER_APPRAISAL_SUBMITTED"].includes(appraisal.status)) {
            return res.status(400).json({ error: "Management appraisal cannot be submitted at this stage" });
        }
        // New dynamic form sends an `answers` array. Persist to AppraisalReviewAnswer
        // (level=MANAGEMENT) in addition to the legacy column upsert below.
        const mgmtAnswers = (_c = req.body) === null || _c === void 0 ? void 0 : _c.answers;
        if (Array.isArray(mgmtAnswers)) {
            yield saveReviewAnswers(id, "MANAGEMENT", mgmtAnswers);
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
            // In-charge only blocks when the appraisal has one assigned.
            const allSubmitted = selfAlreadySubmitted && managerAlreadySubmitted && inchargeDone(appraisal);
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
            const employeeDeptId = (_e = (_d = appraisal.employee) === null || _d === void 0 ? void 0 : _d.departmentId) !== null && _e !== void 0 ? _e : 0;
            const empName = `${(_f = appraisal.employee) === null || _f === void 0 ? void 0 : _f.firstName} ${(_g = appraisal.employee) === null || _g === void 0 ? void 0 : _g.lastName}`;
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
        if (!["SELF", "INCHARGE", "MANAGER", "MANAGEMENT"].includes(requestType)) {
            return res.status(400).json({ error: "requestType must be SELF, INCHARGE, MANAGER, or MANAGEMENT" });
        }
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
        const typeLabel = requestType === "SELF" ? "self-appraisal"
            : requestType === "INCHARGE" ? "in-charge review"
                : requestType === "MANAGEMENT" ? "management review"
                    : "manager review";
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
        const typeLabel = editReq.requestType === "SELF" ? "self-appraisal"
            : editReq.requestType === "INCHARGE" ? "in-charge review"
                : editReq.requestType === "MANAGEMENT" ? "management review"
                    : "manager review";
        if (action === "APPROVE") {
            // Save current values as edit history snapshot
            const appraisal = editReq.appraisalForm;
            let previousValues = {};
            if (editReq.requestType === "SELF") {
                const selfData = yield prisma_1.prisma.selfAppraisal.findUnique({ where: { appraisalFormId: appraisal.id } });
                const answers = yield prisma_1.prisma.selfAppraisalAnswer.findMany({ where: { appraisalFormId: appraisal.id } });
                previousValues = { selfAppraisal: selfData, answers };
            }
            else if (editReq.requestType === "INCHARGE") {
                // In-charge lives entirely on the new unified answers table.
                const inchargeAnswers = yield prisma_1.prisma.appraisalReviewAnswer.findMany({
                    where: { appraisalFormId: appraisal.id, level: "INCHARGE" },
                });
                previousValues = {
                    inchargeAnswers,
                    inchargeOverallScore: appraisal.inchargeOverallScore,
                    inchargeOverallComments: appraisal.inchargeOverallComments,
                };
            }
            else if (editReq.requestType === "MANAGER") {
                const managerData = yield prisma_1.prisma.managerAppraisal.findUnique({ where: { appraisalFormId: appraisal.id } });
                previousValues = { managerAppraisal: managerData };
            }
            else {
                const mgmtData = yield prisma_1.prisma.managementAppraisal.findUnique({ where: { appraisalFormId: appraisal.id } });
                previousValues = { managementAppraisal: mgmtData };
            }
            const editTypeMap = {
                SELF: "SELF_APPRAISAL",
                INCHARGE: "INCHARGE_APPRAISAL",
                MANAGER: "MANAGER_APPRAISAL",
                MANAGEMENT: "MANAGEMENT_APPRAISAL",
            };
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
            else if (editReq.requestType === "INCHARGE") {
                clearData.inchargeAppraisalSubmittedAt = null;
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
                // Unified review answers from the new dynamic form (In-charge / Manager
                // / Management). Frontend filters by `level` as needed.
                reviewAnswers: { include: { question: true }, orderBy: { question: { displayOrder: "asc" } } },
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
/**
 * POST /api/appraisals/:id/reassign-manager
 * HR override: reassign the manager on an open appraisal. Blocked once the
 * manager has already submitted (use the edit-request flow for that case).
 * Body: { newManagerId: number, reason?: string }
 */
const reassignAppraisalManager = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const appraisalId = Number(req.params.id);
        const { newManagerId, reason } = req.body;
        const editedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        if (!appraisalId || !newManagerId) {
            return res.status(400).json({ error: "appraisalId and newManagerId are required" });
        }
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id: appraisalId },
            include: { employee: { select: { firstName: true, lastName: true } } },
        });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        if (appraisal.managerAppraisalSubmittedAt) {
            return res.status(400).json({
                error: "Manager has already submitted this appraisal. Use the edit-request flow.",
            });
        }
        if (appraisal.managerId === Number(newManagerId)) {
            return res.status(400).json({ error: "That employee is already the appraisal's manager." });
        }
        const newMgr = yield prisma_1.prisma.employee.findUnique({
            where: { id: Number(newManagerId) },
            select: { id: true, firstName: true, lastName: true },
        });
        if (!newMgr)
            return res.status(404).json({ error: "New manager not found" });
        const oldManagerId = appraisal.managerId;
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.appraisalForm.update({
                where: { id: appraisalId },
                data: { managerId: Number(newManagerId) },
            });
            yield tx.appraisalEditHistory.create({
                data: {
                    appraisalFormId: appraisalId,
                    editedBy: editedBy !== null && editedBy !== void 0 ? editedBy : Number(newManagerId), // fall back so the FK is satisfied
                    editType: "MANAGER_REASSIGN",
                    previousValues: { managerId: oldManagerId },
                    newValues: { managerId: Number(newManagerId) },
                    editReason: reason || null,
                },
            });
        }));
        const empName = `${appraisal.employee.firstName} ${appraisal.employee.lastName}`.trim();
        const cycleLabel = appraisal.cycle ? ` (${appraisal.cycle})` : "";
        yield (0, notifications_controller_1.createNotification)(Number(newManagerId), `You have been assigned as the appraiser for ${empName}${cycleLabel}. Please complete the manager review.`);
        if (oldManagerId) {
            yield (0, notifications_controller_1.createNotification)(oldManagerId, `The appraisal for ${empName}${cycleLabel} has been reassigned to another manager.`);
        }
        return res.json({ success: true, appraisalId, oldManagerId, newManagerId: Number(newManagerId) });
    }
    catch (e) {
        console.error("reassignAppraisalManager error:", e);
        return res.status(500).json({ error: e.message || "Failed to reassign manager" });
    }
});
exports.reassignAppraisalManager = reassignAppraisalManager;
const REVIEW_LEVELS = ["INCHARGE", "MANAGER", "MANAGEMENT"];
const isReviewLevel = (v) => typeof v === "string" && REVIEW_LEVELS.includes(v);
/** Normalise the `levels` field (Json) to a string array, defaulting to all. */
const normaliseLevels = (raw) => {
    if (Array.isArray(raw)) {
        const arr = raw.filter(isReviewLevel);
        return arr.length ? arr : [...REVIEW_LEVELS];
    }
    return [...REVIEW_LEVELS];
};
/**
 * GET /review-questions?level=INCHARGE|MANAGER|MANAGEMENT&includeInactive=true
 * Lists master review questions. When `level` is provided, only questions
 * whose `levels` array includes that level are returned.
 */
const listReviewQuestions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const level = req.query.level;
        const includeInactive = req.query.includeInactive === "true";
        const where = includeInactive ? {} : { isActive: true };
        const all = yield prisma_1.prisma.appraisalReviewQuestion.findMany({
            where,
            orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
        });
        const filtered = level
            ? all.filter((q) => normaliseLevels(q.levels).includes(level))
            : all;
        return res.json(filtered.map((q) => (Object.assign(Object.assign({}, q), { levels: normaliseLevels(q.levels) }))));
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.listReviewQuestions = listReviewQuestions;
/** POST /review-questions — create a master question. */
const createReviewQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { title, description, prompts, aboveAverage, average, belowAverage, category, section, levels, displayOrder, isActive, } = req.body || {};
        if (!title || typeof title !== "string" || !title.trim()) {
            return res.status(400).json({ error: "title is required" });
        }
        const normalisedLevels = Array.isArray(levels) && levels.length
            ? levels.filter(isReviewLevel)
            : [...REVIEW_LEVELS];
        const q = yield prisma_1.prisma.appraisalReviewQuestion.create({
            data: {
                title: title.trim(),
                description: description !== null && description !== void 0 ? description : null,
                prompts: Array.isArray(prompts) ? prompts : null,
                aboveAverage: aboveAverage !== null && aboveAverage !== void 0 ? aboveAverage : null,
                average: average !== null && average !== void 0 ? average : null,
                belowAverage: belowAverage !== null && belowAverage !== void 0 ? belowAverage : null,
                category: category !== null && category !== void 0 ? category : null,
                section: section !== null && section !== void 0 ? section : null,
                levels: normalisedLevels,
                displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
                isActive: typeof isActive === "boolean" ? isActive : true,
            },
        });
        return res.json(Object.assign(Object.assign({}, q), { levels: normaliseLevels(q.levels) }));
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.createReviewQuestion = createReviewQuestion;
/** PATCH /review-questions/:id — update a master question. */
const updateReviewQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { title, description, prompts, aboveAverage, average, belowAverage, category, section, levels, displayOrder, isActive, } = req.body || {};
        const data = {};
        if (title !== undefined)
            data.title = String(title).trim();
        if (description !== undefined)
            data.description = description;
        if (prompts !== undefined)
            data.prompts = Array.isArray(prompts) ? prompts : null;
        if (aboveAverage !== undefined)
            data.aboveAverage = aboveAverage;
        if (average !== undefined)
            data.average = average;
        if (belowAverage !== undefined)
            data.belowAverage = belowAverage;
        if (category !== undefined)
            data.category = category;
        if (section !== undefined)
            data.section = section;
        if (levels !== undefined) {
            const arr = Array.isArray(levels) ? levels.filter(isReviewLevel) : [];
            data.levels = (arr.length ? arr : [...REVIEW_LEVELS]);
        }
        if (displayOrder !== undefined)
            data.displayOrder = Number(displayOrder);
        if (isActive !== undefined)
            data.isActive = !!isActive;
        const q = yield prisma_1.prisma.appraisalReviewQuestion.update({ where: { id }, data });
        return res.json(Object.assign(Object.assign({}, q), { levels: normaliseLevels(q.levels) }));
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.updateReviewQuestion = updateReviewQuestion;
/** PATCH /review-questions/:id/toggle — flip the isActive flag. */
const toggleReviewQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const current = yield prisma_1.prisma.appraisalReviewQuestion.findUnique({ where: { id } });
        if (!current)
            return res.status(404).json({ error: "Question not found" });
        const q = yield prisma_1.prisma.appraisalReviewQuestion.update({
            where: { id },
            data: { isActive: !current.isActive },
        });
        return res.json(Object.assign(Object.assign({}, q), { levels: normaliseLevels(q.levels) }));
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.toggleReviewQuestion = toggleReviewQuestion;
/**
 * DELETE /review-questions/:id — hard delete. If answers reference this
 * question we deactivate instead, to keep the audit trail.
 */
const deleteReviewQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const referenced = yield prisma_1.prisma.appraisalReviewAnswer.count({ where: { questionId: id } });
        if (referenced > 0) {
            const q = yield prisma_1.prisma.appraisalReviewQuestion.update({
                where: { id }, data: { isActive: false },
            });
            return res.json({ deactivated: true, question: Object.assign(Object.assign({}, q), { levels: normaliseLevels(q.levels) }) });
        }
        yield prisma_1.prisma.appraisalReviewQuestion.delete({ where: { id } });
        return res.json({ deleted: true });
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
});
exports.deleteReviewQuestion = deleteReviewQuestion;
// ═══════════════════════════════════════════════════════════════════════════════
// IN-CHARGE: SUBMIT REVIEW
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Persist an array of review answers for one (appraisal, level) bucket.
 * Used by the new In-charge / Manager / Management review flow.
 */
const saveReviewAnswers = (appraisalId, level, answers) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    for (const a of answers || []) {
        if (!(a === null || a === void 0 ? void 0 : a.questionId))
            continue;
        yield prisma_1.prisma.appraisalReviewAnswer.upsert({
            where: {
                appraisalFormId_questionId_level: {
                    appraisalFormId: appraisalId,
                    questionId: Number(a.questionId),
                    level,
                },
            },
            create: {
                appraisalFormId: appraisalId,
                questionId: Number(a.questionId),
                level,
                rating: (_a = a.rating) !== null && _a !== void 0 ? _a : null,
                comments: (_b = a.comments) !== null && _b !== void 0 ? _b : null,
            },
            update: {
                rating: (_c = a.rating) !== null && _c !== void 0 ? _c : null,
                comments: (_d = a.comments) !== null && _d !== void 0 ? _d : null,
            },
        });
    }
});
/**
 * POST /:id/incharge-appraisal
 * Body: { answers: [{questionId, rating, comments}], overallScore?, comments?, recommendations?, isDraft? }
 * Authorized: the appraisal's in-charge only.
 */
const submitInchargeAppraisal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    try {
        const id = Number(req.params.id);
        const { answers, overallScore, comments, isDraft } = req.body || {};
        const callerEmpId = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id },
            include: { employee: { select: { departmentId: true, firstName: true, lastName: true, inchargeId: true } } },
        });
        if (!appraisal)
            return res.status(404).json({ error: "Appraisal not found" });
        const guard = yield (0, appraisal_pause_controller_1.assertNotPausedOrHR)(appraisal.employeeId, callerEmpId);
        if (guard.blocked)
            return res.status(423).json({ error: guard.message });
        // Fall back to the employee's current in-charge for appraisals created
        // before the snapshot field existed. Snapshot it now so subsequent calls
        // (and the table display) are consistent.
        const effectiveInchargeId = (_e = (_c = appraisal.inchargeId) !== null && _c !== void 0 ? _c : (_d = appraisal.employee) === null || _d === void 0 ? void 0 : _d.inchargeId) !== null && _e !== void 0 ? _e : null;
        if (!effectiveInchargeId) {
            return res.status(400).json({ error: "This appraisal has no in-charge assigned" });
        }
        if (callerEmpId && Number(callerEmpId) !== effectiveInchargeId) {
            return res.status(403).json({ error: "Only the assigned in-charge can submit this review" });
        }
        if (!appraisal.inchargeId) {
            yield prisma_1.prisma.appraisalForm.update({
                where: { id },
                data: { inchargeId: effectiveInchargeId },
            });
        }
        if (appraisal.inchargeAppraisalSubmittedAt) {
            return res.status(400).json({ error: "In-charge review already submitted" });
        }
        if (!["PENDING_FILL", "SELF_APPRAISAL_SUBMITTED"].includes(appraisal.status)) {
            return res.status(400).json({ error: "In-charge review cannot be submitted at this stage" });
        }
        if (!Array.isArray(answers)) {
            return res.status(400).json({ error: "answers array is required" });
        }
        yield saveReviewAnswers(id, "INCHARGE", answers);
        // Persist In-charge's supplementary summary (score + comments) on both
        // draft and submit. We DON'T touch appraisal.overallScore — that's the
        // final score the manager owns.
        const inchargeOverallScore = typeof overallScore === "number" ? overallScore : null;
        const inchargeOverallComments = typeof comments === "string" && comments.trim() ? comments : null;
        // Save the overall fields on every call (draft + submit) so resume-from-
        // draft works. The submittedAt timestamp is only set on the final submit.
        yield prisma_1.prisma.appraisalForm.update({
            where: { id },
            data: { inchargeOverallScore, inchargeOverallComments },
        });
        if (!isDraft) {
            // If self + manager + management are already done, the in-charge is the
            // last gate → advance to HR_REVIEW. Otherwise stay PENDING_FILL.
            const selfDone = !!appraisal.selfAppraisalSubmittedAt;
            const managerDone = !!appraisal.managerAppraisalSubmittedAt;
            const managementDone = !!appraisal.managementAppraisalSubmittedAt;
            const newStatus = selfDone && managerDone && managementDone ? "HR_REVIEW" : appraisal.status;
            yield prisma_1.prisma.appraisalForm.update({
                where: { id },
                data: Object.assign({ inchargeAppraisalSubmittedAt: new Date() }, (newStatus !== appraisal.status ? { status: newStatus } : {})),
            });
            // Notify the manager that it's their turn.
            const empName = `${(_g = (_f = appraisal.employee) === null || _f === void 0 ? void 0 : _f.firstName) !== null && _g !== void 0 ? _g : ""} ${(_j = (_h = appraisal.employee) === null || _h === void 0 ? void 0 : _h.lastName) !== null && _j !== void 0 ? _j : ""}`.trim();
            if (appraisal.managerId) {
                yield (0, notifications_controller_1.createNotification)(appraisal.managerId, `In-charge review submitted for ${empName} (${appraisal.cycle}). Please complete your manager review.`);
            }
            yield notifyHRTeam((_l = (_k = appraisal.employee) === null || _k === void 0 ? void 0 : _k.departmentId) !== null && _l !== void 0 ? _l : 0, `In-charge review submitted for ${empName} (${appraisal.cycle}).`);
        }
        return res.json({ message: isDraft ? "In-charge review saved as draft" : "In-charge review submitted" });
    }
    catch (e) {
        console.error("submitInchargeAppraisal error:", e);
        return res.status(500).json({ error: e.message });
    }
});
exports.submitInchargeAppraisal = submitInchargeAppraisal;
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
                // EFFECTIVE months = calendar months elapsed minus the sum of any
                // EmployeeAppraisalPause windows (maternity, long medical leave …).
                // A 6-month pause delays the annual draft by 6 calendar months — the
                // cycle name still matches the employee's effective year.
                const effectiveMonths = yield (0, appraisal_pause_controller_1.getEffectiveMonthsSinceJoining)(emp.id, doj, today);
                // Eligible from 11 effective months. yearNum keeps the original
                // semantics: 11→Y1, 23→Y2, 35→Y3. The `existing` check below
                // prevents duplicates while we're inside an eligibility window.
                if (effectiveMonths >= 11) {
                    const yearNum = Math.floor((effectiveMonths + 1) / 12);
                    if (yearNum < 1)
                        continue;
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
        // Pull pause windows so we can exclude incidents / ratings that fell
        // inside a maternity / sabbatical period.
        const pauses = yield prisma_1.prisma.employeeAppraisalPause.findMany({
            where: {
                employeeId: appraisal.employeeId,
                startDate: { lte: endDate },
                OR: [{ endDate: null }, { endDate: { gte: startDate } }],
            },
            select: { startDate: true, endDate: true, reason: true },
        });
        const pausedDays = yield (0, appraisal_pause_controller_1.getPausedDaysBetween)(appraisal.employeeId, startDate, endDate);
        const isInPause = (d) => pauses.some(p => { var _a; return d >= p.startDate && d <= ((_a = p.endDate) !== null && _a !== void 0 ? _a : endDate); });
        // Incidents during the period (excluding paused windows)
        const incidentsRaw = yield prisma_1.prisma.incident.findMany({
            where: {
                employeeId: appraisal.employeeId,
                createdAt: { gte: startDate, lte: endDate },
            },
            select: { id: true, title: true, status: true, createdAt: true },
            orderBy: { createdAt: "desc" },
        });
        const incidents = incidentsRaw.filter(i => !isInPause(i.createdAt));
        // Weekly ratings during the period (excluding paused windows)
        const ratingsRaw = yield prisma_1.prisma.weeklyPerformanceRating.findMany({
            where: {
                employeeId: appraisal.employeeId,
                status: "SUBMITTED",
                weekStartDate: { gte: startDate, lte: endDate },
            },
            select: { weekStartDate: true, weekLabel: true, overallScore: true },
            orderBy: { weekStartDate: "asc" },
        });
        const weeklyRatings = ratingsRaw.filter(r => !isInPause(r.weekStartDate));
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
            pause: { totalDays: pausedDays, windows: pauses },
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
