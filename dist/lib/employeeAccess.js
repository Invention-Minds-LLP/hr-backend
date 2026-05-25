"use strict";
/**
 * Employee Access Control
 * ────────────────────────
 * Centralised helpers used by:
 *   • authMiddleware.ts          — to gate every authenticated request
 *   • notifications.controller   — to silently skip inactive recipients
 *   • resignation cron           — to invalidate sessions when status flips
 *
 * The contract: an employee has SYSTEM ACCESS only if they are in
 * `ACTIVE` or `NOTICE_PERIOD` AND their `accessRevokedAt` (if set) is
 * NOT in the future of the token's issued-at time.
 *
 * Status semantics:
 *   ACTIVE / NOTICE_PERIOD  →  full access
 *   RESIGNED / TERMINATED / SUSPENDED / SABBATICAL  →  blocked
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
exports.getEmployeeAccess = getEmployeeAccess;
exports.isEmployeeActiveForAccess = isEmployeeActiveForAccess;
exports.invalidateAccessCache = invalidateAccessCache;
exports.revokeEmployeeAccess = revokeEmployeeAccess;
const prisma_1 = require("./prisma");
// Tiny in-memory cache so we don't hit the DB on every authenticated request.
// 60 second TTL is short enough that revoke-on-fire propagates quickly.
const ACCESS_CACHE_TTL_MS = 60 * 1000;
const accessCache = new Map();
const ACTIVE_STATUSES = new Set(['ACTIVE', 'NOTICE_PERIOD']);
/** Read employee access state. Cached for ACCESS_CACHE_TTL_MS. */
function getEmployeeAccess(employeeId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (!Number.isFinite(employeeId) || employeeId <= 0) {
            return { exists: false, active: false, status: null, accessRevokedAt: null };
        }
        const cached = accessCache.get(employeeId);
        if (cached && cached.expires > Date.now())
            return cached.value;
        const emp = yield prisma_1.prisma.employee.findUnique({
            where: { id: employeeId },
            select: { id: true, employmentStatus: true, accessRevokedAt: true },
        });
        const value = emp
            ? {
                exists: true,
                active: ACTIVE_STATUSES.has(String(emp.employmentStatus)),
                status: String((_a = emp.employmentStatus) !== null && _a !== void 0 ? _a : null),
                accessRevokedAt: (_b = emp.accessRevokedAt) !== null && _b !== void 0 ? _b : null,
            }
            : { exists: false, active: false, status: null, accessRevokedAt: null };
        accessCache.set(employeeId, { value, expires: Date.now() + ACCESS_CACHE_TTL_MS });
        return value;
    });
}
/** Quick boolean shortcut. */
function isEmployeeActiveForAccess(employeeId) {
    return __awaiter(this, void 0, void 0, function* () {
        const a = yield getEmployeeAccess(employeeId);
        return a.active;
    });
}
/** Force the cache to forget an employee (called by `revokeEmployeeAccess`). */
function invalidateAccessCache(employeeId) {
    if (employeeId === undefined)
        accessCache.clear();
    else
        accessCache.delete(employeeId);
}
/**
 * Revoke ALL access for an employee. Called when:
 *   • Resignation cron flips their status to RESIGNED
 *   • HR manually terminates / suspends them
 *
 * Side effects (each isolated in its own try/catch — one failure must not
 * stop the rest):
 *   1. Delete DeviceToken rows  → no more mobile push
 *   2. Delete MobileAuthSession → mobile app forced to re-authenticate
 *   3. Stamp accessRevokedAt = now → existing JWTs (browser) become invalid
 *      because the auth middleware compares decoded.iat against this.
 *   4. Invalidate the in-memory cache so the next request sees the change.
 */
function revokeEmployeeAccess(employeeId, reason) {
    return __awaiter(this, void 0, void 0, function* () {
        const summary = { tokensDeleted: 0, sessionsDeleted: 0 };
        console.log(`[access] revoking access for employee ${employeeId}${reason ? ` — ${reason}` : ''}`);
        // 1. Wipe FCM device tokens so push notifications stop immediately.
        try {
            const r = yield prisma_1.prisma.deviceToken.deleteMany({ where: { employeeId } });
            summary.tokensDeleted = r.count;
        }
        catch (e) {
            console.error(`[access] DeviceToken cleanup failed for emp ${employeeId}:`, e);
        }
        // 2. Wipe mobile auth sessions so the mobile app boots back to login.
        try {
            const r = yield prisma_1.prisma.mobileAuthSession.deleteMany({ where: { employeeId } });
            summary.sessionsDeleted = r.count;
        }
        catch (e) {
            console.error(`[access] MobileAuthSession cleanup failed for emp ${employeeId}:`, e);
        }
        // 3. Stamp the revoke timestamp so authenticateToken can refuse old JWTs.
        try {
            yield prisma_1.prisma.employee.update({
                where: { id: employeeId },
                data: { accessRevokedAt: new Date() },
            });
        }
        catch (e) {
            console.error(`[access] accessRevokedAt update failed for emp ${employeeId}:`, e);
        }
        // 4. Bust the cache so the next authenticated request actually sees the
        //    new state without waiting for the 60s TTL.
        invalidateAccessCache(employeeId);
        console.log(`[access] employee ${employeeId} revoked: ` +
            `${summary.tokensDeleted} push token(s) deleted, ` +
            `${summary.sessionsDeleted} mobile session(s) deleted.`);
        return summary;
    });
}
