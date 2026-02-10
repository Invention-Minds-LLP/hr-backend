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
  getEmployeesByManager
} from "./employee.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/", authenticateToken,createEmployee);
router.get("/", authenticateToken,getEmployees);
router.get("/by-departments", authenticateToken, getEmployeesByDepartments);
router.get("/absent-without-leave", getUnreportedAbsentees);
router.get("/by-manager/:managerId", getEmployeesByManager);
router.get('/by-role', getEmployeesByRole);
router.get('/incharge', authenticateToken, getInchargeEmployees);
router.get('/:id/profile', getEmployeeProfile);
router.put('/:id/profile',updateEmployeeProfile);
router.post('/bulk-upload',authenticateToken, bulkUploadEmployees);
router.post('/:employeeId/documents/upload',authenticateToken, uploadEmployeeDocuments);
router.post('/:employeeId/photo',authenticateToken, uploadEmployeePhoto)
router.get("/specific-roles",authenticateToken, getSpecificRoles);
router.get("/active",authenticateToken, getActiveEmployees);
router.get("/:employeeId/requests",authenticateToken, getEmployeeRequests);
router.get('/:id/accruals',authenticateToken, getEmployeeAccrualsController);
router.get('/dept',authenticateToken, listMentors)
router.get("/today",authenticateToken, getTodayCelebrants);
router.get("/:id",authenticateToken, getEmployeeById);
router.put("/:id",authenticateToken, updateEmployee);
router.delete("/:id",authenticateToken, deleteEmployee);
router.post('/:employeeId/vaccinations/:vaccineIndex/proof',authenticateToken, uploadVaccineProof);
router.post('/:employeeId/disability',authenticateToken, uploadEmployeeDisabilityProof);
router.delete('/documents/:documentId', authenticateToken, deleteEmployeeDocument);
router.post("/employees/:employeeId/sabbatical", startSabbatical);
router.put("/sabbaticals/:id/extend", extendSabbatical);
router.put("/sabbaticals/:id/end", endSabbatical);
router.put("/sabbaticals/:id/terminate", terminateFromSabbatical);





export default router;
