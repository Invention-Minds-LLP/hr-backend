import { Router } from 'express';
import {
  getAllEntitlementPolicies,
  getEmployeeRequests,
  getEmployeeUsageSummary,
  getEntitlementPolicyByYear,
} from './entitle.controller';

const router = Router();

router.get('/', getAllEntitlementPolicies);
router.get('/employee-usage-summary', getEmployeeUsageSummary);
router.get('/:id/requests', getEmployeeRequests);
router.get('/:year', getEntitlementPolicyByYear);

export default router;
