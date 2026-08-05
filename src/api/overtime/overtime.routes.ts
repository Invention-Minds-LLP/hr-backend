import { Router } from 'express';
import { authenticateToken } from '../../middleware/authMiddleware';
import {
  createOvertimeRequest,
  listMyOvertimeRequests,
  listPendingForManager,
  decideOvertimeRequest,
  acknowledgeOvertimeTask,
  withdrawOvertimeRequest,
} from './overtimeRequest.controller';

const router = Router();

// Literal paths before '/requests/:id' so they are matched first.
router.get('/requests/my',      authenticateToken, listMyOvertimeRequests);
router.get('/requests/pending', authenticateToken, listPendingForManager);

router.post('/requests',        authenticateToken, createOvertimeRequest);
router.patch('/requests/:id/decide',      authenticateToken, decideOvertimeRequest);
router.patch('/requests/:id/acknowledge', authenticateToken, acknowledgeOvertimeTask);
router.delete('/requests/:id',  authenticateToken, withdrawOvertimeRequest);

export default router;
