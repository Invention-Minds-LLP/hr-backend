import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
    getEmployeeSessions, getSessionPoints, getGeoTrackingStatus,
    updateGeoConsent,
    startLocationSession,
    addLocationPoint,
    endLocationSession,
  createLocationSession,
  getMySessions,
  uploadSessionPhotos,
  getSessionPhotos,
  updateSessionName,
  getManagerTeamSessions
} from "./geo-tracking.controller";

const router = Router();

router.get("/mobile/geo/status", authenticateToken, getGeoTrackingStatus);
router.post("/mobile/geo/consent", authenticateToken, updateGeoConsent);
router.post("/mobile/geo/session/start", authenticateToken, startLocationSession);
router.post("/mobile/geo/point", authenticateToken, addLocationPoint);
router.post("/mobile/geo/session/end", authenticateToken, endLocationSession);
router.get(
  "/mobile/geo/sessions",
  authenticateToken,
  getMySessions
);
router.post(
  "/mobile/geo/session/create",
  authenticateToken,
  createLocationSession
);

router.get(
    "/manager/geo/:employeeId/sessions",
    authenticateToken,
    getEmployeeSessions
);

router.get(
    "/manager/geo/session/:sessionId/points",
    authenticateToken,
    getSessionPoints
);
router.get(
  "/mobile/geo/manager/sessions",
  authenticateToken,
  getManagerTeamSessions
);

router.post("/mobile/geo/session/:sessionId/photos", authenticateToken, uploadSessionPhotos);
router.get("/mobile/geo/session/:sessionId/photos", authenticateToken, getSessionPhotos);
router.post("/session/update-name",authenticateToken, updateSessionName);



export default router;
