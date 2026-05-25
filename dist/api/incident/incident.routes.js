"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const rateLimitMiddleware_1 = require("../../middleware/rateLimitMiddleware");
const incident_controller_1 = require("./incident.controller");
const router = (0, express_1.Router)();
/* ─── Phase 4: Public endpoints (NO AUTH, rate-limited) ─────────────
   These must be registered BEFORE the dashboard / categories / :id routes
   below so Express's path-matching picks them up first. */
// Read-only — list categories that allow anonymous reports
router.get("/public/categories", (0, rateLimitMiddleware_1.rateLimit)({ max: 30, windowMs: 60000, keyPrefix: 'incident-pub-cats' }), incident_controller_1.listPublicCategories);
// Submit anonymous incident report
router.post("/public/report", (0, rateLimitMiddleware_1.rateLimit)({ max: 5, windowMs: 60000, keyPrefix: 'incident-pub-report' }), incident_controller_1.submitPublicIncident);
// Follow up on a previously-submitted anonymous report via tracking token
router.get("/public/track/:token", (0, rateLimitMiddleware_1.rateLimit)({ max: 30, windowMs: 60000, keyPrefix: 'incident-pub-track' }), incident_controller_1.trackPublicIncident);
/* ─── Phase 3: Dashboard (must be registered before /:id catches it) ─── */
router.get("/dashboard", authMiddleware_1.authenticateToken, incident_controller_1.getIncidentDashboard);
/* ─── Subject-view (employee self-portal — redacted shape) ─────────────
   Must be registered before /:id so "/mine" doesn't get matched as an id. */
router.get("/mine", authMiddleware_1.authenticateToken, incident_controller_1.listMyIncidents);
router.get("/mine/:id", authMiddleware_1.authenticateToken, incident_controller_1.getMyIncident);
router.post("/mine/:id/comments", authMiddleware_1.authenticateToken, incident_controller_1.addMyComment);
/* ─── Configurable categories ─── */
router.get("/categories", authMiddleware_1.authenticateToken, incident_controller_1.listCategories);
router.post("/categories", authMiddleware_1.authenticateToken, incident_controller_1.upsertCategory);
/* ─── Incidents ─── */
router.post("/", authMiddleware_1.authenticateToken, incident_controller_1.createIncident);
// Closed the auth hole: GET / used to be public.
router.get("/", authMiddleware_1.authenticateToken, incident_controller_1.listIncidents);
router.get("/:id", authMiddleware_1.authenticateToken, incident_controller_1.getIncident);
router.patch("/:id", authMiddleware_1.authenticateToken, incident_controller_1.updateIncident);
/* ─── Comments / witnesses / attachments ─── */
router.post("/:id/comments", authMiddleware_1.authenticateToken, incident_controller_1.addComment);
router.post("/:id/witnesses", authMiddleware_1.authenticateToken, incident_controller_1.addWitness);
router.post("/:id/attachments", authMiddleware_1.authenticateToken, incident_controller_1.addAttachment);
router.delete("/attachments/:attachmentId", authMiddleware_1.authenticateToken, incident_controller_1.deleteAttachment);
/* ─── Phase 2: CAPA (Corrective & Preventive Actions) ─── */
router.get("/:id/capa", authMiddleware_1.authenticateToken, incident_controller_1.listCAPA);
router.post("/:id/capa", authMiddleware_1.authenticateToken, incident_controller_1.createCAPA);
router.patch("/capa/:capaId", authMiddleware_1.authenticateToken, incident_controller_1.updateCAPA);
router.delete("/capa/:capaId", authMiddleware_1.authenticateToken, incident_controller_1.deleteCAPA);
/* ─── Phase 2: RCA (Root Cause Analysis — 5-Why or Fishbone) ─── */
router.get("/:id/rca", authMiddleware_1.authenticateToken, incident_controller_1.getRCA);
router.post("/:id/rca", authMiddleware_1.authenticateToken, incident_controller_1.upsertRCA); // upsert (one RCA per incident)
router.put("/:id/rca", authMiddleware_1.authenticateToken, incident_controller_1.upsertRCA); // alias
/* ─── Phase 2: Linked incidents (parent ↔ child) ─── */
router.get("/:id/links", authMiddleware_1.authenticateToken, incident_controller_1.getLinkedIncidents);
router.post("/:id/link", authMiddleware_1.authenticateToken, incident_controller_1.linkIncident);
router.delete("/:id/link", authMiddleware_1.authenticateToken, incident_controller_1.unlinkIncident);
/* ─── Legacy (kept so existing UI keeps working) ─── */
router.get("/reported-by/:reporterId", authMiddleware_1.authenticateToken, incident_controller_1.listIncidentsByReporter);
router.get("/employee/:employeeId", authMiddleware_1.authenticateToken, incident_controller_1.listIncidentsByEmployee);
// Note: `listAllIncidents` is now an alias for the new paginated list, but
// we keep the export so any old code path that imports it doesn't break.
void incident_controller_1.listAllIncidents;
exports.default = router;
