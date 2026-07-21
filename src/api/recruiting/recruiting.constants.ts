/**
 * String-enum constants for recruiting fields whose Prisma column is `String`
 * (kept that way for backward compat with existing rows). Always import these
 * instead of typing literal strings to get compile-time safety + a single
 * source of truth.
 */

// ── CandidateAssignedTest.status ───────────────────────────────────
export const CandidateTestStatusValues = [
  "NotStarted",
  "InProgress",
  "Completed",
  "Cancelled",
] as const;
export type CandidateTestStatus = typeof CandidateTestStatusValues[number];

export function isCandidateTestStatus(v: unknown): v is CandidateTestStatus {
  return typeof v === "string" && (CandidateTestStatusValues as readonly string[]).includes(v);
}

// ── CandidateAssignedTest.reviewDecision ───────────────────────────
export const CandidateTestReviewValues = ["PASS", "FAIL"] as const;
export type CandidateTestReview = typeof CandidateTestReviewValues[number];

// ── InterviewPanelMember.ackStatus ─────────────────────────────────
// Panel member's availability acknowledgement for a scheduled interview.
export const PanelAckStatusValues = ["PENDING", "AVAILABLE", "UNAVAILABLE"] as const;
export type PanelAckStatus = typeof PanelAckStatusValues[number];

export function isPanelAckStatus(v: unknown): v is PanelAckStatus {
  return typeof v === "string" && (PanelAckStatusValues as readonly string[]).includes(v);
}

// ── Interview.stage ────────────────────────────────────────────────
// Suggested standard rounds. Recruiters can still type any custom string,
// but new code should prefer one of these. Future migration could enforce.
export const InterviewStageValues = [
  "Screening",
  "Round 1",
  "Round 2",
  "Round 3",
  "Tech Round",
  "HR Discussion",
  "Management Round",
  "Final",
  "Test",
] as const;
export type InterviewStage = typeof InterviewStageValues[number];
