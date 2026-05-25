"use strict";
/**
 * String-enum constants for recruiting fields whose Prisma column is `String`
 * (kept that way for backward compat with existing rows). Always import these
 * instead of typing literal strings to get compile-time safety + a single
 * source of truth.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InterviewStageValues = exports.CandidateTestReviewValues = exports.CandidateTestStatusValues = void 0;
exports.isCandidateTestStatus = isCandidateTestStatus;
// ── CandidateAssignedTest.status ───────────────────────────────────
exports.CandidateTestStatusValues = [
    "NotStarted",
    "InProgress",
    "Completed",
    "Cancelled",
];
function isCandidateTestStatus(v) {
    return typeof v === "string" && exports.CandidateTestStatusValues.includes(v);
}
// ── CandidateAssignedTest.reviewDecision ───────────────────────────
exports.CandidateTestReviewValues = ["PASS", "FAIL"];
// ── Interview.stage ────────────────────────────────────────────────
// Suggested standard rounds. Recruiters can still type any custom string,
// but new code should prefer one of these. Future migration could enforce.
exports.InterviewStageValues = [
    "Screening",
    "Round 1",
    "Round 2",
    "Round 3",
    "Tech Round",
    "HR Discussion",
    "Management Round",
    "Final",
    "Test",
];
