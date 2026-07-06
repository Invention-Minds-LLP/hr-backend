/**
 * Demo seed — create Attendance rows (check-in / check-out) for a month so the
 * HR "Shift & Attendance Report" shows a realistic mix instead of all-absent.
 *
 * It keys off the employees' existing ShiftAssignment rows, so each punch is
 * timed relative to that day's actual shift, producing:
 *   on-time · late-in · early-out · late+early · (some days left absent)
 * Sundays are skipped so week-off cells still show as "WO".
 *
 * Attendance.date reuses the ShiftAssignment.date value, so the report's
 * per-day key (employeeId + local date) lines up exactly.
 *
 * Run (from hr-backend):
 *   npx ts-node src/scripts/seed-attendance-demo.ts                  # DRY RUN, current month
 *   npx ts-node src/scripts/seed-attendance-demo.ts --apply          # write, current month
 *   npx ts-node src/scripts/seed-attendance-demo.ts --month=2026-07 --apply
 *   npx ts-node src/scripts/seed-attendance-demo.ts --all-days --apply  # include future days too
 */

import 'dotenv/config';
import { prisma } from '../lib/prisma';

function parseMonth(): { month: number; year: number } {
  const arg = process.argv.find(a => a.startsWith('--month='));
  if (arg) {
    const [y, m] = arg.split('=')[1].split('-').map(Number);
    return { month: m, year: y };
  }
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

// Anchor a shift time-of-day onto a specific date using local getters — mirrors
// the report's anchorTimeToDate so comparisons line up.
function combine(base: Date, t: Date): Date {
  const dt = new Date(base);
  const tt = new Date(t);
  dt.setHours(tt.getHours(), tt.getMinutes(), 0, 0);
  return dt;
}

const hhmm = (d: Date) => d.toTimeString().slice(0, 5);
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// in/out offsets (minutes) relative to shift start/end. null = leave absent.
const PATTERNS: ({ label: string; in: number; out: number } | null)[] = [
  { label: 'on-time', in: -8, out: 12 },
  { label: 'late-in', in: 24, out: 5 },
  { label: 'early-out', in: -3, out: -38 },
  { label: 'late+early', in: 33, out: -27 },
  null, // absent
  { label: 'on-time', in: -2, out: 18 },
  { label: 'late-in', in: 47, out: 8 },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const seedFuture = process.argv.includes('--all-days');
  const { month, year } = parseMonth();

  const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const cutoff = seedFuture ? monthEnd : (today < monthEnd ? today : monthEnd);

  console.log(
    `[seed-attendance] ${apply ? 'APPLY' : 'DRY RUN'} — ${year}-${String(month).padStart(2, '0')}` +
    `  (seeding days up to ${localIso(cutoff)})`
  );

  const assignments = await prisma.shiftAssignment.findMany({
    where: { date: { gte: monthStart, lte: monthEnd } },
    select: {
      employeeId: true,
      date: true,
      shift: { select: { name: true, startTime: true, endTime: true } },
    },
    orderBy: [{ employeeId: 'asc' }, { date: 'asc' }],
  });

  if (!assignments.length) {
    console.log('[seed-attendance] No ShiftAssignment rows for this month — nothing to seed.');
    console.log('  (Assign & approve monthly shifts first, or pass --month=YYYY-MM for the right month.)');
    return;
  }

  const empSet = new Set(assignments.map(a => a.employeeId));
  console.log(`[seed-attendance] ${assignments.length} shift-day rows across ${empSet.size} employee(s).`);

  const counts: Record<string, number> = { 'on-time': 0, 'late-in': 0, 'early-out': 0, 'late+early': 0, absent: 0, skipped: 0 };
  let written = 0;
  let sample = 0;

  for (const a of assignments) {
    const date = new Date(a.date);
    if (date > cutoff) { counts.skipped++; continue; }
    if (date.getDay() === 0) { counts.skipped++; continue; } // keep Sundays as week-off
    if (!a.shift) { counts.skipped++; continue; }

    const pattern = PATTERNS[(date.getDate() + a.employeeId) % PATTERNS.length];
    if (!pattern) { counts.absent++; continue; } // leave this day absent

    const shiftStart = combine(date, a.shift.startTime);
    const shiftEnd = combine(date, a.shift.endTime);
    const checkIn = new Date(shiftStart.getTime() + pattern.in * 60000);
    const checkOut = new Date(shiftEnd.getTime() + pattern.out * 60000);

    counts[pattern.label]++;

    if (sample < 8) {
      console.log(
        `  e#${a.employeeId} ${localIso(date)} ${a.shift.name}` +
        `  shift ${hhmm(shiftStart)}-${hhmm(shiftEnd)}  →  in ${hhmm(checkIn)} out ${hhmm(checkOut)}  [${pattern.label}]`
      );
      sample++;
    }

    if (apply) {
      await prisma.attendance.upsert({
        where: { employeeId_date: { employeeId: a.employeeId, date: a.date } },
        update: { status: 'Present', checkIn, checkOut, source: 'BIOMETRIC' },
        create: { employeeId: a.employeeId, date: a.date, status: 'Present', checkIn, checkOut, source: 'BIOMETRIC' },
      });
      written++;
    }
  }

  console.log('[seed-attendance] summary:', counts);
  if (apply) console.log(`[seed-attendance] wrote ${written} Attendance row(s).`);
  else console.log('[seed-attendance] DRY RUN only — re-run with --apply to write.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
