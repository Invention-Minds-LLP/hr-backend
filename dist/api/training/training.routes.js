"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const training_controller_1 = require("./training.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
// Create training
router.post("/", authMiddleware_1.authenticateToken, training_controller_1.createTraining);
// Assign employees to a training
router.post("/assign", authMiddleware_1.authenticateToken, training_controller_1.assignTraining);
// Returns the list of employees the logged-in user can assign training to
router.get("/assignable-employees", authMiddleware_1.authenticateToken, training_controller_1.getAssignableEmployees);
// Get all trainings or employee-specific
router.get("/", authMiddleware_1.authenticateToken, training_controller_1.getTrainings);
// Mark completion
router.put("/complete", authMiddleware_1.authenticateToken, training_controller_1.markTrainingCompleted);
// Submit feedback (employee)
router.post("/feedback", authMiddleware_1.authenticateToken, training_controller_1.submitTrainingFeedback);
// View feedback summary (HR/Admin)
router.get("/feedback/summary/:trainingId", authMiddleware_1.authenticateToken, training_controller_1.getTrainingFeedbackSummary);
router.put("/:id", authMiddleware_1.authenticateToken, training_controller_1.updateTraining);
router.patch("/:id/status", authMiddleware_1.authenticateToken, training_controller_1.updateTrainingStatus);
// Mark single employee attendance
router.post("/attendance/:trainingId", authMiddleware_1.authenticateToken, training_controller_1.markTrainingAttendance);
// Get attendance list for a training
router.get("/attendance/:trainingId", authMiddleware_1.authenticateToken, training_controller_1.getTrainingAttendance);
// Bulk mark attendance
router.post("/attendance/bulk/:trainingId", authMiddleware_1.authenticateToken, training_controller_1.bulkMarkTrainingAttendance);
exports.default = router;
