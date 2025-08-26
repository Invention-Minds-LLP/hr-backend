import { Router } from 'express';
import { getAllAttempts, getAssignedTest, getAssignedTestsForEmployee, startAssignedTestAttempt, submitAttempt } from './test-attempt.controller';

const router = Router();

router.get('/:id', getAssignedTest);
router.post('/submit', submitAttempt);
router.get('/employee/:employeeId', getAssignedTestsForEmployee);
router.get('/', getAllAttempts); // /api/evaluation-attempts
router.post('/:id/start', startAssignedTestAttempt);


export default router;
