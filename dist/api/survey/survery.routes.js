"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const survery_controller_1 = require("./survery.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
// employee fills survey
router.get("/questions", authMiddleware_1.authenticateToken, survery_controller_1.getSurveyQuestions);
router.post("/submit", authMiddleware_1.authenticateToken, survery_controller_1.submitSurvey);
// fetch responses
router.get("/results/:surveyId", authMiddleware_1.authenticateToken, survery_controller_1.getSurveyResults);
// admin fetch all
router.get("/all", authMiddleware_1.authenticateToken, survery_controller_1.getAllSurveys);
router.get("/drafts", authMiddleware_1.authenticateToken, survery_controller_1.getDraftSurveys);
// HR analytics dashboard. Restricted to HR roles or anyone in the HR dept (deptId = 1).
const hrOnly = (0, authMiddleware_1.requireRoleOrDept)(["HR_MANAGER", "ADMIN"], [1]);
router.get("/analytics/summary", authMiddleware_1.authenticateToken, hrOnly, survery_controller_1.getAnalyticsSummary);
router.get("/analytics/by-section", authMiddleware_1.authenticateToken, hrOnly, survery_controller_1.getAnalyticsBySection);
router.get("/analytics/by-question", authMiddleware_1.authenticateToken, hrOnly, survery_controller_1.getAnalyticsByQuestion);
router.get("/analytics/by-department", authMiddleware_1.authenticateToken, hrOnly, survery_controller_1.getAnalyticsByDepartment);
router.get("/analytics/question/:questionId", authMiddleware_1.authenticateToken, hrOnly, survery_controller_1.getAnalyticsQuestionDrilldown);
router.get("/analytics/at-risk", authMiddleware_1.authenticateToken, hrOnly, survery_controller_1.getAnalyticsAtRisk);
router.get("/analytics/demographics", authMiddleware_1.authenticateToken, hrOnly, survery_controller_1.getAnalyticsDemographics);
router.get("/analytics/scatter", authMiddleware_1.authenticateToken, hrOnly, survery_controller_1.getAnalyticsScatter);
router.get("/analytics/pending", authMiddleware_1.authenticateToken, hrOnly, survery_controller_1.getAnalyticsPending);
router.post("/analytics/pending/remind", authMiddleware_1.authenticateToken, hrOnly, survery_controller_1.sendPendingReminders);
exports.default = router;
