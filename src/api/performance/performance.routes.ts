import { Router } from "express";
import {
  createTemplate,
  getTemplateByDept,
  getTemplateDetail,
  cloneTemplate,
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
  getAllSummaries,
  getEmployeeCycles,
  exportPerformanceSheet
} from "./performance.controller";
import {
  listSelfAppraisalCycles,
  getSelfAppraisal,
  submitSelfAppraisal,
  reopenSelfAppraisal,
} from "./performanceSelfAppraisal.controller";
import {
  setHrReviewed,
  requestEdit,
  listEditRequests,
  decideEditRequest,
} from "./performanceEditRequest.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/template", authenticateToken, createTemplate);
router.get("/templates", authenticateToken, listTemplatesByDept);
router.get("/template-detail/:id", authenticateToken, getTemplateDetail);
router.post("/template/:id/clone", authenticateToken, cloneTemplate);
router.patch("/template/:id", authenticateToken, updateTemplate);
router.delete("/template/:id", authenticateToken, deleteTemplate);
router.get("/cycles", authenticateToken, getEmployeeCycles);

// Self-appraisal for the indicator. Registered before "/self-appraisal" so the
// literal "cycles" segment is not swallowed by a parameterised route.
router.get("/self-appraisal/cycles", authenticateToken, listSelfAppraisalCycles);
router.get("/self-appraisal", authenticateToken, getSelfAppraisal);
router.post("/self-appraisal", authenticateToken, submitSelfAppraisal);
router.patch("/self-appraisal/:id/reopen", authenticateToken, reopenSelfAppraisal);
router.get("/export/:employeeId", authenticateToken, exportPerformanceSheet);
router.post("/assign", authenticateToken, assignFormToEmployee);
router.patch("/summary/:id/template", authenticateToken, assignSummaryTemplate);

// HR sign-off and the edit requests it gates. Static "edit-requests" is
// registered before the parameterised summary routes so it isn't swallowed.
router.get("/edit-requests", authenticateToken, listEditRequests);
router.patch("/edit-requests/:id", authenticateToken, decideEditRequest);
router.patch("/summary/:id/review", authenticateToken, setHrReviewed);
router.post("/summary/:id/edit-request", authenticateToken, requestEdit);
router.get("/summaries", authenticateToken, getAllSummaries);
router.get("/template/:departmentId", authenticateToken, getTemplateByDept);
router.post("/responses", authenticateToken, submitResponses);
router.post("/summary", authenticateToken, submitSummary);
router.post("/final-review", authenticateToken, submitFinalReview);
router.get("/form/:employeeId/:departmentId", authenticateToken, getEmployeeForm);
router.post("/full-form", authenticateToken, submitFullForm);

export default router;
