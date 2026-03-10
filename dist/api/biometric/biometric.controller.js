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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBiometricSync = runBiometricSync;
const axios_1 = __importDefault(require("axios"));
const client_1 = require("@prisma/client");
const notifications_controller_1 = require("../notifications/notifications.controller");
const comOff_service_1 = require("../../services/comOff.service");
const prisma = new client_1.PrismaClient();
/* ---------------------------------
   COSEC CONFIG
---------------------------------- */
const COSEC_BASE_URL = 'http://192.168.14.114:83/COSEC/api.svc/v2';
// const COSEC_BASE_URL = 'http://14.194.12.229:83/COSEC/api.svc/v2';
const COSEC_USERNAME = 'api';
const COSEC_PASSWORD = 'Api@123';
/* ---------------------------------
   DATE HELPERS
---------------------------------- */
function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function parseDate(date) {
    const [dd, mm, yyyy] = date.split('/');
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
}
function getCosecRange(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}${mm}${yyyy}-${dd}${mm}${yyyy}`;
}
/* ---------------------------------
   COSEC UTILS
---------------------------------- */
function parsePunch(dateStr, punchStr) {
    if (!punchStr)
        return null;
    // Case 1: "29/12/2025 10:20:17"
    if (punchStr.includes(' ')) {
        const [datePart, timePart] = punchStr.split(' ');
        const [d, m, y] = datePart.split('/').map(Number);
        const [hh, mm, ss] = timePart.split(':').map(Number);
        const dt = new Date(y, m - 1, d, hh, mm, ss);
        return isNaN(dt.getTime()) ? null : dt;
    }
    // Case 2: legacy format
    const [d, m, y] = dateStr.split('/').map(Number);
    const [hh, mm, ss] = punchStr.split(':').map(Number);
    const dt = new Date(y, m - 1, d, hh, mm, ss);
    return isNaN(dt.getTime()) ? null : dt;
}
function extractPunches(rec) {
    // console.log(`  Extracting punches for record on date: ${rec.processdate}`, rec);
    const punches = [];
    for (let i = 1; i <= 10; i++) {
        const p = rec[`punch${i}`];
        // console.log(`    Punch ${i}:`, p);
        if (!p)
            continue;
        const dt = parsePunch(rec.processdate, p);
        if (dt)
            punches.push(dt);
    }
    return punches.sort((a, b) => a.getTime() - b.getTime());
}
/* ---------------------------------
   SHIFT HELPERS
---------------------------------- */
function isNightShift(employeeId, date) {
    return __awaiter(this, void 0, void 0, function* () {
        const assignment = yield prisma.shiftAssignment.findFirst({
            where: { employeeId, date },
            include: { shift: true },
        });
        if (!(assignment === null || assignment === void 0 ? void 0 : assignment.shift))
            return false;
        const start = new Date(assignment.shift.startTime);
        const end = new Date(assignment.shift.endTime);
        let hrs = (end.getTime() - start.getTime()) / 36e5;
        if (hrs < 0)
            hrs += 24;
        return hrs >= 12;
    });
}
function combineShiftStart(day, shiftStart) {
    const d = new Date(day);
    d.setHours(shiftStart.getHours(), shiftStart.getMinutes(), shiftStart.getSeconds(), 0);
    return d;
}
function combineShiftEnd(day, start, end) {
    const d = new Date(day);
    d.setHours(end.getHours(), end.getMinutes(), end.getSeconds(), 0);
    if (end < start)
        d.setDate(d.getDate() + 1);
    return d;
}
function diffMinutes(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 60000);
}
function hasLeaveOrPermission(employeeId, date) {
    return __awaiter(this, void 0, void 0, function* () {
        const leave = yield prisma.leaveRequest.findFirst({
            where: {
                employeeId,
                status: { in: ['APPROVED', 'PENDING'] },
                startDate: { lte: date },
                endDate: { gte: date },
            },
        });
        if (leave)
            return true;
        const permission = yield prisma.permissionRequest.findFirst({
            where: {
                employeeId,
                status: { in: ['APPROVED', 'PENDING'] },
                day: date,
            },
        });
        return !!permission;
    });
}
/* ---------------------------------
   COSEC FETCH
---------------------------------- */
function fetchAttendanceDaily(date) {
    return __awaiter(this, void 0, void 0, function* () {
        const range = getCosecRange(date);
        const url = `${COSEC_BASE_URL}/attendance-daily` +
            `?action=get;field-name=userid,processdate,punch1,punch2,punch3,punch4,punch5,punch6,punch7,punch8,punch9,punch10;` +
            `date-range=${range};range=organization;id=2;active=1;format=json`;
        const res = yield axios_1.default.get(url, {
            auth: { username: COSEC_USERNAME, password: COSEC_PASSWORD },
            timeout: 300000,
        });
        return res.data['attendance-daily'] || [];
    });
}
/* ---------------------------------
   MAIN BIOMETRIC SYNC
---------------------------------- */
function runBiometricSync(isFinalRun) {
    return __awaiter(this, void 0, void 0, function* () {
        const today = startOfDay(new Date());
        const yesterday = startOfDay(new Date(Date.now() - 86400000));
        // const today = startOfDay(date);
        // const yesterday = startOfDay(
        //   new Date(date.getTime() - 86400000)
        // );
        console.log(`🔄 Starting biometric sync | Date: ${today.toDateString()} | Final: ${isFinalRun}`);
        console.log(`🔄 Yesterday date: ${yesterday.toDateString()}`);
        // const employees = await prisma.employee.findMany({
        //   where: { employmentStatus: 'ACTIVE' },
        //   select: { id: true, employeeCode: true },
        // });
        const employees = yield prisma.employee.findMany({
            where: {
                employmentStatus: {
                    in: ['ACTIVE', 'NOTICE_PERIOD'],
                },
            },
            select: {
                id: true,
                employeeCode: true,
            },
        });
        const empMap = new Map(employees.map(e => [e.employeeCode, e.id]));
        // console.log(empMap)
        /* ======================================================
           PART 1: PROCESS TODAY'S BIOMETRIC (CHECK-IN)
        ====================================================== */
        const todayRecords = yield fetchAttendanceDaily(today);
        console.log(`  Fetched ${todayRecords.length} biometric records for today`);
        for (const r of todayRecords) {
            // console.log(r.userId, 'userId')
            const employeeId = empMap.get(r.userid);
            // console.log(employeeId)
            if (!employeeId)
                continue;
            const date = parseDate(r.processdate);
            console.log(`Processing attendance for Employee ID: ${employeeId} | Date: ${date.toDateString()}`);
            const punches = extractPunches(r);
            // console.log(`  Extracted punches: ${punches.length}`);
            // console.log(`  Punch times: ${punches.map(p => p.toISOString()).join(', ')}`);
            if (!punches.length)
                continue;
            const night = yield isNightShift(employeeId, date);
            const wasNightYesterday = yield isNightShift(employeeId, yesterday);
            let checkIn = null;
            if (wasNightYesterday) {
                checkIn = punches.length > 1 ? punches[1] : null;
            }
            else {
                checkIn = punches[0];
            }
            const checkOut = night || punches.length === 1
                ? null
                : punches[punches.length - 1];
            // -------- STATUS DECISION (FIXED) --------
            let finalStatus;
            if (!checkIn) {
                finalStatus = isFinalRun ? 'Absent' : 'IN_PROGRESS';
            }
            else {
                finalStatus = 'Present';
            }
            if (checkIn && checkOut && !night && !wasNightYesterday) {
                const workedMin = diffMinutes(checkIn, checkOut);
                if (workedMin < 240) {
                    const allowed = yield hasLeaveOrPermission(employeeId, date);
                    finalStatus = allowed ? 'Present' : 'ON_HOLD';
                }
            }
            // await prisma.attendance.upsert({
            //   where: { employeeId_date: { employeeId, date } },
            //   create: {
            //     employeeId,
            //     date,
            //     checkIn,
            //     checkOut,
            //     status: finalStatus,
            //   },
            //   update: {
            //     checkIn,
            //     checkOut,
            //     status: finalStatus,
            //   },
            // });
            const attendance = yield prisma.attendance.upsert({
                where: { employeeId_date: { employeeId, date } },
                create: {
                    employeeId,
                    date,
                    checkIn,
                    checkOut,
                    status: finalStatus,
                },
                update: {
                    checkIn,
                    checkOut,
                    status: finalStatus,
                },
            });
            // 🔑 Generate comp-off after attendance is finalized
            yield (0, comOff_service_1.generateCompOffIfEligible)(attendance);
        }
        /* ======================================================
           PART 2: CLOSE NIGHT SHIFT (YESTERDAY) USING TODAY PUNCH
        ====================================================== */
        for (const r of todayRecords) {
            const employeeId = empMap.get(r.userid);
            if (!employeeId)
                continue;
            const punches = extractPunches(r);
            if (!punches.length)
                continue;
            const yAttendance = yield prisma.attendance.findUnique({
                where: {
                    employeeId_date: {
                        employeeId,
                        date: yesterday,
                    },
                },
            });
            if (!yAttendance || yAttendance.checkOut)
                continue;
            const wasNight = yield isNightShift(employeeId, yesterday);
            if (!wasNight)
                continue;
            yield prisma.attendance.update({
                where: {
                    employeeId_date: {
                        employeeId,
                        date: yesterday,
                    },
                },
                data: {
                    checkOut: punches[0],
                    status: 'Present',
                },
            });
        }
        /* ======================================================
           PART 3: LATE LOGIN (TODAY)
        ====================================================== */
        // const todayAttendance = await prisma.attendance.findMany({
        //   where: { date: today },
        //   select: { employeeId: true, checkIn: true },
        // });
        // const todayShifts = await prisma.shiftAssignment.findMany({
        //   where: { date: today },
        //   include: { shift: true },
        // });
        // const shiftStartMap = new Map<number, Date>();
        // for (const s of todayShifts) {
        //   if (!s.shift) continue;
        //   shiftStartMap.set(
        //     s.employeeId,
        //     combineShiftStart(today, s.shift.startTime)
        //   );
        // }
        // for (const rec of todayAttendance) {
        //   if (!rec.checkIn) continue;
        //   const shiftStart = shiftStartMap.get(rec.employeeId);
        //   console.log(`Employee ID: ${rec.employeeId} | Shift Start: ${shiftStart} | Check-In: ${rec.checkIn}`);
        //   if (!shiftStart) continue;
        //   const lateMin = Math.round(
        //     (rec.checkIn.getTime() - shiftStart.getTime()) / 60000
        //   );
        //   if (lateMin > 15) {
        //     await prisma.lateLoginLog.upsert({
        //       where: {
        //         employeeId_date: { employeeId: rec.employeeId, date: today },
        //       },
        //       create: {
        //         employeeId: rec.employeeId,
        //         date: today,
        //         shiftStart,
        //         checkIn: rec.checkIn,
        //         lateMinutes: lateMin,
        //         source: 'BIOMETRIC',
        //       },
        //       update: {
        //         shiftStart,
        //         checkIn: rec.checkIn,
        //         lateMinutes: lateMin,
        //       },
        //     });
        //   }
        // }
        /* ======================================================
           PART 4: OVERTIME (YESTERDAY)
        ====================================================== */
        // const yAttendance = await prisma.attendance.findMany({
        //   where: { date: yesterday },
        //   select: { employeeId: true, checkOut: true },
        // });
        // const yShifts = await prisma.shiftAssignment.findMany({
        //   where: { date: yesterday },
        //   include: { shift: true },
        // });
        // const shiftEndMap = new Map<number, Date>();
        // for (const s of yShifts) {
        //   if (!s.shift) continue;
        //   shiftEndMap.set(
        //     s.employeeId,
        //     combineShiftEnd(yesterday, s.shift.startTime, s.shift.endTime)
        //   );
        // }
        // for (const rec of yAttendance) {
        //   if (!rec.checkOut) continue;
        //   const schedEnd = shiftEndMap.get(rec.employeeId);
        //   if (!schedEnd) continue;
        //   const otMin = Math.round(
        //     (rec.checkOut.getTime() - schedEnd.getTime()) / 60000
        //   );
        //   if (otMin > 0 && otMin <= 720) {
        //     await prisma.overtimeApproval.upsert({
        //       where: {
        //         employeeId_date: { employeeId: rec.employeeId, date: yesterday },
        //       },
        //       create: {
        //         employeeId: rec.employeeId,
        //         date: yesterday,
        //         minutes: otMin,
        //         scheduledEnd: schedEnd,
        //         checkOut: rec.checkOut,
        //         status: 'PENDING',
        //       },
        //       update: {
        //         minutes: otMin,
        //         scheduledEnd: schedEnd,
        //         checkOut: rec.checkOut,
        //       },
        //     });
        //   }
        // }
        const allShifts = yield prisma.shiftTemplate.findMany({
            select: {
                id: true,
                shiftType: true,
                startTime: true,
                endTime: true,
            },
        });
        const shiftsByType = new Map();
        for (const s of allShifts) {
            if (!shiftsByType.has(s.shiftType)) {
                shiftsByType.set(s.shiftType, []);
            }
            shiftsByType.get(s.shiftType).push(s);
        }
        const getShiftTypeByRoleAndDepartment = (roleId, departmentId) => {
            // 🎯 Role-based logic
            if (roleId === 1 || roleId === 3) {
                return 'REPORTING_MANAGER';
            }
            // 🔥 Department overrides (TOP PRIORITY)
            if (departmentId === 3) {
                return 'NURSING';
            }
            if (departmentId === 4) {
                return 'MOD';
            }
            if (roleId === 2) {
                return 'EXECUTIVE';
            }
            // 🧯 Default fallback
            return 'EXECUTIVE';
        };
        const findNearestShiftStart = (date, checkIn, shifts) => {
            let nearest = null;
            let minDiff = Infinity;
            for (const s of shifts) {
                const shiftStart = combineShiftStart(date, s.startTime);
                const diff = Math.abs(checkIn.getTime() - shiftStart.getTime());
                if (diff < minDiff) {
                    minDiff = diff;
                    nearest = shiftStart;
                }
            }
            return nearest;
        };
        const findNearestShiftEnd = (date, checkOut, shifts) => {
            let nearest = null;
            let minDiff = Infinity;
            for (const s of shifts) {
                const shiftEnd = combineShiftEnd(date, s.startTime, s.endTime);
                const diff = Math.abs(checkOut.getTime() - shiftEnd.getTime());
                if (diff < minDiff) {
                    minDiff = diff;
                    nearest = shiftEnd;
                }
            }
            return nearest;
        };
        /* ======================================================
             PART 1: LATE LOGIN (TODAY) – TEMP DEPT BASED
          ====================================================== */
        const todayAttendance = yield prisma.attendance.findMany({
            where: { date: today },
            include: {
                employee: {
                    select: {
                        id: true,
                        departmentId: true,
                        roleId: true,
                    },
                },
            },
        });
        for (const rec of todayAttendance) {
            if (!rec.checkIn)
                continue;
            const shiftType = getShiftTypeByRoleAndDepartment(rec.employee.roleId, rec.employee.departmentId);
            console.log(`Employee ID: ${rec.employeeId} | Dept ID: ${rec.employee.departmentId} | Shift Type: ${shiftType}`);
            const shifts = shiftsByType.get(shiftType);
            console.log(`  Found ${(shifts === null || shifts === void 0 ? void 0 : shifts.length) || 0} shifts for type ${shiftType}`);
            if (!shifts || shifts.length === 0)
                continue;
            const shiftStart = findNearestShiftStart(today, rec.checkIn, shifts);
            console.log(`  Shift Start: ${shiftStart} | Check-In: ${rec.checkIn}`);
            if (!shiftStart)
                continue;
            console.log(`  Shift Start: ${shiftStart} | Check-In: ${rec.checkIn}`);
            const lateMin = Math.round((rec.checkIn.getTime() - shiftStart.getTime()) / 60000);
            console.log(`  Late Minutes: ${lateMin}`);
            if (lateMin > 15) {
                yield prisma.lateLoginLog.upsert({
                    where: {
                        employeeId_date: {
                            employeeId: rec.employeeId,
                            date: today,
                        },
                    },
                    create: {
                        employeeId: rec.employeeId,
                        date: today,
                        shiftStart,
                        checkIn: rec.checkIn,
                        lateMinutes: lateMin,
                        source: 'TEMP_DEPT_SHIFT',
                    },
                    update: {
                        shiftStart,
                        checkIn: rec.checkIn,
                        lateMinutes: lateMin,
                    },
                });
            }
        }
        /* ======================================================
           PART 2: OVERTIME (YESTERDAY) – TEMP DEPT BASED
        ====================================================== */
        const yAttendance = yield prisma.attendance.findMany({
            where: { date: yesterday },
            include: {
                employee: {
                    select: {
                        id: true,
                        departmentId: true,
                        roleId: true,
                    },
                },
            },
        });
        for (const rec of yAttendance) {
            if (!rec.checkOut)
                continue;
            const shiftType = getShiftTypeByRoleAndDepartment(rec.employee.roleId, rec.employee.departmentId);
            const shifts = shiftsByType.get(shiftType);
            if (!shifts || shifts.length === 0)
                continue;
            const schedEnd = findNearestShiftEnd(yesterday, rec.checkOut, shifts);
            console.log(`Employee ID: ${rec.employeeId} | Dept ID: ${rec.employee.departmentId} | Shift Type: ${shiftType}`);
            console.log(`  Scheduled End: ${schedEnd} | Check-Out: ${rec.checkOut}`);
            if (!schedEnd)
                continue;
            const otMin = Math.round((rec.checkOut.getTime() - schedEnd.getTime()) / 60000);
            if (otMin > 0 && otMin <= 720) {
                yield prisma.overtimeApproval.upsert({
                    where: {
                        employeeId_date: {
                            employeeId: rec.employeeId,
                            date: yesterday,
                        },
                    },
                    create: {
                        employeeId: rec.employeeId,
                        date: yesterday,
                        minutes: otMin,
                        scheduledEnd: schedEnd,
                        checkOut: rec.checkOut,
                        status: 'PENDING',
                    },
                    update: {
                        minutes: otMin,
                        scheduledEnd: schedEnd,
                        checkOut: rec.checkOut,
                    },
                });
            }
        }
        console.log('✅ Biometric sync completed');
    });
}
function notifyHRShiftSummary() {
    return __awaiter(this, void 0, void 0, function* () {
        const today = startOfDay(new Date());
        const graceMinutes = 15;
        // Find shifts that STARTED before this run
        const shifts = yield prisma.shiftAssignment.findMany({
            where: {
                date: today,
            },
            include: {
                shift: true,
            },
        });
        for (const s of shifts) {
            if (!s.shift)
                continue;
            const shiftStart = combineShiftStart(today, s.shift.startTime);
            const lateAfter = new Date(shiftStart.getTime() + graceMinutes * 60000);
            // 🔑 Only evaluate shifts relevant to THIS RUN
            if (new Date < lateAfter)
                continue;
            const totalEmployees = yield prisma.shiftAssignment.count({
                where: {
                    date: today,
                    shiftId: s.shiftId,
                },
            });
            const lateCount = yield prisma.attendance.count({
                where: {
                    date: today,
                    employeeId: {
                        in: (yield prisma.shiftAssignment.findMany({
                            where: { date: today, shiftId: s.shiftId },
                            select: { employeeId: true },
                        })).map(e => e.employeeId),
                    },
                    OR: [
                        { checkIn: null },
                        { checkIn: { gt: lateAfter } },
                    ],
                },
            });
            if (lateCount === 0)
                continue;
            // 🔒 Prevent duplicate notification for same run + shift
            const key = `${today.toISOString()}-${new Date().getHours()}-${s.shiftId}`;
            const exists = yield prisma.attendanceNotificationLog.findUnique({
                where: { uniqueKey: key },
            });
            if (exists)
                continue;
            const message = `Attendance Update (${shiftStart.toLocaleTimeString()} shift):\n` +
                `${lateCount} of ${totalEmployees} employee(s) late or missing check-in.`;
            const hrEmployees = yield prisma.employee.findMany({
                where: { departmentId: 1 },
                select: { id: true },
            });
            for (const hr of hrEmployees) {
                yield (0, notifications_controller_1.createNotification)(hr.id, message);
            }
            yield prisma.attendanceNotificationLog.create({
                data: {
                    uniqueKey: key,
                    date: today,
                    shiftId: s.shiftId,
                    runAt: new Date(),
                    lateCount,
                },
            });
        }
    });
}
