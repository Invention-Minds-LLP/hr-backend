"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const shift_controller_1 = require("./shift.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
/* Shift Template Routes */
router.post("/templates", authMiddleware_1.authenticateToken, shift_controller_1.createShiftTemplate);
router.get("/templates", authMiddleware_1.authenticateToken, shift_controller_1.getShiftTemplates);
router.get("/templates/:id", authMiddleware_1.authenticateToken, shift_controller_1.getShiftTemplateById);
router.put("/templates/:id", authMiddleware_1.authenticateToken, shift_controller_1.updateShiftTemplate);
router.delete("/templates/:id", authMiddleware_1.authenticateToken, shift_controller_1.deleteShiftTemplate);
/* Shift Assignment Routes */
router.post("/assignments", authMiddleware_1.authenticateToken, shift_controller_1.assignShift);
router.get("/assignments", authMiddleware_1.authenticateToken, shift_controller_1.getShiftAssignments);
router.get("/assignments/employee/:employeeId", authMiddleware_1.authenticateToken, shift_controller_1.getShiftAssignmentsByEmployee);
router.put("/assignments/:id", authMiddleware_1.authenticateToken, shift_controller_1.updateShiftAssignment);
router.delete("/assignments/:id", authMiddleware_1.authenticateToken, shift_controller_1.deleteShiftAssignment);
router.get('/rotation-patterns', authMiddleware_1.authenticateToken, shift_controller_1.listRotationPatterns);
router.post('/rotation-patterns', authMiddleware_1.authenticateToken, shift_controller_1.createRotationPattern);
router.post('/rotation-patterns/:patternId/items', authMiddleware_1.authenticateToken, shift_controller_1.addRotationItem);
router.post('/rotation-patterns/:patternId/items/bulk', authMiddleware_1.authenticateToken, shift_controller_1.addRotationItemsBulk);
// Assign rotational to employee
router.post('/assign-rotational', authMiddleware_1.authenticateToken, shift_controller_1.assignRotational);
exports.default = router;
