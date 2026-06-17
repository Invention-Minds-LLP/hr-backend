"use strict";
/**
 * HRMinds Directory client
 * ==========================
 * Pushes phone-number → tenant entries to the central directory service so the
 * unified mobile app can route users to the correct backend after a phone lookup.
 *
 * The directory is a separate service. Failures here MUST NOT break employee
 * operations — they're logged and reconciled by the nightly cron in
 * `src/schedulers/scheduler.ts`.
 *
 * Required environment variables:
 *   DIRECTORY_URL      e.g. https://hrmindsdirectory.imapps.in
 *   DIRECTORY_API_KEY  the tenant API key issued when this tenant was created
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncEmployeeToDirectory = syncEmployeeToDirectory;
exports.syncBulkToDirectory = syncBulkToDirectory;
exports.deactivateEmployeeInDirectory = deactivateEmployeeInDirectory;
exports.pingDirectory = pingDirectory;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const DIRECTORY_URL = config_1.config.directory.url.replace(/\/$/, '');
const DIRECTORY_API_KEY = config_1.config.directory.apiKey;
let client = null;
function getClient() {
    if (!DIRECTORY_URL || !DIRECTORY_API_KEY)
        return null;
    if (!client) {
        client = axios_1.default.create({
            baseURL: `${DIRECTORY_URL}/api/directory/sync`,
            headers: { 'x-tenant-key': DIRECTORY_API_KEY },
            timeout: 5000,
        });
    }
    return client;
}
/**
 * Push a single employee to the directory. Safe to call after create OR update.
 * Silently no-ops if the employee has no phone or directory env vars are missing.
 */
function syncEmployeeToDirectory(employee) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const c = getClient();
        if (!c)
            return;
        if (!(employee === null || employee === void 0 ? void 0 : employee.phone))
            return;
        const fullName = [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim() || null;
        try {
            yield c.post('/upsert', {
                phone: employee.phone,
                employeeCode: (_a = employee.employeeCode) !== null && _a !== void 0 ? _a : null,
                fullName,
                isActive: (_b = employee.isActive) !== null && _b !== void 0 ? _b : true,
            });
        }
        catch (err) {
            console.error('[directory-sync] upsert failed:', err === null || err === void 0 ? void 0 : err.message);
        }
    });
}
/** Bulk push (recommended for nightly cron). */
function syncBulkToDirectory(employees) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const c = getClient();
        if (!c)
            return { ok: false, error: 'directory not configured' };
        const entries = employees
            .filter((e) => e.phone)
            .map((e) => {
            var _a, _b;
            return ({
                phone: e.phone,
                employeeCode: (_a = e.employeeCode) !== null && _a !== void 0 ? _a : null,
                fullName: [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || null,
                isActive: (_b = e.isActive) !== null && _b !== void 0 ? _b : true,
            });
        });
        try {
            const res = yield c.post('/bulk', { entries });
            return { ok: true, result: res.data };
        }
        catch (err) {
            return { ok: false, error: (_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : 'unknown' };
        }
    });
}
/** Mark an employee as inactive in the directory (use when they leave). */
function deactivateEmployeeInDirectory(phone) {
    return __awaiter(this, void 0, void 0, function* () {
        const c = getClient();
        if (!c)
            return;
        if (!phone)
            return;
        try {
            yield c.delete('/entry', { data: { phone } });
        }
        catch (err) {
            console.error('[directory-sync] deactivate failed:', err === null || err === void 0 ? void 0 : err.message);
        }
    });
}
/** Self-test: verify the API key works. Useful for /health checks. */
function pingDirectory() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const c = getClient();
        if (!c)
            return { ok: false, error: 'directory not configured' };
        try {
            const res = yield c.get('/me');
            return { ok: true, data: res.data };
        }
        catch (err) {
            return { ok: false, error: (_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : 'unknown' };
        }
    });
}
