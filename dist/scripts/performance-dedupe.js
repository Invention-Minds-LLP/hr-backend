"use strict";
/**
 * One-shot dedupe for PerformanceResponse and PerformanceSummary rows that
 * were duplicated by submitFullForm's createMany loop.
 *
 * Run from hr-backend/:
 *   Dry-run (counts only, no deletes):
 *     npx ts-node src/scripts/performance-dedupe.ts
 *   Destructive (actually delete):
 *     npx ts-node src/scripts/performance-dedupe.ts --apply
 *
 * Strategy: for each (employeeId, cycle, period, questionId) on responses and
 * each (employeeId, cycle, period) on summaries, keep the row with the highest
 * id (latest insert) and delete the rest.
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
const prisma_1 = require("../lib/prisma");
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const apply = process.argv.includes('--apply');
        console.log(apply ? '⚠️  APPLY MODE — rows will be deleted.' : '🔍 DRY RUN — no deletes.');
        const responseDupes = yield prisma_1.prisma.$queryRaw `
    SELECT employeeId, cycle, period, questionId,
           MAX(id) AS keepId, COUNT(*) AS total
    FROM PerformanceResponse
    GROUP BY employeeId, cycle, period, questionId
    HAVING COUNT(*) > 1
  `;
        let respToDelete = 0;
        for (const d of responseDupes)
            respToDelete += Number(d.total) - 1;
        console.log(`PerformanceResponse: ${responseDupes.length} duplicate groups → ${respToDelete} rows to delete`);
        const summaryDupes = yield prisma_1.prisma.$queryRaw `
    SELECT employeeId, cycle, period,
           MAX(id) AS keepId, COUNT(*) AS total
    FROM PerformanceSummary
    GROUP BY employeeId, cycle, period
    HAVING COUNT(*) > 1
  `;
        let summToDelete = 0;
        for (const d of summaryDupes)
            summToDelete += Number(d.total) - 1;
        console.log(`PerformanceSummary:  ${summaryDupes.length} duplicate groups → ${summToDelete} rows to delete`);
        if (!apply) {
            console.log('\nRe-run with --apply to delete.');
            return;
        }
        if (respToDelete === 0 && summToDelete === 0) {
            console.log('Nothing to delete.');
            return;
        }
        let deletedResp = 0;
        for (const d of responseDupes) {
            const r = yield prisma_1.prisma.performanceResponse.deleteMany({
                where: {
                    employeeId: d.employeeId,
                    cycle: d.cycle,
                    period: d.period,
                    questionId: d.questionId,
                    id: { not: d.keepId },
                },
            });
            deletedResp += r.count;
        }
        console.log(`✅ Deleted ${deletedResp} PerformanceResponse rows.`);
        let deletedSumm = 0;
        for (const d of summaryDupes) {
            const r = yield prisma_1.prisma.performanceSummary.deleteMany({
                where: {
                    employeeId: d.employeeId,
                    cycle: d.cycle,
                    period: d.period,
                    id: { not: d.keepId },
                },
            });
            deletedSumm += r.count;
        }
        console.log(`✅ Deleted ${deletedSumm} PerformanceSummary rows.`);
    });
}
main()
    .catch((e) => {
    console.error('❌ Dedupe failed:', e);
    process.exit(1);
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma_1.prisma.$disconnect();
}));
