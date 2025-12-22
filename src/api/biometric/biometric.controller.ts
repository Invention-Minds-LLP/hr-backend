import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const COSEC_BASE_URL = 'http://14.194.12.229:83/COSEC/api.svc/v2';
const COSEC_USERNAME = 'api';
const COSEC_PASSWORD = 'Api@123';

type CosecEvent = {
  userid: string;
  edate: string;
  etime: string;
  entryexittype: 'IN' | 'OUT';
};

type DailyAttendance = {
  userid: string;
  processdate: string;
  punch1?: string;
  outpunch?: string;
};

/* ---------------- UTILITIES ---------------- */

function getCosecDateRange(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}${mm}${yyyy}-${dd}${mm}${yyyy}`;
}

function parseDate(date: string, time = '00:00:00') {
  const [d, m, y] = date.split('/');
  return new Date(`${y}-${m}-${d}T${time}`);
}
function parseCosecDateTime(
    dateStr?: string,
    timeStr?: string
  ): Date | null {
    if (!dateStr) return null;
  
    // CASE 1: attendance-daily → "22/12/2025 08:45:01"
    if (timeStr && timeStr.includes('/')) {
      const [datePart, timePart] = timeStr.split(' ');
      return parseCosecDateTime(datePart, timePart);
    }
  
    // CASE 2: empty checkout → return NULL
    if (!timeStr || timeStr.trim() === '') {
      return null;
    }
  
    // CASE 3: normal edate + etime
    const [d, m, y] = dateStr.split('/').map(Number);
    const [hh, mm, ss] = timeStr.split(':').map(Number);
  
    const dt = new Date(y, m - 1, d, hh, mm, ss);
  
    return isNaN(dt.getTime()) ? null : dt;
  }
  

  
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/* ---------------- COSEC CALLS ---------------- */

async function fetchAttendanceDaily(dateRange: string): Promise<DailyAttendance[]> {
  const url =
    `${COSEC_BASE_URL}/attendance-daily` +
    `?action=get;` +
    `field-name=userid,processdate,punch1,outpunch;` +
    `date-range=${dateRange};format=json`;

  const res = await axios.get(url, {
    auth: { username: COSEC_USERNAME, password: COSEC_PASSWORD },
    timeout: 60000
  });

  return res.data['attendance-daily'] || [];
}

async function fetchRawEvents(dateRange: string): Promise<CosecEvent[]> {
  const url =
    `${COSEC_BASE_URL}/event-ta` +
    `?action=get;field-name=userid,edate,etime,entryexittype;` +
    `date-range=${dateRange};format=json`;

  for (let i = 1; i <= 3; i++) {
    try {
      const res = await axios.get(url, {
        auth: { username: COSEC_USERNAME, password: COSEC_PASSWORD },
        timeout: 120000
      });
      return res.data['event-ta'] || [];
    } catch {
      console.warn(`[COSEC] event-ta failed attempt ${i}`);
      await sleep(10000);
    }
  }

  throw new Error('event-ta failed after retries');
}

/* ---------------- MAIN SYNC ---------------- */

export async function runAttendanceSync(isFinalRun: boolean) {
  const dateRange = getCosecDateRange();

  console.log(`[ATTENDANCE] Sync started | Final: ${isFinalRun}`);

  const employees = await prisma.employee.findMany({
    select: { id: true, employeeCode: true }
  });

  const empMap = new Map(employees.map(e => [e.employeeCode!, e.id]));

  let records: any[] = [];

  if (isFinalRun) {
    try {
      records = await fetchRawEvents(dateRange);
    } catch {
      console.warn('[ATTENDANCE] Falling back to attendance-daily');
      records = await fetchAttendanceDaily(dateRange);
    }
  } else {
    records = await fetchAttendanceDaily(dateRange);
    console.log('[ATTENDANCE] Fetched records from attendance-daily');
  }

  console.log(`[ATTENDANCE] Fetched ${records.length} records from COSEC`);
  for (const r of records) {
    const employeeId = empMap.get(r.userid);
    if (!employeeId) continue;
    console.log(`[ATTENDANCE] Processing record for employee ID ${employeeId}`);
    const date = parseDate(r.processdate || r.edate);
    const checkIn = parseCosecDateTime(
        r.processdate || r.edate,
        r.punch1
      );
      
      const checkOut = parseCosecDateTime(
        r.processdate || r.edate,
        r.outpunch
      );
      if (checkIn && isNaN(checkIn.getTime())) {
        console.warn('[ATTENDANCE] Invalid check-in skipped', r);
      }
      
      if (checkOut && isNaN(checkOut.getTime())) {
        console.warn('[ATTENDANCE] Invalid check-out skipped', r);
      }
      
      console.log(`[ATTENDANCE] Employee ID ${employeeId} | Date: ${date} | Check-In: ${checkIn} | Check-Out: ${checkOut}`);
      const status = checkIn
      ? 'Present'
      : isFinalRun
        ? 'Absent'
        : 'IN_PROGRESS';
      await prisma.attendance.upsert({
        where: {
          employeeId_date: {
            employeeId,
            date
          }
        },
        update: {
          checkIn: checkIn ?? undefined,
          checkOut: checkOut ?? undefined,
          status
        },
        create: {
          employeeId,
          date,
          checkIn,
          checkOut,
          status
        }
      });
      
  }

  /* ---- FINAL ABSENT MARKING ---- */
  if (isFinalRun) {
    const today = parseDate(new Date().toLocaleDateString('en-GB'));
    const existing = await prisma.attendance.findMany({
      where: { date: today },
      select: { employeeId: true }
    });

    const present = new Set(existing.map(e => e.employeeId));

    await prisma.attendance.createMany({
      data: employees
        .filter(e => !present.has(e.id))
        .map(e => ({
          employeeId: e.id,
          date: today,
          status: 'Absent'
        })),
      skipDuplicates: true
    });
  }

  console.log('[ATTENDANCE] Sync completed');
}
