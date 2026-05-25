"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.respondViaToken = void 0;
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const pip_controller_1 = require("./pip.controller");
// Public respond endpoint exported separately
var pip_controller_2 = require("./pip.controller");
Object.defineProperty(exports, "respondViaToken", { enumerable: true, get: function () { return pip_controller_2.respondViaToken; } });
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authenticateToken);
// ── Templates ────────────────────────────────────────────────────────────────
router.get("/templates", pip_controller_1.getTemplates);
router.post("/templates/seed", pip_controller_1.seedDefaultTemplates);
router.post("/templates", pip_controller_1.createTemplate);
router.put("/templates/:id", pip_controller_1.updateTemplate);
router.delete("/templates/:id", pip_controller_1.deleteTemplate);
// ── Monitoring ────────────────────────────────────────────────────────────────
router.get("/underperformers", pip_controller_1.getUnderperformers);
// ── Email ─────────────────────────────────────────────────────────────────────
router.get("/preview-email", pip_controller_1.previewEmail);
router.post("/send-warning", pip_controller_1.sendWarning);
// ── PIP Lifecycle ─────────────────────────────────────────────────────────────
router.get("/list", pip_controller_1.getPIPList);
router.get("/email-logs", pip_controller_1.getEmailLogs);
router.post("/initiate", pip_controller_1.initiatePIP);
// ── PIP Responses (HR) ───────────────────────────────────────────────────────
router.get("/employee/:employeeId/history", pip_controller_1.getEmployeePIPHistory);
router.get("/:id/responses", pip_controller_1.getPIPResponses);
router.post("/:id/log-response", pip_controller_1.logManualResponse);
router.patch("/responses/:id/acknowledge", pip_controller_1.acknowledgeResponse);
// ── PIP Lifecycle (parameterised last to avoid conflicts) ─────────────────────
router.get("/:id", pip_controller_1.getPIPDetail);
router.post("/:id/weekly-review", pip_controller_1.addWeeklyReview);
router.put("/:id/close", pip_controller_1.closePIP);
router.put("/:id/extend", pip_controller_1.extendPIP);
router.post("/:id/terminate", pip_controller_1.terminatePIP);
exports.default = router;
