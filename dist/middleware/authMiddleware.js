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
exports.requireRoleOrDept = exports.requireRole = exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const employeeAccess_1 = require("../lib/employeeAccess");
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    // Fail fast: a missing/known-default secret means anyone can forge tokens.
    throw new Error("JWT_SECRET is not set. Refusing to start without a signing secret.");
}
/**
 * Authenticate the request and ensure the holder still has system access.
 *
 * Three layers of defence:
 *   1. JWT signature must verify against JWT_SECRET.
 *   2. The employee must currently be in ACTIVE / NOTICE_PERIOD status.
 *   3. The token's `iat` (issued-at) must be ≥ employee.accessRevokedAt
 *      — so revoking access kills every existing token instantly.
 *
 * Candidate-portal tokens (no `empId` claim) bypass employee checks since
 * they aren't backed by an Employee row. They're authenticated only via
 * the JWT signature, which is correct for the candidate flows.
 */
const authenticateToken = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const token = (_a = req.headers['authorization']) === null || _a === void 0 ? void 0 : _a.split(' ')[1];
    if (!token) {
        res.status(401).json({ message: "Unauthorized: No token provided" });
        return;
    }
    let decoded;
    try {
        decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
    }
    catch (error) {
        console.error("JWT verification failed:", error);
        res.status(403).json({ message: "Forbidden: Invalid token" });
        return;
    }
    // Employee-backed tokens have an empId claim. Candidate-portal tokens
    // don't and skip the employment-status / revoke check.
    const empId = Number((_b = decoded === null || decoded === void 0 ? void 0 : decoded.empId) !== null && _b !== void 0 ? _b : 0);
    if (empId > 0) {
        try {
            const access = yield (0, employeeAccess_1.getEmployeeAccess)(empId);
            if (!access.exists) {
                res.status(403).json({ message: "Forbidden: account not found" });
                return;
            }
            if (!access.active) {
                res.status(403).json({
                    message: `Forbidden: account is ${(_d = (_c = access.status) === null || _c === void 0 ? void 0 : _c.toLowerCase()) !== null && _d !== void 0 ? _d : 'inactive'}`,
                });
                return;
            }
            // Compare the token's iat (in seconds) against accessRevokedAt.
            // A token issued BEFORE the revoke timestamp is no longer trusted.
            if (access.accessRevokedAt && typeof decoded.iat === 'number') {
                const tokenIssuedMs = decoded.iat * 1000;
                if (tokenIssuedMs < access.accessRevokedAt.getTime()) {
                    res.status(401).json({ message: "Session expired. Please log in again." });
                    return;
                }
            }
        }
        catch (e) {
            // If the access check itself errors (DB hiccup), we fail-open with a
            // warning rather than locking everyone out. The signature was already
            // verified, so this only widens the existing risk window briefly.
            console.error("[auth] access check failed, allowing request:", e);
        }
    }
    req.user = decoded;
    next();
});
exports.authenticateToken = authenticateToken;
/**
 * Role-based access guard. Use AFTER `authenticateToken`.
 * Accepts either role names ('HR_MANAGER', 'ADMIN', etc.) or numeric roleIds.
 * The JWT payload is expected to include `roleId` and/or `role` (role name).
 *
 * Example:
 *   router.post('/jobs', authenticateToken, requireRole(['HR_MANAGER', 'ADMIN']), createJob);
 */
const requireRole = (allowed) => {
    return (req, res, next) => {
        var _a, _b;
        const user = req.user;
        if (!user) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const userRoleName = String((_b = (_a = user.role) !== null && _a !== void 0 ? _a : user.roleName) !== null && _b !== void 0 ? _b : '').toUpperCase();
        const userRoleId = Number(user.roleId);
        const allowedNames = allowed
            .filter((a) => typeof a === 'string')
            .map((a) => String(a).toUpperCase());
        const allowedIds = allowed.filter((a) => typeof a === 'number');
        if (allowedNames.includes(userRoleName) || allowedIds.includes(userRoleId)) {
            return next();
        }
        return res.status(403).json({ message: "Forbidden: insufficient role" });
    };
};
exports.requireRole = requireRole;
/**
 * Same as `requireRole`, but also lets through users whose `deptId` is in
 * the given department allowlist. Used for "any role in the list, OR anyone
 * in this department" gates — e.g. recruiting endpoints where any HR-dept
 * employee should have access regardless of their role tier.
 *
 * Example:
 *   router.get('/recruiter-dashboard', authenticateToken,
 *     requireRoleOrDept(['HR_MANAGER', 'ADMIN', 1, 4], [1]), handler);
 */
const requireRoleOrDept = (allowedRoles, allowedDepts) => {
    return (req, res, next) => {
        var _a, _b, _c, _d;
        const user = req.user;
        if (!user) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const userRoleName = String((_b = (_a = user.role) !== null && _a !== void 0 ? _a : user.roleName) !== null && _b !== void 0 ? _b : '').toUpperCase();
        const userRoleId = Number(user.roleId);
        const userDeptId = Number((_d = (_c = user.deptId) !== null && _c !== void 0 ? _c : user.departmentId) !== null && _d !== void 0 ? _d : 0);
        const allowedNames = allowedRoles
            .filter((a) => typeof a === 'string')
            .map((a) => String(a).toUpperCase());
        const allowedIds = allowedRoles.filter((a) => typeof a === 'number');
        if (allowedNames.includes(userRoleName) ||
            allowedIds.includes(userRoleId) ||
            (Number.isFinite(userDeptId) && allowedDepts.includes(userDeptId))) {
            return next();
        }
        return res.status(403).json({ message: "Forbidden: insufficient role / department" });
    };
};
exports.requireRoleOrDept = requireRoleOrDept;
