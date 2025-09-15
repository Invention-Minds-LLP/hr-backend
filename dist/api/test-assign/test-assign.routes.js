"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const test_assign_controller_1 = require("./test-assign.controller");
const router = (0, express_1.Router)();
router.post('/', test_assign_controller_1.assignTestToEmployees);
router.get('/', test_assign_controller_1.getAssignedTests);
router.get('/:id/overview', test_assign_controller_1.getAssignedTestOverview);
exports.default = router;
