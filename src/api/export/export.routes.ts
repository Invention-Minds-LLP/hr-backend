import { Router } from 'express';
import { exportTable } from './export.controller';
import { authenticateToken } from '../../middleware/authMiddleware';
import { requireDownloadGrant } from '../../middleware/requireDownloadGrant';

const router = Router();

router.get('/:table', authenticateToken, requireDownloadGrant, exportTable);

export default router;
