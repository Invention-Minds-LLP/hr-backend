"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const shift_controller_1 = require("./shift.controller");
const router = (0, express_1.Router)();
/* Shift Template Routes */
router.post("/templates", shift_controller_1.createShiftTemplate);
router.get("/templates", shift_controller_1.getShiftTemplates);
router.get("/templates/:id", shift_controller_1.getShiftTemplateById);
router.put("/templates/:id", shift_controller_1.updateShiftTemplate);
router.delete("/templates/:id", shift_controller_1.deleteShiftTemplate);
/* Shift Assignment Routes */
router.post("/assignments", shift_controller_1.assignShift);
router.get("/assignments", shift_controller_1.getShiftAssignments);
router.get("/assignments/employee/:employeeId", shift_controller_1.getShiftAssignmentsByEmployee);
router.put("/assignments/:id", shift_controller_1.updateShiftAssignment);
router.delete("/assignments/:id", shift_controller_1.deleteShiftAssignment);
exports.default = router;
