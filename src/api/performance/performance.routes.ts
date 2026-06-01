import { Router } from "express";
import {
  createTemplate,
  getTemplateByDept,
  getTemplateDetail,
  updateTemplate,
  deleteTemplate,
  listTemplatesByDept,
  submitResponses,
  submitSummary,
  submitFinalReview,
  getEmployeeForm,
  submitFullForm,
  assignFormToEmployee,
  assignSummaryTemplate,
  getAllSummaries
} from "./performance.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/template", authenticateToken, createTemplate);
router.get("/templates", authenticateToken, listTemplatesByDept);
router.get("/template-detail/:id", authenticateToken, getTemplateDetail);
router.patch("/template/:id", authenticateToken, updateTemplate);
router.delete("/template/:id", authenticateToken, deleteTemplate);
router.post("/assign", authenticateToken, assignFormToEmployee);
router.patch("/summary/:id/template", authenticateToken, assignSummaryTemplate);
router.get("/summaries", authenticateToken, getAllSummaries);
router.get("/template/:departmentId", authenticateToken, getTemplateByDept);
router.post("/responses", authenticateToken, submitResponses);
router.post("/summary", authenticateToken, submitSummary);
router.post("/final-review", authenticateToken, submitFinalReview);
router.get("/form/:employeeId/:departmentId", authenticateToken, getEmployeeForm);
router.post("/full-form", authenticateToken, submitFullForm);

export default router;
