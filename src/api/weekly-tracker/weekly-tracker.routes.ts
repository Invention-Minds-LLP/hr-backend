import { Router } from "express";
import {
  createWeeklyReport,
  getWeeklyReports,
  getWeeklyReportById,
  updateWeeklyReport,
  submitWeeklyReport,
  updateWeeklyReportStatus,
  deleteWeeklyReport,
  addTaskEntry,
  updateTaskEntry,
  deleteTaskEntry,
  carryForwardTasks,
  getTrackerDashboard,
} from "./weekly-tracker.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/", authenticateToken, createWeeklyReport);
router.get("/", authenticateToken, getWeeklyReports);
router.get("/dashboard", authenticateToken, getTrackerDashboard);
router.get("/:id", authenticateToken, getWeeklyReportById);
router.put("/:id", authenticateToken, updateWeeklyReport);
router.patch("/:id/submit", authenticateToken, submitWeeklyReport);
router.patch("/:id/status", authenticateToken, updateWeeklyReportStatus);
router.delete("/:id", authenticateToken, deleteWeeklyReport);

router.post("/:id/tasks", authenticateToken, addTaskEntry);
router.post("/:id/carry-forward", authenticateToken, carryForwardTasks);
router.put("/tasks/:taskId", authenticateToken, updateTaskEntry);
router.delete("/tasks/:taskId", authenticateToken, deleteTaskEntry);

export default router;
