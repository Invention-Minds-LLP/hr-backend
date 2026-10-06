// ─────────────────────────────────────────────────────────────────────────────
//  Which departments does a person head?
//
//  Employee.departmentId says where somebody SITS. It was also being used to
//  decide what they can see as a head — so an HOD covering three departments
//  saw one department's clearances and one department's requisitions.
//
//  The answer is now: the departments listed on their profile
//  (Employee.headedDepartments) PLUS their own department. Keeping their own
//  department in the set means every existing HOD keeps exactly the access they
//  had before anyone fills the new field in.
//
//  The relation is new, so a client generated before it was added has no
//  `headedDepartments`. Every read here tolerates that and falls back to the
//  old single-department behaviour rather than throwing.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from './prisma';

const p: any = prisma;

/** Roles that act as a department head. 3 = HOD / Reporting Manager. */
export const HOD_ROLE_ID = 3;
/** 1 = HR, who sees every department. */
export const HR_ROLE_ID = 1;

const EMPLOYED = ['ACTIVE', 'NOTICE_PERIOD'];

/**
 * Department ids this employee covers as a head — their own department plus
 * any they have been given. Returns [] for an unknown employee.
 */
export async function headedDepartmentIds(employeeId: number): Promise<number[]> {
  if (!employeeId) return [];

  let emp: any = null;
  try {
    emp = await p.employee.findUnique({
      where: { id: employeeId },
      select: { departmentId: true, headedDepartments: { select: { id: true } } },
    });
  } catch {
    // Client predates the relation — fall back to the own-department rule.
    emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { departmentId: true },
    });
  }
  if (!emp) return [];

  const ids = new Set<number>();
  if (emp.departmentId) ids.add(emp.departmentId);
  for (const d of emp.headedDepartments ?? []) ids.add(d.id);
  return [...ids];
}

/** Does this employee head that department? */
export async function isDepartmentHead(employeeId: number, departmentId: number | null | undefined): Promise<boolean> {
  if (!employeeId || !departmentId) return false;
  const ids = await headedDepartmentIds(employeeId);
  return ids.includes(departmentId);
}

/**
 * Employees to notify as the head(s) of a department: everyone who lists it,
 * plus the legacy rule (an HOD-role employee sitting in it) so departments
 * nobody has been assigned to still reach someone.
 */
export async function headsOfDepartment(departmentId: number): Promise<number[]> {
  if (!departmentId) return [];

  let explicit: any[] = [];
  try {
    explicit = await p.employee.findMany({
      where: {
        employmentStatus: { in: EMPLOYED },
        headedDepartments: { some: { id: departmentId } },
      },
      select: { id: true },
    });
  } catch {
    explicit = [];
  }

  const legacy = await prisma.employee.findMany({
    where: {
      departmentId,
      roleId: HOD_ROLE_ID,
      employmentStatus: { in: EMPLOYED as any },
    },
    select: { id: true },
  });

  return [...new Set([...explicit.map((e) => e.id), ...legacy.map((e) => e.id)])];
}
