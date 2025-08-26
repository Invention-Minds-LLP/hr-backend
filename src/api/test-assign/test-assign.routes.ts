import { Router } from 'express';
import { assignTestToEmployees, getAssignedTestOverview, getAssignedTests } from './test-assign.controller';

const router = Router();

router.post('/', assignTestToEmployees);
router.get('/', getAssignedTests);
router.get('/:id/overview', getAssignedTestOverview);


export default router;
