import { Router } from 'express';
import {
  getAllQuestionBanks,
  createQuestionBank,
  updateQuestionBank,
  deleteQuestionBank,
  getQuestionBankById,
} from './question-bank.controller';

const router = Router();

router.get('/', getAllQuestionBanks);
router.post('/', createQuestionBank);
router.get('/:id', getQuestionBankById); 
router.put('/:id', updateQuestionBank);
router.delete('/:id', deleteQuestionBank);

export default router;
