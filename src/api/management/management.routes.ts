import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  getPulse,
  getAttention,
  getWorkforce,
  getWorkforceInsights,
  getAttendanceSummary,
  getLeaveCalendar,
  getPerformanceRadar,
  getActivePIPs,
  getAttritionTrend,
  getRecruitmentFunnel,
  getTrainingByDept,
  getActionItems,
  getKpiDetail,
  getDeptSnapshot,
  getWeeklyTrend,
  getPerformanceDistribution,
  getDeptRisk,
  getOtAnalysis,
  getLateArrivals,
  getLeaveUtilization,
  getAbsenteeism,
  getMobileLoginActivity,
  getQualifications,
  getElInsights,
  getTrainingInsights,
  getTrainingCalendar,
} from "./management.controller";

const router = Router();

router.get("/pulse", authenticateToken, getPulse);
router.get("/attention", authenticateToken, getAttention);
router.get("/workforce", authenticateToken, getWorkforce);
router.get("/attendance-summary", authenticateToken, getAttendanceSummary);
router.get("/leave-calendar", authenticateToken, getLeaveCalendar);
router.get("/performance-radar", authenticateToken, getPerformanceRadar);
router.get("/pip-active", authenticateToken, getActivePIPs);
router.get("/attrition-trend", authenticateToken, getAttritionTrend);
router.get("/recruitment-funnel", authenticateToken, getRecruitmentFunnel);
router.get("/training-by-dept", authenticateToken, getTrainingByDept);
router.get("/action-items", authenticateToken, getActionItems);
router.get("/kpi-detail", authenticateToken, getKpiDetail);
router.get("/dept-snapshot", authenticateToken, getDeptSnapshot);
router.get("/weekly-trend", authenticateToken, getWeeklyTrend);
router.get("/performance-distribution", authenticateToken, getPerformanceDistribution);
router.get("/dept-risk", authenticateToken, getDeptRisk);
router.get("/ot-analysis", authenticateToken, getOtAnalysis);
router.get("/late-arrivals", authenticateToken, getLateArrivals);
router.get("/leave-utilization", authenticateToken, getLeaveUtilization);
router.get("/absenteeism", authenticateToken, getAbsenteeism);
router.get("/workforce-insights", authenticateToken, getWorkforceInsights);
router.get("/mobile-login-activity", authenticateToken, getMobileLoginActivity);
router.get("/qualifications", authenticateToken, getQualifications);
router.get("/el-insights", authenticateToken, getElInsights);
router.get("/training-insights", authenticateToken, getTrainingInsights);
router.get("/training-calendar", authenticateToken, getTrainingCalendar);

export default router;
