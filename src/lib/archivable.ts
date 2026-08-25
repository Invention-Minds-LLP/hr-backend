/**
 * Archiving, shared by every module that has one.
 *
 * Archiving means: keep the row, take it out of the working lists, let HR find
 * and restore it later. It is NOT deletion and it is NOT a performance measure
 * — a nullable column makes lists shorter for the reader, not faster for MySQL.
 * For tables that genuinely grow (ApiAccessLog and friends) the answer is the
 * retention cron in schedulers/scheduler.ts, not this.
 *
 * Two things happen on every archive, and this file is the only place both
 * happen together:
 *
 *   1. `archivedAt` / `archivedBy` on the record itself. That is what each
 *      module's own list queries filter on, so a module stays self-contained.
 *   2. An ArchiveLog row. That is what HR's single Archive screen reads, so it
 *      can page and sort across every module without querying each one.
 *
 * Every wired model carries its own archivedAt rather than reusing a status it
 * already had: `Job.status = CLOSED`, `Asset.status = RETIRED` and
 * `Employee.employmentStatus = DEACTIVATED` are business facts whose records
 * the lists still show, so overloading them would change what those modules
 * mean and would make restoring lossy.
 *
 * Adding a module: add an entry to ARCHIVE_MODULES. Nothing else here changes.
 */

import { prisma } from "./prisma";

export interface ArchiveModuleDef {
  /** Stored in ArchiveLog.module. Never change one once rows exist. */
  key: string;
  /** Shown as the module filter on the Archive screen. */
  label: string;
  /** Prisma delegate name, e.g. "performanceSummary". */
  delegate: string;
  /** Loaded before archiving so the label can be frozen. */
  select: any;
  /**
   * Display text and the employee the record is about. The text is stored, so
   * the screen renders without joining seven tables; keep it short and stable.
   */
  describe(record: any): { employeeId: number | null; label: string };
}

/** "Ravi K" from any shape that carries an employee relation. */
function personName(e: any): string {
  if (!e) return "";
  const name = `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim();
  return e.employeeCode ? `${e.employeeCode} ${name}`.trim() : name;
}

const EMPLOYEE_SELECT = {
  select: { id: true, employeeCode: true, firstName: true, lastName: true },
};

export const ARCHIVE_MODULES: ArchiveModuleDef[] = [
  {
    key: "PERFORMANCE_SUMMARY",
    label: "Performance Indicator",
    delegate: "performanceSummary",
    select: {
      id: true, employeeId: true, cycle: true, period: true,
      employee: EMPLOYEE_SELECT,
    },
    describe: (r) => ({
      employeeId: r.employeeId ?? null,
      label: [personName(r.employee), r.period, r.cycle].filter(Boolean).join(" — "),
    }),
  },
  {
    key: "APPRAISAL_FORM",
    label: "Managerial Appraisal",
    delegate: "appraisalForm",
    select: {
      id: true, employeeId: true, cycle: true, status: true,
      employee: EMPLOYEE_SELECT,
    },
    describe: (r) => ({
      employeeId: r.employeeId ?? null,
      label: [personName(r.employee), r.cycle, r.status].filter(Boolean).join(" — "),
    }),
  },
  {
    key: "EMPLOYEE",
    label: "Employee",
    delegate: "employee",
    select: {
      id: true, employeeCode: true, firstName: true, lastName: true,
      employmentStatus: true, Department: { select: { name: true } },
    },
    describe: (r) => ({
      // The record IS the employee, so it files under them.
      employeeId: r.id,
      label: [personName(r), r.Department?.name, r.employmentStatus].filter(Boolean).join(" — "),
    }),
  },
  {
    key: "JOB",
    label: "Job Opening",
    delegate: "job",
    select: {
      id: true, title: true, status: true,
      department: { select: { name: true } },
    },
    describe: (r) => ({
      employeeId: null,
      label: [r.title, r.department?.name, r.status].filter(Boolean).join(" — "),
    }),
  },
  {
    key: "ASSET",
    label: "Asset",
    delegate: "asset",
    select: { id: true, assetTag: true, name: true, category: true, status: true },
    describe: (r) => ({
      employeeId: null,
      label: [r.assetTag, r.name, r.status].filter(Boolean).join(" — "),
    }),
  },
  {
    key: "ANNOUNCEMENT",
    label: "Announcement",
    delegate: "announcement",
    select: { id: true, title: true, circularCode: true, startsAt: true },
    describe: (r) => ({
      employeeId: null,
      label: [r.circularCode, r.title].filter(Boolean).join(" — "),
    }),
  },
  {
    key: "LETTER_ISSUED",
    label: "Issued Letter",
    delegate: "letterIssued",
    select: {
      id: true, employeeId: true, subject: true, templateName: true, status: true,
      employee: EMPLOYEE_SELECT,
    },
    describe: (r) => ({
      employeeId: r.employeeId ?? null,
      label: [personName(r.employee), r.templateName || r.subject, r.status]
        .filter(Boolean).join(" — "),
    }),
  },
];

const BY_KEY = new Map(ARCHIVE_MODULES.map((m) => [m.key, m]));

export function archiveModule(key: string): ArchiveModuleDef | null {
  return BY_KEY.get(key) ?? null;
}

/** Drop-in for a module's own list queries: `where: { ...activeOnly(), ... }`. */
export function activeOnly() {
  return { archivedAt: null } as const;
}

export interface ArchiveResult {
  ok: boolean;
  /** Set when ok is false — safe to show the caller. */
  error?: string;
  status?: number;
  record?: { id: number; archivedAt: Date | null };
}

/**
 * Retire one record. Idempotent: archiving something already archived just
 * refreshes the stamp rather than erroring, which is what a double-click does.
 */
export async function archiveRecord(
  moduleKey: string,
  recordId: number,
  userId: number | null,
  reason?: string | null,
): Promise<ArchiveResult> {
  const mod = archiveModule(moduleKey);
  if (!mod) return { ok: false, status: 400, error: `Unknown archive module "${moduleKey}"` };

  const delegate = (prisma as any)[mod.delegate];
  const record = await delegate.findUnique({ where: { id: recordId }, select: mod.select });
  if (!record) return { ok: false, status: 404, error: `${mod.label} record not found` };

  const { employeeId, label } = mod.describe(record);
  const archivedAt = new Date();

  // The record's own flag and the index are written together — the screen must
  // never list something the module still treats as live.
  const [updated] = await prisma.$transaction([
    delegate.update({
      where: { id: recordId },
      data: { archivedAt, archivedBy: userId },
      select: { id: true, archivedAt: true },
    }),
    prisma.archiveLog.upsert({
      where: { module_recordId: { module: mod.key, recordId } },
      create: {
        module: mod.key,
        recordId,
        employeeId,
        label: label || `${mod.label} #${recordId}`,
        reason: reason || null,
        archivedAt,
        archivedBy: userId,
      },
      // Re-archiving after a restore clears the restore stamps and re-freezes
      // the label, so the screen shows the current state rather than a stale one.
      update: {
        employeeId,
        label: label || `${mod.label} #${recordId}`,
        reason: reason || null,
        archivedAt,
        archivedBy: userId,
        restoredAt: null,
        restoredBy: null,
      },
    }),
  ]);

  return { ok: true, record: updated };
}

/** Bring a record back into the working lists. */
export async function restoreRecord(
  moduleKey: string,
  recordId: number,
  userId: number | null,
): Promise<ArchiveResult> {
  const mod = archiveModule(moduleKey);
  if (!mod) return { ok: false, status: 400, error: `Unknown archive module "${moduleKey}"` };

  const delegate = (prisma as any)[mod.delegate];
  const record = await delegate.findUnique({
    where: { id: recordId },
    select: { id: true, archivedAt: true },
  });
  if (!record) return { ok: false, status: 404, error: `${mod.label} record not found` };

  const restoredAt = new Date();
  const [updated] = await prisma.$transaction([
    delegate.update({
      where: { id: recordId },
      data: { archivedAt: null, archivedBy: null },
      select: { id: true, archivedAt: true },
    }),
    // updateMany, not update: a record archived before this table existed (or
    // by a backfill that missed it) has no log row, and restoring it must not
    // blow up on a missing key.
    prisma.archiveLog.updateMany({
      where: { module: mod.key, recordId },
      data: { restoredAt, restoredBy: userId },
    }),
  ]);

  return { ok: true, record: updated };
}
