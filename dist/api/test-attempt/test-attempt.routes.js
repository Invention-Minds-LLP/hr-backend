"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const test_attempt_controller_1 = require("./test-attempt.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
router.get('/:id', authMiddleware_1.authenticateToken, test_attempt_controller_1.getAssignedTest);
router.post('/submit', authMiddleware_1.authenticateToken, test_attempt_controller_1.submitAttempt);
router.post('/submit-files', authMiddleware_1.authenticateToken, test_attempt_controller_1.submitAttemptDescriptive);
router.post('/evaluate', authMiddleware_1.authenticateToken, test_attempt_controller_1.evaluateAttempt);
router.get('/employee/:employeeId', authMiddleware_1.authenticateToken, test_attempt_controller_1.getAssignedTestsForEmployee);
router.get('/', authMiddleware_1.authenticateToken, test_attempt_controller_1.getAllAttempts); // /api/evaluation-attempts
router.post('/:id/start', authMiddleware_1.authenticateToken, test_attempt_controller_1.startAssignedTestAttempt);
exports.default = router;
