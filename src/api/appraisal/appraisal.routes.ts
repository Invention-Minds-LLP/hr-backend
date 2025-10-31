import { Router } from 'express';
import { bulkCreateAppraisals, getAllAppraisalsWithManagerReview, saveManagerReview } from './appraisal.controller';
import { authenticateToken } from '../../middleware/authMiddleware';


const router = Router();

router.post('/bulk-create',authenticateToken, bulkCreateAppraisals);
router.get("/",authenticateToken, getAllAppraisalsWithManagerReview);
router.post('/manager-review',authenticateToken, saveManagerReview);


export default router;
