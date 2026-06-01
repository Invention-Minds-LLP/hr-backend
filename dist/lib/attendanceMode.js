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
exports.resolveAttendanceMode = resolveAttendanceMode;
exports.getEffectiveAttendanceMode = getEffectiveAttendanceMode;
const client_1 = require("@prisma/client");
const prisma_1 = require("./prisma");
/**
 * Resolve an employee's EFFECTIVE attendance mode.
 *
 * Precedence: employee.attendanceMode (per-employee override) ?? the employee's
 * Branch.attendanceMode ?? 'MOBILE'. A null employee value means "inherit branch".
 */
function resolveAttendanceMode(input) {
    var _a, _b, _c;
    return (_c = (_a = input.attendanceMode) !== null && _a !== void 0 ? _a : (_b = input.Branch) === null || _b === void 0 ? void 0 : _b.attendanceMode) !== null && _c !== void 0 ? _c : client_1.AttendanceMode.MOBILE;
}
/** Fetch an employee + branch mode and return the effective attendance mode. */
function getEffectiveAttendanceMode(employeeId) {
    return __awaiter(this, void 0, void 0, function* () {
        const employee = yield prisma_1.prisma.employee.findUnique({
            where: { id: employeeId },
            select: { attendanceMode: true, Branch: { select: { attendanceMode: true } } },
        });
        if (!employee)
            return client_1.AttendanceMode.MOBILE;
        return resolveAttendanceMode(employee);
    });
}
