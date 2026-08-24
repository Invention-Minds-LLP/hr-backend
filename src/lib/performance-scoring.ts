/**
 * Reviewer roles and score banding for the Dept Performance Indicator.
 *
 * REVIEWER ROLES
 * Each question can hold one score per reviewer role, keyed by
 * PerformanceResponse's unique [employeeId, cycle, period, questionId,
 * reviewerRole]. The role is derived from the viewer's RELATIONSHIP to the
 * employee, not from their roleId — roleId 5 is named "Junior Executive" but is
 * treated as In-charge throughout this codebase, so role ids are not a reliable
 * signal. Relationships are unambiguous.
 *
 * "SELF" is how self-appraisal works in this module: it is a score row like any
 * other. Nothing here touches SelfAppraisal / AppraisalForm, which belong to the
 * managerial appraisal module — the two cannot collide because they share no
 * table.
 */

/**
 * Matches the printed sheet's signature columns:
 *   Employee | Supervisor / In-charge | HOD
 * plus Management, who also scores here.
 *
 * HOD is the employee's REPORTING MANAGER — there is no separate department-head
 * field in this system, and that is who signs the HOD column.
 *
 * SELF is retained for VISIBILITY only: the employee's own assessment lives in
 * the separate self-appraisal, so nothing is ever written under this role. It
 * exists so canSeeReviewerScore can recognise the subject looking at their own
 * sheet and show them nobody's marks.
 */
export const REVIEWER_ROLES = ["SELF", "INCHARGE", "HOD", "MANAGEMENT"] as const;
export type ReviewerRole = (typeof REVIEWER_ROLES)[number];

/** Roles that may actually write a score. SELF is deliberately absent. */
export const SCORING_ROLES: ReviewerRole[] = ["INCHARGE", "HOD", "MANAGEMENT"];

/** Value carried by rows written before reviewer roles existed. */
export const LEGACY_REVIEWER_ROLE = "REVIEWER";

/** Role id of Management in the Role table. */
export const MANAGEMENT_ROLE_ID = 4;

export const REVIEWER_ROLE_LABELS: Record<string, string> = {
  SELF: "Self",
  INCHARGE: "In-charge",
  HOD: "HOD",
  MANAGEMENT: "Management",
  [LEGACY_REVIEWER_ROLE]: "Reviewer",
};

export function isReviewerRole(value: unknown): value is ReviewerRole {
  return typeof value === "string" && (REVIEWER_ROLES as readonly string[]).includes(value);
}

export interface ViewerContext {
  empId: number | null;
  role: string;
  deptId: number | null;
  /** Checked alongside the name — role ids and names have both drifted here. */
  roleId?: number | null;
}

export interface SubjectContext {
  id: number;
  departmentId: number | null;
  inchargeId: number | null;
  reportingManager: number | null;
}

/**
 * Which column the viewer fills in on this employee's sheet.
 *
 * Order matters: scoring yourself always wins, then the two explicit
 * relationships, then department leadership. Returns null when the viewer has
 * no standing to score — they may still read the sheet.
 */
export function resolveReviewerRole(viewer: ViewerContext, subject: SubjectContext): ReviewerRole | null {
  if (!viewer.empId) return null;

  // The subject themselves: recognised so they see none of their reviewers'
  // marks, but they never score here — that is the self-appraisal.
  if (viewer.empId === subject.id) return "SELF";

  // Both derived from the relationship, not a role name: the Role table holds
  // near-duplicates ("Incharge" and "Incharges"), so names cannot be trusted.
  if (subject.inchargeId && viewer.empId === subject.inchargeId) return "INCHARGE";
  if (subject.reportingManager && viewer.empId === subject.reportingManager) return "HOD";

  // Management scores everyone, and needs its own column: previously it shared
  // "HOD" with HR, so whichever of them saved second overwrote the other.
  const role = (viewer.role || "").trim();
  if (role === "Management" || viewer.roleId === MANAGEMENT_ROLE_ID) return "MANAGEMENT";

  // HR administers — assigns, tracks, and signs the final review. On the printed
  // sheet they do not sign the per-period grid, so they get no scoring column
  // unless they happen to be this employee's own reporting manager (handled
  // above). isHRViewer still grants them full visibility.
  return null;
}

// ── Who may READ whose scores ───────────────────────────────────────────────

/**
 * HR administers appraisals and is the only party with full visibility.
 * Matches how getAllSummaries already identifies HR, including the HR
 * department (deptId 1) whose executives handle other departments.
 */
export function isHRViewer(viewer: ViewerContext): boolean {
  const role = viewer.role || "";
  if (role === "HR" || role === "HR Manager" || role === "Management") return true;
  return viewer.deptId === 1;
}

/**
 * Appraisal scores are confidential between each reviewer and HR.
 *
 * Everyone except HR sees ONLY their own column — an employee must not see what
 * their in-charge scored them, and a reviewer must not be anchored by another
 * reviewer's marks. The employee still sees the summary total and band, which is
 * the row they sign on the paper form; what is withheld is the per-question
 * breakdown of who gave what.
 *
 * Rows written before reviewer roles existed carry LEGACY_REVIEWER_ROLE. They
 * are not attributable to anyone, so any reviewer may still see them — but the
 * employee may not, since they are somebody's assessment of that employee.
 */
export function canSeeReviewerScore(
  viewerRole: ReviewerRole | null,
  isHR: boolean,
  scoreRole: string,
): boolean {
  if (isHR) return true;
  if (viewerRole === "SELF") return scoreRole === "SELF";
  if (!viewerRole) return scoreRole === LEGACY_REVIEWER_ROLE;
  return scoreRole === viewerRole || scoreRole === LEGACY_REVIEWER_ROLE;
}

// ── Completion tracking ─────────────────────────────────────────────────────

export type ProgressState = "none" | "partial" | "done" | "unknown";

/**
 * How far one reviewer has got on one row, from how many questions they have
 * scored against how many the template holds.
 *
 * `unknown` covers rows with no template attached: there is no denominator, so
 * completeness cannot be judged. Reporting those as "partial" would strand them
 * as permanently unfinished — they show "Assign Template" in the action column
 * instead.
 */
export function reviewerProgressState(scored: number, totalQuestions: number): ProgressState {
  if (!scored) return "none";
  if (totalQuestions <= 0) return "unknown";
  return scored >= totalQuestions ? "done" : "partial";
}

// ── Score banding ───────────────────────────────────────────────────────────

export interface ScoreBand {
  label: string;
  minPercent: number;
}

/**
 * Used when a template carries no bands of its own. Deliberately more forgiving
 * than the JMRH Patient Relation sheet, whose 190/160/120 out of a 190 maximum
 * makes "Outstanding" a literally perfect score.
 */
export const DEFAULT_SCORE_BANDS: ScoreBand[] = [
  { label: "Outstanding", minPercent: 95 },
  { label: "Commendable", minPercent: 80 },
  { label: "Acceptable", minPercent: 60 },
  { label: "Not Acceptable", minPercent: 0 },
];

/** Highest score any single question can be given. */
export const MAX_SCORE_PER_QUESTION = 5;

/** Validate and normalise bands coming from the client or the DB. */
export function parseScoreBands(raw: unknown): ScoreBand[] {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_SCORE_BANDS;

  const bands: ScoreBand[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const label = String((entry as any).label ?? "").trim();
    const minPercent = Number((entry as any).minPercent);
    if (!label || !Number.isFinite(minPercent)) continue;
    bands.push({ label, minPercent: Math.min(100, Math.max(0, minPercent)) });
  }
  if (!bands.length) return DEFAULT_SCORE_BANDS;

  // Highest threshold first, so the first match wins.
  bands.sort((a, b) => b.minPercent - a.minPercent);
  return bands;
}

/** Weighted maximum for a template — weightless questions count as 1. */
export function templateMaxMarks(questions: Array<{ weight?: number | null }>): number {
  return questions.reduce((sum, q) => sum + MAX_SCORE_PER_QUESTION * (q.weight || 1), 0);
}

/**
 * Band a total against the template's own maximum. Comparing raw totals against
 * fixed cut-offs only ever worked for a template with exactly the number of
 * questions those cut-offs were written for.
 */
export function bandFor(total: number, maxMarks: number, bands: ScoreBand[] = DEFAULT_SCORE_BANDS): string | null {
  if (!maxMarks || maxMarks <= 0) return null;
  const pct = (total / maxMarks) * 100;
  for (const band of bands) {
    if (pct >= band.minPercent) return band.label;
  }
  return bands[bands.length - 1]?.label ?? null;
}
