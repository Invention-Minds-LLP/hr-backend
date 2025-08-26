import { Router } from 'express';
import { createTest, getAllTests, updateTest } from './evaluation.controller';

const router = Router();

router.post('/', createTest);
router.get('/', getAllTests);
router.put('/:id', updateTest); 

export default router;
