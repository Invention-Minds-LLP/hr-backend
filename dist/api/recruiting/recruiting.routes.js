"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recruitingRouter = void 0;
// recruiting.routes.ts
const express_1 = require("express");
const recruiting_controller_1 = require("./recruiting.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const rc = new recruiting_controller_1.RecruitingController();
exports.recruitingRouter = (0, express_1.Router)();
// Jobs
exports.recruitingRouter.post('/jobs', authMiddleware_1.authenticateToken, rc.createJob);
exports.recruitingRouter.get('/jobs', rc.listJobs);
exports.recruitingRouter.patch('/jobs/:id/status', authMiddleware_1.authenticateToken, rc.changeJobStatus);
// Candidates & Applications
exports.recruitingRouter.post('/candidates', authMiddleware_1.authenticateToken, rc.createCandidate);
exports.recruitingRouter.post('/applications', rc.createApplication);
exports.recruitingRouter.get('/applications', authMiddleware_1.authenticateToken, rc.listApplications);
exports.recruitingRouter.patch('/applications/:id/status', authMiddleware_1.authenticateToken, rc.moveApplication);
// Interviews
exports.recruitingRouter.post('/applications/:id/interviews', authMiddleware_1.authenticateToken, rc.scheduleInterview);
exports.recruitingRouter.patch('/interviews/:id/feedback', authMiddleware_1.authenticateToken, rc.recordInterviewFeedback);
// Offers
exports.recruitingRouter.post('/applications/:id/offer', authMiddleware_1.authenticateToken, rc.createOffer);
exports.recruitingRouter.post('/offers/:id/send', authMiddleware_1.authenticateToken, rc.sendOffer);
exports.recruitingRouter.post('/offers/:id/view', authMiddleware_1.authenticateToken, rc.markOfferViewed);
exports.recruitingRouter.post('/offers/:id/sign', authMiddleware_1.authenticateToken, rc.markOfferSigned);
exports.recruitingRouter.post('/offers/:id/decline', authMiddleware_1.authenticateToken, rc.declineOffer);
exports.recruitingRouter.post('/offers/:id/withdraw', authMiddleware_1.authenticateToken, rc.withdrawOffer);
exports.recruitingRouter.post('/offers/:id/expire', authMiddleware_1.authenticateToken, rc.expireOffer);
exports.recruitingRouter.patch('/offers/:id/schedule-join', authMiddleware_1.authenticateToken, rc.scheduleJoin);
exports.recruitingRouter.post('/offers/:id/mark-joined', authMiddleware_1.authenticateToken, rc.markJoined);
exports.recruitingRouter.post('/offers/:id/mark-no-show', authMiddleware_1.authenticateToken, rc.markNoShow);
// Pipeline stats
exports.recruitingRouter.get('/pipeline-stats', authMiddleware_1.authenticateToken, rc.pipelineStats);
exports.recruitingRouter.get('/tests', authMiddleware_1.authenticateToken, rc.listPublishedTests);
exports.recruitingRouter.post('/applications/:id/tests/assign', authMiddleware_1.authenticateToken, rc.assignTestToApplication);
exports.recruitingRouter.get('/applications/:id/tests', authMiddleware_1.authenticateToken, rc.listApplicationTests);
exports.recruitingRouter.post('/applications/:id/tests/:aid/start', authMiddleware_1.authenticateToken, rc.startCandidateTest);
exports.recruitingRouter.get('/applications/:id/summary', authMiddleware_1.authenticateToken, rc.getApplicationSummary);
exports.recruitingRouter.get('/candidate/:candidateId/tests', authMiddleware_1.authenticateToken, rc.getCandidateAssignedTests); // <-- GET candidate's assigned tests
exports.recruitingRouter.get('/candidate/tests/:assignedId', authMiddleware_1.authenticateToken, rc.getAssignedTestDetail);
exports.recruitingRouter.post('/candidate/tests/:assignedId/submit', authMiddleware_1.authenticateToken, rc.submitCandidateAssignedTest);
exports.recruitingRouter.post('/applications/:id/tests/:aid/review', authMiddleware_1.authenticateToken, rc.reviewCandidateTest);
exports.recruitingRouter.get('/tests/review-queue', authMiddleware_1.authenticateToken, rc.getTestReviewQueue);
exports.recruitingRouter.get('/interview/:id/summary', authMiddleware_1.authenticateToken, recruiting_controller_1.getSummary);
exports.recruitingRouter.post('/interview/:id/feedback', authMiddleware_1.authenticateToken, recruiting_controller_1.upsertFeedback);
exports.recruitingRouter.post('/interview/:id/hr-review', authMiddleware_1.authenticateToken, recruiting_controller_1.saveHrReview);
exports.recruitingRouter.get('/interview', authMiddleware_1.authenticateToken, recruiting_controller_1.listInterviews);
exports.recruitingRouter.get('/panel/:employeeId', authMiddleware_1.authenticateToken, recruiting_controller_1.listEmployeeInterviews);
// Export default for easy mounting
exports.default = exports.recruitingRouter;
