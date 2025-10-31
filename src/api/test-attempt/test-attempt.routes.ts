import { Router } from 'express';
import { evaluateAttempt, getAllAttempts, getAssignedTest, getAssignedTestsForEmployee, startAssignedTestAttempt, submitAttempt, submitAttemptDescriptive } from './test-attempt.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

router.get('/:id',authenticateToken, getAssignedTest);
router.post('/submit',authenticateToken, submitAttempt);
router.post('/submit-files',authenticateToken, submitAttemptDescriptive);
router.post('/evaluate',authenticateToken, evaluateAttempt)
router.get('/employee/:employeeId',authenticateToken, getAssignedTestsForEmployee);
router.get('/',authenticateToken, getAllAttempts); // /api/evaluation-attempts
router.post('/:id/start',authenticateToken, startAssignedTestAttempt);


export default router;
