import { Router } from "express";
import {
  createTraining,
  assignTraining,
  getTrainings,
  markTrainingCompleted,
  submitTrainingFeedback,
  getTrainingFeedbackSummary,
  updateTraining,
} from "./training.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

// Create training
router.post("/", authenticateToken, createTraining);

// Assign employees to a training
router.post("/assign", authenticateToken, assignTraining);

// Get all trainings or employee-specific
router.get("/", authenticateToken, getTrainings);

// Mark completion
router.put("/complete", authenticateToken, markTrainingCompleted);

// Submit feedback (employee)
router.post("/feedback", authenticateToken, submitTrainingFeedback);

// View feedback summary (HR/Admin)
router.get("/feedback/summary/:trainingId", authenticateToken, getTrainingFeedbackSummary);

router.put("/:id", authenticateToken, updateTraining);


export default router;
