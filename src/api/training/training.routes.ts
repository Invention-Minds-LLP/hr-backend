import { Router } from "express";
import {
  createTraining,
  assignTraining,
  getTrainings,
  markTrainingCompleted,
  submitTrainingFeedback,
  getTrainingFeedbackSummary,
  updateTraining,
  markTrainingAttendance,
  getTrainingAttendance,
  bulkMarkTrainingAttendance,
  getAssignableEmployees,
  updateTrainingStatus,
} from "./training.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

// Create training
router.post("/", authenticateToken, createTraining);

// Assign employees to a training
router.post("/assign", authenticateToken, assignTraining);

// Returns the list of employees the logged-in user can assign training to
router.get("/assignable-employees", authenticateToken, getAssignableEmployees);

// Get all trainings or employee-specific
router.get("/", authenticateToken, getTrainings);

// Mark completion
router.put("/complete", authenticateToken, markTrainingCompleted);

// Submit feedback (employee)
router.post("/feedback", authenticateToken, submitTrainingFeedback);

// View feedback summary (HR/Admin)
router.get("/feedback/summary/:trainingId", authenticateToken, getTrainingFeedbackSummary);

router.put("/:id", authenticateToken, updateTraining);
router.patch("/:id/status", authenticateToken, updateTrainingStatus);
// Mark single employee attendance
router.post(
  "/attendance/:trainingId",
  authenticateToken,
  markTrainingAttendance
);

// Get attendance list for a training
router.get(
  "/attendance/:trainingId",
  authenticateToken,
  getTrainingAttendance
);

// Bulk mark attendance
router.post(
  "/attendance/bulk/:trainingId",
  authenticateToken,
  bulkMarkTrainingAttendance
);


export default router;
