// ─────────────────────────────────────────────────────────────────────────────
//  The offboarding decisions, as pure functions.
//
//  These four rules decide whether somebody keeps their access, gets their
//  clearance, and is handed a relieving letter — so they are kept out of the
//  request handlers and checked directly (npm run verify:offboarding).
// ─────────────────────────────────────────────────────────────────────────────

export type ClearanceItemStatus = 'PENDING' | 'CLEARED' | 'DUE' | 'NA';
export type ApprovalDecision = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * A department's clearance follows its checklist and is never set by hand:
 * anything outstanding (DUE) rejects it, everything cleared or not-applicable
 * approves it, and anything still untouched leaves it pending. An empty
 * checklist is pending, not approved — nobody has looked at it yet.
 */
export function computeClearanceDecision(items: { status: ClearanceItemStatus }[]): ApprovalDecision {
  if (items.some((i) => i.status === 'DUE')) return 'REJECTED';
  if (items.length > 0 && items.every((i) => i.status === 'CLEARED' || i.status === 'NA')) return 'APPROVED';
  return 'PENDING';
}

/**
 * The date the employment actually ends. HR may set an exact date; when they
 * don't, the notice-period date they agreed stands. Returning null here is what
 * used to leave somebody on notice — and logged in — for good.
 */
export function lastWorkingDayFor(r: {
  actualLastWorkingDay?: Date | null;
  proposedLastWorkingDay?: Date | null;
}): Date | null {
  return r.actualLastWorkingDay ?? r.proposedLastWorkingDay ?? null;
}

/** Can this person act on a clearance belonging to that department? */
export function coversDepartment(
  actor: { isHR: boolean; headedDepartmentIds: number[] },
  departmentId: number | null | undefined,
): boolean {
  if (actor.isHR) return true;
  if (!departmentId) return false;
  return actor.headedDepartmentIds.includes(departmentId);
}

/**
 * Which departments must clear this leaver.
 *
 * The mapping on their own department wins; where none is configured the old
 * org-wide "default clearance" flag still applies, so an unconfigured system
 * behaves exactly as it did. The leaver's own department is never included —
 * that is the separate HOD clearance.
 */
export function resolveClearanceDepartments(input: {
  employeeDepartmentId: number | null | undefined;
  mappedDepartmentIds: number[];
  defaultDepartmentIds: number[];
}): number[] {
  const chosen = input.mappedDepartmentIds.length ? input.mappedDepartmentIds : input.defaultDepartmentIds;
  return [...new Set(chosen)].filter((id) => id !== input.employeeDepartmentId);
}

/**
 * A clearance certificate, relieving letter or experience letter says the exit
 * is finished, so all four conditions must hold before one is issued.
 */
export function exitDocumentEligibility(r: {
  status: string;
  clearances: { decision: string }[];
  handoverTasks: { status: string }[];
  settlementStatus?: string | null;
}): { eligible: boolean; details: Record<string, boolean> } {
  const details = {
    statusOk: ['APPROVED', 'COMPLETED'].includes(r.status),
    allClearancesApproved: r.clearances.length > 0 && r.clearances.every((c) => c.decision === 'APPROVED'),
    allTasksDone: r.handoverTasks.every((t) => t.status === 'DONE'),
    settlementPaid: r.settlementStatus === 'PAID',
  };
  return { eligible: Object.values(details).every(Boolean), details };
}
