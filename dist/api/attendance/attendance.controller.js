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
exports.getAttendanceCalendar = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const getAttendanceCalendar = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        const month = req.query.month; // e.g. 2025-10
        if (!employeeId || !month)
            return res.status(400).json({ message: 'employeeId and month are required' });
        const start = new Date(`${month}-01T00:00:00`);
        const end = new Date(start);
        end.setMonth(end.getMonth() + 1);
        const [attendance, leaves, permissions] = yield Promise.all([
            prisma.attendance.findMany({
                where: { employeeId, date: { gte: start, lt: end } },
            }),
            prisma.leaveRequest.findMany({
                where: {
                    employeeId,
                    status: 'APPROVED',
                    OR: [
                        { startDate: { gte: start, lt: end } },
                        { endDate: { gte: start, lt: end } },
                    ],
                },
                include: { leaveType: true },
            }),
            prisma.permissionRequest.findMany({
                where: {
                    employeeId,
                    status: 'APPROVED',
                    day: { gte: start, lt: end },
                },
            }),
        ]);
        const result = [
            ...attendance.map(a => ({
                title: `Worked ${a.checkIn && a.checkOut
                    ? Math.round((+new Date(a.checkOut) - +new Date(a.checkIn)) / 3600000)
                    : 0}h`,
                start: a.date,
                type: 'attendance',
            })),
            ...leaves.map(l => {
                var _a, _b;
                return ({
                    title: `Leave (${(_b = (_a = l.leaveType) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : 'Unknown'})`,
                    start: l.startDate,
                    end: l.endDate,
                    type: 'leave',
                });
            }),
            ...permissions.map(p => {
                var _a;
                return ({
                    title: `Permission ${(_a = p.timing) !== null && _a !== void 0 ? _a : ''}`,
                    start: p.day,
                    type: 'permission',
                });
            }),
        ];
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err });
    }
});
exports.getAttendanceCalendar = getAttendanceCalendar;
