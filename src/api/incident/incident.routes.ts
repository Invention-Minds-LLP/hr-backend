import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import { rateLimit } from "../../middleware/rateLimitMiddleware";
import {
  // categories
  listCategories, upsertCategory,
  // incidents — new
  createIncident, listIncidents, getIncident, updateIncident,
  // discussion
  addComment, addWitness, addAttachment, deleteAttachment,
  // Phase 2 — investigation tools
  listCAPA, createCAPA, updateCAPA, deleteCAPA,
  upsertRCA, getRCA,
  linkIncident, unlinkIncident, getLinkedIncidents,
  // Phase 3 — dashboard
  getIncidentDashboard,
  // Phase 4 — public anonymous reporting
  listPublicCategories, submitPublicIncident, trackPublicIncident,
  // Subject-view (employee self-portal — redacted)
  listMyIncidents, getMyIncident, addMyComment,
  // legacy
  listAllIncidents, listIncidentsByEmployee, listIncidentsByReporter,
} from "./incident.controller";

const router = Router();

/* ─── Phase 4: Public endpoints (NO AUTH, rate-limited) ─────────────
   These must be registered BEFORE the dashboard / categories / :id routes
   below so Express's path-matching picks them up first. */
// Read-only — list categories that allow anonymous reports
router.get(
  "/public/categories",
  rateLimit({ max: 30, windowMs: 60_000, keyPrefix: 'incident-pub-cats' }),
  listPublicCategories,
);
// Submit anonymous incident report
router.post(
  "/public/report",
  rateLimit({ max: 5, windowMs: 60_000, keyPrefix: 'incident-pub-report' }),
  submitPublicIncident,
);
// Follow up on a previously-submitted anonymous report via tracking token
router.get(
  "/public/track/:token",
  rateLimit({ max: 30, windowMs: 60_000, keyPrefix: 'incident-pub-track' }),
  trackPublicIncident,
);

/* ─── Phase 3: Dashboard (must be registered before /:id catches it) ─── */
router.get("/dashboard", authenticateToken, getIncidentDashboard);

/* ─── Subject-view (employee self-portal — redacted shape) ─────────────
   Must be registered before /:id so "/mine" doesn't get matched as an id. */
router.get ("/mine",                   authenticateToken, listMyIncidents);
router.get ("/mine/:id",               authenticateToken, getMyIncident);
router.post("/mine/:id/comments",      authenticateToken, addMyComment);

/* ─── Configurable categories ─── */
router.get ("/categories",     authenticateToken, listCategories);
router.post("/categories",     authenticateToken, upsertCategory);

/* ─── Incidents ─── */
router.post  ("/",              authenticateToken, createIncident);
// Closed the auth hole: GET / used to be public.
router.get   ("/",              authenticateToken, listIncidents);
router.get   ("/:id",           authenticateToken, getIncident);
router.patch ("/:id",           authenticateToken, updateIncident);

/* ─── Comments / witnesses / attachments ─── */
router.post  ("/:id/comments",     authenticateToken, addComment);
router.post  ("/:id/witnesses",    authenticateToken, addWitness);
router.post  ("/:id/attachments",  authenticateToken, addAttachment);
router.delete("/attachments/:attachmentId", authenticateToken, deleteAttachment);

/* ─── Phase 2: CAPA (Corrective & Preventive Actions) ─── */
router.get   ("/:id/capa",            authenticateToken, listCAPA);
router.post  ("/:id/capa",            authenticateToken, createCAPA);
router.patch ("/capa/:capaId",        authenticateToken, updateCAPA);
router.delete("/capa/:capaId",        authenticateToken, deleteCAPA);

/* ─── Phase 2: RCA (Root Cause Analysis — 5-Why or Fishbone) ─── */
router.get   ("/:id/rca",   authenticateToken, getRCA);
router.post  ("/:id/rca",   authenticateToken, upsertRCA);     // upsert (one RCA per incident)
router.put   ("/:id/rca",   authenticateToken, upsertRCA);     // alias

/* ─── Phase 2: Linked incidents (parent ↔ child) ─── */
router.get   ("/:id/links",  authenticateToken, getLinkedIncidents);
router.post  ("/:id/link",   authenticateToken, linkIncident);
router.delete("/:id/link",   authenticateToken, unlinkIncident);

/* ─── Legacy (kept so existing UI keeps working) ─── */
router.get("/reported-by/:reporterId", authenticateToken, listIncidentsByReporter);
router.get("/employee/:employeeId",    authenticateToken, listIncidentsByEmployee);
// Note: `listAllIncidents` is now an alias for the new paginated list, but
// we keep the export so any old code path that imports it doesn't break.
void listAllIncidents;

export default router;
