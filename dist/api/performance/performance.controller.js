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
exports.getAllSummaries = exports.assignSummaryTemplate = exports.assignFormToEmployee = exports.submitFullForm = exports.getEmployeeForm = exports.submitFinalReview = exports.submitSummary = exports.submitResponses = exports.listTemplatesByDept = exports.deleteTemplate = exports.updateTemplate = exports.getTemplateDetail = exports.getTemplateByDept = exports.createTemplate = void 0;
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
// Create a template
const createTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { departmentId, cycle, title, questions } = req.body;
        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: "title is required" });
        }
        const template = yield prisma_1.prisma.performanceFormTemplate.create({
            data: {
                departmentId,
                cycle,
                title: String(title).trim(),
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
// Fetch ONE template — kept for backward compatibility. Prefers templateId,
// falls back to (departmentId, cycle) and returns the first match.
const getTemplateByDept = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { departmentId } = req.params;
        const { cycle, templateId } = req.query;
        if (templateId) {
            const template = yield prisma_1.prisma.performanceFormTemplate.findUnique({
                where: { id: Number(templateId) },
                include: { questions: { orderBy: { orderNo: 'asc' } }, department: true }
            });
            return res.json(template);
        }
        const template = yield prisma_1.prisma.performanceFormTemplate.findFirst({
            where: Object.assign({ departmentId: Number(departmentId) }, (cycle ? { cycle } : {})),
            include: { questions: { orderBy: { orderNo: 'asc' } }, department: true }
        });
        res.json(template);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getTemplateByDept = getTemplateByDept;
// Single template + ordered questions, for the builder when editing.
const getTemplateDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const template = yield prisma_1.prisma.performanceFormTemplate.findUnique({
            where: { id: Number(id) },
            include: {
                questions: { orderBy: { orderNo: 'asc' } },
                department: true,
                _count: { select: { summaries: true } },
            }
        });
        if (!template)
            return res.status(404).json({ error: 'Template not found' });
        const responseCount = yield prisma_1.prisma.performanceResponse.count({
            where: { questionId: { in: template.questions.map(q => q.id) } },
        });
        res.json(Object.assign(Object.assign({}, template), { responseCount }));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.getTemplateDetail = getTemplateDetail;
// Replace title + questions on an existing template. Refuses if any response
// has been recorded against the template's questions (clone instead).
const updateTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { title, questions } = req.body;
        const template = yield prisma_1.prisma.performanceFormTemplate.findUnique({
            where: { id },
            include: { questions: { select: { id: true } } },
        });
        if (!template)
            return res.status(404).json({ error: 'Template not found' });
        const responseCount = yield prisma_1.prisma.performanceResponse.count({
            where: { questionId: { in: template.questions.map(q => q.id) } },
        });
        if (responseCount > 0) {
            return res.status(409).json({
                error: 'This template already has employee responses. Clone it instead of editing.',
                responseCount,
            });
        }
        const updated = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            if (title !== undefined) {
                yield tx.performanceFormTemplate.update({
                    where: { id },
                    data: { title: String(title).trim() || 'Default' },
                });
            }
            if (Array.isArray(questions)) {
                yield tx.performanceQuestion.deleteMany({ where: { templateId: id } });
                if (questions.length) {
                    yield tx.performanceQuestion.createMany({
                        data: questions.map((q, i) => {
                            var _a, _b;
                            return ({
                                templateId: id,
                                category: q.category,
                                text: q.text,
                                orderNo: (_a = q.orderNo) !== null && _a !== void 0 ? _a : i,
                                weight: (_b = q.weight) !== null && _b !== void 0 ? _b : null,
                            });
                        }),
                    });
                }
            }
            return tx.performanceFormTemplate.findUnique({
                where: { id },
                include: { questions: { orderBy: { orderNo: 'asc' } } },
            });
        }));
        res.json(updated);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.updateTemplate = updateTemplate;
// Refuses delete if the template has been assigned to anyone or has any
// recorded responses; otherwise removes questions then the template.
const deleteTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const template = yield prisma_1.prisma.performanceFormTemplate.findUnique({
            where: { id },
            include: { questions: { select: { id: true } }, _count: { select: { summaries: true } } },
        });
        if (!template)
            return res.status(404).json({ error: 'Template not found' });
        if (template._count.summaries > 0) {
            return res.status(409).json({ error: 'Template is assigned to employees and cannot be deleted.' });
        }
        const responseCount = yield prisma_1.prisma.performanceResponse.count({
            where: { questionId: { in: template.questions.map(q => q.id) } },
        });
        if (responseCount > 0) {
            return res.status(409).json({ error: 'Template has recorded responses and cannot be deleted.' });
        }
        yield prisma_1.prisma.$transaction([
            prisma_1.prisma.performanceQuestion.deleteMany({ where: { templateId: id } }),
            prisma_1.prisma.performanceFormTemplate.delete({ where: { id } }),
        ]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.deleteTemplate = deleteTemplate;
// List templates for a department + cycle so HR can pick by name.
const listTemplatesByDept = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { departmentId, cycle } = req.query;
        if (!departmentId)
            return res.status(400).json({ error: "departmentId is required" });
        const templates = yield prisma_1.prisma.performanceFormTemplate.findMany({
            where: Object.assign({ departmentId: Number(departmentId) }, (cycle ? { cycle } : {})),
            orderBy: [{ cycle: 'desc' }, { title: 'asc' }],
            include: {
                _count: { select: { questions: true } }
            }
        });
        res.json(templates);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.listTemplatesByDept = listTemplatesByDept;
// Submit per-question responses — upsert per (employee, cycle, period, question)
const submitResponses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, departmentId, cycle, responses } = req.body;
        yield prisma_1.prisma.$transaction((responses || []).map((r) => prisma_1.prisma.performanceResponse.upsert({
            where: {
                employeeId_cycle_period_questionId: {
                    employeeId,
                    cycle,
                    period: r.period,
                    questionId: r.questionId,
                },
            },
            create: {
                employeeId,
                departmentId,
                cycle,
                questionId: r.questionId,
                period: r.period,
                score: r.score,
                reviewerId: r.reviewerId,
                comments: r.comments,
            },
            update: {
                score: r.score,
                reviewerId: r.reviewerId,
                comments: r.comments,
            },
        })));
        res.json({ success: true });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.submitResponses = submitResponses;
// Submit summary — idempotent per (employee, cycle, period, templateId)
const submitSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, departmentId, cycle, templateId, summaries } = req.body;
        const tid = templateId !== null && templateId !== void 0 ? templateId : null;
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            for (const s of (summaries || [])) {
                yield upsertSummary(tx, { employeeId, departmentId, cycle, templateId: tid, summary: s });
            }
        }));
        res.json({ success: true });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.submitSummary = submitSummary;
// Internal helper — MySQL treats NULL as distinct in unique indexes, so the
// compound `employeeId_cycle_period_templateId` upsert doesn't work when
// templateId is null. findFirst + create/update covers both cases.
function upsertSummary(tx, args) {
    return __awaiter(this, void 0, void 0, function* () {
        const { employeeId, departmentId, cycle, templateId, summary: s } = args;
        const existing = yield tx.performanceSummary.findFirst({
            where: { employeeId, cycle, period: s.period, templateId },
        });
        const fields = {
            marksScored: s.marksScored,
            overallPerf: s.overallPerf,
            employeeSig: s.employeeSig,
            supervisorSig: s.supervisorSig,
            hodSig: s.hodSig,
        };
        if (existing) {
            return tx.performanceSummary.update({ where: { id: existing.id }, data: fields });
        }
        return tx.performanceSummary.create({
            data: Object.assign({ employeeId,
                departmentId,
                cycle,
                templateId, period: s.period }, fields),
        });
    });
}
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
// Returns template + employee + saved responses/summaries/finalReview.
// Accepts templateId as a query param (preferred). Falls back to dept+cycle.
const getEmployeeForm = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, departmentId } = req.params;
        const { cycle, templateId } = req.query;
        let template;
        if (templateId) {
            template = yield prisma_1.prisma.performanceFormTemplate.findUnique({
                where: { id: Number(templateId) },
                include: { questions: { orderBy: { orderNo: 'asc' } }, department: true }
            });
        }
        else {
            template = yield prisma_1.prisma.performanceFormTemplate.findFirst({
                where: Object.assign({ departmentId: Number(departmentId) }, (cycle ? { cycle } : {})),
                include: { questions: { orderBy: { orderNo: 'asc' } }, department: true }
            });
        }
        if (!template)
            return res.status(404).json({ error: "Template not found" });
        const employee = yield prisma_1.prisma.employee.findUnique({
            where: { id: Number(employeeId) },
            include: { Department: true }
        });
        const responses = yield prisma_1.prisma.performanceResponse.findMany({
            where: Object.assign(Object.assign({ employeeId: Number(employeeId), departmentId: Number(departmentId) }, (cycle ? { cycle } : {})), { questionId: { in: template.questions.map(q => q.id) } })
        });
        const summaries = yield prisma_1.prisma.performanceSummary.findMany({
            where: Object.assign(Object.assign({ employeeId: Number(employeeId), departmentId: Number(departmentId) }, (cycle ? { cycle } : {})), (templateId ? { templateId: Number(templateId) } : {}))
        });
        const finalReview = yield prisma_1.prisma.performanceFinalReview.findFirst({
            where: Object.assign({ employeeId: Number(employeeId), departmentId: Number(departmentId) }, (cycle ? { cycle } : {}))
        });
        res.json({
            template,
            employee,
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
    var _a, _b, _c, _d;
    try {
        const data = req.body;
        const templateId = (_a = data.templateId) !== null && _a !== void 0 ? _a : null;
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            // 1) Upsert per-question responses (idempotent on re-submit)
            if ((_a = data.responses) === null || _a === void 0 ? void 0 : _a.length) {
                for (const r of data.responses) {
                    yield tx.performanceResponse.upsert({
                        where: {
                            employeeId_cycle_period_questionId: {
                                employeeId: data.employeeId,
                                cycle: data.cycle,
                                period: r.period,
                                questionId: r.questionId,
                            },
                        },
                        create: {
                            employeeId: data.employeeId,
                            departmentId: data.departmentId,
                            cycle: data.cycle,
                            questionId: r.questionId,
                            period: r.period,
                            score: r.score,
                            reviewerId: r.reviewerId,
                            comments: r.comments,
                        },
                        update: {
                            score: r.score,
                            reviewerId: r.reviewerId,
                            comments: r.comments,
                        },
                    });
                }
            }
            // 2) Upsert period summaries (idempotent on re-submit)
            if ((_b = data.summaries) === null || _b === void 0 ? void 0 : _b.length) {
                for (const s of data.summaries) {
                    yield upsertSummary(tx, {
                        employeeId: data.employeeId,
                        departmentId: data.departmentId,
                        cycle: data.cycle,
                        templateId,
                        summary: s,
                    });
                }
            }
            // 3) Final review (one per cycle+employee)
            if (data.finalReview) {
                const existing = yield tx.performanceFinalReview.findFirst({
                    where: {
                        employeeId: data.employeeId,
                        departmentId: data.departmentId,
                        cycle: data.cycle,
                    },
                });
                if (existing) {
                    yield tx.performanceFinalReview.update({
                        where: { id: existing.id },
                        data: {
                            appreciations: data.finalReview.appreciations,
                            talents: data.finalReview.talents,
                            overallComments: data.finalReview.overallComments,
                            employeeSig: data.finalReview.employeeSig,
                            supervisorSig: data.finalReview.supervisorSig,
                            hrSig: data.finalReview.hrSig,
                        },
                    });
                }
                else {
                    yield tx.performanceFinalReview.create({
                        data: {
                            employeeId: data.employeeId,
                            departmentId: data.departmentId,
                            cycle: data.cycle,
                            appreciations: data.finalReview.appreciations,
                            talents: data.finalReview.talents,
                            overallComments: data.finalReview.overallComments,
                            employeeSig: data.finalReview.employeeSig,
                            supervisorSig: data.finalReview.supervisorSig,
                            hrSig: data.finalReview.hrSig,
                        },
                    });
                }
            }
        }));
        // 4) Notify HR when summaries are submitted without a final review yet.
        if (!data.finalReview && ((_b = data.summaries) === null || _b === void 0 ? void 0 : _b.length)) {
            const employee = yield prisma_1.prisma.employee.findUnique({
                where: { id: data.employeeId },
                select: { firstName: true, lastName: true, employeeCode: true },
            });
            const employeeName = employee
                ? `${employee.firstName} ${employee.lastName}`
                : `Employee #${data.employeeId}`;
            const hrUsers = yield prisma_1.prisma.employee.findMany({
                where: { departmentId: 1, employmentStatus: 'ACTIVE' },
                select: { id: true },
            });
            const period = (_d = (_c = data.summaries[0]) === null || _c === void 0 ? void 0 : _c.period) !== null && _d !== void 0 ? _d : '';
            const message = `HOD has submitted appraisal for ${employeeName} for ${data.cycle}${period ? ` – ${period}` : ''}. Please review.`;
            for (const hr of hrUsers) {
                yield (0, notifications_controller_1.createNotification)(hr.id, message);
            }
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
        const { employeeId, employeeIds, departmentId, cycle, period, templateId } = req.body;
        if (!templateId)
            return res.status(400).json({ error: "templateId is required" });
        const template = yield prisma_1.prisma.performanceFormTemplate.findUnique({ where: { id: Number(templateId) } });
        if (!template)
            return res.status(404).json({ error: "Template not found" });
        if (template.departmentId !== Number(departmentId)) {
            return res.status(400).json({ error: "Template does not belong to the selected department" });
        }
        if (template.cycle !== cycle) {
            return res.status(400).json({ error: "Template cycle does not match" });
        }
        const ids = employeeIds || (employeeId ? [employeeId] : []);
        if (!ids.length) {
            return res.status(400).json({ error: "No employees provided" });
        }
        const results = [];
        for (const id of ids) {
            const exists = yield prisma_1.prisma.performanceSummary.findFirst({
                where: { employeeId: id, departmentId, cycle, period, templateId: Number(templateId) }
            });
            if (!exists) {
                const summary = yield prisma_1.prisma.performanceSummary.create({
                    data: {
                        employeeId: id,
                        departmentId,
                        cycle,
                        period,
                        templateId: Number(templateId),
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
// Attach (or re-attach) a template to a summary that was created before
// templateId became required. Refuses if the summary already has recorded
// responses, because those responses are keyed by questionId from whatever
// template was active at the time and would orphan against the new template.
const assignSummaryTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const summaryId = Number(req.params.id);
        const { templateId } = req.body;
        if (!templateId)
            return res.status(400).json({ error: 'templateId is required' });
        const summary = yield prisma_1.prisma.performanceSummary.findUnique({
            where: { id: summaryId },
        });
        if (!summary)
            return res.status(404).json({ error: 'Summary not found' });
        const template = yield prisma_1.prisma.performanceFormTemplate.findUnique({
            where: { id: Number(templateId) },
        });
        if (!template)
            return res.status(404).json({ error: 'Template not found' });
        if (template.departmentId !== summary.departmentId) {
            return res.status(400).json({ error: 'Template does not belong to this summary\'s department' });
        }
        if (template.cycle !== summary.cycle) {
            return res.status(400).json({ error: 'Template cycle does not match summary cycle' });
        }
        const responseCount = yield prisma_1.prisma.performanceResponse.count({
            where: {
                employeeId: summary.employeeId,
                cycle: summary.cycle,
            },
        });
        if (responseCount > 0) {
            return res.status(409).json({
                error: 'This row already has recorded responses and the template cannot be reassigned.',
                responseCount,
            });
        }
        const updated = yield prisma_1.prisma.performanceSummary.update({
            where: { id: summaryId },
            data: { templateId: Number(templateId) },
            include: { template: { select: { id: true, title: true } } },
        });
        res.json(updated);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
exports.assignSummaryTemplate = assignSummaryTemplate;
// Get all summaries with employee & department + template title for display
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
                },
                template: {
                    select: { id: true, title: true }
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
