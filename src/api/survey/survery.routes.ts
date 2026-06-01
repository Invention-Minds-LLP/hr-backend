import { Router } from "express";
import {
  getSurveyQuestions,
  submitSurvey,
  getSurveyResults,
  getAllSurveys,
  getDraftSurveys,
  getAnalyticsSummary,
  getAnalyticsBySection,
  getAnalyticsByQuestion,
  getAnalyticsByDepartment,
  getAnalyticsQuestionDrilldown,
  getAnalyticsAtRisk,
  getAnalyticsDemographics,
  getAnalyticsScatter,
  getAnalyticsPending,
  sendPendingReminders,
} from "./survery.controller";
import { authenticateToken, requireRoleOrDept } from "../../middleware/authMiddleware";

const router = Router();

// employee fills survey
router.get("/questions",authenticateToken, getSurveyQuestions);
router.post("/submit",authenticateToken, submitSurvey);

// fetch responses
router.get("/results/:surveyId",authenticateToken, getSurveyResults);

// admin fetch all
router.get("/all",authenticateToken, getAllSurveys);
router.get("/drafts", authenticateToken, getDraftSurveys);

// HR analytics dashboard. Restricted to HR roles or anyone in the HR dept (deptId = 1).
const hrOnly = requireRoleOrDept(["HR_MANAGER", "ADMIN"], [1]);
router.get("/analytics/summary", authenticateToken, hrOnly, getAnalyticsSummary);
router.get("/analytics/by-section", authenticateToken, hrOnly, getAnalyticsBySection);
router.get("/analytics/by-question", authenticateToken, hrOnly, getAnalyticsByQuestion);
router.get("/analytics/by-department", authenticateToken, hrOnly, getAnalyticsByDepartment);
router.get("/analytics/question/:questionId", authenticateToken, hrOnly, getAnalyticsQuestionDrilldown);
router.get("/analytics/at-risk", authenticateToken, hrOnly, getAnalyticsAtRisk);
router.get("/analytics/demographics", authenticateToken, hrOnly, getAnalyticsDemographics);
router.get("/analytics/scatter", authenticateToken, hrOnly, getAnalyticsScatter);
router.get("/analytics/pending", authenticateToken, hrOnly, getAnalyticsPending);
router.post("/analytics/pending/remind", authenticateToken, hrOnly, sendPendingReminders);

export default router;
