"use strict";
/**
 * Leave DOJ backfill (CL & SL) — report + safe apply.
 *
 * Purpose: existing employees whose CL/SL was credited based on the PROBATION
 * end date (legacy behavior) need their balance recomputed from the Date of
 * Joining (DOJ), per the leave policy. This script reports the difference and
 * can apply the clean cases.
 *
 * Run from hr-backend/ :
 *   Dry-run (report only), specific employees:
 *     npx ts-node src/scripts/leave-doj-backfill.ts 123 456
 *   Dry-run, all active employees:
 *     npx ts-node src/scripts/leave-doj-backfill.ts --all
 *   Apply (allocate the CLEAN-ALLOCATE rows):
 *     npx ts-node src/scripts/leave-doj-backfill.ts 123 456 --apply
 *
 * Safety:
 *   - DRY-RUN by default. Nothing is written unless --apply is passed.
 *   - Only "CLEAN-ALLOCATE" rows (current-FY joiner, no existing SYSTEM
 *     OPENING_BALANCE for the FY) are allocated on --apply.
 *   - "NEEDS-MANUAL-ADJ" rows (already have a system opening balance) are NOT
 *     touched — correct them via the Manual Leave Balance Adjustment option so
 *     the existing ledger history is preserved.
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
const leave_controller_1 = require("../api/leave/leave.controller");
function getLeaveTypeId(name) {
    return __awaiter(this, void 0, void 0, function* () {
        const lt = yield prisma_1.prisma.leaveType.findFirst({ where: { name } });
        if (!lt)
            throw new Error(`Leave type "${name}" not found`);
        return lt.id;
    });
}
function currentBalance(employeeId, leaveTypeId, year) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const last = yield prisma_1.prisma.leaveLedger.findFirst({
            where: { employeeId, leaveTypeId, year },
            orderBy: { id: 'desc' },
            select: { balanceAfter: true },
        });
        return (_a = last === null || last === void 0 ? void 0 : last.balanceAfter) !== null && _a !== void 0 ? _a : null;
    });
}
function hasSystemOpening(employeeId, leaveTypeId, year) {
    return __awaiter(this, void 0, void 0, function* () {
        const row = yield prisma_1.prisma.leaveLedger.findFirst({
            where: { employeeId, leaveTypeId, year, action: 'OPENING_BALANCE', source: 'SYSTEM' },
            select: { id: true },
        });
        return !!row;
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const args = process.argv.slice(2);
        const apply = args.includes('--apply');
        const all = args.includes('--all');
        const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);
        if (!all && ids.length === 0) {
            console.error('Usage: ts-node src/scripts/leave-doj-backfill.ts <empId...> [--apply]');
            console.error('   or: ts-node src/scripts/leave-doj-backfill.ts --all [--apply]');
            process.exit(1);
        }
        const today = new Date();
        const currentFY = (0, leave_controller_1.getFinancialYear)(today);
        const clId = yield getLeaveTypeId('CL');
        const slId = yield getLeaveTypeId('SL');
        const employees = yield prisma_1.prisma.employee.findMany({
            where: Object.assign({ employmentStatus: 'ACTIVE' }, (all ? {} : { id: { in: ids } })),
            select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                dateOfJoining: true,
            },
            orderBy: { id: 'asc' },
        });
        console.log(`\nLeave DOJ backfill — FY ${currentFY}, mode=${apply ? 'APPLY' : 'DRY-RUN'}, ` +
            `${employees.length} employee(s)\n`);
        const cleanToApply = [];
        for (const emp of employees) {
            const doj = new Date(emp.dateOfJoining);
            const joinFY = (0, leave_controller_1.getFinancialYear)(doj);
            // Target for the current FY: prorated from DOJ if they joined this FY,
            // otherwise a full year (earlier joiners should already be on the rollover).
            let targetCL;
            let targetSL;
            if (joinFY === currentFY) {
                const ent = (0, leave_controller_1.getNewJoineeEntitlement)(doj);
                targetCL = ent.cl;
                targetSL = ent.sl;
            }
            else {
                targetCL = 12;
                targetSL = 12;
            }
            const [curCL, curSL, openCL, openSL] = yield Promise.all([
                currentBalance(emp.id, clId, currentFY),
                currentBalance(emp.id, slId, currentFY),
                hasSystemOpening(emp.id, clId, currentFY),
                hasSystemOpening(emp.id, slId, currentFY),
            ]);
            const name = `${(_a = emp.firstName) !== null && _a !== void 0 ? _a : ''} ${(_b = emp.lastName) !== null && _b !== void 0 ? _b : ''}`.trim();
            const alreadyAllocated = openCL || openSL;
            const cleanCase = !alreadyAllocated && joinFY === currentFY;
            const status = alreadyAllocated
                ? 'NEEDS-MANUAL-ADJ'
                : cleanCase
                    ? 'CLEAN-ALLOCATE'
                    : 'REVIEW';
            console.log(`#${emp.id} ${(_c = emp.employeeCode) !== null && _c !== void 0 ? _c : '-'} ${name} | DOJ ${doj.toISOString().slice(0, 10)} | ` +
                `CL ${curCL !== null && curCL !== void 0 ? curCL : '-'}→${targetCL} | SL ${curSL !== null && curSL !== void 0 ? curSL : '-'}→${targetSL} | ${status}`);
            if (cleanCase)
                cleanToApply.push({ id: emp.id, doj });
        }
        if (apply) {
            console.log(`\nApplying clean allocations for ${cleanToApply.length} employee(s)...`);
            for (const e of cleanToApply) {
                const r = yield (0, leave_controller_1.allocateNewJoineeLeave)(e.id, e.doj);
                console.log(`  ✅ emp ${e.id}: CL=${r.cl} SL=${r.sl}`);
            }
            console.log('\nNEEDS-MANUAL-ADJ / REVIEW employees were NOT modified. Correct them via the ' +
                'Manual Leave Balance Adjustment option so existing ledger history is preserved.');
        }
        else {
            console.log(`\nDRY-RUN only. ${cleanToApply.length} employee(s) would be allocated on --apply. ` +
                'No data was changed.');
        }
        yield prisma_1.prisma.$disconnect();
        process.exit(0);
    });
}
main().catch((e) => {
    console.error('crashed:', e);
    process.exit(1);
});
