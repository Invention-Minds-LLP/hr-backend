import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Announcement, ClearanceType, Prisma, ApplicationStatus } from '@prisma/client';
import { differenceInCalendarDays } from 'date-fns';
import { startOfMonth, endOfMonth } from 'date-fns';
import { createNotification } from '../notifications/notifications.controller';
import * as ExcelJS from 'exceljs';
import { create } from 'qrcode';

const prisma = new PrismaClient();
const IST = 'Asia/Kolkata';
type AudienceFilter = {
    all?: boolean;
    departmentId?: number[];
    branchId?: number[];
    roleId?: number[];
    employeeId?: number[];
};

function parseAud(audience?: string | null): AudienceFilter | undefined {
    if (!audience) return undefined;
    try {
        let f: any = JSON.parse(audience);
        if (typeof f === 'string') f = JSON.parse(f); // handle double encoding
        return f as AudienceFilter;
    } catch {
        return undefined;
    }
}

const asyncHandler =
    (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
        (req: Request, res: Response, next: NextFunction) =>
            fn(req, res, next).catch(next);

// -------- date helpers (IST-safe) --------
function startOfDayIST(d = new Date()) {
    const x = new Date(d.toLocaleString('en-US', { timeZone: IST }));
    x.setHours(0, 0, 0, 0);
    return x;
}
function endOfDayIST(d = new Date()) {
    const x = new Date(d.toLocaleString('en-US', { timeZone: IST }));
    x.setHours(23, 59, 59, 999);
    return x;
}
function addDays(date: Date, days: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}
function sameMonthDay(a?: Date | null, b?: Date | null) {
    if (!a || !b) return false;
    return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
}
function sameYMD(a?: Date | string | null, b?: Date | string | null): boolean {
    if (!a || !b) return false;
    const da = a instanceof Date ? a : new Date(a);
    const db = b instanceof Date ? b : new Date(b);
    // strip time
    da.setHours(0, 0, 0, 0);
    db.setHours(0, 0, 0, 0);
    return (
        da.getFullYear() === db.getFullYear() &&
        da.getMonth() === db.getMonth() &&
        da.getDate() === db.getDate()
    );
}

function median(nums: number[]) {
    if (!nums.length) return 0;
    const a = nums.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function combineDateAndTime(baseDate: Date, timeTemplate: Date) {
    const dt = new Date(baseDate);
    const t = new Date(timeTemplate);
    dt.setHours(t.getHours(), t.getMinutes(), 0, 0);
    return dt;
}
function fmtDate(d?: Date | null) {
    if (!d) return '—';
    return d.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
}
function fmtTime(d?: Date | null) {
    return d ? d.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' }) : '—';
}

type ListRow = { id: number; data: string[] };
function getMandatoryDocsForEmployee(emp: any): string[] {
    const mandatoryDocs: string[] = [];
    const employeeType = emp.employeeType;
    const experienceType = (emp.experienceType || '').toUpperCase();
    const isFresher = experienceType === 'FRESHER';

    if (!isFresher) {
        if (employeeType === 'CLINICAL') {
            mandatoryDocs.push('REGISTRATION_CERT');
        } else if (employeeType === 'NONCLINICAL') {
            mandatoryDocs.push('SALARY_CERT', 'VERIFICATION_CERT');
        }
    }

    mandatoryDocs.push('AADHAAR', 'PAN', 'BANK');

    (emp.qualifications || []).forEach((q: any) => {
        switch ((q.degree || '').toUpperCase()) {
            case 'SSLC':
                mandatoryDocs.push('SSLC');
                break;
            case 'PU':
                mandatoryDocs.push('PU');
                break;
            case 'DIPLOMA':
                mandatoryDocs.push('DIPLOMA');
                break;
            case 'BACHELOR':
            case 'MASTER':
            case 'PHD':
                mandatoryDocs.push('DEGREE');
                break;
        }
    });

    return [...new Set(mandatoryDocs)];
}

function getMissingMandatoryDocs(emp: any): string[] {
    const requiredDocs = getMandatoryDocsForEmployee(emp);

    const uploadedDocTypes = (emp.documents || []).map((d: any) =>
        (d.title || '').toUpperCase()
    );

    return requiredDocs.filter(doc => !uploadedDocTypes.includes(doc));
}

interface List {
    title: string;
    cols: string[];
    rows: any[];
    actions: string[];
    selectable: boolean;
}
// type List = { title: string; cols: string[]; rows: ListRow[]; actions?: string[] };

export class DashboardController {
    // ========== PUBLIC HANDLERS ==========

    /** GET /api/dashboard?location=ALL&department=ALL */
    getDashboard = asyncHandler(async (req, res) => {
        const { location = 'ALL', department = 'ALL', branchId, departmentId } = (req.query || {}) as {
            location?: string;
            department?: string;
            branchId?: number;
            departmentId?: number;
        };


        const todayStart = startOfDayIST();
        const todayEnd = endOfDayIST();
        const yesterdayStart = startOfDayIST(addDays(new Date(), -1));
        const yesterdayEnd = endOfDayIST(addDays(new Date(), -1));
        console.log(yesterdayEnd, yesterdayStart)
        const now = new Date();

        // ---- scope employees (filters)
        const employeeWhere: any = {
            employmentStatus: 'ACTIVE',
            ...(departmentId ? { departmentId: Number(departmentId) }
                : department !== 'ALL' ? { Department: { name: department } } : {}),
            ...(branchId ? { branchId: Number(branchId) }
                : location !== 'ALL' ? { Branch: { name: location } } : {}),
        };

        const employees = await prisma.employee.findMany({
            where: employeeWhere,
            select: {
                id: true,
                firstName: true,
                lastName: true,
                dob: true,
                employeeCode: true,
                dateOfJoining: true,
                departmentId: true,
                branchId: true,
                probationEndDate: true,
                reportingManager: true,
                roleId: true,
                employeeType: true,
                Department: { select: { name: true } },
            },
        });
        const employeeIds = employees.map((e) => e.id);

        // ---- Today counts
        const [leavesToday, interviewsToday, permissionsToday] = await Promise.all([
            prisma.leaveRequest.count({
                where: {
                    employeeId: { in: employeeIds },
                    status: 'APPROVED',
                    OR: [
                        { startDate: { lte: todayEnd }, endDate: { gte: todayStart } },
                        { startDate: { lte: todayEnd }, endDate: todayStart },
                    ],
                },
            }),
            prisma.interview.count({
                where: {
                    startTime: { gte: todayStart, lte: todayEnd },
                },
            }),
            prisma.permissionRequest.count({
                where: {
                    employeeId: { in: employeeIds },
                    status: 'APPROVED',
                    OR: [
                        { day: { gte: todayStart, lte: todayEnd } },
                        { startTime: { lte: todayEnd }, endTime: { gte: todayStart } },
                    ],
                },
            }),
        ]);
        // const [todayAttendance, todayAssignments, shiftSettings] = await Promise.all([
        //     prisma.attendance.findMany({
        //         where: { employeeId: { in: employeeIds }, date: { gte: todayStart, lte: todayEnd } },
        //         select: { employeeId: true, checkIn: true },
        //     }),
        //     prisma.shiftAssignment.findMany({
        //         where: { employeeId: { in: employeeIds }, date: { gte: todayStart, lte: todayEnd } },
        //         select: { employeeId: true, shift: { select: { id: true, startTime: true, endTime: true } } },
        //     }),
        //     prisma.employeeShiftSetting.findMany({
        //         where: { employeeId: { in: employeeIds } },
        //         select: {
        //             employeeId: true,
        //             mode: true,
        //             startDate: true,
        //             fixedShift: { select: { id: true, startTime: true, endTime: true } },
        //             rotationPattern: {
        //                 select: {
        //                     cycleDays: true,
        //                     items: {
        //                         select: {
        //                             dayIndex: true,
        //                             shift: { select: { id: true, startTime: true, endTime: true } },
        //                         },
        //                     },
        //                 },
        //             },
        //         },
        //     }),
        // ]);
        // const empById = new Map(employees.map(e => [e.id, e]));
        // const shiftTypeByEmp = new Map<number, 'General' | 'Rotational'>();

        // for (const s of shiftSettings) {
        //     shiftTypeByEmp.set(s.employeeId, s.mode === 'ROTATIONAL' ? 'Rotational' : 'General');
        // }


        // // Map employeeId -> array of candidate start DateTimes for *today*
        // const candidatesStartMap = new Map<number, Date[]>();

        // // 1) Per-day assignment (highest priority): lock to that one shift
        // for (const a of todayAssignments) {
        //     if (a.shift?.startTime) {
        //         candidatesStartMap.set(
        //             a.employeeId,
        //             [combineDateAndTime(todayStart, a.shift.startTime)]
        //         );
        //     }
        // }

        // // 2) Otherwise from shift settings
        // for (const s of shiftSettings) {
        //     if (candidatesStartMap.has(s.employeeId)) continue; // already fixed by assignment

        //     if (s.mode === 'FIXED' && s.fixedShift?.startTime) {
        //         candidatesStartMap.set(
        //             s.employeeId,
        //             [combineDateAndTime(todayStart, s.fixedShift.startTime)]
        //         );
        //     } else if (s.mode === 'ROTATIONAL' && s.rotationPattern?.items?.length) {
        //         // ANY-SHIFT policy: include *all* shifts in the pattern as valid for today
        //         const uniq = new Map<number, Date>(); // dedupe by shiftId
        //         for (const it of s.rotationPattern.items) {
        //             if (!it.shift?.startTime) continue;
        //             uniq.set(it.shift.id, combineDateAndTime(todayStart, it.shift.startTime));
        //         }
        //         candidatesStartMap.set(s.employeeId, Array.from(uniq.values()));
        //     }
        // }
        // const lateDiffs: number[] = [];
        // const lateRows: Array<[string, string, string, string, string]> = [];

        // for (const rec of todayAttendance) {
        //     if (!rec.checkIn) continue;

        //     const cands = candidatesStartMap.get(rec.employeeId) ?? [];
        //     if (cands.length === 0) continue;

        //     // Compute minutes late vs each candidate start
        //     let bestLate: number | null = null;
        //     for (const start of cands) {
        //         const diffMin = Math.round((rec.checkIn.getTime() - start.getTime()) / 60000);
        //         if (diffMin > 0) {
        //             bestLate = (bestLate == null) ? diffMin : Math.min(bestLate, diffMin);
        //         }
        //     }
        //     if (bestLate != null) {
        //         lateDiffs.push(bestLate);
        //         const e = empById.get(rec.employeeId);
        //         lateRows.push([
        //             e ? `${e.firstName} ${e.lastName}` : `Emp #${rec.employeeId}`,
        //             e?.employeeCode || '—',
        //             e?.Department?.name || '—',
        //             shiftTypeByEmp.get(rec.employeeId) || 'General',
        //             `${bestLate} min`,
        //         ]);
        //     }
        // }

        // const late = { count: lateDiffs.length, medianMins: Math.round(median(lateDiffs)) || 0 };


        // OT yesterday — compare checkout against the best-matching scheduled end

        // const [yAttend, ySettings] = await Promise.all([
        //     prisma.attendance.findMany({
        //         where: { employeeId: { in: employeeIds }, date: { gte: yesterdayStart, lte: yesterdayEnd } },
        //         select: { employeeId: true, checkIn: true, checkOut: true },
        //     }),
        //     prisma.employeeShiftSetting.findMany({
        //         where: { employeeId: { in: employeeIds } },
        //         select: {
        //             employeeId: true,
        //             mode: true,
        //             fixedShift: { select: { id: true, startTime: true, endTime: true } },
        //             rotationPattern: {
        //                 select: {
        //                     items: {
        //                         select: {
        //                             shift: { select: { id: true, startTime: true, endTime: true } },
        //                         },
        //                     },
        //                 },
        //             },
        //         },
        //     }),
        // ]);

        // function combineEndWithOvernight(yStart: Date, startTpl: Date, endTpl: Date) {
        //     const schedStart = combineDateAndTime(yStart, startTpl);
        //     const schedEnd = combineDateAndTime(yStart, endTpl);
        //     // overnight if end TOD < start TOD → push to next day
        //     const sH = new Date(startTpl).getHours(), sM = new Date(startTpl).getMinutes();
        //     const eH = new Date(endTpl).getHours(), eM = new Date(endTpl).getMinutes();
        //     if (eH < sH || (eH === sH && eM < sM)) {
        //         schedEnd.setDate(schedEnd.getDate() + 1);
        //     }
        //     return { schedStart, schedEnd };
        // }

        // // Build candidate (start,end) for yesterday per employee
        // const yCandEnds = new Map<number, { schedStart: Date; schedEnd: Date }[]>();

        // for (const s of ySettings) {
        //     const list: { schedStart: Date; schedEnd: Date }[] = [];

        //     if (s.mode === 'FIXED' && s.fixedShift?.startTime && s.fixedShift?.endTime) {
        //         list.push(combineEndWithOvernight(yesterdayStart, s.fixedShift.startTime, s.fixedShift.endTime));
        //     } else if (s.mode === 'ROTATIONAL' && s.rotationPattern?.items?.length) {
        //         const seen = new Set<number>();
        //         for (const it of s.rotationPattern.items) {
        //             const sh = it.shift;
        //             if (!sh?.id || !sh.startTime || !sh.endTime || seen.has(sh.id)) continue;
        //             seen.add(sh.id);
        //             list.push(combineEndWithOvernight(yesterdayStart, sh.startTime, sh.endTime));
        //         }
        //     }

        //     if (list.length) yCandEnds.set(s.employeeId, list);
        // }

        // // OT minutes = min positive (checkOut - anyCandidateEnd)
        // // let totalOtMins = 0;
        // const otEmployeeSet = new Set<number>();
        // const otRows: Array<[string, string, string, string, string]> = [];
        // // Save yesterday's OT records into OvertimeApproval table
        // for (const rec of yAttend) {
        //     if (!rec.checkOut) continue;
        //     const cands = yCandEnds.get(rec.employeeId) ?? [];
        //     let bestOT: number | null = null;
        //     let bestSchedEnd: Date | null = null;
        //     for (const { schedEnd } of cands) {
        //         const diff = Math.round((rec.checkOut.getTime() - schedEnd.getTime()) / 60000);
        //         if (diff > 0 && (bestOT == null || diff < bestOT)) {
        //             bestOT = diff;
        //             bestSchedEnd = schedEnd;  // 👈 remember which shift end gave the OT
        //         }
        //     }
        //     if (bestOT != null) {
        //         await prisma.overtimeApproval.upsert({
        //             where: { employeeId_date: { employeeId: rec.employeeId, date: yesterdayStart } },
        //             create: { employeeId: rec.employeeId, date: yesterdayStart, minutes: bestOT, scheduledEnd: bestSchedEnd, checkOut: rec.checkOut, status: 'PENDING' },
        //             update: { minutes: bestOT, scheduledEnd: bestSchedEnd, checkOut: rec.checkOut, },
        //         });
        //     }
        // }

        // // Pull only APPROVED OTs for dashboard
        // const approvedOTs = await prisma.overtimeApproval.findMany({
        //     where: { status: 'APPROVE', date: yesterdayStart },
        //     include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } } }
        // });

        // let totalOtMins = approvedOTs.reduce((sum: any, o: any) => sum + o.minutes, 0);

        // const otYesterday = {
        //     hours: Math.round((totalOtMins / 60) * 10) / 10,
        //     count: approvedOTs.length,
        //     cost: undefined as string | undefined,
        // };


        // Joiners, birthdays, anniversaries
        // const employeeIds = employees.map(e => e.id);
        const empById = new Map(employees.map(e => [e.id, e]));
        function combineEndWithOvernight(
            baseDate: Date,
            startTpl: Date,
            endTpl: Date
        ): { start: Date; end: Date } {
            const start = combineDateAndTime(baseDate, startTpl)!;
            let end = combineDateAndTime(baseDate, endTpl)!;

            if (end <= start) {
                end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
            }
            return { start, end };
        }

        // -----------------------------
        // TODAY ATTENDANCE + SHIFTS
        // -----------------------------
        // const [todayAttendance, todayAssignments] = await Promise.all([
        //     prisma.attendance.findMany({
        //         where: {
        //             employeeId: { in: employeeIds },
        //             date: { gte: todayStart, lte: todayEnd },
        //         },
        //         select: { employeeId: true, checkIn: true },
        //     }),

        //     prisma.shiftAssignment.findMany({
        //         where: {
        //             employeeId: { in: employeeIds },
        //             date: { gte: todayStart, lte: todayEnd },
        //         },
        //         select: {
        //             employeeId: true,
        //             shift: { select: { startTime: true, endTime: true } },
        //         },
        //     }),
        // ]);

        // // employeeId → shift start
        // const shiftStartMap = new Map<number, Date>();
        // for (const a of todayAssignments) {
        //     if (!a.shift?.startTime) continue;
        //     const start = combineDateAndTime(todayStart, a.shift.startTime);
        //     if (start) shiftStartMap.set(a.employeeId, start);
        // }

        // -----------------------------
        // LATE CALCULATION (CORRECT)
        // -----------------------------
        // const lateDiffs: number[] = [];
        // const lateRows: Array<[string, string, string, string, string]> = [];

        // for (const rec of todayAttendance) {
        //     if (!rec.checkIn) continue;

        //     const shiftStart = shiftStartMap.get(rec.employeeId);
        //     if (!shiftStart) continue;

        //     const diffMin = Math.round(
        //         (rec.checkIn.getTime() - shiftStart.getTime()) / 60000
        //     );

        //     if (diffMin > 15) {
        //         lateDiffs.push(diffMin);
        //         const e = empById.get(rec.employeeId);

        //         lateRows.push([
        //             e ? `${e.firstName} ${e.lastName}` : `Emp #${rec.employeeId}`,
        //             e?.employeeCode || '—',
        //             e?.Department?.name || '—',
        //             e?.employeeType === 'CLINICAL' ? 'Clinical' : 'Non-clinical',
        //             `${diffMin} min`,
        //         ]);
        //     }
        // }

        // const late = {
        //   count: lateDiffs.length,
        //   medianMins: lateDiffs.length ? Math.round(median(lateDiffs)) : 0,
        // };
        const lateLogsToday = await prisma.lateLoginLog.findMany({
            where: {
                date: { gte: todayStart, lte: todayEnd },
                lateMinutes: { gt: 15 },
            },
            include: {
                employee: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        employeeCode: true,
                        employeeType: true,
                        Department: { select: { name: true } },
                    },
                },
            },
        });

        const lateDiffs = lateLogsToday.map((l: any) => l.lateMinutes);

        const late = {
            count: lateDiffs.length,
            medianMins: lateDiffs.length ? Math.round(median(lateDiffs)) : 0,
        };


        // -----------------------------
        // YESTERDAY OT (CORRECT)
        // -----------------------------
        const [yAttend, yAssignments] = await Promise.all([
            prisma.attendance.findMany({
                where: {
                    employeeId: { in: employeeIds },
                    date: { gte: yesterdayStart, lte: yesterdayEnd },
                },
                select: { employeeId: true, checkOut: true },
            }),

            prisma.shiftAssignment.findMany({
                where: {
                    employeeId: { in: employeeIds },
                    date: { gte: yesterdayStart, lte: yesterdayEnd },
                },
                select: {
                    employeeId: true,
                    shift: { select: { startTime: true, endTime: true } },
                },
            }),
        ]);

        console.log(yAssignments, 'shift assignments')

        // const yShiftEndMap = new Map<number, Date>();
        // for (const a of yAssignments) {
        //     if (!a.shift?.startTime || !a.shift?.endTime) continue;
        //     const { end } = combineEndWithOvernight(
        //         yesterdayStart,
        //         a.shift.startTime,
        //         a.shift.endTime
        //     );
        //     console.log(end, 'end')
        //     yShiftEndMap.set(a.employeeId, end);
        // }

        // for (const rec of yAttend) {
        //     if (!rec.checkOut) continue;
        //     const schedEnd = yShiftEndMap.get(rec.employeeId);
        //     console.log(schedEnd, 'schedEnd')
        //     if (!schedEnd) continue;

        //     const diff = Math.round(
        //         (rec.checkOut.getTime() - schedEnd.getTime()) / 60000
        //     );

        //     if (diff > 0) {
        //         await prisma.overtimeApproval.upsert({
        //             where: {
        //                 employeeId_date: {
        //                     employeeId: rec.employeeId,
        //                     date: yesterdayStart,
        //                 },
        //             },
        //             create: {
        //                 employeeId: rec.employeeId,
        //                 date: yesterdayStart,
        //                 minutes: diff,
        //                 scheduledEnd: schedEnd,
        //                 checkOut: rec.checkOut,
        //                 status: 'PENDING',
        //             },
        //             update: {
        //                 minutes: diff,
        //                 scheduledEnd: schedEnd,
        //                 checkOut: rec.checkOut,
        //             },
        //         });
        //     }
        // }

        const approvedOTs = await prisma.overtimeApproval.findMany({
            where: {
                date: yesterdayStart,
                status: 'APPROVED',
            },
        });

        const totalOtMins = approvedOTs.reduce((s, o) => s + o.minutes, 0);

        const otYesterday = {
            hours: Math.round((totalOtMins / 60) * 10) / 10,
            count: approvedOTs.length,
            cost: undefined,
        };
        const newJoiners = employees.filter((e) => sameYMD(e.dateOfJoining, todayStart)).length;
        const birthdays = employees.filter((e) => sameMonthDay(e.dob, todayStart)).length;
        const anniversaries = employees.filter((e) => {
            const doj = new Date(e.dateOfJoining);
            return sameMonthDay(doj, todayStart) &&
                (todayStart.getFullYear() - doj.getFullYear()) >= 1; // ✅
        }).length;


        // Announcements ack rate
        // Announcements ack rate + list
        const liveAnns = await prisma.announcement.findMany({
            where: { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
            include: { acks: true },
            orderBy: { startsAt: 'desc' },
        });


        // helper: filter employees by audience JSON
        const audienceSize = (ann: Announcement) => {
            if (!ann.audience) return employeeIds.length;
            try {
                let filt = JSON.parse(ann.audience);
                if (typeof filt === 'string') filt = JSON.parse(filt); // handle double-encoding

                const filtered = employees.filter(e => {
                    if (filt.all) return true;
                    if (filt.departmentId && !filt.departmentId.includes(e.departmentId)) return false;
                    if (filt.branchId && !filt.branchId.includes(e.branchId)) return false;
                    if (filt.roleId && !filt.roleId.includes(e.roleId)) return false;
                    if (filt.employeeId && !filt.employeeId.includes(e.id)) return false;
                    return true;
                });

                return filtered.length;
            } catch (err) {
                console.error('Bad audience JSON', ann.audience, err);
                return employeeIds.length;
            }
        };

        // build per-announcement stats
        const announcementStats = liveAnns.map(a => {
            const audienceCount = Math.max(1, audienceSize(a)); // prevent divide by zero
            const ackCount = a.acks.length;
            const rate = ackCount / audienceCount;

            return {
                id: a.id,
                title: a.title,
                ackCount,
                audienceCount,
                ackRate: rate,
                ackPercent: Math.round(rate * 100),
            };
        });

        // overall average rate if you want
        let ackRate = 0;
        if (announcementStats.length) {
            ackRate =
                announcementStats.reduce((sum, x) => sum + x.ackRate, 0) /
                announcementStats.length;
        }

        const currentYear = new Date().getFullYear();
        const todayStartIST = startOfDayIST(); // 2025-01-09 00:00 IST
        const todayEndIST = endOfDayIST();     // 2025-01-09 23:59 IST
        const windowStart = addDays(todayStartIST, -372); // 365 + 7
        const windowEnd = addDays(todayEndIST, -358);     // 365 - 7

        // normalize (always do this)
        const rangeStart = windowStart < windowEnd ? windowStart : windowEnd;
        const rangeEnd = windowStart < windowEnd ? windowEnd : windowStart;



        // const ahcDueToday = await prisma.employee.count({
        //     where: {
        //         employmentStatus: 'ACTIVE',
        //         AND: [
        //             {
        //                 OR: [
        //                     {
        //                         preEmploymentCheckDate: {
        //                             lte: addDays(todayStart, -365),
        //                         },
        //                     },
        //                     {
        //                         preEmploymentCheckDate: null,
        //                         dateOfJoining: {
        //                             lte: addDays(todayStart, -365),
        //                         },
        //                     },
        //                 ],
        //             },
        //             {
        //                 OR: [
        //                     { healthCheckReminderYear: null },
        //                     { healthCheckReminderYear: { lt: currentYear } },
        //                 ],
        //             },
        //         ],
        //     },
        // });

        // ---- Attention widgets
        const ahcDueToday = await prisma.employee.count({
            where: {
                employmentStatus: 'ACTIVE',
                AND: [
                    {
                        OR: [
                            {
                                preEmploymentCheckDate: {
                                    gte: rangeStart,
                                    lte: rangeEnd,
                                },
                            },
                            {
                                preEmploymentCheckDate: null,
                                dateOfJoining: {
                                    gte: rangeStart,
                                    lte: rangeEnd,
                                },
                            },
                        ],
                    },
                    {
                        OR: [
                            { healthCheckReminderYear: null },
                            { healthCheckReminderYear: { lt: currentYear } },
                        ],
                    },
                ],
            },
        });
        console.log('Today IST:', todayStartIST, todayEndIST);
        console.log('Due range UTC:', rangeStart, rangeEnd);

        console.log(ahcDueToday)

        const [attendanceSplit, pendingApprovals, docsExpiring, offersAwaiting, overdueClearances] = await Promise.all([
            // this.countUnmarkedAttendance(employeeIds, todayStart, todayEnd),
            this.getLateAttendanceSplit(employeeIds, todayStart, todayEnd),
            this.countPendingApprovals(employeeIds, todayStart, todayEnd),
            prisma.document.count({
                where: {
                    employeeId: { in: employeeIds },
                    expiryDate: { gte: todayStart, lte: addDays(todayEnd, 30) },
                },
            }),
            // “after SHORTLISTED”, excluding REJECTED, NO_SHOW, HIRED
            prisma.application.count({
                where: {
                    status: {
                        in: [
                            ApplicationStatus.INTERVIEW_SCHEDULED,
                            ApplicationStatus.INTERVIEWED,
                            ApplicationStatus.OFFERED,
                            ApplicationStatus.OFFER_ACCEPTED,
                            // Add WITHDRAWN here only if you want to include those too:
                            // ApplicationStatus.WITHDRAWN,
                        ],
                    },
                    // Optional: limit to last 7 days
                    // createdAt: { gte: addDays(new Date(), -7) },
                },
            }),


            // prisma.resignationClearance.count({
            //     where: { decision: 'PENDING', decidedAt: null, resignation: { status: { in: ['APPROVED', 'UNDER_REVIEW'] } } },
            // }),
            listPendingClearances().then(arr => arr.length),

        ]);
        // const probationSoon = employees.filter((e) => e.probationEndDate && e.probationEndDate <= addDays(todayEnd, 7)).length;
        const probationSoon = employees.filter(
            (e) =>
                e.probationEndDate &&
                e.probationEndDate >= todayStart &&
                e.probationEndDate <= addDays(todayEnd, 7)
        ).length;


        // ---- Recruiting pipeline mini bars
        const pipeline = await this.pipelineMiniBars();

        // ---- People Ops
        const headcount = employees.length;
        const mtdStart = startOfDayIST(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
        const [joinsMTD, exitsMTD, internsActive] = await Promise.all([
            prisma.employee.count({ where: { dateOfJoining: { gte: mtdStart, lte: todayEnd } } }),
            prisma.resignationRequest.count({ where: { actualLastWorkingDay: { gte: mtdStart, lte: todayEnd } } }),
            prisma.internship.count({ where: { status: 'ACTIVE' } }).catch(() => 0), // optional table
        ]);
        const netMovement = joinsMTD - exitsMTD;
        const yearStart = new Date(new Date().getFullYear(), 0, 1);
        const [assigned30, completed30, leavesYTD, policy, shiftToday, fixedShiftCount] = await Promise.all([
            prisma.assignedTest.count({ where: { assignedAt: { gte: addDays(todayStart, -30) } } }),
            prisma.assignedTest.count({ where: { status: { in: ['Completed', 'COMPLETED', 'Done'] } } }),
            prisma.leaveRequest.count({
                where: { employeeId: { in: employeeIds }, status: 'APPROVED', startDate: { gte: yearStart, lte: todayEnd } },
            }),
            prisma.entitlementPolicy.findFirst({ where: { year: new Date().getFullYear() } }),
            prisma.shiftAssignment.count({ where: { employeeId: { in: employeeIds }, date: { gte: todayStart, lte: todayEnd } } }),
            prisma.employeeShiftSetting.count({
                where: { employeeId: { in: employeeIds }, mode: 'FIXED', fixedShiftId: { not: null } },
            }),
        ]);
        const trainCompliance = assigned30 ? Math.round((completed30 / assigned30) * 100) : 0;
        const leavePct = policy?.leaveEntitlement
            ? Math.min(100, Math.round((leavesYTD / (policy.leaveEntitlement * Math.max(1, headcount))) * 100))
            : 0;
        const shiftCoveragePct = headcount ? Math.round(((shiftToday + fixedShiftCount) / headcount) * 100) : 0;

        // -------------------------------
        // 📊 PeopleOps — Recruitment & Training Focused Metrics
        // -------------------------------
        const monthlyStart = startOfMonth(new Date());

        // 1️⃣ Jobs created this month
        const jobsCreatedThisMonth = await prisma.job.count({
            where: { createdAt: { gte: monthlyStart, lte: todayEnd } },
        });

        // 2️⃣ Applications received this month
        const applicantsThisMonth = await prisma.application.count({
            where: { createdAt: { gte: monthlyStart, lte: todayEnd } },
        });

        // 3️⃣ Employees who have pending training (not completed)
        const [clinicalPending, nonClinicalPending, paraMedicalPending] = await Promise.all([
            prisma.employee.count({
                where: {
                    employeeType: 'CLINICAL',
                    AssignedTest: { some: { status: { notIn: ['Completed', 'COMPLETED', 'Done'] } } },
                },
            }),
            prisma.employee.count({
                where: {
                    employeeType: 'NONCLINICAL',
                    AssignedTest: { some: { status: { notIn: ['Completed', 'COMPLETED', 'Done'] } } },
                },
            }),
            prisma.employee.count({
                where: {
                    employeeType: 'PARAMEDICAL',
                    AssignedTest: { some: { status: { notIn: ['Completed', 'COMPLETED', 'Done'] } } },
                },
            }),
        ]);

        // 4️⃣ Employees in notice period this month
        const noticePeriodThisMonth = await prisma.resignationRequest.count({
            where: {
                status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'ON_HOLD', 'APPROVED'] },
                proposedLastWorkingDay: { gte: monthlyStart, lte: todayEnd },
            },
        });


        // ---- Learning & Performance
        const [assignedTestsToday, overdueTests, appSubmitted, waitingMgr, last7Attempts] = await Promise.all([
            prisma.assignedTest.count({ where: { assignedAt: { gte: todayStart, lte: todayEnd } } }),
            prisma.assignedTest.count({
                where: { deadlineDate: { lt: now }, status: { notIn: ['Completed', 'COMPLETED', 'Done'] } },
            }),
            prisma.appraisalForm.count({ where: { status: { in: ['Reviewed'] } } }),
            prisma.appraisalForm.count({ where: { status: { in: ['Draft'] } } }),
            prisma.evaluationAttempt.findMany({ where: { createdAt: { gte: addDays(todayStart, -7) } }, select: { score: true } }),
        ]);
        const avgScore7d = last7Attempts.length
            ? Math.round(last7Attempts.reduce((s, a) => s + (a.score || 0), 0) / last7Attempts.length)
            : 0;
        const monthStart = startOfMonth(now);
        const monthEnd = endOfMonth(now);
        // ---- Learning & Performance (custom business metrics)
        const employeesForAppraisal = await prisma.employee.findMany({
            where: { employmentStatus: 'ACTIVE', id: { in: employeeIds } },
            select: { id: true, dateOfJoining: true },
        });

        const eligibleThisMonth = employeesForAppraisal.filter(emp => {
            const monthsWorked =
                (now.getFullYear() - emp.dateOfJoining.getFullYear()) * 12 +
                (now.getMonth() - emp.dateOfJoining.getMonth());
            return monthsWorked > 0 && monthsWorked % 3 === 0; // every 3 months cycle
        });
        const eligibleIds = eligibleThisMonth.map(e => e.id);

        // Appraisals in this month
        const [appraisalPendingMgr, appraisalSubmitted, resignationNoExit, missingDocs] = await Promise.all([
            prisma.appraisalForm.count({
                where: {
                    employeeId: { in: eligibleIds },
                    status: { in: ['Draft', 'Pending Manager Review'] },
                    updatedAt: { gte: startOfMonth(now), lte: endOfMonth(now) },
                },
            }),
            prisma.appraisalForm.count({
                where: {
                    employeeId: { in: eligibleIds },
                    status: { in: ['Submitted', 'Reviewed'] },
                    updatedAt: { gte: startOfMonth(now), lte: endOfMonth(now) },
                },
            }),
            prisma.exitInterview.count({
                where: {
                    completedAt: null
                },
            }),
            (async () => {
                const allEmp = await prisma.employee.findMany({
                    where: { id: { in: employeeIds } },
                    select: {
                        id: true,
                        employeeType: true,
                        experienceType: true,
                        documents: {
                            select: { title: true }
                        },
                        qualifications: {
                            select: { degree: true }
                        }

                    },
                });
                const mandatoryDocs = ['AADHAAR', 'PAN', 'BANK'];
                const missingDocs = allEmp.filter(emp => {
                    const missing = getMissingMandatoryDocs(emp);
                    return missing.length > 0;
                }).length;
                 return missingDocs;
            })(),
        ]);


        // ---- Security & Access
        const [bagSuspicious7d, failedLogins24h, unreadNotifications] = await Promise.all([
            prisma.bagCheck.count({ where: { date: { gte: addDays(todayStart, -7) }, result: 'SUSPICIOUS' } }),
            prisma.loginHistory.count({ where: { attemptedAt: { gte: addDays(now, -1) }, success: false } }),
            prisma.notification.count({ where: { isRead: false } }),
        ]);

        // ---- Drilldown lists (for modals)
        const lists = await this.getAllLists(todayStart, todayEnd);
        const attention: Array<{ label: string; count: number; severity: string; modal: string }> = [
            // { label: 'Attendance not marked (by 11:00)', count: unmarkedCount, severity: 'danger', modal: 'unmarked' },
            { label: 'Clinical staff late (>15min)', count: attendanceSplit.clinicalNotCheckedIn, severity: attendanceSplit.clinicalNotCheckedIn ? 'warn' : 'good', modal: 'clinicalLate' },
            { label: 'Non-clinical staff late (>15min)', count: attendanceSplit.nonClinicalNotCheckedIn, severity: attendanceSplit.nonClinicalNotCheckedIn ? 'warn' : 'good', modal: 'nonClinicalLate' },
            { label: 'Paramedical staff late(>15min)', count: attendanceSplit.paraMedicalNotCheckedIn, severity: attendanceSplit.paraMedicalNotCheckedIn ? 'warn' : 'good', modal: 'paraMedicalNotCheckedIn' },
            { label: 'Pending leave/permission', count: pendingApprovals, severity: 'warn', modal: 'approvals' },

            { label: 'Probation ending soon (7 days)', count: probationSoon, severity: 'warn', modal: 'probation' },
            { label: 'Contracts expiring soon (30 days)', count: docsExpiring, severity: 'warn', modal: 'docs' },
            { label: 'Applicants waiting in pipeline (7 days)', count: offersAwaiting, severity: 'warn', modal: 'offersPendingSignature' },
            { label: 'Overdue exit clearances', count: overdueClearances, severity: 'danger', modal: 'clearances' },
            {
                label: 'Annual health checkup due (7 days)',
                count: ahcDueToday,
                severity: ahcDueToday ? 'warn' : 'good',
                modal: 'ahc',
            }

        ];

        // now add OT pending (HR sees only manager-approved records)
        const otPending = await prisma.overtimeApproval.count({
            where: { status: 'PENDING', managerStatus: 'APPROVED', date: yesterdayStart, minutes: { gt: 60 } } as any
        });

        attention.push({
            label: 'Overtime approvals pending (yesterday)',
            count: otPending,
            severity: otPending ? 'warn' : 'good',
            modal: 'otPending',
        });

        // Manager sees OT pending their own approval
        const userRoleId = (req as any).user?.roleId;
        const userEmpId = (req as any).user?.empId;
        if (userRoleId === 3 && userEmpId) {
            const managerOtPending = await prisma.overtimeApproval.count({
                where: {
                    managerStatus: 'PENDING',
                    date: yesterdayStart,
                    minutes: { gt: 60 },
                    employee: { reportingManager: userEmpId },
                } as any,
            });
            attention.push({
                label: 'OT pending your approval (yesterday)',
                count: managerOtPending,
                severity: managerOtPending ? 'warn' : 'good',
                modal: 'managerOtPending',
            });
        }


        res.json({
            today: {
                leaves: leavesToday,
                permissions: permissionsToday,
                late,
                otYesterday,
                newJoiners,
                birthdays,
                anniversaries,
                interviewsToday: interviewsToday,
                announcementsAck: Math.round(ackRate * 100) / 100,
            },
            announcements: announcementStats,
            latestAnnouncement: announcementStats[0] || null,
            attention,
            pipeline,
            // peopleOps: [
            //     ['Active employees', String(headcount)],
            //     ['Staff change (this month)', (netMovement >= 0 ? '▲ +' : '▼ ') + netMovement, netMovement >= 0 ? 'good' : 'danger'],
            //     ['Active interns', String(internsActive)],
            //     ['Training completion rate', `${trainCompliance}%`, trainCompliance >= 85 ? 'good' : trainCompliance >= 70 ? 'warn' : 'danger'],
            //     ['Leave used (%)', `${leavePct}% used`],
            //     ['Shift coverage today', `${shiftCoveragePct}%`, shiftCoveragePct >= 90 ? 'good' : shiftCoveragePct >= 75 ? 'warn' : 'danger'],
            // ],

            peopleOps: [
                ['Active employees size', String(headcount)],
                ['New job posts (this month)', String(jobsCreatedThisMonth)],
                ['Applications received (this month)', String(applicantsThisMonth)],
                ['Clinical staff pending training', String(clinicalPending), clinicalPending ? 'warn' : 'good'],
                ['Non-clinical staff pending training', String(nonClinicalPending), nonClinicalPending ? 'warn' : 'good'],
                ['Para Medical staff pending training', String(paraMedicalPending), paraMedicalPending ? 'warn' : 'good'],
                ['Employees in notice period (this month)', String(noticePeriodThisMonth), noticePeriodThisMonth ? 'warn' : 'good'],
            ],

            // learnPerf: [
            //     ['Tests assigned today', String(assignedTestsToday)],
            //     ['Overdue tests', String(overdueTests), overdueTests ? 'warn' : 'good'],
            //     ['Submitted appraisals', String(appSubmitted)],
            //     ['Pending Manager Review', String(waitingMgr), waitingMgr ? 'warn' : 'good'],
            //     ['Avg test score (last 7 days)', `${avgScore7d}%`, avgScore7d >= 70 ? 'good' : avgScore7d >= 50 ? 'warn' : 'danger'],
            // ],
            learnPerf: [
                ['Employees eligible for appraisal (this month)', String(eligibleIds.length)],
                ['Pending Manager Review', String(appraisalPendingMgr), appraisalPendingMgr ? 'warn' : 'good'],
                ['Submitted appraisals', String(appraisalSubmitted)],
                ['Resignation - Exit form not filled', String(resignationNoExit), resignationNoExit ? 'warn' : 'good'],
                ['Employees missing mandatory documents', String(missingDocs), missingDocs ? 'warn' : 'good'],
            ],


            secAccess: [
                ['Bag-check suspicious (7d)', String(bagSuspicious7d), bagSuspicious7d ? 'danger' : 'good'],
                ['Failed logins (24h)', String(failedLogins24h), failedLogins24h ? 'warn' : 'good'],
                ['Unread notifications', String(unreadNotifications)],
            ],
            lists,
        });
    });

    downloadMissingDocs = asyncHandler(async (req, res) => {
        const employees = await prisma.employee.findMany({
            where: { employmentStatus: 'ACTIVE' },
            include: {
                documents: true,
                qualifications: true,
            },
        });

        const rows = employees
            .map(emp => {
                const missing = getMissingMandatoryDocs(emp);

                return {
                    employeeName: `${emp.firstName} ${emp.lastName}`,
                    employeeCode: emp.employeeCode,
                    employeeType: emp.employeeType,
                    experienceType: emp.experienceType || '-',
                    missingDocs: missing.join(', '),
                };
            })
            .filter(row => row.missingDocs.length > 0);

        // Create Excel
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Missing Documents');

        sheet.columns = [
            { header: 'Employee Name', key: 'employeeName', width: 25 },
            { header: 'Employee Code', key: 'employeeCode', width: 20 },
            { header: 'Employee Type', key: 'employeeType', width: 15 },
                { header: 'Experience Type', key: 'experienceType', width: 20 },
            { header: 'Missing Documents', key: 'missingDocs', width: 40 },
        ];

        sheet.addRows(rows);

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            'attachment; filename=missing_documents.xlsx'
        );

        await workbook.xlsx.write(res);
        res.end();
    });


    /** GET /api/dashboard/list?key=unmarked|approvals|probation|docs|feedback|clearances */
    getList = asyncHandler(async (req, res) => {
        const { key, id, departmentId } = (req.query || {}) as { key?: string; id?: string; departmentId?: string };
        if (!key) return res.status(400).json({ error: 'Missing query param: key' });
        const start = startOfDayIST();
        const end = endOfDayIST();
        const base: Record<any, List> = await this.getAllLists(start, end);
        const yesterdayStart: Date = startOfDayIST(addDays(new Date(), -1));
        const yesterdayEnd: Date = endOfDayIST(addDays(new Date(), -1));
        // ----- NEW: tile-specific lists -----
        if (key === 'annAck') {
            if (!id) return res.status(400).json({ error: 'Missing query param: id (announcementId)' });

            const ann = await prisma.announcement.findUnique({
                where: { id: Number(id) },
                select: { id: true, title: true, audience: true },
            });
            if (!ann) return res.status(404).json({ error: 'Announcement not found' });

            const filt = parseAud(ann.audience);

            // All ACTIVE employees inside the announcement audience
            const whereEmp: Prisma.EmployeeWhereInput = {
                employmentStatus: 'ACTIVE',
                ...(filt?.all ? {} : {}),
                ...(filt?.departmentId?.length ? { departmentId: { in: filt.departmentId } } : {}),
                ...(filt?.branchId?.length ? { branchId: { in: filt.branchId } } : {}),
                ...(filt?.roleId?.length ? { roleId: { in: filt.roleId } } : {}),
                ...(filt?.employeeId?.length ? { id: { in: filt.employeeId } } : {}),
            };

            const employees = await prisma.employee.findMany({
                where: whereEmp,
                select: {
                    id: true,
                    departmentId: true,
                    Department: { select: { id: true, name: true } },
                },
            });

            const empIds = employees.map(e => e.id);

            // All ACKs for this announcement
            const acks = await prisma.announcementAck.findMany({
                where: { announcementId: Number(id), employeeId: { in: empIds.length ? empIds : [-1] } },
                select: { employeeId: true },
            });
            const ackSet = new Set(acks.map(a => a.employeeId));

            // Aggregate by department
            type Row = { deptId: number | null; deptName: string; audience: number; acked: number; pending: number; pct: number };
            const map = new Map<number | null, Row>();

            for (const e of employees) {
                const key = e.departmentId ?? null;
                const name = e.Department?.name || '—';
                if (!map.has(key)) map.set(key, { deptId: key, deptName: name, audience: 0, acked: 0, pending: 0, pct: 0 });
                const row = map.get(key)!;
                row.audience += 1;
                if (ackSet.has(e.id)) row.acked += 1; else row.pending += 1;
            }

            // finalize pct
            for (const r of map.values()) {
                r.pct = r.audience ? Math.round((r.acked / r.audience) * 100) : 0;
            }

            // sort: lowest % first (so lagging depts bubble up)
            const rows = Array.from(map.values())
                .sort((a, b) => a.pct - b.pct || a.deptName.localeCompare(b.deptName))
                .map(r => [r.deptName, String(r.audience), String(r.acked), String(r.pending), `${r.pct}%`]);

            return res.json({
                title: `Acknowledgements — ${ann.title}`,
                cols: ['Department', 'Audience', 'Acked', 'Pending', 'Ack %'],
                rows,
                actions: ['View pending'],
                selectable: true
            });
        }

        // -------------------------------------------
        // NEW: Drilldown of not-acknowledged employees (optional filter by department)
        // GET /api/list?key=annAckPending&id=<announcementId>&departmentId=<deptId?>    (deptId optional)
        if (key === 'annAckPending') {
            if (!id) return res.status(400).json({ error: 'Missing query param: id (announcementId)' });

            const ann = await prisma.announcement.findUnique({
                where: { id: Number(id) },
                select: { id: true, title: true, audience: true },
            });
            if (!ann) return res.status(404).json({ error: 'Announcement not found' });

            const filt = parseAud(ann.audience);

            // Audience filter + optional department filter for drilldown
            const whereEmp: Prisma.EmployeeWhereInput = {
                employmentStatus: 'ACTIVE',
                ...(filt?.all ? {} : {}),
                ...(filt?.departmentId?.length ? { departmentId: { in: filt.departmentId } } : {}),
                ...(filt?.branchId?.length ? { branchId: { in: filt.branchId } } : {}),
                ...(filt?.roleId?.length ? { roleId: { in: filt.roleId } } : {}),
                ...(filt?.employeeId?.length ? { id: { in: filt.employeeId } } : {}),
                ...(departmentId ? { departmentId: Number(departmentId) } : {}), // drilldown override
            };

            const employees = await prisma.employee.findMany({
                where: whereEmp,
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phone: true,
                    employeeCode: true,
                    Department: { select: { id: true, name: true } },
                    reportingManager: true,
                },
                take: 5000,
            });

            const mgrMap = await buildManagerNameMap(employees.map(e => e.reportingManager as number | null));

            const empIds = employees.map(e => e.id);

            const acks = await prisma.announcementAck.findMany({
                where: { announcementId: Number(id), employeeId: { in: empIds.length ? empIds : [-1] } },
                select: { employeeId: true },
            });
            const ackSet = new Set(acks.map(a => a.employeeId));

            // Filter who hasn't acknowledged
            const pending = employees.filter(e => !ackSet.has(e.id));

            const rows = pending.map(p => [
                `${p.firstName} ${p.lastName}`,
                p.employeeCode || '—',
                p.Department?.name || '—',
                p.email || '—',
                p.phone || '—',
                mgrMap.get(p.reportingManager as number) || '—',
            ]);

            return res.json({
                title: `Pending Acknowledgements — ${ann.title}` + (departmentId ? ` (Dept ${departmentId})` : ''),
                cols: ['Employee', 'EMP ID', 'Department', 'Email', 'Phone', 'Manager'],
                rows,
                // actions: ['Remind all', 'Export'],
                actions: [],
                selectable: true
            });
        }
        if (key === 'ahc') {
            const todayStart = startOfDayIST(new Date());
            const todayEnd = endOfDayIST(new Date());
            const currentYear = new Date().getFullYear();
            const todayStartIST = startOfDayIST(); // 2025-01-09 00:00 IST
            const todayEndIST = endOfDayIST();     // 2025-01-09 23:59 IST
            const windowStart = addDays(todayStartIST, -372); // 365 + 7
            const windowEnd = addDays(todayEndIST, -358);     // 365 - 7

            // normalize (always do this)
            const rangeStart = windowStart < windowEnd ? windowStart : windowEnd;
            const rangeEnd = windowStart < windowEnd ? windowEnd : windowStart;

            // const employees = await prisma.employee.findMany({
            //     where: {
            //         employmentStatus: 'ACTIVE',
            //         AND: [
            //             {
            //                 OR: [
            //                     {
            //                         preEmploymentCheckDate: {
            //                             lte: addDays(start, -365),
            //                         },
            //                     },
            //                     {
            //                         preEmploymentCheckDate: null,
            //                         dateOfJoining: {
            //                             lte: addDays(start, -365),
            //                         },
            //                     },
            //                 ],
            //             },
            //             {
            //                 OR: [
            //                     { healthCheckReminderYear: null },
            //                     { healthCheckReminderYear: { lt: currentYear } },
            //                 ],
            //             },
            //         ],
            //     },
            //     select: {
            //         id: true,
            //         firstName: true,
            //         lastName: true,
            //         employeeCode: true,
            //         Department: { select: { name: true } },
            //         preEmploymentCheckDate: true,
            //         dateOfJoining: true,
            //         healthCheckReminderYear: true,
            //     },
            //     take: 500,
            // });
            const employees = await prisma.employee.findMany({
                where: {
                    employmentStatus: 'ACTIVE',
                    AND: [
                        {
                            OR: [
                                {
                                    preEmploymentCheckDate: {
                                        gte: rangeStart,
                                        lte: rangeEnd,
                                    },
                                },
                                {
                                    preEmploymentCheckDate: null,
                                    dateOfJoining: {
                                        gte: rangeStart,
                                        lte: rangeEnd,
                                    },
                                },
                            ],
                        },
                        {
                            OR: [
                                { healthCheckReminderYear: null },
                                { healthCheckReminderYear: { lt: currentYear } },
                            ],
                        },
                    ],
                },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    employeeCode: true,
                    Department: { select: { name: true } },
                    preEmploymentCheckDate: true,
                    dateOfJoining: true,
                    healthCheckReminderYear: true,
                },
            });

            const rows = employees.map(e => ({
                id: e.id,
                data: [
                    `${e.firstName} ${e.lastName}`,
                    e.employeeCode || '—',
                    e.Department?.name || '—',
                    e.preEmploymentCheckDate
                        ? fmtDate(e.preEmploymentCheckDate)
                        : fmtDate(e.dateOfJoining),
                    e.healthCheckReminderYear
                        ? String(e.healthCheckReminderYear)
                        : 'Never',
                ],
            }));

            return res.json({
                title: 'Annual Health Checkup Due (7 days)',
                cols: [
                    'Employee',
                    'EMP ID',
                    'Department',
                    'Last Health Check / DOJ',
                    'Last Reminder Year',
                ],
                rows,
                // actions: ['Send reminder', 'Mark completed'],
                actions: [],
                selectable: true,
            });
        }


        if (key === 'interviewsToday') {
            const items = await prisma.interview.findMany({
                where: {
                    startTime: { gte: start, lte: end },
                },
                orderBy: { startTime: 'asc' },
                take: 100,
            });

            const appIds = items.map(i => i.applicationId);
            const applications = await prisma.application.findMany({
                where: { id: { in: appIds } },
                include: {
                    candidate: { select: { name: true, email: true, phone: true } },
                    job: { select: { title: true } },
                },
            });
            const appMap = new Map(applications.map(a => [a.id, a]));

            const rows = items.map(i => {
                const app = appMap.get(i.applicationId);
                return [
                    app?.candidate?.name ?? '—',
                    app?.job?.title ?? '—',
                    i.stage ?? '—',
                    fmtTime(i.startTime),
                    fmtTime(i.endTime),
                    i.result ?? '—',
                ];
            });

            return res.json({
                title: 'Interviews Scheduled Today',
                cols: ['Candidate', 'Job Title', 'Stage', 'Start', 'End', 'Result'],
                rows,
                // actions: ['Message', 'Reschedule'],
                actions: [],
            });
        }


        // Leaves (approved & overlapping today)
        if (key === 'leaves') {
            const items = await prisma.leaveRequest.findMany({
                where: {
                    status: 'APPROVED',
                    OR: [
                        { startDate: { lte: end }, endDate: { gte: start } },
                        { startDate: { lte: end }, endDate: start },
                    ],
                },
                include: {
                    employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } },
                    leaveType: { select: { name: true } },
                },
                take: 100,
            });

            const rows = items.map(x => [
                `${x.employee.firstName} ${x.employee.lastName}`,
                x.leaveType?.name ?? '—',
                x.employee.employeeCode || '—',
                x.employee.Department?.name || '—',
                fmtDate(x.startDate) + ' → ' + fmtDate(x.endDate),
                'Approved',
            ]);
            return res.json({
                title: 'Leaves Today', cols: ['Employee', 'Type', 'EMP ID', 'Dept', 'Dates', 'Status'], rows,
                //  actions: ['Message'] 
                actions: [],
            });
        }

        // WFH (approved & overlapping today)
        if (key === 'wfh') {
            const items = await prisma.wFHRequest.findMany({
                where: {
                    status: 'APPROVED',
                    OR: [
                        { startDate: { lte: end }, endDate: { gte: start } },
                        { startDate: { lte: end }, endDate: start },
                    ],
                },
                include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } } },
                take: 100,
            });
            const rows = items.map(x => [
                `${x.employee.firstName} ${x.employee.lastName}`,
                x.employee.employeeCode || '—',
                x.employee.Department?.name || '—',
                fmtDate(x.startDate) + ' → ' + fmtDate(x.endDate),
                'Approved',
            ]);
            return res.json({
                title: 'WFH Today', cols: ['Employee', 'EMP ID', 'Dept', 'Window', 'Status'], rows,
                //  actions: ['Message']
                actions: [],
            });
        }

        // Permissions (approved & today overlap)
        if (key === 'permissions') {
            const items = await prisma.permissionRequest.findMany({
                where: {
                    status: 'APPROVED',
                    OR: [
                        { day: { gte: start, lte: end } },
                        { startTime: { lte: end }, endTime: { gte: start } },
                    ],
                },
                include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } } },
                take: 100,
            });
            const rows = items.map(x => [
                `${x.employee.firstName} ${x.employee.lastName}`,
                x.employee.employeeCode || '—',
                x.employee.Department?.name || '—',
                x.timing ?? '—',
                x.startTime || x.endTime ? `${fmtTime(x.startTime)}–${fmtTime(x.endTime)}` : fmtDate(x.day),
                'Approved',
            ]);
            return res.json({
                title: 'Permissions Today', cols: ['Employee', 'EMP ID', 'Dept', 'Timing', 'Window/Day', 'Status'], rows,
                //  actions: ['Message'] 
                actions: [],
            });
        }

        // Late Arrivals (today) — matches your "rotational can use any shift" rule
        // if (key === 'late') {
        //     // attendance + shift settings
        //     const [att, settings] = await Promise.all([
        //         prisma.attendance.findMany({
        //             where: { date: { gte: start, lte: end }, checkIn: { not: null } },
        //             select: { employeeId: true, checkIn: true, employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } } },
        //         }),
        //         prisma.employeeShiftSetting.findMany({
        //             select: {
        //                 employeeId: true,
        //                 mode: true,
        //                 fixedShift: { select: { id: true, startTime: true } },
        //                 rotationPattern: {
        //                     select: { items: { select: { shift: { select: { id: true, startTime: true } } } } },
        //                 },
        //             },
        //         }),
        //     ]);

        //     const combineDateAndTime = (base: Date, t: Date) => {
        //         const dt = new Date(base), tt = new Date(t);
        //         dt.setHours(tt.getHours(), tt.getMinutes(), 0, 0);
        //         return dt;
        //     };
        //     const shiftType = new Map<number, 'General' | 'Rotational'>();
        //     for (const s of settings) {
        //         shiftType.set(s.employeeId, s.mode === 'ROTATIONAL' ? 'Rotational' : 'General');
        //     }

        //     const cands = new Map<number, Date[]>();
        //     for (const s of settings) {
        //         if (s.mode === 'FIXED' && s.fixedShift?.startTime) {
        //             cands.set(s.employeeId, [combineDateAndTime(start, s.fixedShift.startTime)]);
        //         } else if (s.mode === 'ROTATIONAL' && s.rotationPattern?.items?.length) {
        //             const m = new Map<number, Date>();
        //             for (const it of s.rotationPattern.items) {
        //                 const sh = it.shift;
        //                 if (sh?.id && sh.startTime) m.set(sh.id, combineDateAndTime(start, sh.startTime));
        //             }
        //             cands.set(s.employeeId, [...m.values()]);
        //         }
        //     }

        //     const rows: string[][] = [];
        //     for (const r of att) {
        //         const list = cands.get(r.employeeId) ?? [];
        //         let bestLate: { mins: number, sched: Date } | null = null;
        //         for (const sdt of list) {
        //             const diff = Math.round((r.checkIn!.getTime() - sdt.getTime()) / 60000);
        //             if (diff > 0) {
        //                 if (!bestLate || diff < bestLate.mins) bestLate = { mins: diff, sched: sdt };
        //             }
        //         }
        //         if (bestLate) {
        //             rows.push([
        //                 `${r.employee.firstName} ${r.employee.lastName}`,
        //                 r.employee.employeeCode || '—',
        //                 r.employee.Department?.name || '—',
        //                 shiftType.get(r.employeeId) || 'General',
        //                 fmtTime(bestLate.sched),
        //                 fmtTime(r.checkIn!),
        //                 String(bestLate.mins),
        //             ]);
        //         }
        //     }
        //     // sort by most late
        //     rows.sort((a, b) => Number(b[3]) - Number(a[3]));
        //     return res.json({ title: 'Late Arrivals', cols: ['Employee', 'EMP ID', 'Dept', 'Shift Type', 'Scheduled', 'Check-in', 'Late (mins)'], rows, actions: ['Notify all'] });
        // }
        // if (key === 'late') {
        //     const [att, assignments] = await Promise.all([
        //         prisma.attendance.findMany({
        //             where: { date: { gte: start, lte: end }, checkIn: { not: null } },
        //             select: {
        //                 employeeId: true,
        //                 checkIn: true,
        //                 employee: {
        //                     select: {
        //                         firstName: true,
        //                         lastName: true,
        //                         employeeCode: true,
        //                         employeeType: true,
        //                         Department: { select: { name: true } },
        //                     },
        //                 },
        //             },
        //         }),

        //         prisma.shiftAssignment.findMany({
        //             where: { date: { gte: start, lte: end } },
        //             select: {
        //                 employeeId: true,
        //                 shift: { select: { startTime: true, name: true } },
        //             },
        //         }),
        //     ]);

        //     const shiftStartMap = new Map<number, Date>();
        //     for (const a of assignments) {
        //         const st = combineDateAndTime(start, a.shift.startTime);
        //         if (st) shiftStartMap.set(a.employeeId, st);
        //     }

        //     const rows: string[][] = [];

        //     for (const r of att) {
        //         const shiftStart = shiftStartMap.get(r.employeeId);
        //         if (!shiftStart) continue;

        //         const diff = Math.round(
        //             (r.checkIn!.getTime() - shiftStart.getTime()) / 60000
        //         );

        //         if (diff > 15) {
        //             rows.push([
        //                 `${r.employee.firstName} ${r.employee.lastName}`,
        //                 r.employee.employeeCode || '—',
        //                 r.employee.Department?.name || '—',
        //                 r.employee.employeeType === 'CLINICAL' ? 'Clinical' : 'Non-clinical',
        //                 fmtTime(shiftStart),
        //                 fmtTime(r.checkIn!),
        //                 String(diff),
        //             ]);
        //         }
        //     }

        //     rows.sort((a, b) => Number(b[6]) - Number(a[6]));

        //     return res.json({
        //         title: 'Late Arrivals',
        //         cols: ['Employee', 'EMP ID', 'Dept', 'Type', 'Scheduled', 'Check-in', 'Late (mins)'],
        //         rows,
        //         actions: ['Notify all'],
        //     });
        // }

        if (key === 'late') {
            const items = await prisma.lateLoginLog.findMany({
                where: {
                    date: { gte: start, lte: end },
                    lateMinutes: { gt: 15 },
                },
                include: {
                    employee: {
                        select: {
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            employeeType: true,
                            Department: { select: { name: true } },
                        },
                    },
                },
                orderBy: { lateMinutes: 'desc' },
            });

            const rows = items.map((l: any) => [
                `${l.employee.firstName} ${l.employee.lastName}`,
                l.employee.employeeCode || '—',
                l.employee.Department?.name || '—',
                l.employee.employeeType || '—',
                fmtTime(l.shiftStart),
                fmtTime(l.checkIn),
                `${l.lateMinutes}`,
            ]);

            return res.json({
                title: 'Late Arrivals',
                cols: ['Employee', 'EMP ID', 'Dept', 'Type', 'Scheduled In', 'Actual In', 'Late (mins)'],
                rows,
                // actions: ['Notify all'],
                actions: [],
            });
        }

        // OT Yesterday (best match end; handles overnight)
        // if (key === 'ot') {
        //     const [att, settings] = await Promise.all([
        //         prisma.attendance.findMany({
        //             where: { date: { gte: yesterdayStart, lte: yesterdayEnd }, checkOut: { not: null } },
        //             select: { employeeId: true, checkOut: true, employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } } },
        //         }),
        //         prisma.employeeShiftSetting.findMany({
        //             select: {
        //                 employeeId: true,
        //                 mode: true,
        //                 fixedShift: { select: { id: true, startTime: true, endTime: true } },
        //                 rotationPattern: {
        //                     select: { items: { select: { shift: { select: { id: true, startTime: true, endTime: true } } } } },
        //                 },
        //             },
        //         }),
        //     ]);

        //     const combine = (base: Date, t: Date) => {
        //         const dt = new Date(base), tt = new Date(t);
        //         dt.setHours(tt.getHours(), tt.getMinutes(), 0, 0);
        //         return dt;
        //     };
        //     const overnightEnd = (ys: Date, st: Date, et: Date) => {
        //         const start = combine(ys, st);
        //         const end = combine(ys, et);
        //         const sH = new Date(st).getHours(), sM = new Date(st).getMinutes();
        //         const eH = new Date(et).getHours(), eM = new Date(et).getMinutes();
        //         if (eH < sH || (eH === sH && eM < sM)) end.setDate(end.getDate() + 1);
        //         return end;
        //     };

        //     const shiftType = new Map<number, 'General' | 'Rotational'>();
        //     for (const s of settings) {
        //         shiftType.set(s.employeeId, s.mode === 'ROTATIONAL' ? 'Rotational' : 'General');
        //     }
        //     const cands = new Map<number, Date[]>(); // employeeId -> candidate scheduled end times
        //     for (const s of settings) {
        //         const ends: Date[] = [];
        //         if (s.mode === 'FIXED' && s.fixedShift?.startTime && s.fixedShift?.endTime) {
        //             ends.push(overnightEnd(yesterdayStart, s.fixedShift.startTime, s.fixedShift.endTime));
        //         } else if (s.mode === 'ROTATIONAL' && s.rotationPattern?.items?.length) {
        //             const seen = new Set<number>();
        //             for (const it of s.rotationPattern.items) {
        //                 const sh = it.shift;
        //                 if (!sh?.id || !sh.startTime || !sh.endTime || seen.has(sh.id)) continue;
        //                 seen.add(sh.id);
        //                 ends.push(overnightEnd(yesterdayStart, sh.startTime, sh.endTime));
        //             }
        //         }
        //         if (ends.length) cands.set(s.employeeId, ends);
        //     }

        //     const rows: string[][] = [];
        //     for (const r of att) {
        //         const list = (cands.get(r.employeeId) ?? []);
        //         let best: { mins: number, sched: Date } | null = null;
        //         for (const se of list) {
        //             const diff = Math.round((r.checkOut!.getTime() - se.getTime()) / 60000);
        //             if (diff > 0 && (!best || diff < best.mins)) best = { mins: diff, sched: se };
        //         }
        //         if (best) {
        //             rows.push([
        //                 `${r.employee.firstName} ${r.employee.lastName}`,
        //                 r.employee.employeeCode || '—',
        //                 r.employee.Department?.name || '—',
        //                 shiftType.get(r.employeeId) || 'General',
        //                 fmtTime(best.sched),
        //                 fmtTime(r.checkOut!),
        //                 String(best.mins),
        //             ]);
        //         }
        //     }
        //     // sort by highest OT
        //     rows.sort((a, b) => Number(b[3]) - Number(a[3]));
        //     return res.json({ title: 'OT Yesterday', cols: ['Employee', 'EMP ID', 'Dept', 'Shift Type', 'Sched End', 'Check-out', 'OT (mins)'], rows, actions: ['Export'] });
        // }
        // if (key === 'ot') {
        //     // 1) Approved OTs from yesterday
        //     const items = await prisma.overtimeApproval.findMany({
        //         where: { status: 'APPROVE', date: yesterdayStart },
        //         include: {
        //             employee: {
        //                 select: {
        //                     id: true,
        //                     firstName: true,
        //                     lastName: true,
        //                     employeeCode: true,
        //                     Department: { select: { name: true } },
        //                 },
        //             },
        //         },
        //         orderBy: { minutes: 'desc' },
        //     });

        //     // 2) Lookup shift types for those employees
        //     const empIds = items.map(o => o.employee.id);
        //     const settings = await prisma.employeeShiftSetting.findMany({
        //         where: { employeeId: { in: empIds } },
        //         select: { employeeId: true, mode: true },
        //     });
        //     const shiftTypeMap = new Map<number, string>();
        //     for (const s of settings) {
        //         shiftTypeMap.set(s.employeeId, s.mode === 'ROTATIONAL' ? 'Rotational' : 'General');
        //     }

        //     // 3) Build rows
        //     const rows = items.map(o => [
        //         `${o.employee.firstName} ${o.employee.lastName}`,
        //         o.employee.employeeCode || '—',
        //         o.employee.Department?.name || '—',
        //         shiftTypeMap.get(o.employee.id) || 'General',
        //         fmtTime(o.scheduledEnd),
        //         fmtTime(o.checkOut),
        //         `${Math.floor(o.minutes / 60)}h ${o.minutes % 60}m`,
        //     ]);

        //     return res.json({
        //         title: 'OT Yesterday',
        //         cols: ['Employee', 'EMP ID', 'Dept', 'Shift Type', 'Sched End', 'Check-out', 'OT Duration'],
        //         rows,
        //         actions: ['Export'],
        //         selectable: true
        //     });
        // }


        if (key === 'ot') {
            const items = await prisma.overtimeApproval.findMany({
                where: { status: 'APPROVED', date: yesterdayStart },
                include: {
                    employee: {
                        select: {
                            firstName: true,
                            lastName: true,
                            employeeCode: true,
                            employeeType: true,
                            Department: { select: { name: true } },
                        },
                    },
                },
                orderBy: { minutes: 'desc' },
            });

            const rows = items.map(o => [
                `${o.employee.firstName} ${o.employee.lastName}`,
                o.employee.employeeCode || '—',
                o.employee.Department?.name || '—',
                o.employee.employeeType,
                fmtTime(o.scheduledEnd),
                fmtTime(o.checkOut),
                `${Math.floor(o.minutes / 60)}h ${o.minutes % 60}m`,
            ]);

            return res.json({
                title: 'OT Yesterday',
                cols: ['Employee', 'EMP ID', 'Dept', 'Type', 'Sched End', 'Check-out', 'OT Duration'],
                rows,
                // actions: ['Export'],
                actions: [],
                selectable: true,
            });
        }

        // New Joiners / Birthdays / Anniversaries (sameMonthDay as in your summary)
        if (key === 'joiners' || key === 'birthdays' || key === 'anniversaries') {
            const people = await prisma.employee.findMany({
                where: { employmentStatus: 'ACTIVE' },
                include: { Department: true },
                take: 5000, // safety cap
            });

            const rows: string[][] = [];
            for (const e of people) {
                if (key === 'joiners' && sameYMD(e.dateOfJoining, start)) {
                    rows.push([`${e.firstName} ${e.lastName}`, e.employeeCode || '—', e.Department?.name || '—', fmtDate(e.dateOfJoining)]);
                }
                if (key === 'birthdays' && sameMonthDay(e.dob, start)) {
                    rows.push([`${e.firstName} ${e.lastName}`, e.employeeCode || '—', e.Department?.name || '—', fmtDate(e.dob)]);
                }
                if (
                    key === 'anniversaries' &&
                    e.dateOfJoining &&
                    sameMonthDay(e.dateOfJoining, start) &&
                    (start.getFullYear() - new Date(e.dateOfJoining).getFullYear()) >= 1 // ✅ at least 1 year completed
                ) {
                    rows.push([
                        `${e.firstName} ${e.lastName}`,
                        e.employeeCode || '—',
                        e.Department?.name || '—',
                        fmtDate(e.dateOfJoining)
                    ]);
                }

            }

            const titles: Record<string, string> = {
                joiners: 'New Joiners Today', birthdays: 'Birthdays Today', anniversaries: 'Anniversaries Today',
            };
            return res.json({
                title: titles[key], cols: ['Employee', 'EMP ID', 'Dept', 'Date'], rows,
                //  actions: ['Congratulate
                // '] 
                actions: [],
            });
        }
        // add a new key
        if (key === 'offersPendingSignature') {
            // Option A: define exactly which statuses you consider "after shortlisted"
            const allowed = [
                ApplicationStatus.INTERVIEW_SCHEDULED,
                ApplicationStatus.INTERVIEWED,
                ApplicationStatus.OFFERED,
                ApplicationStatus.OFFER_ACCEPTED,
                ApplicationStatus.OFFER_DECLINED,
                // ApplicationStatus.WITHDRAWN, // remove if you don't want withdrawn
            ];

            const where = {
                status: { in: allowed },
                // createdAt: { gte: addDays(new Date(), -7) }, // uncomment for last 7 days
            };

            const [items, total] = await Promise.all([
                prisma.application.findMany({
                    where,
                    select: {
                        id: true,
                        status: true,
                        currentStage: true,
                        updatedAt: true,
                        candidate: { select: { name: true } },
                        job: { select: { title: true } },
                    },
                    orderBy: { updatedAt: 'desc' },
                    take: 100,
                }),
                prisma.application.count({ where }),
            ]);

            const rows = items.map(a => ({
                id: a.id,   // 👈 unique id
                data: [
                    a.candidate?.name ?? '—',
                    a.job?.title ?? '—',
                    a.status ?? '—',
                    a.currentStage ?? '—',
                    a.updatedAt?.toLocaleString('en-IN', { timeZone: IST }) ?? '—',
                ]
            }));

            return res.json({
                title: `Pipeline after shortlist (excl. Rejected/No-show/Hired) — ${total}`,
                cols: ['Candidate', 'Job', 'Status', 'Stage', 'Last update'],
                rows,
                actions: [],
                selectable: true
            });
        }
        if (key === 'otPending') {
            const items = await prisma.overtimeApproval.findMany({
                where: { status: 'PENDING', managerStatus: 'APPROVED', date: yesterdayStart, minutes: { gt: 60 } } as any,
                include: {
                    employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } }
                }
            });

            const rows = items.map(o => ({
                id: o.id,   // 👈 unique id for selection
                data: [
                    `${o.employee.firstName} ${o.employee.lastName}`,
                    o.employee.employeeCode || '—',
                    o.employee.Department?.name || '—',
                    fmtTime(o.scheduledEnd),
                    fmtTime(o.checkOut),
                    `${Math.floor(o.minutes / 60)}h ${o.minutes % 60}m`,
                    'PENDING',
                ]
            }));

            return res.json({
                title: 'OT Pending Approval (Yesterday)',
                cols: ['Employee', 'EMP ID', 'Dept', 'Sched End', 'Checked Out ', 'OT Duration', 'Status'],
                rows,
                actions: ['Approve selected', 'Reject selected'],
                selectable: true
            });
        }


        if (key === 'managerOtPending') {
            const userEmpId = (req as any).user?.empId;
            const items = await prisma.overtimeApproval.findMany({
                where: {
                    managerStatus: 'PENDING',
                    date: yesterdayStart,
                    minutes: { gt: 60 },
                    ...(userEmpId ? { employee: { reportingManager: userEmpId } } : {}),
                } as any,
                include: {
                    employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } } }
                }
            });

            const rows = items.map(o => ({
                id: o.id,
                data: [
                    `${o.employee.firstName} ${o.employee.lastName}`,
                    o.employee.employeeCode || '—',
                    o.employee.Department?.name || '—',
                    fmtTime(o.scheduledEnd),
                    fmtTime(o.checkOut),
                    `${Math.floor(o.minutes / 60)}h ${o.minutes % 60}m`,
                    'PENDING',
                ]
            }));

            return res.json({
                title: 'OT Pending Your Approval (Yesterday)',
                cols: ['Employee', 'EMP ID', 'Dept', 'Sched End', 'Checked Out', 'OT Duration', 'Status'],
                rows,
                actions: ['Approve selected', 'Reject selected'],
                selectable: true
            });
        }

        // fallback to your existing attention lists
        return res.json(base[key] ?? { title: 'Not found', cols: [], rows: [] });
        // return res.json(all[key] ?? { title: 'Not found', cols: [], rows: [] });
    });

    /** GET /api/dashboard/recruiting (salary rejects, yet-to-receive-offer, no-shows) */
    getRecruiting = asyncHandler(async (_req, res) => {
        const salaryRejects = await prisma.application.count({
            where: { status: 'REJECTED', rejectReason: 'SALARY' },
        });

        const yetToReceiveOffer = await prisma.application.findMany({
            where: { status: { in: ['SHORTLISTED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED'] }, offer: null },
            select: { id: true, candidate: { select: { name: true } }, job: { select: { title: true } } },
            take: 50,
        });

        const noShows = await prisma.offer.findMany({
            where: { joinOutcome: 'NO_SHOW' },
            select: {
                application: { select: { candidate: { select: { name: true } }, job: { select: { title: true } } } },
                noShowReason: true,
            },
        });

        res.json({ salaryRejects, yetToReceiveOffer, noShows });
    });

    approveOrRejectOT = asyncHandler(async (req, res) => {
        const { ids, action } = req.body as { ids: number[]; action: 'APPROVE' | 'REJECT' };

        if (!ids?.length) {
            return res.status(400).json({ error: 'No OT IDs provided' });
        }

        const updated = await prisma.overtimeApproval.updateMany({
            where: { id: { in: ids }, status: 'PENDING', managerStatus: 'APPROVED' } as any,
            data: {
                status: action,
                approvedAt: new Date(),
            },
        });

        res.json({ ok: true, updated: updated.count });
    });

    getManagerOtPending = asyncHandler(async (req, res) => {
        const userEmpId = (req as any).user?.empId;

        const items = await prisma.overtimeApproval.findMany({
            where: {
                managerStatus: 'PENDING',
                minutes: { gt: 60 },
                ...(userEmpId ? { employee: { reportingManager: userEmpId } } : {}),
            } as any,
            include: {
                employee: {
                    select: {
                        firstName: true,
                        lastName: true,
                        employeeCode: true,
                        Department: { select: { name: true } },
                    }
                }
            },
            orderBy: { date: 'desc' },
        });

        const rows = items.map(o => ({
            id: o.id,
            employeeName: `${o.employee.firstName} ${o.employee.lastName}`,
            employeeCode: o.employee.employeeCode || '—',
            department: o.employee.Department?.name || '—',
            date: o.date,
            scheduledEnd: o.scheduledEnd,
            checkOut: o.checkOut,
            minutes: o.minutes,
            managerStatus: (o as any).managerStatus,
        }));

        res.json(rows);
    });

    getHROtPending = asyncHandler(async (req, res) => {
        const items = await prisma.overtimeApproval.findMany({
            where: {
                managerStatus: 'APPROVED',
                status: 'PENDING',
                minutes: { gt: 60 },
            } as any,
            include: {
                employee: {
                    select: {
                        firstName: true,
                        lastName: true,
                        employeeCode: true,
                        Department: { select: { name: true } },
                    }
                }
            },
            orderBy: { date: 'desc' },
        });

        const rows = items.map(o => ({
            id: o.id,
            employeeName: `${o.employee.firstName} ${o.employee.lastName}`,
            employeeCode: o.employee.employeeCode || '—',
            department: o.employee.Department?.name || '—',
            date: o.date,
            scheduledEnd: o.scheduledEnd,
            checkOut: o.checkOut,
            minutes: o.minutes,
            managerStatus: (o as any).managerStatus,
        }));

        res.json(rows);
    });

    getMyApprovedOT = asyncHandler(async (req, res) => {
        const empId = (req as any).user?.empId;
        if (!empId) return res.status(401).json({ error: 'Unauthorized' });

        const items = await prisma.overtimeApproval.findMany({
            where: {
                employeeId: Number(empId),
                status: 'APPROVE',
            } as any,
            orderBy: { date: 'desc' },
        });

        const rows = items.map((o: any) => ({
            id: o.id,
            date: o.date,
            scheduledEnd: o.scheduledEnd,
            checkOut: o.checkOut,
            minutes: o.minutes,
            approvedAt: o.approvedAt,
        }));

        res.json(rows);
    });

    approveOrRejectOTManager = asyncHandler(async (req, res) => {
        const { ids, action } = req.body as { ids: number[]; action: 'APPROVE' | 'REJECT' };
        const userEmpId = (req as any).user?.empId;

        if (!ids?.length) {
            return res.status(400).json({ error: 'No OT IDs provided' });
        }

        if (action === 'APPROVE') {
            // Manager approves → move to HR queue (status stays PENDING, managerStatus = APPROVED)
            const updated = await prisma.overtimeApproval.updateMany({
                where: { id: { in: ids }, managerStatus: 'PENDING' } as any,
                data: {
                    managerStatus: 'APPROVED',
                    managerApprovedAt: new Date(),
                    managerId: userEmpId ?? null,
                } as any,
            });
            return res.json({ ok: true, updated: updated.count });
        } else {
            // Manager rejects → both statuses set to REJECTED
            const updated = await prisma.overtimeApproval.updateMany({
                where: { id: { in: ids }, managerStatus: 'PENDING' } as any,
                data: {
                    managerStatus: 'REJECTED',
                    managerApprovedAt: new Date(),
                    managerId: userEmpId ?? null,
                    status: 'REJECTED',
                } as any,
            });
            return res.json({ ok: true, updated: updated.count });
        }
    });


    /** POST /api/recruiting/backfill-from-resignation  { resignationId:number } */
    createBackfillFromResignation = asyncHandler(async (req, res) => {
        const { resignationId } = req.body || {};
        if (!resignationId) return res.status(400).json({ error: 'resignationId is required' });

        const rr = await prisma.resignationRequest.findUnique({
            where: { id: Number(resignationId) },
            include: {
                employee: {
                    include: {
                        designation: true, // 👈 REQUIRED
                    },
                },
            },
        });
        if (!rr) return res.status(404).json({ error: 'Resignation not found' });
        if (rr.status !== 'APPROVED') return res.status(400).json({ error: 'Resignation not approved' });
        if (!rr.employee.designation) {
            return res.status(400).json({
                error: 'Employee does not have a designation assigned'
            });
        }

        const exists = await prisma.job.findFirst({
            where: { backfillForEmployeeId: rr.employeeId, status: { in: ['OPEN', 'ON_HOLD', 'DRAFT'] } },
            select: { id: true },
        });
        if (exists) return res.json({ ok: true, jobId: exists.id, note: 'Backfill job already exists' });

        const branch = await prisma.branch.findUnique({ where: { id: rr.employee.branchId } }).catch(() => null);
        const job = await prisma.job.create({
            data: {
                title: rr.employee.designation.name,
                departmentId: rr.employee.departmentId,
                location: branch?.name || undefined,
                headcount: 1,
                status: 'OPEN',
                createdBy: rr.managerId ?? 0,
                backfillForEmployeeId: rr.employeeId,
            },
            select: { id: true },
        });

        res.json({ ok: true, jobId: job.id });
    });

    // ========== PRIVATE HELPERS ==========

    // private async pipelineMiniBars() {
    //     const [jobsOpen, applied, shortlisted, interviewing, offered, joining, joined] = await Promise.all([
    //         prisma.job.count({ where: { status: 'OPEN' } }),
    //         prisma.application.count({ where: { status: 'APPLIED' } }),
    //         prisma.application.count({ where: { status: 'SHORTLISTED' } }),
    //         prisma.application.count({ where: { status: { in: ['INTERVIEW_SCHEDULED', 'INTERVIEWED'] } } }),
    //         prisma.application.count({ where: { status: 'OFFERED' } }),
    //         prisma.offer.count({
    //             where: { status: 'SIGNED', proposedJoinAt: { gte: startOfDayIST(), lte: addDays(endOfDayIST(), 30) } },
    //         }),
    //         prisma.application.count({ where: { status: 'HIRED' } }),
    //     ]);
    //     return [
    //         { name: 'Jobs Open', value: jobsOpen },
    //         { name: 'Applied', value: applied },
    //         { name: 'Shortlisted', value: shortlisted },
    //         { name: 'Interviewing', value: interviewing },
    //         { name: 'Offered', value: offered },
    //         { name: 'Joining', value: joining },
    //         { name: 'Joined', value: joined },
    //     ];
    // }
    private async pipelineMiniBars() {
        // window for "Joining" (next 30 days)
        const from = startOfDayIST();
        const to = addDays(endOfDayIST(), 30);

        // Policy: when does a candidate consume a seat on an OPEN job?
        // - HIRED application OR SIGNED offer OR actually JOINED
        const SEAT_FILLED_OR = [
            { status: 'HIRED' },
            { offer: { status: 'SIGNED' } },
            { offer: { joinOutcome: 'JOINED' } },
        ] as const;

        const [
            // total headcount requested on OPEN jobs
            openHeadcountAgg,
            // applications that currently consume a seat on those OPEN jobs
            filledSeats,

            // pipeline counts
            applied,
            shortlisted,
            interviewing,
            offered,  // see note below
            joining,  // signed offers with an upcoming join date
            joined,   // actually joined
        ] = await Promise.all([
            prisma.job.aggregate({
                where: { status: 'OPEN' },
                _sum: { headcount: true },
            }),

            prisma.application.count({
                where: {
                    job: { status: 'OPEN' },
                    OR: SEAT_FILLED_OR as any,
                },
            }),

            prisma.application.count({ where: { status: 'APPLIED' } }),
            prisma.application.count({ where: { status: 'SHORTLISTED' } }),
            prisma.application.count({ where: { status: { in: ['INTERVIEW_SCHEDULED', 'INTERVIEWED'] } } }),
            prisma.application.count({ where: { status: 'OFFERED' } }),
            prisma.offer.count({
                where: {
                    AND: [
                        { status: 'SIGNED' },
                        { proposedJoinAt: { gte: startOfDayIST(), lte: addDays(endOfDayIST(), 30) } },
                        { joinOutcome: null },
                        { application: { status: { not: 'HIRED' } } },
                    ],
                },
            }),
            prisma.application.count({ where: { status: 'HIRED' } }),
        ]);

        const openHeadcount = openHeadcountAgg._sum.headcount ?? 0;
        const jobsOpenVacancies = Math.max(0, openHeadcount - filledSeats);

        return [
            { name: 'Jobs Open', value: jobsOpenVacancies },
            { name: 'Applied', value: applied },
            { name: 'Shortlisted', value: shortlisted },
            { name: 'Interviewing', value: interviewing },
            { name: 'Offered', value: offered },
            { name: 'Joining', value: joining },
            { name: 'Joined', value: joined },
        ];
    }
    // private async getLateAttendanceSplit(employeeIds: number[], start: Date, end: Date) {
    //     const employees = await prisma.employee.findMany({
    //         where: { id: { in: employeeIds } },
    //         select: {
    //             id: true,
    //             firstName: true,
    //             lastName: true,
    //             employeeCode: true,
    //             employeeType: true,
    //             Department: { select: { name: true } },
    //             EmployeeShiftSetting: {
    //                 select: {
    //                     mode: true,
    //                     fixedShift: { select: { startTime: true, endTime: true } },
    //                     rotationPattern: {
    //                         select: {
    //                             cycleDays: true,
    //                             items: {
    //                                 select: {
    //                                     dayIndex: true,
    //                                     shift: { select: { startTime: true, endTime: true } },
    //                                 },
    //                             },
    //                         },
    //                     },
    //                 },
    //             },
    //         },
    //     });

    //     const attendance = await prisma.attendance.findMany({
    //         where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end } },
    //         select: { employeeId: true, checkIn: true },
    //     });

    //     const presentMap = new Map<number, Date>();
    //     for (const rec of attendance) {
    //         if (rec.checkIn) presentMap.set(rec.employeeId, rec.checkIn);
    //     }

    //     // Approved or pending Leave/WFH/Permission (excused employees)
    //     const [approvedLeave, approvedWFH, approvedPerm] = await Promise.all([
    //         prisma.leaveRequest.findMany({
    //             where: {
    //                 employeeId: { in: employeeIds },
    //                 status: { in: ['APPROVED', 'PENDING'] },
    //                 OR: [
    //                     { startDate: { lte: end }, endDate: { gte: start } },
    //                     { startDate: { lte: end }, endDate: start },
    //                 ],
    //             },
    //             select: { employeeId: true },
    //         }),
    //         prisma.wFHRequest.findMany({
    //             where: {
    //                 employeeId: { in: employeeIds },
    //                 status: { in: ['APPROVED', 'PENDING'] },
    //                 OR: [
    //                     { startDate: { lte: end }, endDate: { gte: start } },
    //                     { startDate: { lte: end }, endDate: start },
    //                 ],
    //             },
    //             select: { employeeId: true },
    //         }),
    //         prisma.permissionRequest.findMany({
    //             where: {
    //                 employeeId: { in: employeeIds },
    //                 status: { in: ['APPROVED', 'PENDING'] },
    //                 OR: [
    //                     { day: { gte: start, lte: end } },
    //                     { startTime: { lte: end }, endTime: { gte: start } },
    //                 ],
    //             },
    //             select: { employeeId: true },
    //         }),
    //     ]);

    //     const excused = new Set<number>([
    //         ...approvedLeave.map((x) => x.employeeId),
    //         ...approvedWFH.map((x) => x.employeeId),
    //         ...approvedPerm.map((x) => x.employeeId),
    //     ]);

    //     function combineDateAndTime(baseDate: Date, time: Date): Date {
    //         const d = new Date(baseDate);
    //         d.setHours(time.getHours(), time.getMinutes(), 0, 0);
    //         return d;
    //     }

    //     function fmtTime(t: Date) {
    //         return t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    //     }

    //     const clinicalList: any[] = [];
    //     const nonClinicalList: any[] = [];

    //     for (const e of employees) {
    //         if (excused.has(e.id)) continue;
    //         const checkIn = presentMap.get(e.id);
    //         if (!e.EmployeeShiftSetting) continue;

    //         let shiftStartCandidates: Date[] = [];
    //         let displayShiftTime = '—';

    //         console.log(e.firstName, JSON.stringify(e.EmployeeShiftSetting.rotationPattern, null, 2));

    //         if (e.EmployeeShiftSetting.mode === 'FIXED' && e.EmployeeShiftSetting.fixedShift?.startTime) {
    //             const shiftTime = combineDateAndTime(start, e.EmployeeShiftSetting.fixedShift.startTime);
    //             shiftStartCandidates = [shiftTime];
    //             displayShiftTime = fmtTime(e.EmployeeShiftSetting.fixedShift.startTime);
    //         } else if (e.EmployeeShiftSetting.mode === 'ROTATIONAL' && e.EmployeeShiftSetting.rotationPattern?.items?.length) {
    //             const uniq = new Map<number, Date>();
    //             for (const it of e.EmployeeShiftSetting.rotationPattern.items) {
    //                 if (it.shift?.startTime)
    //                     uniq.set(it.dayIndex, combineDateAndTime(start, it.shift.startTime));
    //             }
    //             shiftStartCandidates = Array.from(uniq.values());
    //             // show first shift start time (for display only)
    //             const first = e.EmployeeShiftSetting.rotationPattern.items[0]?.shift?.startTime;
    //             if (first) displayShiftTime = fmtTime(first);
    //         }

    //         if (shiftStartCandidates.length === 0) continue;

    //         let lateBy: number | null = null;
    //         if (checkIn) {
    //             for (const s of shiftStartCandidates) {
    //                 const diff = Math.round((checkIn.getTime() - s.getTime()) / 60000);
    //                 if (diff > 15) {
    //                     lateBy = lateBy == null ? diff : Math.min(lateBy, diff);
    //                 }
    //             }
    //         } else {
    //             const now = new Date();
    //             for (const s of shiftStartCandidates) {
    //                 const diff = Math.round((now.getTime() - s.getTime()) / 60000);
    //                 if (diff > 15) {
    //                     lateBy = lateBy == null ? diff : Math.min(lateBy, diff);
    //                 }
    //             }
    //         }

    //         if (lateBy != null) {
    //             const isFixed = e.EmployeeShiftSetting.mode === 'FIXED';

    //             const row = {
    //                 name: `${e.firstName} ${e.lastName}`,
    //                 code: e.employeeCode,
    //                 dept: e.Department?.name || '-',
    //                 shift: isFixed ? 'General' : 'Rotational',
    //                 shiftTime: displayShiftTime,
    //                 delayMins: lateBy,
    //             };
    //             if (e.employeeType === 'CLINICAL') clinicalList.push(row);
    //             else nonClinicalList.push(row);
    //         }
    //     }

    //     return {
    //         clinicalLate: clinicalList.length,
    //         nonClinicalLate: nonClinicalList.length,
    //         clinicalList,
    //         nonClinicalList,
    //     };
    // }
    private async getLateAttendanceSplit(employeeIds: number[], start: Date, end: Date) {
        const employees = await prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                employeeType: true,
                Department: { select: { name: true } },
                EmployeeShiftSetting: {
                    select: {
                        mode: true,
                        fixedShift: { select: { startTime: true, endTime: true } },
                        rotationPattern: {
                            select: {
                                cycleDays: true,
                                items: {
                                    select: {
                                        dayIndex: true,
                                        shift: { select: { startTime: true, endTime: true } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        const todayStart = startOfDayIST(new Date());
        const todayEnd = endOfDayIST(new Date());


        const assignments = await prisma.shiftAssignment.findMany({
            where: {
                employeeId: { in: employeeIds },
                date: {
                    gte: todayStart,
                    lte: todayEnd,
                },
            },
            select: {
                employeeId: true,
                date: true,
                shift: {
                    select: {
                        startTime: true,
                        endTime: true,
                        name: true,
                    },
                },
                employee: {
                    select: {
                        firstName: true,
                        lastName: true,
                        employeeCode: true,
                        employeeType: true,
                        Department: { select: { name: true } },
                    },
                },
            },
        });


        const attendance = await prisma.attendance.findMany({
            where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end } },
            select: { employeeId: true, checkIn: true },
        });

        const presentMap = new Map<number, Date>();
        for (const rec of attendance) {
            if (rec.checkIn) presentMap.set(rec.employeeId, new Date(rec.checkIn));
        }

        // Approved or pending Leave/WFH/Permission
        const [approvedLeave, approvedWFH, approvedPerm] = await Promise.all([
            prisma.leaveRequest.findMany({
                where: {
                    employeeId: { in: employeeIds },
                    status: { in: ['APPROVED', 'PENDING'] },
                    OR: [
                        { startDate: { lte: end }, endDate: { gte: start } },
                        { startDate: { lte: end }, endDate: start },
                    ],
                },
                select: { employeeId: true },
            }),
            prisma.wFHRequest.findMany({
                where: {
                    employeeId: { in: employeeIds },
                    status: { in: ['APPROVED', 'PENDING'] },
                    OR: [
                        { startDate: { lte: end }, endDate: { gte: start } },
                        { startDate: { lte: end }, endDate: start },
                    ],
                },
                select: { employeeId: true },
            }),
            prisma.permissionRequest.findMany({
                where: {
                    employeeId: { in: employeeIds },
                    status: { in: ['APPROVED', 'PENDING'] },
                    OR: [
                        { day: { gte: start, lte: end } },
                        { startTime: { lte: end }, endTime: { gte: start } },
                    ],
                },
                select: { employeeId: true },
            }),
        ]);

        const excused = new Set<number>([
            ...approvedLeave.map((x) => x.employeeId),
            ...approvedWFH.map((x) => x.employeeId),
            ...approvedPerm.map((x) => x.employeeId),
        ]);

        // helper functions
        function safeToDate(value: any): Date | null {
            if (!value) return null;
            const d = new Date(value);
            return isNaN(d.getTime()) ? null : d;
        }

        function combineDateAndTime(baseDate: Date, timeValue: any): Date | null {
            const time = safeToDate(timeValue);
            if (!time) return null;
            const combined = new Date(baseDate);
            combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
            return combined;
        }

        function fmtTime(t: any) {
            const d = safeToDate(t);
            return d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
        }
        function getTodayShiftTime(time: Date): Date {
            const today = new Date();
            const shift = new Date(today);
            shift.setHours(time.getHours(), time.getMinutes(), 0, 0); // keep today's date
            return shift;
        }

        const clinicalList: any[] = [];
        const nonClinicalList: any[] = [];
        const paraMedicalList: any[] = [];
        const clinicalNotCheckedIn: any[] = [];
        const nonClinicalNotCheckedIn: any[] = [];
        const paraMedicalNotCheckedIn: any[] = [];

        const now = new Date();
        const shiftMap = new Map<number, typeof assignments[0]>();

        for (const a of assignments) {
            shiftMap.set(a.employeeId, a);
        }
        for (const e of employees) {
            if (excused.has(e.id)) continue;

            const assignment = shiftMap.get(e.id);
            if (!assignment) continue; // no shift today

            const shiftStart = combineDateAndTime(
                start,
                assignment.shift.startTime
            );

            if (!shiftStart) continue;

            const typeKey = (t?: string) => (t || '').toUpperCase();

            const bucketLate = (t?: string) => {
                const k = typeKey(t);
                if (k === 'CLINICAL') return clinicalList;
                if (k === 'PARAMEDICAL') return paraMedicalList;
                return nonClinicalList; // default
            };

            const bucketNoCheckin = (t?: string) => {
                const k = typeKey(t);
                if (k === 'CLINICAL') return clinicalNotCheckedIn;
                if (k === 'PARAMEDICAL') return paraMedicalNotCheckedIn;
                return nonClinicalNotCheckedIn; // default
            };

            const checkIn = presentMap.get(e.id);

            let lateBy: number | null = null;
            let notCheckedIn = false;

            if (checkIn) {
                const diffMins = Math.round(
                    (new Date(checkIn).getTime() - shiftStart.getTime()) / 60000
                );
                if (diffMins > 15) lateBy = diffMins;
            } else {
                const diffMins = Math.round(
                    (Date.now() - shiftStart.getTime()) / 60000
                );
                if (diffMins > 15) {
                    lateBy = diffMins;
                    notCheckedIn = true;
                }
            }

            const baseRow = {
                name: `${assignment.employee.firstName} ${assignment.employee.lastName}`,
                code: assignment.employee.employeeCode,
                dept: assignment.employee.Department?.name || '-',
                shift: assignment.shift.name,
                shiftTime: fmtTime(assignment.shift.startTime),
            };

            // if (lateBy !== null && !notCheckedIn) {
            //     (assignment.employee.employeeType === 'CLINICAL'
            //         ? clinicalList
            //         : nonClinicalList
            //     ).push({ ...baseRow, delayMins: lateBy });
            // } else if (notCheckedIn) {
            //     (assignment.employee.employeeType === 'CLINICAL'
            //         ? clinicalNotCheckedIn
            //         : nonClinicalNotCheckedIn
            //     ).push({ ...baseRow, delayMins: lateBy });
            // }
            const empType = assignment.employee.employeeType ?? undefined;

            if (lateBy !== null && !notCheckedIn) {
                bucketLate(empType).push({ ...baseRow, delayMins: lateBy });
            } else if (notCheckedIn) {
                bucketNoCheckin(empType).push({ ...baseRow, delayMins: lateBy });
            }
        }

        return {
            clinicalLate: clinicalList.length,
            nonClinicalLate: nonClinicalList.length,
            clinicalList,
            nonClinicalList,
            paraMedicalList,
            clinicalNotCheckedIn: clinicalNotCheckedIn.length,
            paraMedicalNotCheckedIn: paraMedicalNotCheckedIn.length,
            nonClinicalNotCheckedIn: nonClinicalNotCheckedIn.length,
            clinicalNotCheckedInList: clinicalNotCheckedIn,
            nonClinicalNotCheckedInList: nonClinicalNotCheckedIn,
            paraMedicalNotCheckedInList: paraMedicalNotCheckedIn
        };
    }




    private async countUnmarkedAttendance(employeeIds: number[], start: Date, end: Date) {
        const todaysAttendance = await prisma.attendance.findMany({
            where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end } },
            select: { employeeId: true },
        });
        const presentSet = new Set(todaysAttendance.map((a) => a.employeeId));

        const [approvedLeave, approvedWFH, approvedPerm] = await Promise.all([
            prisma.leaveRequest.findMany({
                where: {
                    employeeId: { in: employeeIds },
                    status: 'APPROVED',
                    OR: [
                        { startDate: { lte: end }, endDate: { gte: start } },
                        { startDate: { lte: end }, endDate: start },
                    ],
                },
                select: { employeeId: true },
            }),
            prisma.wFHRequest.findMany({
                where: {
                    employeeId: { in: employeeIds },
                    status: 'APPROVED',
                    OR: [
                        { startDate: { lte: end }, endDate: { gte: start } },
                        { startDate: { lte: end }, endDate: start },
                    ],
                },
                select: { employeeId: true },
            }),
            prisma.permissionRequest.findMany({
                where: {
                    employeeId: { in: employeeIds },
                    status: 'APPROVED',
                    OR: [
                        { day: { gte: start, lte: end } },
                        { startTime: { lte: end }, endTime: { gte: start } },
                    ],
                },
                select: { employeeId: true },
            }),
        ]);

        const excused = new Set<number>([
            ...approvedLeave.map((x) => x.employeeId),
            ...approvedWFH.map((x) => x.employeeId),
            ...approvedPerm.map((x) => x.employeeId),
        ]);

        let count = 0;
        for (const id of employeeIds) {
            if (!presentSet.has(id) && !excused.has(id)) count++;
        }
        return count;
    }

    private async countPendingApprovals(employeeIds: number[], start: Date, end: Date) {
        const [leave, wfh, perm] = await Promise.all([
            prisma.leaveRequest.count({
                where: { employeeId: { in: employeeIds }, status: 'PENDING', createdAt: { gte: start, lte: end } },
            }),
            prisma.wFHRequest.count({
                where: { employeeId: { in: employeeIds }, status: 'PENDING', createdAt: { gte: start, lte: end } },
            }),
            prisma.permissionRequest.count({
                where: { employeeId: { in: employeeIds }, status: 'PENDING', createdAt: { gte: start, lte: end } },
            }),
        ]);
        return leave + wfh + perm;
    }

    private async getAllLists(todayStart: Date, todayEnd: Date) {
        // Unmarked
        // const unmarkedRows = await this.buildUnmarkedList(todayStart, todayEnd);

        // Approvals created today
        const [permPend, leavePend, wfhPend] = await Promise.all([
            prisma.permissionRequest.findMany({
                where: { status: 'PENDING', createdAt: { gte: todayStart, lte: todayEnd } },
                include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } }, } } },
                take: 50,
            }),
            prisma.leaveRequest.findMany({
                where: { status: 'PENDING', createdAt: { gte: todayStart, lte: todayEnd } },
                include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } }, } } },
                take: 50,
            }),
            prisma.wFHRequest.findMany({
                where: { status: 'PENDING', createdAt: { gte: todayStart, lte: todayEnd } },
                include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } }, } } },
                take: 50,
            }),
        ]);
        // Example for unmarked rows
        // const unmarkedRows = (await this.buildUnmarkedList(todayStart, todayEnd))
        // 🩺 Fetch late attendance split (clinical / non-clinical)
        const { clinicalList,
            nonClinicalList,
            paraMedicalList,
            clinicalNotCheckedInList,
            nonClinicalNotCheckedInList,
            paraMedicalNotCheckedInList } = await this.getLateAttendanceSplit(
                (await prisma.employee.findMany({
                    where: { employmentStatus: 'ACTIVE' },
                    select: { id: true },
                })).map(e => e.id),
                todayStart,
                todayEnd
            );

        console.log('Clinical late:', clinicalNotCheckedInList.length, clinicalNotCheckedInList, 'Non-clinical late:', nonClinicalNotCheckedInList.length, nonClinicalNotCheckedInList);


        // Approvals
        const approvalsRows = [
            ...leavePend.map((x, idx) => ({
                id: x.id, // use DB primary key
                data: [
                    'Leave',
                    `${x.employee.firstName} ${x.employee.lastName}`,
                    x.employee.employeeCode || '—',
                    x.employee.Department?.name || '—',
                    x.createdAt.toLocaleString('en-IN', { timeZone: IST }),
                    'PENDING',
                ]
            })),
            ...wfhPend.map((x) => ({
                id: x.id,
                data: [
                    'WFH',
                    `${x.employee.firstName} ${x.employee.lastName}`,
                    x.employee.employeeCode || '—',
                    x.employee.Department?.name || '—',
                    x.createdAt.toLocaleString('en-IN', { timeZone: IST }),
                    'PENDING',
                ]
            })),
            ...permPend.map((x) => ({
                id: x.id,
                data: [
                    'Permission',
                    `${x.employee.firstName} ${x.employee.lastName}`,
                    x.employee.employeeCode || '—',
                    x.employee.Department?.name || '—',
                    x.createdAt.toLocaleString('en-IN', { timeZone: IST }),
                    'PENDING',
                ]
            })),
        ].slice(0, 20);


        // Documents expiring (30 days)
        const docs = await prisma.document.findMany({
            where: { expiryDate: { gte: todayStart, lte: addDays(todayEnd, 30) } },
            include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, id: true, Department: { select: { name: true } }, } } },
        });

        console.log('Docs expiring soon:', docs.length, docs);

        // Interviews missing feedback today
        const miss = await prisma.interview.findMany({
            where: { startTime: { gte: todayStart, lte: todayEnd }, feedbackAt: null },
            include: { application: { include: { candidate: true } } },
        });

        // Exit clearances overdue
        const overdue = await listPendingClearancesDetailed() // <— run in parallel

        // Probation ending (7 days)
        const probRowsRaw = await prisma.employee.findMany({
            where: { probationEndDate: { gte: todayStart, lte: addDays(todayEnd, 7) } },
            select: {
                firstName: true,
                lastName: true,
                employeeCode: true,
                Department: { select: { name: true } },
                reportingManager: true,
                probationEndDate: true,
                id: true,
            },
        });
        const probMgrMap = await buildManagerNameMap(probRowsRaw.map(e => e.reportingManager));
        const probRows = probRowsRaw.map((e) => ({
            id: e.id,
            data: [
                `${e.firstName} ${e.lastName}`,
                e.employeeCode || '—',
                e.Department?.name || '—',
                e.reportingManager ? (probMgrMap.get(e.reportingManager) || '—') : '—',
                fmtDate(e.probationEndDate),
            ]
        }));

        const docRows = docs.map((d, idx) => ({
            id: d.id,
            data: [
                `${d.employee.firstName} ${d.employee.lastName}`,
                d.employee.employeeCode || '—',
                d.employee.Department?.name || '—',
                d.type || d.category,
                fmtDate(d.expiryDate),
                'Expiring',
            ]
        }));

        const missRows = miss.map((m, idx) => ({
            id: idx + 1,
            data: [
                m.application.candidate.name,
                m.stage,
                m.panelUserIds || '—',
                m.startTime.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' }),
            ]
        }));

        const verifierMgrMap = await buildManagerNameMap(overdue.map(o => o.verifierId));
        const overRows = overdue.map((o, idx) => ({
            id: idx + 1,
            resignationId: o.resignationId,
            data: [
                o.employeeName,
                o.employeeCode || '—',
                o.deptName || '—',
                o.type,
                `${o.sinceDays} days`,
                o.verifierId ? (verifierMgrMap.get(o.verifierId) || '—') : 'Unassigned',
                o.note || '—'
            ]
        }));



        return {
            // unmarked: {
            //     title: 'Unmarked attendance',
            //     cols: ['Employee', 'EMP ID', 'Manager', 'Dept', 'Last seen'],
            //     rows: unmarkedRows,
            //     actions: ['Message all', 'Mark exception'],
            //     selectable: true
            // },
            clinicalLate: {
                title: 'Clinical Staff Not Checked-in (>15min)',
                cols: ['Employee', 'EMP ID', 'Dept', 'Shift Type', 'Shift Time', 'Delay (mins)'],
                rows: clinicalNotCheckedInList.map((x, idx) => ({
                    id: idx + 1,
                    data: [
                        x.name,
                        x.code,
                        x.dept || '—',
                        x.shift,
                        x.shiftTime,
                        `${x.delayMins} min`
                    ]
                })),
                // actions: ['Notify all'],
                actions: [],
                selectable: true
            },

            nonClinicalLate: {
                title: 'Non-Clinical Staff not Checked-in (>15min)',
                cols: ['Employee', 'EMP ID', 'Dept', 'Shift Type', 'Shift Time', 'Delay (mins)'],
                rows: nonClinicalNotCheckedInList.map((x, idx) => ({
                    id: idx + 1,
                    data: [
                        x.name,
                        x.code,
                        x.dept || '—',
                        x.shift,
                        x.shiftTime,
                        `${x.delayMins} min`
                    ]
                })),
                // actions: ['Notify all'],
                actions: [],
                selectable: true
            },

            paraMedicalLate: {
                title: 'Paramedical Staff Late (>15min)',
                cols: ['Employee', 'EMP ID', 'Dept', 'Shift', 'Shift Time', 'Delay (mins)'],
                rows: paraMedicalList.map((x, idx) => ({
                    id: idx + 1,
                    data: [x.name, x.code, x.dept || '—', x.shift, x.shiftTime, `${x.delayMins} min`]
                })),
                actions: [],
                selectable: true
            },

            paraMedicalNotCheckedIn: {
                title: 'Paramedical Staff Not Checked-In (>15min)',
                cols: ['Employee', 'EMP ID', 'Dept', 'Shift', 'Shift Time', 'Delay (mins)'],
                rows: paraMedicalNotCheckedInList.map((x, idx) => ({
                    id: idx + 1,
                    data: [x.name, x.code, x.dept || '—', x.shift, x.shiftTime, `${x.delayMins} min`]
                })),
                actions: [],
                selectable: true
            },

            approvals: {
                title: 'Pending approvals',
                cols: ['Type', 'Employee', 'EMP ID', 'Dept', 'Requested', 'Status'],
                rows: approvalsRows,
                actions: ['Approve all', 'Reject all'],
                selectable: true
            },
            probation: {
                title: 'Probation ending (7 days)',
                cols: ['Employee', 'EMP ID', 'Dept', 'Manager', 'End date'],
                rows: probRows,
                actions: ['Request feedback', 'Extend probation'],
                selectable: true
            },
            docs: {
                title: 'Documents expiring (30 days)',
                cols: ['Employee', 'EMP ID', 'Dept', 'Type', 'Expiry', 'Status'],
                rows: docRows,
                actions: ['Notify all'],
                selectable: true
            },
            clearances: {
                title: 'Exit clearances overdue',
                cols: ['Employee', 'EMP ID', 'Dept', 'Type', 'Since', 'Owner', 'Note'],
                rows: overRows,
                actions: ['Escalate', 'Assign delegate'],
                selectable: true
            },
        };
    }

    private async buildUnmarkedList(todayStart: Date, todayEnd: Date) {
        const active = await prisma.employee.findMany({
            where: { employmentStatus: 'ACTIVE' },
            select: { id: true, firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } }, reportingManager: true },
        });

        const att = await prisma.attendance.findMany({
            where: { date: { gte: todayStart, lte: todayEnd } },
            select: { id: true, employeeId: true },
        });
        const present = new Set(att.map((a) => a.employeeId));

        const [leave, wfh, perm] = await Promise.all([
            prisma.leaveRequest.findMany({
                where: {
                    status: 'APPROVED',
                    OR: [
                        { startDate: { lte: todayEnd }, endDate: { gte: todayStart } },
                        { startDate: { lte: todayEnd }, endDate: todayStart },
                    ],
                },
                select: { employeeId: true },
            }),
            prisma.wFHRequest.findMany({
                where: {
                    status: 'APPROVED',
                    OR: [
                        { startDate: { lte: todayEnd }, endDate: { gte: todayStart } },
                        { startDate: { lte: todayEnd }, endDate: todayStart },
                    ],
                },
                select: { employeeId: true },
            }),
            prisma.permissionRequest.findMany({
                where: {
                    status: 'APPROVED',
                    OR: [
                        { day: { gte: todayStart, lte: todayEnd } },
                        { startTime: { lte: todayEnd }, endTime: { gte: todayStart } },
                    ],
                },
                select: { employeeId: true },
            }),
        ]);
        const excused = new Set<number>([...leave, ...wfh, ...perm].map((x) => x.employeeId));

        // build manager name map only for people you’ll show
        const unmarked = active.filter(e => !present.has(e.id) && !excused.has(e.id));
        const mgrMap = await buildManagerNameMap(unmarked.map(e => e.reportingManager));

        const rows: { id: number, data: string[] }[] = [];
        for (const e of unmarked) {
            // const existing = att.find(a => a.employeeId === e.id);
            rows.push({
                id: e.id, // employeeId, used only for creation
                data: [
                    `${e.firstName} ${e.lastName}`,
                    e.employeeCode || '—',
                    e.reportingManager ? (mgrMap.get(e.reportingManager) || '—') : '—',
                    e.Department?.name || '—',
                    'Yesterday 6:00 pm'
                ]
            });
        }
        return rows.slice(0, 20);
    }
}
const REQUIRED: ClearanceType[] = ['IT', 'FINANCE', 'HR', 'ADMIN', 'SECURITY'];

export async function listPendingClearances() {
    // get relevant resignations with the clearances you *do* have
    const resignations = await prisma.resignationRequest.findMany({
        where: { status: { in: ['UNDER_REVIEW', 'APPROVED'] } },
        select: {
            id: true,
            employeeId: true,
            clearances: { select: { type: true, decision: true } },
        },
    });

    // derive pending = REQUIRED - APPROVED
    const pending: { resignationId: number; employeeId: number; type: ClearanceType }[] = [];
    for (const r of resignations) {
        const approved = new Set(
            r.clearances.filter(c => c.decision === 'APPROVED').map(c => c.type)
        );
        for (const t of REQUIRED) {
            if (!approved.has(t)) {
                pending.push({ resignationId: r.id, employeeId: r.employeeId, type: t });
            }
        }
    }
    return pending; // e.g. [{ resignationId: 12, employeeId: 101, type: 'IT' }, ...]
}
const clearanceStart = (r: {
    createdAt: Date | null,
    managerDecidedAt: Date | null,
    hrDecidedAt: Date | null
}) => r.hrDecidedAt ?? r.managerDecidedAt ?? r.createdAt ?? new Date();

async function listPendingClearancesDetailed() {
    const resignations = await prisma.resignationRequest.findMany({
        where: { status: { in: ['UNDER_REVIEW', 'APPROVED'] } },
        select: {
            id: true,
            employeeId: true,
            createdAt: true,
            managerDecidedAt: true,
            hrDecidedAt: true,
            employee: { select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } }, } },
            clearances: { select: { type: true, decision: true, verifierId: true, createdAt: true, id: true, note: true } }
        }
    });

    const now = new Date();
    const items: Array<{ resignationId: number; employeeName: string; employeeCode?: string; deptName?: string; type: ClearanceType; sinceDays: number; verifierId: number | null; note: string | null }> = [];

    for (const r of resignations) {
        const approved = new Set(r.clearances.filter(c => c.decision === 'APPROVED').map(c => c.type));
        for (const type of REQUIRED) {
            if (approved.has(type)) continue; // already done

            const row = r.clearances.find(c => c.type === type); // may be undefined if you only store APPROVED
            const startAnchor = row?.createdAt ?? r.hrDecidedAt ?? r.managerDecidedAt ?? r.createdAt ?? now;

            items.push({
                resignationId: r.id,
                employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
                employeeCode: r.employee.employeeCode || undefined,
                deptName: r.employee.Department?.name || undefined,
                type,
                sinceDays: Math.max(0, differenceInCalendarDays(now, startAnchor)),
                verifierId: row?.verifierId ?? null,
                note: row?.note || null   // 👈 new
            });
        }
    }
    return items;
}
// function parseAud(aud?: string | null): { departmentId?: number[]; branchId?: number[] } | null {
//     if (!aud) return null;
//     try { return JSON.parse(aud); } catch { return null; }
// }
async function buildManagerNameMap(ids: (number | null | undefined)[]) {
    const unique = Array.from(new Set(ids.filter((x): x is number => !!x)));
    if (!unique.length) return new Map<number, string>();
    const mgrs = await prisma.employee.findMany({
        where: { id: { in: unique } },
        select: { id: true, firstName: true, lastName: true },
    });
    return new Map(mgrs.map(m => [m.id, `${m.firstName} ${m.lastName}`]));
}
// ----------------------
// 1. Unmarked attendance
// ----------------------
export const messageUnmarked = async (req: Request, res: Response) => {
    try {
        const { employeeIds, message } = req.body;
        // TODO: integrate with notification/email service
        console.log("Message to unmarked employees:", employeeIds, message);
        for (const empId of employeeIds) {
            createNotification(empId, message)
        }
        res.json({ success: true, notified: employeeIds.length });
        return;
    } catch (err) {
        console.error("Message Unmarked Error:", err);
        return res.status(500).json({ error: "Failed to send messages" });
    }
};

export const markUnmarkedException = async (req: Request, res: Response) => {
    try {
        const { employeeIds } = req.body;
        const today = new Date(); // normalize to start of day if needed

        // Create attendance rows with EXCEPTION status
        const created = await prisma.attendance.createMany({
            data: employeeIds.map((empId: any) => ({
                employeeId: empId,
                date: today,
                status: "EXCEPTION",
            })),
            skipDuplicates: true, // avoid duplicate rows if called twice
        });

        //   // Fetch the actual attendance ids for these employees (in case duplicates were skipped)
        //   const attendance = await prisma.attendance.findMany({
        //     where: {
        //       employeeId: { in: employeeIds },
        //       date: today
        //     },
        //     select: { id: true, employeeId: true }
        //   });

        return res.json({
            success: true,
            created: created.count,
        });
    } catch (err) {
        console.error("Mark Exception Error:", err);
        return res.status(500).json({ error: "Failed to mark exceptions" });
    }
};


// ----------------------
// 2. Pending approvals
// ----------------------
export const bulkApproveApprovals = async (req: Request, res: Response) => {
    try {
        const { leaveIds, wfhIds, permissionIds } = req.body;

        if (leaveIds?.length) {
            await prisma.leaveRequest.updateMany({
                where: { id: { in: leaveIds } },
                data: { status: "APPROVED", approvedDate: new Date() },
            });
        }
        if (wfhIds?.length) {
            await prisma.wFHRequest.updateMany({
                where: { id: { in: wfhIds } },
                data: { status: "APPROVED", approvedDate: new Date() },
            });
        }
        if (permissionIds?.length) {
            await prisma.permissionRequest.updateMany({
                where: { id: { in: permissionIds } },
                data: { status: "APPROVED", approvedDate: new Date() },
            });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("Bulk Approve Error:", err);
        return res.status(500).json({ error: "Failed to approve requests" });
    }
};

export const bulkRejectApprovals = async (req: Request, res: Response) => {
    try {
        const { leaveIds, wfhIds, permissionIds, reason } = req.body;

        if (leaveIds?.length) {
            await prisma.leaveRequest.updateMany({
                where: { id: { in: leaveIds } },
                data: { status: "REJECTED", declineReason: reason, declinedDate: new Date() },
            });
        }
        if (wfhIds?.length) {
            await prisma.wFHRequest.updateMany({
                where: { id: { in: wfhIds } },
                data: { status: "REJECTED", declineReason: reason, declinedDate: new Date() },
            });
        }
        if (permissionIds?.length) {
            await prisma.permissionRequest.updateMany({
                where: { id: { in: permissionIds } },
                data: { status: "REJECTED", declineReason: reason, declinedDate: new Date() },
            });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("Bulk Reject Error:", err);
        return res.status(500).json({ error: "Failed to reject requests" });
    }
};

// ----------------------
// 3. Probation ending
// ----------------------
export const requestProbationFeedback = async (req: Request, res: Response) => {
    try {
        const { employeeIds } = req.body;

        // fetch employees + their reporting managers
        const employees = await prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                reportingManager: true,
            },
        });

        // collect managers
        const managerIds = Array.from(
            new Set(employees.map(e => e.reportingManager).filter(Boolean))
        ) as number[];

        if (!managerIds.length) {
            return res.json({ success: false, message: "No reporting managers found" });
        }

        // optional: build manager name map (if we want to use names in notification body)
        const mgrMap = await buildManagerNameMap(managerIds);

        // build messages for managers
        const notifications = managerIds.map((mgrId) => {
            // which employees belong to this manager?
            const reportees = employees.filter(e => e.reportingManager === mgrId);
            const names = reportees.map(e => `${e.firstName} ${e.lastName}`).join(", ");

            return {
                employeeId: mgrId,
                message: `Please provide probation feedback for: ${names}`,
                channel: "EMAIL" as const,
            };
        });

        // save notifications
        await prisma.notification.createMany({ data: notifications });

        console.log("Requested probation feedback from managers:", mgrMap);

        return res.json({ success: true, requested: managerIds.length });
    } catch (err) {
        console.error("Probation Feedback Error:", err);
        return res.status(500).json({ error: "Failed to request feedback" });
    }
};


export const extendProbation = async (req: Request, res: Response) => {
    try {
        const { employeeId, newEndDate } = req.body;

        const updated = await prisma.employee.update({
            where: { id: Number(employeeId) },
            data: { probationEndDate: new Date(newEndDate) },
        });

        await prisma.notification.create({
            data: {
                employeeId: updated.id,
                message: `Your probation has been extended until ${newEndDate}.`,
                channel: "EMAIL",
            },
        });

        return res.json({ success: true });
    } catch (err) {
        console.error("Extend Probation Error:", err);
        return res.status(500).json({ error: "Failed to extend probation" });
    }
};

// ----------------------
// 4. Documents expiring
// ----------------------
export const notifyExpiringDocs = async (req: Request, res: Response) => {
    try {
        const { documentIds } = req.body;
        // fetch employees for those documents
        const docs = await prisma.document.findMany({
            where: { id: { in: documentIds } },
            select: { id: true, employeeId: true, title: true, expiryDate: true },
        });

        // create notifications
        await prisma.notification.createMany({
            data: docs.map((doc) => ({
                employeeId: doc.employeeId,
                message: `Your document "${doc.title}" is expiring on ${fmtDate(doc.expiryDate)}.`,
                channel: "EMAIL",
            })),
        });

        console.log("Notified employees for expiring docs:", documentIds);

        return res.json({ success: true, notified: docs.length });

    } catch (err) {
        console.error("Notify Docs Error:", err);
        return res.status(500).json({ error: "Failed to notify employees" });
    }
};

export const createRenewalTickets = async (req: Request, res: Response) => {
    try {
        const { documentIds } = req.body;
        // TODO: integrate with ticket/task system
        console.log("Create renewal tickets for docs:", documentIds);

        return res.json({ success: true, tickets: documentIds.length });
    } catch (err) {
        console.error("Renewal Ticket Error:", err);
        return res.status(500).json({ error: "Failed to create tickets" });
    }
};

// ----------------------
// 5. Missing interview feedback
// ----------------------
// export const nudgePanel = async (req: Request, res: Response) => {
//     try {
//         const { interviewIds } = req.body;
//         // TODO: integrate with notifications
//         console.log("Nudge panel for interviews:", interviewIds);
//         if (!interviewIds || !interviewIds.length) {
//             return res.status(400).json({ error: "interviewIds required" });
//         }

//         // 1️⃣ Fetch interviews with panel members
//         const interviews = await prisma.interview.findMany({
//             where: { id: { in: interviewIds } },
//             select: {
//                 id: true,
//                 panelMembers: {       // adjust field name if different
//                     select: { id: true }
//                 }
//             }
//         });

//         // 2️⃣ Collect all panel member IDs
//         const panelIds = new Set<number>();

//         interviews.forEach(i => {
//             i.panelMembers.forEach(p => {
//                 panelIds.add(p.id);
//             });
//         });

//         const ids = Array.from(panelIds);

//         if (ids.length === 0) {
//             return res.json({ success: true, nudged: 0 });
//         }

//         // 3️⃣ Send notifications
//         await prisma.notification.createMany({
//             data: ids.map(id => ({
//                 employeeId: id,
//                 message: "Please submit interview feedback.",
//                 channel: "IN_APP"
//             }))
//         });

//         return res.json({ success: true, nudged: interviewIds.length });
//     } catch (err) {
//         console.error("Nudge Panel Error:", err);
//         return res.status(500).json({ error: "Failed to nudge panel" });
//     }
// };

export const nudgePanel = async (req: Request, res: Response) => {
    try {
        const { interviewIds } = req.body;

        if (!interviewIds || !interviewIds.length) {
            return res.status(400).json({ error: "interviewIds required" });
        }

        // 1️⃣ Fetch interviews
        const interviews = await prisma.interview.findMany({
            where: { id: { in: interviewIds } },
            select: {
                id: true,
                panelUserIds: true
            }
        });

        // 2️⃣ Collect panel IDs
        const panelIds = new Set<number>();

        interviews.forEach(interview => {
            if (!interview.panelUserIds) return;

            try {
                // assume stored as JSON string like "[1,2,3]"
                const ids = JSON.parse(interview.panelUserIds);

                ids.forEach((id: number) => panelIds.add(id));
            } catch {
                // fallback: comma-separated "1,2,3"
                interview.panelUserIds
                    .split(",")
                    .map(id => Number(id.trim()))
                    .filter(id => !isNaN(id))
                    .forEach(id => panelIds.add(id));
            }
        });

        const ids = Array.from(panelIds);

        if (ids.length === 0) {
            return res.json({ success: true, nudged: 0 });
        }

        // 3️⃣ Send notifications
        await prisma.notification.createMany({
            data: ids.map(id => ({
                employeeId: id,
                message: "Please submit interview feedback.",
                channel: "PUSH" // or EMAIL/SMS depending on your system
            }))
        });
        for (const id of ids) {
            await createNotification(id, "Please submit interview feedback.");
        }


        return res.json({ success: true, nudged: ids.length });

    } catch (err) {
        console.error("Nudge Panel Error:", err);
        return res.status(500).json({ error: "Failed to nudge panel" });
    }
};


export const reassignReviewer = async (req: Request, res: Response) => {
    try {
        const { interviewId, newReviewerIds } = req.body;

        await prisma.interview.update({
            where: { id: Number(interviewId) },
            data: { panelUserIds: newReviewerIds.join(",") },
        });

        return res.json({ success: true });
    } catch (err) {
        console.error("Reassign Reviewer Error:", err);
        return res.status(500).json({ error: "Failed to reassign reviewer" });
    }
};

// ----------------------
// 6. Exit clearances overdue
// ----------------------
export const escalateClearances = async (req: Request, res: Response) => {
    try {
        const { clearanceIds } = req.body;
        // clearanceIds = [{ resignationId: 2, type: "IT" }, ...]

        for (const item of clearanceIds) {
            const { resignationId, type } = item;

            let clearance = await prisma.resignationClearance.findFirst({
                where: { resignationId, type }
            });

            if (clearance) {
                await prisma.resignationClearance.update({
                    where: { id: clearance.id },
                    data: {
                        note: "Escalated by HR",
                        decidedAt: new Date(),
                    },
                });
            } else {
                await prisma.resignationClearance.create({
                    data: {
                        resignationId,
                        type,
                        note: "Escalated by HR",
                        decidedAt: new Date(),
                    },
                });
            }
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("Escalate Clearances Error:", err);
        return res.status(500).json({ error: "Failed to escalate clearances" });
    }
};



export const assignDelegate = async (req: Request, res: Response) => {
    try {
        const { resignationId, type, delegateId } = req.body;

        // find existing clearance for this resignation + type
        let clearance = await prisma.resignationClearance.findFirst({
            where: { resignationId, type }
        });

        if (clearance) {
            // update existing
            await prisma.resignationClearance.update({
                where: { id: clearance.id },
                data: { verifierId: delegateId },
            });
        } else {
            // create new row and assign delegate
            await prisma.resignationClearance.create({
                data: {
                    resignationId,
                    type,
                    verifierId: delegateId,
                },
            });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("Assign Delegate Error:", err);
        return res.status(500).json({ error: "Failed to assign delegate" });
    }
};

/* ════════════════════════════════════════════════════════════════════
   ATTENDANCE BY SHIFT — for the management-dashboard stacked bar card
   ────────────────────────────────────────────────────────────────────
   Buckets ALL active employees by today's shift, then for each shift
   counts: present, late (>15 min after start), earlyCheckout (left
   before shift end), onLeave (approved leave/WFH/permission), absent
   (no check-in, no excuse), unassigned (employee has no resolvable
   shift today — HR data quality bucket).

   Query params:
     date              YYYY-MM-DD (defaults to today, IST)
     compareDays=7     return prior N days summary per shift for trend
     drilldown=1       include employee-level lists (names, deptId,
                       check-in / check-out times, empId)
   ════════════════════════════════════════════════════════════════════ */
export const getAttendanceByShift = async (req: Request, res: Response) => {
    try {
        const dateParam = String((req.query as any).date ?? '').trim();
        const compareDays = Math.min(30, Math.max(0, Number((req.query as any).compareDays ?? 7) || 0));
        const drilldown   = String((req.query as any).drilldown ?? '') === '1';

        // Anchor "today" in IST so this matches what the user sees on screen
        const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
        const baseDate = dateParam
            ? new Date(`${dateParam}T00:00:00.000Z`)
            : new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
        const dayStart = new Date(baseDate);
        const dayEnd   = new Date(baseDate); dayEnd.setUTCHours(23, 59, 59, 999);
        const isToday  = Math.abs(dayStart.getTime() - new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate())).getTime()) < 1000;

        // ── 1. All active employees + their resolved shift for the day ─────
        const [employees, assignments, shiftSettings, shiftTemplates] = await Promise.all([
            prisma.employee.findMany({
                where: { employmentStatus: 'ACTIVE' },
                select: {
                    id: true, employeeCode: true, firstName: true, lastName: true,
                    departmentId: true, shiftId: true,
                    Department: { select: { id: true, name: true } },
                },
            }),
            prisma.shiftAssignment.findMany({
                where: { date: { gte: dayStart, lte: dayEnd } },
                select: { employeeId: true, shiftId: true },
            }),
            (prisma as any).employeeShiftSetting.findMany({
                select: { employeeId: true, mode: true, fixedShiftId: true, rotationPatternId: true },
            }).catch(() => []),
            prisma.shiftTemplate.findMany({
                select: { id: true, name: true, shiftType: true, startTime: true, endTime: true },
            }),
        ]);

        const empIds = employees.map((e) => e.id);

        // Resolution: ShiftAssignment → EmployeeShiftSetting.fixedShiftId → Employee.shiftId
        // (Rotation resolution skipped — falls through to Employee.shiftId.)
        const assignMap = new Map<number, number>();
        for (const a of assignments) assignMap.set(a.employeeId, a.shiftId);
        const settingMap = new Map<number, any>();
        for (const s of shiftSettings as any[]) settingMap.set(s.employeeId, s);

        const employeeShift = new Map<number, number | null>();
        for (const e of employees) {
            let sid: number | null = assignMap.get(e.id) ?? null;
            if (!sid) {
                const setting = settingMap.get(e.id);
                if (setting?.mode === 'FIXED' && setting.fixedShiftId) sid = setting.fixedShiftId;
            }
            if (!sid) sid = e.shiftId ?? null;
            employeeShift.set(e.id, sid);
        }

        // ── 2. Attendance + leave/wfh/permission for the day ───────────────
        const [attendance, approvedLeave, approvedWFH, approvedPerm] = await Promise.all([
            prisma.attendance.findMany({
                where: { employeeId: { in: empIds }, date: { gte: dayStart, lte: dayEnd } },
                select: { employeeId: true, checkIn: true, checkOut: true, status: true },
            }),
            prisma.leaveRequest.findMany({
                where: {
                    employeeId: { in: empIds },
                    status: { in: ['APPROVED'] },
                    startDate: { lte: dayEnd },
                    endDate:   { gte: dayStart },
                },
                select: { employeeId: true },
            }),
            prisma.wFHRequest.findMany({
                where: {
                    employeeId: { in: empIds },
                    status: { in: ['APPROVED'] },
                    startDate: { lte: dayEnd },
                    endDate:   { gte: dayStart },
                },
                select: { employeeId: true },
            }),
            prisma.permissionRequest.findMany({
                where: {
                    employeeId: { in: empIds },
                    status: { in: ['APPROVED'] },
                    OR: [
                        { day: { gte: dayStart, lte: dayEnd } },
                        { startTime: { lte: dayEnd }, endTime: { gte: dayStart } },
                    ],
                },
                select: { employeeId: true },
            }),
        ]);

        const excused = new Set<number>([
            ...approvedLeave.map((x) => x.employeeId),
            ...approvedWFH.map((x) => x.employeeId),
            ...approvedPerm.map((x) => x.employeeId),
        ]);
        const attMap = new Map<number, { checkIn: Date | null; checkOut: Date | null }>();
        for (const a of attendance) {
            attMap.set(a.employeeId, {
                checkIn:  a.checkIn  ? new Date(a.checkIn)  : null,
                checkOut: a.checkOut ? new Date(a.checkOut) : null,
            });
        }

        // ── 3. Bucket each employee under their shift ──────────────────────
        const shiftMeta = new Map(shiftTemplates.map((s) => [s.id, s]));

        // Per-shift bucket: counts + drill-down lists
        type Bucket = {
            shiftId: number | null;
            name: string;
            startTime: string | null;
            endTime: string | null;
            assigned: number;
            present: number;
            late: number;
            earlyCheckout: number;
            onLeave: number;
            absent: number;
            attendancePct: number;
            employees: any[];   // populated only when drilldown=1
        };
        const buckets = new Map<number | string, Bucket>();
        const ensure = (shiftId: number | null): Bucket => {
            const key = shiftId ?? 'UNASSIGNED';
            if (!buckets.has(key)) {
                const meta = shiftId ? shiftMeta.get(shiftId) : null;
                buckets.set(key, {
                    shiftId,
                    name: meta?.name ?? 'Unassigned',
                    startTime: meta ? toHHMM(meta.startTime) : null,
                    endTime:   meta ? toHHMM(meta.endTime)   : null,
                    assigned: 0, present: 0, late: 0, earlyCheckout: 0,
                    onLeave: 0, absent: 0, attendancePct: 0,
                    employees: [],
                });
            }
            return buckets.get(key)!;
        };

        for (const e of employees) {
            const sid = employeeShift.get(e.id) ?? null;
            const bucket = ensure(sid);
            bucket.assigned++;

            const meta = sid ? shiftMeta.get(sid) : null;
            const att  = attMap.get(e.id);

            // Status precedence: leave > absent > present (with late/early flags)
            let category: 'present' | 'late' | 'earlyCheckout' | 'onLeave' | 'absent' = 'absent';
            let lateBy: number | null = null;
            let leftEarlyBy: number | null = null;

            if (excused.has(e.id)) {
                category = 'onLeave';
                bucket.onLeave++;
            } else if (att?.checkIn) {
                category = 'present';
                bucket.present++;
                if (meta) {
                    const shiftStart = combineDateAndTimeUTC(dayStart, meta.startTime);
                    const lateMs = att.checkIn.getTime() - shiftStart.getTime();
                    const lateMinutes = Math.round(lateMs / 60000);
                    if (lateMinutes > 15) {
                        category = 'late';
                        lateBy = lateMinutes;
                        bucket.late++;
                    }
                    if (att.checkOut) {
                        const shiftEnd = combineDateAndTimeUTC(dayStart, meta.endTime);
                        const earlyMs  = shiftEnd.getTime() - att.checkOut.getTime();
                        const earlyMin = Math.round(earlyMs / 60000);
                        if (earlyMin > 0) {
                            // Track separately — also stays in present/late count
                            leftEarlyBy = earlyMin;
                            bucket.earlyCheckout++;
                        }
                    }
                }
            } else {
                bucket.absent++;
            }

            if (drilldown) {
                bucket.employees.push({
                    employeeId:  e.id,
                    employeeCode: e.employeeCode,
                    name: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(),
                    departmentId: e.departmentId,
                    departmentName: e.Department?.name ?? null,
                    shiftId: sid,
                    shiftName: meta?.name ?? null,
                    shiftStartTime: meta ? toHHMM(meta.startTime) : null,
                    shiftEndTime:   meta ? toHHMM(meta.endTime)   : null,
                    checkIn:  att?.checkIn  ?? null,
                    checkOut: att?.checkOut ?? null,
                    category,
                    lateByMinutes:    lateBy,
                    leftEarlyMinutes: leftEarlyBy,
                });
            }
        }

        // Compute attendance % per bucket (present + late) / assigned
        for (const b of buckets.values()) {
            b.attendancePct = b.assigned > 0
                ? Math.round(((b.present) / b.assigned) * 100)
                : 0;
        }

        const sortedShifts = Array.from(buckets.values()).sort((a, b) => {
            // Real shifts first (by startTime), then Unassigned at the bottom
            if (a.shiftId === null) return 1;
            if (b.shiftId === null) return -1;
            return (a.startTime ?? '').localeCompare(b.startTime ?? '');
        });

        // ── 4. Optional comparison: per-shift attendance % over last N days ──
        let comparison: any[] = [];
        if (compareDays > 0) {
            comparison = await buildShiftComparison(dayStart, compareDays, shiftTemplates);
        }

        return res.json({
            date: dayStart.toISOString().slice(0, 10),
            isToday,
            totalActive: employees.length,
            shifts: sortedShifts,
            comparison,
        });
    } catch (err) {
        console.error("getAttendanceByShift error:", err);
        return res.status(500).json({ error: "Failed to load shift-wise attendance" });
    }
};

/* ── Helpers used by getAttendanceByShift ─────────────────────────────── */

// function toHHMM(d: Date | null | undefined): string | null {
//     if (!d) return null;
//     const dt = new Date(d);
//     return `${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`;
// }
function toHHMM(d: Date | null | undefined): string | null {
    if (!d) return null;
    const dt = new Date(d);
    // Shift times are stored in DB as UTC but represent IST wall-clock hours.
    // Add the IST offset (+5:30) before formatting so the user sees the
    // correct shift time (e.g. "07:30" instead of "02:00").
    const ist = new Date(dt.getTime() + 5.5 * 3600 * 1000);
    return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}

function combineDateAndTimeUTC(baseDate: Date, time: Date): Date {
    const t = new Date(time);
    const d = new Date(baseDate);
    d.setUTCHours(t.getUTCHours(), t.getUTCMinutes(), 0, 0);
    return d;
}

/** For each prior day in the window, recompute the per-shift attendance %.
 *  Lighter version of the main aggregation — counts only, no drill-down. */
async function buildShiftComparison(anchorDay: Date, days: number, templates: any[]) {
    const series: any[] = [];
    const shiftIds = templates.map((s) => s.id);

    for (let i = days; i >= 1; i--) {
        const d = new Date(anchorDay); d.setUTCDate(d.getUTCDate() - i);
        const dEnd = new Date(d); dEnd.setUTCHours(23, 59, 59, 999);

        const [activeEmps, atts, leaves, wfhs, perms, assignments, settings] = await Promise.all([
            prisma.employee.findMany({
                where: { employmentStatus: 'ACTIVE' },
                select: { id: true, shiftId: true },
            }),
            prisma.attendance.findMany({
                where: { date: { gte: d, lte: dEnd }, checkIn: { not: null } },
                select: { employeeId: true },
            }),
            prisma.leaveRequest.findMany({
                where: { status: 'APPROVED', startDate: { lte: dEnd }, endDate: { gte: d } },
                select: { employeeId: true },
            }),
            prisma.wFHRequest.findMany({
                where: { status: 'APPROVED', startDate: { lte: dEnd }, endDate: { gte: d } },
                select: { employeeId: true },
            }),
            prisma.permissionRequest.findMany({
                where: { status: 'APPROVED', day: { gte: d, lte: dEnd } },
                select: { employeeId: true },
            }),
            prisma.shiftAssignment.findMany({
                where: { date: { gte: d, lte: dEnd } },
                select: { employeeId: true, shiftId: true },
            }),
            (prisma as any).employeeShiftSetting.findMany({
                select: { employeeId: true, mode: true, fixedShiftId: true },
            }).catch(() => []),
        ]);

        const present = new Set(atts.map((a) => a.employeeId));
        const excused = new Set([
            ...leaves.map((x) => x.employeeId),
            ...wfhs.map((x) => x.employeeId),
            ...perms.map((x) => x.employeeId),
        ]);
        const aMap = new Map<number, number>(assignments.map((a) => [a.employeeId, a.shiftId]));
        const sMap = new Map<number, any>((settings as any[]).map((s) => [s.employeeId, s]));

        const dayBucket: Record<string, { assigned: number; present: number }> = {};
        for (const sid of shiftIds) dayBucket[sid] = { assigned: 0, present: 0 };

        for (const e of activeEmps) {
            const sid = aMap.get(e.id) ?? (sMap.get(e.id)?.fixedShiftId ?? e.shiftId ?? null);
            if (!sid) continue;
            const slot = dayBucket[sid] ?? (dayBucket[sid] = { assigned: 0, present: 0 });
            slot.assigned++;
            if (present.has(e.id) || excused.has(e.id)) slot.present++;
        }

        const perShift: Record<string, number> = {};
        for (const sid of shiftIds) {
            const b = dayBucket[sid];
            perShift[sid] = b.assigned > 0 ? Math.round((b.present / b.assigned) * 100) : 0;
        }
        series.push({ date: d.toISOString().slice(0, 10), perShift });
    }

    return series;
}

