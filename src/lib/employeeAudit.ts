/**
 * Employee audit-trail helpers.
 *
 * Every write to the Employee table SHOULD go through one of the helpers
 * below so the change is recorded in EmployeeAuditLog. Going around them
 * (calling prisma.employee.update directly) means the change won't show
 * up in HR's edit-history view — which is the whole point of the module.
 *
 * Usage:
 *   await updateEmployeeWithAudit({
 *     employeeId,
 *     data: { designation: 'Senior Eng', salary: 800000 },
 *     changedBy: req.user.empId,
 *     reason: 'Annual cycle promotion',
 *     source: 'PROMOTION',
 *     causedByPromotionId: promotion.id,
 *     ip: req.ip,
 *     userAgent: req.get('user-agent'),
 *   });
 */

import { prisma } from './prisma';
import type { Prisma } from '@prisma/client';

/** Fields we never want in the audit diff (timestamps, internal cache, secrets, FK noise). */
const IGNORED_FIELDS = new Set<string>([
  'createdAt', 'updatedAt',
  'accessRevokedAt',                  // session metadata, not employee data
  'healthCheckReminderSent', 'healthCheckReminderYear',
]);

export interface AuditContext {
  changedBy?: number | null;
  reason?: string | null;
  source?: 'WEB' | 'IMPORT' | 'MIGRATION' | 'SYSTEM' | 'PROMOTION' | 'RESIGNATION' | 'ONBOARDING' | 'CRON' | string | null;
  causedByPromotionId?: number | null;
  causedByResignationId?: number | null;
  causedByOnboardingId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface UpdateEmployeeArgs extends AuditContext {
  employeeId: number;
  data: Prisma.EmployeeUpdateInput;
  /** Optional Prisma transaction client — pass when wrapping in $transaction. */
  tx?: Prisma.TransactionClient;
}

export interface CreateEmployeeArgs extends AuditContext {
  data: Prisma.EmployeeCreateInput;
  tx?: Prisma.TransactionClient;
}

export interface DeleteEmployeeArgs extends AuditContext {
  employeeId: number;
  tx?: Prisma.TransactionClient;
}

/* ── Diff helper ─────────────────────────────────────────────── */

/**
 * Build a JSON diff of the form { field: { from, to } } between `before`
 * and `after`. Only fields whose value actually changed (deep-ish equality
 * via JSON.stringify) are included. Returns `null` if nothing changed.
 */
export function buildEmployeeDiff(before: Record<string, any>, after: Record<string, any>):
  { changes: Record<string, { from: any; to: any }>; changedFields: string[] } | null {
  const changes: Record<string, { from: any; to: any }> = {};
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const f of fields) {
    if (IGNORED_FIELDS.has(f)) continue;
    const a = before?.[f];
    const b = after?.[f];

    // Treat null/undefined as the same; compare dates by ms; everything else by JSON
    const norm = (v: any) =>
      v == null ? null
      : v instanceof Date ? v.getTime()
      : typeof v === 'object' ? JSON.stringify(v)
      : v;

    if (norm(a) !== norm(b)) {
      changes[f] = { from: a ?? null, to: b ?? null };
    }
  }
  const changedFields = Object.keys(changes);
  if (changedFields.length === 0) return null;
  return { changes, changedFields };
}

/* ── Helpers ─────────────────────────────────────────────────── */

async function writeAuditRow(
  tx: Prisma.TransactionClient,
  args: AuditContext & {
    employeeId: number;
    action: 'CREATE' | 'UPDATE' | 'DELETE';
    changes: any;
    changedFields: string[] | null;
    ip?: string | null;
  },
) {
  await (tx as any).employeeAuditLog.create({
    data: {
      employeeId: args.employeeId,
      action: args.action,
      changes: args.changes ?? null,
      changedFields: args.changedFields ?? null,
      changedBy: args.changedBy ?? null,
      reason: args.reason ?? null,
      source: args.source ?? 'WEB',
      causedByPromotionId: args.causedByPromotionId ?? null,
      causedByResignationId: args.causedByResignationId ?? null,
      causedByOnboardingId: args.causedByOnboardingId ?? null,
      ipAddress: args.ip ?? null,
      userAgent: args.userAgent ?? null,
    },
  });
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Update an employee + write an audit row in a single transaction.
 * If nothing actually changed, the update is skipped (no audit row written).
 */
export async function updateEmployeeWithAudit(args: UpdateEmployeeArgs) {
  const run = async (tx: Prisma.TransactionClient) => {
    const before = await tx.employee.findUnique({ where: { id: args.employeeId } });
    if (!before) {
      throw new Error(`Employee #${args.employeeId} not found`);
    }
    const after = await tx.employee.update({
      where: { id: args.employeeId },
      data: args.data,
    });
    const diff = buildEmployeeDiff(before as any, after as any);
    if (diff) {
      await writeAuditRow(tx, {
        ...args,
        action: 'UPDATE',
        changes: diff.changes,
        changedFields: diff.changedFields,
      });
    }
    return after;
  };

  return args.tx ? run(args.tx) : prisma.$transaction(run, { timeout: 15000 });
}

/** Create an employee + log it. */
export async function createEmployeeWithAudit(args: CreateEmployeeArgs) {
  const run = async (tx: Prisma.TransactionClient) => {
    const created = await tx.employee.create({ data: args.data });
    await writeAuditRow(tx, {
      ...args,
      employeeId: created.id,
      action: 'CREATE',
      changes: created,
      changedFields: Object.keys(created).filter((k) => !IGNORED_FIELDS.has(k)),
    });
    return created;
  };
  return args.tx ? run(args.tx) : prisma.$transaction(run, { timeout: 15000 });
}

/** Delete an employee + log the prior row so we can replay later. */
export async function deleteEmployeeWithAudit(args: DeleteEmployeeArgs) {
  const run = async (tx: Prisma.TransactionClient) => {
    const before = await tx.employee.findUnique({ where: { id: args.employeeId } });
    if (!before) return null;
    await tx.employee.delete({ where: { id: args.employeeId } });
    await writeAuditRow(tx, {
      ...args,
      action: 'DELETE',
      changes: before,
      changedFields: Object.keys(before).filter((k) => !IGNORED_FIELDS.has(k)),
    });
    return before;
  };
  return args.tx ? run(args.tx) : prisma.$transaction(run, { timeout: 15000 });
}

/**
 * Convenience: derive the AuditContext bits from an Express request.
 * Use this so you don't have to spell out ip/userAgent everywhere.
 */
export function auditCtxFromReq(req: any, extras: Partial<AuditContext> = {}): AuditContext {
  return {
    changedBy: req?.user?.empId ?? req?.user?.userId ?? null,
    reason: extras.reason ?? null,
    source: extras.source ?? 'WEB',
    causedByPromotionId: extras.causedByPromotionId ?? null,
    causedByResignationId: extras.causedByResignationId ?? null,
    causedByOnboardingId: extras.causedByOnboardingId ?? null,
    ip: req?.ip ?? req?.socket?.remoteAddress ?? null,
    userAgent: req?.get?.('user-agent') ?? null,
  };
}
