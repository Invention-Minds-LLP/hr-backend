"use strict";
/**
 * One-shot directory backfill — pushes every active employee from this backend
 * to the central HRMinds directory.
 *
 * Run from the repo root:
 *   npx ts-node src/scripts/directory-backfill.ts
 *
 * Requires .env to have:
 *   DIRECTORY_URL
 *   DIRECTORY_API_KEY
 *
 * Use this for the initial population AFTER deploying the directory and
 * before flipping the unified mobile app live.
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
require("dotenv/config");
const directory_sync_scheduler_1 = require("../schedulers/directory-sync.scheduler");
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!process.env.DIRECTORY_URL || !process.env.DIRECTORY_API_KEY) {
            console.error('❌ DIRECTORY_URL and DIRECTORY_API_KEY must be set in .env');
            process.exit(1);
        }
        console.log('🔄 Pushing all employees to directory...');
        const result = yield (0, directory_sync_scheduler_1.runDirectoryBackfillNow)();
        if (result.ok) {
            console.log('✅ Done:', result.result);
        }
        else {
            console.error('❌ Failed:', result.error);
            process.exit(1);
        }
        process.exit(0);
    });
}
main().catch((e) => {
    console.error('❌ crashed:', e);
    process.exit(1);
});
