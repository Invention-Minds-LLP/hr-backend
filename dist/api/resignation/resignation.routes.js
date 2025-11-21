"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const resignation_controller_1 = require("./resignation.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
// Create + list + view
router.post('/', authMiddleware_1.authenticateToken, resignation_controller_1.createResignation);
router.get("/exit-interview", authMiddleware_1.authenticateToken, resignation_controller_1.listExitInterviews);
router.get('/', authMiddleware_1.authenticateToken, resignation_controller_1.listResignations);
router.get('/with-clearances', authMiddleware_1.authenticateToken, resignation_controller_1.listResignationsWithClearances);
router.get('/:id', authMiddleware_1.authenticateToken, resignation_controller_1.getResignationById);
// Actions
// router.post('/:id/withdraw', withdrawResignation);
router.post('/:id/request-withdraw', authMiddleware_1.authenticateToken, resignation_controller_1.requestWithdraw);
router.post('/:id/hr-withdraw-approve', authMiddleware_1.authenticateToken, resignation_controller_1.hrApproveWithdraw);
router.post('/:id/hr-withdraw-reject', authMiddleware_1.authenticateToken, resignation_controller_1.hrRejectWithdraw);
router.post('/:id/manager-approve', authMiddleware_1.authenticateToken, resignation_controller_1.managerApprove);
router.post('/:id/manager-reject', authMiddleware_1.authenticateToken, resignation_controller_1.managerReject);
router.post('/:id/hr-approve', authMiddleware_1.authenticateToken, resignation_controller_1.hrApprove);
router.post('/:id/hr-reject', authMiddleware_1.authenticateToken, resignation_controller_1.hrReject);
router.post('/:id/cancel', authMiddleware_1.authenticateToken, resignation_controller_1.hrCancel);
router.put('/:id/hr-hold', authMiddleware_1.authenticateToken, resignation_controller_1.hrHold);
router.post('/:id/handover-tasks', authMiddleware_1.authenticateToken, resignation_controller_1.addHandoverTasks);
router.patch('/:id/handover-tasks/:taskId', authMiddleware_1.authenticateToken, resignation_controller_1.updateTask);
router.post('/:id/clearance', authMiddleware_1.authenticateToken, resignation_controller_1.upsertClearance);
router.post('/:id/exit-interview', authMiddleware_1.authenticateToken, resignation_controller_1.scheduleExitInterview);
router.post("/exit-interview", authMiddleware_1.authenticateToken, resignation_controller_1.createExitInterview); // submit responses
router.get("/exit-interview/:id", authMiddleware_1.authenticateToken, resignation_controller_1.getExitInterview); // get one
// list all
router.post('/:id/final-settlement', authMiddleware_1.authenticateToken, resignation_controller_1.setFinalSettlement);
router.post('/:id/complete', authMiddleware_1.authenticateToken, resignation_controller_1.markCompleted);
router.post('/:id/clearance-certificate', authMiddleware_1.authenticateToken, resignation_controller_1.generateClearanceCertificate);
exports.default = router;
