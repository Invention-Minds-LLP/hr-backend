import { Router } from 'express';
import {
  getAllQuestionBanks,
  createQuestionBank,
  updateQuestionBank,
  deleteQuestionBank,
  getQuestionBankById,
} from './question-bank.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

router.get('/',authenticateToken, getAllQuestionBanks);
router.post('/', authenticateToken,createQuestionBank);
router.get('/:id', authenticateToken,getQuestionBankById); 
router.put('/:id', authenticateToken,updateQuestionBank);
router.delete('/:id',authenticateToken, deleteQuestionBank);

export default router;
