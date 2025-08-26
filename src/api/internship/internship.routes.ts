import { Router } from 'express';
import * as ctrl from './internship.controller';

const router = Router();

router.post('/', ctrl.createInternship);
router.get('/', ctrl.listInternships);
router.get('/:id', ctrl.getInternship);
router.patch('/:id', ctrl.updateInternship);

// Workflow actions
router.post('/:id/offer', ctrl.offerInternship);
router.post('/:id/activate', ctrl.activateInternship);
router.post('/:id/extend', ctrl.extendInternship);
router.post('/:id/complete', ctrl.completeInternship);
router.post('/:id/drop', ctrl.dropInternship);
router.post('/:id/convert', ctrl.convertInternship);

export default router;
