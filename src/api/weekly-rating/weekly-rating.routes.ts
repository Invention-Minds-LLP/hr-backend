import { Router } from "express";
import {
  getQuestions, getQuestionsForEmployee, createQuestion, toggleQuestion, seedDefaultQuestions,
  getTeamForRating, submitRating, getRatingDetail, getAllRatings, deleteRating,
} from "./weekly-rating.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

// Questions
router.get("/questions", authenticateToken, getQuestions);
router.get("/questions/employee/:employeeId", authenticateToken, getQuestionsForEmployee);
router.post("/questions", authenticateToken, createQuestion);
router.patch("/questions/:id/toggle", authenticateToken, toggleQuestion);
router.post("/questions/seed", authenticateToken, seedDefaultQuestions);

// Ratings
router.get("/team", authenticateToken, getTeamForRating);
router.post("/rate", authenticateToken, submitRating);
router.get("/all", authenticateToken, getAllRatings);
router.get("/:id", authenticateToken, getRatingDetail);
router.delete("/:id", authenticateToken, deleteRating);

export default router;
