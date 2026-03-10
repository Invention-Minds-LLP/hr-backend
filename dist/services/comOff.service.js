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
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCompOffIfEligible = generateCompOffIfEligible;
const prisma_1 = require("../lib/prisma");
function stripTime(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function getWeekOfMonth(date) {
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    const offset = firstDay.getDay(); // weekday of 1st day
    return Math.ceil((date.getDate() + offset) / 7);
}
function isHoliday(date) {
    return __awaiter(this, void 0, void 0, function* () {
        const holiday = yield prisma_1.prisma.holiday.findFirst({
            where: {
                date: stripTime(date)
            }
        });
        return !!holiday;
    });
}
// function isWeeklyOff(date: Date) {
//   // Sunday as default weekly off
//   return date.getDay() === 0;
// }
function isWeeklyOff(employeeId, date) {
    return __awaiter(this, void 0, void 0, function* () {
        const approval = yield prisma_1.prisma.shiftApproval.findFirst({
            where: {
                employeeId,
                status: "APPROVED",
            },
            orderBy: {
                requestedAt: "desc",
            },
            select: {
                weekOffConfig: true,
            },
        });
        // fallback: Sunday
        if (!approval || !approval.weekOffConfig) {
            return date.getDay() === 0;
        }
        const config = approval.weekOffConfig;
        // Rotational weekly off logic
        if (config.weeks) {
            const weekNumber = getWeekOfMonth(date) - 1;
            const offDay = config.weeks[weekNumber];
            console.log(`Rotational Weekly Off - Week ${weekNumber}: Off Day ${offDay}`);
            if (offDay !== undefined) {
                return date.getDay() === offDay;
            }
        }
        // fallback
        return date.getDay() === 0;
    });
}
// export async function generateCompOffIfEligible(attendance: any) {
//   const date = stripTime(new Date(attendance.date));
//   const employeeId = attendance.employeeId;
//   // Only for PRESENT days
//   if (attendance.status !== "PRESENT") return;
//   const holiday = await isHoliday(date);
//   const weeklyOff = isWeeklyOff(date);
//   if (!holiday && !weeklyOff) return;
//   const expiry = new Date(date);
//   expiry.setDate(expiry.getDate() + 30);
// const existing = await prisma.compOffCredit.findFirst({
//   where: {
//     employeeId,
//     workDate: date,
//     used: false
//   }
// });
// if (!existing) {
//   await prisma.compOffCredit.create({
//     data: {
//       employeeId,
//       workDate: date,
//       expiryDate: expiry
//     }
//   });
// }
// }
function generateCompOffIfEligible(attendance) {
    return __awaiter(this, void 0, void 0, function* () {
        const date = stripTime(new Date(attendance.date));
        const employeeId = attendance.employeeId;
        console.log(`Checking comp off eligibility for Employee ${employeeId} on ${date.toDateString()} with status ${attendance.status}`);
        // Only for PRESENT days
        if (attendance.status !== "Present")
            return;
        const holiday = yield isHoliday(date);
        const weeklyOff = yield isWeeklyOff(employeeId, date);
        console.log(`Is Holiday: ${holiday}, Is Weekly Off: ${weeklyOff}`);
        // Not eligible
        if (!holiday && !weeklyOff)
            return;
        const expiry = new Date(date);
        expiry.setDate(expiry.getDate() + 30);
        const existing = yield prisma_1.prisma.compOffCredit.findFirst({
            where: {
                employeeId,
                workDate: date,
                used: false
            }
        });
        if (!existing) {
            yield prisma_1.prisma.compOffCredit.create({
                data: {
                    employeeId,
                    workDate: date,
                    expiryDate: expiry
                }
            });
        }
    });
}
