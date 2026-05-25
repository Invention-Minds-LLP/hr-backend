"use strict";
/**
 * Employee audit-trail helpers.
 *
 * Every write to the Employee table SHOULD go through one of the helpers
 * below so the change is recorded in EmployeeAuditLog. Going around them
 * (calling prisma.employee.update directly) means the change won't show
 * up in HR's edit-history view — which is the whole point of the module.
 *
 * Usage:
 *   await updateEmployeeWithAudit({
 *     employeeId,
 *     data: { designation: 'Senior Eng', salary: 800000 },
 *     changedBy: req.user.empId,
 *     reason: 'Annual cycle promotion',
 *     source: 'PROMOTION',
 *     causedByPromotionId: promotion.id,
 *     ip: req.ip,
 *     userAgent: req.get('user-agent'),
 *   });
 */
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
exports.buildEmployeeDiff = buildEmployeeDiff;
exports.updateEmployeeWithAudit = updateEmployeeWithAudit;
exports.createEmployeeWithAudit = createEmployeeWithAudit;
exports.deleteEmployeeWithAudit = deleteEmployeeWithAudit;
exports.auditCtxFromReq = auditCtxFromReq;
const prisma_1 = require("./prisma");
/** Fields we never want in the audit diff (timestamps, internal cache, secrets, FK noise). */
const IGNORED_FIELDS = new Set([
    'createdAt', 'updatedAt',
    'accessRevokedAt', // session metadata, not employee data
    'healthCheckReminderSent', 'healthCheckReminderYear',
]);
/* ── Diff helper ─────────────────────────────────────────────── */
/**
 * Build a JSON diff of the form { field: { from, to } } between `before`
 * and `after`. Only fields whose value actually changed (deep-ish equality
 * via JSON.stringify) are included. Returns `null` if nothing changed.
 */
function buildEmployeeDiff(before, after) {
    const changes = {};
    const fields = new Set([...Object.keys(before !== null && before !== void 0 ? before : {}), ...Object.keys(after !== null && after !== void 0 ? after : {})]);
    for (const f of fields) {
        if (IGNORED_FIELDS.has(f))
            continue;
        const a = before === null || before === void 0 ? void 0 : before[f];
        const b = after === null || after === void 0 ? void 0 : after[f];
        // Treat null/undefined as the same; compare dates by ms; everything else by JSON
        const norm = (v) => v == null ? null
            : v instanceof Date ? v.getTime()
                : typeof v === 'object' ? JSON.stringify(v)
                    : v;
        if (norm(a) !== norm(b)) {
            changes[f] = { from: a !== null && a !== void 0 ? a : null, to: b !== null && b !== void 0 ? b : null };
        }
    }
    const changedFields = Object.keys(changes);
    if (changedFields.length === 0)
        return null;
    return { changes, changedFields };
}
/* ── Helpers ─────────────────────────────────────────────────── */
function writeAuditRow(tx, args) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        yield tx.employeeAuditLog.create({
            data: {
                employeeId: args.employeeId,
                action: args.action,
                changes: (_a = args.changes) !== null && _a !== void 0 ? _a : null,
                changedFields: (_b = args.changedFields) !== null && _b !== void 0 ? _b : null,
                changedBy: (_c = args.changedBy) !== null && _c !== void 0 ? _c : null,
                reason: (_d = args.reason) !== null && _d !== void 0 ? _d : null,
                source: (_e = args.source) !== null && _e !== void 0 ? _e : 'WEB',
                causedByPromotionId: (_f = args.causedByPromotionId) !== null && _f !== void 0 ? _f : null,
                causedByResignationId: (_g = args.causedByResignationId) !== null && _g !== void 0 ? _g : null,
                causedByOnboardingId: (_h = args.causedByOnboardingId) !== null && _h !== void 0 ? _h : null,
                ipAddress: (_j = args.ip) !== null && _j !== void 0 ? _j : null,
                userAgent: (_k = args.userAgent) !== null && _k !== void 0 ? _k : null,
            },
        });
    });
}
/* ── Public API ──────────────────────────────────────────────── */
/**
 * Update an employee + write an audit row in a single transaction.
 * If nothing actually changed, the update is skipped (no audit row written).
 */
function updateEmployeeWithAudit(args) {
    return __awaiter(this, void 0, void 0, function* () {
        const run = (tx) => __awaiter(this, void 0, void 0, function* () {
            const before = yield tx.employee.findUnique({ where: { id: args.employeeId } });
            if (!before) {
                throw new Error(`Employee #${args.employeeId} not found`);
            }
            const after = yield tx.employee.update({
                where: { id: args.employeeId },
                data: args.data,
            });
            const diff = buildEmployeeDiff(before, after);
            if (diff) {
                yield writeAuditRow(tx, Object.assign(Object.assign({}, args), { action: 'UPDATE', changes: diff.changes, changedFields: diff.changedFields }));
            }
            return after;
        });
        return args.tx ? run(args.tx) : prisma_1.prisma.$transaction(run, { timeout: 15000 });
    });
}
/** Create an employee + log it. */
function createEmployeeWithAudit(args) {
    return __awaiter(this, void 0, void 0, function* () {
        const run = (tx) => __awaiter(this, void 0, void 0, function* () {
            const created = yield tx.employee.create({ data: args.data });
            yield writeAuditRow(tx, Object.assign(Object.assign({}, args), { employeeId: created.id, action: 'CREATE', changes: created, changedFields: Object.keys(created).filter((k) => !IGNORED_FIELDS.has(k)) }));
            return created;
        });
        return args.tx ? run(args.tx) : prisma_1.prisma.$transaction(run, { timeout: 15000 });
    });
}
/** Delete an employee + log the prior row so we can replay later. */
function deleteEmployeeWithAudit(args) {
    return __awaiter(this, void 0, void 0, function* () {
        const run = (tx) => __awaiter(this, void 0, void 0, function* () {
            const before = yield tx.employee.findUnique({ where: { id: args.employeeId } });
            if (!before)
                return null;
            yield tx.employee.delete({ where: { id: args.employeeId } });
            yield writeAuditRow(tx, Object.assign(Object.assign({}, args), { action: 'DELETE', changes: before, changedFields: Object.keys(before).filter((k) => !IGNORED_FIELDS.has(k)) }));
            return before;
        });
        return args.tx ? run(args.tx) : prisma_1.prisma.$transaction(run, { timeout: 15000 });
    });
}
/**
 * Convenience: derive the AuditContext bits from an Express request.
 * Use this so you don't have to spell out ip/userAgent everywhere.
 */
function auditCtxFromReq(req, extras = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    return {
        changedBy: (_d = (_b = (_a = req === null || req === void 0 ? void 0 : req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : (_c = req === null || req === void 0 ? void 0 : req.user) === null || _c === void 0 ? void 0 : _c.userId) !== null && _d !== void 0 ? _d : null,
        reason: (_e = extras.reason) !== null && _e !== void 0 ? _e : null,
        source: (_f = extras.source) !== null && _f !== void 0 ? _f : 'WEB',
        causedByPromotionId: (_g = extras.causedByPromotionId) !== null && _g !== void 0 ? _g : null,
        causedByResignationId: (_h = extras.causedByResignationId) !== null && _h !== void 0 ? _h : null,
        causedByOnboardingId: (_j = extras.causedByOnboardingId) !== null && _j !== void 0 ? _j : null,
        ip: (_m = (_k = req === null || req === void 0 ? void 0 : req.ip) !== null && _k !== void 0 ? _k : (_l = req === null || req === void 0 ? void 0 : req.socket) === null || _l === void 0 ? void 0 : _l.remoteAddress) !== null && _m !== void 0 ? _m : null,
        userAgent: (_p = (_o = req === null || req === void 0 ? void 0 : req.get) === null || _o === void 0 ? void 0 : _o.call(req, 'user-agent')) !== null && _p !== void 0 ? _p : null,
    };
}
