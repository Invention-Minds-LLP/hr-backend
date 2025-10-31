import { Router } from 'express';
import * as ctrl from './internship.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

router.post('/',authenticateToken, ctrl.createInternship);
router.get('/',authenticateToken, ctrl.listInternships);
router.get('/:id',authenticateToken, ctrl.getInternship);
router.patch('/:id',authenticateToken, ctrl.updateInternship);

// Workflow actions
router.post('/:id/offer',authenticateToken, ctrl.offerInternship);
router.post('/:id/activate',authenticateToken, ctrl.activateInternship);
router.post('/:id/extend',authenticateToken, ctrl.extendInternship);
router.post('/:id/complete',authenticateToken, ctrl.completeInternship);
router.post('/:id/drop',authenticateToken, ctrl.dropInternship);
router.post('/:id/convert',authenticateToken, ctrl.convertInternship);

export default router;
