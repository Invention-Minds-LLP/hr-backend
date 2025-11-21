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
// Get all trainings or employee-specific
router.get("/", authMiddleware_1.authenticateToken, training_controller_1.getTrainings);
// Mark completion
router.put("/complete", authMiddleware_1.authenticateToken, training_controller_1.markTrainingCompleted);
// Submit feedback (employee)
router.post("/feedback", authMiddleware_1.authenticateToken, training_controller_1.submitTrainingFeedback);
// View feedback summary (HR/Admin)
router.get("/feedback/summary/:trainingId", authMiddleware_1.authenticateToken, training_controller_1.getTrainingFeedbackSummary);
router.put("/:id", authMiddleware_1.authenticateToken, training_controller_1.updateTraining);
exports.default = router;
