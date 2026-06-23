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
  getRecruitmentOps,
  getDeptPlanning,
  setDeptPlanning,
  getAppraisalScores,
  getReliabilityScores,
  getPipMonitor,
  getOtVsHire,
  getSalaryIncrements,
  getAppraisalEligibility,
  getProbationOverview,
  getTrainingByDept,
  getActionItems,
  getKpiDetail,
  getDeptSnapshot,
  getDeptAttendanceToday,
  getDeptAttendanceWeekly,
  getWeeklyTrend,
  getPerformanceDistribution,
  getDeptRisk,
  getOtAnalysis,
  getOtEligibility,
  getLeaveByTypeWeekly,
  getLeaveAbuse,
  getWeeklyPerfStatus,
  getIncidentsAnalytics,
  getPunctuality,
  getWorkedHours,
  getLateArrivals,
  getLeaveUtilization,
  getAbsenteeism,
  getMobileLoginActivity,
  getQualifications,
  getElInsights,
  getTrainingInsights,
  getTrainingCalendar,
  getPayrollOverview,
  getPayrollTrend,
  getLoanOverview,
  getIncentiveOverview,
  getPayrollReadiness,
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
router.get("/recruitment-ops", authenticateToken, getRecruitmentOps);
router.get("/dept-planning", authenticateToken, getDeptPlanning);
router.put("/dept-planning", authenticateToken, setDeptPlanning);
router.get("/appraisal-scores", authenticateToken, getAppraisalScores);
router.get("/reliability-scores", authenticateToken, getReliabilityScores);
router.get("/pip-monitor", authenticateToken, getPipMonitor);
router.get("/ot-vs-hire", authenticateToken, getOtVsHire);
router.get("/salary-increments", authenticateToken, getSalaryIncrements);
router.get("/appraisal-eligibility", authenticateToken, getAppraisalEligibility);
router.get("/probation-overview", authenticateToken, getProbationOverview);
router.get("/training-by-dept", authenticateToken, getTrainingByDept);
router.get("/action-items", authenticateToken, getActionItems);
router.get("/kpi-detail", authenticateToken, getKpiDetail);
router.get("/dept-snapshot", authenticateToken, getDeptSnapshot);
router.get("/dept-attendance-today", authenticateToken, getDeptAttendanceToday);
router.get("/dept-attendance-weekly", authenticateToken, getDeptAttendanceWeekly);
router.get("/weekly-trend", authenticateToken, getWeeklyTrend);
router.get("/performance-distribution", authenticateToken, getPerformanceDistribution);
router.get("/dept-risk", authenticateToken, getDeptRisk);
router.get("/ot-analysis", authenticateToken, getOtAnalysis);
router.get("/ot-eligibility", authenticateToken, getOtEligibility);
router.get("/leave-by-type-weekly", authenticateToken, getLeaveByTypeWeekly);
router.get("/leave-abuse", authenticateToken, getLeaveAbuse);
router.get("/weekly-perf-status", authenticateToken, getWeeklyPerfStatus);
router.get("/incidents-analytics", authenticateToken, getIncidentsAnalytics);
router.get("/punctuality", authenticateToken, getPunctuality);
router.get("/worked-hours", authenticateToken, getWorkedHours);
router.get("/late-arrivals", authenticateToken, getLateArrivals);
router.get("/leave-utilization", authenticateToken, getLeaveUtilization);
router.get("/absenteeism", authenticateToken, getAbsenteeism);
router.get("/workforce-insights", authenticateToken, getWorkforceInsights);
router.get("/mobile-login-activity", authenticateToken, getMobileLoginActivity);
router.get("/qualifications", authenticateToken, getQualifications);
router.get("/el-insights", authenticateToken, getElInsights);
router.get("/training-insights", authenticateToken, getTrainingInsights);
router.get("/training-calendar", authenticateToken, getTrainingCalendar);
router.get("/payroll-overview", authenticateToken, getPayrollOverview);
router.get("/payroll-trend", authenticateToken, getPayrollTrend);
router.get("/loan-overview", authenticateToken, getLoanOverview);
router.get("/incentive-overview", authenticateToken, getIncentiveOverview);
router.get("/payroll-readiness", authenticateToken, getPayrollReadiness);

export default router;
