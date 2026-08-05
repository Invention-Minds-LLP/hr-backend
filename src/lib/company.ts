// ─────────────────────────────────────────────────────────────────────────────
//  Company (legal entity) resolution.
//
//  A deployment serves one client, but that client may run several registered
//  entities. Employee.companyId is nullable so the rollout doesn't break
//  existing rows — everything that needs a company goes through
//  resolveCompanyId(), which falls back to the default company.
//
//  Branch stays a *location* construct. Company is the *legal* one: it owns the
//  PF/ESI/PT registration codes, the payroll runs, and the Form 16 identity.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from './prisma';

const DEFAULT_COMPANY_NAME = 'Default Company';

/**
 * The company flagged isDefault, creating it on first call if the table is
 * empty. Every deployment needs at least one entity for payroll to be
 * attributable, so this bootstraps rather than throwing.
 */
export async function getDefaultCompany(): Promise<{ id: number; name: string }> {
  const existing = await (prisma as any).company.findFirst({
    where: { isDefault: true },
    select: { id: true, name: true },
  });
  if (existing) return existing;

  // No default flagged — adopt the oldest company if one exists.
  const oldest = await (prisma as any).company.findFirst({
    orderBy: { id: 'asc' },
    select: { id: true, name: true },
  });
  if (oldest) {
    await (prisma as any).company.update({
      where: { id: oldest.id },
      data: { isDefault: true },
    });
    return oldest;
  }

  return (prisma as any).company.create({
    data: { name: DEFAULT_COMPANY_NAME, isDefault: true, isActive: true },
    select: { id: true, name: true },
  });
}

/** Company for an employee, falling back to the default when unset. */
export async function resolveCompanyId(employeeId: number): Promise<number> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { companyId: true } as any,
  });
  const companyId = (emp as any)?.companyId;
  if (companyId) return companyId;

  const fallback = await getDefaultCompany();
  return fallback.id;
}

/**
 * Normalise a caller-supplied companyId. Returns the default company when the
 * value is absent or not a positive integer, so a request that omits the
 * parameter still resolves to something valid.
 */
export async function coerceCompanyId(raw: unknown): Promise<number> {
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) {
    const exists = await (prisma as any).company.findUnique({
      where: { id: parsed },
      select: { id: true },
    });
    if (exists) return parsed;
  }
  const fallback = await getDefaultCompany();
  return fallback.id;
}

/**
 * One-time backfill: point every employee and payroll run with a NULL companyId
 * at the default company. Safe to run repeatedly — it only touches NULL rows.
 *
 * Called from the bootstrap at startup so a deployment that has just taken the
 * multi-company schema converges without anyone running a script by hand.
 */
export async function backfillCompanyIds(): Promise<{
  companyId: number;
  employeesUpdated: number;
  payrollRunsUpdated: number;
}> {
  const company = await getDefaultCompany();

  const employees = await prisma.employee.updateMany({
    where: { companyId: null } as any,
    data: { companyId: company.id } as any,
  });

  const runs = await (prisma as any).payrollRun.updateMany({
    where: { companyId: null },
    data: { companyId: company.id },
  });

  return {
    companyId: company.id,
    employeesUpdated: employees.count,
    payrollRunsUpdated: runs.count,
  };
}
