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
