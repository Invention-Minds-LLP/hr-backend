import { Router } from 'express';
import { createQuestion, getQuestionsByBank, deleteQuestion, updateQuestion } from './questions.controller';

const router = Router();

router.get('/bank/:bankId', getQuestionsByBank);
router.post('/', createQuestion);
router.put('/:id', updateQuestion);  
router.delete('/:id', deleteQuestion);

export default router;
