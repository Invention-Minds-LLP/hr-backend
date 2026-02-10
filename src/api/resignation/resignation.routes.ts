import { Router } from 'express';
import {
  createResignation,
  listResignations,
  getResignationById,
  withdrawResignation,
  managerApprove,
  managerReject,
  hrApprove,
  hrReject,
  hrCancel,
  addHandoverTasks,
  updateTask,
  upsertClearance,
  scheduleExitInterview,
  setFinalSettlement,
  markCompleted,
  hrHold,
  generateClearanceCertificate,
  listExitInterviews,
  getExitInterview,
  createExitInterview,
  requestWithdraw,
  hrApproveWithdraw,  
  hrRejectWithdraw,
  listResignationsWithClearances,
  setApplicableDepartments
} from './resignation.controller'
import { authenticateToken } from '../../middleware/authMiddleware';
import { listPendingClearances } from '../dashboard/dashboard.controller';

const router = Router();

// Create + list + view
router.post('/',authenticateToken, createResignation);
router.get("/exit-interview",authenticateToken, listExitInterviews);                 
router.get('/',authenticateToken, listResignations);
router.get('/with-clearances', authenticateToken, listResignationsWithClearances);
router.get('/:id', authenticateToken,getResignationById);

// Actions
// router.post('/:id/withdraw', withdrawResignation);
router.post('/:id/request-withdraw', authenticateToken,requestWithdraw);
router.post('/:id/hr-withdraw-approve',authenticateToken, hrApproveWithdraw);
router.post('/:id/hr-withdraw-reject', authenticateToken,hrRejectWithdraw);


router.post('/:id/manager-approve',authenticateToken, managerApprove);
router.post('/:id/manager-reject', authenticateToken,managerReject);

router.post('/:id/hr-approve',authenticateToken, hrApprove);
router.post('/:id/hr-reject',authenticateToken, hrReject);
router.post('/:id/cancel', authenticateToken,hrCancel);
router.put('/:id/hr-hold',authenticateToken, hrHold);


router.post('/:id/handover-tasks',authenticateToken, addHandoverTasks);
router.patch('/:id/handover-tasks/:taskId',authenticateToken, updateTask);
router.post('/:id/clearance',authenticateToken, upsertClearance);
router.post('/:id/applicable-departments', authenticateToken, setApplicableDepartments)
router.post('/:id/exit-interview',authenticateToken, scheduleExitInterview);
router.post("/exit-interview",authenticateToken, createExitInterview);   // submit responses
router.get("/exit-interview/:id",authenticateToken, getExitInterview);                // get one
            // list all


router.post('/:id/final-settlement',authenticateToken, setFinalSettlement);

router.post('/:id/complete',authenticateToken, markCompleted);
router.post('/:id/clearance-certificate',authenticateToken, generateClearanceCertificate);

export default router;
