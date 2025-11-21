import { Router } from "express";
import {
  getSurveyQuestions,
  submitSurvey,
  getSurveyResults,
  getAllSurveys,
  getDraftSurveys,
} from "./survery.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

// employee fills survey
router.get("/questions",authenticateToken, getSurveyQuestions);
router.post("/submit",authenticateToken, submitSurvey);

// fetch responses
router.get("/results/:surveyId",authenticateToken, getSurveyResults);

// admin fetch all
router.get("/all",authenticateToken, getAllSurveys);
router.get("/drafts", authenticateToken, getDraftSurveys);

export default router;
