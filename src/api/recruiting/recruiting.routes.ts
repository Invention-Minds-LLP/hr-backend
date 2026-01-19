// recruiting.routes.ts
import { Router } from 'express';
import { getSummary, listEmployeeInterviews, listInterviews, RecruitingController, saveHrReview, upsertFeedback } from './recruiting.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const rc = new RecruitingController();
export const recruitingRouter = Router();

// Jobs
recruitingRouter.post('/jobs',authenticateToken, rc.createJob);
recruitingRouter.get('/jobs', rc.listJobs);
recruitingRouter.patch('/jobs/:id/status', authenticateToken,rc.changeJobStatus);

// Candidates & Applications
recruitingRouter.post('/candidates',authenticateToken, rc.createCandidate);
recruitingRouter.post('/applications',rc.createApplication);
recruitingRouter.get('/applications',authenticateToken, rc.listApplications);
recruitingRouter.patch('/applications/:id/status',authenticateToken, rc.moveApplication);

// Interviews
recruitingRouter.post('/applications/:id/interviews',authenticateToken, rc.scheduleInterview);
recruitingRouter.patch('/interviews/:id/feedback',authenticateToken, rc.recordInterviewFeedback);

// Offers
recruitingRouter.post('/applications/:id/offer',authenticateToken, rc.createOffer);
recruitingRouter.post('/offers/:id/send',authenticateToken, rc.sendOffer);
recruitingRouter.post('/offers/:id/view',authenticateToken, rc.markOfferViewed);
recruitingRouter.post('/offers/:id/sign',authenticateToken, rc.markOfferSigned);
recruitingRouter.post('/offers/:id/decline',authenticateToken, rc.declineOffer);
recruitingRouter.post('/offers/:id/withdraw', authenticateToken,rc.withdrawOffer);
recruitingRouter.post('/offers/:id/expire',authenticateToken, rc.expireOffer);
recruitingRouter.patch('/offers/:id/schedule-join',authenticateToken, rc.scheduleJoin);
recruitingRouter.post('/offers/:id/mark-joined', authenticateToken,rc.markJoined);
recruitingRouter.post('/offers/:id/mark-no-show',authenticateToken, rc.markNoShow);

// Pipeline stats
recruitingRouter.get('/pipeline-stats',authenticateToken, rc.pipelineStats);

recruitingRouter.get('/tests',authenticateToken, rc.listPublishedTests);

recruitingRouter.post('/applications/:id/tests/assign',authenticateToken, rc.assignTestToApplication);
recruitingRouter.get('/applications/:id/tests',authenticateToken, rc.listApplicationTests);
recruitingRouter.post('/applications/:id/tests/:aid/start',authenticateToken, rc.startCandidateTest);
recruitingRouter.get('/applications/:id/summary',authenticateToken, rc.getApplicationSummary);
recruitingRouter.get('/candidate/:candidateId/tests',authenticateToken, rc.getCandidateAssignedTests);     // <-- GET candidate's assigned tests
recruitingRouter.get('/candidate/tests/:assignedId',authenticateToken, rc.getAssignedTestDetail); 

recruitingRouter.post('/candidate/tests/:assignedId/submit',authenticateToken, rc.submitCandidateAssignedTest);
recruitingRouter.post('/applications/:id/tests/:aid/review',authenticateToken, rc.reviewCandidateTest);
recruitingRouter.get('/tests/review-queue',authenticateToken, rc.getTestReviewQueue);

recruitingRouter.get('/interview/:id/summary',authenticateToken, getSummary);
recruitingRouter.post('/interview/:id/feedback',authenticateToken, upsertFeedback);
recruitingRouter.post('/interview/:id/hr-review',authenticateToken, saveHrReview);
recruitingRouter.get('/interview',authenticateToken, listInterviews);
recruitingRouter.get('/panel/:employeeId',authenticateToken, listEmployeeInterviews);



// Export default for easy mounting
export default recruitingRouter;
