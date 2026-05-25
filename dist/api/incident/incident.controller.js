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
exports.getLinkedIncidents = exports.trackPublicIncident = exports.submitPublicIncident = exports.listPublicCategories = exports.getIncidentDashboard = exports.unlinkIncident = exports.linkIncident = exports.getRCA = exports.upsertRCA = exports.deleteCAPA = exports.updateCAPA = exports.createCAPA = exports.listCAPA = exports.listAllIncidents = exports.listIncidentsByEmployee = exports.listIncidentsByReporter = exports.addMyComment = exports.getMyIncident = exports.listMyIncidents = exports.deleteAttachment = exports.addAttachment = exports.addWitness = exports.addComment = exports.updateIncident = exports.getIncident = exports.listIncidents = exports.createIncident = exports.upsertCategory = exports.listCategories = void 0;
exports.runIncidentDailyTasks = runIncidentDailyTasks;
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
const crypto_1 = __importDefault(require("crypto"));
/**
 * Incident Management Controller
 * ──────────────────────────────
 * Industry-neutral. Workflow + outcome are tracked separately:
 *   status   = where in the lifecycle (OPEN → INVESTIGATING → CLOSED)
 *   outcome  = what the investigation concluded (SUBSTANTIATED / FALSE / etc.)
 *
 * All write operations append to IncidentAuditLog so HR/legal can replay
 * the full history of any case.
 */
const SEVERITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STATUS_VALUES = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REJECTED', 'DUPLICATE', 'WITHDRAWN'];
const OUTCOME_VALUES = ['SUBSTANTIATED', 'PARTIALLY_SUBSTANTIATED', 'UNSUBSTANTIATED', 'FALSE_REPORT', 'WITHDRAWN', 'DUPLICATE', 'NOT_A_VIOLATION'];
// Status transitions allowed — keeps the workflow honest. Anyone trying to
// jump from CLOSED back to OPEN or skip steps is rejected here, not in the DB.
const ALLOWED_TRANSITIONS = {
    OPEN: ['ACKNOWLEDGED', 'INVESTIGATING', 'REJECTED', 'DUPLICATE', 'WITHDRAWN'],
    ACKNOWLEDGED: ['INVESTIGATING', 'REJECTED', 'DUPLICATE', 'WITHDRAWN'],
    INVESTIGATING: ['ESCALATED', 'RESOLVED', 'REJECTED', 'DUPLICATE', 'WITHDRAWN'],
    ESCALATED: ['INVESTIGATING', 'RESOLVED', 'REJECTED', 'DUPLICATE', 'WITHDRAWN'],
    RESOLVED: ['CLOSED', 'INVESTIGATING'], // can re-open if new info surfaces
    CLOSED: [], // terminal
    REJECTED: [],
    DUPLICATE: [],
    WITHDRAWN: [],
};
/* ════════════════════════════════════════════════════════════════════
   Role helpers — used by createIncident / listIncidents to enforce that
   plain Managers can only act on their direct reports.
   ════════════════════════════════════════════════════════════════════ */
/** True if the requester is HR / HR Manager / Admin / Management — i.e.
 *  unrestricted by the manager-team scope. */
function isPrivilegedRole(user) {
    var _a;
    const role = String((_a = user === null || user === void 0 ? void 0 : user.role) !== null && _a !== void 0 ? _a : '').toUpperCase();
    const roleId = Number(user === null || user === void 0 ? void 0 : user.roleId);
    return ['HR', 'HR_MANAGER', 'ADMIN', 'MANAGEMENT'].includes(role)
        || roleId === 1 // HR
        || roleId === 4; // Management
}
/** Returns the set of employee ids that report (directly) to the given manager,
 *  including the manager themselves. Empty array if the manager has no team. */
function getManagerTeam(managerEmpId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!managerEmpId)
            return [];
        const reports = yield prisma_1.prisma.employee.findMany({
            where: { reportingManager: managerEmpId },
            select: { id: true },
        });
        return [managerEmpId, ...reports.map((r) => r.id)];
    });
}
function logAudit(tx, incidentId, action, opts = {}) {
    var _a, _b, _c, _d;
    return tx.incidentAuditLog.create({
        data: {
            incidentId,
            action,
            fromValue: (_a = opts.fromValue) !== null && _a !== void 0 ? _a : null,
            toValue: (_b = opts.toValue) !== null && _b !== void 0 ? _b : null,
            note: (_c = opts.note) !== null && _c !== void 0 ? _c : null,
            performedBy: (_d = opts.performedBy) !== null && _d !== void 0 ? _d : null,
        },
    }).catch((err) => {
        // Audit failures must NEVER break business flow.
        console.error(`[incident audit] failed action=${action} on incident ${incidentId}:`, err);
    });
}
/* ════════════════════════════════════════════════════════════════════
   CATEGORIES — admin-tunable list
   ════════════════════════════════════════════════════════════════════ */
const listCategories = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        // Admin pages pass ?includeInactive=true to see archived categories too.
        const includeInactive = String((_b = (_a = req.query) === null || _a === void 0 ? void 0 : _a.includeInactive) !== null && _b !== void 0 ? _b : '').toLowerCase() === 'true';
        const cats = yield prisma_1.prisma.incidentCategory.findMany({
            where: includeInactive ? {} : { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });
        res.json(cats);
    }
    catch (err) {
        console.error("Error listing categories:", err);
        res.status(500).json({ error: "Failed to list categories" });
    }
});
exports.listCategories = listCategories;
const upsertCategory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, name, description, defaultSeverity, defaultSlaHours, defaultAssigneeRoleId, isAnonymousAllowed, requiresRCAByDefault, requiresExternalReportByDefault, isActive, sortOrder } = req.body || {};
        if (!name)
            return res.status(400).json({ error: "name is required" });
        const data = {
            name, description: description !== null && description !== void 0 ? description : null,
            defaultSeverity: defaultSeverity !== null && defaultSeverity !== void 0 ? defaultSeverity : null,
            defaultSlaHours: defaultSlaHours !== null && defaultSlaHours !== void 0 ? defaultSlaHours : null,
            defaultAssigneeRoleId: defaultAssigneeRoleId !== null && defaultAssigneeRoleId !== void 0 ? defaultAssigneeRoleId : null,
            isAnonymousAllowed: isAnonymousAllowed !== null && isAnonymousAllowed !== void 0 ? isAnonymousAllowed : true,
            requiresRCAByDefault: requiresRCAByDefault !== null && requiresRCAByDefault !== void 0 ? requiresRCAByDefault : false,
            requiresExternalReportByDefault: requiresExternalReportByDefault !== null && requiresExternalReportByDefault !== void 0 ? requiresExternalReportByDefault : false,
            isActive: isActive !== null && isActive !== void 0 ? isActive : true,
            sortOrder: sortOrder !== null && sortOrder !== void 0 ? sortOrder : 0,
        };
        const cat = id
            ? yield prisma_1.prisma.incidentCategory.update({ where: { id: Number(id) }, data })
            : yield prisma_1.prisma.incidentCategory.create({ data });
        res.json(cat);
    }
    catch (err) {
        console.error("Error upserting category:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to save category" });
    }
});
exports.upsertCategory = upsertCategory;
/* ════════════════════════════════════════════════════════════════════
   INCIDENT — CREATE
   ════════════════════════════════════════════════════════════════════ */
const createIncident = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const { employeeId, title, description, categoryId, subcategory, severity, location, departmentId, incidentDate, isAnonymous, confidentiality, attachments, // [{ fileName, fileUrl }]
        witnesses, // [{ witnessEmpId?, witnessName?, contactInfo?, statement? }]
         } = req.body || {};
        const reporterId = (_d = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId) !== null && _d !== void 0 ? _d : null;
        if (!(title === null || title === void 0 ? void 0 : title.trim()) || !(description === null || description === void 0 ? void 0 : description.trim()) || !categoryId) {
            return res.status(400).json({ error: "title, description and categoryId are required" });
        }
        // ── Manager-team scope on raise ─────────────────────────────────
        // HR / HR Manager / Admin / Management can raise about anyone.
        // Everyone else can raise only:
        //   • about themselves, OR
        //   • about an employee who reports to them, OR
        //   • without a named subject (general report).
        const subjectId = employeeId ? Number(employeeId) : null;
        if (subjectId && reporterId && !isPrivilegedRole(req.user)) {
            const team = yield getManagerTeam(reporterId);
            if (!team.includes(subjectId)) {
                return res.status(403).json({
                    error: "You can only raise incidents about yourself or your direct reports.",
                });
            }
        }
        // Validate category + enforce its anonymous policy
        const category = yield prisma_1.prisma.incidentCategory.findUnique({
            where: { id: Number(categoryId) },
        });
        if (!category)
            return res.status(400).json({ error: "Invalid categoryId" });
        if (!category.isActive)
            return res.status(400).json({ error: "Category is not active" });
        if (isAnonymous && !category.isAnonymousAllowed) {
            return res.status(400).json({ error: `Anonymous reporting is not allowed for "${category.name}"` });
        }
        const sev = SEVERITY_VALUES.includes(severity) ? severity
            : ((_e = category.defaultSeverity) !== null && _e !== void 0 ? _e : 'MEDIUM');
        // Auto-compute due date from category SLA
        const slaHours = Number(category.defaultSlaHours) || 72;
        const reportedAt = new Date();
        const dueDate = new Date(reportedAt.getTime() + slaHours * 3600 * 1000);
        // Auto-assign by role if category has a default assignee role
        let autoAssigneeId = null;
        if (category.defaultAssigneeRoleId) {
            const assignee = yield prisma_1.prisma.employee.findFirst({
                where: { roleId: category.defaultAssigneeRoleId, employmentStatus: 'ACTIVE' },
                select: { id: true },
                orderBy: { id: 'asc' },
            });
            autoAssigneeId = (_f = assignee === null || assignee === void 0 ? void 0 : assignee.id) !== null && _f !== void 0 ? _f : null;
        }
        const incident = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const created = yield tx.incident.create({
                data: {
                    title: title.trim(),
                    description: description.trim(),
                    categoryId: Number(categoryId),
                    subcategory: subcategory !== null && subcategory !== void 0 ? subcategory : null,
                    severity: sev,
                    status: 'OPEN',
                    isAnonymous: !!isAnonymous,
                    confidentiality: confidentiality !== null && confidentiality !== void 0 ? confidentiality : 'STANDARD',
                    requiresRCA: (_a = category.requiresRCAByDefault) !== null && _a !== void 0 ? _a : false,
                    requiresExternalReport: (_b = category.requiresExternalReportByDefault) !== null && _b !== void 0 ? _b : false,
                    incidentDate: incidentDate ? new Date(incidentDate) : reportedAt,
                    reportedAt,
                    location: location !== null && location !== void 0 ? location : null,
                    departmentId: departmentId ? Number(departmentId) : null,
                    employeeId: employeeId ? Number(employeeId) : null,
                    reportedBy: isAnonymous ? null : reporterId,
                    assignedTo: autoAssigneeId,
                    dueDate,
                    attachments: Array.isArray(attachments) && attachments.length
                        ? { create: attachments.map((a) => ({
                                fileName: a.fileName, fileUrl: a.fileUrl,
                                uploadedBy: reporterId,
                            })) }
                        : undefined,
                    witnesses: Array.isArray(witnesses) && witnesses.length
                        ? { create: witnesses.map((w) => {
                                var _a, _b, _c, _d;
                                return ({
                                    witnessEmpId: (_a = w.witnessEmpId) !== null && _a !== void 0 ? _a : null,
                                    witnessName: (_b = w.witnessName) !== null && _b !== void 0 ? _b : null,
                                    contactInfo: (_c = w.contactInfo) !== null && _c !== void 0 ? _c : null,
                                    statement: (_d = w.statement) !== null && _d !== void 0 ? _d : null,
                                });
                            }) }
                        : undefined,
                },
                include: { attachments: true, witnesses: true, category: true },
            });
            yield logAudit(tx, created.id, 'CREATED', {
                toValue: 'OPEN',
                note: `Severity=${sev}, anonymous=${!!isAnonymous}, category=${category.name}`,
                performedBy: isAnonymous ? null : reporterId,
            });
            if (autoAssigneeId) {
                yield logAudit(tx, created.id, 'AUTO_ASSIGNED', {
                    toValue: String(autoAssigneeId),
                    note: `Auto-assigned by category default role`,
                    performedBy: null,
                });
            }
            return created;
        }), { timeout: 15000, maxWait: 5000 });
        // ── Notifications (outside the transaction; failures don't roll back) ──
        try {
            // Notify the auto-assignee (if any).
            if (autoAssigneeId) {
                yield (0, notifications_controller_1.createNotification)(autoAssigneeId, `🆕 New ${sev} incident assigned to you: "${incident.title}" (${category.name}).`);
            }
            // Notify the subject (named employee). They have a right to know they
            // are involved in a case, even before HR formally reaches out. Skip
            // if the subject is also the reporter (they obviously already know).
            if (subjectId && subjectId !== reporterId) {
                yield (0, notifications_controller_1.createNotification)(subjectId, `📩 An incident involving you has been reported in the "${category.name}" category. HR will reach out — visit the Incidents portal for details.`);
            }
            // For HIGH / CRITICAL, also fan out to HR (dept 1) and any management role (4).
            if (sev === 'HIGH' || sev === 'CRITICAL') {
                const escalateTo = yield prisma_1.prisma.employee.findMany({
                    where: {
                        employmentStatus: 'ACTIVE',
                        OR: [{ departmentId: 1 }, { roleId: 4 }],
                    },
                    select: { id: true },
                });
                const seen = new Set();
                if (autoAssigneeId)
                    seen.add(autoAssigneeId);
                for (const e of escalateTo) {
                    if (seen.has(e.id))
                        continue;
                    seen.add(e.id);
                    yield (0, notifications_controller_1.createNotification)(e.id, `⚠️ ${sev} incident reported: "${incident.title}" (${category.name}). Review in HR portal.`);
                }
            }
        }
        catch (notifyErr) {
            console.error("[incident notify] failed:", notifyErr);
        }
        res.json({ message: "Incident created", data: incident });
    }
    catch (err) {
        console.error("Error creating incident:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to create incident" });
    }
});
exports.createIncident = createIncident;
/* ════════════════════════════════════════════════════════════════════
   INCIDENT — LIST + DETAIL (with confidentiality enforcement)
   ════════════════════════════════════════════════════════════════════ */
/** Returns true if the requester is allowed to read MGMT_ONLY / HR_PRIVATE rows. */
function userCanReadConfidential(user) {
    var _a;
    const role = String((_a = user === null || user === void 0 ? void 0 : user.role) !== null && _a !== void 0 ? _a : '').toUpperCase();
    const roleId = Number(user === null || user === void 0 ? void 0 : user.roleId);
    // Treat HR_MANAGER + ADMIN + role 1 as HR-level. MANAGEMENT + role 4 as mgmt-level.
    return {
        hr: ['HR_MANAGER', 'ADMIN', 'HR'].includes(role) || roleId === 1,
        mgmt: ['MANAGEMENT', 'ADMIN'].includes(role) || roleId === 4,
    };
}
const listIncidents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const { status, severity, categoryId, assignedTo, employeeId, q, from, to, page = '1', pageSize = '25' } = req.query;
        const me = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId;
        const where = {};
        if (status)
            where.status = String(status);
        if (severity)
            where.severity = String(severity);
        if (categoryId)
            where.categoryId = Number(categoryId);
        if (assignedTo)
            where.assignedTo = Number(assignedTo);
        if (employeeId)
            where.employeeId = Number(employeeId);
        if (q) {
            where.OR = [
                { title: { contains: String(q) } },
                { description: { contains: String(q) } },
            ];
        }
        if (from || to) {
            where.incidentDate = {};
            if (from)
                where.incidentDate.gte = new Date(String(from));
            if (to)
                where.incidentDate.lte = new Date(String(to));
        }
        // ── Confidentiality + manager-team scope ─────────────────────────
        // HR / Mgmt / Admin: see everything within the confidentiality gate.
        // Plain manager: see only their team's incidents (subject ∈ team OR
        //   reporter ∈ team) plus anything they're directly involved in.
        // Other employees: see only incidents they reported, were assigned, or
        //   are the subject of.
        const { hr, mgmt } = userCanReadConfidential(req.user);
        const allowedLevels = ['STANDARD'];
        if (hr)
            allowedLevels.push('HR_PRIVATE');
        if (mgmt)
            allowedLevels.push('MGMT_ONLY', 'HR_PRIVATE');
        if (hr || mgmt) {
            // Privileged: full visibility within confidentiality
            where.OR = ((_d = where.OR) !== null && _d !== void 0 ? _d : []).concat([
                { confidentiality: { in: allowedLevels } },
                { OR: [{ reportedBy: me }, { assignedTo: me }, { employeeId: me }] },
            ]);
        }
        else {
            // Non-privileged: scope by team. Everyone has at least themselves.
            const team = me ? yield getManagerTeam(me) : [];
            const involved = [
                { reportedBy: me },
                { assignedTo: me },
                { employeeId: me },
            ];
            const teamScope = team.length > 1 // > 1 means they have direct reports
                ? [
                    { employeeId: { in: team } },
                    { reportedBy: { in: team } },
                ]
                : [];
            where.AND = [
                ...((_e = where.AND) !== null && _e !== void 0 ? _e : []),
                { confidentiality: { in: allowedLevels } },
                { OR: [...involved, ...teamScope] },
            ];
        }
        const take = Math.min(100, Number(pageSize) || 25);
        const skip = (Math.max(1, Number(page) || 1) - 1) * take;
        const [rows, total] = yield Promise.all([
            prisma_1.prisma.incident.findMany({
                where, orderBy: [{ severity: 'desc' }, { reportedAt: 'desc' }],
                take, skip,
                include: {
                    category: { select: { id: true, name: true } },
                    employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
                    reporter: { select: { id: true, firstName: true, lastName: true } },
                    _count: { select: { comments: true, attachments: true, witnesses: true } },
                },
            }),
            prisma_1.prisma.incident.count({ where }),
        ]);
        res.json({ total, rows });
    }
    catch (err) {
        console.error("Error listing incidents:", err);
        res.status(500).json({ error: "Failed to load incidents" });
    }
});
exports.listIncidents = listIncidents;
const getIncident = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const id = Number(req.params.id);
        const me = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId;
        const incident = yield prisma_1.prisma.incident.findUnique({
            where: { id },
            include: {
                category: true,
                employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, departmentId: true } },
                reporter: { select: { id: true, firstName: true, lastName: true } },
                attachments: { orderBy: { uploadedAt: 'desc' } },
                comments: { orderBy: { createdAt: 'asc' } },
                witnesses: { orderBy: { recordedAt: 'asc' } },
                auditLogs: { orderBy: { performedAt: 'desc' }, take: 100 },
            },
        });
        if (!incident)
            return res.status(404).json({ error: "Incident not found" });
        // Confidentiality enforcement
        const { hr, mgmt } = userCanReadConfidential(req.user);
        const involved = [incident.reportedBy, incident.assignedTo, incident.employeeId].includes(me);
        if (incident.confidentiality === 'MGMT_ONLY' && !mgmt && !involved) {
            return res.status(403).json({ error: "Restricted by confidentiality" });
        }
        if (incident.confidentiality === 'HR_PRIVATE' && !hr && !mgmt && !involved) {
            return res.status(403).json({ error: "Restricted by confidentiality" });
        }
        res.json(incident);
    }
    catch (err) {
        console.error("Error fetching incident:", err);
        res.status(500).json({ error: "Failed to load incident" });
    }
});
exports.getIncident = getIncident;
/* ════════════════════════════════════════════════════════════════════
   INCIDENT — UPDATE / TRANSITIONS
   ════════════════════════════════════════════════════════════════════ */
const updateIncident = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const id = Number(req.params.id);
        const me = (_d = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId) !== null && _d !== void 0 ? _d : null;
        const body = req.body || {};
        const existing = yield prisma_1.prisma.incident.findUnique({ where: { id } });
        if (!existing)
            return res.status(404).json({ error: "Incident not found" });
        const updates = {};
        const auditEntries = [];
        // Status transition (validated)
        if (body.status && body.status !== existing.status) {
            if (!STATUS_VALUES.includes(body.status)) {
                return res.status(400).json({ error: `Invalid status. Allowed: ${STATUS_VALUES.join(', ')}` });
            }
            const allowed = ALLOWED_TRANSITIONS[existing.status] || [];
            if (!allowed.includes(body.status)) {
                return res.status(400).json({
                    error: `Cannot move from ${existing.status} → ${body.status}. Allowed next: ${allowed.join(', ') || '(terminal)'}`,
                });
            }
            // CAPA-completion gate: cannot CLOSE while corrective/preventive
            // actions are still pending. CANCELLED is treated as completed
            // (the action was explicitly dropped) so it doesn't block closure.
            if (body.status === 'CLOSED') {
                const openCAPAs = yield prisma_1.prisma.incidentCAPA.count({
                    where: {
                        incidentId: id,
                        status: { notIn: ['DONE', 'CANCELLED'] },
                    },
                });
                if (openCAPAs > 0) {
                    return res.status(400).json({
                        error: `Cannot close: ${openCAPAs} corrective/preventive action${openCAPAs === 1 ? '' : 's'} still pending. Mark them DONE or CANCELLED first.`,
                    });
                }
            }
            updates.status = body.status;
            // Stamp lifecycle timestamps as we move through
            if (body.status === 'ACKNOWLEDGED' && !existing.acknowledgedAt)
                updates.acknowledgedAt = new Date();
            if (body.status === 'RESOLVED' && !existing.resolvedAt)
                updates.resolvedAt = new Date();
            if (body.status === 'CLOSED' && !existing.closedAt)
                updates.closedAt = new Date();
            auditEntries.push({ action: 'STATUS_CHANGED', from: existing.status, to: body.status });
        }
        // Outcome (the verdict)
        if (body.outcome !== undefined && body.outcome !== existing.outcome) {
            if (body.outcome !== null && !OUTCOME_VALUES.includes(body.outcome)) {
                return res.status(400).json({ error: `Invalid outcome. Allowed: ${OUTCOME_VALUES.join(', ')}` });
            }
            updates.outcome = body.outcome;
            updates.outcomeRecordedAt = body.outcome ? new Date() : null;
            updates.outcomeRecordedBy = body.outcome ? me : null;
            auditEntries.push({ action: 'OUTCOME_RECORDED', from: existing.outcome, to: body.outcome });
        }
        // Assignment
        if (body.assignedTo !== undefined && Number(body.assignedTo) !== existing.assignedTo) {
            updates.assignedTo = body.assignedTo ? Number(body.assignedTo) : null;
            auditEntries.push({
                action: 'ASSIGNED',
                from: existing.assignedTo, to: updates.assignedTo,
            });
        }
        // Severity bump (e.g. case turns out worse than first thought)
        if (body.severity && body.severity !== existing.severity) {
            if (!SEVERITY_VALUES.includes(body.severity)) {
                return res.status(400).json({ error: `Invalid severity. Allowed: ${SEVERITY_VALUES.join(', ')}` });
            }
            updates.severity = body.severity;
            auditEntries.push({ action: 'SEVERITY_CHANGED', from: existing.severity, to: body.severity });
        }
        // Free-form fields — just copy across when present
        const passthrough = [
            'rootCause', 'actionTaken', 'preventiveAction', 'rejectionReason',
            'falseReportConsequenceTaken', 'falseReportConsequenceNote',
            'reportedToAuthority', 'authorityName', 'authorityReportNote', 'authorityReportedAt',
            'requiresRCA', 'requiresExternalReport', 'confidentiality', 'subcategory',
            'location', 'dueDate', 'reviewerEmpId',
        ];
        for (const k of passthrough) {
            if (body[k] !== undefined && body[k] !== existing[k]) {
                updates[k] = (k === 'dueDate' || k === 'authorityReportedAt') && body[k]
                    ? new Date(body[k]) : body[k];
            }
        }
        if (Object.keys(updates).length === 0) {
            return res.json(existing);
        }
        const updated = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const u = yield tx.incident.update({ where: { id }, data: updates });
            for (const a of auditEntries) {
                yield logAudit(tx, id, a.action, {
                    fromValue: a.from != null ? String(a.from) : null,
                    toValue: a.to != null ? String(a.to) : null,
                    note: (_a = a.note) !== null && _a !== void 0 ? _a : null,
                    performedBy: me,
                });
            }
            return u;
        }));
        // Notify newly-assigned investigator
        if (updates.assignedTo && updates.assignedTo !== existing.assignedTo) {
            try {
                yield (0, notifications_controller_1.createNotification)(updates.assignedTo, `📋 You have been assigned an incident: "${existing.title}" — please review.`);
            }
            catch (e) {
                console.error("[incident notify reassign] failed:", e);
            }
        }
        // Notify reporter on status change (if not anonymous)
        if (updates.status && existing.reportedBy) {
            try {
                yield (0, notifications_controller_1.createNotification)(existing.reportedBy, `🔔 Your incident "${existing.title}" is now ${updates.status}.`);
            }
            catch (e) {
                console.error("[incident notify reporter] failed:", e);
            }
        }
        // Notify the subject employee on key milestones (acknowledged / resolved /
        // closed / rejected). They have a stake in the case and should be told
        // when the verdict lands. Skip if the subject is also the reporter.
        if (updates.status &&
            existing.employeeId &&
            existing.employeeId !== existing.reportedBy &&
            ['ACKNOWLEDGED', 'RESOLVED', 'CLOSED', 'REJECTED'].includes(updates.status)) {
            try {
                const verb = updates.status === 'ACKNOWLEDGED' ? 'has been acknowledged by HR' :
                    updates.status === 'RESOLVED' ? 'has been resolved' :
                        updates.status === 'CLOSED' ? 'has been closed' :
                            'was reviewed and no further action will be taken';
                yield (0, notifications_controller_1.createNotification)(existing.employeeId, `📌 The incident involving you, "${existing.title}", ${verb}.`);
            }
            catch (e) {
                console.error("[incident notify subject] failed:", e);
            }
        }
        res.json(updated);
    }
    catch (err) {
        console.error("Error updating incident:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to update incident" });
    }
});
exports.updateIncident = updateIncident;
/* ════════════════════════════════════════════════════════════════════
   COMMENTS / WITNESSES / ATTACHMENTS
   ════════════════════════════════════════════════════════════════════ */
const addComment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const incidentId = Number(req.params.id);
        const me = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId;
        const { body, isInternal } = req.body || {};
        if (!(body === null || body === void 0 ? void 0 : body.trim()))
            return res.status(400).json({ error: "body is required" });
        const exists = yield prisma_1.prisma.incident.findUnique({ where: { id: incidentId }, select: { id: true } });
        if (!exists)
            return res.status(404).json({ error: "Incident not found" });
        const comment = yield prisma_1.prisma.incidentComment.create({
            data: { incidentId, authorId: me, body: body.trim(), isInternal: !!isInternal },
        });
        yield logAudit(prisma_1.prisma, incidentId, 'COMMENTED', { performedBy: me, note: body.slice(0, 200) });
        res.status(201).json(comment);
    }
    catch (err) {
        console.error("Error adding comment:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to add comment" });
    }
});
exports.addComment = addComment;
const addWitness = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const incidentId = Number(req.params.id);
        const me = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId;
        const { witnessEmpId, witnessName, contactInfo, statement } = req.body || {};
        if (!witnessEmpId && !witnessName) {
            return res.status(400).json({ error: "Either witnessEmpId or witnessName is required" });
        }
        const witness = yield prisma_1.prisma.incidentWitness.create({
            data: {
                incidentId,
                witnessEmpId: witnessEmpId ? Number(witnessEmpId) : null,
                witnessName: witnessName !== null && witnessName !== void 0 ? witnessName : null,
                contactInfo: contactInfo !== null && contactInfo !== void 0 ? contactInfo : null,
                statement: statement !== null && statement !== void 0 ? statement : null,
            },
        });
        yield logAudit(prisma_1.prisma, incidentId, 'WITNESS_ADDED', { performedBy: me, note: witnessName !== null && witnessName !== void 0 ? witnessName : `emp#${witnessEmpId}` });
        res.status(201).json(witness);
    }
    catch (err) {
        console.error("Error adding witness:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to add witness" });
    }
});
exports.addWitness = addWitness;
const addAttachment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const incidentId = Number(req.params.id);
        const me = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId;
        const { fileName, fileUrl } = req.body || {};
        if (!(fileName === null || fileName === void 0 ? void 0 : fileName.trim()) || !(fileUrl === null || fileUrl === void 0 ? void 0 : fileUrl.trim())) {
            return res.status(400).json({ error: "fileName and fileUrl are required" });
        }
        const att = yield prisma_1.prisma.incidentAttachment.create({
            data: { incidentId, fileName, fileUrl, uploadedBy: me },
        });
        yield logAudit(prisma_1.prisma, incidentId, 'ATTACHMENT_ADDED', { performedBy: me, note: fileName });
        res.status(201).json(att);
    }
    catch (err) {
        console.error("Error adding attachment:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to add attachment" });
    }
});
exports.addAttachment = addAttachment;
const deleteAttachment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const docId = Number(req.params.attachmentId);
        const att = yield prisma_1.prisma.incidentAttachment.findUnique({ where: { id: docId } });
        if (!att)
            return res.status(404).json({ error: "Attachment not found" });
        yield prisma_1.prisma.incidentAttachment.delete({ where: { id: docId } });
        yield logAudit(prisma_1.prisma, att.incidentId, 'ATTACHMENT_REMOVED', { performedBy: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null, note: att.fileName });
        res.json({ ok: true });
    }
    catch (err) {
        console.error("Error deleting attachment:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to delete attachment" });
    }
});
exports.deleteAttachment = deleteAttachment;
/* ════════════════════════════════════════════════════════════════════
   SUBJECT-VIEW (employee self-portal) — redacted endpoints
   ────────────────────────────────────────────────────────────────────
   Used by the "About Me" section on the Individual page. Returns ONLY
   the rows where the logged-in employee is the named subject AND the
   case has been formally communicated (status > OPEN). The shape is
   redacted vs. the HR view:
     • reporter / assignedTo identities are stripped
     • internal comments are filtered out
     • witnesses, attachments, RCA, audit log are NOT returned
     • outcome / root-cause / actions only after status RESOLVED
   ════════════════════════════════════════════════════════════════════ */
/** GET /incidents/mine — list of my-as-subject incidents, OPEN excluded. */
const listMyIncidents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const me = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId;
        if (!me)
            return res.status(401).json({ error: "Authentication required" });
        const rows = yield prisma_1.prisma.incident.findMany({
            where: {
                employeeId: Number(me),
                status: { not: 'OPEN' }, // hide until HR formally acknowledges
            },
            orderBy: [{ severity: 'desc' }, { reportedAt: 'desc' }],
            select: {
                id: true, title: true, severity: true, status: true,
                reportedAt: true, acknowledgedAt: true, resolvedAt: true, closedAt: true,
                isAnonymous: true, dueDate: true,
                category: { select: { id: true, name: true } },
            },
        });
        res.json({ total: rows.length, rows });
    }
    catch (err) {
        console.error("Error listing my incidents:", err);
        res.status(500).json({ error: "Failed to load your incidents" });
    }
});
exports.listMyIncidents = listMyIncidents;
/** GET /incidents/mine/:id — redacted detail. 404 if I'm not the subject
 *  or if the case is still OPEN (don't leak existence either way). */
const getMyIncident = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const me = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId;
        if (!me)
            return res.status(401).json({ error: "Authentication required" });
        const id = Number(req.params.id);
        const inc = yield prisma_1.prisma.incident.findUnique({
            where: { id },
            include: {
                category: { select: { id: true, name: true, description: true } },
                comments: {
                    where: { isInternal: false },
                    orderBy: { createdAt: 'asc' },
                    select: { id: true, body: true, createdAt: true, authorId: true, isInternal: true },
                },
                capaActions: {
                    where: { ownerId: Number(me) }, // only the subject's own CAPA tasks
                    orderBy: { createdAt: 'asc' },
                    select: {
                        id: true, type: true, description: true,
                        dueDate: true, status: true, completedAt: true,
                    },
                },
            },
        });
        // Treat "not the subject" and "still OPEN" identically — return 404 so
        // the existence of the case isn't leaked.
        if (!inc || inc.employeeId !== Number(me) || inc.status === 'OPEN') {
            return res.status(404).json({ error: "Not found" });
        }
        const isResolvedOrLater = ['RESOLVED', 'CLOSED', 'REJECTED', 'DUPLICATE', 'WITHDRAWN'].includes(inc.status);
        // Redacted view — strip reporter/assignedTo/witness data, expose
        // outcome fields only after RESOLVED.
        res.json({
            id: inc.id,
            title: inc.title,
            description: inc.description,
            subcategory: inc.subcategory,
            severity: inc.severity,
            status: inc.status,
            isAnonymous: inc.isAnonymous,
            location: inc.location,
            reportedAt: inc.reportedAt,
            incidentDate: inc.incidentDate,
            acknowledgedAt: inc.acknowledgedAt,
            resolvedAt: inc.resolvedAt,
            closedAt: inc.closedAt,
            dueDate: inc.dueDate,
            category: inc.category,
            comments: inc.comments,
            capa: inc.capaActions,
            // Outcome block — only after RESOLVED
            outcome: isResolvedOrLater ? inc.outcome : null,
            rootCause: isResolvedOrLater ? inc.rootCause : null,
            actionTaken: isResolvedOrLater ? inc.actionTaken : null,
            preventiveAction: isResolvedOrLater ? inc.preventiveAction : null,
            rejectionReason: inc.status === 'REJECTED' ? inc.rejectionReason : null,
        });
    }
    catch (err) {
        console.error("Error fetching my incident:", err);
        res.status(500).json({ error: "Failed to load incident" });
    }
});
exports.getMyIncident = getMyIncident;
/** POST /incidents/mine/:id/comments — subject posts their statement.
 *  Always non-internal (HR sees it). Allowed only while the case is
 *  active (between ACKNOWLEDGED and RESOLVED). */
const addMyComment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const me = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId;
        if (!me)
            return res.status(401).json({ error: "Authentication required" });
        const id = Number(req.params.id);
        const { body } = req.body || {};
        if (!(body === null || body === void 0 ? void 0 : body.trim()))
            return res.status(400).json({ error: "body is required" });
        const inc = yield prisma_1.prisma.incident.findUnique({
            where: { id },
            select: { id: true, employeeId: true, status: true },
        });
        if (!inc || inc.employeeId !== Number(me) || inc.status === 'OPEN') {
            return res.status(404).json({ error: "Not found" });
        }
        if (!['ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'RESOLVED'].includes(inc.status)) {
            return res.status(400).json({
                error: "This case is closed; no further statements can be added.",
            });
        }
        const comment = yield prisma_1.prisma.incidentComment.create({
            data: { incidentId: id, authorId: Number(me), body: body.trim(), isInternal: false },
        });
        yield logAudit(prisma_1.prisma, id, 'SUBJECT_STATEMENT', { performedBy: Number(me), note: body.slice(0, 200) });
        res.status(201).json(comment);
    }
    catch (err) {
        console.error("Error posting subject comment:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to post statement" });
    }
});
exports.addMyComment = addMyComment;
/* ════════════════════════════════════════════════════════════════════
   LEGACY endpoints (kept so the existing UI doesn't break)
   ════════════════════════════════════════════════════════════════════ */
const listIncidentsByReporter = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const reporterId = Number(req.params.reporterId);
        const list = yield prisma_1.prisma.incident.findMany({
            where: { reportedBy: reporterId },
            include: {
                employee: true, reporter: true,
                category: { select: { id: true, name: true } },
            },
            orderBy: { reportedAt: "desc" },
        });
        res.json(list);
    }
    catch (err) {
        console.error("Error fetching incidents:", err);
        res.status(500).json({ error: "Failed to load incidents" });
    }
});
exports.listIncidentsByReporter = listIncidentsByReporter;
const listIncidentsByEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        const list = yield prisma_1.prisma.incident.findMany({
            where: { employeeId },
            include: {
                employee: true, reporter: true,
                category: { select: { id: true, name: true } },
            },
            orderBy: { reportedAt: "desc" },
        });
        res.json(list);
    }
    catch (err) {
        console.error("Error fetching incidents:", err);
        res.status(500).json({ error: "Failed to load incidents" });
    }
});
exports.listIncidentsByEmployee = listIncidentsByEmployee;
// Kept for back-compat; delegates to the new paginated `listIncidents`.
exports.listAllIncidents = exports.listIncidents;
/* ════════════════════════════════════════════════════════════════════
   PHASE 2 — INVESTIGATION TOOLS
   ════════════════════════════════════════════════════════════════════ */
const CAPA_TYPES = ['CORRECTIVE', 'PREVENTIVE'];
const CAPA_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
const RCA_METHODS = ['FIVE_WHY', 'FISHBONE'];
/* ─── CAPA — Corrective & Preventive Actions ──────────────────────── */
const listCAPA = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const incidentId = Number(req.params.id);
        const rows = yield prisma_1.prisma.incidentCAPA.findMany({
            where: { incidentId },
            orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
        });
        res.json(rows);
    }
    catch (err) {
        console.error("Error listing CAPA:", err);
        res.status(500).json({ error: "Failed to list CAPA actions" });
    }
});
exports.listCAPA = listCAPA;
const createCAPA = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const incidentId = Number(req.params.id);
        const me = (_d = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId) !== null && _d !== void 0 ? _d : null;
        const { type, description, ownerId, dueDate } = req.body || {};
        if (!(description === null || description === void 0 ? void 0 : description.trim())) {
            return res.status(400).json({ error: "description is required" });
        }
        const capaType = CAPA_TYPES.includes(type) ? type : 'CORRECTIVE';
        const exists = yield prisma_1.prisma.incident.findUnique({ where: { id: incidentId }, select: { id: true } });
        if (!exists)
            return res.status(404).json({ error: "Incident not found" });
        const capa = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const created = yield tx.incidentCAPA.create({
                data: {
                    incidentId,
                    type: capaType,
                    description: description.trim(),
                    ownerId: ownerId ? Number(ownerId) : null,
                    dueDate: dueDate ? new Date(dueDate) : null,
                    status: 'PENDING',
                    createdBy: me,
                },
            });
            yield logAudit(tx, incidentId, 'CAPA_ADDED', {
                toValue: capaType,
                note: description.slice(0, 200),
                performedBy: me,
            });
            return created;
        }));
        // Notify the assigned owner so they know action is pending on them
        if (capa.ownerId) {
            try {
                yield (0, notifications_controller_1.createNotification)(capa.ownerId, `🛠 You have been assigned a ${capaType.toLowerCase()} action on incident #${incidentId}` +
                    (capa.dueDate ? ` (due ${new Date(capa.dueDate).toLocaleDateString()})` : '') + '.');
            }
            catch (e) {
                console.error("[CAPA notify owner] failed:", e);
            }
        }
        res.status(201).json(capa);
    }
    catch (err) {
        console.error("Error creating CAPA:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to create CAPA" });
    }
});
exports.createCAPA = createCAPA;
const updateCAPA = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const capaId = Number(req.params.capaId);
        const me = (_d = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId) !== null && _d !== void 0 ? _d : null;
        const body = req.body || {};
        const existing = yield prisma_1.prisma.incidentCAPA.findUnique({ where: { id: capaId } });
        if (!existing)
            return res.status(404).json({ error: "CAPA not found" });
        const updates = {};
        const auditNotes = [];
        if (body.type && body.type !== existing.type) {
            if (!CAPA_TYPES.includes(body.type)) {
                return res.status(400).json({ error: `Invalid type. Allowed: ${CAPA_TYPES.join(', ')}` });
            }
            updates.type = body.type;
            auditNotes.push(`type: ${existing.type} → ${body.type}`);
        }
        if (body.status && body.status !== existing.status) {
            if (!CAPA_STATUSES.includes(body.status)) {
                return res.status(400).json({ error: `Invalid status. Allowed: ${CAPA_STATUSES.join(', ')}` });
            }
            updates.status = body.status;
            auditNotes.push(`status: ${existing.status} → ${body.status}`);
            // Stamp completion when transitioning into DONE for the first time
            if (body.status === 'DONE' && !existing.completedAt) {
                updates.completedAt = new Date();
            }
        }
        if (body.description !== undefined && body.description !== existing.description) {
            if (!((_e = body.description) === null || _e === void 0 ? void 0 : _e.trim()))
                return res.status(400).json({ error: "description cannot be empty" });
            updates.description = body.description.trim();
        }
        if (body.ownerId !== undefined && Number(body.ownerId) !== existing.ownerId) {
            updates.ownerId = body.ownerId ? Number(body.ownerId) : null;
            auditNotes.push(`owner: ${(_f = existing.ownerId) !== null && _f !== void 0 ? _f : 'none'} → ${(_g = updates.ownerId) !== null && _g !== void 0 ? _g : 'none'}`);
        }
        if (body.dueDate !== undefined) {
            updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;
        }
        if (body.completedNote !== undefined) {
            updates.completedNote = (_h = body.completedNote) !== null && _h !== void 0 ? _h : null;
        }
        if (Object.keys(updates).length === 0)
            return res.json(existing);
        const updated = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const u = yield tx.incidentCAPA.update({ where: { id: capaId }, data: updates });
            if (auditNotes.length) {
                yield logAudit(tx, existing.incidentId, 'CAPA_UPDATED', {
                    note: auditNotes.join(' · '),
                    performedBy: me,
                });
            }
            return u;
        }));
        // Notifications
        try {
            // New owner assigned → ping them
            if (updates.ownerId && updates.ownerId !== existing.ownerId) {
                yield (0, notifications_controller_1.createNotification)(updates.ownerId, `🛠 You have been assigned a CAPA action on incident #${existing.incidentId}.`);
            }
            // Marked DONE → ping the original creator + incident assignee for review
            if (updates.status === 'DONE' && existing.status !== 'DONE') {
                const incident = yield prisma_1.prisma.incident.findUnique({
                    where: { id: existing.incidentId },
                    select: { assignedTo: true, title: true },
                });
                const recipients = new Set();
                if (existing.createdBy)
                    recipients.add(existing.createdBy);
                if (incident === null || incident === void 0 ? void 0 : incident.assignedTo)
                    recipients.add(incident.assignedTo);
                recipients.delete(me !== null && me !== void 0 ? me : -1); // don't notify the doer themselves
                for (const id of recipients) {
                    yield (0, notifications_controller_1.createNotification)(id, `✅ A CAPA action on incident #${existing.incidentId} has been marked DONE.`);
                }
            }
        }
        catch (e) {
            console.error("[CAPA notify] failed:", e);
        }
        res.json(updated);
    }
    catch (err) {
        console.error("Error updating CAPA:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to update CAPA" });
    }
});
exports.updateCAPA = updateCAPA;
const deleteCAPA = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const capaId = Number(req.params.capaId);
        const me = (_d = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId) !== null && _d !== void 0 ? _d : null;
        const existing = yield prisma_1.prisma.incidentCAPA.findUnique({ where: { id: capaId } });
        if (!existing)
            return res.status(404).json({ error: "CAPA not found" });
        yield prisma_1.prisma.incidentCAPA.delete({ where: { id: capaId } });
        yield logAudit(prisma_1.prisma, existing.incidentId, 'CAPA_REMOVED', {
            note: `Removed: ${String(existing.description).slice(0, 200)}`,
            performedBy: me,
        });
        res.json({ ok: true });
    }
    catch (err) {
        console.error("Error deleting CAPA:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to delete CAPA" });
    }
});
exports.deleteCAPA = deleteCAPA;
/* ─── RCA — Root Cause Analysis (5-Why or Fishbone) ───────────────── */
/**
 * Upsert the RCA record for an incident. One incident = one RCA. The body
 * can carry either 5-Why fields (`why1`..`why5`) or Fishbone fields
 * (`causesPeople`, `causesProcess`, ...) depending on `method`.
 */
const upsertRCA = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
    try {
        const incidentId = Number(req.params.id);
        const me = (_d = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId) !== null && _d !== void 0 ? _d : null;
        const body = req.body || {};
        if (body.method && !RCA_METHODS.includes(body.method)) {
            return res.status(400).json({ error: `Invalid method. Allowed: ${RCA_METHODS.join(', ')}` });
        }
        const incident = yield prisma_1.prisma.incident.findUnique({
            where: { id: incidentId }, select: { id: true, requiresRCA: true },
        });
        if (!incident)
            return res.status(404).json({ error: "Incident not found" });
        const data = {
            method: (_e = body.method) !== null && _e !== void 0 ? _e : 'FIVE_WHY',
            problemStatement: (_f = body.problemStatement) !== null && _f !== void 0 ? _f : null,
            rootCauseSummary: (_g = body.rootCauseSummary) !== null && _g !== void 0 ? _g : null,
            // 5-Why
            why1: (_h = body.why1) !== null && _h !== void 0 ? _h : null, why2: (_j = body.why2) !== null && _j !== void 0 ? _j : null, why3: (_k = body.why3) !== null && _k !== void 0 ? _k : null,
            why4: (_l = body.why4) !== null && _l !== void 0 ? _l : null, why5: (_m = body.why5) !== null && _m !== void 0 ? _m : null,
            // Fishbone
            causesPeople: (_o = body.causesPeople) !== null && _o !== void 0 ? _o : null,
            causesProcess: (_p = body.causesProcess) !== null && _p !== void 0 ? _p : null,
            causesEquipment: (_q = body.causesEquipment) !== null && _q !== void 0 ? _q : null,
            causesEnvironment: (_r = body.causesEnvironment) !== null && _r !== void 0 ? _r : null,
            causesMaterial: (_s = body.causesMaterial) !== null && _s !== void 0 ? _s : null,
            causesMethod: (_t = body.causesMethod) !== null && _t !== void 0 ? _t : null,
            conductedBy: me,
        };
        const existing = yield prisma_1.prisma.incidentRCA.findUnique({ where: { incidentId } });
        const saved = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const row = existing
                ? yield tx.incidentRCA.update({ where: { incidentId }, data })
                : yield tx.incidentRCA.create({ data: Object.assign(Object.assign({}, data), { incidentId }) });
            yield logAudit(tx, incidentId, existing ? 'RCA_UPDATED' : 'RCA_CREATED', {
                toValue: data.method,
                note: (_b = (_a = data.rootCauseSummary) === null || _a === void 0 ? void 0 : _a.slice(0, 200)) !== null && _b !== void 0 ? _b : null,
                performedBy: me,
            });
            // If incident is flagged requiresRCA but didn't have one yet, also
            // bubble that up via a status note — the close action will check this.
            return row;
        }));
        res.json(saved);
    }
    catch (err) {
        console.error("Error saving RCA:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to save RCA" });
    }
});
exports.upsertRCA = upsertRCA;
const getRCA = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const incidentId = Number(req.params.id);
        const rca = yield prisma_1.prisma.incidentRCA.findUnique({ where: { incidentId } });
        res.json(rca);
    }
    catch (err) {
        console.error("Error fetching RCA:", err);
        res.status(500).json({ error: "Failed to load RCA" });
    }
});
exports.getRCA = getRCA;
/* ─── Linked Incidents (parent ↔ child) ────────────────────────────── */
/**
 * Mark this incident as a child of `parentIncidentId` so investigators can
 * group related cases under one root cause. The parent must be a different
 * incident (no self-link) and the parent itself can't already point to this
 * incident as its parent (no two-cycle loops).
 */
const linkIncident = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const childId = Number(req.params.id);
        const parentId = Number((_a = req.body) === null || _a === void 0 ? void 0 : _a.parentIncidentId);
        const me = (_e = (_c = (_b = req.user) === null || _b === void 0 ? void 0 : _b.empId) !== null && _c !== void 0 ? _c : (_d = req.user) === null || _d === void 0 ? void 0 : _d.userId) !== null && _e !== void 0 ? _e : null;
        if (!parentId)
            return res.status(400).json({ error: "parentIncidentId is required" });
        if (parentId === childId)
            return res.status(400).json({ error: "Cannot link an incident to itself" });
        const [child, parent] = yield Promise.all([
            prisma_1.prisma.incident.findUnique({ where: { id: childId }, select: { id: true } }),
            prisma_1.prisma.incident.findUnique({ where: { id: parentId }, select: { id: true, parentIncidentId: true } }),
        ]);
        if (!child)
            return res.status(404).json({ error: "Incident not found" });
        if (!parent)
            return res.status(404).json({ error: "Parent incident not found" });
        if (parent.parentIncidentId === childId) {
            return res.status(400).json({ error: "Linking would create a cycle" });
        }
        const updated = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const u = yield tx.incident.update({
                where: { id: childId },
                data: { parentIncidentId: parentId },
            });
            yield logAudit(tx, childId, 'LINKED_TO_PARENT', {
                toValue: String(parentId),
                note: `Linked to incident #${parentId}`,
                performedBy: me,
            });
            return u;
        }));
        res.json({ ok: true, parentIncidentId: updated.parentIncidentId });
    }
    catch (err) {
        console.error("Error linking incident:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to link incident" });
    }
});
exports.linkIncident = linkIncident;
const unlinkIncident = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const childId = Number(req.params.id);
        const me = (_d = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.userId) !== null && _d !== void 0 ? _d : null;
        const existing = yield prisma_1.prisma.incident.findUnique({
            where: { id: childId }, select: { id: true, parentIncidentId: true },
        });
        if (!existing)
            return res.status(404).json({ error: "Incident not found" });
        if (!existing.parentIncidentId)
            return res.json({ ok: true, parentIncidentId: null });
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.incident.update({
                where: { id: childId },
                data: { parentIncidentId: null },
            });
            yield logAudit(tx, childId, 'UNLINKED_FROM_PARENT', {
                fromValue: String(existing.parentIncidentId),
                note: `Removed link to incident #${existing.parentIncidentId}`,
                performedBy: me,
            });
        }));
        res.json({ ok: true, parentIncidentId: null });
    }
    catch (err) {
        console.error("Error unlinking incident:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to unlink incident" });
    }
});
exports.unlinkIncident = unlinkIncident;
/* ════════════════════════════════════════════════════════════════════
   PHASE 3 — DASHBOARD
   ════════════════════════════════════════════════════════════════════ */
/**
 * GET /incidents/dashboard
 *
 * Single consolidated analytics endpoint. Returns everything the incident
 * dashboard needs in one round-trip. Each section answers a specific
 * recruiter / HR question:
 *
 *  KPIs:
 *   • openCount               — currently un-closed incidents
 *   • criticalOpenCount       — CRITICAL or HIGH severity, not yet CLOSED
 *   • slaBreachCount          — past dueDate, still un-closed
 *   • avgResolutionDays       — closed-incident average over last 90 days
 *   • capaOverdueCount        — CAPA actions past their dueDate, not DONE
 *   • mandatoryReportingDue   — flagged requiresExternalReport, not yet reported
 *
 *  Breakdowns:
 *   • bySeverity              — counts of all-time incidents per severity
 *   • byStatus                — counts per status
 *   • byCategory              — counts per category
 *   • byOutcome               — counts per outcome (only for closed cases)
 *
 *  Trends:
 *   • trendByMonth            — last 6 months, count of new incidents
 *
 *  Hotspots / leaderboards:
 *   • hotSpotLocations        — top 5 locations with most incidents
 *   • topAssignees            — top 5 employees by current open-count
 *   • repeatEmployees         — employees in 3+ incidents over last quarter
 *
 *  Actionable lists:
 *   • slaBreaching            — list of incidents to act on now
 *   • capaOverdue             — list of overdue CAPA actions
 *   • recentActivity          — last 15 audit events for the activity feed
 */
const getIncidentDashboard = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const now = new Date();
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);
        const quarterAgo = new Date(now.getTime() - 90 * 86400000);
        const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        // Statuses considered "still in flight"
        const OPEN_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'RESOLVED'];
        const [
        // KPIs
        openCount, criticalOpenCount, slaBreachIncidents, closedRecent, capaOverdueRows, mandatoryReportingDueCount, 
        // Breakdowns
        bySeverityRaw, byStatusRaw, byCategoryRaw, byOutcomeRaw, 
        // Trend (last 6 months)
        trendRows, 
        // Hot-spots
        hotSpotsRaw, 
        // Top assignees
        topAssigneesRaw, 
        // Repeat employees
        repeatEmployeesRaw, 
        // Actionable lists
        slaBreachingList, capaOverdueList, recentActivityRaw,] = yield Promise.all([
            prisma_1.prisma.incident.count({ where: { status: { in: OPEN_STATUSES } } }),
            prisma_1.prisma.incident.count({
                where: { status: { in: OPEN_STATUSES }, severity: { in: ['CRITICAL', 'HIGH'] } },
            }),
            // For SLA-breach KPI we just need the count, but list is also pulled below
            prisma_1.prisma.incident.count({
                where: { status: { in: OPEN_STATUSES }, dueDate: { lt: now } },
            }),
            // Recent closed incidents (for avg resolution)
            prisma_1.prisma.incident.findMany({
                where: { status: 'CLOSED', closedAt: { gte: ninetyDaysAgo } },
                select: { reportedAt: true, closedAt: true },
                take: 200,
            }),
            // Overdue CAPA actions
            prisma_1.prisma.incidentCAPA.findMany({
                where: {
                    status: { in: ['PENDING', 'IN_PROGRESS'] },
                    dueDate: { lt: now },
                },
                select: { id: true },
            }),
            prisma_1.prisma.incident.count({
                where: { requiresExternalReport: true, reportedToAuthority: false },
            }),
            // Severity counts
            prisma_1.prisma.incident.groupBy({
                by: ['severity'],
                _count: { id: true },
            }),
            // Status counts
            prisma_1.prisma.incident.groupBy({
                by: ['status'],
                _count: { id: true },
            }),
            // Category counts
            prisma_1.prisma.incident.groupBy({
                by: ['categoryId'],
                _count: { id: true },
            }),
            // Outcome distribution (closed cases only)
            prisma_1.prisma.incident.groupBy({
                by: ['outcome'],
                where: { outcome: { not: null } },
                _count: { id: true },
            }),
            // Trend — fetch ids + reportedAt for last 6 months and bucket client-side
            prisma_1.prisma.incident.findMany({
                where: { reportedAt: { gte: sixMonthsAgo } },
                select: { id: true, reportedAt: true },
                take: 5000,
            }),
            // Hotspots — locations with most incidents (last 6 months)
            prisma_1.prisma.incident.groupBy({
                by: ['location'],
                where: { location: { not: null }, reportedAt: { gte: sixMonthsAgo } },
                _count: { id: true },
                orderBy: { _count: { id: 'desc' } },
                take: 5,
            }),
            // Top assignees by current open-count
            prisma_1.prisma.incident.groupBy({
                by: ['assignedTo'],
                where: { assignedTo: { not: null }, status: { in: OPEN_STATUSES } },
                _count: { id: true },
                orderBy: { _count: { id: 'desc' } },
                take: 5,
            }),
            // Repeat employees — same employee in 3+ incidents this quarter
            prisma_1.prisma.incident.groupBy({
                by: ['employeeId'],
                where: { employeeId: { not: null }, reportedAt: { gte: quarterAgo } },
                _count: { id: true },
                having: { id: { _count: { gte: 3 } } },
                orderBy: { _count: { id: 'desc' } },
                take: 10,
            }),
            // Actionable list — SLA-breaching open incidents
            prisma_1.prisma.incident.findMany({
                where: { status: { in: OPEN_STATUSES }, dueDate: { lt: now } },
                select: {
                    id: true, title: true, severity: true, status: true,
                    dueDate: true, reportedAt: true, assignedTo: true,
                    category: { select: { name: true } },
                },
                orderBy: { dueDate: 'asc' },
                take: 10,
            }),
            // Actionable list — overdue CAPA (with owner + parent incident title)
            prisma_1.prisma.incidentCAPA.findMany({
                where: {
                    status: { in: ['PENDING', 'IN_PROGRESS'] },
                    dueDate: { lt: now },
                },
                select: {
                    id: true, type: true, description: true, ownerId: true, dueDate: true,
                    status: true, incidentId: true,
                },
                orderBy: { dueDate: 'asc' },
                take: 10,
            }),
            // Recent activity — last 15 audit events
            prisma_1.prisma.incidentAuditLog.findMany({
                select: {
                    id: true, incidentId: true, action: true, fromValue: true, toValue: true,
                    note: true, performedAt: true, performedBy: true,
                },
                orderBy: { performedAt: 'desc' },
                take: 15,
            }),
        ]);
        // ── KPI: avg resolution days ───────────────────────────────
        const resolutionDays = closedRecent
            .filter((c) => c.closedAt && c.reportedAt)
            .map((c) => (c.closedAt.getTime() - c.reportedAt.getTime()) / 86400000);
        const avgResolutionDays = resolutionDays.length
            ? Math.round((resolutionDays.reduce((s, x) => s + x, 0) / resolutionDays.length) * 10) / 10
            : 0;
        // ── Breakdown: bySeverity (in display order) ───────────────
        const SEV_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        const sevMap = new Map(bySeverityRaw.map((r) => [r.severity, Number(r._count.id) || 0]));
        const bySeverity = SEV_ORDER.map((s) => { var _a; return ({ severity: s, count: (_a = sevMap.get(s)) !== null && _a !== void 0 ? _a : 0 }); });
        // ── Breakdown: byStatus (in workflow order) ────────────────
        const STATUS_ORDER = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REJECTED', 'DUPLICATE', 'WITHDRAWN'];
        const statMap = new Map(byStatusRaw.map((r) => [r.status, Number(r._count.id) || 0]));
        const byStatus = STATUS_ORDER.map((s) => { var _a; return ({ status: s, count: (_a = statMap.get(s)) !== null && _a !== void 0 ? _a : 0 }); })
            .filter((b) => b.count > 0);
        // ── Breakdown: byCategory (hydrate names) ──────────────────
        const catIds = byCategoryRaw.map((r) => r.categoryId).filter((x) => x != null);
        const cats = catIds.length
            ? yield prisma_1.prisma.incidentCategory.findMany({
                where: { id: { in: catIds } },
                select: { id: true, name: true },
            })
            : [];
        const catNameMap = new Map(cats.map((c) => [c.id, c.name]));
        const byCategory = byCategoryRaw
            .map((r) => {
            var _a;
            return ({
                categoryId: r.categoryId,
                categoryName: r.categoryId != null ? ((_a = catNameMap.get(r.categoryId)) !== null && _a !== void 0 ? _a : `#${r.categoryId}`) : 'Uncategorised',
                count: r._count.id,
            });
        })
            .sort((a, b) => b.count - a.count);
        // ── Breakdown: byOutcome ───────────────────────────────────
        const byOutcome = byOutcomeRaw
            .map((r) => ({ outcome: r.outcome, count: r._count.id }))
            .sort((a, b) => b.count - a.count);
        // ── Trend: bucket the last-6-months rows by YYYY-MM ───────
        const monthBuckets = new Map();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthBuckets.set(key, 0);
        }
        for (const row of trendRows) {
            const t = row.reportedAt;
            const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
            if (monthBuckets.has(key))
                monthBuckets.set(key, ((_a = monthBuckets.get(key)) !== null && _a !== void 0 ? _a : 0) + 1);
        }
        const trendByMonth = Array.from(monthBuckets.entries()).map(([month, count]) => ({ month, count }));
        // ── Hotspots ───────────────────────────────────────────────
        const hotSpotLocations = hotSpotsRaw.map((r) => ({
            location: r.location, count: r._count.id,
        }));
        // ── Top assignees (hydrate names) ─────────────────────────
        const assigneeIds = topAssigneesRaw.map((r) => r.assignedTo).filter((x) => x);
        const assigneeEmps = assigneeIds.length
            ? yield prisma_1.prisma.employee.findMany({
                where: { id: { in: assigneeIds } },
                select: { id: true, firstName: true, lastName: true, employeeCode: true,
                    Department: { select: { name: true } } },
            })
            : [];
        const assigneeMap = new Map(assigneeEmps.map((e) => [e.id, e]));
        const topAssignees = topAssigneesRaw.map((r) => {
            var _a, _b, _c;
            const emp = assigneeMap.get(r.assignedTo);
            return {
                employeeId: r.assignedTo,
                name: emp ? `${emp.firstName} ${emp.lastName}` : `Employee #${r.assignedTo}`,
                employeeCode: (_a = emp === null || emp === void 0 ? void 0 : emp.employeeCode) !== null && _a !== void 0 ? _a : '—',
                dept: (_c = (_b = emp === null || emp === void 0 ? void 0 : emp.Department) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : '—',
                openCount: r._count.id,
            };
        });
        // ── Repeat employees (hydrate names) ──────────────────────
        const repeatIds = repeatEmployeesRaw.map((r) => r.employeeId).filter((x) => x);
        const repeatEmps = repeatIds.length
            ? yield prisma_1.prisma.employee.findMany({
                where: { id: { in: repeatIds } },
                select: { id: true, firstName: true, lastName: true, employeeCode: true },
            })
            : [];
        const repeatEmpMap = new Map(repeatEmps.map((e) => [e.id, e]));
        const repeatEmployees = repeatEmployeesRaw.map((r) => {
            var _a;
            const emp = repeatEmpMap.get(r.employeeId);
            return {
                employeeId: r.employeeId,
                name: emp ? `${emp.firstName} ${emp.lastName}` : `Employee #${r.employeeId}`,
                employeeCode: (_a = emp === null || emp === void 0 ? void 0 : emp.employeeCode) !== null && _a !== void 0 ? _a : '—',
                incidentCount: r._count.id,
            };
        });
        // ── SLA-breaching list (with days-overdue + assignee name) ─
        const slaBreachAssigneeIds = Array.from(new Set(slaBreachingList.map((r) => r.assignedTo).filter(Boolean)));
        const slaBreachEmps = slaBreachAssigneeIds.length
            ? yield prisma_1.prisma.employee.findMany({
                where: { id: { in: slaBreachAssigneeIds } },
                select: { id: true, firstName: true, lastName: true },
            })
            : [];
        const slaBreachEmpMap = new Map(slaBreachEmps.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
        const slaBreaching = slaBreachingList.map((r) => {
            var _a, _b, _c;
            return ({
                id: r.id,
                title: r.title,
                severity: r.severity,
                status: r.status,
                categoryName: (_b = (_a = r.category) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '—',
                dueDate: r.dueDate,
                reportedAt: r.reportedAt,
                assigneeName: r.assignedTo ? (_c = slaBreachEmpMap.get(r.assignedTo)) !== null && _c !== void 0 ? _c : '—' : '—',
                daysOverdue: r.dueDate
                    ? Math.max(0, Math.floor((now.getTime() - r.dueDate.getTime()) / 86400000))
                    : 0,
            });
        });
        // ── CAPA overdue (hydrate owner + incident title) ─────────
        const capaOwnerIds = Array.from(new Set(capaOverdueList.map((r) => r.ownerId).filter(Boolean)));
        const capaIncidentIds = Array.from(new Set(capaOverdueList.map((r) => r.incidentId)));
        const [capaOwners, capaIncidents] = yield Promise.all([
            capaOwnerIds.length
                ? prisma_1.prisma.employee.findMany({
                    where: { id: { in: capaOwnerIds } },
                    select: { id: true, firstName: true, lastName: true },
                })
                : Promise.resolve([]),
            capaIncidentIds.length
                ? prisma_1.prisma.incident.findMany({
                    where: { id: { in: capaIncidentIds } },
                    select: { id: true, title: true },
                })
                : Promise.resolve([]),
        ]);
        const capaOwnerMap = new Map(capaOwners.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
        const capaIncidentMap = new Map(capaIncidents.map((i) => [i.id, i.title]));
        const capaOverdue = capaOverdueList.map((r) => {
            var _a, _b;
            return ({
                capaId: r.id,
                type: r.type,
                description: r.description,
                status: r.status,
                dueDate: r.dueDate,
                daysOverdue: r.dueDate
                    ? Math.max(0, Math.floor((now.getTime() - r.dueDate.getTime()) / 86400000))
                    : 0,
                ownerId: r.ownerId,
                ownerName: r.ownerId ? (_a = capaOwnerMap.get(r.ownerId)) !== null && _a !== void 0 ? _a : '—' : '—',
                incidentId: r.incidentId,
                incidentTitle: (_b = capaIncidentMap.get(r.incidentId)) !== null && _b !== void 0 ? _b : `#${r.incidentId}`,
            });
        });
        // ── Recent activity (hydrate incident titles + actor names) ─
        const recentIncidentIds = Array.from(new Set(recentActivityRaw.map((r) => r.incidentId)));
        const recentActorIds = Array.from(new Set(recentActivityRaw.map((r) => r.performedBy).filter(Boolean)));
        const [recentIncidents, recentActors] = yield Promise.all([
            recentIncidentIds.length
                ? prisma_1.prisma.incident.findMany({
                    where: { id: { in: recentIncidentIds } },
                    select: { id: true, title: true },
                })
                : Promise.resolve([]),
            recentActorIds.length
                ? prisma_1.prisma.employee.findMany({
                    where: { id: { in: recentActorIds } },
                    select: { id: true, firstName: true, lastName: true },
                })
                : Promise.resolve([]),
        ]);
        const recentIncidentMap = new Map(recentIncidents.map((i) => [i.id, i.title]));
        const recentActorMap = new Map(recentActors.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
        const recentActivity = recentActivityRaw.map((r) => {
            var _a, _b;
            return ({
                id: r.id,
                action: r.action,
                fromValue: r.fromValue,
                toValue: r.toValue,
                note: r.note,
                at: r.performedAt,
                incidentId: r.incidentId,
                incidentTitle: (_a = recentIncidentMap.get(r.incidentId)) !== null && _a !== void 0 ? _a : `#${r.incidentId}`,
                actorName: r.performedBy ? (_b = recentActorMap.get(r.performedBy)) !== null && _b !== void 0 ? _b : 'System' : 'System',
            });
        });
        res.json({
            generatedAt: now.toISOString(),
            kpis: {
                openCount,
                criticalOpenCount,
                slaBreachCount: slaBreachIncidents,
                avgResolutionDays,
                capaOverdueCount: capaOverdueRows.length,
                mandatoryReportingDue: mandatoryReportingDueCount,
            },
            bySeverity,
            byStatus,
            byCategory,
            byOutcome,
            trendByMonth,
            hotSpotLocations,
            topAssignees,
            repeatEmployees,
            slaBreaching,
            capaOverdue,
            recentActivity,
        });
    }
    catch (err) {
        console.error("Error building incident dashboard:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to load incident dashboard" });
    }
});
exports.getIncidentDashboard = getIncidentDashboard;
/* ════════════════════════════════════════════════════════════════════
   PHASE 4 — PUBLIC ANONYMOUS REPORTING + AUTO-ESCALATION
   ════════════════════════════════════════════════════════════════════ */
/* ─── Public endpoints (no auth, rate-limited at the route layer) ── */
/** Generate a URL-safe tracking token for anonymous reporters. */
function makeTrackingToken() {
    // 24 random bytes → 32-char base64url. Roughly the strength of a UUID
    // but URL-safe and no dashes — fits cleanly in a follow-up link the
    // reporter can bookmark.
    return crypto_1.default.randomBytes(24).toString('base64url');
}
/**
 * GET /api/incidents/public/categories
 * Returns ONLY categories with `isAnonymousAllowed=true`. We never expose
 * the full category list publicly because it might leak internal taxonomy.
 */
const listPublicCategories = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const cats = yield prisma_1.prisma.incidentCategory.findMany({
            where: { isActive: true, isAnonymousAllowed: true },
            orderBy: { sortOrder: 'asc' },
            select: { id: true, name: true, description: true },
        });
        res.json(cats);
    }
    catch (err) {
        console.error("Error listing public categories:", err);
        res.status(500).json({ error: "Failed to list categories" });
    }
});
exports.listPublicCategories = listPublicCategories;
/**
 * POST /api/incidents/public/report
 * Anonymous incident submission. Returns a tracking token the reporter can
 * use to come back via GET /public/track/:token.
 *
 * Hard rules:
 *   • Category must be active AND have isAnonymousAllowed=true.
 *   • The submitted record always gets isAnonymous=true and reportedBy=null,
 *     regardless of what the body says.
 *   • Confidentiality is forced to STANDARD (we don't trust public input).
 */
const submitPublicIncident = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { title, description, categoryId, location, incidentDate, attachments } = req.body || {};
        if (!(title === null || title === void 0 ? void 0 : title.trim()) || title.trim().length < 4 || title.length > 200) {
            return res.status(400).json({ error: "title is required (4–200 chars)" });
        }
        if (!(description === null || description === void 0 ? void 0 : description.trim()) || description.trim().length < 10 || description.length > 5000) {
            return res.status(400).json({ error: "description is required (10–5000 chars)" });
        }
        if (!categoryId)
            return res.status(400).json({ error: "categoryId is required" });
        const category = yield prisma_1.prisma.incidentCategory.findUnique({
            where: { id: Number(categoryId) },
        });
        if (!category || !category.isActive) {
            return res.status(400).json({ error: "Invalid category" });
        }
        if (!category.isAnonymousAllowed) {
            return res.status(403).json({
                error: `Anonymous reporting is not allowed for "${category.name}". Please log in to report this category.`,
            });
        }
        // Reporter context for audit (NOT linked to a person — we just keep the
        // IP + UA so abuse / pattern detection is possible later).
        const fwd = req.headers['x-forwarded-for'];
        const ip = (typeof fwd === 'string' && fwd ? fwd.split(',')[0].trim() : (_a = req.socket) === null || _a === void 0 ? void 0 : _a.remoteAddress) || 'unknown';
        const ua = req.headers['user-agent'] || 'unknown';
        const sev = category.defaultSeverity || 'MEDIUM';
        const slaHours = Number(category.defaultSlaHours) || 72;
        const reportedAt = new Date();
        const dueDate = new Date(reportedAt.getTime() + slaHours * 3600 * 1000);
        const trackingToken = makeTrackingToken();
        // Auto-assign by category default role (same as logged-in flow)
        let autoAssigneeId = null;
        if (category.defaultAssigneeRoleId) {
            const a = yield prisma_1.prisma.employee.findFirst({
                where: { roleId: category.defaultAssigneeRoleId, employmentStatus: 'ACTIVE' },
                select: { id: true }, orderBy: { id: 'asc' },
            });
            autoAssigneeId = (_b = a === null || a === void 0 ? void 0 : a.id) !== null && _b !== void 0 ? _b : null;
        }
        const incident = yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const created = yield tx.incident.create({
                data: {
                    title: title.trim(),
                    description: description.trim(),
                    categoryId: Number(categoryId),
                    severity: sev,
                    status: 'OPEN',
                    isAnonymous: true, // forced
                    confidentiality: 'STANDARD', // forced — public can't pick MGMT_ONLY
                    requiresRCA: (_a = category.requiresRCAByDefault) !== null && _a !== void 0 ? _a : false,
                    requiresExternalReport: (_b = category.requiresExternalReportByDefault) !== null && _b !== void 0 ? _b : false,
                    incidentDate: incidentDate ? new Date(incidentDate) : reportedAt,
                    reportedAt,
                    location: location !== null && location !== void 0 ? location : null,
                    reportedBy: null, // anonymous
                    assignedTo: autoAssigneeId,
                    dueDate,
                    publicTrackingToken: trackingToken,
                    attachments: Array.isArray(attachments) && attachments.length
                        ? { create: attachments.slice(0, 10).map((a) => {
                                var _a, _b;
                                return ({
                                    fileName: String((_a = a.fileName) !== null && _a !== void 0 ? _a : '').slice(0, 200),
                                    fileUrl: String((_b = a.fileUrl) !== null && _b !== void 0 ? _b : '').slice(0, 500),
                                    uploadedBy: null,
                                });
                            }) }
                        : undefined,
                },
            });
            yield logAudit(tx, created.id, 'CREATED_ANONYMOUS', {
                toValue: 'OPEN',
                note: `Anonymous report from IP ${ip} · UA: ${String(ua).slice(0, 120)}`,
            });
            if (autoAssigneeId) {
                yield logAudit(tx, created.id, 'AUTO_ASSIGNED', {
                    toValue: String(autoAssigneeId),
                    note: `Auto-assigned by category default role`,
                });
            }
            return created;
        }), { timeout: 15000, maxWait: 5000 });
        // Notify the auto-assignee + HR/Mgmt for HIGH/CRITICAL anonymous reports.
        // (Anonymous reports are often sensitive — always pin HR even on MEDIUM.)
        try {
            if (autoAssigneeId) {
                yield (0, notifications_controller_1.createNotification)(autoAssigneeId, `🆕 New ANONYMOUS ${sev} incident assigned to you: "${incident.title}" (${category.name}).`);
            }
            const escalateTo = yield prisma_1.prisma.employee.findMany({
                where: {
                    employmentStatus: 'ACTIVE',
                    OR: [{ departmentId: 1 }, { roleId: 4 }], // HR + management
                },
                select: { id: true },
            });
            const seen = new Set(autoAssigneeId ? [autoAssigneeId] : []);
            for (const e of escalateTo) {
                if (seen.has(e.id))
                    continue;
                seen.add(e.id);
                yield (0, notifications_controller_1.createNotification)(e.id, `🤐 Anonymous incident reported: "${incident.title}" (${category.name}, ${sev}). Review in HR portal.`);
            }
        }
        catch (notifyErr) {
            console.error("[public report notify] failed:", notifyErr);
        }
        // Return the tracking token + a friendly case reference. Don't leak the
        // numeric incident ID — the token is the only pointer the reporter gets.
        res.status(201).json({
            ok: true,
            message: "Your report has been submitted and assigned for review. Please save the tracking token below to follow up.",
            trackingToken,
            caseReference: `INC-${String(incident.id).padStart(6, '0')}`,
        });
    }
    catch (err) {
        console.error("Error submitting public incident:", err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to submit report" });
    }
});
exports.submitPublicIncident = submitPublicIncident;
/**
 * GET /api/incidents/public/track/:token
 * Sanitised follow-up endpoint. Returns ONLY: status, severity, category,
 * outcome, last-update timestamp. Never leaks employee names, internal
 * comments, attachments, or audit logs.
 */
const trackPublicIncident = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const token = String(req.params.token || '').slice(0, 64);
        if (!token)
            return res.status(400).json({ error: "Tracking token required" });
        const incident = yield prisma_1.prisma.incident.findFirst({
            where: { publicTrackingToken: token },
            select: {
                id: true, title: true, status: true, severity: true, outcome: true,
                reportedAt: true, updatedAt: true, closedAt: true,
                category: { select: { name: true } },
            },
        });
        if (!incident)
            return res.status(404).json({ error: "No incident found for this tracking token" });
        res.json({
            caseReference: `INC-${String(incident.id).padStart(6, '0')}`,
            title: incident.title,
            categoryName: (_b = (_a = incident.category) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
            severity: incident.severity,
            status: incident.status,
            outcome: incident.outcome,
            reportedAt: incident.reportedAt,
            lastUpdate: incident.updatedAt,
            closedAt: incident.closedAt,
        });
    }
    catch (err) {
        console.error("Error tracking public incident:", err);
        res.status(500).json({ error: "Failed to look up incident" });
    }
});
exports.trackPublicIncident = trackPublicIncident;
/* ─── Cron-callable: auto-escalation + mandatory-reporting nudge ───── */
/**
 * Daily housekeeping job for incidents.
 *
 * (1) AUTO-ESCALATION
 *     For incidents that:
 *       • are still in flight (status not in terminal set), AND
 *       • have dueDate < now (SLA breached), AND
 *       • have not been escalated in the last 24 hours
 *     We:
 *       • bump severity (MEDIUM → HIGH → CRITICAL; CRITICAL stays)
 *       • flip status to ESCALATED if currently OPEN/ACKNOWLEDGED/INVESTIGATING
 *       • notify HR + Management + the assignee
 *       • stamp lastEscalatedAt so we don't escalate again tomorrow
 *
 * (2) MANDATORY-REPORTING NUDGE
 *     For incidents flagged requiresExternalReport=true and reportedToAuthority=false:
 *       • Notify HR + reviewer (if any) once per day
 *
 * Returns a small summary so the cron runner can log the outcome.
 */
function runIncidentDailyTasks() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
        const TERMINAL = ['CLOSED', 'REJECTED', 'DUPLICATE', 'WITHDRAWN'];
        const SEV_NEXT = { LOW: 'MEDIUM', MEDIUM: 'HIGH', HIGH: 'CRITICAL', CRITICAL: 'CRITICAL' };
        let escalated = 0;
        let nudged = 0;
        // ── (1) Escalation ──────────────────────────────────────────
        try {
            const breaching = yield prisma_1.prisma.incident.findMany({
                where: {
                    status: { notIn: TERMINAL },
                    dueDate: { lt: now },
                    OR: [
                        { lastEscalatedAt: null },
                        { lastEscalatedAt: { lt: dayAgo } },
                    ],
                },
                select: {
                    id: true, title: true, status: true, severity: true,
                    assignedTo: true, dueDate: true,
                    category: { select: { name: true } },
                },
                take: 200,
            });
            if (breaching.length) {
                // Resolve HR + management recipients ONCE for all rows
                const stewards = yield prisma_1.prisma.employee.findMany({
                    where: {
                        employmentStatus: 'ACTIVE',
                        OR: [{ departmentId: 1 }, { roleId: 4 }],
                    },
                    select: { id: true },
                });
                const stewardIds = stewards.map((s) => s.id);
                for (const inc of breaching) {
                    const newSev = SEV_NEXT[inc.severity] || inc.severity;
                    const shouldFlipStatus = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING'].includes(inc.status);
                    const newStatus = shouldFlipStatus ? 'ESCALATED' : inc.status;
                    yield prisma_1.prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                        var _a, _b, _c;
                        yield tx.incident.update({
                            where: { id: inc.id },
                            data: {
                                severity: newSev,
                                status: newStatus,
                                lastEscalatedAt: now,
                            },
                        });
                        if (newSev !== inc.severity) {
                            yield logAudit(tx, inc.id, 'AUTO_ESCALATED_SEVERITY', {
                                fromValue: inc.severity, toValue: newSev,
                                note: `SLA breached on ${(_c = (_b = (_a = inc.dueDate) === null || _a === void 0 ? void 0 : _a.toISOString) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : '—'}`,
                            });
                        }
                        if (newStatus !== inc.status) {
                            yield logAudit(tx, inc.id, 'AUTO_ESCALATED_STATUS', {
                                fromValue: inc.status, toValue: newStatus,
                                note: 'Auto-escalated due to SLA breach',
                            });
                        }
                    }));
                    // Fan-out notifications. Notify the assignee + the steward set,
                    // de-duped against the assignee.
                    const recipients = new Set(stewardIds);
                    if (inc.assignedTo)
                        recipients.add(inc.assignedTo);
                    const overdueDays = Math.max(0, Math.floor((now.getTime() - new Date(inc.dueDate).getTime()) / 86400000));
                    const msg = `🚨 Incident #${inc.id} ("${inc.title}", ${(_b = (_a = inc.category) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : 'category'}) ` +
                        `has been auto-escalated — ${overdueDays} day(s) past SLA. New severity: ${newSev}.`;
                    for (const rid of recipients) {
                        try {
                            yield (0, notifications_controller_1.createNotification)(rid, msg);
                        }
                        catch (e) {
                            console.error(`[incident escalation notify] emp ${rid}:`, e);
                        }
                    }
                    escalated++;
                }
            }
        }
        catch (e) {
            console.error('[incident escalation] failed:', e);
        }
        // ── (2) Mandatory-reporting nudge ───────────────────────────
        try {
            const overdue = yield prisma_1.prisma.incident.findMany({
                where: {
                    requiresExternalReport: true,
                    reportedToAuthority: false,
                    status: { notIn: TERMINAL },
                },
                select: {
                    id: true, title: true, severity: true,
                    category: { select: { name: true } },
                    reviewerEmpId: true,
                },
                take: 100,
            });
            if (overdue.length) {
                const hrAndMgmt = yield prisma_1.prisma.employee.findMany({
                    where: {
                        employmentStatus: 'ACTIVE',
                        OR: [{ departmentId: 1 }, { roleId: 4 }],
                    },
                    select: { id: true },
                });
                const baseRecipientIds = hrAndMgmt.map((e) => e.id);
                for (const inc of overdue) {
                    const recipients = new Set(baseRecipientIds);
                    if (inc.reviewerEmpId)
                        recipients.add(inc.reviewerEmpId);
                    const msg = `📜 Incident #${inc.id} ("${inc.title}", ${(_d = (_c = inc.category) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : 'category'}, ${inc.severity}) ` +
                        `is flagged for mandatory external reporting. No authority report logged yet — please action.`;
                    for (const rid of recipients) {
                        try {
                            yield (0, notifications_controller_1.createNotification)(rid, msg);
                        }
                        catch (e) {
                            console.error(`[incident reporting nudge] emp ${rid}:`, e);
                        }
                    }
                    nudged++;
                }
            }
        }
        catch (e) {
            console.error('[incident reporting nudge] failed:', e);
        }
        if (escalated || nudged) {
            console.log(`[incident cron] escalated=${escalated}, mandatoryReportingNudges=${nudged}`);
        }
        return { escalated, nudged };
    });
}
/** Convenience endpoint — returns the parent + all sibling incidents. */
const getLinkedIncidents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const incident = yield prisma_1.prisma.incident.findUnique({
            where: { id },
            include: {
                parentIncident: {
                    select: { id: true, title: true, status: true, severity: true, reportedAt: true },
                },
                linkedIncidents: {
                    select: { id: true, title: true, status: true, severity: true, reportedAt: true },
                    orderBy: { reportedAt: 'desc' },
                },
            },
        });
        if (!incident)
            return res.status(404).json({ error: "Incident not found" });
        res.json({
            parent: incident.parentIncident, // null when this incident is the root
            children: incident.linkedIncidents, // empty when this incident has no children
        });
    }
    catch (err) {
        console.error("Error fetching linked incidents:", err);
        res.status(500).json({ error: "Failed to load linked incidents" });
    }
});
exports.getLinkedIncidents = getLinkedIncidents;
