import { Router } from "express";
import {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  uploadEmployeeDocuments,
  getSpecificRoles,
  getActiveEmployees,
  getEmployeeAccrualsController,
  getEmployeeRequests,
  getTodayCelebrants,
  listMentors,
  uploadEmployeePhoto,
  uploadVaccineProof,
  uploadEmployeeDisabilityProof,
  getEmployeesByDepartments,
  getUnreportedAbsentees,
  bulkUploadEmployees,
  bulkUpdateReportingManager,
  getInchargeEmployees,
  deleteEmployeeDocument,
  updateEmployeeProfile,
  getEmployeeProfile,
  terminateFromSabbatical,
  endSabbatical,
  extendSabbatical,
  startSabbatical,
  getEmployeesByRole,
  getEmployeesByManager,
  bulkUpdateEmployeeExtras,
  bulkUploadLeaveBalance,
  extendProbation,
  confirmProbation,
  terminateProbation,
  getProbationHistory,
  getEmployeeAuditLog,
  queryAuditLog,
} from "./employee.controller";
import { authenticateToken } from "../../middleware/authMiddleware";
import { bulkUploadLeaveBalancesExcel } from "../leave/leave.controller";

const router = Router();

router.post("/", authenticateToken,createEmployee);
router.get("/", authenticateToken,getEmployees);
router.get('/incharge', authenticateToken, getInchargeEmployees);
router.get("/by-departments", authenticateToken, getEmployeesByDepartments);
router.get("/absent-without-leave", getUnreportedAbsentees);
router.get("/by-manager/:managerId", getEmployeesByManager);
router.get('/by-role', getEmployeesByRole);
router.post('/bulk-upload',authenticateToken, bulkUploadLeaveBalancesExcel);
router.get("/specific-roles",authenticateToken, getSpecificRoles);
router.get("/active",authenticateToken, getActiveEmployees);
router.get('/dept',authenticateToken, listMentors)
router.get("/today",authenticateToken, getTodayCelebrants);
router.delete('/documents/:documentId', authenticateToken, deleteEmployeeDocument);
// router.post("/bulk-update-extras", bulkUpdateEmployeeExtras);
router.post('/:employeeId/documents/upload',authenticateToken, uploadEmployeeDocuments);
router.post('/:employeeId/photo',authenticateToken, uploadEmployeePhoto)
router.get("/:employeeId/requests",authenticateToken, getEmployeeRequests);
router.get('/:id/accruals',authenticateToken, getEmployeeAccrualsController);
router.get('/:id/profile', getEmployeeProfile);
router.put('/:id/profile',updateEmployeeProfile);
router.get("/:id",authenticateToken, getEmployeeById);
router.put("/:id",authenticateToken, updateEmployee);
router.delete("/:id",authenticateToken, deleteEmployee);
router.post('/:employeeId/vaccinations/:vaccineIndex/proof',authenticateToken, uploadVaccineProof);
router.post('/:employeeId/disability',authenticateToken, uploadEmployeeDisabilityProof);
router.post("/employees/:employeeId/sabbatical", startSabbatical);
router.put("/sabbaticals/:id/extend", extendSabbatical);
router.put("/sabbaticals/:id/end", endSabbatical);
router.put("/sabbaticals/:id/terminate", terminateFromSabbatical);

router.get("/:id/probation/history", authenticateToken, getProbationHistory);

// Employee audit log — per-employee history of every change made to their record.
router.get("/:id/audit-log", authenticateToken, getEmployeeAuditLog);
// Org-wide audit query (e.g. all salary changes last month).
router.get("/audit/query", authenticateToken, queryAuditLog);
router.post("/:id/probation/extend", authenticateToken, extendProbation);
router.post("/:id/probation/confirm", authenticateToken, confirmProbation);
router.post("/:id/probation/terminate", authenticateToken, terminateProbation);





export default router;
