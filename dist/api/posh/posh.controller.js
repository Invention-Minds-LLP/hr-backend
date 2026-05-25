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
exports.getHearingAttendees = exports.setHearingAttendees = exports.getHearings = exports.updatePoshStatus = exports.addHearing = exports.listPoshCases = exports.createPoshCase = void 0;
const express_async_handler_1 = __importDefault(require("express-async-handler"));
// import { PrismaClient, PermissionStatus } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
const committee_controller_1 = require("../committee/committee.controller");
// --- File POSH case
exports.createPoshCase = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { accusedId, description } = req.body;
    let complainantId = req.body.complainantId;
    complainantId = Number(complainantId);
    // Bind the case to the active ICC (Internal Complaints Committee) if one is
    // configured. If not, we still create the case but fall back to the legacy
    // "notify all HR" path so the existing flow keeps working.
    const committee = yield (0, committee_controller_1.findActiveCommittee)('POSH');
    const posh = yield prisma_1.prisma.poshCase.create({
        data: { complainantId, accusedId, description, committeeId: (_a = committee === null || committee === void 0 ? void 0 : committee.id) !== null && _a !== void 0 ? _a : null }
    });
    // 🔔 Notify ICC members if a committee exists; otherwise fall back to HR dept.
    let recipients = [];
    if (committee) {
        recipients = yield (0, committee_controller_1.getCommitteeMemberEmpIds)(committee.id);
    }
    if (recipients.length === 0) {
        const hrEmployees = yield prisma_1.prisma.employee.findMany({
            where: { departmentId: 1 },
            select: { id: true },
        });
        recipients = hrEmployees.map((h) => h.id);
    }
    for (const rid of recipients) {
        yield (0, notifications_controller_1.createNotification)(rid, 'New POSH case filed — requires acknowledgment.');
    }
    res.json(posh);
}));
// --- List POSH cases
exports.listPoshCases = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    // Strict view gating per POSH Act confidentiality:
    //   Only the assigned ICC members + the complainant + the accused can read.
    //   Even other HR-dept employees are NOT allowed — only members of the ICC
    //   that handles each case. ADMIN role is the one exception for emergencies.
    const me = Number((_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId);
    const userRole = String((_e = (_d = req.user) === null || _d === void 0 ? void 0 : _d.role) !== null && _e !== void 0 ? _e : '').toUpperCase();
    const isAdmin = userRole === 'ADMIN';
    // Find every committee this user is currently an active member of.
    let memberOfCommitteeIds = [];
    if (me && !isAdmin) {
        const memberships = yield prisma_1.prisma.committeeMember.findMany({
            where: { employeeId: me, isActive: true, committee: { type: 'POSH' } },
            select: { committeeId: true },
        });
        memberOfCommitteeIds = memberships.map((m) => Number(m.committeeId));
    }
    const where = isAdmin ? {} : {
        OR: [
            { complainantId: me },
            { accusedId: me },
            ...(memberOfCommitteeIds.length > 0
                ? [{ committeeId: { in: memberOfCommitteeIds } }]
                : []),
        ],
    };
    const cases = yield prisma_1.prisma.poshCase.findMany({
        where,
        include: {
            complainant: true,
            accused: true,
            hearings: true,
            // ICC handling this case (active members only) for the "Handled by" display.
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
    res.json(cases);
}));
// --- Add hearing
exports.addHearing = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const poshId = Number(req.params.id);
    const { date, notes, outcome } = req.body;
    const hearing = yield prisma_1.prisma.poshHearing.create({
        data: { poshId, date, notes, outcome }
    });
    // 🔔 Notify complainant and accused
    const posh = yield prisma_1.prisma.poshCase.findUnique({ where: { id: poshId }, select: { complainantId: true, accusedId: true } });
    if (posh) {
        const msg = `A hearing has been scheduled for your POSH case on ${new Date(date).toLocaleDateString('en-IN')}.`;
        yield (0, notifications_controller_1.createNotification)(posh.complainantId, msg);
        if (posh.accusedId)
            yield (0, notifications_controller_1.createNotification)(posh.accusedId, msg);
    }
    res.json(hearing);
}));
// --- Update status
exports.updatePoshStatus = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const poshId = Number(req.params.id);
    const { status, committeeNote } = req.body;
    const posh = yield prisma_1.prisma.poshCase.update({
        where: { id: poshId },
        data: { status, committeeNote }
    });
    // 🔔 Notify complainant and accused of status update
    const msg = `Your POSH case status has been updated to: ${status}.`;
    yield (0, notifications_controller_1.createNotification)(posh.complainantId, msg);
    if (posh.accusedId)
        yield (0, notifications_controller_1.createNotification)(posh.accusedId, msg);
    res.json(posh);
}));
// --- Get hearings by Case ID (with attendees so the UI can show quorum)
exports.getHearings = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const poshId = Number(req.params.id);
    const hearings = yield prisma_1.prisma.poshHearing.findMany({
        where: { poshId },
        orderBy: { date: 'asc' },
        include: {
            attendees: {
                include: {
                    member: {
                        include: {
                            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, gender: true } },
                        },
                    },
                },
            },
        },
    });
    res.json(hearings);
}));
/* ════════════════════════════════════════════════════════════════════
   POSH HEARING ATTENDEES — quorum audit trail
   Phase 3 of the committee module.

   POST /api/posh/hearings/:hearingId/attendees
     body: { attendees: [{ committeeMemberId, attended, remarks? }] }
     Upserts the full list for that hearing. Idempotent: safe to call repeatedly
     as HR updates the attendance sheet.

   GET /api/posh/hearings/:hearingId/attendees
     Returns the recorded attendees for that hearing.
   ════════════════════════════════════════════════════════════════════ */
exports.setHearingAttendees = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const hearingId = Number(req.params.hearingId);
    const { attendees } = req.body;
    if (!Array.isArray(attendees)) {
        res.status(400).json({ error: "attendees must be an array" });
        return;
    }
    // Verify the hearing exists and grab its committee link.
    const hearing = yield prisma_1.prisma.poshHearing.findUnique({
        where: { id: hearingId },
        include: { poshCase: { select: { committeeId: true } } },
    });
    if (!hearing) {
        res.status(404).json({ error: "Hearing not found" });
        return;
    }
    // Upsert each row — unique (hearingId, committeeMemberId).
    const results = [];
    for (const a of attendees) {
        if (!a.committeeMemberId)
            continue;
        const row = yield prisma_1.prisma.poshHearingAttendee.upsert({
            where: {
                hearingId_committeeMemberId: {
                    hearingId,
                    committeeMemberId: Number(a.committeeMemberId),
                },
            },
            create: {
                hearingId,
                committeeMemberId: Number(a.committeeMemberId),
                attended: !!a.attended,
                remarks: (_a = a.remarks) !== null && _a !== void 0 ? _a : null,
            },
            update: {
                attended: !!a.attended,
                remarks: (_b = a.remarks) !== null && _b !== void 0 ? _b : null,
            },
            include: {
                member: {
                    include: {
                        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
                    },
                },
            },
        });
        results.push(row);
    }
    res.json({ hearingId, attendees: results });
}));
exports.getHearingAttendees = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const hearingId = Number(req.params.hearingId);
    const rows = yield prisma_1.prisma.poshHearingAttendee.findMany({
        where: { hearingId },
        include: {
            member: {
                include: {
                    employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, gender: true } },
                },
            },
        },
    });
    res.json(rows);
}));
