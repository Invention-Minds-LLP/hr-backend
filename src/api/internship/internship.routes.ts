import { Router } from 'express';
import * as ctrl from './internship.controller';
import * as evalCtrl from './internship.evaluation.controller';
import * as stipendCtrl from './internship.stipend.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

router.post('/',authenticateToken, ctrl.createInternship);
router.get('/',authenticateToken, ctrl.listInternships);
// Must come before '/:id' so "analytics" isn't captured as an id.
router.get('/analytics',authenticateToken, ctrl.getInternshipAnalytics);
router.get('/:id',authenticateToken, ctrl.getInternship);
router.patch('/:id',authenticateToken, ctrl.updateInternship);

// Workflow actions
router.post('/:id/offer',authenticateToken, ctrl.offerInternship);
router.post('/:id/activate',authenticateToken, ctrl.activateInternship);
router.post('/:id/extend',authenticateToken, ctrl.extendInternship);
router.post('/:id/complete',authenticateToken, ctrl.completeInternship);
router.post('/:id/drop',authenticateToken, ctrl.dropInternship);
router.post('/:id/convert',authenticateToken, ctrl.convertInternship);

// Evaluations (periodic mentor/HR performance reviews)
router.get('/:id/evaluations',authenticateToken, evalCtrl.listEvaluations);
router.post('/:id/evaluations',authenticateToken, evalCtrl.createEvaluation);
router.patch('/:id/evaluations/:evalId',authenticateToken, evalCtrl.updateEvaluation);
router.delete('/:id/evaluations/:evalId',authenticateToken, evalCtrl.deleteEvaluation);

// Stipend disbursements (standalone — not tied to payroll)
router.get('/:id/stipends',authenticateToken, stipendCtrl.listStipends);
router.post('/:id/stipends/generate',authenticateToken, stipendCtrl.generateStipendSchedule);
router.post('/:id/stipends',authenticateToken, stipendCtrl.createStipend);
router.patch('/:id/stipends/:stipendId',authenticateToken, stipendCtrl.updateStipend);
router.delete('/:id/stipends/:stipendId',authenticateToken, stipendCtrl.deleteStipend);

export default router;
