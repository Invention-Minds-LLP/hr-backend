import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  // Templates
  getTemplates, createTemplate, updateTemplate, deleteTemplate, seedDefaultTemplates,
  // Monitoring
  getUnderperformers,
  // Email
  previewEmail, sendWarning,
  // PIP Lifecycle
  initiatePIP, getPIPList, getPIPDetail, addWeeklyReview, closePIP, extendPIP, terminatePIP,
  // Logs
  getEmailLogs,
  // PIP Responses
  getEmployeePIPHistory, logManualResponse, acknowledgeResponse, getPIPResponses,
  // Public token response (respondViaToken) registered in index.ts without auth
} from "./pip.controller";
// Public respond endpoint exported separately
export { respondViaToken } from "./pip.controller";

const router = Router();
router.use(authenticateToken);

// ── Templates ────────────────────────────────────────────────────────────────
router.get("/templates", getTemplates);
router.post("/templates/seed", seedDefaultTemplates);
router.post("/templates", createTemplate);
router.put("/templates/:id", updateTemplate);
router.delete("/templates/:id", deleteTemplate);

// ── Monitoring ────────────────────────────────────────────────────────────────
router.get("/underperformers", getUnderperformers);

// ── Email ─────────────────────────────────────────────────────────────────────
router.get("/preview-email", previewEmail);
router.post("/send-warning", sendWarning);

// ── PIP Lifecycle ─────────────────────────────────────────────────────────────
router.get("/list", getPIPList);
router.get("/email-logs", getEmailLogs);
router.post("/initiate", initiatePIP);

// ── PIP Responses (HR) ───────────────────────────────────────────────────────
router.get("/employee/:employeeId/history", getEmployeePIPHistory);
router.get("/:id/responses", getPIPResponses);
router.post("/:id/log-response", logManualResponse);
router.patch("/responses/:id/acknowledge", acknowledgeResponse);

// ── PIP Lifecycle (parameterised last to avoid conflicts) ─────────────────────
router.get("/:id", getPIPDetail);
router.post("/:id/weekly-review", addWeeklyReview);
router.put("/:id/close", closePIP);
router.put("/:id/extend", extendPIP);
router.post("/:id/terminate", terminatePIP);

export default router;
