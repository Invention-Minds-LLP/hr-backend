"use strict";
/**
 * Nightly directory backfill — pushes the entire active employee list to the
 * central directory service. Acts as a safety net for any real-time sync that
 * may have failed (network blip, directory briefly down, manual DB edits).
 *
 * Runs at 02:30 every day. Configurable via env: DIRECTORY_SYNC_CRON.
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
exports.initDirectorySyncCron = initDirectorySyncCron;
exports.runDirectoryBackfillNow = runDirectoryBackfillNow;
const node_cron_1 = __importDefault(require("node-cron"));
const client_1 = require("@prisma/client");
const directory_1 = require("../lib/directory");
const config_1 = require("../config");
const prisma = new client_1.PrismaClient();
const SCHEDULE = config_1.config.directory.syncCron || '30 2 * * *';
function initDirectorySyncCron() {
    if (!config_1.config.directory.url || !config_1.config.directory.apiKey) {
        console.log('[directory-sync] DIRECTORY_URL or DIRECTORY_API_KEY not set — nightly cron disabled');
        return;
    }
    node_cron_1.default.schedule(SCHEDULE, () => __awaiter(this, void 0, void 0, function* () {
        console.log('[directory-sync] starting nightly backfill...');
        try {
            const employees = yield prisma.employee.findMany({
                where: { phone: { not: '' } },
                select: {
                    phone: true,
                    employeeCode: true,
                    firstName: true,
                    lastName: true,
                    // Treat employees without an employmentStatus = TERMINATED as active.
                    // Adjust if your schema uses a different "active" indicator.
                    employmentStatus: true,
                },
            });
            const payload = employees.map((e) => ({
                phone: e.phone,
                employeeCode: e.employeeCode,
                firstName: e.firstName,
                lastName: e.lastName,
                isActive: e.employmentStatus !== 'TERMINATED' && e.employmentStatus !== 'RESIGNED',
            }));
            const result = yield (0, directory_1.syncBulkToDirectory)(payload);
            if (result.ok) {
                console.log('[directory-sync] nightly OK:', result.result);
            }
            else {
                console.error('[directory-sync] nightly FAILED:', result.error);
            }
        }
        catch (err) {
            console.error('[directory-sync] nightly cron crashed:', err === null || err === void 0 ? void 0 : err.message);
        }
    }));
    console.log(`[directory-sync] nightly cron registered (${SCHEDULE})`);
}
/** Run the backfill once, immediately. Call from `npm run sync:directory` or admin endpoint. */
function runDirectoryBackfillNow() {
    return __awaiter(this, void 0, void 0, function* () {
        const employees = yield prisma.employee.findMany({
            where: { phone: { not: '' } },
            select: {
                phone: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                employmentStatus: true,
            },
        });
        const payload = employees.map((e) => ({
            phone: e.phone,
            employeeCode: e.employeeCode,
            firstName: e.firstName,
            lastName: e.lastName,
            isActive: e.employmentStatus !== 'TERMINATED' && e.employmentStatus !== 'RESIGNED',
        }));
        return (0, directory_1.syncBulkToDirectory)(payload);
    });
}
