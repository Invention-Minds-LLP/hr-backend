import { Router } from 'express';
import { authenticateToken, requirePermission } from '../../middleware/authMiddleware';
import {
  getCategories,
  listEvaluations,
  getEvaluation,
  listDueEmployees,
  getEmployeeHistory,
  assignManager,
  submitManagerEvaluation,
  submitHrDecision,
  downloadEvaluationPdf,
  generateDueEvaluations,
} from './probation.controller';

const router = Router();
router.use(authenticateToken);

// `admin.probation.view` is the screen gate and is held by reporting managers
// too. Whether a caller sees everyone or only their own assignments — and who
// may take the final decision — is decided per handler against
// `admin.probation.manage`, because the same route serves both audiences.
const canView = requirePermission('admin.probation.view', 'admin.probation.manage');

router.get('/categories', canView, getCategories);
router.get('/due', canView, listDueEmployees);
router.post('/generate', canView, generateDueEvaluations);

router.get('/evaluations', canView, listEvaluations);
router.get('/evaluations/:id', canView, getEvaluation);
router.get('/evaluations/:id/pdf', canView, downloadEvaluationPdf);
router.post('/evaluations/:id/manager-submit', canView, submitManagerEvaluation);
router.post('/evaluations/:id/hr-decision', canView, submitHrDecision);
router.patch('/evaluations/:id/manager', canView, assignManager);

router.get('/employee/:employeeId/history', canView, getEmployeeHistory);

export default router;
