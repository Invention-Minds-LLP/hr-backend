import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getTeamSnapshot,
  getTeamComposition,
  getAlerts,
  getAttendanceToday,
  getAttendanceWeekly,
  getPendingApprovals,
  getPerformanceTrend,
  getRoster,
  getTeam,
} from "./manager.controller";

const router = Router();

// Every route is scoped to the caller's own direct reports inside the
// controller, so there is no id parameter to tamper with — the token is the
// only input that decides whose data comes back.
router.get("/team", authenticateToken, getTeam);
router.get("/team-snapshot", authenticateToken, getTeamSnapshot);
// Section 1 filter: ?period=current|next|month
router.get("/team-composition", authenticateToken, getTeamComposition);
router.get("/attendance-today", authenticateToken, getAttendanceToday);
router.get("/attendance-weekly", authenticateToken, getAttendanceWeekly);
router.get("/pending-approvals", authenticateToken, getPendingApprovals);
// Section 2 ticker: unread notifications + circulars in force.
router.get("/alerts", authenticateToken, getAlerts);
router.get("/performance-trend", authenticateToken, getPerformanceTrend);
router.get("/roster", authenticateToken, getRoster);

export default router;
