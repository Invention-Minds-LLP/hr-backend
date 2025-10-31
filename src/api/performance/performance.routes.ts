import { Router } from "express";
import {
  createTemplate,
  getTemplateByDept,
  submitResponses,
  submitSummary,
  submitFinalReview,
  getEmployeeForm,
  submitFullForm,
  assignFormToEmployee,
  getAllSummaries
} from "./performance.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/template",authenticateToken, createTemplate);
router.post("/assign",authenticateToken, assignFormToEmployee);
router.get("/summaries",authenticateToken, getAllSummaries);
router.get("/template/:departmentId",authenticateToken, getTemplateByDept);
router.post("/responses",authenticateToken, submitResponses);
router.post("/summary",authenticateToken, submitSummary);
router.post("/final-review",authenticateToken, submitFinalReview);
router.get("/form/:employeeId/:departmentId",authenticateToken, getEmployeeForm);
router.post("/full-form",authenticateToken, submitFullForm)

export default router;
