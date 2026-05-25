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
exports.getPoshCommitteeAcks = exports.getGrievanceCommitteeAcks = exports.getUnacknowledgedComplaints = exports.checkAcknowledgement = exports.getAcknowledgementsByEmployee = exports.createAcknowledgement = exports.updateGrievanceStatus = exports.addGrievanceComment = exports.listGrievances = exports.createGrievance = void 0;
const express_async_handler_1 = __importDefault(require("express-async-handler"));
// import { PrismaClient, PermissionStatus } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
const committee_controller_1 = require("../committee/committee.controller");
// --- Create grievance
exports.createGrievance = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { title, description, category } = req.body;
    let employeeId = Number(req.body.employeeId);
    // Bind the case to the active Grievance Committee (if one is configured).
    // If no committee is set up, we still create the case and fall back to the
    // legacy "notify all HR" behaviour so this never breaks the existing flow.
    const committee = yield (0, committee_controller_1.findActiveCommittee)('GRIEVANCE');
    const grievance = yield prisma_1.prisma.grievance.create({
        data: { employeeId, title, description, category, committeeId: (_a = committee === null || committee === void 0 ? void 0 : committee.id) !== null && _a !== void 0 ? _a : null }
    });
    // 🔔 Notify the committee members if we have one; else fall back to HR.
    let recipients = [];
    if (committee) {
        recipients = yield (0, committee_controller_1.getCommitteeMemberEmpIds)(committee.id);
    }
    if (recipients.length === 0) {
        const hrEmployees = yield prisma_1.prisma.employee.findMany({
            where: { departmentId: 1 }, // HR fallback
            select: { id: true },
        });
        recipients = hrEmployees.map((h) => h.id);
    }
    for (const rid of recipients) {
        yield (0, notifications_controller_1.createNotification)(rid, 'New grievance submitted — requires acknowledgment');
    }
    res.json(grievance);
}));
// --- List grievances
exports.listGrievances = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    // View gating (less strict than POSH — HR Manager / Admin keep full visibility):
    //   • HR Manager / Admin / Management → all grievances
    //   • The complainant (employee who raised it) → their own
    //   • Active members of the Grievance Committee handling the case → that case
    //   • Anyone else → nothing
    const user = req.user;
    const me = Number((_a = user === null || user === void 0 ? void 0 : user.empId) !== null && _a !== void 0 ? _a : user === null || user === void 0 ? void 0 : user.userId);
    const role = String((_b = user === null || user === void 0 ? void 0 : user.role) !== null && _b !== void 0 ? _b : '').toUpperCase();
    const roleId = Number(user === null || user === void 0 ? void 0 : user.roleId);
    const isPrivileged = ['HR_MANAGER', 'ADMIN', 'MANAGEMENT'].includes(role) || roleId === 1 || roleId === 4;
    let where = {};
    if (!isPrivileged) {
        let memberOfCommitteeIds = [];
        if (me) {
            const memberships = yield prisma_1.prisma.committeeMember.findMany({
                where: { employeeId: me, isActive: true, committee: { type: 'GRIEVANCE' } },
                select: { committeeId: true },
            });
            memberOfCommitteeIds = memberships.map((m) => Number(m.committeeId));
        }
        where = {
            OR: [
                { employeeId: me },
                ...(memberOfCommitteeIds.length > 0
                    ? [{ committeeId: { in: memberOfCommitteeIds } }]
                    : []),
            ],
        };
    }
    const grievances = yield prisma_1.prisma.grievance.findMany({
        where,
        include: {
            employee: true,
            comments: { include: { employee: true } },
            // Committee handling this grievance (with the active member list) so the
            // UI can show "Handled by: Grievance Committee 2026" + roster.
            committee: {
                include: {
                    members: {
                        where: { isActive: true },
                        include: {
                            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, gender: true, email: true, phone: true } },
                        },
                    },
                },
            },
        },
    });
    res.json(grievances);
}));
// --- Add comment
exports.addGrievanceComment = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const grievanceId = Number(req.params.id);
    const { comment } = req.body;
    let employeeId = Number(req.body.employeeId);
    const c = yield prisma_1.prisma.grievanceComment.create({
        data: { grievanceId, employeeId, comment }
    });
    // 🔔 Notify the grievance owner (not the commenter)
    const grievance = yield prisma_1.prisma.grievance.findUnique({ where: { id: grievanceId }, select: { employeeId: true } });
    if (grievance && grievance.employeeId !== employeeId) {
        yield (0, notifications_controller_1.createNotification)(grievance.employeeId, `A new comment has been added to your grievance.`);
    }
    res.json(c);
}));
// --- Update status
exports.updateGrievanceStatus = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const grievanceId = Number(req.params.id);
    const { status } = req.body;
    const g = yield prisma_1.prisma.grievance.update({
        where: { id: grievanceId },
        data: { status }
    });
    // 🔔 Notify the grievance owner
    yield (0, notifications_controller_1.createNotification)(g.employeeId, `Your grievance status has been updated to: ${status}.`);
    res.json(g);
}));
const createAcknowledgement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, grievanceId, poshCaseId } = req.body;
        if (!employeeId) {
            return res.status(400).json({ message: "employeeId is required" });
        }
        if (!grievanceId && !poshCaseId) {
            return res
                .status(400)
                .json({ message: "Either grievanceId or poshCaseId must be provided" });
        }
        // Prevent duplicate acknowledgment
        const existingAck = yield prisma_1.prisma.complaintAcknowledgement.findFirst({
            where: Object.assign(Object.assign({ employeeId }, (grievanceId ? { grievanceId } : {})), (poshCaseId ? { poshCaseId } : {})),
        });
        if (existingAck) {
            return res.status(409).json({ message: "Already acknowledged" });
        }
        const acknowledgement = yield prisma_1.prisma.complaintAcknowledgement.create({
            data: {
                employeeId,
                grievanceId: grievanceId || null,
                poshCaseId: poshCaseId || null,
            },
        });
        return res.status(201).json({
            message: "Acknowledgement recorded successfully",
            data: acknowledgement,
        });
    }
    catch (error) {
        console.error("Error creating acknowledgement:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});
exports.createAcknowledgement = createAcknowledgement;
/**
 * Get all acknowledgements for a specific employee
 */
const getAcknowledgementsByEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId } = req.params;
        const acknowledgements = yield prisma_1.prisma.complaintAcknowledgement.findMany({
            where: { employeeId: Number(employeeId) },
            include: {
                grievance: true,
                poshCase: true,
            },
            orderBy: { acknowledgedAt: "desc" },
        });
        res.json({ data: acknowledgements });
    }
    catch (error) {
        console.error("Error fetching acknowledgements:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});
exports.getAcknowledgementsByEmployee = getAcknowledgementsByEmployee;
/**
 * Check if an employee has already acknowledged a specific complaint
 */
const checkAcknowledgement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, grievanceId, poshCaseId } = req.query;
        if (!employeeId) {
            return res.status(400).json({ message: "employeeId is required" });
        }
        const ack = yield prisma_1.prisma.complaintAcknowledgement.findFirst({
            where: Object.assign(Object.assign({ employeeId: Number(employeeId) }, (grievanceId ? { grievanceId: Number(grievanceId) } : {})), (poshCaseId ? { poshCaseId: Number(poshCaseId) } : {})),
        });
        res.json({ acknowledged: !!ack });
    }
    catch (error) {
        console.error("Error checking acknowledgement:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});
exports.checkAcknowledgement = checkAcknowledgement;
const getUnacknowledgedComplaints = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const employeeId = Number(req.params.employeeId);
        if (!employeeId)
            return res.status(400).json({ message: "employeeId required" });
        // Step 1️⃣: Check if employee belongs to HR department
        const employee = yield prisma_1.prisma.employee.findUnique({
            where: { id: employeeId },
            include: { Department: true },
        });
        if (!employee)
            return res.status(404).json({ message: "Employee not found" });
        console.log("Employee Department:", (_a = employee.Department) === null || _a === void 0 ? void 0 : _a.name);
        if (!employee.Department || employee.Department.name !== "Human Resources") {
            // Not an HR user → no need to show any complaints
            return res.json({ grievances: [], poshCases: [] });
        }
        // Step 2️⃣: Fetch already acknowledged complaint IDs
        const acknowledgements = yield prisma_1.prisma.complaintAcknowledgement.findMany({
            where: { employeeId },
            select: { grievanceId: true, poshCaseId: true },
        });
        const acknowledgedGrievanceIds = acknowledgements
            .filter(a => a.grievanceId)
            .map(a => a.grievanceId);
        const acknowledgedPoshIds = acknowledgements
            .filter(a => a.poshCaseId)
            .map(a => a.poshCaseId);
        // Step 3️⃣: Find all grievances and POSH cases not yet acknowledged
        const grievances = yield prisma_1.prisma.grievance.findMany({
            where: {
                NOT: { id: { in: acknowledgedGrievanceIds } },
            },
            include: { employee: true },
            orderBy: { createdAt: "desc" },
        });
        const poshCases = yield prisma_1.prisma.poshCase.findMany({
            where: {
                NOT: { id: { in: acknowledgedPoshIds } },
            },
            include: {
                complainant: true,
                accused: true,
            },
            orderBy: { createdAt: "desc" },
        });
        return res.json({ grievances, poshCases });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
});
exports.getUnacknowledgedComplaints = getUnacknowledgedComplaints;
/**
 * GET /api/grievance/:id/committee-acks — committee acknowledgement progress.
 * Returns: { committee, members:[{ member, acknowledged, acknowledgedAt }],
 *           acknowledgedCount, totalMembers, allAcknowledged }
 * Used by the case-detail UI to show "3 of 5 members have acknowledged" + the
 * roster with a per-row checkmark. Only INTERNAL members (linked to an
 * Employee) are tracked — externals acknowledge out-of-band today.
 */
const getGrievanceCommitteeAcks = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    return getCaseCommitteeAcks(res, { grievanceId: Number(req.params.id) });
});
exports.getGrievanceCommitteeAcks = getGrievanceCommitteeAcks;
const getPoshCommitteeAcks = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    return getCaseCommitteeAcks(res, { poshCaseId: Number(req.params.id) });
});
exports.getPoshCommitteeAcks = getPoshCommitteeAcks;
function getCaseCommitteeAcks(res, caseRef) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            // Resolve the case → its committee
            let committeeId = null;
            if (caseRef.grievanceId) {
                const g = yield prisma_1.prisma.grievance.findUnique({ where: { id: caseRef.grievanceId }, select: { committeeId: true } });
                if (!g)
                    return res.status(404).json({ error: "Grievance not found" });
                committeeId = g.committeeId;
            }
            else if (caseRef.poshCaseId) {
                const p = yield prisma_1.prisma.poshCase.findUnique({ where: { id: caseRef.poshCaseId }, select: { committeeId: true } });
                if (!p)
                    return res.status(404).json({ error: "POSH case not found" });
                committeeId = p.committeeId;
            }
            if (!committeeId) {
                return res.json({
                    committee: null,
                    members: [],
                    acknowledgedCount: 0,
                    totalMembers: 0,
                    allAcknowledged: false,
                });
            }
            const [committee, acks] = yield Promise.all([
                prisma_1.prisma.committee.findUnique({
                    where: { id: committeeId },
                    include: {
                        members: {
                            where: { isActive: true },
                            include: {
                                employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, gender: true } },
                            },
                        },
                    },
                }),
                prisma_1.prisma.complaintAcknowledgement.findMany({
                    where: Object.assign(Object.assign({}, (caseRef.grievanceId ? { grievanceId: caseRef.grievanceId } : {})), (caseRef.poshCaseId ? { poshCaseId: caseRef.poshCaseId } : {})),
                    select: { employeeId: true, acknowledgedAt: true },
                }),
            ]);
            const ackMap = new Map();
            for (const a of acks)
                ackMap.set(a.employeeId, a.acknowledgedAt);
            // We track ack status only for internal members (externals don't have
            // employee accounts to record acks against).
            const internal = ((_a = committee === null || committee === void 0 ? void 0 : committee.members) !== null && _a !== void 0 ? _a : []).filter((m) => m.employeeId);
            const memberStatuses = internal.map((m) => {
                var _a, _b, _c, _d, _e;
                return ({
                    memberId: m.id,
                    employeeId: m.employeeId,
                    role: m.role,
                    name: m.employee ? `${m.employee.firstName} ${m.employee.lastName}` : null,
                    employeeCode: (_b = (_a = m.employee) === null || _a === void 0 ? void 0 : _a.employeeCode) !== null && _b !== void 0 ? _b : null,
                    gender: (_d = (_c = m.employee) === null || _c === void 0 ? void 0 : _c.gender) !== null && _d !== void 0 ? _d : null,
                    acknowledged: ackMap.has(m.employeeId),
                    acknowledgedAt: (_e = ackMap.get(m.employeeId)) !== null && _e !== void 0 ? _e : null,
                });
            });
            const acknowledgedCount = memberStatuses.filter((x) => x.acknowledged).length;
            return res.json({
                committee: committee ? {
                    id: committee.id, name: committee.name, type: committee.type,
                    termStart: committee.termStart, termEnd: committee.termEnd,
                } : null,
                members: memberStatuses,
                externalMemberCount: ((_b = committee === null || committee === void 0 ? void 0 : committee.members) !== null && _b !== void 0 ? _b : []).filter((m) => !m.employeeId).length,
                acknowledgedCount,
                totalMembers: memberStatuses.length,
                allAcknowledged: memberStatuses.length > 0 && acknowledgedCount === memberStatuses.length,
            });
        }
        catch (err) {
            console.error("getCaseCommitteeAcks error:", err);
            return res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed" });
        }
    });
}
