"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const resignation_controller_1 = require("./resignation.controller");
const router = (0, express_1.Router)();
// Create + list + view
router.post('/', resignation_controller_1.createResignation);
router.get("/exit-interview", resignation_controller_1.listExitInterviews);
router.get('/', resignation_controller_1.listResignations);
router.get('/:id', resignation_controller_1.getResignationById);
// Actions
router.post('/:id/withdraw', resignation_controller_1.withdrawResignation);
router.post('/:id/manager-approve', resignation_controller_1.managerApprove);
router.post('/:id/manager-reject', resignation_controller_1.managerReject);
router.post('/:id/hr-approve', resignation_controller_1.hrApprove);
router.post('/:id/hr-reject', resignation_controller_1.hrReject);
router.post('/:id/cancel', resignation_controller_1.hrCancel);
router.put('/:id/hr-hold', resignation_controller_1.hrHold);
router.post('/:id/handover-tasks', resignation_controller_1.addHandoverTasks);
router.patch('/:id/handover-tasks/:taskId', resignation_controller_1.updateTask);
router.post('/:id/clearance', resignation_controller_1.upsertClearance);
router.post('/:id/exit-interview', resignation_controller_1.scheduleExitInterview);
router.post("/exit-interview", resignation_controller_1.createExitInterview); // submit responses
router.get("/exit-interview/:id", resignation_controller_1.getExitInterview); // get one
// list all
router.post('/:id/final-settlement', resignation_controller_1.setFinalSettlement);
router.post('/:id/complete', resignation_controller_1.markCompleted);
router.post('/:id/clearance-certificate', resignation_controller_1.generateClearanceCertificate);
exports.default = router;
