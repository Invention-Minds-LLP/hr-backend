/**
 * Probation confirmation — the shared rules and the single writer of probation
 * state.
 *
 * Before this file there were two competing implementations of "extend
 * probation" (employee.controller and dashboard.controller) with different
 * semantics, and none of the three probation actions wrote an audit row. Every
 * probation state change now goes through `applyProbationOutcome()` so the
 * ProbationRecord ledger, the Employee snapshot and the audit trail can never
 * disagree.
 *
 * Two dates matter and they are not the same thing:
 *   dueDate  — when the probation window closes and the form becomes fillable.
 *   evaluationDate — when the manager actually submitted it. Extensions are
 *                    measured from this, per the spec ("three months from the
 *                    Probation Evaluation Date"), not from the due date.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { addMonths } from './appraisal-cycle';
import { updateEmployeeWithAudit } from './employeeAudit';
import type { AuditContext } from './employeeAudit';

/** Probation length when the employee carries no explicit probation dates. */
export const DEFAULT_PROBATION_MONTHS = 6;

/** How long an extension runs, per the spec. */
export const EXTENSION_MONTHS = 3;

/** Days after the due date at which an unfilled form is chased. */
export const REMINDER_OFFSETS = [3, 7, 14];

export type ProbationRating = 'E' | 'M' | 'B';

export const RATING_LABELS: Record<ProbationRating, string> = {
  E: 'Exceeds Expectations',
  M: 'Meets Expectations',
  B: 'Below Expectations',
};

/**
 * The eight categories on the printed form, in printed order. Fixed by the
 * form's layout — this is not a configurable template, which is why it lives in
 * code rather than a masters table.
 */
export const PROBATION_CATEGORIES = [
  {
    code: 'QUANTITY_OF_WORK',
    label: 'Quantity of Work',
    criteria:
      'The extent to which the employee accomplishes assigned work of a specified quality within a specified time period',
  },
  {
    code: 'QUALITY_OF_WORK',
    label: 'Quality of Work',
    criteria: "The extent to which the employee's work is well executed, thorough, effective, accurate",
  },
  {
    code: 'KNOWLEDGE_OF_JOB',
    label: 'Knowledge of Job',
    criteria:
      "The extent to which the employee knows and demonstrates how and why to do all phases of assigned work, given the employee's length of time in his/her current position",
  },
  {
    code: 'RELATIONS_WITH_SUPERVISOR',
    label: 'Relations with Supervisor',
    criteria:
      'The way the employee responds to supervisory directions and comments. The extent to which the employee seeks counsel from supervisor on ways to improve performance and follows same',
  },
  {
    code: 'COOPERATION_WITH_OTHERS',
    label: 'Cooperation with Others / Teamwork',
    criteria:
      "The extent to which the employee gets along with other individuals. Consider the employee's tact, courtesy, and effectiveness in dealing with co-workers, subordinates, supervisors, and customers",
  },
  {
    code: 'ATTENDANCE_AND_RELIABILITY',
    label: 'Attendance & Reliability',
    criteria:
      'The extent to which employee arrives on time and demonstrates consistent attendance; the extent to which the employee contacts supervisor on a timely basis when employee will be late or absent',
  },
  {
    code: 'INITIATIVE_AND_CREATIVITY',
    label: 'Initiative & Creativity',
    criteria:
      'The extent to which the employee is self-directed, resourceful and creative in meeting job objectives: consider how well the employee follows through on assignments and modifies or develops new ideas, methods, or procedures to effectively meet changing circumstances',
  },
  {
    code: 'CAPACITY_TO_DEVELOP',
    label: 'Capacity to Develop',
    criteria:
      'The extent to which the employee demonstrates the ability and willingness to accept new/more complex duties/responsibilities',
  },
] as const;

export type ProbationCategoryCode = (typeof PROBATION_CATEGORIES)[number]['code'];

const CATEGORY_CODES = PROBATION_CATEGORIES.map((c) => c.code) as readonly string[];

export type ProbationRatings = Record<ProbationCategoryCode, ProbationRating>;

/**
 * Validate an incoming ratings object. Every category must carry a rating —
 * a half-filled form is not a submission, and the PDF has no "not rated" state.
 * Throws with a message safe to hand back to the client.
 */
export function normaliseRatings(raw: unknown): ProbationRatings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('ratings must be an object keyed by category code');
  }
  const input = raw as Record<string, unknown>;
  const out = {} as ProbationRatings;
  const missing: string[] = [];

  for (const cat of PROBATION_CATEGORIES) {
    const value = input[cat.code];
    if (value === undefined || value === null || value === '') {
      missing.push(cat.label);
      continue;
    }
    const v = String(value).trim().toUpperCase();
    if (v !== 'E' && v !== 'M' && v !== 'B') {
      throw new Error(`Invalid rating "${value}" for ${cat.label} — expected E, M or B`);
    }
    out[cat.code] = v;
  }

  if (missing.length) {
    throw new Error(`Rate every category before submitting. Missing: ${missing.join(', ')}`);
  }

  const unknownKeys = Object.keys(input).filter((k) => !CATEGORY_CODES.includes(k));
  if (unknownKeys.length) {
    throw new Error(`Unknown rating categor${unknownKeys.length === 1 ? 'y' : 'ies'}: ${unknownKeys.join(', ')}`);
  }

  return out;
}

/** Read a stored `ratings` Json column back without trusting its shape. */
export function readRatings(raw: unknown): Partial<Record<ProbationCategoryCode, ProbationRating>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const out: Partial<Record<ProbationCategoryCode, ProbationRating>> = {};
  for (const cat of PROBATION_CATEGORIES) {
    const v = String(input[cat.code] ?? '').trim().toUpperCase();
    if (v === 'E' || v === 'M' || v === 'B') out[cat.code] = v;
  }
  return out;
}

/** The subset of Employee the date rules need. */
export interface ProbationDateSource {
  dateOfJoining: Date | string;
  probationEndDate?: Date | string | null;
}

/**
 * When this employee's probation closes.
 *
 * The stored probationEndDate wins whenever it is set, so a contract written
 * for three or twelve months is honoured and the module agrees with the
 * existing "probation ending in 7 days" dashboard widget. DOJ + 6 months is the
 * fallback for rows that never had probation dates filled in.
 */
export function probationDueDate(emp: ProbationDateSource, openRecordEnd?: Date | null): Date {
  if (openRecordEnd) return new Date(openRecordEnd);
  if (emp.probationEndDate) return new Date(emp.probationEndDate);
  return addMonths(new Date(emp.dateOfJoining), DEFAULT_PROBATION_MONTHS);
}

/**
 * Who fills the form in. `Employee.reportingManager` only — deliberately no
 * fallback to inchargeId or the department head, because those are different
 * people in this org and silently routing a confirmation decision to the wrong
 * one is worse than leaving it unassigned for HR to fix.
 *
 * Returns null when unset; the caller still creates the evaluation and it lands
 * in HR's unassigned bucket.
 */
export function resolveProbationManagerId(emp: { reportingManager: number | null }): number | null {
  return emp.reportingManager ?? null;
}

export type ProbationOutcome = 'CONFIRM' | 'EXTEND' | 'TERMINATE' | 'DEPARTMENT_TRANSFER';

export interface ApplyOutcomeArgs {
  employeeId: number;
  outcome: ProbationOutcome;
  decidedBy: number | null;
  remarks?: string | null;
  /**
   * EXTEND only. Defaults to `evaluationDate + 3 months` per the spec; passed
   * explicitly by the legacy /probation/extend endpoint, which lets the caller
   * pick the date.
   */
  newEndDate?: Date | null;
  /** EXTEND only — what the 3 months are counted from. Defaults to today. */
  extendFrom?: Date | null;
  /**
   * The date the decision is recorded as taken. Defaults to now; HR can
   * back-date a confirmation from the employee screen, which the endpoint has
   * always allowed.
   */
  decidedOn?: Date | null;
  audit?: Partial<AuditContext>;
}

export interface ApplyOutcomeResult {
  employeeId: number;
  outcome: ProbationOutcome;
  /** The open ProbationRecord after the change, when one remains. */
  openRecordId: number | null;
  newEndDate: Date | null;
}

/**
 * The single writer of probation state.
 *
 * Closes the open ProbationRecord, updates the Employee snapshot through the
 * audit helper, and for an extension opens the next record. Access revocation
 * on termination is left to the caller — it is not part of the transaction and
 * must not be able to roll the decision back.
 *
 * Runs inside its own transaction unless one is supplied. The explicit timeout
 * is not optional: the remote DB is slow enough that a multi-write transaction
 * on the default 5s budget intermittently fails with P2028.
 */
export async function applyProbationOutcome(
  args: ApplyOutcomeArgs,
  tx?: Prisma.TransactionClient,
): Promise<ApplyOutcomeResult> {
  const run = async (db: Prisma.TransactionClient): Promise<ApplyOutcomeResult> => {
    const emp = await db.employee.findUnique({
      where: { id: args.employeeId },
      select: { id: true, dateOfJoining: true, probationStartDate: true, probationEndDate: true },
    });
    if (!emp) throw new Error(`Employee #${args.employeeId} not found`);

    const now = args.decidedOn ? new Date(args.decidedOn) : new Date();
    const remarks = args.remarks ?? null;
    const auditBase = {
      ...args.audit,
      changedBy: args.audit?.changedBy ?? args.decidedBy ?? null,
      source: args.audit?.source ?? 'WEB',
    } as AuditContext;

    const openRecord = await db.probationRecord.findFirst({
      where: { employeeId: args.employeeId, status: 'IN_PROGRESS' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, startDate: true, endDate: true },
    });

    // ── Department transfer ────────────────────────────────────────────────
    // Recorded, not executed. The module has no target department and moving
    // someone has payroll and reporting knock-ons, so HR performs the transfer
    // from the employee screen. Probation stays open until they do.
    if (args.outcome === 'DEPARTMENT_TRANSFER') {
      if (remarks) {
        await db.employee.update({
          where: { id: args.employeeId },
          data: { probationRemarks: remarks },
        });
      }
      return {
        employeeId: args.employeeId,
        outcome: args.outcome,
        openRecordId: openRecord?.id ?? null,
        newEndDate: null,
      };
    }

    if (args.outcome === 'EXTEND') {
      const from = args.extendFrom ? new Date(args.extendFrom) : now;
      const newEnd = args.newEndDate ? new Date(args.newEndDate) : addMonths(from, EXTENSION_MONTHS);

      // The new window starts where the old one ended, so the record ledger has
      // no gap. Falls back to the employee snapshot for rows predating records.
      const startDate = openRecord?.endDate ?? emp.probationEndDate ?? emp.dateOfJoining;

      if (openRecord) {
        await db.probationRecord.update({
          where: { id: openRecord.id },
          data: { status: 'EXTENDED', decidedBy: args.decidedBy, decidedOn: now, remarks },
        });
      }

      const created = await db.probationRecord.create({
        data: {
          employeeId: args.employeeId,
          startDate: new Date(startDate),
          endDate: newEnd,
          status: 'IN_PROGRESS',
          remarks,
        },
        select: { id: true },
      });

      await updateEmployeeWithAudit({
        employeeId: args.employeeId,
        tx: db,
        data: {
          probationEndDate: newEnd,
          // The old code wrote IN_PROGRESS here, which left the EXTENDED bucket
          // on the probation overview permanently empty. The new record is
          // IN_PROGRESS; the employee snapshot says how they got there.
          probationStatus: 'EXTENDED',
          probationRemarks: remarks,
        },
        ...auditBase,
        reason: auditBase.reason ?? 'Probation extended',
      });

      return {
        employeeId: args.employeeId,
        outcome: args.outcome,
        openRecordId: created.id,
        newEndDate: newEnd,
      };
    }

    // ── Confirm / terminate — both close the window ─────────────────────────
    const recordStatus = args.outcome === 'CONFIRM' ? 'CONFIRMED' : 'TERMINATED';

    if (openRecord) {
      await db.probationRecord.update({
        where: { id: openRecord.id },
        data: { status: recordStatus, decidedBy: args.decidedBy, decidedOn: now, remarks },
      });
    }

    await updateEmployeeWithAudit({
      employeeId: args.employeeId,
      tx: db,
      data:
        args.outcome === 'CONFIRM'
          ? {
              probationStatus: 'CONFIRMED',
              probationConfirmedOn: now,
              probationConfirmedBy: args.decidedBy,
              probationRemarks: remarks,
              employmentType: 'PERMANENT',
            }
          : {
              probationStatus: 'TERMINATED',
              probationRemarks: remarks,
              employmentStatus: 'TERMINATED',
            },
      ...auditBase,
      reason:
        auditBase.reason ?? (args.outcome === 'CONFIRM' ? 'Probation confirmed' : 'Probation terminated'),
    });

    return { employeeId: args.employeeId, outcome: args.outcome, openRecordId: null, newEndDate: null };
  };

  if (tx) return run(tx);
  // maxWait/timeout are load-bearing — see the note on the function above.
  return prisma.$transaction(run, { maxWait: 15000, timeout: 30000 });
}
