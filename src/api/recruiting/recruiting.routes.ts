// recruiting.routes.ts
import { Router } from 'express';
import { getSummary, listInterviews, RecruitingController, saveHrReview, upsertFeedback } from './recruiting.controller';

const rc = new RecruitingController();
export const recruitingRouter = Router();

// Jobs
recruitingRouter.post('/jobs', rc.createJob);
recruitingRouter.get('/jobs', rc.listJobs);
recruitingRouter.patch('/jobs/:id/status', rc.changeJobStatus);

// Candidates & Applications
recruitingRouter.post('/candidates', rc.createCandidate);
recruitingRouter.post('/applications', rc.createApplication);
recruitingRouter.get('/applications', rc.listApplications);
recruitingRouter.patch('/applications/:id/status', rc.moveApplication);

// Interviews
recruitingRouter.post('/applications/:id/interviews', rc.scheduleInterview);
recruitingRouter.patch('/interviews/:id/feedback', rc.recordInterviewFeedback);

// Offers
recruitingRouter.post('/applications/:id/offer', rc.createOffer);
recruitingRouter.post('/offers/:id/send', rc.sendOffer);
recruitingRouter.post('/offers/:id/view', rc.markOfferViewed);
recruitingRouter.post('/offers/:id/sign', rc.markOfferSigned);
recruitingRouter.post('/offers/:id/decline', rc.declineOffer);
recruitingRouter.post('/offers/:id/withdraw', rc.withdrawOffer);
recruitingRouter.post('/offers/:id/expire', rc.expireOffer);
recruitingRouter.patch('/offers/:id/schedule-join', rc.scheduleJoin);
recruitingRouter.post('/offers/:id/mark-joined', rc.markJoined);
recruitingRouter.post('/offers/:id/mark-no-show', rc.markNoShow);

// Pipeline stats
recruitingRouter.get('/pipeline-stats', rc.pipelineStats);

recruitingRouter.get('/tests', rc.listPublishedTests);

recruitingRouter.post('/applications/:id/tests/assign', rc.assignTestToApplication);
recruitingRouter.get('/applications/:id/tests', rc.listApplicationTests);
recruitingRouter.post('/applications/:id/tests/:aid/start', rc.startCandidateTest);
recruitingRouter.get('/applications/:id/summary', rc.getApplicationSummary);
recruitingRouter.get('/candidate/:candidateId/tests', rc.getCandidateAssignedTests);     // <-- GET candidate's assigned tests
recruitingRouter.get('/candidate/tests/:assignedId', rc.getAssignedTestDetail); 

recruitingRouter.post('/candidate/tests/:assignedId/submit', rc.submitCandidateAssignedTest);
recruitingRouter.post('/applications/:id/tests/:aid/review', rc.reviewCandidateTest);
recruitingRouter.get('/tests/review-queue', rc.getTestReviewQueue);

recruitingRouter.get('/interview/:id/summary', getSummary);
recruitingRouter.post('/interview/:id/feedback', upsertFeedback);
recruitingRouter.post('/interview/:id/hr-review', saveHrReview);
recruitingRouter.get('/interview', listInterviews);



// Export default for easy mounting
export default recruitingRouter;
