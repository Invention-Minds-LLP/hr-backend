"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
var _a, _b, _c, _d, _e, _f;
Object.defineProperty(exports, "__esModule", { value: true });
exports.initNoticePeriodSchedular = exports.generateClearanceCertificate = void 0;
exports.createResignation = createResignation;
exports.listResignations = listResignations;
exports.getResignationById = getResignationById;
exports.withdrawResignation = withdrawResignation;
exports.managerApprove = managerApprove;
exports.managerReject = managerReject;
exports.hrApprove = hrApprove;
exports.hrReject = hrReject;
exports.hrCancel = hrCancel;
exports.addHandoverTasks = addHandoverTasks;
exports.updateTask = updateTask;
exports.upsertClearance = upsertClearance;
exports.scheduleExitInterview = scheduleExitInterview;
exports.createExitInterview = createExitInterview;
exports.getExitInterview = getExitInterview;
exports.listExitInterviews = listExitInterviews;
exports.setFinalSettlement = setFinalSettlement;
exports.markCompleted = markCompleted;
exports.hrHold = hrHold;
exports.requestWithdraw = requestWithdraw;
exports.hrApproveWithdraw = hrApproveWithdraw;
exports.hrRejectWithdraw = hrRejectWithdraw;
exports.uploadToFTP = uploadToFTP;
exports.listResignationsWithClearances = listResignationsWithClearances;
const client_1 = require("@prisma/client");
const date_fns_1 = require("date-fns");
const fsp = __importStar(require("fs/promises"));
const pdfkit_1 = __importDefault(require("pdfkit"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const basic_ftp_1 = require("basic-ftp");
const prisma = new client_1.PrismaClient();
const node_cron_1 = __importDefault(require("node-cron"));
const employee_controller_1 = require("../employee/employee.controller");
/** Utils */
const addDays = (d, days) => new Date(d.getTime() + days * 86400000);
/** Create resignation (Employee) */
function createResignation(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const { employeeId, reason, additionalNotes, noticePeriodDays } = req.body;
            // capture manager at the time of submission
            const emp = yield prisma.employee.findUnique({
                where: { id: Number(employeeId) },
                select: { reportingManager: true }
            });
            if (!emp)
                return res.status(404).json({ error: 'Employee not found' });
            const npd = Number(noticePeriodDays || 30);
            const proposedLWD = addDays(new Date(), npd);
            const rec = yield prisma.resignationRequest.create({
                data: {
                    employeeId: Number(employeeId),
                    managerId: (_a = emp.reportingManager) !== null && _a !== void 0 ? _a : null,
                    reason,
                    additionalNotes,
                    noticePeriodDays: npd,
                    proposedLastWorkingDay: proposedLWD,
                    status: 'SUBMITTED'
                }
            });
            res.status(201).json(rec);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to create resignation' });
        }
    });
}
/** List resignations with scope:
 *  - scope=mine&employeeId=#
 *  - scope=manager&managerId=#
 *  - scope=all (HR / HR Manager)
 *  Optional status filter: ?status=UNDER_REVIEW
 */
function listResignations(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { scope, employeeId, managerId, status } = req.query;
            const where = {};
            if (status)
                where.status = status;
            if (scope === 'mine' && employeeId)
                where.employeeId = Number(employeeId);
            else if (scope === 'manager' && managerId)
                where.managerId = Number(managerId);
            // scope=all -> no additional filter
            const rows = yield prisma.resignationRequest.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                include: {
                    employee: { select: { id: true, firstName: true, lastName: true, departmentId: true, designation: true, reportingManager: true } },
                    handoverTasks: true,
                    clearances: true,
                    exitInterview: true,
                    finalSettlement: true
                }
            });
            res.json(rows);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to fetch resignations' });
        }
    });
}
function getResignationById(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const row = yield prisma.resignationRequest.findUnique({
                where: { id },
                select: {
                    id: true,
                    // Only the minimal employee info you use
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true
                        }
                    },
                    // Tasks
                    handoverTasks: {
                        select: {
                            id: true,
                            title: true,
                            description: true,
                            assigneeId: true,
                            dueDate: true,
                            status: true,
                            completedAt: true
                        }
                    },
                    // Clearances
                    clearances: {
                        select: {
                            id: true,
                            type: true,
                            decision: true,
                            note: true,
                            verifierId: true,
                            verifier: {
                                select: {
                                    firstName: true,
                                    lastName: true
                                }
                            }
                        }
                    },
                    // Exit Interview
                    exitInterview: {
                        select: {
                            scheduledAt: true,
                            interviewerId: true,
                            notes: true
                        }
                    },
                    // Final Settlement
                    finalSettlement: {
                        select: {
                            status: true,
                            note: true
                        }
                    }
                }
            });
            if (!row)
                return res.status(404).json({ error: 'Resignation not found' });
            res.json(row);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to fetch resignation' });
        }
    });
}
/** Employee can withdraw before final HR decision */
function withdrawResignation(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const row = yield prisma.resignationRequest.findUnique({ where: { id } });
            if (!row)
                return res.status(404).json({ error: 'Not found' });
            if (row.hrDecision !== 'PENDING') {
                return res.status(400).json({ error: 'Cannot withdraw after HR decision' });
            }
            const upd = yield prisma.resignationRequest.update({
                where: { id },
                data: { status: 'WITHDRAWN' }
            });
            res.json(upd);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to withdraw' });
        }
    });
}
/** Manager approve/reject */
function managerApprove(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { note, overrideLastWorkingDay } = req.body; // optional LWD adjust
            const data = {
                managerDecision: 'APPROVED',
                managerDecidedAt: new Date(),
                managerNote: note,
                status: 'UNDER_REVIEW'
            };
            if (overrideLastWorkingDay)
                data.proposedLastWorkingDay = new Date(overrideLastWorkingDay);
            const upd = yield prisma.resignationRequest.update({
                where: { id },
                data
            });
            res.json(upd);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Manager approval failed' });
        }
    });
}
function managerReject(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { note } = req.body;
            const upd = yield prisma.resignationRequest.update({
                where: { id },
                data: {
                    managerDecision: 'REJECTED',
                    managerDecidedAt: new Date(),
                    managerNote: note,
                    status: 'REJECTED'
                }
            });
            res.json(upd);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Manager rejection failed' });
        }
    });
}
/** HR approve/reject */
function hrApprove(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            const id = Number(req.params.id);
            const { note, actualLastWorkingDay } = req.body;
            // Step 1: Approve the resignation and include employee info
            const upd = yield prisma.resignationRequest.update({
                where: { id },
                data: {
                    hrDecision: 'APPROVED',
                    hrDecidedAt: new Date(),
                    hrNote: note,
                    actualLastWorkingDay: actualLastWorkingDay ? new Date(actualLastWorkingDay) : undefined,
                    status: 'APPROVED',
                },
                include: {
                    employee: {
                        include: {
                            Department: true,
                            Branch: true,
                            designation: true
                        },
                    },
                },
            });
            // Step 2: Update employee status → NOTICE_PERIOD
            yield prisma.employee.update({
                where: { id: upd.employeeId },
                data: { employmentStatus: 'NOTICE_PERIOD' }
            });
            // Step 3: Auto-create backfill job (if none exists)
            const existingJob = yield prisma.job.findFirst({
                where: {
                    backfillForEmployeeId: upd.employeeId,
                    status: { in: ['OPEN', 'ON_HOLD'] },
                },
            });
            if (!existingJob && upd.employee) {
                const designationName = (_b = (_a = upd.employee.designation) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : 'Default';
                const newJob = yield prisma.job.create({
                    data: {
                        title: `${designationName} - Replacement`,
                        departmentId: upd.employee.departmentId,
                        location: ((_c = upd.employee.Branch) === null || _c === void 0 ? void 0 : _c.location) || 'Unknown',
                        headcount: 1,
                        status: 'OPEN',
                        createdBy: 0, // Fallback HR/system user ID
                        backfillForEmployeeId: upd.employeeId,
                    },
                });
                console.log(`✅ Created new job for replacement: Job ID ${newJob.id}`);
            }
            res.json(upd);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'HR approval failed' });
        }
    });
}
function hrReject(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { note } = req.body;
            const upd = yield prisma.resignationRequest.update({
                where: { id },
                data: {
                    hrDecision: 'REJECTED',
                    hrDecidedAt: new Date(),
                    hrNote: note,
                    status: 'REJECTED'
                }
            });
            res.json(upd);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'HR rejection failed' });
        }
    });
}
function hrCancel(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const upd = yield prisma.resignationRequest.update({
                where: { id },
                data: { status: 'CANCELLED' }
            });
            res.json(upd);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Cancel failed' });
        }
    });
}
/** Handover tasks */
function addHandoverTasks(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { tasks } = req.body;
            const created = yield prisma.$transaction(tasks.map(t => {
                var _a;
                return prisma.resignationHandoverTask.create({
                    data: {
                        resignationId: id,
                        title: t.title,
                        description: t.description,
                        assigneeId: (_a = t.assigneeId) !== null && _a !== void 0 ? _a : null,
                        dueDate: t.dueDate ? new Date(t.dueDate) : null
                    }
                });
            }));
            res.status(201).json(created);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Add tasks failed' });
        }
    });
}
function updateTask(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const taskId = Number(req.params.taskId);
            const { status } = req.body;
            const upd = yield prisma.resignationHandoverTask.update({
                where: { id: taskId },
                data: {
                    status,
                    completedAt: status === 'DONE' ? new Date() : null
                }
            });
            res.json(upd);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Update task failed' });
        }
    });
}
/** Clearances (upsert per type) */
function upsertClearance(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { type, decision, note, verifierId } = req.body;
            const existing = yield prisma.resignationClearance.findUnique({
                where: { resignationId_type: { resignationId: id, type } }
            });
            const row = existing
                ? yield prisma.resignationClearance.update({
                    where: { id: existing.id },
                    data: { decision, note, verifierId: verifierId !== null && verifierId !== void 0 ? verifierId : null, decidedAt: new Date() }
                })
                : yield prisma.resignationClearance.create({
                    data: { resignationId: id, type, decision, note, verifierId: verifierId !== null && verifierId !== void 0 ? verifierId : null, decidedAt: new Date() }
                });
            res.json(row);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Clearance update failed' });
        }
    });
}
/** Exit interview scheduling */
function scheduleExitInterview(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { scheduledAt, interviewerId, notes } = req.body;
            const resignation = yield prisma.resignationRequest.findUnique({
                where: { id: id },
                select: { employeeId: true },
            });
            if (!resignation) {
                return res.status(404).json({ error: 'Resignation request not found' });
            }
            const row = yield prisma.exitInterview.upsert({
                where: { resignationId: id },
                create: {
                    resignationId: id,
                    employeeId: resignation.employeeId,
                    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
                    interviewerId: interviewerId !== null && interviewerId !== void 0 ? interviewerId : null,
                    notes
                },
                update: {
                    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
                    interviewerId: interviewerId !== null && interviewerId !== void 0 ? interviewerId : null,
                    employeeId: resignation.employeeId,
                    notes
                }
            });
            res.json(row);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Exit interview scheduling failed' });
        }
    });
}
function createExitInterview(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const d = req.body;
            const interview = yield prisma.exitInterview.update({
                where: { resignationId: d.resignationId },
                data: {
                    employeeId: Number(d.employeeId),
                    interviewerId: d.interviewerId,
                    outcome: d.outcome,
                    completedAt: new Date(),
                    nextOrgName: d.nextOrgName,
                    nextOrgPosition: d.nextOrgPosition,
                    nextOrgCategory: d.nextOrgCategory,
                    nextOrgLocation: d.nextOrgLocation,
                    nextOrgIndustry: d.nextOrgIndustry,
                    academicQualification: JSON.stringify(d.academicQualification || {}),
                    vacancySource: JSON.stringify(d.vacancySource || {}),
                    recruitmentMode: JSON.stringify(d.recruitmentMode || {}),
                    reasonForLeaving: d.reasonForLeaving,
                    triggerReason: d.triggerReason,
                    mostSatisfying: d.mostSatisfying,
                    leastSatisfying: d.leastSatisfying,
                    supportReceived: d.supportReceived,
                    newJobOffers: d.newJobOffers,
                    expectationsMet: d.expectationsMet,
                    skillUtilization: d.skillUtilization,
                    influencedFactors: JSON.stringify(d.influencedFactors || {}),
                    dissatisfaction: JSON.stringify(d.dissatisfaction || {}),
                    jobOpinion: JSON.stringify(d.jobOpinion || {}),
                    attitudeSuperiors: JSON.stringify(d.attitudeSuperiors || {}),
                    companyOpinion: JSON.stringify(d.companyOpinion || {}),
                    newJobSalaryComparison: d.newJobSalaryComparison,
                    discrimination: d.discrimination,
                    likedMost: d.likedMost,
                    stayEncouragement: d.stayEncouragement,
                    recommendCompany: d.recommendCompany,
                    recommendReason: d.recommendReason,
                    demotivating: JSON.stringify(d.demotivating || {}),
                },
            });
            return res.json(interview);
        }
        catch (e) {
            console.error("createExitInterview error:", e);
            return res.status(500).json({ error: (e === null || e === void 0 ? void 0 : e.message) || "Failed to save exit interview" });
        }
    });
}
// GET one Exit Interview
function getExitInterview(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const interview = yield prisma.exitInterview.findUnique({
                where: { id },
                include: { employee: true },
            });
            if (!interview)
                return res.status(404).json({ error: "Not found" });
            const parsed = Object.assign(Object.assign({}, interview), { academicQualification: interview.academicQualification ? JSON.parse(interview.academicQualification) : {}, vacancySource: interview.vacancySource ? JSON.parse(interview.vacancySource) : {}, recruitmentMode: interview.recruitmentMode ? JSON.parse(interview.recruitmentMode) : {}, influencedFactors: interview.influencedFactors ? JSON.parse(interview.influencedFactors) : {}, dissatisfaction: interview.dissatisfaction ? JSON.parse(interview.dissatisfaction) : {}, jobOpinion: interview.jobOpinion ? JSON.parse(interview.jobOpinion) : {}, attitudeSuperiors: interview.attitudeSuperiors ? JSON.parse(interview.attitudeSuperiors) : {}, companyOpinion: interview.companyOpinion ? JSON.parse(interview.companyOpinion) : {}, demotivating: interview.demotivating ? JSON.parse(interview.demotivating) : {} });
            return res.json(parsed);
        }
        catch (e) {
            console.error("getExitInterview error:", e);
            return res.status(500).json({ error: (e === null || e === void 0 ? void 0 : e.message) || "Failed to fetch exit interview" });
        }
    });
}
// LIST all Exit Interviews
function listExitInterviews(_req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const all = yield prisma.exitInterview.findMany({
                include: { employee: true }, // get employee
                orderBy: { createdAt: "desc" },
            });
            // Map through interviews and fetch interviewer name
            const withInterviewer = yield Promise.all(all.map((interview) => __awaiter(this, void 0, void 0, function* () {
                let interviewerName = null;
                if (interview.interviewerId) {
                    const interviewer = yield prisma.employee.findUnique({
                        where: { id: interview.interviewerId },
                        select: { firstName: true, lastName: true },
                    });
                    if (interviewer) {
                        interviewerName = `${interviewer.firstName} ${interviewer.lastName}`;
                    }
                }
                return Object.assign(Object.assign({}, interview), { interviewerName });
            })));
            return res.json(withInterviewer);
        }
        catch (e) {
            console.error("listExitInterviews error:", e);
            return res.status(500).json({ error: (e === null || e === void 0 ? void 0 : e.message) || "Failed to fetch exit interviews" });
        }
    });
}
/** Final settlement status */
function setFinalSettlement(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { status, note } = req.body;
            const row = yield prisma.finalSettlement.upsert({
                where: { resignationId: id },
                create: { resignationId: id, status, note },
                update: { status, note }
            });
            res.json(row);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Final settlement update failed' });
        }
    });
}
/** Mark completed (HR) */
function markCompleted(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const upd = yield prisma.resignationRequest.update({
                where: { id },
                data: { status: 'COMPLETED' }
            });
            res.json(upd);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Mark completed failed' });
        }
    });
}
// PUT /resignations/:id/hr-hold  { note? }
function hrHold(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { note } = req.body;
            const upd = yield prisma.resignationRequest.update({
                where: { id },
                data: {
                    status: 'ON_HOLD',
                    hrNote: note !== null && note !== void 0 ? note : undefined,
                    // keep hrDecision as PENDING (not decided yet)
                    // hrDecidedAt: null  // optional: clear decidedAt if it was set
                }
            });
            res.json(upd);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: 'HR hold failed' });
        }
    });
}
// POST /resignations/:id/request-withdraw
function requestWithdraw(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { reason } = req.body;
            const row = yield prisma.resignationRequest.findUnique({ where: { id } });
            if (!row)
                return res.status(404).json({ error: "Not found" });
            // Cannot request if already approved/rejected/withdrawn
            if (["APPROVED", "REJECTED", "WITHDRAWN"].includes(row.status)) {
                return res.status(400).json({ error: "Cannot request withdraw at this stage" });
            }
            const upd = yield prisma.resignationRequest.update({
                where: { id },
                data: {
                    status: "WITHDRAW_REQUESTED",
                    withdrawRequestedAt: new Date(),
                    withdrawnReason: reason,
                    withdrawDecision: null,
                    withdrawDecidedAt: null,
                },
            });
            res.json(upd);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: "Request withdraw failed" });
        }
    });
}
// POST /resignations/:id/hr-withdraw-approve
function hrApproveWithdraw(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { note, approvedBy } = req.body;
            const row = yield prisma.resignationRequest.findUnique({ where: { id } });
            if (!row)
                return res.status(404).json({ error: "Not found" });
            if (row.status !== "WITHDRAW_REQUESTED") {
                return res.status(400).json({ error: "No withdraw request pending" });
            }
            const upd = yield prisma.resignationRequest.update({
                where: { id },
                data: {
                    status: "WITHDRAWN",
                    withdrawDecision: "APPROVED",
                    withdrawDecidedAt: new Date(),
                    withdrawnAt: new Date(),
                    withdrawStatusChangedBy: approvedBy,
                },
            });
            res.json(upd);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: "HR withdraw approval failed" });
        }
    });
}
// POST /resignations/:id/hr-withdraw-reject
function hrRejectWithdraw(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { note, rejectedBy } = req.body;
            const row = yield prisma.resignationRequest.findUnique({ where: { id } });
            if (!row)
                return res.status(404).json({ error: "Not found" });
            if (row.status !== "WITHDRAW_REQUESTED") {
                return res.status(400).json({ error: "No withdraw request pending" });
            }
            const upd = yield prisma.resignationRequest.update({
                where: { id },
                data: {
                    withdrawDecision: "REJECTED",
                    withdrawDecidedAt: new Date(),
                    withdrawStatusChangedBy: rejectedBy,
                    status: "SUBMITTED", // go back to normal resignation workflow
                },
            });
            res.json(upd);
        }
        catch (e) {
            console.error(e);
            res.status(500).json({ error: "HR withdraw rejection failed" });
        }
    });
}
const APP_PUBLIC_URL = (_a = process.env.APP_PUBLIC_URL) !== null && _a !== void 0 ? _a : 'https://example.com';
const COMPANY_NAME = (_b = process.env.COMPANY_NAME) !== null && _b !== void 0 ? _b : 'HR MINDS';
const COMPANY_LOGO_URL = (_c = process.env.COMPANY_LOGO_URL) !== null && _c !== void 0 ? _c : ''; // optional
const COMPANY_TAGLINE = (_d = process.env.COMPANY_TAGLINE) !== null && _d !== void 0 ? _d : ''; // optional
const PUBLIC_BASE_URL = (_e = process.env.PUBLIC_BASE_URL) !== null && _e !== void 0 ? _e : 'https://hrproindia.in';
const FTP_PUBLIC_DIR = (_f = process.env.FTP_PUBLIC_DIR) !== null && _f !== void 0 ? _f : '/public_html/certificate'; // remote dir
const generateClearanceCertificate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    const id = Number(req.params.id);
    // 1) Load resignation with related data
    const r = yield prisma.resignationRequest.findUnique({
        where: { id },
        include: {
            employee: { include: { Department: true, Branch: true } },
            clearances: true,
            handoverTasks: true,
            finalSettlement: true,
        },
    });
    if (!r)
        return res.status(404).json({ message: 'Resignation not found' });
    // 2) Eligibility checks
    const allClearancesApproved = r.clearances.length > 0 && r.clearances.every(c => c.decision === 'APPROVED');
    const allTasksDone = r.handoverTasks.every(t => t.status === 'DONE');
    const settlementPaid = ((_a = r.finalSettlement) === null || _a === void 0 ? void 0 : _a.status) === 'PAID';
    const statusOk = ['APPROVED', 'COMPLETED'].includes(r.status);
    if (!statusOk || !allClearancesApproved || !allTasksDone || !settlementPaid) {
        return res.status(400).json({
            message: 'Not eligible for clearance',
            details: { statusOk, allClearancesApproved, allTasksDone, settlementPaid },
        });
    }
    // 3) Build code + verification link
    const code = `CLR-${r.employee.employeeCode}-${(0, date_fns_1.format)(new Date(), 'yyyyMMdd-HHmm')}`;
    const verifyUrl = `${APP_PUBLIC_URL}/verify/clearance/${code}`;
    // 4) Generate PDF (temp file)
    const { filePath, fileName } = yield generateClearancePdf({
        code,
        issuedAt: new Date(),
        verifyUrl,
        employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
        employeeCode: r.employee.employeeCode,
        departmentName: (_c = (_b = r.employee.Department) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : null,
        branchName: (_e = (_d = r.employee.Branch) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : null,
        dateOfJoining: r.employee.dateOfJoining,
        lastWorkingDay: (_f = r.actualLastWorkingDay) !== null && _f !== void 0 ? _f : r.proposedLastWorkingDay,
        clearances: r.clearances.map(c => ({
            type: String(c.type),
            decision: c.decision, // 'PENDING' | 'APPROVED' | 'REJECTED'
            decidedAt: c.decidedAt,
            note: c.note,
        })),
        companyName: COMPANY_NAME,
        companyLogoUrl: COMPANY_LOGO_URL,
        companyTagline: COMPANY_TAGLINE,
    });
    // 5) Upload to FTP
    const remotePath = `${FTP_PUBLIC_DIR}/${fileName}`; // e.g. /public_html/certificate/CLR-EMP001-20250819-1234.pdf
    yield uploadToFTP(filePath, remotePath);
    // 6) Public URL to return & persist
    // If your Hostinger public dir maps to https://hrproindia.in/certificate/
    // ensure your FTP_PUBLIC_DIR is /public_html/certificate
    const filePublicPath = remotePath.replace('/public_html', ''); // -> /certificate/xxx.pdf
    const publicUrl = `${PUBLIC_BASE_URL}${filePublicPath}`;
    // 7) Persist URL + code
    yield prisma.resignationDocument.upsert({
        where: { resignationId: r.id },
        create: { resignationId: r.id, clearanceCertificateUrl: publicUrl, clearanceCertificateCode: code, clearanceIssuedAt: new Date(), },
        update: { clearanceCertificateUrl: publicUrl, clearanceCertificateCode: code, clearanceIssuedAt: new Date() },
    });
    // 8) Cleanup temp
    try {
        yield fsp.unlink(filePath);
    }
    catch (_g) { }
    return res.json({ url: publicUrl, code });
});
exports.generateClearanceCertificate = generateClearanceCertificate;
function generateClearancePdf(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const fileName = `${input.code}.pdf`;
        const filePath = path.join(os.tmpdir(), fileName);
        const doc = new pdfkit_1.default({ size: 'A4', margin: 36 }); // 595 x 842 pt
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);
        const w = doc.page.width, h = doc.page.height;
        const M = 36;
        const fmtDate = (d) => d ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d) : '—';
        function fetchBuffer(url) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!url)
                    return null;
                try {
                    const res = yield axios_1.default.get(url, { responseType: 'arraybuffer' });
                    return Buffer.from(res.data);
                }
                catch (_a) {
                    return null;
                }
            });
        }
        function dataURLtoBuffer(dataUrl) {
            const base64 = dataUrl.split(',')[1];
            return Buffer.from(base64, 'base64');
        }
        // Borders
        doc.save().roundedRect(18, 18, w - 36, h - 36, 12).lineWidth(3).stroke('#1f2937').restore();
        doc.save().roundedRect(28, 28, w - 56, h - 56, 10).lineWidth(1).stroke('#9ca3af').restore();
        // Header
        let cursorY = 54;
        const logo = yield fetchBuffer(input.companyLogoUrl);
        if (logo) {
            const logoW = 72;
            doc.image(logo, (w - logoW) / 2, cursorY, { width: logoW });
            cursorY += 84;
        }
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827')
            .text(input.companyName, M, cursorY, { width: w - 2 * M, align: 'center' });
        cursorY = doc.y;
        if (input.companyTagline) {
            doc.font('Helvetica').fontSize(10).fillColor('#6b7280')
                .text(input.companyTagline, M, cursorY + 2, { width: w - 2 * M, align: 'center' });
            cursorY = doc.y;
        }
        // Meta
        doc.moveDown(0.6);
        doc.font('Helvetica').fontSize(10).fillColor('#374151');
        doc.text(`Issued on: ${fmtDate(input.issuedAt)}`, M, doc.y, { width: (w - 2 * M) / 2, align: 'left' });
        doc.text(`Certificate ID: ${input.code}`, M + (w - 2 * M) / 2, doc.y - 12, { width: (w - 2 * M) / 2, align: 'right' });
        cursorY = doc.y + 6;
        // Title
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(22).fillColor('#1f2937')
            .text('CLEARANCE CERTIFICATE', M, cursorY, { width: w - 2 * M, align: 'center' });
        cursorY = doc.y + 8;
        // Employee Panel
        const panelX = M;
        const panelW = w - 2 * M;
        let panelY = cursorY;
        const panelPad = 10;
        const summaryStartY = panelY + panelPad;
        const leftW = panelW / 2 - 8;
        const rightW = panelW / 2 - 8;
        doc.font('Helvetica').fontSize(12).fillColor('#111827');
        let yL = summaryStartY;
        doc.text(`Employee Name: ${input.employeeName}`, panelX + panelPad, yL, { width: leftW });
        yL = doc.y + 4;
        doc.text(`Employee Code: ${input.employeeCode}`, panelX + panelPad, yL, { width: leftW });
        yL = doc.y + 4;
        doc.text(`Date of Joining: ${fmtDate((_a = input.dateOfJoining) !== null && _a !== void 0 ? _a : null)}`, panelX + panelPad, yL, { width: leftW });
        let yR = summaryStartY;
        doc.text(`Department: ${(_b = input.departmentName) !== null && _b !== void 0 ? _b : '—'}`, panelX + panelPad + leftW + 16, yR, { width: rightW });
        yR = doc.y + 4;
        doc.text(`Branch: ${(_c = input.branchName) !== null && _c !== void 0 ? _c : '—'}`, panelX + panelPad + leftW + 16, yR, { width: rightW });
        yR = doc.y + 4;
        doc.text(`Last Working Day: ${fmtDate((_d = input.lastWorkingDay) !== null && _d !== void 0 ? _d : null)}`, panelX + panelPad + leftW + 16, yR, { width: rightW });
        const panelH = Math.max(yL, yR) - summaryStartY + panelPad + 10;
        doc.save().roundedRect(panelX, panelY, panelW, panelH, 8).lineWidth(1).stroke('#e5e7eb').restore();
        cursorY = panelY + panelH + 10;
        // Statement
        doc.font('Helvetica').fontSize(12).fillColor('#374151')
            .text('This is to certify that the above employee has completed the exit formalities and has no dues pending with the company as on the date of issue.', M, cursorY, { width: w - 2 * M, align: 'left' });
        cursorY = doc.y + 10;
        // Table
        const tableX = M;
        const pageBottom = h - 140; // leave room for QR/signatures
        const colWidths = [120, 90, 100, (w - 2 * M) - (120 + 90 + 100)];
        const headerH = 22;
        let y = cursorY;
        const drawHeader = () => {
            drawRow({ doc, x: tableX, y, heights: headerH, widths: colWidths, cells: ['Clearance Area', 'Decision', 'Approved On', 'Notes'], header: true });
            y += headerH;
        };
        drawHeader();
        for (const c of input.clearances) {
            const cells = [c.type, c.decision, fmtDate((_e = c.decidedAt) !== null && _e !== void 0 ? _e : null), (_f = c.note) !== null && _f !== void 0 ? _f : ''];
            const neededH = measureRowHeight({ doc, widths: colWidths, cells });
            if (y + neededH > pageBottom) {
                doc.addPage();
                y = M;
                // repeat header on new page
                drawHeader();
            }
            y += drawRow({ doc, x: tableX, y, heights: 22, widths: colWidths, cells });
        }
        // QR + signatures
        // const qrDataUrl = await QRCode.toDataURL(input.verifyUrl);
        // const qrBuf = dataURLtoBuffer(qrDataUrl);
        // const qrSize = 96;
        // const qrX = w - M - qrSize;
        // const qrY = Math.min(h - 180, y + 12);
        // doc.image(qrBuf, qrX, qrY, { width: qrSize });
        // doc.font('Helvetica').fontSize(10).fillColor('#6b7280')
        //    .text('Scan to verify', qrX, qrY + qrSize + 4, { width: qrSize, align: 'center' });
        const sigY = Math.min(h - 180, y + 12) + 20;
        doc.moveTo(M + 30, sigY).lineTo(M + 180, sigY).stroke('#9ca3af');
        doc.moveTo(M + 230, sigY).lineTo(M + 380, sigY).stroke('#9ca3af');
        doc.font('Helvetica').fontSize(10).fillColor('#374151')
            .text('HR Representative', M + 30, sigY + 6, { width: 150, align: 'center' })
            .text('Department Head', M + 230, sigY + 6, { width: 150, align: 'center' });
        doc.font('Helvetica').fontSize(10).fillColor('#6b7280');
        doc.text('This is a system-generated document and does not require a physical signature.', M, h - 70, {
            width: w - 2 * M, align: 'center'
        });
        doc.end();
        yield new Promise((resolve, reject) => {
            stream.on('finish', resolve);
            stream.on('error', reject);
        });
        return { filePath, fileName };
        // ------- helpers -------
        function measureRowHeight(opts) {
            var _a;
            const padX = 6, padY = 6;
            let maxH = 22;
            const originalY = doc.y;
            for (let i = 0; i < opts.cells.length; i++) {
                const width = opts.widths[i] - padX * 2;
                const height = doc.heightOfString((_a = opts.cells[i]) !== null && _a !== void 0 ? _a : '', { width, align: 'left' });
                maxH = Math.max(maxH, height + padY * 2);
            }
            doc.y = originalY;
            return maxH;
        }
        function drawRow(opts) {
            var _a;
            const padX = 6, padY = 6;
            const baseY = opts.y;
            const totalW = opts.widths.reduce((a, b) => a + b, 0);
            if (opts.header) {
                doc.save().rect(opts.x, baseY, totalW, opts.heights).fill('#f3f4f6').restore();
                doc.lineWidth(1).strokeColor('#e5e7eb').rect(opts.x, baseY, totalW, opts.heights).stroke();
                doc.font('Helvetica-Bold').fillColor('#111827').fontSize(11);
            }
            else {
                doc.lineWidth(1).strokeColor('#e5e7eb').rect(opts.x, baseY, totalW, opts.heights).stroke();
                doc.font('Helvetica').fillColor('#111827').fontSize(11);
            }
            let cx = opts.x;
            let maxY = baseY + opts.heights;
            for (let i = 0; i < opts.cells.length; i++) {
                const cellW = opts.widths[i];
                const tx = cx + padX;
                const ty = baseY + padY;
                const options = { width: cellW - padX * 2, align: 'left' };
                const startY = doc.y;
                doc.text((_a = opts.cells[i]) !== null && _a !== void 0 ? _a : '', tx, ty, options);
                maxY = Math.max(maxY, doc.y + padY);
                doc.y = startY;
                cx += cellW;
            }
            const finalH = Math.max(opts.heights, maxY - baseY);
            if (finalH > opts.heights) {
                doc.lineWidth(1).strokeColor('#e5e7eb').rect(opts.x, baseY, totalW, finalH).stroke();
            }
            // vertical separators
            let vx = opts.x;
            for (let i = 0; i < opts.widths.length - 1; i++) {
                vx += opts.widths[i];
                doc.moveTo(vx, baseY).lineTo(vx, baseY + finalH).stroke('#e5e7eb');
            }
            return finalH;
        }
    });
}
const FTP_CONFIG = {
    host: "srv680.main-hosting.eu", // Your FTP hostname
    user: "u948610439.hrproindia.in", // Your FTP username
    password: "Bsrenuk@1993", // Your FTP password
    secure: false // Set to true if using FTPS
};
function uploadToFTP(localFilePath, remoteFilePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = false;
        try {
            yield client.access(FTP_CONFIG);
            // Ensure parent dir exists (e.g., /public_html/certificate)
            const lastSlash = remoteFilePath.lastIndexOf('/');
            const remoteDir = remoteFilePath.substring(0, lastSlash);
            if (remoteDir)
                yield client.ensureDir(remoteDir);
            yield client.uploadFrom(localFilePath, remoteFilePath);
        }
        finally {
            client.close();
        }
    });
}
function listResignationsWithClearances(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        try {
            const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            const user = yield prisma.user.findUnique({
                where: { id: userId },
                include: {
                    employee: {
                        include: { role: true, Department: true }
                    }
                }
            });
            if (!user) {
                res.status(404).json({ error: 'User not found' });
                return;
            }
            const emp = user.employee;
            const isReportingManager = emp.roleId === 3;
            const isHRManager = emp.roleId === 1;
            // ✅ Determine which clearance type this user manages
            const deptName = (_d = (_c = (_b = emp.Department) === null || _b === void 0 ? void 0 : _b.name) === null || _c === void 0 ? void 0 : _c.toUpperCase()) !== null && _d !== void 0 ? _d : '';
            const allowedClearanceType = ['HR', 'FINANCE', 'IT', 'ADMIN', 'SECURITY'].includes(deptName)
                ? deptName
                : null;
            const whereCondition = isHRManager
                ? {} // HR sees all
                : { managerId: emp.id }; // Reporting managers see only their reports
            if (!isReportingManager) {
                // If not reporting manager → optional logic
                // either block access or show all (if HR/Admin)
                return res.status(403).json({ error: 'Access denied. Only reporting managers can view clearances.' });
            }
            // Fetch resignations under this reporting manager
            const resignations = yield prisma.resignationRequest.findMany({
                where: whereCondition, // 👈 show only employees reporting to this manager
                include: {
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            departmentId: true,
                            employeeCode: true,
                            Department: { select: { name: true } }
                        }
                    },
                    clearances: allowedClearanceType
                        ? { where: { type: allowedClearanceType } } // ✅ Cast it to the enum
                        : false,
                },
                orderBy: { createdAt: 'desc' }
            });
            res.json(resignations);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Failed to load resignation clearances' });
        }
    });
}
const initNoticePeriodSchedular = () => {
    node_cron_1.default.schedule('0 2 * * *', () => __awaiter(void 0, void 0, void 0, function* () {
        console.log('⏰ [Cron] Checking employees whose notice period has ended...');
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            // 1️⃣ Find all resignation requests that are approved and whose actual LWD < today
            const dueResignations = yield prisma.resignationRequest.findMany({
                where: {
                    status: 'APPROVED',
                    actualLastWorkingDay: { lt: today },
                    employee: {
                        employmentStatus: 'NOTICE_PERIOD',
                    },
                },
                include: {
                    employee: true,
                },
            });
            console.log(`📋 Found ${dueResignations.length} employees with ended notice period.`);
            // 2️⃣ Update each employee to 'RESIGNED'
            for (const resignation of dueResignations) {
                yield prisma.employee.update({
                    where: { id: resignation.employeeId },
                    data: { employmentStatus: 'RESIGNED' },
                });
                console.log(`✅ Employee ID ${resignation.employeeId} marked as RESIGNED.`);
                // // Optional: also update the resignation request status → COMPLETED
                // await prisma.resignationRequest.update({
                //   where: { id: resignation.id },
                //   data: { status: 'COMPLETED' },
                // });
            }
            console.log('🎉 [Cron] Notice period check completed.');
            console.log("⏰ Running Health Check Reminder...");
            yield (0, employee_controller_1.sendHealthCheckReminders)();
            console.log("🎉 Health Check Reminder Completed.");
        }
        catch (error) {
            console.error('❌ [Cron] Error in notice period check:', error);
        }
    }));
};
exports.initNoticePeriodSchedular = initNoticePeriodSchedular;
