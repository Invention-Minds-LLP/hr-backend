"use strict";
/**
 * Applies the Performance* schema changes directly via SQL because
 * `prisma db push` is blocked by an unrelated pre-existing FK drift
 * (ComplaintAcknowledgement_employeeId_fkey).
 *
 * Idempotent — safe to re-run; each statement checks whether the column /
 * index / FK already exists.
 *
 * Run from hr-backend/:
 *   npx ts-node src/scripts/performance-schema-push.ts
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
function columnExists(table, column) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield prisma_1.prisma.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, table, column);
        return Number(rows[0].c) > 0;
    });
}
function indexExists(table, index) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield prisma_1.prisma.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, table, index);
        return Number(rows[0].c) > 0;
    });
}
function fkExists(table, constraint) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield prisma_1.prisma.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'`, table, constraint);
        return Number(rows[0].c) > 0;
    });
}
function run(label, sql) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`→ ${label}`);
        yield prisma_1.prisma.$executeRawUnsafe(sql);
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Applying Performance* schema changes...\n');
        // 1. PerformanceFormTemplate.title (default 'Default' backfills existing)
        if (!(yield columnExists('PerformanceFormTemplate', 'title'))) {
            yield run("Add PerformanceFormTemplate.title", `ALTER TABLE PerformanceFormTemplate
       ADD COLUMN title VARCHAR(191) NOT NULL DEFAULT 'Default'`);
        }
        else {
            console.log('✓ PerformanceFormTemplate.title already exists');
        }
        // 2. Drop unique on (departmentId, cycle)
        if (yield indexExists('PerformanceFormTemplate', 'PerformanceFormTemplate_departmentId_cycle_key')) {
            yield run("Drop unique PerformanceFormTemplate_departmentId_cycle_key", `ALTER TABLE PerformanceFormTemplate
       DROP INDEX PerformanceFormTemplate_departmentId_cycle_key`);
        }
        else {
            console.log('✓ Old unique already absent');
        }
        // 3. Add plain index on (departmentId, cycle)
        if (!(yield indexExists('PerformanceFormTemplate', 'PerformanceFormTemplate_departmentId_cycle_idx'))) {
            yield run("Add index PerformanceFormTemplate_departmentId_cycle_idx", `CREATE INDEX PerformanceFormTemplate_departmentId_cycle_idx
       ON PerformanceFormTemplate(departmentId, cycle)`);
        }
        else {
            console.log('✓ Dept/cycle index already exists');
        }
        // 4. PerformanceSummary.templateId
        if (!(yield columnExists('PerformanceSummary', 'templateId'))) {
            yield run("Add PerformanceSummary.templateId", `ALTER TABLE PerformanceSummary ADD COLUMN templateId INT NULL`);
        }
        else {
            console.log('✓ PerformanceSummary.templateId already exists');
        }
        // 5. FK on templateId
        if (!(yield fkExists('PerformanceSummary', 'PerformanceSummary_templateId_fkey'))) {
            yield run("Add FK PerformanceSummary_templateId_fkey", `ALTER TABLE PerformanceSummary
       ADD CONSTRAINT PerformanceSummary_templateId_fkey
       FOREIGN KEY (templateId) REFERENCES PerformanceFormTemplate(id)
       ON DELETE SET NULL ON UPDATE CASCADE`);
        }
        else {
            console.log('✓ FK already exists');
        }
        // 6. Index on templateId
        if (!(yield indexExists('PerformanceSummary', 'PerformanceSummary_templateId_idx'))) {
            yield run("Add index PerformanceSummary_templateId_idx", `CREATE INDEX PerformanceSummary_templateId_idx
       ON PerformanceSummary(templateId)`);
        }
        else {
            console.log('✓ templateId index already exists');
        }
        // 7. Unique on PerformanceSummary(employeeId, cycle, period, templateId)
        if (!(yield indexExists('PerformanceSummary', 'PerformanceSummary_employeeId_cycle_period_templateId_key'))) {
            yield run("Add unique PerformanceSummary_employeeId_cycle_period_templateId_key", `CREATE UNIQUE INDEX PerformanceSummary_employeeId_cycle_period_templateId_key
       ON PerformanceSummary(employeeId, cycle, period, templateId)`);
        }
        else {
            console.log('✓ Summary unique already exists');
        }
        // 8. Unique on PerformanceResponse(employeeId, cycle, period, questionId)
        if (!(yield indexExists('PerformanceResponse', 'PerformanceResponse_employeeId_cycle_period_questionId_key'))) {
            yield run("Add unique PerformanceResponse_employeeId_cycle_period_questionId_key", `CREATE UNIQUE INDEX PerformanceResponse_employeeId_cycle_period_questionId_key
       ON PerformanceResponse(employeeId, cycle, period, questionId)`);
        }
        else {
            console.log('✓ Response unique already exists');
        }
        console.log('\n✅ Schema sync done.');
    });
}
main()
    .catch((e) => {
    console.error('❌ Schema push failed:', e);
    process.exit(1);
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma_1.prisma.$disconnect();
}));
