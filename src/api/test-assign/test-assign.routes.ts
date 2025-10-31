import { Router } from 'express';
import { assignTestToEmployees, getAssignedTestOverview, getAssignedTests } from './test-assign.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

router.post('/',authenticateToken, assignTestToEmployees);
router.get('/',authenticateToken, getAssignedTests);
router.get('/:id/overview',authenticateToken, getAssignedTestOverview);


export default router;
