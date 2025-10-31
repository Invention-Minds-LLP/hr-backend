import { Router } from 'express';
import {
  getAllEntitlementPolicies,
  getEmployeeRequests,
  getEmployeeUsageSummary,
  getEntitlementPolicyByYear,
} from './entitle.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

router.get('/',authenticateToken, getAllEntitlementPolicies);
router.get('/employee-usage-summary',authenticateToken, getEmployeeUsageSummary);
router.get('/:id/requests',authenticateToken, getEmployeeRequests);
router.get('/:year',authenticateToken, getEntitlementPolicyByYear);

export default router;
