"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const test_attempt_controller_1 = require("./test-attempt.controller");
const router = (0, express_1.Router)();
router.get('/:id', test_attempt_controller_1.getAssignedTest);
router.post('/submit', test_attempt_controller_1.submitAttempt);
router.get('/employee/:employeeId', test_attempt_controller_1.getAssignedTestsForEmployee);
router.get('/', test_attempt_controller_1.getAllAttempts); // /api/evaluation-attempts
router.post('/:id/start', test_attempt_controller_1.startAssignedTestAttempt);
exports.default = router;
