/**
 * Probation confirmation workflow.
 *
 *   cron / HR  ──▶  PENDING_MANAGER  ──manager submits──▶  PENDING_HR
 *                                                              │
 *                                          HR decides ─────────┘
 *                                                              ▼
 *                                                          COMPLETED
 *                                     (EXTEND also opens the next round)
 *
 * State that outlives the form — the probation window, the employment type, the
 * audit trail — is never written here. It goes through
 * `applyProbationOutcome()` in lib/probation.ts, which is the single writer.
 *
 * Visibility has two tiers and they are checked in the handler, not the route:
 *   `admin.probation.manage` — HR. Sees every evaluation, makes the decision.
 *   otherwise                — sees only the evaluations assigned to them.
 * The assigned manager can always fill their own form; that is not gated on a
 * permission key, because the system chose them and a missing key would leave
 * the form permanently unfillable.
 */

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { resolvePermissions } from '../../lib/permissionResolver';
import { createNotification } from '../notifications/notifications.controller';
import { revokeEmployeeAccess } from '../../lib/employeeAccess';
import { auditCtxFromReq } from '../../lib/employeeAudit';
import { config } from '../../config';
import {
  PROBATION_CATEGORIES,
  RATING_LABELS,
  EXTENSION_MONTHS,
  applyProbationOutcome,
  normaliseRatings,
  probationDueDate,
  probationCutoffDate,
  isBeforeCutoff,
  resolveProbationManagerId,
  ProbationOutcome,
} from '../../lib/probation';
import { addMonths } from '../../lib/appraisal-cycle';
import { buildProbationEvaluationPdf } from './probationEvaluationPdf';

const MANAGE_KEY = 'admin.probation.manage';

export const RECOMMENDATION_LABELS: Record<ProbationOutcome, string> = {
  CONFIRM: 'Confirm Probation',
  EXTEND: `Extend Probation by ${EXTENSION_MONTHS} months`,
  TERMINATE: 'Terminate Employment',
  DEPARTMENT_TRANSFER: 'Transfer to Another Department',
};

const empId = (req: Request): number => Number((req as any).user?.empId ?? 0);

async function canManage(req: Request): Promise<boolean> {
  const id = empId(req);
  if (!id) return false;
  try {
    const held = await resolvePermissions(id);
    return held.includes(MANAGE_KEY as any);
  } catch {
    // Fail closed: this is the gate on the final decision.
    return false;
  }
}

/** Employee columns every screen and the PDF need. */
const EMPLOYEE_SELECT = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  email: true,
  dateOfJoining: true,
  employmentType: true,
  employmentStatus: true,
  probationStartDate: true,
  probationEndDate: true,
  probationStatus: true,
  reportingManager: true,
  Department: { select: { id: true, name: true } },
  designation: { select: { id: true, name: true } },
  Branch: { select: { id: true, name: true } },
} as const;

const MANAGER_SELECT = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  email: true,
  designation: { select: { name: true } },
} as const;

const fullName = (e?: { firstName?: string | null; lastName?: string | null } | null) =>
  `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim();

const fmt = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** HR fan-out, same shape as the comp-off / weekly-tracker modules. */
async function notifyHr(message: string, title: string) {
  const hr = await prisma.employee.findMany({
    where: { departmentId: config.recruiting.hrDepartmentId, employmentStatus: 'ACTIVE' },
    select: { id: true },
  });
  for (const h of hr) await createNotification(h.id, message, title).catch(() => undefined);
}

/* ═══════════════════════════════════════════════════════════════════════════
   OPENING EVALUATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface OpenEvaluationsResult {
  opened: number;
  unassigned: number;
  skipped: number;
  /** Probations that closed before the go-live cutoff — backlog for HR. */
  beforeCutoff: number;
}

/**
 * Open a PENDING_MANAGER evaluation for every employee whose probation has
 * closed and who has no open round.
 *
 * Called by the daily cron and by HR's manual "generate" button. Idempotent on
 * two levels: the round number is deterministic per employee, and
 * @@unique([employeeId, round]) makes a concurrent second run a no-op rather
 * than a duplicate.
 *
 * `asOf` exists so the cron can be tested without waiting for a date.
 */
export async function openDueEvaluations(asOf: Date = new Date()): Promise<OpenEvaluationsResult> {
  const result: OpenEvaluationsResult = { opened: 0, unassigned: 0, skipped: 0, beforeCutoff: 0 };
  const cutoff = probationCutoffDate();

  const candidates = await prisma.employee.findMany({
    where: {
      employmentStatus: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
      // Anyone already confirmed, terminated or waived is out of the workflow.
      OR: [{ probationStatus: { in: ['IN_PROGRESS', 'EXTENDED'] } }, { probationStatus: null }],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dateOfJoining: true,
      probationEndDate: true,
      probationStatus: true,
      reportingManager: true,
      employmentType: true,
    },
  });

  for (const emp of candidates) {
    // An employee with no probation status AND no probation dates was never put
    // on probation — DOJ+6 would invent a review for a permanent hire.
    if (!emp.probationStatus && !emp.probationEndDate) {
      result.skipped++;
      continue;
    }

    const openRecord = await prisma.probationRecord.findFirst({
      where: { employeeId: emp.id, status: 'IN_PROGRESS' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, endDate: true },
    });

    const dueDate = probationDueDate(emp, openRecord?.endDate ?? null);
    if (dueDate.getTime() > asOf.getTime()) {
      result.skipped++;
      continue;
    }

    // An open round means the last one is still being worked; a COMPLETED round
    // whose decision was EXTEND sets nextReviewDate, and that becomes the due
    // date for the next one.
    const rounds = await prisma.probationEvaluation.findMany({
      where: { employeeId: emp.id },
      orderBy: { round: 'desc' },
      select: { id: true, round: true, status: true, hrDecision: true, nextReviewDate: true },
    });

    const openRound = rounds.find((r) => r.status === 'PENDING_MANAGER' || r.status === 'PENDING_HR');
    if (openRound) {
      result.skipped++;
      continue;
    }

    const last = rounds[0];
    if (last) {
      // Only an extension reopens the workflow, and only once its review date
      // has arrived.
      if (last.status !== 'COMPLETED' || last.hrDecision !== 'EXTEND') {
        result.skipped++;
        continue;
      }
      const next = last.nextReviewDate ? new Date(last.nextReviewDate) : null;
      if (!next || next.getTime() > asOf.getTime()) {
        result.skipped++;
        continue;
      }
    }

    const round = (last?.round ?? 0) + 1;
    const managerId = resolveProbationManagerId(emp);
    const effectiveDue = last?.nextReviewDate ? new Date(last.nextReviewDate) : dueDate;

    // Anything that closed before the module went live is backlog: the decision
    // was almost certainly already taken on paper, so chasing the manager for a
    // fresh evaluation would be wrong. HR records those from the Probation
    // screen instead. Checked against the EFFECTIVE due date so a historical
    // extension's re-evaluation is judged on when it actually falls due, not on
    // when the original probation started.
    if (isBeforeCutoff(effectiveDue, cutoff)) {
      result.beforeCutoff++;
      continue;
    }

    try {
      await prisma.probationEvaluation.create({
        data: {
          employeeId: emp.id,
          probationRecordId: openRecord?.id ?? null,
          round,
          status: 'PENDING_MANAGER',
          dueDate: effectiveDue,
          managerId,
        },
      });
    } catch (e: any) {
      // P2002 = the unique guard fired, i.e. a concurrent run already opened it.
      if (e?.code === 'P2002') {
        result.skipped++;
        continue;
      }
      throw e;
    }

    result.opened++;

    const name = fullName(emp);
    const roundNote = round > 1 ? ` (extended probation, round ${round})` : '';

    if (managerId) {
      await createNotification(
        managerId,
        `${name} has completed probation on ${fmt(effectiveDue)}${roundNote}. ` +
          `Please complete the Probation Evaluation Form.`,
        '📋 Probation Evaluation',
      ).catch(() => undefined);
    } else {
      result.unassigned++;
      await notifyHr(
        `${name} is due for probation evaluation on ${fmt(effectiveDue)} but has no reporting manager set. ` +
          `Assign an evaluator from the Probation Confirmation screen.`,
        '📋 Probation Evaluation',
      );
    }
  }

  return result;
}

/** POST /api/probation/generate — HR's manual trigger / backfill. */
export const generateDueEvaluations = async (req: Request, res: Response) => {
  try {
    if (!(await canManage(req))) return res.status(403).json({ error: 'Forbidden' });
    const result = await openDueEvaluations();
    res.json(result);
  } catch (err: any) {
    console.error('[probation] generateDueEvaluations failed:', err);
    res.status(500).json({ error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   READS
   ═══════════════════════════════════════════════════════════════════════════ */

/** GET /api/probation/categories — the form layout, so the UI never hardcodes it. */
export const getCategories = async (_req: Request, res: Response) => {
  res.json({
    categories: PROBATION_CATEGORIES,
    ratings: Object.entries(RATING_LABELS).map(([code, label]) => ({ code, label })),
    extensionMonths: EXTENSION_MONTHS,
  });
};

/**
 * GET /api/probation/evaluations
 * ?status=PENDING_MANAGER&mine=1&employeeId=&round=
 *
 * Without `admin.probation.manage` the result is silently narrowed to the
 * caller's own assignments — a manager cannot widen it with a query param.
 */
export const listEvaluations = async (req: Request, res: Response) => {
  try {
    const me = empId(req);
    if (!me) return res.status(401).json({ error: 'Unauthorized' });

    const manage = await canManage(req);
    const { status, employeeId, mine, unassigned } = req.query as Record<string, string>;

    const where: any = {};
    if (status) where.status = status;
    if (employeeId) where.employeeId = Number(employeeId);

    if (!manage) {
      where.managerId = me;
    } else if (mine === '1' || mine === 'true') {
      where.managerId = me;
    } else if (unassigned === '1' || unassigned === 'true') {
      where.managerId = null;
    }

    const rows = await prisma.probationEvaluation.findMany({
      where,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      include: {
        employee: { select: EMPLOYEE_SELECT },
        manager: { select: MANAGER_SELECT },
      },
    });

    res.json(
      rows.map((r) => ({
        ...r,
        employeeName: fullName(r.employee),
        managerName: r.manager ? fullName(r.manager) : null,
        departmentName: r.employee?.Department?.name ?? null,
        designationName: r.employee?.designation?.name ?? null,
        overdueDays:
          r.status === 'PENDING_MANAGER'
            ? Math.max(0, Math.floor((Date.now() - new Date(r.dueDate).getTime()) / 86400000))
            : 0,
      })),
    );
  } catch (err: any) {
    console.error('[probation] listEvaluations failed:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/probation/evaluations/:id
 * Includes every earlier round read-only, which the spec requires the manager
 * to see when re-evaluating after an extension.
 */
export const getEvaluation = async (req: Request, res: Response) => {
  try {
    const me = empId(req);
    const id = Number(req.params.id);

    const row = await prisma.probationEvaluation.findUnique({
      where: { id },
      include: {
        employee: { select: EMPLOYEE_SELECT },
        manager: { select: MANAGER_SELECT },
      },
    });
    if (!row) return res.status(404).json({ error: 'Evaluation not found' });

    const manage = await canManage(req);
    if (!manage && row.managerId !== me) return res.status(403).json({ error: 'Forbidden' });

    const previousRounds = await prisma.probationEvaluation.findMany({
      where: { employeeId: row.employeeId, round: { lt: row.round } },
      orderBy: { round: 'asc' },
      include: { manager: { select: MANAGER_SELECT } },
    });

    const hrDecidedByEmp = row.hrDecidedBy
      ? await prisma.employee.findUnique({ where: { id: row.hrDecidedBy }, select: MANAGER_SELECT })
      : null;

    res.json({
      ...row,
      employeeName: fullName(row.employee),
      managerName: row.manager ? fullName(row.manager) : null,
      hrDecidedByName: hrDecidedByEmp ? fullName(hrDecidedByEmp) : null,
      canEdit: row.status === 'PENDING_MANAGER' && (row.managerId === me || manage),
      canDecide: row.status === 'PENDING_HR' && manage,
      categories: PROBATION_CATEGORIES,
      previousRounds: previousRounds.map((p) => ({
        ...p,
        managerName: p.manager ? fullName(p.manager) : null,
      })),
    });
  } catch (err: any) {
    console.error('[probation] getEvaluation failed:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/probation/due — employees whose probation closes inside `days`
 * (default 30) and who have no open evaluation. HR's forward view.
 */
export const listDueEmployees = async (req: Request, res: Response) => {
  try {
    if (!(await canManage(req))) return res.status(403).json({ error: 'Forbidden' });

    const days = Number(req.query.days ?? 30);
    const horizon = new Date(Date.now() + days * 86400000);

    const employees = await prisma.employee.findMany({
      where: {
        employmentStatus: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
        probationStatus: { in: ['IN_PROGRESS', 'EXTENDED'] },
      },
      select: EMPLOYEE_SELECT,
    });

    const openRounds = await prisma.probationEvaluation.findMany({
      where: { status: { in: ['PENDING_MANAGER', 'PENDING_HR'] } },
      select: { employeeId: true },
    });
    const hasOpen = new Set(openRounds.map((r) => r.employeeId));

    const managerIds = [...new Set(employees.map((e) => e.reportingManager).filter(Boolean))] as number[];
    // reportingManager has no Prisma relation, so names come from a manual map.
    const managers = managerIds.length
      ? await prisma.employee.findMany({ where: { id: { in: managerIds } }, select: MANAGER_SELECT })
      : [];
    const managerById = new Map(managers.map((m) => [m.id, m]));

    const cutoff = probationCutoffDate();

    const rows = employees
      .filter((e) => !hasOpen.has(e.id))
      .map((e) => ({ emp: e, dueDate: probationDueDate(e) }))
      .filter((r) => r.dueDate.getTime() <= horizon.getTime())
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .map(({ emp, dueDate }) => ({
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        employeeName: fullName(emp),
        departmentName: emp.Department?.name ?? null,
        designationName: emp.designation?.name ?? null,
        dateOfJoining: emp.dateOfJoining,
        dueDate,
        daysRemaining: Math.ceil((dueDate.getTime() - Date.now()) / 86400000),
        probationStatus: emp.probationStatus,
        managerId: emp.reportingManager,
        managerName: emp.reportingManager ? fullName(managerById.get(emp.reportingManager)) || null : null,
        // Closed before go-live: the daily job will never open a form for this
        // one, so it only leaves the list when HR captures the paper decision.
        beforeCutoff: isBeforeCutoff(dueDate, cutoff),
        // Already made permanent while probation still reads as open — the
        // signature of a confirmation signed on paper and never recorded here.
        // A hint for HR to check the file, never grounds to auto-confirm.
        likelyDecidedOnPaper: emp.employmentType === 'PERMANENT',
      }));

    res.json({ cutoffDate: cutoff, rows });
  } catch (err: any) {
    console.error('[probation] listDueEmployees failed:', err);
    res.status(500).json({ error: err.message });
  }
};

/** GET /api/probation/employee/:employeeId/history — every round, read-only. */
export const getEmployeeHistory = async (req: Request, res: Response) => {
  try {
    const me = empId(req);
    const employeeId = Number(req.params.employeeId);
    const manage = await canManage(req);

    const rows = await prisma.probationEvaluation.findMany({
      where: { employeeId },
      orderBy: { round: 'asc' },
      include: { manager: { select: MANAGER_SELECT } },
    });

    if (!manage && !rows.some((r) => r.managerId === me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const records = await prisma.probationRecord.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      evaluations: rows.map((r) => ({ ...r, managerName: r.manager ? fullName(r.manager) : null })),
      records,
    });
  } catch (err: any) {
    console.error('[probation] getEmployeeHistory failed:', err);
    res.status(500).json({ error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   WRITES
   ═══════════════════════════════════════════════════════════════════════════ */

/** PATCH /api/probation/evaluations/:id/manager — HR clears the unassigned bucket. */
export const assignManager = async (req: Request, res: Response) => {
  try {
    if (!(await canManage(req))) return res.status(403).json({ error: 'Forbidden' });

    const id = Number(req.params.id);
    const managerId = Number(req.body?.managerId);
    if (!managerId) return res.status(400).json({ error: 'managerId is required' });

    const row = await prisma.probationEvaluation.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'Evaluation not found' });
    if (row.status !== 'PENDING_MANAGER') {
      return res.status(400).json({ error: 'Only a pending evaluation can be reassigned' });
    }

    const manager = await prisma.employee.findUnique({ where: { id: managerId }, select: MANAGER_SELECT });
    if (!manager) return res.status(400).json({ error: 'Manager not found' });

    const updated = await prisma.probationEvaluation.update({
      where: { id },
      data: { managerId },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });

    await createNotification(
      managerId,
      `You have been assigned the Probation Evaluation for ${fullName(updated.employee)} ` +
        `(due ${fmt(updated.dueDate)}). Please complete the form.`,
      '📋 Probation Evaluation',
    ).catch(() => undefined);

    res.json(updated);
  } catch (err: any) {
    console.error('[probation] assignManager failed:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/probation/evaluations/:id/manager-submit
 *
 * Every mandatory field is enforced here, not only in the form: strong points,
 * improvement points, all eight ratings, and a recommendation. Anything other
 * than CONFIRM additionally requires managerComments — an extension or a
 * termination without a stated reason is not a decision anyone can review.
 */
export const submitManagerEvaluation = async (req: Request, res: Response) => {
  try {
    const me = empId(req);
    const id = Number(req.params.id);

    const row = await prisma.probationEvaluation.findUnique({
      where: { id },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });
    if (!row) return res.status(404).json({ error: 'Evaluation not found' });

    const manage = await canManage(req);
    if (row.managerId !== me && !manage) return res.status(403).json({ error: 'Forbidden' });
    if (row.status !== 'PENDING_MANAGER') {
      return res.status(400).json({ error: `This evaluation is already ${row.status}` });
    }

    const {
      ratings,
      strongPoints,
      improvementPoints,
      recommendation,
      managerComments,
      employeeComments,
    } = req.body ?? {};

    let parsedRatings;
    try {
      parsedRatings = normaliseRatings(ratings);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    const strong = String(strongPoints ?? '').trim();
    const improve = String(improvementPoints ?? '').trim();
    if (!strong) return res.status(400).json({ error: 'Strong points are required' });
    if (!improve) return res.status(400).json({ error: 'Suggestions / areas for improvement are required' });

    const valid: ProbationOutcome[] = ['CONFIRM', 'EXTEND', 'TERMINATE', 'DEPARTMENT_TRANSFER'];
    if (!valid.includes(recommendation)) {
      return res.status(400).json({ error: `recommendation must be one of ${valid.join(', ')}` });
    }

    const comments = String(managerComments ?? '').trim();
    if (recommendation !== 'CONFIRM' && !comments) {
      return res.status(400).json({
        error:
          recommendation === 'EXTEND'
            ? 'Explain the reason for extension and the improvement expected during it'
            : 'A detailed justification is required for this recommendation',
      });
    }

    const now = new Date();
    const updated = await prisma.probationEvaluation.update({
      where: { id },
      data: {
        status: 'PENDING_HR',
        ratings: parsedRatings,
        strongPoints: strong,
        improvementPoints: improve,
        managerRecommendation: recommendation,
        managerComments: comments || null,
        employeeComments: String(employeeComments ?? '').trim() || null,
        evaluationDate: now,
        submittedAt: now,
        // The manager may have been reassigned mid-flight; record who filed it.
        managerId: row.managerId ?? me,
      },
      include: { employee: { select: EMPLOYEE_SELECT }, manager: { select: MANAGER_SELECT } },
    });

    await notifyHr(
      `Probation evaluation for ${fullName(updated.employee)} has been submitted by ` +
        `${fullName(updated.manager) || 'the reporting manager'} with a recommendation to ` +
        `${RECOMMENDATION_LABELS[recommendation as ProbationOutcome]}. Awaiting HR review.`,
      '📋 Probation Evaluation',
    );

    res.json(updated);
  } catch (err: any) {
    console.error('[probation] submitManagerEvaluation failed:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/probation/evaluations/:id/hr-decision
 *
 * HR's decision is final and always one of the four outcomes. When it differs
 * from the manager's recommendation that IS the rejection the spec describes —
 * there is no separate "reject" state that would leave the row with no outcome.
 * Comments are mandatory either way.
 */
export const submitHrDecision = async (req: Request, res: Response) => {
  try {
    if (!(await canManage(req))) return res.status(403).json({ error: 'Forbidden' });
    const me = empId(req);
    const id = Number(req.params.id);

    const row = await prisma.probationEvaluation.findUnique({
      where: { id },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });
    if (!row) return res.status(404).json({ error: 'Evaluation not found' });
    if (row.status !== 'PENDING_HR') {
      return res.status(400).json({
        error:
          row.status === 'PENDING_MANAGER'
            ? 'The reporting manager has not submitted this evaluation yet'
            : `This evaluation is already ${row.status}`,
      });
    }

    const { decision, hrComments } = req.body ?? {};
    const valid: ProbationOutcome[] = ['CONFIRM', 'EXTEND', 'TERMINATE', 'DEPARTMENT_TRANSFER'];
    if (!valid.includes(decision)) {
      return res.status(400).json({ error: `decision must be one of ${valid.join(', ')}` });
    }
    const comments = String(hrComments ?? '').trim();
    if (!comments) return res.status(400).json({ error: 'HR comments are required before submission' });

    const now = new Date();
    // Extensions run from the evaluation date, per the spec — not from today
    // and not from the probation end date.
    const from = row.evaluationDate ? new Date(row.evaluationDate) : now;
    const nextReviewDate = decision === 'EXTEND' ? addMonths(from, EXTENSION_MONTHS) : null;

    const outcome = await applyProbationOutcome({
      employeeId: row.employeeId,
      outcome: decision,
      decidedBy: me,
      remarks: comments,
      newEndDate: nextReviewDate,
      extendFrom: from,
      audit: { ...auditCtxFromReq(req), reason: `Probation decision: ${decision}` },
    });

    const updated = await prisma.probationEvaluation.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        hrDecision: decision,
        hrComments: comments,
        hrDecidedBy: me,
        hrDecidedAt: now,
        nextReviewDate,
        probationRecordId: outcome.openRecordId ?? row.probationRecordId,
      },
      include: { employee: { select: EMPLOYEE_SELECT }, manager: { select: MANAGER_SELECT } },
    });

    // Outside the transaction on purpose — revoking access must not be able to
    // roll back a recorded decision.
    if (decision === 'TERMINATE') {
      try {
        await revokeEmployeeAccess(row.employeeId, 'Probation terminated');
      } catch (e) {
        console.error('[probation] revokeEmployeeAccess failed:', e);
      }
    }

    const name = fullName(updated.employee);
    const disagreed = row.managerRecommendation && row.managerRecommendation !== decision;
    const note = disagreed
      ? ` This differs from your recommendation to ${RECOMMENDATION_LABELS[row.managerRecommendation as ProbationOutcome]}.`
      : '';

    if (updated.managerId) {
      await createNotification(
        updated.managerId,
        `HR has decided to ${RECOMMENDATION_LABELS[decision as ProbationOutcome]} for ${name}.${note}`,
        '📋 Probation Evaluation',
      ).catch(() => undefined);
    }

    if (decision !== 'TERMINATE') {
      await createNotification(
        row.employeeId,
        decision === 'CONFIRM'
          ? `Your probation has been confirmed. Welcome aboard as a permanent employee.`
          : decision === 'EXTEND'
            ? `Your probation has been extended to ${fmt(nextReviewDate)}. Your reporting manager will discuss the expectations with you.`
            : `Your probation review is complete. HR will be in touch regarding next steps.`,
        '📋 Probation',
      ).catch(() => undefined);
    }

    if (decision === 'DEPARTMENT_TRANSFER') {
      await notifyHr(
        `${name}'s probation decision is a department transfer. Probation remains open until the ` +
          `transfer is actioned on the employee record.`,
        '📋 Probation Evaluation',
      );
    }

    res.json({ ...updated, appliedOutcome: outcome });
  } catch (err: any) {
    console.error('[probation] submitHrDecision failed:', err);
    res.status(500).json({ error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTURING A DECISION TAKEN ON PAPER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * POST /api/probation/capture — HR transcribes a signed paper evaluation.
 *
 * Two cases, one endpoint:
 *   • the daily job already opened a round and the decision was taken offline;
 *   • the probation closed before the go-live cutoff, so no round exists at all
 *     and this creates it.
 *
 * The whole form is transcribed, so a captured record is structurally identical
 * to one filled in here and the PDF prints in full. What differs is the dates:
 * `evaluationDate` and `hrDecidedAt` are the dates on the PAPER, while
 * `submittedAt` stays the moment HR keyed it in — the audit trail must not
 * claim the manager used the system. `capturedOffline` records that distinction
 * so the PDF can state where the record came from.
 *
 * Nobody is notified: the decision was already taken and communicated offline.
 */
export const captureOfflineEvaluation = async (req: Request, res: Response) => {
  try {
    if (!(await canManage(req))) return res.status(403).json({ error: 'Forbidden' });
    const me = empId(req);

    const {
      employeeId,
      evaluationId,
      ratings,
      strongPoints,
      improvementPoints,
      recommendation,
      managerComments,
      employeeComments,
      decision,
      hrComments,
      evaluationDate,
      hrDecidedAt,
      managerId,
    } = req.body ?? {};

    /* ── Locate or create the round ──────────────────────────────────────── */

    let row = evaluationId
      ? await prisma.probationEvaluation.findUnique({ where: { id: Number(evaluationId) } })
      : null;

    if (evaluationId && !row) return res.status(404).json({ error: 'Evaluation not found' });
    if (row && row.status === 'COMPLETED') {
      return res.status(400).json({ error: 'This evaluation is already completed' });
    }

    const targetEmployeeId = row?.employeeId ?? Number(employeeId);
    if (!targetEmployeeId) {
      return res.status(400).json({ error: 'employeeId or evaluationId is required' });
    }

    const emp = await prisma.employee.findUnique({
      where: { id: targetEmployeeId },
      select: { ...EMPLOYEE_SELECT, dateOfJoining: true },
    });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    /* ── Validate the transcription ──────────────────────────────────────── */

    let parsedRatings;
    try {
      parsedRatings = normaliseRatings(ratings);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    const strong = String(strongPoints ?? '').trim();
    const improve = String(improvementPoints ?? '').trim();
    if (!strong) return res.status(400).json({ error: 'Strong points are required' });
    if (!improve) return res.status(400).json({ error: 'Suggestions / areas for improvement are required' });

    const valid: ProbationOutcome[] = ['CONFIRM', 'EXTEND', 'TERMINATE', 'DEPARTMENT_TRANSFER'];
    if (!valid.includes(recommendation)) {
      return res.status(400).json({ error: `recommendation must be one of ${valid.join(', ')}` });
    }
    if (!valid.includes(decision)) {
      return res.status(400).json({ error: `decision must be one of ${valid.join(', ')}` });
    }

    const mgrComments = String(managerComments ?? '').trim();
    if (recommendation !== 'CONFIRM' && !mgrComments) {
      return res.status(400).json({ error: "The manager's comments are required for this recommendation" });
    }
    const hrText = String(hrComments ?? '').trim();
    if (!hrText) return res.status(400).json({ error: 'HR comments are required' });

    /* ── Dates come off the paper, and must be sane ──────────────────────── */

    const now = new Date();
    if (!evaluationDate) return res.status(400).json({ error: 'The date the manager signed the form is required' });

    const signedOn = new Date(evaluationDate);
    if (Number.isNaN(signedOn.getTime())) return res.status(400).json({ error: 'evaluationDate is not a valid date' });
    if (signedOn.getTime() > now.getTime()) {
      return res.status(400).json({ error: 'The evaluation date cannot be in the future' });
    }
    if (signedOn.getTime() < new Date(emp.dateOfJoining).getTime()) {
      return res.status(400).json({ error: 'The evaluation date cannot be before the employee joined' });
    }

    const approvedOn = hrDecidedAt ? new Date(hrDecidedAt) : signedOn;
    if (Number.isNaN(approvedOn.getTime())) return res.status(400).json({ error: 'hrDecidedAt is not a valid date' });
    if (approvedOn.getTime() > now.getTime()) {
      return res.status(400).json({ error: 'The HR approval date cannot be in the future' });
    }
    if (approvedOn.getTime() < signedOn.getTime()) {
      return res.status(400).json({ error: 'HR cannot have approved the form before the manager signed it' });
    }

    /* ── Create the round if this is pre-cutoff backlog ───────────────────── */

    const openRecord = await prisma.probationRecord.findFirst({
      where: { employeeId: targetEmployeeId, status: 'IN_PROGRESS' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, endDate: true },
    });

    if (!row) {
      const lastRound = await prisma.probationEvaluation.findFirst({
        where: { employeeId: targetEmployeeId },
        orderBy: { round: 'desc' },
        select: { round: true, status: true },
      });
      if (lastRound && lastRound.status !== 'COMPLETED' && lastRound.status !== 'CANCELLED') {
        return res.status(400).json({
          error: 'This employee already has an open evaluation — capture against that one instead',
        });
      }

      row = await prisma.probationEvaluation.create({
        data: {
          employeeId: targetEmployeeId,
          probationRecordId: openRecord?.id ?? null,
          round: (lastRound?.round ?? 0) + 1,
          status: 'PENDING_MANAGER',
          // The window the paper form actually covered.
          dueDate: probationDueDate(emp, openRecord?.endDate ?? null),
          managerId: managerId ? Number(managerId) : resolveProbationManagerId(emp),
        },
      });
    }

    /* ── Apply the outcome using the PAPER dates ─────────────────────────── */

    const nextReviewDate = decision === 'EXTEND' ? addMonths(signedOn, EXTENSION_MONTHS) : null;

    const outcome = await applyProbationOutcome({
      employeeId: targetEmployeeId,
      outcome: decision,
      decidedBy: me,
      remarks: hrText,
      newEndDate: nextReviewDate,
      extendFrom: signedOn,
      decidedOn: approvedOn,
      audit: {
        ...auditCtxFromReq(req),
        reason: `Probation decision captured from signed paper form dated ${fmt(signedOn)}: ${decision}`,
      },
    });

    const updated = await prisma.probationEvaluation.update({
      where: { id: row.id },
      data: {
        status: 'COMPLETED',
        capturedOffline: true,
        ratings: parsedRatings,
        strongPoints: strong,
        improvementPoints: improve,
        managerRecommendation: recommendation,
        managerComments: mgrComments || null,
        employeeComments: String(employeeComments ?? '').trim() || null,
        managerId: managerId ? Number(managerId) : row.managerId,
        evaluationDate: signedOn,
        // When HR keyed it in — NOT when the manager signed.
        submittedAt: now,
        hrDecision: decision,
        hrComments: hrText,
        hrDecidedBy: me,
        hrDecidedAt: approvedOn,
        nextReviewDate,
        probationRecordId: outcome.openRecordId ?? row.probationRecordId,
      },
      include: { employee: { select: EMPLOYEE_SELECT }, manager: { select: MANAGER_SELECT } },
    });

    // Outside the transaction, as elsewhere — revoking access must not be able
    // to roll back a recorded decision.
    if (decision === 'TERMINATE') {
      try {
        await revokeEmployeeAccess(targetEmployeeId, 'Probation terminated');
      } catch (e) {
        console.error('[probation] revokeEmployeeAccess failed:', e);
      }
    }

    res.json({ ...updated, appliedOutcome: outcome });
  } catch (err: any) {
    console.error('[probation] captureOfflineEvaluation failed:', err);
    res.status(500).json({ error: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   PDF
   ═══════════════════════════════════════════════════════════════════════════ */

/** GET /api/probation/evaluations/:id/pdf */
export const downloadEvaluationPdf = async (req: Request, res: Response) => {
  try {
    const me = empId(req);
    const id = Number(req.params.id);

    const row = await prisma.probationEvaluation.findUnique({
      where: { id },
      include: {
        employee: { select: EMPLOYEE_SELECT },
        manager: { select: MANAGER_SELECT },
      },
    });
    if (!row) return res.status(404).json({ error: 'Evaluation not found' });

    const manage = await canManage(req);
    if (!manage && row.managerId !== me) return res.status(403).json({ error: 'Forbidden' });

    // The spec's PDF is the record of a completed process; an unsubmitted form
    // has no ratings to print.
    if (row.status === 'PENDING_MANAGER') {
      return res.status(400).json({ error: 'The evaluation has not been submitted yet' });
    }

    const hrDecidedByEmp = row.hrDecidedBy
      ? await prisma.employee.findUnique({ where: { id: row.hrDecidedBy }, select: MANAGER_SELECT })
      : null;

    // Earlier rounds are summarised on the document so a confirmation after an
    // extension carries the whole probation history on one sheet for the file.
    const previousRounds = await prisma.probationEvaluation.findMany({
      where: { employeeId: row.employeeId, round: { lt: row.round }, status: 'COMPLETED' },
      orderBy: { round: 'asc' },
      include: { manager: { select: MANAGER_SELECT } },
    });

    const pdf = await buildProbationEvaluationPdf({
      evaluation: row as any,
      employee: row.employee as any,
      manager: row.manager as any,
      hrDecidedByName: hrDecidedByEmp ? fullName(hrDecidedByEmp) : null,
      previousRounds: previousRounds.map((p) => ({
        round: p.round,
        evaluationDate: p.evaluationDate,
        managerName: p.manager ? fullName(p.manager) : null,
        ratings: p.ratings,
        managerRecommendation: p.managerRecommendation,
        hrDecision: p.hrDecision,
        nextReviewDate: p.nextReviewDate,
        improvementPoints: p.improvementPoints,
        capturedOffline: p.capturedOffline,
      })),
    });

    const code = row.employee?.employeeCode ?? row.employeeId;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="probation-evaluation-${code}-round${row.round}.pdf"`,
    );
    res.send(pdf);
  } catch (err: any) {
    console.error('[probation] downloadEvaluationPdf failed:', err);
    res.status(500).json({ error: err.message });
  }
};
