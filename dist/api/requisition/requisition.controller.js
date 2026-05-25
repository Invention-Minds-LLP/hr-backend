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
exports.withdrawRequisition = exports.listRequisitions = exports.updateRequisitionStatus = exports.createRequisition = void 0;
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
const createRequisition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
    try {
        console.log("Request Body:", req.body); // Debugging line
        const { title, departmentId, location, createdBy, designation, reasonBreakdown, skills, education, training, eduSSC, eduDiploma, eduBachelor, eduMaster, eduOther, eduOtherDetail, urgent, duration, reportingTo, reasonType, // ✅ add this
        reasonDetails, eduBachelorDetail, eduMasterDetail, eduDiplomaDetail, eduSSCDetail, 
        // Approvals
        raisedBy, raisedBySign, raisedByDate, raisedByComments, approvedByHoD, hodSign, approvedByHoDDate, approvedByHoDComments, approvedBySMO, smoSign, approvedBySMODate, approvedBySMOComments, receivedByHR, hrSign, receivedByHRDate, receivedByHRComments, hrReferenceNo, salaryRange, source, actionTaken, closedOn } = req.body;
        // ── Look up the raiser's role BEFORE creating ───────────────
        // The raiser's seniority decides:
        //   1. Initial status (RAISED / HOD_APPROVED / COO_APPROVED)
        //   2. Which approval fields to auto-fill (so the workflow doesn't
        //      get stuck waiting on a self-approval that nobody will do)
        //   3. Who the next-level notification goes to (block below)
        const raiserId = Number(createdBy !== null && createdBy !== void 0 ? createdBy : raisedBy);
        const raiser = Number.isFinite(raiserId)
            ? yield prisma_1.prisma.employee.findUnique({
                where: { id: raiserId },
                select: { id: true, roleId: true, firstName: true, lastName: true },
            })
            : null;
        const raiserRoleId = (_a = raiser === null || raiser === void 0 ? void 0 : raiser.roleId) !== null && _a !== void 0 ? _a : null;
        const now = new Date();
        // Auto-approval block — only populated when the raiser is HOD (3) or
        // Management (4), in which case the steps they OUTRANK are pre-stamped
        // as approved by them. Fields not in this object fall back to whatever
        // the request body sent (so HR / a frontend that already pre-fills them
        // still wins).
        let initialStatus = 'RAISED';
        const autoApproval = {};
        // Display name derived from the looked-up Employee row — never trust the
        // request body's `raisedBy` field alone, since it can be missing or empty
        // string. Empty string isn't caught by `??` (only null/undefined are), so
        // we use a `firstNonEmpty` helper to skip blank values too.
        const raiserDisplayName = raiser ? `${raiser.firstName} ${raiser.lastName}`.trim() : null;
        const firstNonEmpty = (...vals) => {
            for (const v of vals) {
                if (v !== null && v !== undefined && String(v).trim() !== '')
                    return String(v);
            }
            return null;
        };
        const autoNote = `Auto-approved on creation (raised by ${raiserDisplayName !== null && raiserDisplayName !== void 0 ? raiserDisplayName : 'sender'} at this level)`;
        if (raiserRoleId === 3) {
            // HOD raising → skip the HOD step.
            initialStatus = 'HOD_APPROVED';
            autoApproval.approvedByHoD = firstNonEmpty(approvedByHoD, raiserDisplayName, raisedBy);
            autoApproval.hodSign = firstNonEmpty(hodSign, raisedBySign);
            autoApproval.approvedByHoDDate = approvedByHoDDate ? new Date(approvedByHoDDate) : now;
            autoApproval.approvedByHoDComments = firstNonEmpty(approvedByHoDComments, autoNote);
            autoApproval.approvedByHoDEmpId = (_b = raiser === null || raiser === void 0 ? void 0 : raiser.id) !== null && _b !== void 0 ? _b : null;
        }
        else if (raiserRoleId === 4) {
            // Management raising → skip both HOD AND COO steps.
            initialStatus = 'COO_APPROVED';
            autoApproval.approvedByHoD = firstNonEmpty(approvedByHoD, raiserDisplayName, raisedBy);
            autoApproval.hodSign = firstNonEmpty(hodSign, raisedBySign);
            autoApproval.approvedByHoDDate = approvedByHoDDate ? new Date(approvedByHoDDate) : now;
            autoApproval.approvedByHoDComments = firstNonEmpty(approvedByHoDComments, autoNote);
            autoApproval.approvedByHoDEmpId = (_c = raiser === null || raiser === void 0 ? void 0 : raiser.id) !== null && _c !== void 0 ? _c : null;
            autoApproval.approvedBySMO = firstNonEmpty(approvedBySMO, raiserDisplayName, raisedBy);
            autoApproval.smoSign = firstNonEmpty(smoSign, raisedBySign);
            autoApproval.approvedBySMODate = approvedBySMODate ? new Date(approvedBySMODate) : now;
            autoApproval.approvedBySMOComments = firstNonEmpty(approvedBySMOComments, autoNote);
            autoApproval.approvedBySMOEmpId = (_d = raiser === null || raiser === void 0 ? void 0 : raiser.id) !== null && _d !== void 0 ? _d : null;
        }
        // Step 2: Create Requisition
        const requisition = yield prisma_1.prisma.manpowerRequisition.create({
            data: {
                requestDate: new Date(),
                designation,
                departmentId,
                reasonBreakdown,
                reasonType, // ✅ add this
                reasonDetails,
                skills,
                education,
                training,
                eduSSC,
                eduDiploma,
                eduBachelor,
                eduMaster,
                eduOther,
                eduOtherDetail,
                urgent,
                duration,
                reportingTo,
                title,
                eduBachelorDetail,
                eduMasterDetail,
                eduDiplomaDetail,
                eduSSCDetail,
                raisedBy, raisedBySign, raisedByDate: raisedByDate ? new Date(raisedByDate) : null, raisedByComments,
                // Strong FK to the raising employee — see schema comment.
                raisedByEmployeeId: (_e = raiser === null || raiser === void 0 ? void 0 : raiser.id) !== null && _e !== void 0 ? _e : null,
                // HOD/COO/HR fields — sent values win, otherwise auto-filled when
                // the raiser is senior enough to skip those steps.
                approvedByHoD: (_f = autoApproval.approvedByHoD) !== null && _f !== void 0 ? _f : approvedByHoD,
                hodSign: (_g = autoApproval.hodSign) !== null && _g !== void 0 ? _g : hodSign,
                approvedByHoDDate: (_h = autoApproval.approvedByHoDDate) !== null && _h !== void 0 ? _h : (approvedByHoDDate ? new Date(approvedByHoDDate) : null),
                approvedByHoDComments: (_j = autoApproval.approvedByHoDComments) !== null && _j !== void 0 ? _j : approvedByHoDComments,
                approvedByHoDEmpId: (_k = autoApproval.approvedByHoDEmpId) !== null && _k !== void 0 ? _k : null,
                approvedBySMO: (_l = autoApproval.approvedBySMO) !== null && _l !== void 0 ? _l : approvedBySMO,
                smoSign: (_m = autoApproval.smoSign) !== null && _m !== void 0 ? _m : smoSign,
                approvedBySMODate: (_o = autoApproval.approvedBySMODate) !== null && _o !== void 0 ? _o : (approvedBySMODate ? new Date(approvedBySMODate) : null),
                approvedBySMOComments: (_p = autoApproval.approvedBySMOComments) !== null && _p !== void 0 ? _p : approvedBySMOComments,
                approvedBySMOEmpId: (_q = autoApproval.approvedBySMOEmpId) !== null && _q !== void 0 ? _q : null,
                receivedByHR, hrSign, receivedByHRDate: receivedByHRDate ? new Date(receivedByHRDate) : null, receivedByHRComments,
                hrReferenceNo,
                salaryRange,
                source,
                actionTaken,
                closedOn: closedOn ? new Date(closedOn) : null,
                // Initial status reflects the auto-approvals above
                status: initialStatus,
            },
            include: { job: true },
        });
        console.log(`[manpower] requisition #${requisition.id} created by role=${raiserRoleId !== null && raiserRoleId !== void 0 ? raiserRoleId : '?'} → status=${initialStatus}`);
        // ── Notify the NEXT approver ─────────────────────────────────
        // Approval ladder (low → high):
        //   Incharge (role 5) → HOD (role 3) → Management/COO (role 4) → HR (role 1)
        // Reuse the `raiser` lookup performed above. Decision matrix matches
        // the auto-approval block — whichever steps were pre-stamped, the
        // notification jumps to the FIRST step that still needs human action.
        try {
            const reqLabel = title || designation || 'a position';
            const raiserName = raiser ? `${raiser.firstName} ${raiser.lastName}`.trim() : 'an employee';
            let nextLevelEmployees = [];
            if (raiserRoleId === 3) {
                // HOD raised → HOD step auto-approved → next is Management.
                nextLevelEmployees = yield prisma_1.prisma.employee.findMany({
                    where: { roleId: 4, employmentStatus: 'ACTIVE' },
                    select: { id: true },
                });
            }
            else if (raiserRoleId === 4) {
                // Management raised → HOD + COO auto-approved → next is HR.
                nextLevelEmployees = yield prisma_1.prisma.employee.findMany({
                    where: { roleId: 1, employmentStatus: 'ACTIVE' },
                    select: { id: true },
                });
            }
            else {
                // Default — Incharge or any other role: ping the department's HOD.
                const deptHod = yield prisma_1.prisma.employee.findFirst({
                    where: {
                        departmentId: departmentId,
                        roleId: 3,
                        employmentStatus: 'ACTIVE',
                    },
                    select: { id: true },
                });
                if (deptHod)
                    nextLevelEmployees = [deptHod];
            }
            // De-dup — never notify the raiser themselves.
            const targets = nextLevelEmployees.filter((e) => e.id !== (raiser === null || raiser === void 0 ? void 0 : raiser.id));
            const message = `New manpower requisition raised by ${raiserName} for ${reqLabel}. Kindly review and take appropriate action.`;
            for (const t of targets) {
                yield (0, notifications_controller_1.createNotification)(t.id, message);
            }
            console.log(`[manpower] requisition #${requisition.id} → notified ${targets.length} next-level approver(s)`);
        }
        catch (notifyErr) {
            // Notification failures must NEVER block requisition creation.
            console.error('[manpower] notification on create failed:', notifyErr);
        }
        return res.status(201).json(requisition);
    }
    catch (error) {
        console.error("Error creating requisition:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});
exports.createRequisition = createRequisition;
function buildJobTitle(item, fallbackTitle) {
    const designation = item.designation || fallbackTitle || "Untitled";
    let expPart = "";
    // 🔹 Fresher case
    if (item.minExperience === 0 && item.maxExperience === 0) {
        expPart = " (Fresher)";
    }
    // 🔹 Range case
    else if (item.minExperience && item.maxExperience) {
        expPart = ` (${item.minExperience}-${item.maxExperience} yrs)`;
    }
    // 🔹 Only minimum provided
    else if (item.minExperience) {
        expPart = ` (${item.minExperience}+ yrs)`;
    }
    const typeMap = {
        NEW_OPENING: "New Opening",
        REPLACEMENT: "Replacement",
        PLANNED_ADDITION: "Planned Addition"
    };
    const typeLabel = typeMap[item.type] || item.type || "";
    return `${designation}${expPart}${typeLabel ? " – " + typeLabel : ""}`;
}
const updateRequisitionStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { id } = req.params;
        const { step, approverName, signature, comments, reject, createdBy, location, title, 
        // approverEmpId is the employee ID of whoever clicked the approve button.
        // Frontend should send `auth.user.id` here. Optional for backward compat
        // (legacy clients that don't send it just skip the FK stamp).
        approverEmpId, } = req.body;
        const approverIdNum = Number(approverEmpId);
        const approverEmpIdSafe = Number.isFinite(approverIdNum) && approverIdNum > 0 ? approverIdNum : null;
        const now = new Date();
        let updateData = {};
        switch (step) {
            case "RAISED":
                updateData = Object.assign({ raisedBy: approverName, raisedBySign: signature, raisedByDate: now, raisedByComments: comments, status: "RAISED" }, (approverEmpIdSafe ? { raisedByEmployeeId: approverEmpIdSafe } : {}));
                break;
            case "HOD":
                updateData = reject
                    ? {
                        hodRejectedBy: approverName,
                        hodRejectedDate: now,
                        hodRejectedComments: comments,
                        status: "REJECTED",
                    }
                    : Object.assign({ approvedByHoD: approverName, hodSign: signature, approvedByHoDDate: now, approvedByHoDComments: comments, status: "HOD_APPROVED" }, (approverEmpIdSafe ? { approvedByHoDEmpId: approverEmpIdSafe } : {}));
                break;
            case "COO":
                updateData = reject
                    ? {
                        smoRejectedBy: approverName,
                        smoRejectedDate: now,
                        smoRejectedComments: comments,
                        status: "REJECTED",
                    }
                    : Object.assign({ approvedBySMO: approverName, smoSign: signature, approvedBySMODate: now, approvedBySMOComments: comments, status: "COO_APPROVED" }, (approverEmpIdSafe ? { approvedBySMOEmpId: approverEmpIdSafe } : {}));
                break;
            // case "HR":
            //   if (reject) {
            //     updateData = {
            //       hrRejectedBy: approverName,
            //       hrRejectedDate: now,
            //       hrRejectedComments: comments,
            //       status: "REJECTED",
            //     };
            //   } else {
            //     const requisition = await prisma.manpowerRequisition.findUnique({ where: { id: Number(id) } });
            //     if (!requisition) return res.status(404).json({ message: "Requisition not found" });
            //     await prisma.job.create({
            //       data: {
            //         title: title || requisition.title || "Untitled",
            //         departmentId: requisition.departmentId ?? 0, // coerce null to undefined
            //         location,
            //         headcount: requisition.vacancies || 0,
            //         createdBy: 1,
            //       },
            //     });
            //     updateData = {
            //       receivedByHR: approverName,
            //       hrSign: signature,
            //       receivedByHRDate: now,
            //       receivedByHRComments: comments,
            //       status: "HR_RECEIVED",
            //     };
            //   }
            //   break;
            case "HR":
                if (reject) {
                    updateData = {
                        hrRejectedBy: approverName,
                        hrRejectedDate: now,
                        hrRejectedComments: comments,
                        status: "REJECTED",
                    };
                }
                else {
                    const requisition = yield prisma_1.prisma.manpowerRequisition.findUnique({
                        where: { id: Number(id) },
                    });
                    if (!requisition) {
                        return res.status(404).json({ message: "Requisition not found" });
                    }
                    // ✅ Parse reasonBreakdown JSON safely
                    let breakdown = [];
                    try {
                        breakdown = requisition.reasonBreakdown
                            ? typeof requisition.reasonBreakdown === "string"
                                ? JSON.parse(requisition.reasonBreakdown)
                                : requisition.reasonBreakdown
                            : [];
                    }
                    catch (err) {
                        console.error("Invalid reasonBreakdown JSON:", err);
                        breakdown = [];
                    }
                    // ✅ If no breakdown, still create one job (fallback to old logic)
                    if (!breakdown.length) {
                        yield prisma_1.prisma.job.create({
                            data: {
                                title: title || requisition.title || "Untitled",
                                departmentId: (_a = requisition.departmentId) !== null && _a !== void 0 ? _a : 0,
                                location,
                                headcount: requisition.vacancies || 1,
                                createdBy: createdBy || 1,
                            },
                        });
                    }
                    else {
                        // ✅ Create multiple jobs from breakdown
                        for (const item of breakdown) {
                            const jobTitle = buildJobTitle(item, (_b = requisition.title) !== null && _b !== void 0 ? _b : undefined);
                            yield prisma_1.prisma.job.create({
                                data: {
                                    title: jobTitle,
                                    departmentId: (_c = requisition.departmentId) !== null && _c !== void 0 ? _c : 0,
                                    location: location || "Not Specified",
                                    headcount: item.count || 1,
                                    createdBy: createdBy || 1,
                                    backfillForEmployeeId: null, // optional if you have that field
                                },
                            });
                        }
                    }
                    // ✅ Update requisition status
                    updateData = Object.assign({ receivedByHR: approverName, hrSign: signature, receivedByHRDate: now, receivedByHRComments: comments, status: "HR_RECEIVED" }, (approverEmpIdSafe ? { receivedByHREmpId: approverEmpIdSafe } : {}));
                }
                break;
            case "HR_USE_ONLY": // 👈 new step for final closure
                updateData = {
                    hrReferenceNo: req.body.hrReferenceNo,
                    salaryRange: req.body.salaryRange,
                    source: req.body.source,
                    actionTaken: req.body.actionTaken,
                    closedOn: req.body.closedOn ? new Date(req.body.closedOn) : now, // 👈 Closed On set here
                };
                break;
            default:
                return res.status(400).json({ message: "Invalid approval step" });
        }
        const updated = yield prisma_1.prisma.manpowerRequisition.update({
            where: { id: Number(id) },
            data: updateData,
        });
        // ----------------- NOTIFICATIONS -----------------
        try {
            // fetch requisition creator if not passed
            const requisition = yield prisma_1.prisma.manpowerRequisition.findUnique({
                where: { id: Number(id) },
                select: {
                    departmentId: true,
                    raisedBy: true
                }
            });
            // HOD approved → notify COO
            if (step === "HOD" && !reject) {
                const coo = yield prisma_1.prisma.employee.findFirst({
                    where: { role: { id: 4 } },
                    select: { id: true }
                });
                if (coo) {
                    yield (0, notifications_controller_1.createNotification)(coo.id, "A manpower requisition has been approved by HOD and needs your approval.");
                }
            }
            // COO approved → notify HR
            if (step === "COO" && !reject) {
                const hrs = yield prisma_1.prisma.employee.findMany({
                    where: { role: { id: 1 } },
                    select: { id: true }
                });
                for (const hr of hrs) {
                    yield (0, notifications_controller_1.createNotification)(hr.id, "A manpower requisition has been approved by COO and is ready for HR processing.");
                }
            }
            // Rejected at any step → notify creator
            if (reject && createdBy) {
                yield (0, notifications_controller_1.createNotification)(Number(createdBy), "Your manpower requisition has been rejected.");
            }
            // HR processed → notify creator
            if (step === "HR" && !reject && createdBy) {
                yield (0, notifications_controller_1.createNotification)(Number(createdBy), "Your manpower requisition has been processed by HR and a job opening has been created.");
            }
        }
        catch (notifyErr) {
            console.error("Notification error:", notifyErr);
        }
        return res.status(200).json(updated);
    }
    catch (error) {
        console.error("Error updating requisition:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});
exports.updateRequisitionStatus = updateRequisitionStatus;
const listRequisitions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const roleId = Number(req.query.roleId);
        const empId = Number(req.query.empId);
        let whereCondition = {};
        // Role 5 → Incharge → only their own requisitions
        // Filter on the strong FK column. Old rows that haven't been backfilled
        // yet fall back to a name match — the backfill script (prisma/
        // backfillRequisitionRaisers.ts) populates the FK retroactively.
        if (roleId === 5) {
            const me = yield prisma_1.prisma.employee.findUnique({
                where: { id: empId },
                select: { firstName: true, lastName: true },
            });
            const myName = me ? `${me.firstName} ${me.lastName}`.trim() : '';
            whereCondition = {
                OR: [
                    { raisedByEmployeeId: empId },
                    // Fallback for legacy rows where raisedByEmployeeId is still null.
                    ...(myName ? [{ AND: [{ raisedByEmployeeId: null }, { raisedBy: myName }] }] : []),
                ],
            };
        }
        // Role 3 → HOD / Reporting Manager → department requisitions
        if (roleId === 3) {
            const manager = yield prisma_1.prisma.employee.findUnique({
                where: { id: empId },
                select: { departmentId: true }
            });
            if (manager === null || manager === void 0 ? void 0 : manager.departmentId) {
                whereCondition = {
                    departmentId: manager.departmentId
                };
            }
        }
        // HR / Management → no filter (see all)
        if (roleId === 1 || roleId === 4) {
            whereCondition = {};
        }
        // const requisitions = await prisma.manpowerRequisition.findMany({
        //   where: whereCondition,
        //   include: { job: true },
        //   orderBy: { requestDate: "desc" }
        // });
        const requisitions = yield prisma_1.prisma.manpowerRequisition.findMany({
            where: whereCondition,
            include: { job: true },
            orderBy: { requestDate: 'desc' }
        });
        // get all unique departmentIds
        const deptIds = [...new Set(requisitions
                .map(r => r.departmentId)
                .filter((id) => id !== null) // type guard: only numbers
            )];
        // fetch departments
        const departments = yield prisma_1.prisma.department.findMany({
            where: { id: { in: deptIds } },
            select: { id: true, name: true },
        });
        // map deptId → deptName
        const deptMap = Object.fromEntries(departments.map(d => [d.id, d.name]));
        // attach dept name to requisitions
        const withDept = requisitions.map(r => (Object.assign(Object.assign({}, r), { departmentName: deptMap[r.departmentId] || null })));
        return res.status(200).json(withDept);
    }
    catch (error) {
        console.error("Error fetching requisitions:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});
exports.listRequisitions = listRequisitions;
/* ════════════════════════════════════════════════════════════════════
   WITHDRAW — raiser pulls back their own requisition.
   ────────────────────────────────────────────────────────────────────
   Distinct from REJECTED (an approver said no). Withdrawn means "the
   raiser changed their mind / no longer needs the role." Critical for
   accurate HR analytics — a withdrawn req should NOT be counted against
   HOD/SMO rejection rates.

   Permission rules:
     • Raiser themselves                 → status must be RAISED
     • HOD / Mgmt who auto-approved      → status can be HOD_APPROVED
       (their own auto-approval, before SMO/HR has acted)
     • HR / Admin (force-withdraw)       → any status before COO_APPROVED
                                            (used to clean up orphans)

   After COO_APPROVED or RECEIVED_BY_HR, withdraw is no longer allowed
   — only an approver can REJECT from there.
   ════════════════════════════════════════════════════════════════════ */
const withdrawRequisition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const id = Number(req.params.id);
        const me = Number((_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId);
        const { reason } = req.body || {};
        if (!me)
            return res.status(401).json({ message: "Authentication required" });
        if (!id)
            return res.status(400).json({ message: "Invalid id" });
        const existing = yield prisma_1.prisma.manpowerRequisition.findUnique({
            where: { id },
            select: {
                id: true, status: true,
                raisedByEmployeeId: true, raisedBy: true,
                title: true, designation: true,
                departmentId: true,
            },
        });
        if (!existing)
            return res.status(404).json({ message: "Requisition not found" });
        // Already terminal — nothing to do
        const TERMINAL = ['REJECTED', 'WITHDRAWN'];
        if (TERMINAL.includes(existing.status)) {
            return res.status(400).json({ message: `Already ${existing.status}` });
        }
        // After COO has approved, raiser can no longer pull back
        const NON_WITHDRAWABLE = ['COO_APPROVED', 'RECEIVED_BY_HR', 'CLOSED'];
        if (NON_WITHDRAWABLE.includes(existing.status)) {
            return res.status(400).json({
                message: `Cannot withdraw at status "${existing.status}" — request the appropriate approver to reject if it should not proceed.`,
            });
        }
        // ── Permission check ────────────────────────────────────────────
        const role = String((_e = (_d = req.user) === null || _d === void 0 ? void 0 : _d.role) !== null && _e !== void 0 ? _e : '').toUpperCase();
        const roleId = Number((_f = req.user) === null || _f === void 0 ? void 0 : _f.roleId);
        const isHR = ['HR', 'HR_MANAGER', 'ADMIN'].includes(role) || roleId === 1;
        const isMgmt = ['MANAGEMENT', 'ADMIN'].includes(role) || roleId === 4;
        const isOwner = existing.raisedByEmployeeId === me;
        let allowed = false;
        if (isHR || isMgmt) {
            allowed = true; // HR / Mgmt force-withdraw
        }
        else if (isOwner) {
            // Raiser can withdraw at RAISED, or at HOD_APPROVED if it's their own
            // auto-approval (HODs/managers who raised about themselves).
            if (existing.status === 'RAISED')
                allowed = true;
            if (existing.status === 'HOD_APPROVED' && roleId === 3)
                allowed = true;
            if (existing.status === 'HOD_APPROVED' && roleId === 4)
                allowed = true;
        }
        if (!allowed) {
            return res.status(403).json({
                message: "You don't have permission to withdraw this requisition.",
            });
        }
        // ── Fetch the raiser's display name (for stamping) ──────────────
        let withdrawerName = null;
        try {
            const me_emp = yield prisma_1.prisma.employee.findUnique({
                where: { id: me },
                select: { firstName: true, lastName: true },
            });
            if (me_emp)
                withdrawerName = `${me_emp.firstName} ${me_emp.lastName}`.trim();
        }
        catch ( /* non-fatal */_h) { /* non-fatal */ }
        // ── Apply ───────────────────────────────────────────────────────
        const updated = yield prisma_1.prisma.manpowerRequisition.update({
            where: { id },
            data: {
                status: 'WITHDRAWN',
                withdrawnBy: withdrawerName !== null && withdrawerName !== void 0 ? withdrawerName : `Employee #${me}`,
                withdrawnByEmpId: me,
                withdrawnDate: new Date(),
                withdrawnReason: (reason === null || reason === void 0 ? void 0 : reason.trim()) || null,
            },
        });
        // ── Notifications ──────────────────────────────────────────────
        // Tell whoever currently has the request in their queue so they can clear it.
        try {
            const subject = existing.title || existing.designation || `requisition #${id}`;
            const note = (reason === null || reason === void 0 ? void 0 : reason.trim()) ? ` (Reason: ${reason.trim()})` : '';
            // Who would have seen it next?
            let toNotify = [];
            if (existing.status === 'RAISED' || existing.status === 'HOD_APPROVED') {
                // Was sitting with HOD or SMO. Notify all HODs of that dept + SMO + HR.
                const next = yield prisma_1.prisma.employee.findMany({
                    where: {
                        employmentStatus: 'ACTIVE',
                        OR: [
                            { roleId: 3, departmentId: (_g = existing.departmentId) !== null && _g !== void 0 ? _g : undefined }, // HODs
                            { roleId: 4 }, // SMO/Mgmt
                            { roleId: 1 }, // HR
                        ],
                    },
                    select: { id: true },
                });
                toNotify = next.map((e) => e.id);
            }
            // Always notify the raiser too, if it wasn't them
            if (existing.raisedByEmployeeId && existing.raisedByEmployeeId !== me) {
                toNotify.push(existing.raisedByEmployeeId);
            }
            const seen = new Set();
            for (const empId of toNotify) {
                if (seen.has(empId) || empId === me)
                    continue;
                seen.add(empId);
                yield (0, notifications_controller_1.createNotification)(empId, `🔻 The manpower requisition for "${subject}" was withdrawn by ${withdrawerName !== null && withdrawerName !== void 0 ? withdrawerName : 'the raiser'}${note}.`);
            }
        }
        catch (notifyErr) {
            console.error("[requisition withdraw notify] failed:", notifyErr);
        }
        return res.status(200).json({ message: "Requisition withdrawn", data: updated });
    }
    catch (err) {
        console.error("withdrawRequisition error:", err);
        return res.status(500).json({ message: (err === null || err === void 0 ? void 0 : err.message) || "Failed to withdraw" });
    }
});
exports.withdrawRequisition = withdrawRequisition;
