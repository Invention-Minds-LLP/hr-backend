import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { createNotification } from '../notifications/notifications.controller';
import { ShiftType } from '@prisma/client';
import { generateCompOffIfEligible } from '../../services/comOff.service';

const prisma = new PrismaClient();

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

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseDate(date: string) {
  const [dd, mm, yyyy] = date.split('/');
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
}

function getCosecRange(d: Date) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}-${dd}${mm}${yyyy}`;
}

/* ---------------------------------
   COSEC UTILS
---------------------------------- */

function parsePunch(dateStr: string, punchStr?: string): Date | null {
  if (!punchStr) return null;

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


function extractPunches(rec: any): Date[] {
  // console.log(`  Extracting punches for record on date: ${rec.processdate}`, rec);
  const punches: Date[] = [];
  for (let i = 1; i <= 10; i++) {
    const p = rec[`punch${i}`];
    // console.log(`    Punch ${i}:`, p);
    if (!p) continue;
    const dt = parsePunch(rec.processdate, p);
    if (dt) punches.push(dt);
  }
  return punches.sort((a, b) => a.getTime() - b.getTime());
}

/* ---------------------------------
   SHIFT HELPERS
---------------------------------- */

async function isNightShift(employeeId: number, date: Date): Promise<boolean> {
  const assignment = await prisma.shiftAssignment.findFirst({
    where: { employeeId, date },
    include: { shift: true },
  });

  if (!assignment?.shift) return false;

  const start = new Date(assignment.shift.startTime);
  const end = new Date(assignment.shift.endTime);

  let hrs = (end.getTime() - start.getTime()) / 36e5;
  if (hrs < 0) hrs += 24;

  return hrs >= 12;
}

// Shift times are stored as UTC timestamps where UTC hours == IST hours
// (e.g., "1970-01-01T11:30:00.000Z" represents 5 PM IST for General 2 shift).
// Use UTC methods exclusively to avoid server-timezone dependency.

function combineShiftStart(day: Date, shiftStart: Date) {
  // Get IST calendar date from 'day' (which may be UTC midnight of IST date)
  const dayIst = new Date(day.getTime() + 5.5 * 3600000);
  // Build result using IST date components + shift UTC time components
  return new Date(Date.UTC(
    dayIst.getUTCFullYear(),
    dayIst.getUTCMonth(),
    dayIst.getUTCDate(),
    shiftStart.getUTCHours(),
    shiftStart.getUTCMinutes(),
    shiftStart.getUTCSeconds()
  ));
}

function combineShiftEnd(day: Date, start: Date, end: Date) {
  const dayIst = new Date(day.getTime() + 5.5 * 3600000);
  const result = new Date(Date.UTC(
    dayIst.getUTCFullYear(),
    dayIst.getUTCMonth(),
    dayIst.getUTCDate(),
    end.getUTCHours(),
    end.getUTCMinutes(),
    end.getUTCSeconds()
  ));
  // Night shift: if end time-of-day is before start time-of-day, it rolls to next day
  const endMins   = end.getUTCHours()   * 60 + end.getUTCMinutes();
  const startMins = start.getUTCHours() * 60 + start.getUTCMinutes();
  if (endMins < startMins) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
}

function diffMinutes(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}
async function hasLeaveOrPermission(
  employeeId: number,
  date: Date
): Promise<boolean> {

  const leave = await prisma.leaveRequest.findFirst({
    where: {
      employeeId,
      status: { in: ['APPROVED', 'PENDING'] },
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });

  if (leave) return true;

  const permission = await prisma.permissionRequest.findFirst({
    where: {
      employeeId,
      status: { in: ['APPROVED', 'PENDING'] },
      day: date,
    },
  });

  return !!permission;
}


/* ---------------------------------
   COSEC FETCH
---------------------------------- */

async function fetchAttendanceDaily(date: Date) {
  const range = getCosecRange(date);

  const url =
    `${COSEC_BASE_URL}/attendance-daily` +
    `?action=get;field-name=userid,processdate,punch1,punch2,punch3,punch4,punch5,punch6,punch7,punch8,punch9,punch10;` +
    `date-range=${range};range=organization;id=2;active=1;format=json`;

  const res = await axios.get(url, {
    auth: { username: COSEC_USERNAME, password: COSEC_PASSWORD },
    timeout: 300000,
  });

  return res.data['attendance-daily'] || [];
}

/**
 * Debug helper — runs an arbitrary COSEC attendance-daily query and returns
 * the FULL list of userids plus a presence check for the code you care about.
 * Used by the /api/biometric/cosec-debug endpoint so we can answer: "does
 * COSEC actually return JMRH463 when we hit it from here?" without grepping
 * server logs.
 *
 * Pass `noFilter: true` to skip `range=organization;id=2;active=1` entirely
 * (replicates your Postman test URL). Pass `active: 0` to test the toggle.
 */
export async function debugFetchCosec(opts: {
  date: Date;
  checkCode?: string;
  noFilter?: boolean;
  active?: 0 | 1;
  orgId?: number;
}) {
  const range = getCosecRange(opts.date);
  const fields = 'userid,processdate,punch1,punch2,punch3,punch4,punch5,punch6,punch7,punch8,punch9,punch10';
  let filter = '';
  if (!opts.noFilter) {
    const orgId  = opts.orgId  ?? 2;
    const active = opts.active === undefined ? 1 : opts.active;
    filter = `;range=organization;id=${orgId};active=${active}`;
  }
  const url =
    `${COSEC_BASE_URL}/attendance-daily` +
    `?action=get;field-name=${fields};date-range=${range}${filter};format=json`;

  const t0 = Date.now();
  const res = await axios.get(url, {
    auth: { username: COSEC_USERNAME, password: COSEC_PASSWORD },
    timeout: 300000,
  });
  const elapsedMs = Date.now() - t0;

  const records: any[] = res.data['attendance-daily'] || [];
  const allUserids = records.map((r) => String(r.userid ?? '').trim());

  let presence: any = null;
  if (opts.checkCode) {
    const target = opts.checkCode.toUpperCase().trim();
    const exact  = allUserids.find((u) => u.toUpperCase() === target);
    const containing = allUserids.filter((u) => u.toUpperCase().includes(target.slice(0, 4)));
    presence = {
      checkCode: opts.checkCode,
      foundExact: !!exact,
      exactValue: exact ?? null,
      // First 10 userids whose first 4 chars match — useful to spot near misses
      // (e.g. you searched JMRH463 but COSEC has JMRH0463).
      similarUserids: containing.slice(0, 10),
    };
  }

  return {
    url,
    elapsedMs,
    totalRecords: records.length,
    allUserids,
    presence,
  };
}

/* ---------------------------------
   MAIN BIOMETRIC SYNC
---------------------------------- */

export async function runBiometricSync(isFinalRun: boolean) {
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
  const employees = await prisma.employee.findMany({
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


  // Normalize employeeCode to uppercase so biometric userid matches regardless of case
  // (e.g. DB "JMRH234" vs device sending "jmrh234")
  const empMap = new Map(employees.map(e => [String(e.employeeCode).toUpperCase().trim(), e.id]));
  // console.log(empMap)



  /* ======================================================
     PART 1: PROCESS TODAY'S BIOMETRIC (CHECK-IN)
  ====================================================== */

  const todayRecords = await fetchAttendanceDaily(today);
  console.log(`  Fetched ${todayRecords.length} biometric records for today`);

  for (const r of todayRecords) {
    // console.log(r.userId, 'userId')
    const employeeId = empMap.get(String(r.userid ?? '').toUpperCase().trim());
    // console.log(employeeId)
    if (!employeeId) continue;

    const date = parseDate(r.processdate);
    console.log(`Processing attendance for Employee ID: ${employeeId} | Date: ${date.toDateString()}`);
    const punches = extractPunches(r);
    // console.log(`  Extracted punches: ${punches.length}`);
    // console.log(`  Punch times: ${punches.map(p => p.toISOString()).join(', ')}`);
    if (!punches.length) continue;

    const night = await isNightShift(employeeId, date);
    const wasNightYesterday = await isNightShift(employeeId, yesterday);

    let checkIn: Date | null = null;

    if (wasNightYesterday) {
      checkIn = punches.length > 1 ? punches[1] : null;
    } else {
      checkIn = punches[0];
    }

    const checkOut =
      night || punches.length === 1
        ? null
        : punches[punches.length - 1];

    // -------- STATUS DECISION (FIXED) --------

    let finalStatus: string;

    if (!checkIn) {
      finalStatus = isFinalRun ? 'Absent' : 'IN_PROGRESS';
    } else {
      finalStatus = 'Present';
    }

    if (checkIn && checkOut && !night && !wasNightYesterday) {
      const workedMin = diffMinutes(checkIn, checkOut);

      if (workedMin < 240) {
        const allowed = await hasLeaveOrPermission(employeeId, date);
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
    const attendance = await prisma.attendance.upsert({
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
    await generateCompOffIfEligible(attendance);

    // 🔑 Auto-cancel approved leave if employee is Present
    if (finalStatus === 'Present') {
      await autoCancelLeaveIfPresent(employeeId, date);
    }

  }

  /* ======================================================
     PART 2: CLOSE NIGHT SHIFT (YESTERDAY) USING TODAY PUNCH
  ====================================================== */

  for (const r of todayRecords) {
    const employeeId = empMap.get(String(r.userid ?? '').toUpperCase().trim());
    if (!employeeId) continue;

    const punches = extractPunches(r);
    if (!punches.length) continue;

    const yAttendance = await prisma.attendance.findUnique({
      where: {
        employeeId_date: {
          employeeId,
          date: yesterday,
        },
      },
    });

    if (!yAttendance || yAttendance.checkOut) continue;

    const wasNight = await isNightShift(employeeId, yesterday);
    if (!wasNight) continue;

    await prisma.attendance.update({
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


  const allShifts = await prisma.shiftTemplate.findMany({
    select: {
      id: true,
      shiftType: true,
      startTime: true,
      endTime: true,
    },
  });

  const shiftsByType = new Map<ShiftType, typeof allShifts>();

  for (const s of allShifts) {
    if (!shiftsByType.has(s.shiftType)) {
      shiftsByType.set(s.shiftType, []);
    }
    shiftsByType.get(s.shiftType)!.push(s);
  }
  const getShiftTypeByRoleAndDepartment = (
    roleId: number,
    departmentId: number
  ): ShiftType => {
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




  const findNearestShiftStart = (
    date: Date,
    checkIn: Date,
    shifts: { startTime: Date }[]
  ): Date | null => {
    let nearest: Date | null = null;
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

  const findNearestShiftEnd = (
    date: Date,
    checkOut: Date,
    shifts: { startTime: Date; endTime: Date }[]
  ): Date | null => {
    let nearest: Date | null = null;
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

  const todayAttendance = await prisma.attendance.findMany({
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
    if (!rec.checkIn) continue;

    const shiftType = getShiftTypeByRoleAndDepartment(
      rec.employee.roleId,
      rec.employee.departmentId
    );
    console.log(`Employee ID: ${rec.employeeId} | Dept ID: ${rec.employee.departmentId} | Shift Type: ${shiftType}`);

    const shifts = shiftsByType.get(shiftType);
    console.log(`  Found ${shifts?.length || 0} shifts for type ${shiftType}`);
    if (!shifts || shifts.length === 0) continue;

    const shiftStart = findNearestShiftStart(
      today,
      rec.checkIn,
      shifts
    );
    console.log(`  Shift Start: ${shiftStart} | Check-In: ${rec.checkIn}`);
    if (!shiftStart) continue;


    console.log(`  Shift Start: ${shiftStart} | Check-In: ${rec.checkIn}`);

    const lateMin = Math.round(
      (rec.checkIn.getTime() - shiftStart.getTime()) / 60000
    );

    console.log(`  Late Minutes: ${lateMin}`);

    if (lateMin > 15) {
      await prisma.lateLoginLog.upsert({
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

  const yAttendance = await prisma.attendance.findMany({
    where: { date: yesterday },
    include: {
      employee: {
        select: {
          id: true,
          departmentId: true,
          roleId: true,
          overtimeEnabled: true,
        },
      },
    },
  });

  for (const rec of yAttendance) {
    if (!rec.checkOut) continue;
    // Skip employees who don't have overtime enabled
    if (!rec.employee.overtimeEnabled) continue;

    const shiftType = getShiftTypeByRoleAndDepartment(
      rec.employee.roleId,
      rec.employee.departmentId
    );

    const shifts = shiftsByType.get(shiftType);
    if (!shifts || shifts.length === 0) continue;

    const schedEnd = findNearestShiftEnd(
      yesterday,
      rec.checkOut,
      shifts
    );

    console.log(`Employee ID: ${rec.employeeId} | Dept ID: ${rec.employee.departmentId} | Shift Type: ${shiftType}`);
    console.log(`  Scheduled End: ${schedEnd} | Check-Out: ${rec.checkOut}`);

    if (!schedEnd) continue;

    const otMin = Math.round(
      (rec.checkOut.getTime() - schedEnd.getTime()) / 60000
    );

    if (otMin > 60 && otMin <= 720) {
      await prisma.overtimeApproval.upsert({
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


}

// Standalone function that runs ONLY the Late Login + Overtime calculation
// for a given attendance date. Does NOT hit the biometric device (COSEC).
// Use this from debug endpoints or tests to verify shift-time logic.
export async function runOtAndLateLoginForDate(targetDate: Date) {
  const day = startOfDay(targetDate);

  const allShifts = await prisma.shiftTemplate.findMany({
    select: { id: true, shiftType: true, startTime: true, endTime: true },
  });

  const shiftsByType = new Map<ShiftType, typeof allShifts>();
  for (const s of allShifts) {
    if (!shiftsByType.has(s.shiftType)) shiftsByType.set(s.shiftType, []);
    shiftsByType.get(s.shiftType)!.push(s);
  }

  const getShiftTypeByRoleAndDepartment = (roleId: number, departmentId: number): ShiftType => {
    if (roleId === 1 || roleId === 3) return 'REPORTING_MANAGER';
    if (departmentId === 3) return 'NURSING';
    if (departmentId === 4) return 'MOD';
    if (roleId === 2) return 'EXECUTIVE';
    return 'EXECUTIVE';
  };

  const findNearestShiftStart = (date: Date, checkIn: Date, shifts: { startTime: Date }[]) => {
    let nearest: Date | null = null; let minDiff = Infinity;
    for (const s of shifts) {
      const shiftStart = combineShiftStart(date, s.startTime);
      const diff = Math.abs(checkIn.getTime() - shiftStart.getTime());
      if (diff < minDiff) { minDiff = diff; nearest = shiftStart; }
    }
    return nearest;
  };

  const findNearestShiftEnd = (date: Date, checkOut: Date, shifts: { startTime: Date; endTime: Date }[]) => {
    let nearest: Date | null = null; let minDiff = Infinity;
    for (const s of shifts) {
      const shiftEnd = combineShiftEnd(date, s.startTime, s.endTime);
      const diff = Math.abs(checkOut.getTime() - shiftEnd.getTime());
      if (diff < minDiff) { minDiff = diff; nearest = shiftEnd; }
    }
    return nearest;
  };

  const attendance = await prisma.attendance.findMany({
    where: { date: day },
    include: { employee: { select: { id: true, departmentId: true, roleId: true, overtimeEnabled: true } } },
  });

  for (const rec of attendance) {
    const shiftType = getShiftTypeByRoleAndDepartment(rec.employee.roleId, rec.employee.departmentId);
    const shifts = shiftsByType.get(shiftType);
    if (!shifts || shifts.length === 0) continue;

    // Late Login
    if (rec.checkIn) {
      const shiftStart = findNearestShiftStart(day, rec.checkIn, shifts);
      if (shiftStart) {
        const lateMin = Math.round((rec.checkIn.getTime() - shiftStart.getTime()) / 60000);
        if (lateMin > 15) {
          await prisma.lateLoginLog.upsert({
            where: { employeeId_date: { employeeId: rec.employeeId, date: day } },
            create: {
              employeeId: rec.employeeId, date: day, shiftStart,
              checkIn: rec.checkIn, lateMinutes: lateMin, source: 'TEMP_DEPT_SHIFT',
            },
            update: { shiftStart, checkIn: rec.checkIn, lateMinutes: lateMin },
          });
        }
      }
    }

    // Overtime — only for employees with overtimeEnabled = true
    if (rec.checkOut && rec.employee.overtimeEnabled) {
      const schedEnd = findNearestShiftEnd(day, rec.checkOut, shifts);
      if (schedEnd) {
        const otMin = Math.round((rec.checkOut.getTime() - schedEnd.getTime()) / 60000);
        if (otMin > 60 && otMin <= 720) {
          await prisma.overtimeApproval.upsert({
            where: { employeeId_date: { employeeId: rec.employeeId, date: day } },
            create: {
              employeeId: rec.employeeId, date: day, minutes: otMin,
              scheduledEnd: schedEnd, checkOut: rec.checkOut, status: 'PENDING',
            },
            update: { minutes: otMin, scheduledEnd: schedEnd, checkOut: rec.checkOut },
          });
        }
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// BACKFILL: Re-process biometric attendance for ONE employee across a
// date range. Fetches COSEC per-day and upserts Attendance rows.
// ════════════════════════════════════════════════════════════════════
export async function backfillEmployeeAttendance(
  employeeCode: string,
  fromDate: Date,
  toDate: Date
) {
  const normalizedCode = String(employeeCode).toUpperCase().trim();
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🔄 [BACKFILL] Starting for code="${employeeCode}" (normalized="${normalizedCode}")`);
  console.log(`   Range: ${fromDate.toDateString()} → ${toDate.toDateString()}`);

  const employee = await prisma.employee.findFirst({
    where: { employeeCode: { equals: normalizedCode } },
    select: { id: true, employeeCode: true, firstName: true, lastName: true },
  });

  if (!employee) {
    console.log(`❌ [BACKFILL] Employee NOT FOUND for code: ${normalizedCode}`);
    // Try case-insensitive search for debugging
    const all = await prisma.employee.findMany({
      where: { employeeCode: { contains: normalizedCode.slice(0, 4) } },
      select: { employeeCode: true },
      take: 5,
    });
    console.log(`   Did you mean one of these? ${all.map(e => e.employeeCode).join(', ')}`);
    throw new Error(`Employee not found for code: ${employeeCode}`);
  }

  console.log(`✅ [BACKFILL] Found employee: id=${employee.id}, code=${employee.employeeCode}, name="${employee.firstName} ${employee.lastName}"`);

  const start = startOfDay(fromDate);
  const end = startOfDay(toDate);
  if (end < start) throw new Error("toDate must be >= fromDate");

  const results: any[] = [];
  let dayIndex = 0;
  const totalDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dayIndex++;
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    const dayStr = day.toDateString();

    console.log(`\n──────────────────────────────────────────────`);
    console.log(`📅 [BACKFILL] Day ${dayIndex}/${totalDays}: ${dayStr}`);

    try {
      console.log(`   🌐 Fetching COSEC attendance-daily for ${day.toDateString()}...`);
      const records = await fetchAttendanceDaily(day);
      console.log(`   📥 COSEC returned ${records.length} records`);

      const r = records.find(
        (rec: any) => String(rec.userid ?? '').toUpperCase().trim() === normalizedCode
      );

      if (!r) {
        const sampleUserids = records.slice(0, 5).map((x: any) => x.userid);
        console.log(`   ⚠️  No record for code=${normalizedCode} on this day. Sample userids in response:`,
          sampleUserids);
        // Surface diagnostics in the API response so the caller doesn't need
        // to grep server logs. cosecRecordCount=0 means COSEC returned nothing
        // (unreachable / wrong org id / wrong date format). >0 means the user
        // isn't in COSEC's response for that day (possibly inactive / wrong code).
        results.push({
          date: dayStr,
          status: 'NO_BIOMETRIC_DATA',
          cosecRecordCount: records.length,
          sampleUserids,
        });
        continue;
      }

      console.log(`   ✔️  Found user record. userid=${r.userid}, processdate=${r.processdate}`);

      const punches = extractPunches(r);
      console.log(`   🕒 Punches (${punches.length}): ${punches.map(p => p.toISOString()).join(', ')}`);

      if (!punches.length) {
        console.log(`   ⚠️  No valid punches.`);
        results.push({ date: dayStr, status: 'NO_PUNCHES' });
        continue;
      }

      const prevDay = new Date(day);
      prevDay.setDate(prevDay.getDate() - 1);

      const night = await isNightShift(employee.id, day);
      const wasNightYesterday = await isNightShift(employee.id, prevDay);
      console.log(`   🌙 night shift today=${night}, was night yesterday=${wasNightYesterday}`);

      let checkIn: Date | null = null;
      if (wasNightYesterday) {
        checkIn = punches.length > 1 ? punches[1] : null;
      } else {
        checkIn = punches[0];
      }

      const checkOut =
        night || punches.length === 1 ? null : punches[punches.length - 1];

      console.log(`   ▶️  checkIn=${checkIn?.toISOString() ?? 'null'}, checkOut=${checkOut?.toISOString() ?? 'null'}`);

      let finalStatus = checkIn ? 'Present' : 'Absent';
      if (checkIn && checkOut && !night && !wasNightYesterday) {
        const workedMin = diffMinutes(checkIn, checkOut);
        console.log(`   ⏱️  Worked ${workedMin} min`);
        if (workedMin < 240) {
          const allowed = await hasLeaveOrPermission(employee.id, day);
          finalStatus = allowed ? 'Present' : 'ON_HOLD';
          console.log(`   ⚠️  <240 min, leave/permission=${allowed} → status=${finalStatus}`);
        }
      }

      console.log(`   💾 Upserting attendance: status=${finalStatus}`);
      const attendance = await prisma.attendance.upsert({
        where: { employeeId_date: { employeeId: employee.id, date: day } },
        create: { employeeId: employee.id, date: day, checkIn, checkOut, status: finalStatus },
        update: { checkIn, checkOut, status: finalStatus },
      });
      console.log(`   ✅ Attendance upserted id=${attendance.id}`);

      await generateCompOffIfEligible(attendance);
      if (finalStatus === 'Present') {
        await autoCancelLeaveIfPresent(employee.id, day);
      }

      results.push({
        date: dayStr,
        status: finalStatus,
        checkIn: checkIn?.toISOString() ?? null,
        checkOut: checkOut?.toISOString() ?? null,
        punches: punches.length,
      });
    } catch (err: any) {
      console.log(`   ❌ ERROR on ${dayStr}:`, err.message);
      results.push({ date: dayStr, status: 'ERROR', error: err.message });
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ [BACKFILL] Completed. Processed ${results.length} days`);
  console.log(`   Status summary:`, results.reduce((acc: any, r: any) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {}));
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  return {
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    totalDays: results.length,
    days: results,
  };
}

async function notifyHRShiftSummary() {
  const today = startOfDay(new Date());
  const graceMinutes = 15;

  // Find shifts that STARTED before this run
  const shifts = await prisma.shiftAssignment.findMany({
    where: {
      date: today,
    },
    include: {
      shift: true,
    },
  });

  for (const s of shifts) {
    if (!s.shift) continue;

    const shiftStart = combineShiftStart(today, s.shift.startTime);
    const lateAfter = new Date(
      shiftStart.getTime() + graceMinutes * 60000
    );

    // 🔑 Only evaluate shifts relevant to THIS RUN
    if (new Date < lateAfter) continue;

    const totalEmployees = await prisma.shiftAssignment.count({
      where: {
        date: today,
        shiftId: s.shiftId,
      },
    });

    const lateCount = await prisma.attendance.count({
      where: {
        date: today,
        employeeId: {
          in: (
            await prisma.shiftAssignment.findMany({
              where: { date: today, shiftId: s.shiftId },
              select: { employeeId: true },
            })
          ).map(e => e.employeeId),
        },
        OR: [
          { checkIn: null },
          { checkIn: { gt: lateAfter } },
        ],
      },
    });

    if (lateCount === 0) continue;

    // 🔒 Prevent duplicate notification for same run + shift
    const key = `${today.toISOString()}-${new Date().getHours()}-${s.shiftId}`;

    const exists = await prisma.attendanceNotificationLog.findUnique({
      where: { uniqueKey: key },
    });
    if (exists) continue;

    const message =
      `Attendance Update (${shiftStart.toLocaleTimeString()} shift):\n` +
      `${lateCount} of ${totalEmployees} employee(s) late or missing check-in.`;

    const hrEmployees = await prisma.employee.findMany({
      where: { departmentId: 1 },
      select: { id: true },
    });

    for (const hr of hrEmployees) {
      await createNotification(hr.id, message);
    }

    await prisma.attendanceNotificationLog.create({
      data: {
        uniqueKey: key,
        date: today,
        shiftId: s.shiftId,
        runAt: new Date(),
        lateCount,
      },
    });
  }
}

/**
 * For a SINGLE-DAY half-day leave, decide whether the employee's actual punch
 * overlaps the half they took off. The day's shift is split at its midpoint
 * (an 8-hour shift → 4 h + 4 h), giving a FIRST_HALF and a SECOND_HALF window.
 *
 *   true  → punch overlaps the leave half  → they worked when they should've
 *           been on leave → the half-day leave should be auto-cancelled.
 *   false → punch falls only in the OTHER half (e.g. applied SECOND_HALF but
 *           logged in for the first half) → the half-day leave is legitimate
 *           and must be kept.
 *
 * Times are compared as "minutes since the shift's calendar midnight" so the
 * result doesn't depend on the server timezone: punch Dates are built from
 * local components (getHours() == IST wall clock) while shift times are stored
 * as UTC where UTC-hours == IST-hours (getUTCHours()).
 *
 * Falls back to `true` (the previous "cancel on present" behaviour) whenever
 * the shift or punch data is missing, so we never silently keep a leave we
 * can't reason about.
 */
async function presentDuringLeaveHalf(
  employeeId: number,
  dayStart: Date,
  dayEnd: Date,
  session: 'FIRST_HALF' | 'SECOND_HALF',
): Promise<boolean> {
  const assignment = await prisma.shiftAssignment.findFirst({
    where: { employeeId, date: { gte: dayStart, lte: dayEnd } },
    include: { shift: true },
  });
  const shift = assignment?.shift;

  const attendance = await prisma.attendance.findFirst({
    where: { employeeId, date: { gte: dayStart, lte: dayEnd } },
    select: { checkIn: true, checkOut: true },
  });

  // Can't resolve shift bounds or there's no check-in → preserve old behaviour.
  if (!shift || !attendance?.checkIn) return true;

  const shiftStart = new Date(shift.startTime);
  const shiftEnd = new Date(shift.endTime);

  // Shift times are stored as UTC instants; convert to IST wall-clock minutes
  // (+5:30) so they line up with punch times, which are already IST wall-clock.
  const IST_OFFSET = 330;
  const toIstMin = (d: Date) =>
    (((d.getUTCHours() * 60 + d.getUTCMinutes() + IST_OFFSET) % 1440) + 1440) % 1440;

  const startMin = toIstMin(shiftStart);
  let endMin = toIstMin(shiftEnd);
  if (endMin <= startMin) endMin += 1440; // overnight shift wraps past midnight
  const midMin = (startMin + endMin) / 2;

  const leaveStart = session === 'FIRST_HALF' ? startMin : midMin;
  const leaveEnd = session === 'FIRST_HALF' ? midMin : endMin;

  // Normalise punch minutes onto the same axis as the shift (handle wrap).
  const norm = (m: number) => (m < startMin ? m + 1440 : m);
  const workedStart = norm(attendance.checkIn.getHours() * 60 + attendance.checkIn.getMinutes());
  const workedEnd = attendance.checkOut
    ? norm(attendance.checkOut.getHours() * 60 + attendance.checkOut.getMinutes())
    : workedStart;

  // Half-open overlap between the worked window and the leave half.
  return workedStart < leaveEnd && workedEnd > leaveStart;
}

/* ---------------------------------
   AUTO-CANCEL LEAVE IF PRESENT
---------------------------------- */
export async function autoCancelLeaveIfPresent(employeeId: number, date: Date) {
  try {
    const targetDate = startOfDay(date);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    // ── 1. Cancel PENDING leave (no balance was deducted) ──────────
    const pendingLeave = await prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: 'PENDING',
        startDate: { lte: dayEnd },
        endDate: { gte: targetDate },
      },
      include: {
        employee: {
          select: {
            firstName: true, lastName: true, employeeCode: true,
            inchargeId: true, reportingManager: true, departmentId: true,
          },
        },
        leaveType: { select: { name: true } },
      },
    });

    if (pendingLeave) {
      const isSingle = isSameDay(pendingLeave.startDate, pendingLeave.endDate);

      // Half-day leave: only cancel if the punch actually overlaps the half
      // they took off. If they applied SECOND_HALF but logged in for the first
      // half (or vice-versa), the leave is legitimate — leave it untouched.
      if (isSingle && pendingLeave.isHalfDay && pendingLeave.halfDaySession) {
        const present = await presentDuringLeaveHalf(
          employeeId, targetDate, dayEnd, pendingLeave.halfDaySession as 'FIRST_HALF' | 'SECOND_HALF',
        );
        if (!present) {
          console.log(`↩️  Kept PENDING half-day leave #${pendingLeave.id} — present only in the other half`);
          return;
        }
      }

      if (isSingle) {
        await prisma.leaveRequest.update({
          where: { id: pendingLeave.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancellationReason: 'Auto-cancelled: Employee marked Present via biometric (pending leave)',
          },
        });
      } else {
        // For multi-day pending leave, just cancel — no split needed since not approved
        await prisma.leaveRequest.update({
          where: { id: pendingLeave.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancellationReason: 'Auto-cancelled: Employee marked Present via biometric on one of the leave days',
          },
        });
      }

      const empName = `${pendingLeave.employee.firstName} ${pendingLeave.employee.lastName}`;
      const leaveInfo = `${pendingLeave.leaveType.name} leave (${fmtDate(pendingLeave.startDate)} to ${fmtDate(pendingLeave.endDate)})`;
      const message = `${empName}'s pending ${leaveInfo} has been auto-cancelled as they were marked Present on ${fmtDate(date)}.`;

      await createNotification(employeeId, `Your pending ${leaveInfo} has been auto-cancelled as you were marked Present on ${fmtDate(date)}.`);
      if (pendingLeave.employee.inchargeId) await createNotification(pendingLeave.employee.inchargeId, message);
      if (pendingLeave.employee.reportingManager) await createNotification(pendingLeave.employee.reportingManager, message);

      const hrEmployees = await prisma.employee.findMany({
        where: { departmentId: 1, employmentStatus: 'ACTIVE' },
        select: { id: true },
      });
      for (const hr of hrEmployees) {
        if (hr.id !== employeeId && hr.id !== pendingLeave.employee.inchargeId && hr.id !== pendingLeave.employee.reportingManager) {
          await createNotification(hr.id, message);
        }
      }

      console.log(`✅ Auto-cancelled PENDING leave #${pendingLeave.id} for ${empName}`);
      return; // Done — no need to check approved leave
    }

    // ── 2. Cancel APPROVED leave (balance restore needed) ────────
    const leave = await prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: 'APPROVED',
        startDate: { lte: dayEnd },
        endDate: { gte: targetDate },
      },
      include: {
        employee: {
          select: {
            firstName: true, lastName: true, employeeCode: true,
            inchargeId: true, reportingManager: true, departmentId: true,
          },
        },
        leaveType: { select: { name: true } },
      },
    });

    if (!leave) return;

    const year = getFinancialYear(targetDate);
    const month = targetDate.getMonth() + 1;
    const isSingle = isSameDay(leave.startDate, leave.endDate);
    const isHalfDay = leave.isHalfDay && isSingle;
    const isCO = leave.leaveType.name === 'CO';
    const isRH = leave.leaveType.name === 'RH';
    const isFirstDay = isSameDay(targetDate, leave.startDate);
    const isLastDay = isSameDay(targetDate, leave.endDate);

    // Half-day leave: only auto-cancel (and restore balance) if the punch
    // overlaps the half they took off. If they were present only in the other
    // half — e.g. applied SECOND_HALF and logged in for the first half — the
    // half-day leave stays valid and the balance is left as-is.
    if (isHalfDay && leave.halfDaySession) {
      const present = await presentDuringLeaveHalf(
        employeeId, targetDate, dayEnd, leave.halfDaySession as 'FIRST_HALF' | 'SECOND_HALF',
      );
      if (!present) {
        console.log(`↩️  Kept APPROVED half-day leave #${leave.id} — present only in the other half`);
        return;
      }
    }

    await prisma.$transaction(async (tx) => {
      // ── Cancel / shrink / split the leave ──────────────────────────
      if (isSingle) {
        await tx.leaveRequest.update({
          where: { id: leave.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancellationReason: 'Auto-cancelled: Employee marked Present via biometric',
          },
        });
      } else if (isFirstDay) {
        await tx.leaveRequest.update({
          where: { id: leave.id },
          data: { startDate: addDays(targetDate, 1) },
        });
      } else if (isLastDay) {
        await tx.leaveRequest.update({
          where: { id: leave.id },
          data: { endDate: addDays(targetDate, -1) },
        });
      } else {
        // Split: original ends day before, new starts day after
        await tx.leaveRequest.update({
          where: { id: leave.id },
          data: { endDate: addDays(targetDate, -1) },
        });
        await tx.leaveRequest.create({
          data: {
            employeeId: leave.employeeId,
            leaveTypeId: leave.leaveTypeId,
            startDate: addDays(targetDate, 1),
            endDate: leave.endDate,
            reason: `${leave.reason} [split due to biometric present on ${fmtDate(date)}]`,
            status: 'APPROVED',
            approvedBy: leave.approvedBy,
            isHalfDay: false,
            hodDecision: leave.hodDecision,
            hodDecidedAt: leave.hodDecidedAt,
            hrDecision: leave.hrDecision,
            hrDecidedAt: leave.hrDecidedAt,
            inChargeDecision: leave.inChargeDecision,
            inChargeDecidedAt: leave.inChargeDecidedAt,
          },
        });
      }

      // ── Restore balance (non-CO, non-RH) ──────────────────────────
      if (!isCO && !isRH) {
        let daysRestored = isHalfDay ? 0.5 : 1;

        // Check actual debit from ledger for single-day leaves
        if (isSingle) {
          const originalDebit = await tx.leaveLedger.findFirst({
            where: {
              employeeId,
              leaveTypeId: leave.leaveTypeId,
              referenceId: leave.id,
              action: 'DEBIT',
            } as any,
            orderBy: { id: 'asc' },
          });
          if (originalDebit) daysRestored = Number(originalDebit.debit);
        }

        const balance = await tx.employeeLeaveBalance.findFirst({
          where: { employeeId, leaveTypeId: leave.leaveTypeId, year },
        });

        if (balance) {
          // Restore balance
          if (isHalfDay) {
            await tx.employeeLeaveBalance.update({
              where: { id: balance.id },
              data: { halfDayUsed: { decrement: 1 } },
            });
          } else {
            await tx.employeeLeaveBalance.update({
              where: { id: balance.id },
              data: { used: { decrement: 1 } },
            });
          }

          // Get current ledger balance and insert CANCELLATION entry
          const lastLedger = await tx.leaveLedger.findFirst({
            where: { employeeId, leaveTypeId: leave.leaveTypeId, year },
            orderBy: { id: 'desc' },
            select: { balanceAfter: true },
          });
          const currentBalance = lastLedger?.balanceAfter ?? 0;

          await (tx.leaveLedger as any).create({
            data: {
              employeeId,
              leaveTypeId: leave.leaveTypeId,
              year,
              month,
              credit: daysRestored,
              debit: 0,
              balanceAfter: currentBalance + daysRestored,
              action: 'CANCELLATION',
              referenceType: 'LEAVE_REQUEST',
              referenceId: leave.id,
              source: 'SYSTEM',
              remarks: `Auto-cancelled: Present via biometric on ${fmtDate(date)}`,
            },
          });
        }
      }

      // ── CO leave: restore comp-off credit ──────────────────────────
      if (isCO) {
        const usedCredit = await tx.compOffCredit.findFirst({
          where: { leaveId: leave.id, used: true },
        });
        if (usedCredit) {
          await tx.compOffCredit.update({
            where: { id: usedCredit.id },
            data: { used: false, usedOn: null, leaveId: null },
          });
        }
      }
    }, { timeout: 15000 });

    // ── Notifications ────────────────────────────────────────────────
    const empName = `${leave.employee.firstName} ${leave.employee.lastName}`;
    const leaveInfo = `${leave.leaveType.name} leave (${fmtDate(leave.startDate)} to ${fmtDate(leave.endDate)})`;
    const action = isSingle ? 'auto-cancelled' : 'adjusted';
    const message = `${empName}'s ${leaveInfo} has been ${action} as they were marked Present on ${fmtDate(date)}. Balance restored.`;

    // Notify employee
    await createNotification(employeeId, `Your ${leaveInfo} has been ${action} as you were marked Present on ${fmtDate(date)}. Your leave balance has been restored.`);

    // Notify incharge
    if (leave.employee.inchargeId) {
      await createNotification(leave.employee.inchargeId, message);
    }

    // Notify reporting manager
    if (leave.employee.reportingManager) {
      await createNotification(leave.employee.reportingManager, message);
    }

    // Notify HR dept
    const hrEmployees = await prisma.employee.findMany({
      where: { departmentId: 1, employmentStatus: 'ACTIVE' },
      select: { id: true },
    });
    for (const hr of hrEmployees) {
      if (hr.id !== employeeId && hr.id !== leave.employee.inchargeId && hr.id !== leave.employee.reportingManager) {
        await createNotification(hr.id, message);
      }
    }

    console.log(`✅ Auto-cancelled leave #${leave.id} for ${empName} — balance restored`);
  } catch (err) {
    console.error(`❌ Auto-cancel leave failed for emp ${employeeId}:`, err);
  }
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function addDays(date: Date, days: number): Date {
  const d = startOfDay(new Date(date));
  d.setDate(d.getDate() + days);
  return d;
}

function getFinancialYear(date: Date): number {
  const month = date.getMonth() + 1;
  return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

function fmtDate(d: Date): string {
  // Use IST offset (+5:30) to get correct Indian date
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
}
