"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const survery_controller_1 = require("./survery.controller");
const router = (0, express_1.Router)();
// employee fills survey
router.get("/questions", survery_controller_1.getSurveyQuestions);
router.post("/submit", survery_controller_1.submitSurvey);
// fetch responses
router.get("/results/:surveyId", survery_controller_1.getSurveyResults);
// admin fetch all
router.get("/all", survery_controller_1.getAllSurveys);
exports.default = router;
