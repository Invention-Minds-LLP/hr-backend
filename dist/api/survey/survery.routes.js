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
exports.default = router;
