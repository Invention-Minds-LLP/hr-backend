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
  createExitInterview
} from './resignation.controller'

const router = Router();

// Create + list + view
router.post('/', createResignation);
router.get("/exit-interview", listExitInterviews);                 
router.get('/', listResignations);
router.get('/:id', getResignationById);

// Actions
router.post('/:id/withdraw', withdrawResignation);

router.post('/:id/manager-approve', managerApprove);
router.post('/:id/manager-reject', managerReject);

router.post('/:id/hr-approve', hrApprove);
router.post('/:id/hr-reject', hrReject);
router.post('/:id/cancel', hrCancel);
router.put('/:id/hr-hold', hrHold);


router.post('/:id/handover-tasks', addHandoverTasks);
router.patch('/:id/handover-tasks/:taskId', updateTask);

router.post('/:id/clearance', upsertClearance);
router.post('/:id/exit-interview', scheduleExitInterview);
router.post("/exit-interview", createExitInterview);   // submit responses
router.get("/exit-interview/:id", getExitInterview);                // get one
            // list all


router.post('/:id/final-settlement', setFinalSettlement);

router.post('/:id/complete', markCompleted);
router.post('/:id/clearance-certificate', generateClearanceCertificate);

export default router;
