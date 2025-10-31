import { Router } from 'express';
import { createQuestion, getQuestionsByBank, deleteQuestion, updateQuestion } from './questions.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

router.get('/bank/:bankId', authenticateToken, getQuestionsByBank);
router.post('/',authenticateToken, createQuestion);
router.put('/:id',authenticateToken, updateQuestion);  
router.delete('/:id',authenticateToken, deleteQuestion);

export default router;
