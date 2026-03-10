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
exports.getMonthlyAttendanceRegister = exports.getAttendanceHistory = exports.getTodayAttendanceList = exports.approveAttendance = exports.getWeeklyAttendance = exports.getAttendanceCalendar = void 0;
const prisma_1 = require("../../lib/prisma");
const getAttendanceCalendar = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        const month = req.query.month; // e.g. 2025-10
        if (!employeeId || !month)
            return res.status(400).json({ message: 'employeeId and month are required' });
        const start = new Date(`${month}-01T00:00:00`);
        const end = new Date(start);
        end.setMonth(end.getMonth() + 1);
        const [attendance, leaves, permissions, shiftSettings] = yield Promise.all([
            prisma_1.prisma.attendance.findMany({
                where: { employeeId, date: { gte: start, lt: end } },
            }),
            prisma_1.prisma.leaveRequest.findMany({
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
            prisma_1.prisma.permissionRequest.findMany({
                where: {
                    employeeId,
                    status: 'APPROVED',
                    day: { gte: start, lt: end },
                },
            }),
            prisma_1.prisma.employeeShiftSetting.findMany({
                where: { employeeId },
                include: {
                    fixedShift: true,
                    rotationPattern: {
                        include: {
                            items: { include: { shift: true } }
                        }
                    }
                }
            })
        ]);
        const approvedMonthlyShift = yield prisma_1.prisma.shiftApproval.findFirst({
            where: {
                employeeId,
                status: 'APPROVED',
                requestedMode: 'ROTATIONAL',
                pattern: {
                    source: 'MONTHLY',
                    month: start.getMonth() + 1,
                    year: start.getFullYear()
                }
            },
            select: {
                weekOffConfig: true
            }
        });
        const approvedWeekOffDates = new Set();
        // if (approvedMonthlyShift?.weekOffConfig?.weeks) {
        //   const firstWeekStart = new Date(start);
        //   firstWeekStart.setDate(start.getDate() - start.getDay()); // Sunday
        //   Object.entries(approvedMonthlyShift.weekOffConfig.weeks).forEach(
        //     ([weekIndexStr, dayOfWeek]) => {
        //       const weekIndex = Number(weekIndexStr);
        //       const date = new Date(firstWeekStart);
        //       date.setDate(
        //         firstWeekStart.getDate() + weekIndex * 7 + Number(dayOfWeek)
        //       );
        //       if (date >= start && date < end) {
        //         approvedWeekOffDates.add(date.toISOString().slice(0, 10));
        //       }
        //     }
        //   );
        // }
        const weekOffConfig = approvedMonthlyShift === null || approvedMonthlyShift === void 0 ? void 0 : approvedMonthlyShift.weekOffConfig;
        if (weekOffConfig === null || weekOffConfig === void 0 ? void 0 : weekOffConfig.weeks) {
            const firstWeekStart = new Date(start);
            firstWeekStart.setDate(start.getDate() - start.getDay()); // Sunday
            firstWeekStart.setHours(0, 0, 0, 0);
            Object.entries(weekOffConfig.weeks).forEach(([weekIndexStr, dayOfWeek]) => {
                const weekIndex = Number(weekIndexStr);
                if (Number.isNaN(weekIndex) ||
                    typeof dayOfWeek !== 'number') {
                    return;
                }
                const date = new Date(firstWeekStart);
                date.setDate(firstWeekStart.getDate() + weekIndex * 7 + dayOfWeek);
                if (date >= start && date < end) {
                    approvedWeekOffDates.add(date.toISOString().slice(0, 10));
                }
            });
        }
        // console.log('Attendance records:', attendance);
        const shiftMap = buildShiftMap(shiftSettings, start);
        const result = [];
        // Attendance
        attendance.forEach(a => {
            const checkIn = a.checkIn ? new Date(a.checkIn) : null;
            const checkOut = a.checkOut ? new Date(a.checkOut) : null;
            const shift = shiftMap.get(a.employeeId);
            const shiftStart = (shift === null || shift === void 0 ? void 0 : shift.start) || null;
            const shiftEnd = (shift === null || shift === void 0 ? void 0 : shift.end) || null;
            const hours = checkIn && checkOut
                ? Math.round((checkOut.getTime() - checkIn.getTime()) / 3600000)
                : 0;
            let flag = null;
            if (checkIn && shiftStart && checkIn > shiftStart)
                flag = 'late-login';
            if (checkOut && shiftEnd && checkOut < shiftEnd)
                flag = flag ? `${flag},early-logout` : 'early-logout';
            if (hours > 0 && hours < 4)
                flag = 'half-day';
            let finalStatus = a.status;
            // if (flag) {
            //   if (!a.attendanceApproval) finalStatus = 'PendingApproval';
            //   else if (a.attendanceApproval === 'APPROVED') finalStatus = 'Present';
            //   else if (a.attendanceApproval === 'REJECTED') finalStatus = 'Absent';
            // }
            if (a.attendanceApproval === 'FORCE_PRESENT') {
                finalStatus = 'Present';
            }
            else if (flag) {
                if (!a.attendanceApproval)
                    finalStatus = 'PendingApproval';
                else if (a.attendanceApproval === 'APPROVED')
                    finalStatus = 'Present';
                else if (a.attendanceApproval === 'REJECTED')
                    finalStatus = 'Absent';
            }
            result.push({
                title: `Worked ${hours}h`,
                start: a.date,
                type: 'attendance',
                status: a.status,
                checkIn: a.checkIn,
                checkOut: a.checkOut,
                hours,
                flag,
                finalStatus,
                needsApproval: !!flag && a.attendanceApproval === null,
                attendanceId: a.id,
            });
        });
        // Leaves
        leaves.forEach(l => {
            var _a, _b;
            let current = new Date(l.startDate);
            const endDate = new Date(l.endDate);
            while (current <= endDate) {
                result.push({
                    title: `Leave (${(_b = (_a = l.leaveType) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : 'Leave'})`,
                    start: new Date(current),
                    type: 'leave',
                });
                current.setDate(current.getDate() + 1);
            }
        });
        // Permissions
        permissions.forEach(p => {
            var _a;
            result.push({
                title: `Permission ${(_a = p.timing) !== null && _a !== void 0 ? _a : ''}`,
                start: p.day,
                type: 'permission',
            });
        });
        /* ---------------------------------------
           6️⃣ WEEK OFF EVENTS (IMPORTANT PART)
        --------------------------------------- */
        let cursor = new Date(start);
        while (cursor < end) {
            const iso = cursor.toISOString().slice(0, 10);
            if (approvedWeekOffDates.size > 0) {
                // ✅ Approved month → ONLY approved week-offs
                if (approvedWeekOffDates.has(iso)) {
                    result.push({
                        title: 'Week Off',
                        start: new Date(cursor),
                        type: 'weekoff',
                        approved: true
                    });
                }
            }
            else {
                // ❌ Not approved → Sunday fallback
                if (cursor.getDay() === 0) {
                    result.push({
                        title: 'Week Off',
                        start: new Date(cursor),
                        type: 'weekoff',
                        approved: false
                    });
                }
            }
            cursor.setDate(cursor.getDate() + 1);
        }
        // const result = [
        //   ...attendance.map(a => {
        //     const checkIn = a.checkIn ? new Date(a.checkIn) : null;
        //     const checkOut = a.checkOut ? new Date(a.checkOut) : null;
        //     const shift = shiftMap.get(a.employeeId);
        //     const shiftStart = shift?.start || null;
        //     const shiftEnd = shift?.end || null;
        //     // ------ WORKING HOURS ------
        //     const hours = checkIn && checkOut ? Math.round(((checkOut.getTime() - checkIn.getTime())) / 3600000) : 0;
        //     // ------ FLAGS ------
        //     let flag = null;
        //     // Late login
        //     if (checkIn && shiftStart && checkIn > shiftStart) {
        //       flag = "late-login";
        //     }
        //     // Early logout
        //     if (checkOut && shiftEnd && checkOut < shiftEnd) {
        //       flag = flag ? `${flag},early-logout` : "early-logout";
        //     }
        //     // Half day
        //     if (hours > 0 && hours < 4) {
        //       flag = "half-day";
        //     }
        //     // ----- Determine finalStatus -----
        //     let finalStatus = a.status;  // Present / Absent from DB
        //     if (flag) {   // late login, early logout, half day
        //       if (!a.attendanceApproval) {
        //         finalStatus = 'PendingApproval';
        //       }
        //       else if (a.attendanceApproval === 'APPROVED') {
        //         finalStatus = 'Present';
        //       }
        //       else if (a.attendanceApproval === 'REJECTED') {
        //         finalStatus = 'Absent';
        //       }
        //     }
        //     return {
        //       title: `Worked ${hours}h`,
        //       start: a.date,
        //       type: 'attendance',
        //       status: a.status,
        //       checkIn: a.checkIn,
        //       checkOut: a.checkOut,
        //       hours,
        //       shiftStart,
        //       shiftEnd,
        //       flag,
        //       finalStatus,   // ⭐ THIS is your computed attendance status
        //       needsApproval: !!flag && a.attendanceApproval === null,
        //       attendanceApproval: a.attendanceApproval,
        //       approvedBy: a.approvedBy,
        //       approvedAt: a.approvedAt,
        //       attendanceId: a.id,
        //     };
        //   }),
        //   ...leaves.map(l => ({
        //     title: `Leave (${l.leaveType?.name ?? 'Unknown'})`,
        //     start: l.startDate,
        //     end: l.endDate,
        //     type: 'leave',
        //   })),
        //   ...permissions.map(p => ({
        //     title: `Permission ${p.timing ?? ''}`,
        //     start: p.day,
        //     type: 'permission',
        //   })),
        // ];
        // let cursor = new Date(start);
        // while (cursor < end) {
        //   const iso = cursor.toISOString().slice(0, 10);
        //   if (approvedWeekOffDates.size > 0) {
        //     // ✅ Approved month → ONLY approved week-offs
        //     if (approvedWeekOffDates.has(iso)) {
        //       result.push({
        //         title: 'Week Off',
        //         start: new Date(cursor),
        //         type: 'weekoff',
        //         approved: true
        //       });
        //     }
        //   } else {
        //     // ❌ Not approved → Sunday fallback
        //     if (cursor.getDay() === 0) {
        //       result.push({
        //         title: 'Week Off',
        //         start: new Date(cursor),
        //         type: 'weekoff',
        //         approved: false
        //       });
        //     }
        //   }
        //   cursor.setDate(cursor.getDate() + 1);
        // }
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err });
    }
});
exports.getAttendanceCalendar = getAttendanceCalendar;
const getWeeklyAttendance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, start, end } = req.query;
        if (!employeeId || !start || !end) {
            return res.status(400).json({ message: "Missing parameters" });
        }
        // const startDate = new Date(start as string);
        // const endDate = new Date(end as string);
        function toUtcStart(dateStr) {
            const d = new Date(dateStr);
            d.setUTCHours(0, 0, 0, 0);
            d.setMinutes(d.getMinutes() - 330); // IST offset
            return d;
        }
        const startDate = toUtcStart(start);
        const endDate = toUtcStart(end);
        endDate.setUTCDate(endDate.getUTCDate() + 1);
        const attendance = yield prisma_1.prisma.attendance.findMany({
            where: {
                employeeId: Number(employeeId),
                date: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            orderBy: { date: 'asc' },
        });
        res.json(attendance);
    }
    catch (error) {
        console.error("Error fetching attendance:", error);
        res.status(500).json({ message: "Server error" });
    }
});
exports.getWeeklyAttendance = getWeeklyAttendance;
function buildShiftMap(settings, monthStart) {
    var _a, _b, _c, _d;
    const map = new Map();
    for (const s of settings) {
        // FIXED SHIFT
        if (s.mode === 'FIXED' && ((_a = s.fixedShift) === null || _a === void 0 ? void 0 : _a.startTime) && ((_b = s.fixedShift) === null || _b === void 0 ? void 0 : _b.endTime)) {
            map.set(s.employeeId, {
                start: combineDateAndTime(monthStart, s.fixedShift.startTime),
                end: combineDateAndTime(monthStart, s.fixedShift.endTime)
            });
        }
        // ROTATIONAL SHIFT
        else if (s.mode === 'ROTATIONAL' && ((_d = (_c = s.rotationPattern) === null || _c === void 0 ? void 0 : _c.items) === null || _d === void 0 ? void 0 : _d.length)) {
            // take first rotation (or you can calculate based on date index later)
            const shiftObj = s.rotationPattern.items[0].shift;
            if ((shiftObj === null || shiftObj === void 0 ? void 0 : shiftObj.startTime) && (shiftObj === null || shiftObj === void 0 ? void 0 : shiftObj.endTime)) {
                map.set(s.employeeId, {
                    start: combineDateAndTime(monthStart, shiftObj.startTime),
                    end: combineDateAndTime(monthStart, shiftObj.endTime)
                });
            }
        }
    }
    return map;
}
function combineDateAndTime(base, t) {
    const dt = new Date(base);
    const tt = new Date(t);
    dt.setHours(tt.getHours(), tt.getMinutes(), 0, 0);
    return dt;
}
// export const approveAttendance = async (req: Request, res: Response) => {
//   try {
//     const { attendanceId, decision, hrId, rejectReason } = req.body;
//     if (!attendanceId || !decision || !hrId)
//       return res.status(400).json({ message: "Missing required fields" });
//     const updateData: any = {
//       attendanceApproval: decision,
//       approvedBy: hrId,
//       approvedAt: new Date(),
//     };
//     // Only save reason if rejected
//     if (decision === 'REJECTED') {
//       updateData.reason = rejectReason || "No reason provided";
//     }
//     // Force present logic
//     if (decision === 'FORCE_PRESENT') {
//       updateData.status = 'Present';   // override status
//     }
//     const record = await prisma.attendance.update({
//       where: { id: attendanceId },
//       data: updateData
//     });
//     res.json({
//       message: "Attendance updated successfully",
//       updated: record
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Server error", error: err });
//   }
// };
const approveAttendance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { attendanceId, decision, hrId, rejectReason, date, employeeId } = req.body;
        if (!decision || !hrId)
            return res.status(400).json({ message: "Missing required fields" });
        let record;
        // CASE 1: attendance exists → update
        if (attendanceId) {
            const updateData = {
                attendanceApproval: decision,
                approvedBy: hrId,
                approvedAt: new Date(),
                status: 'Present'
            };
            if (decision === 'REJECTED') {
                updateData.reason = rejectReason || "No reason provided";
                updateData.status = 'Absent';
            }
            if (decision === 'FORCE_PRESENT') {
                updateData.status = 'Present';
            }
            record = yield prisma_1.prisma.attendance.update({
                where: { id: attendanceId },
                data: updateData
            });
        }
        // CASE 2: no attendance → create new one
        else if (decision === 'FORCE_PRESENT' && date && employeeId) {
            record = yield prisma_1.prisma.attendance.create({
                data: {
                    employeeId,
                    date: new Date(date),
                    status: 'Present',
                    attendanceApproval: 'FORCE_PRESENT',
                    approvedBy: hrId,
                    approvedAt: new Date()
                }
            });
        }
        else {
            return res.status(400).json({ message: "Invalid request" });
        }
        res.json({
            message: "Attendance updated successfully",
            updated: record
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err });
    }
});
exports.approveAttendance = approveAttendance;
// export const getTodayAttendanceList = async (req: Request, res: Response) => {
//   try {
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);
//     const tomorrow = new Date(today);
//     tomorrow.setDate(tomorrow.getDate() + 1);
//     // Get all active employees
//     const employees = await prisma.employee.findMany({
//       where: {
//         employmentStatus: {
//           in: ['ACTIVE', 'NOTICE_PERIOD'],
//         },
//       },
//       include: {
//         Department: true,
//         designation: true,
//       },
//     });
//     // Get today's attendance
//     const attendanceRecords = await prisma.attendance.findMany({
//       where: {
//         date: {
//           gte: today,
//           lt: tomorrow,
//         },
//       },
//     });
//     // Map attendance by employeeId
//     const attendanceMap = new Map<number, any>();
//     attendanceRecords.forEach(a => {
//       attendanceMap.set(a.employeeId, a);
//     });
//     // Build table data
//     const result = employees.map(emp => {
//       const att = attendanceMap.get(emp.id);
//       let status = 'Absent';
//       if (att) {
//         status = att.attendanceApproval === 'FORCE_PRESENT'
//           ? 'FORCE_PRESENT'
//           : att.status;
//       }
//       return {
//         attendanceId: att?.id || null,
//         employeeId: emp.id,
//         date: today,
//         empId: emp.employeeCode,
//         empName: `${emp.firstName} ${emp.lastName}`,
//         phoneNumber: emp.phone || '',
//         department: emp.Department?.name || '',
//         departmentId:emp.Department?.id || 0,
//         jobTitle: emp.designation?.name || '',
//         empType: emp.employmentType || '',
//         email: emp.email || '',
//         photoUrl: emp.photoUrl || null,
//         gender: emp.gender || null,
//         status,
//       };
//     });
//     res.json(result);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Server error' });
//   }
// };
const getTodayAttendanceList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        // 1️⃣ Get employees
        const employees = yield prisma_1.prisma.employee.findMany({
            where: {
                employmentStatus: {
                    in: ['ACTIVE', 'NOTICE_PERIOD'],
                },
            },
            include: {
                Department: true,
                designation: true,
            }
        });
        // 2️⃣ Get shift settings for all employees
        const shiftSettings = yield prisma_1.prisma.employeeShiftSetting.findMany({
            where: {
                employeeId: {
                    in: employees.map(e => e.id)
                }
            },
            include: {
                fixedShift: true,
                rotationPattern: {
                    include: {
                        items: { include: { shift: true } }
                    }
                }
            }
        });
        const shiftMap = buildShiftMap(shiftSettings, today);
        // 3️⃣ Get today's attendance
        const attendanceRecords = yield prisma_1.prisma.attendance.findMany({
            where: {
                date: {
                    gte: today,
                    lt: tomorrow,
                },
            },
        });
        const attendanceMap = new Map();
        attendanceRecords.forEach(a => {
            attendanceMap.set(a.employeeId, a);
        });
        // 4️⃣ Build result
        const result = employees.map(emp => {
            var _a, _b, _c;
            const att = attendanceMap.get(emp.id);
            const checkIn = (att === null || att === void 0 ? void 0 : att.checkIn) ? new Date(att.checkIn) : null;
            const checkOut = (att === null || att === void 0 ? void 0 : att.checkOut) ? new Date(att.checkOut) : null;
            const shift = shiftMap.get(emp.id);
            const shiftStart = (shift === null || shift === void 0 ? void 0 : shift.start) || null;
            const shiftEnd = (shift === null || shift === void 0 ? void 0 : shift.end) || null;
            // Working hours
            let hours = 0;
            if (checkIn && checkOut) {
                hours = Math.round((checkOut.getTime() - checkIn.getTime()) / 3600000);
            }
            // Login/logout flags
            let loginFlag = null;
            let logoutFlag = null;
            if (checkIn && shiftStart) {
                loginFlag =
                    checkIn > shiftStart ? 'Late Login' : 'Early Login';
            }
            if (checkOut && shiftEnd) {
                logoutFlag =
                    checkOut < shiftEnd ? 'Early Logout' : 'Late Logout';
            }
            // Final status
            let status = 'Absent';
            if (att) {
                status =
                    att.attendanceApproval === 'FORCE_PRESENT'
                        ? 'FORCE_PRESENT'
                        : att.status;
            }
            return {
                attendanceId: (att === null || att === void 0 ? void 0 : att.id) || null,
                employeeId: emp.id,
                date: today,
                empId: emp.employeeCode,
                empName: `${emp.firstName} ${emp.lastName}`,
                phoneNumber: emp.phone || '',
                department: ((_a = emp.Department) === null || _a === void 0 ? void 0 : _a.name) || '',
                departmentId: ((_b = emp.Department) === null || _b === void 0 ? void 0 : _b.id) || 0,
                jobTitle: ((_c = emp.designation) === null || _c === void 0 ? void 0 : _c.name) || '',
                empType: emp.employmentType || '',
                email: emp.email || '',
                photoUrl: emp.photoUrl || null,
                gender: emp.gender || null,
                status,
                checkIn,
                checkOut,
                workingHours: hours,
                loginFlag,
                logoutFlag
            };
        });
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});
exports.getTodayAttendanceList = getTodayAttendanceList;
const getAttendanceHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const dateParam = req.query.date;
        if (!dateParam) {
            return res.status(400).json({ message: "date is required" });
        }
        const selectedDate = new Date(dateParam);
        selectedDate.setHours(0, 0, 0, 0);
        const nextDay = new Date(selectedDate);
        nextDay.setDate(nextDay.getDate() + 1);
        // 1️⃣ Get employees
        const employees = yield prisma_1.prisma.employee.findMany({
            where: {
                employmentStatus: {
                    in: ['ACTIVE', 'NOTICE_PERIOD'],
                },
            },
            include: {
                Department: true,
                designation: true,
            }
        });
        // 2️⃣ Get shift settings
        const shiftSettings = yield prisma_1.prisma.employeeShiftSetting.findMany({
            where: {
                employeeId: {
                    in: employees.map(e => e.id)
                }
            },
            include: {
                fixedShift: true,
                rotationPattern: {
                    include: {
                        items: { include: { shift: true } }
                    }
                }
            }
        });
        const shiftMap = buildShiftMap(shiftSettings, selectedDate);
        // 3️⃣ Get attendance for selected day
        const attendanceRecords = yield prisma_1.prisma.attendance.findMany({
            where: {
                date: {
                    gte: selectedDate,
                    lt: nextDay,
                },
            },
        });
        const attendanceMap = new Map();
        attendanceRecords.forEach(a => {
            attendanceMap.set(a.employeeId, a);
        });
        // 4️⃣ Build result
        const result = employees.map(emp => {
            var _a, _b, _c;
            const att = attendanceMap.get(emp.id);
            const checkIn = (att === null || att === void 0 ? void 0 : att.checkIn) ? new Date(att.checkIn) : null;
            const checkOut = (att === null || att === void 0 ? void 0 : att.checkOut) ? new Date(att.checkOut) : null;
            const shift = shiftMap.get(emp.id);
            const shiftStart = (shift === null || shift === void 0 ? void 0 : shift.start) || null;
            const shiftEnd = (shift === null || shift === void 0 ? void 0 : shift.end) || null;
            // Working hours
            let hours = 0;
            if (checkIn && checkOut) {
                hours = Math.round((checkOut.getTime() - checkIn.getTime()) / 3600000);
            }
            // Login/logout flags
            let loginFlag = null;
            let logoutFlag = null;
            if (checkIn && shiftStart) {
                loginFlag =
                    checkIn > shiftStart ? 'Late Login' : 'Early Login';
            }
            if (checkOut && shiftEnd) {
                logoutFlag =
                    checkOut < shiftEnd ? 'Early Logout' : 'Late Logout';
            }
            // Status
            let status = 'Absent';
            if (att) {
                status =
                    att.attendanceApproval === 'FORCE_PRESENT'
                        ? 'FORCE_PRESENT'
                        : att.status;
            }
            return {
                employeeId: emp.id,
                date: selectedDate,
                empId: emp.employeeCode,
                empName: `${emp.firstName} ${emp.lastName}`,
                phoneNumber: emp.phone || '',
                department: ((_a = emp.Department) === null || _a === void 0 ? void 0 : _a.name) || '',
                departmentId: ((_b = emp.Department) === null || _b === void 0 ? void 0 : _b.id) || 0,
                jobTitle: ((_c = emp.designation) === null || _c === void 0 ? void 0 : _c.name) || '',
                empType: emp.employmentType || '',
                email: emp.email || '',
                photoUrl: emp.photoUrl || null,
                gender: emp.gender || null,
                status,
                checkIn,
                checkOut,
                workingHours: hours,
                loginFlag,
                logoutFlag
            };
        });
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});
exports.getAttendanceHistory = getAttendanceHistory;
const getMonthlyAttendanceRegister = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const month = req.query.month; // YYYY-MM
        if (!month) {
            return res.status(400).json({ message: "month required" });
        }
        const start = new Date(`${month}-01T00:00:00`);
        const end = new Date(start);
        end.setMonth(end.getMonth() + 1);
        const employees = yield prisma_1.prisma.employee.findMany({
            where: {
                employmentStatus: { in: ['ACTIVE', 'NOTICE_PERIOD'] }
            }
        });
        const attendance = yield prisma_1.prisma.attendance.findMany({
            where: {
                date: { gte: start, lt: end }
            }
        });
        const map = new Map();
        attendance.forEach(a => {
            const key = a.employeeId +
                '_' +
                new Date(a.date).toISOString().slice(0, 10);
            map.set(key, a);
        });
        const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
        const result = employees.map(emp => {
            const row = {
                "Employee Name": `${emp.firstName} ${emp.lastName}`,
                "Emp ID": emp.employeeCode
            };
            for (let d = 1; d <= daysInMonth; d++) {
                const date = new Date(start);
                date.setDate(d);
                const iso = date.toISOString().slice(0, 10);
                const key = emp.id + '_' + iso;
                const att = map.get(key);
                const label = iso.slice(8, 10) + '/' + iso.slice(5, 7);
                row[`${label} In`] = (att === null || att === void 0 ? void 0 : att.checkIn)
                    ? new Date(att.checkIn).toTimeString().slice(0, 5)
                    : '';
                row[`${label} Out`] = (att === null || att === void 0 ? void 0 : att.checkOut)
                    ? new Date(att.checkOut).toTimeString().slice(0, 5)
                    : '';
            }
            return row;
        });
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});
exports.getMonthlyAttendanceRegister = getMonthlyAttendanceRegister;
