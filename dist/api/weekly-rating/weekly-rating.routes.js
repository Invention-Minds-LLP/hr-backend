"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const weekly_rating_controller_1 = require("./weekly-rating.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
// Questions
router.get("/questions", authMiddleware_1.authenticateToken, weekly_rating_controller_1.getQuestions);
router.get("/questions/employee/:employeeId", authMiddleware_1.authenticateToken, weekly_rating_controller_1.getQuestionsForEmployee);
router.post("/questions", authMiddleware_1.authenticateToken, weekly_rating_controller_1.createQuestion);
router.patch("/questions/:id/toggle", authMiddleware_1.authenticateToken, weekly_rating_controller_1.toggleQuestion);
router.post("/questions/seed", authMiddleware_1.authenticateToken, weekly_rating_controller_1.seedDefaultQuestions);
// Ratings
router.get("/team", authMiddleware_1.authenticateToken, weekly_rating_controller_1.getTeamForRating);
router.get("/my", authMiddleware_1.authenticateToken, weekly_rating_controller_1.getMyRatings);
router.post("/rate", authMiddleware_1.authenticateToken, weekly_rating_controller_1.submitRating);
router.get("/all", authMiddleware_1.authenticateToken, weekly_rating_controller_1.getAllRatings);
// Self-rating (employee fills own)
router.get("/self/week", authMiddleware_1.authenticateToken, weekly_rating_controller_1.getMySelfRatingForWeek);
router.get("/self", authMiddleware_1.authenticateToken, weekly_rating_controller_1.getMySelfRatings);
// Management comparison view
router.get("/comparison/:employeeId", authMiddleware_1.authenticateToken, weekly_rating_controller_1.getComparison);
router.get("/:id", authMiddleware_1.authenticateToken, weekly_rating_controller_1.getRatingDetail);
router.delete("/:id", authMiddleware_1.authenticateToken, weekly_rating_controller_1.deleteRating);
exports.default = router;
