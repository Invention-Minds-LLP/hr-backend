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
  listMentors
} from "./employee.controller";

const router = Router();

router.post("/", createEmployee);
router.get("/", getEmployees);
router.post('/:employeeId/documents/upload', uploadEmployeeDocuments);
router.get("/specific-roles", getSpecificRoles);
router.get("/active", getActiveEmployees);
router.get("/:employeeId/requests", getEmployeeRequests);
router.get('/:id/accruals', getEmployeeAccrualsController);
router.get('/dept', listMentors)
router.get("/today", getTodayCelebrants);
router.get("/:id", getEmployeeById);
router.put("/:id", updateEmployee);
router.delete("/:id", deleteEmployee);


export default router;
