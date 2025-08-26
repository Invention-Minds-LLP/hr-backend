import { Router } from "express";
import {
  createShiftTemplate,
  getShiftTemplates,
  getShiftTemplateById,
  updateShiftTemplate,
  deleteShiftTemplate,
  assignShift,
  getShiftAssignments,
  getShiftAssignmentsByEmployee,
  updateShiftAssignment,
  deleteShiftAssignment,
  listRotationPatterns,
  createRotationPattern,
  addRotationItem,
  addRotationItemsBulk,
  assignRotational,
} from "./shift.controller";

const router = Router();

/* Shift Template Routes */
router.post("/templates", createShiftTemplate);
router.get("/templates", getShiftTemplates);
router.get("/templates/:id", getShiftTemplateById);
router.put("/templates/:id", updateShiftTemplate);
router.delete("/templates/:id", deleteShiftTemplate);

/* Shift Assignment Routes */
router.post("/assignments", assignShift);
router.get("/assignments", getShiftAssignments);
router.get("/assignments/employee/:employeeId", getShiftAssignmentsByEmployee);
router.put("/assignments/:id", updateShiftAssignment);
router.delete("/assignments/:id", deleteShiftAssignment);

router.get('/rotation-patterns', listRotationPatterns);
router.post('/rotation-patterns', createRotationPattern);
router.post('/rotation-patterns/:patternId/items', addRotationItem);
router.post('/rotation-patterns/:patternId/items/bulk', addRotationItemsBulk);

// Assign rotational to employee
router.post('/assign-rotational', assignRotational);

export default router;
