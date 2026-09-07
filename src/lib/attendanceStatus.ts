// ─────────────────────────────────────────────────────────────────────────────
//  Attendance.status is free text, and the live data carries two spellings of
//  every value: the punch writers (mobile GPS, biometric, HR approve) store
//  'Present'/'Absent', while the force-present, HR-correction and leave paths
//  store 'PRESENT'/'ABSENT'. Both mean the same thing.
//
//  Anything that compares the column raw silently drops one half of the data.
//  That is what made a full month of mobile GPS attendance come out as LOP:
//  payroll matched only 'PRESENT', so every 'Present' day scored nothing and
//  fell straight into lopDays = workingDays − presentDays.
//
//  Normalising on READ rather than rewriting the column is deliberate. The
//  Angular app and comp-off generation are built on the 'Present' spelling,
//  so uppercasing the stored values would move the same bug elsewhere.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical upper-snake form of an Attendance.status value, or null when the
 * day has no attendance row at all.
 *
 * 'Present' → 'PRESENT', 'Half Day' → 'HALF_DAY', 'Week-Off' → 'WEEK_OFF'.
 */
export function normalizeAttendanceStatus(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.toUpperCase().replace(/[\s-]+/g, '_');
}
