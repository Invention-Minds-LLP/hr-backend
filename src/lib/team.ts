// ─────────────────────────────────────────────────────────────────────────────
//  "Who reports to me" — the one definition.
//
//  Until now every caller re-derived this inline and they did not agree:
//    comp-off-request.controller  → reportingManager only
//    incentive.controller         → inchargeId only
//    appraisal.controller         → either
//  Three screens, three different team sizes for the same manager. The manager
//  dashboard shows those numbers side by side, so the disagreement stops being
//  invisible: "Team Strength 12" next to "Pending Requests" counted over 9
//  people is a bug the user can see.
//
//  RELATION, NOT ROLE ID. Membership is decided by the two FK columns on
//  Employee, never by roleId — roleId 5 is named "Junior Executive" but is
//  treated as In-charge throughout this codebase, and the Role table holds
//  near-duplicate names. This is the same reasoning (and the same precedence)
//  as resolveReviewerRole in lib/performance-scoring.ts, which resolves the
//  INCHARGE / HOD columns on the appraisal sheet.
//
//  One manager can hold BOTH relations at once — In-charge of the staff nurses,
//  HOD of the in-charges — so the relation is stored per member, not per
//  manager. That is what tells the approvals endpoint whether a pending leave
//  is waiting on `inChargeDecision` or on `hodDecision`.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from './prisma';

/** How the manager holds this person. Mirrors the reviewer roles of the same name. */
export type TeamRelation = 'INCHARGE' | 'HOD';

/** Employment statuses that still count as "on my team" — matches the access rule. */
const ACTIVE_STATUSES = ['ACTIVE', 'NOTICE_PERIOD'] as const;

export type TeamMember = {
  id: number;
  employeeCode: string;
  name: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  designation: string | null;
  departmentId: number;
  departmentName: string | null;
  branchId: number;
  shiftId: number | null;
  dateOfJoining: Date;
  employmentStatus: string;
  probationStatus: string | null;
  probationEndDate: Date | null;
  relation: TeamRelation;
};

export type TeamScope = {
  managerId: number;
  /** Ready to drop into `{ employeeId: { in: … } }`. Empty when nobody reports in. */
  employeeIds: number[];
  members: TeamMember[];
  byId: Map<number, TeamMember>;
  /** Which decision column this manager fills for each member. */
  relationOf: (employeeId: number) => TeamRelation | null;
  /** True when the manager holds at least one person as HOD. */
  hasHodReports: boolean;
  /** True when the manager holds at least one person as In-charge. */
  hasInchargeReports: boolean;
  isEmpty: boolean;
};

/** The scope a manager with no reports gets — every endpoint renders an empty state off this. */
function emptyScope(managerId: number): TeamScope {
  return {
    managerId,
    employeeIds: [],
    members: [],
    byId: new Map(),
    relationOf: () => null,
    hasHodReports: false,
    hasInchargeReports: false,
    isEmpty: true,
  };
}

/**
 * Everyone who reports DIRECTLY to `managerId`, by either relation.
 *
 * Deliberately one level deep. There is no closure table in this schema, so a
 * recursive walk would be N queries deep with no depth bound, and it would
 * double-count anyone whose inchargeId and reportingManager sit on different
 * branches of the same chain. Every approval flow in the system is already
 * one-level (`approverId !== emp.reportingManager` → 403), so one level is also
 * what the manager can actually act on.
 */
export async function getTeamScope(managerId: number | null | undefined): Promise<TeamScope> {
  const id = Number(managerId);
  if (!Number.isInteger(id) || id <= 0) return emptyScope(0);

  const rows = await prisma.employee.findMany({
    where: {
      OR: [{ inchargeId: id }, { reportingManager: id }],
      employmentStatus: { in: [...ACTIVE_STATUSES] as any },
      // A manager is not their own report. Self-referencing rows exist in the
      // live data (HODs whose reportingManager was set to themselves during
      // import) and would inflate every count on the dashboard by one.
      NOT: { id },
    },
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      photoUrl: true,
      departmentId: true,
      branchId: true,
      shiftId: true,
      dateOfJoining: true,
      employmentStatus: true,
      probationStatus: true,
      probationEndDate: true,
      inchargeId: true,
      reportingManager: true,
      designation: { select: { name: true } },
      Department: { select: { name: true } },
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });

  if (!rows.length) return emptyScope(id);

  const members: TeamMember[] = rows.map((e) => ({
    id: e.id,
    employeeCode: e.employeeCode ?? '',
    name: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(),
    firstName: e.firstName ?? '',
    lastName: e.lastName ?? '',
    photoUrl: e.photoUrl ?? null,
    designation: e.designation?.name ?? null,
    departmentId: e.departmentId,
    departmentName: e.Department?.name ?? null,
    branchId: e.branchId,
    shiftId: e.shiftId ?? null,
    dateOfJoining: e.dateOfJoining,
    employmentStatus: String(e.employmentStatus),
    probationStatus: e.probationStatus ? String(e.probationStatus) : null,
    probationEndDate: e.probationEndDate ?? null,
    // Precedence matches resolveReviewerRole: the in-charge relation is the
    // closer one, so it wins when a manager somehow holds both over one person.
    relation: e.inchargeId === id ? 'INCHARGE' : 'HOD',
  }));

  const byId = new Map(members.map((m) => [m.id, m]));

  return {
    managerId: id,
    employeeIds: members.map((m) => m.id),
    members,
    byId,
    relationOf: (employeeId: number) => byId.get(employeeId)?.relation ?? null,
    hasHodReports: members.some((m) => m.relation === 'HOD'),
    hasInchargeReports: members.some((m) => m.relation === 'INCHARGE'),
    isEmpty: false,
  };
}

/**
 * Does this employee report to this manager? For the drill-down endpoints,
 * which take an employeeId from the client and must not leak a stranger's row.
 */
export function isOnTeam(scope: TeamScope, employeeId: number): boolean {
  return scope.byId.has(employeeId);
}
