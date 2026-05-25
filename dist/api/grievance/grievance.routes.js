"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const grievance_controller_1 = require("./grievance.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
router.post("/", authMiddleware_1.authenticateToken, grievance_controller_1.createGrievance);
router.get("/", authMiddleware_1.authenticateToken, grievance_controller_1.listGrievances);
router.post("/:id/comment", authMiddleware_1.authenticateToken, grievance_controller_1.addGrievanceComment);
router.patch("/:id/status", authMiddleware_1.authenticateToken, grievance_controller_1.updateGrievanceStatus);
router.post("/acknowledge", grievance_controller_1.createAcknowledgement);
// Get all acknowledgements for an employee
router.get("/acknowledge/:employeeId", grievance_controller_1.getAcknowledgementsByEmployee);
// Check if already acknowledged
router.get("/acknowledge", grievance_controller_1.checkAcknowledgement);
router.get("/get-unacknowledged/:employeeId", grievance_controller_1.getUnacknowledgedComplaints);
// Committee-member acknowledgement progress for a case (Phase 6).
router.get("/:id/committee-acks", authMiddleware_1.authenticateToken, grievance_controller_1.getGrievanceCommitteeAcks);
exports.default = router;
