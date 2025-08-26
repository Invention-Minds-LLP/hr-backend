import { Router } from 'express';
import { bulkCreateAppraisals, getAllAppraisalsWithManagerReview, saveManagerReview } from './appraisal.controller';


const router = Router();

router.post('/bulk-create', bulkCreateAppraisals);
router.get("/", getAllAppraisalsWithManagerReview);
router.post('/manager-review', saveManagerReview);


export default router;
