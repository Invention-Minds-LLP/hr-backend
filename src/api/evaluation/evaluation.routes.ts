import { Router } from 'express';
import { createTest, getAllTests, updateTest } from './evaluation.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

router.post('/',authenticateToken, createTest);
router.get('/',authenticateToken, getAllTests);
router.put('/:id',authenticateToken, updateTest); 

export default router;
