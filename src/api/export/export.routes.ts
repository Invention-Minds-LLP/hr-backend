import { Router } from 'express';
import { exportTable } from './export.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

router.get('/:table', authenticateToken, exportTable);

export default router;
