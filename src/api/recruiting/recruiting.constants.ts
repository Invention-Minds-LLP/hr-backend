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

// ── InterviewRoundTemplateItem.type / JobInterviewRound.type ───────
// What a configured round actually is. TEST assigns an evaluation test;
// PANEL and MANAGEMENT schedule an interview with panel members.
export const InterviewRoundTypeValues = ["TEST", "PANEL", "MANAGEMENT"] as const;
export type InterviewRoundType = typeof InterviewRoundTypeValues[number];

export function isInterviewRoundType(v: unknown): v is InterviewRoundType {
  return typeof v === "string" && (InterviewRoundTypeValues as readonly string[]).includes(v);
}

/**
 * What a job runs when nobody has configured anything: the order the frontend
 * had hardcoded before rounds were configurable. Jobs created before this
 * feature keep behaving exactly as they did.
 */
export const LEGACY_ROUND_SEQUENCE: { seq: number; type: InterviewRoundType; name: string }[] = [
  { seq: 1, type: "PANEL", name: "Panel" },
  { seq: 2, type: "TEST", name: "Test" },
  { seq: 3, type: "MANAGEMENT", name: "Management" },
];

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
