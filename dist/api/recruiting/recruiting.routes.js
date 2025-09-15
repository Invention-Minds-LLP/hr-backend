"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recruitingRouter = void 0;
// recruiting.routes.ts
const express_1 = require("express");
const recruiting_controller_1 = require("./recruiting.controller");
const rc = new recruiting_controller_1.RecruitingController();
exports.recruitingRouter = (0, express_1.Router)();
// Jobs
exports.recruitingRouter.post('/jobs', rc.createJob);
exports.recruitingRouter.get('/jobs', rc.listJobs);
exports.recruitingRouter.patch('/jobs/:id/status', rc.changeJobStatus);
// Candidates & Applications
exports.recruitingRouter.post('/candidates', rc.createCandidate);
exports.recruitingRouter.post('/applications', rc.createApplication);
exports.recruitingRouter.get('/applications', rc.listApplications);
exports.recruitingRouter.patch('/applications/:id/status', rc.moveApplication);
// Interviews
exports.recruitingRouter.post('/applications/:id/interviews', rc.scheduleInterview);
exports.recruitingRouter.patch('/interviews/:id/feedback', rc.recordInterviewFeedback);
// Offers
exports.recruitingRouter.post('/applications/:id/offer', rc.createOffer);
exports.recruitingRouter.post('/offers/:id/send', rc.sendOffer);
exports.recruitingRouter.post('/offers/:id/view', rc.markOfferViewed);
exports.recruitingRouter.post('/offers/:id/sign', rc.markOfferSigned);
exports.recruitingRouter.post('/offers/:id/decline', rc.declineOffer);
exports.recruitingRouter.post('/offers/:id/withdraw', rc.withdrawOffer);
exports.recruitingRouter.post('/offers/:id/expire', rc.expireOffer);
exports.recruitingRouter.patch('/offers/:id/schedule-join', rc.scheduleJoin);
exports.recruitingRouter.post('/offers/:id/mark-joined', rc.markJoined);
exports.recruitingRouter.post('/offers/:id/mark-no-show', rc.markNoShow);
// Pipeline stats
exports.recruitingRouter.get('/pipeline-stats', rc.pipelineStats);
exports.recruitingRouter.get('/tests', rc.listPublishedTests);
exports.recruitingRouter.post('/applications/:id/tests/assign', rc.assignTestToApplication);
exports.recruitingRouter.get('/applications/:id/tests', rc.listApplicationTests);
exports.recruitingRouter.post('/applications/:id/tests/:aid/start', rc.startCandidateTest);
exports.recruitingRouter.get('/applications/:id/summary', rc.getApplicationSummary);
exports.recruitingRouter.get('/candidate/:candidateId/tests', rc.getCandidateAssignedTests); // <-- GET candidate's assigned tests
exports.recruitingRouter.get('/candidate/tests/:assignedId', rc.getAssignedTestDetail);
exports.recruitingRouter.post('/candidate/tests/:assignedId/submit', rc.submitCandidateAssignedTest);
exports.recruitingRouter.post('/applications/:id/tests/:aid/review', rc.reviewCandidateTest);
exports.recruitingRouter.get('/tests/review-queue', rc.getTestReviewQueue);
exports.recruitingRouter.get('/interview/:id/summary', recruiting_controller_1.getSummary);
exports.recruitingRouter.post('/interview/:id/feedback', recruiting_controller_1.upsertFeedback);
exports.recruitingRouter.post('/interview/:id/hr-review', recruiting_controller_1.saveHrReview);
exports.recruitingRouter.get('/interview', recruiting_controller_1.listInterviews);
// Export default for easy mounting
exports.default = exports.recruitingRouter;
