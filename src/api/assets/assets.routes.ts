import { Router } from 'express';
import { authenticateToken } from '../../middleware/authMiddleware';
import {
  listAssets, getAsset, upsertAsset, deleteAsset, getMeta,
  allocateAsset, returnAsset, acknowledgeAllocation,
  listMyAssets, listEmployeeAssets, getPendingForExit, getAssetSummary,
} from './assets.controller';

const router = Router();

// Literal paths first so they are not swallowed by /:id.
router.get('/meta',    authenticateToken, getMeta);
router.get('/summary', authenticateToken, getAssetSummary);
router.get('/my',      authenticateToken, listMyAssets);

router.get('/employee/:employeeId', authenticateToken, listEmployeeAssets);
router.get('/exit/:employeeId',     authenticateToken, getPendingForExit);

// Allocation lifecycle
router.post('/allocations/:id/return',       authenticateToken, returnAsset);
router.patch('/allocations/:id/acknowledge', authenticateToken, acknowledgeAllocation);

// Register
router.get('/',           authenticateToken, listAssets);
router.post('/',          authenticateToken, upsertAsset);
router.get('/:id',        authenticateToken, getAsset);
router.patch('/:id',      authenticateToken, upsertAsset);
router.delete('/:id',     authenticateToken, deleteAsset);
router.post('/:id/allocate', authenticateToken, allocateAsset);

export default router;
