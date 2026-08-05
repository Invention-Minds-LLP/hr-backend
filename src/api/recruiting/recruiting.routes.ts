// recruiting.routes.ts
import { Router } from 'express';
import {
  getSummary, listEmployeeInterviews, listInterviews, RecruitingController,
  saveHrReview, upsertFeedback,
  recordConsent,
  listReferences, addReference, updateReference, deleteReference, recordReferenceCheck,
  initiateBgv, getBgv, updateBgvCheck, uploadBgvCheckEvidence, resolveBgvDiscrepancy, completeBgv, uploadBgvReport,
  addBgvDocument, listBgvDocuments, deleteBgvDocument,
  updateReferralBonus,
} from './recruiting.controller';
import { authenticateToken, requireRoleOrDept } from '../../middleware/authMiddleware';

const rc = new RecruitingController();
export const recruitingRouter = Router();

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
const RECRUITER_ROLES: (string | number)[] =
  ['HR_MANAGER', 'ADMIN', 'RECRUITER', 'MANAGEMENT', 1, 4];
const RECRUITER_DEPTS: number[] = [1];          // HR department
const recruiter = [authenticateToken, requireRoleOrDept(RECRUITER_ROLES, RECRUITER_DEPTS)];

// Jobs (recruiter only for create/update; list is public so candidates can browse)
recruitingRouter.post('/jobs', ...recruiter, rc.createJob);
recruitingRouter.get('/jobs', rc.listJobs);
recruitingRouter.patch('/jobs/:id/status', ...recruiter, rc.changeJobStatus);

// Candidates & Applications
recruitingRouter.post('/candidates', ...recruiter, rc.createCandidate);
recruitingRouter.post('/applications', rc.createApplication); // public submission form
recruitingRouter.get('/applications', ...recruiter, rc.listApplications);
recruitingRouter.patch('/applications/:id/status', ...recruiter, rc.moveApplication);
recruitingRouter.get('/applications/:id/audit-log', ...recruiter, rc.getApplicationAuditLog);

// Interviews (recruiter manages, panel members can record their feedback)
recruitingRouter.post('/applications/:id/interviews', ...recruiter, rc.scheduleInterview);
recruitingRouter.post('/applications/:id/interviews/multi-session', ...recruiter, rc.scheduleMultiSessionRound);
recruitingRouter.get('/panel-availability', ...recruiter, rc.panelAvailability);
recruitingRouter.patch('/interviews/:id/reschedule', ...recruiter, rc.rescheduleInterview);
recruitingRouter.post('/interviews/:id/split-member', ...recruiter, rc.splitPanelMember);
recruitingRouter.post('/interviews/:id/cancel', ...recruiter, rc.cancelInterview);
// Panel member acknowledges availability / declines — panellist auth only (checked inside)
recruitingRouter.post('/interviews/:id/panel-ack', authenticateToken, rc.panelAck);
recruitingRouter.patch('/interviews/:id/feedback', authenticateToken, rc.recordInterviewFeedback);

// Offers — all recruiter actions
recruitingRouter.post('/applications/:id/offer', ...recruiter, rc.createOffer);
recruitingRouter.post('/offers/:id/send',     ...recruiter, rc.sendOffer);
// Offer letter PDF preview / download. `?download=1` forces an attachment.
// Candidates can also fetch their own letter via the same endpoint
// (authenticated, but not role-gated — same pattern as /offers/:id/view).
recruitingRouter.get('/offers/:id/pdf',       authenticateToken, rc.downloadOfferLetterPdf);
recruitingRouter.post('/offers/:id/preview',  ...recruiter, rc.previewOfferLetterPdf); // render PDF from unsaved values
recruitingRouter.post('/offers/:id/view',     authenticateToken, rc.markOfferViewed); // candidate
recruitingRouter.post('/offers/:id/sign',     authenticateToken, rc.markOfferSigned); // candidate
recruitingRouter.post('/offers/:id/decline',  authenticateToken, rc.declineOffer);    // candidate
recruitingRouter.post('/offers/:id/withdraw', ...recruiter, rc.withdrawOffer);
recruitingRouter.post('/offers/:id/expire',   ...recruiter, rc.expireOffer);
recruitingRouter.post('/offers/:id/revise',   ...recruiter, rc.reviseOffer);   // re-open declined/expired offer
recruitingRouter.patch('/offers/:id/schedule-join', ...recruiter, rc.scheduleJoin);
recruitingRouter.post('/offers/:id/mark-joined',   ...recruiter, rc.markJoined);
recruitingRouter.post('/offers/:id/mark-no-show',  ...recruiter, rc.markNoShow);

// Pipeline stats
recruitingRouter.get('/pipeline-stats', ...recruiter, rc.pipelineStats);
// Recruiter dashboard — funnel, time-to-hire, source effectiveness, panel load
recruitingRouter.get('/recruiter-dashboard', ...recruiter, rc.getRecruiterDashboard);
recruitingRouter.get('/recruiter-insights',  ...recruiter, rc.getRecruiterInsights);

recruitingRouter.get('/tests', ...recruiter, rc.listPublishedTests);

// Test assignment & review (recruiter only)
recruitingRouter.post('/applications/:id/tests/assign', ...recruiter, rc.assignTestToApplication);
recruitingRouter.get('/applications/:id/tests', ...recruiter, rc.listApplicationTests);
recruitingRouter.post('/applications/:id/tests/:aid/start', authenticateToken, rc.startCandidateTest); // candidate clicks Start
recruitingRouter.get('/applications/:id/summary', ...recruiter, rc.getApplicationSummary);

// Candidate-facing test endpoints (logged-in candidate, not employee role-checked)
recruitingRouter.get('/candidate/:candidateId/offers', authenticateToken, rc.getCandidateOffers);
recruitingRouter.get('/candidate/:candidateId/tests', authenticateToken, rc.getCandidateAssignedTests);
recruitingRouter.get('/candidate/tests/:assignedId',  authenticateToken, rc.getAssignedTestDetail);
recruitingRouter.post('/candidate/tests/:assignedId/submit', authenticateToken, rc.submitCandidateAssignedTest);

// Test review (recruiter)
recruitingRouter.post('/applications/:id/tests/:aid/review', ...recruiter, rc.reviewCandidateTest);
recruitingRouter.get('/tests/review-queue', ...recruiter, rc.getTestReviewQueue);

// Interview detail / feedback / list (panelist + recruiter)
recruitingRouter.get('/interview/:id/summary', authenticateToken, getSummary);
recruitingRouter.post('/interview/:id/feedback', authenticateToken, upsertFeedback); // panelist authorized inside
recruitingRouter.post('/interview/:id/hr-review', ...recruiter, saveHrReview);
recruitingRouter.get('/interview', ...recruiter, listInterviews);
recruitingRouter.get('/panel/:employeeId', authenticateToken, listEmployeeInterviews); // panelist sees their own

// ─── Consent (DPDP Act) ────────────────────────────────────────────
// Candidate records their own consent → authenticateToken is enough.
recruitingRouter.post('/applications/:id/consent', authenticateToken, recordConsent);

// ─── Reference checks ──────────────────────────────────────────────
recruitingRouter.get   ('/applications/:id/references', ...recruiter, listReferences);
recruitingRouter.post  ('/applications/:id/references', ...recruiter, addReference);
recruitingRouter.patch ('/references/:id',              ...recruiter, updateReference);
recruitingRouter.delete('/references/:id',              ...recruiter, deleteReference);
recruitingRouter.post  ('/references/:id/check',        ...recruiter, recordReferenceCheck);

// ─── Background Verification ───────────────────────────────────────
recruitingRouter.post('/applications/:id/bgv',                    ...recruiter, initiateBgv);
recruitingRouter.get ('/applications/:id/bgv',                    ...recruiter, getBgv);
recruitingRouter.patch('/bgv/:bgvId/checks/:checkId',             ...recruiter, updateBgvCheck);
recruitingRouter.post ('/bgv/:bgvId/checks/:checkId/evidence',    ...recruiter, uploadBgvCheckEvidence);
recruitingRouter.post ('/bgv/:bgvId/checks/:checkId/resolve',     ...recruiter, resolveBgvDiscrepancy);
recruitingRouter.post ('/bgv/:id/report',                         ...recruiter, uploadBgvReport);
recruitingRouter.post ('/bgv/:id/complete',                       ...recruiter, completeBgv);
recruitingRouter.get  ('/bgv/:id/documents',                      ...recruiter, listBgvDocuments);
recruitingRouter.post ('/bgv/:id/documents',                      ...recruiter, addBgvDocument);
recruitingRouter.delete('/bgv/documents/:docId',                  ...recruiter, deleteBgvDocument);

// ─── Referral bonus (manual HR action — pay / forfeit / adjust amount) ──
recruitingRouter.post('/applications/:id/referral-bonus', ...recruiter, updateReferralBonus);

// Export default for easy mounting
export default recruitingRouter;
