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
  listEmployeeShifts,
  updateEmployeeShift,
  assignFixed,
  getManagerEmployees,
  listManagerPatterns,
  getManagerShiftTemplates,
  requestShiftChange,
  approveShiftChange,
  listApprovalsInbox,
  listMyShiftRequests,
  listEmployeeShiftRequests,
  requestMonthlyShift,
  getMonthlyShiftStatus,
  getEmployeeDailyShiftsForRange,
  getApprovedWeekOffs,
  getEmployeeWeeklyShiftsForMonth,
} from "./shift.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

/* Shift Template Routes */
router.post("/templates", authenticateToken, createShiftTemplate);
router.get("/templates", authenticateToken, getShiftTemplates);
router.get("/templates/:id", authenticateToken, getShiftTemplateById);
router.put("/templates/:id", authenticateToken, updateShiftTemplate);
router.delete("/templates/:id", authenticateToken, deleteShiftTemplate);

router.get("/weekoffs", getApprovedWeekOffs);

router.get("/employee-shifts", authenticateToken, listEmployeeShifts);
router.put("/employee-shifts/:assignmentId", authenticateToken, updateEmployeeShift);

router.post('/assign-fixed', authenticateToken, assignFixed);
router.get("/employees", authenticateToken, getManagerEmployees);

router.get(
  "/manager/shift-templates",
  authenticateToken,
  getManagerShiftTemplates
);

router.get(
  "/manager/rotation-patterns",
  authenticateToken,
  listManagerPatterns
);


/* Shift Assignment Routes */
router.post("/assignments", authenticateToken, assignShift);
router.get("/assignments", authenticateToken, getShiftAssignments);
router.get("/assignments/employee/:employeeId", authenticateToken, getShiftAssignmentsByEmployee);
router.put("/assignments/:id", authenticateToken, updateShiftAssignment);
router.delete("/assignments/:id", authenticateToken, deleteShiftAssignment);

router.get('/rotation-patterns', authenticateToken, listRotationPatterns);
router.post('/rotation-patterns', authenticateToken, createRotationPattern);
router.post('/rotation-patterns/:patternId/items', authenticateToken, addRotationItem);
router.post('/rotation-patterns/:patternId/items/bulk', authenticateToken, addRotationItemsBulk);

// Assign rotational to employee
router.post('/assign-rotational', authenticateToken, assignRotational);
router.post(" /request", requestShiftChange);
// router.patch("  /approve/:id", updateShiftApproval);
router.post('/request', authenticateToken, requestShiftChange);
router.post('/monthly-request', authenticateToken, requestMonthlyShift);
router.post('/monthly/status', authenticateToken, getMonthlyShiftStatus);
router.get(
  '/daily-range',
  authenticateToken,
  getEmployeeDailyShiftsForRange
);
router.post('/approve/:id', authenticateToken, approveShiftChange);

router.get('/approvals/inbox', authenticateToken, listApprovalsInbox);
router.get('/approvals/mine', authenticateToken, listMyShiftRequests);
router.get('/approvals/employee/:employeeId', authenticateToken, listEmployeeShiftRequests);
router.get(
  '/weekly-month',
  authenticateToken,
  getEmployeeWeeklyShiftsForMonth
);


export default router;
