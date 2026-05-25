"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recruitingRouter = void 0;
// recruiting.routes.ts
const express_1 = require("express");
const recruiting_controller_1 = require("./recruiting.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const rc = new recruiting_controller_1.RecruitingController();
exports.recruitingRouter = (0, express_1.Router)();
/*
 * AUTHORIZATION POLICY
 * --------------------
 * Recruiter / HR can manage everything below. We treat any of these JWT roles
 * as "recruiter-capable":
 *   • role name: HR_MANAGER, ADMIN, RECRUITER, MANAGEMENT
 *   • roleId:    1 (HR Manager), 4 (Management) — adjust to your role table
 * PLUS anyone whose `deptId` is in HR (deptId = 1) — every HR-dept employee
 * is treated as recruiter-capable regardless of their role tier.
 *
 * Candidate-facing endpoints (their own tests + status) use `authenticateToken`
 * only — they're authenticated as candidates, not employees.
 *
 * `POST /applications` is intentionally unauthenticated — public job-application form.
 */
const RECRUITER_ROLES = ['HR_MANAGER', 'ADMIN', 'RECRUITER', 'MANAGEMENT', 1, 4];
const RECRUITER_DEPTS = [1]; // HR department
const recruiter = [authMiddleware_1.authenticateToken, (0, authMiddleware_1.requireRoleOrDept)(RECRUITER_ROLES, RECRUITER_DEPTS)];
// Jobs (recruiter only for create/update; list is public so candidates can browse)
exports.recruitingRouter.post('/jobs', ...recruiter, rc.createJob);
exports.recruitingRouter.get('/jobs', rc.listJobs);
exports.recruitingRouter.patch('/jobs/:id/status', ...recruiter, rc.changeJobStatus);
// Candidates & Applications
exports.recruitingRouter.post('/candidates', ...recruiter, rc.createCandidate);
exports.recruitingRouter.post('/applications', rc.createApplication); // public submission form
exports.recruitingRouter.get('/applications', ...recruiter, rc.listApplications);
exports.recruitingRouter.patch('/applications/:id/status', ...recruiter, rc.moveApplication);
exports.recruitingRouter.get('/applications/:id/audit-log', ...recruiter, rc.getApplicationAuditLog);
// Interviews (recruiter manages, panel members can record their feedback)
exports.recruitingRouter.post('/applications/:id/interviews', ...recruiter, rc.scheduleInterview);
exports.recruitingRouter.patch('/interviews/:id/feedback', authMiddleware_1.authenticateToken, rc.recordInterviewFeedback);
// Offers — all recruiter actions
exports.recruitingRouter.post('/applications/:id/offer', ...recruiter, rc.createOffer);
exports.recruitingRouter.post('/offers/:id/send', ...recruiter, rc.sendOffer);
// Offer letter PDF preview / download. `?download=1` forces an attachment.
// Candidates can also fetch their own letter via the same endpoint
// (authenticated, but not role-gated — same pattern as /offers/:id/view).
exports.recruitingRouter.get('/offers/:id/pdf', authMiddleware_1.authenticateToken, rc.downloadOfferLetterPdf);
exports.recruitingRouter.post('/offers/:id/view', authMiddleware_1.authenticateToken, rc.markOfferViewed); // candidate
exports.recruitingRouter.post('/offers/:id/sign', authMiddleware_1.authenticateToken, rc.markOfferSigned); // candidate
exports.recruitingRouter.post('/offers/:id/decline', authMiddleware_1.authenticateToken, rc.declineOffer); // candidate
exports.recruitingRouter.post('/offers/:id/withdraw', ...recruiter, rc.withdrawOffer);
exports.recruitingRouter.post('/offers/:id/expire', ...recruiter, rc.expireOffer);
exports.recruitingRouter.patch('/offers/:id/schedule-join', ...recruiter, rc.scheduleJoin);
exports.recruitingRouter.post('/offers/:id/mark-joined', ...recruiter, rc.markJoined);
exports.recruitingRouter.post('/offers/:id/mark-no-show', ...recruiter, rc.markNoShow);
// Pipeline stats
exports.recruitingRouter.get('/pipeline-stats', ...recruiter, rc.pipelineStats);
// Recruiter dashboard — funnel, time-to-hire, source effectiveness, panel load
exports.recruitingRouter.get('/recruiter-dashboard', ...recruiter, rc.getRecruiterDashboard);
exports.recruitingRouter.get('/recruiter-insights', ...recruiter, rc.getRecruiterInsights);
exports.recruitingRouter.get('/tests', ...recruiter, rc.listPublishedTests);
// Test assignment & review (recruiter only)
exports.recruitingRouter.post('/applications/:id/tests/assign', ...recruiter, rc.assignTestToApplication);
exports.recruitingRouter.get('/applications/:id/tests', ...recruiter, rc.listApplicationTests);
exports.recruitingRouter.post('/applications/:id/tests/:aid/start', authMiddleware_1.authenticateToken, rc.startCandidateTest); // candidate clicks Start
exports.recruitingRouter.get('/applications/:id/summary', ...recruiter, rc.getApplicationSummary);
// Candidate-facing test endpoints (logged-in candidate, not employee role-checked)
exports.recruitingRouter.get('/candidate/:candidateId/tests', authMiddleware_1.authenticateToken, rc.getCandidateAssignedTests);
exports.recruitingRouter.get('/candidate/tests/:assignedId', authMiddleware_1.authenticateToken, rc.getAssignedTestDetail);
exports.recruitingRouter.post('/candidate/tests/:assignedId/submit', authMiddleware_1.authenticateToken, rc.submitCandidateAssignedTest);
// Test review (recruiter)
exports.recruitingRouter.post('/applications/:id/tests/:aid/review', ...recruiter, rc.reviewCandidateTest);
exports.recruitingRouter.get('/tests/review-queue', ...recruiter, rc.getTestReviewQueue);
// Interview detail / feedback / list (panelist + recruiter)
exports.recruitingRouter.get('/interview/:id/summary', authMiddleware_1.authenticateToken, recruiting_controller_1.getSummary);
exports.recruitingRouter.post('/interview/:id/feedback', authMiddleware_1.authenticateToken, recruiting_controller_1.upsertFeedback); // panelist authorized inside
exports.recruitingRouter.post('/interview/:id/hr-review', ...recruiter, recruiting_controller_1.saveHrReview);
exports.recruitingRouter.get('/interview', ...recruiter, recruiting_controller_1.listInterviews);
exports.recruitingRouter.get('/panel/:employeeId', authMiddleware_1.authenticateToken, recruiting_controller_1.listEmployeeInterviews); // panelist sees their own
// ─── Consent (DPDP Act) ────────────────────────────────────────────
// Candidate records their own consent → authenticateToken is enough.
exports.recruitingRouter.post('/applications/:id/consent', authMiddleware_1.authenticateToken, recruiting_controller_1.recordConsent);
// ─── Reference checks ──────────────────────────────────────────────
exports.recruitingRouter.get('/applications/:id/references', ...recruiter, recruiting_controller_1.listReferences);
exports.recruitingRouter.post('/applications/:id/references', ...recruiter, recruiting_controller_1.addReference);
exports.recruitingRouter.patch('/references/:id', ...recruiter, recruiting_controller_1.updateReference);
exports.recruitingRouter.delete('/references/:id', ...recruiter, recruiting_controller_1.deleteReference);
exports.recruitingRouter.post('/references/:id/check', ...recruiter, recruiting_controller_1.recordReferenceCheck);
// ─── Background Verification ───────────────────────────────────────
exports.recruitingRouter.post('/applications/:id/bgv', ...recruiter, recruiting_controller_1.initiateBgv);
exports.recruitingRouter.get('/applications/:id/bgv', ...recruiter, recruiting_controller_1.getBgv);
exports.recruitingRouter.patch('/bgv/:bgvId/checks/:checkId', ...recruiter, recruiting_controller_1.updateBgvCheck);
exports.recruitingRouter.post('/bgv/:bgvId/checks/:checkId/resolve', ...recruiter, recruiting_controller_1.resolveBgvDiscrepancy);
exports.recruitingRouter.post('/bgv/:id/complete', ...recruiter, recruiting_controller_1.completeBgv);
exports.recruitingRouter.get('/bgv/:id/documents', ...recruiter, recruiting_controller_1.listBgvDocuments);
exports.recruitingRouter.post('/bgv/:id/documents', ...recruiter, recruiting_controller_1.addBgvDocument);
exports.recruitingRouter.delete('/bgv/documents/:docId', ...recruiter, recruiting_controller_1.deleteBgvDocument);
// ─── Referral bonus (manual HR action — pay / forfeit / adjust amount) ──
exports.recruitingRouter.post('/applications/:id/referral-bonus', ...recruiter, recruiting_controller_1.updateReferralBonus);
// Export default for easy mounting
exports.default = exports.recruitingRouter;
