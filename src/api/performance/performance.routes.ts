import { Router } from "express";
import {
  createTemplate,
  getTemplateByDept,
  submitResponses,
  submitSummary,
  submitFinalReview,
  getEmployeeForm,
  submitFullForm
} from "./performance.controller";

const router = Router();

router.post("/template", createTemplate);
router.get("/template/:departmentId", getTemplateByDept);
router.post("/responses", submitResponses);
router.post("/summary", submitSummary);
router.post("/final-review", submitFinalReview);
router.get("/form/:employeeId/:departmentId", getEmployeeForm);
router.post("/full-form", submitFullForm)

export default router;
