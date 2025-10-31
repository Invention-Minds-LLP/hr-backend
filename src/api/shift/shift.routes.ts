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
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

/* Shift Template Routes */
router.post("/templates", authenticateToken,createShiftTemplate);
router.get("/templates", authenticateToken,getShiftTemplates);
router.get("/templates/:id", authenticateToken,getShiftTemplateById);
router.put("/templates/:id", authenticateToken, updateShiftTemplate);
router.delete("/templates/:id", authenticateToken,deleteShiftTemplate);

/* Shift Assignment Routes */
router.post("/assignments",authenticateToken, assignShift);
router.get("/assignments", authenticateToken,getShiftAssignments);
router.get("/assignments/employee/:employeeId",authenticateToken, getShiftAssignmentsByEmployee);
router.put("/assignments/:id",authenticateToken, updateShiftAssignment);
router.delete("/assignments/:id",authenticateToken, deleteShiftAssignment);

router.get('/rotation-patterns',authenticateToken, listRotationPatterns);
router.post('/rotation-patterns',authenticateToken, createRotationPattern);
router.post('/rotation-patterns/:patternId/items',authenticateToken, addRotationItem);
router.post('/rotation-patterns/:patternId/items/bulk',authenticateToken, addRotationItemsBulk);

// Assign rotational to employee
router.post('/assign-rotational',authenticateToken, assignRotational);

export default router;
