import { Router } from "express";
import {
  getSurveyQuestions,
  submitSurvey,
  getSurveyResults,
  getAllSurveys,
} from "./survery.controller";

const router = Router();

// employee fills survey
router.get("/questions", getSurveyQuestions);
router.post("/submit", submitSurvey);

// fetch responses
router.get("/results/:surveyId", getSurveyResults);

// admin fetch all
router.get("/all", getAllSurveys);

export default router;
