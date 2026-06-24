import "dotenv/config"; // must run before any module that reads process.env at import time
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import expressListRoutes from 'express-list-routes';
import { config, validateConfig } from "./config";

import employeeRoutes from "./api/employee/employee.routes";
import userRoutes from "./api/user/user.routes";
import departmentRoutes from "./api/department/department.routes";
import branchRoutes from "./api/branch/branch.routes";
import roleRoutes from "./api/role/role.routes";
import shiftRoutes from "./api/shift/shift.routes";
import appraisalRoutes from "./api/appraisal/appraisal.routes";
import leaveRoutes from "./api/leave/leave.routes";
import wfhRoutes from "./api/wfh/wfh.routes";
import permissionRoutes from "./api/permission/permission.routes";
import questionBankRoutes from "./api/question-bank/question-bank.routes";
import questionRoutes from "./api/questions/questions.routes";
import testRoutes from "./api/evaluation/evaluation.routes";
import assignTestRoutes from "./api/test-assign/test-assign.routes";
import attemptTestRoutes from "./api/test-attempt/test-attempt.routes";
import entitleRoutes from "./api/entitle/entitle.routes";
import resignationRoutes from './api/resignation/resignation.routes';
import dashboardRoutes from "./api/dashboard/dashboard.routes";
import recruitingRouter from "./api/recruiting/recruiting.routes";
import announcementRouter from "./api/announcement/announcement.routes";
import internshipRouter from "./api/internship/internship.routes";
import surveyRouter from "./api/survey/survery.routes";
import performanceRouter from "./api/performance/performance.routes";
import requisitionRouter from "./api/requisition/requisition.routes";
import grievanceRouter from "./api/grievance/grievance.routes";
import poshRouter from "./api/posh/posh.routes";
import notificationRouter from "./api/notifications/notifications.routes";
import trainingRouter from "./api/training/training.routes";
import attendanceCalendarRoutes from "./api/attendance/attendance.routes";
import { initSurveyScheduler } from "./api/survey/survery.controller";
import { initNoticePeriodSchedular } from "./api/resignation/resignation.controller";
import incidentRouter from "./api/incident/incident.routes";
import committeeRouter from "./api/committee/committee.routes";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { startSchedulers } from "./schedulers/scheduler";
import designationRoutes from "./api/designation/designation.routes";
import smsRoutes from "./api/sms/sms.routes";
import mobileAuthRoutes from "./api/mobile-auth/mobile-auth.routes";
import holidayRoutes from "./api/holidays/holidays.routes";
import geoTrackingRoutes from "./api/geo-tracking/geo-tracking.routes";
import exportRoutes from "./api/export/export.routes";
import forcePresentRoutes from "./api/force-present/force-present.routes";
import hrCorrectionsRoutes from "./api/hr-corrections/hr-corrections.routes";
import payrollRoutes from "./api/payroll/payroll.routes";
import mobileAttendanceRoutes from "./api/mobile-attendance/mobile-attendance.routes";
import weeklyTrackerRoutes from "./api/weekly-tracker/weekly-tracker.routes";
import encashmentRoutes from "./api/encashment/encashment.routes";
import compOffRoutes from "./api/comp-off/comp-off.routes";
import incentiveRoutes from "./api/incentive/incentive.routes";
import loanRoutes from "./api/loan/loan.routes";
import weeklyRatingRoutes from "./api/weekly-rating/weekly-rating.routes";
import pipRoutes, { respondViaToken } from "./api/pip/pip.routes";
import managementRoutes from "./api/management/management.routes";
import { authenticateToken } from "./middleware/authMiddleware";
import { UPLOADS_DIR } from "./lib/fileStorage";







const port = config.port;


dotenv.config();

// Fail fast if this client's .env is missing required keys (JWT_SECRET,
// DATABASE_URL, CLIENT_ID). Logs warnings for recommended-but-missing keys.
validateConfig();

const app = express();
// Behind a single reverse proxy (nginx). Lets express-rate-limit / req.ip use
// the real client IP from X-Forwarded-For without trusting arbitrary hops.
app.set("trust proxy", 1);
// Allow uploaded files (served from /uploads) to be loaded by a cross-origin
// page. Some clients (e.g. JMRH on LAN) serve the frontend on a different
// origin/port (:4300) than the backend (:3002); helmet's default
// Cross-Origin-Resource-Policy: same-origin blocks <img src> from /uploads in
// that case. CORS still governs API access — this only affects how static
// resources may be embedded. Also widen img-src so an img can load from any
// http/https host if the page ever carries a CSP (images aren't an XSS vector).
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "http:", "https:"],
    },
  },
}));

// Global API rate limit (per IP). Blanket protection against scraping/abuse.
app.use("/api/", rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Stricter limit on auth endpoints to blunt credential/OTP brute-forcing.
app.use(["/api/users/login", "/api/users/login-init", "/api/users/verify-otp",
         "/api/users/candidate/login", "/api/auth"],
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  }));


// app.use(cors({
//   origin: ["http://localhost:4300",
//     "https://demo.hrproindia.in",
//     "http://192.168.3.25:4300",
//     'http://localhost',
//     'https://localhost',
//     'capacitor://localhost'

//   ],
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: [
//     'Content-Type',
//     'Authorization',
//     'X-Requested-With'
//   ],// Allow your Angular app
//   credentials: true               // Optional: if you plan to send cookies
// }));
const allowedOrigins = config.cors.allowedOrigins;

app.use(cors({
  origin: function (origin, callback) {
    // Allow mobile apps, Postman, curl (no origin)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: "2mb" }));

// Serve uploaded files from the server's local disk. Files written by the
// upload helpers (src/lib/fileStorage.ts) land under UPLOADS_DIR and are exposed
// at <PUBLIC_BASE_URL>/uploads/<folder>/<file>. In production nginx also serves
// /uploads directly from the shared volume; this route is the in-process
// fallback (and what's used when running the backend without nginx).
app.use("/uploads", express.static(UPLOADS_DIR, { fallthrough: false, maxAge: "1d" }));

// Routes
app.use("/api/employees", employeeRoutes);
app.use("/api/users", userRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/appraisals", appraisalRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/wfh", wfhRoutes);
app.use("/api/permission", permissionRoutes);
app.use("/api/question-banks", questionBankRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/test-assign", assignTestRoutes);
app.use("/api/test-attempts", attemptTestRoutes);
app.use("/api/entitle", entitleRoutes);
app.use('/api/resignations', resignationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/recruiting', recruitingRouter);
app.use('/api/announcement', announcementRouter);
app.use('/api/internships', internshipRouter);
app.use('/api/survey', surveyRouter);
app.use('/api/performance', performanceRouter);
app.use('/api/requisitions', requisitionRouter);
app.use('/api/grievances', grievanceRouter);
app.use('/api/posh', poshRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/trainings', trainingRouter);
app.use('/api/attendance', attendanceCalendarRoutes);
app.use('/api/incidents', incidentRouter);
app.use('/api/committees', committeeRouter);
app.use("/api/designation", designationRoutes);
app.use("/api/sms", smsRoutes);
app.use("/api/auth", mobileAuthRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/geo-tracking", geoTrackingRoutes)
app.use("/api/export", exportRoutes)
app.use("/api/force-present", forcePresentRoutes);
app.use("/api/hr-corrections", hrCorrectionsRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/mobile-attendance", mobileAttendanceRoutes);
app.use("/api/weekly-tracker", weeklyTrackerRoutes);
app.use("/api/encashment", encashmentRoutes);
app.use("/api/comp-off", compOffRoutes);
app.use("/api/incentives", incentiveRoutes);
app.use("/api/loans", loanRoutes);
app.use("/api/weekly-rating", weeklyRatingRoutes);
app.use("/api/pip", pipRoutes);
app.use("/api/management", managementRoutes);
// Public endpoint — no auth required (employee responds via token link in email)
app.post("/api/pip-respond/:token", respondViaToken);

// Public endpoint — no auth required (certificate verification via QR / link)
// import { verifyCertificate } from "./api/internship/internship.controller";
// app.get("/api/public/verify/certificate/:code", verifyCertificate);

// Utility: backfill biometric attendance for one employee across a date range
import { backfillEmployeeAttendance, runBiometricSync, debugFetchCosec } from "./api/biometric/biometric.controller";
app.post("/api/biometric/backfill-employee", authenticateToken, async (req, res) => {
  try {
    const { employeeCode, fromDate, toDate } = req.body;
    if (!employeeCode || !fromDate || !toDate) {
      return res.status(400).json({
        error: "employeeCode, fromDate (YYYY-MM-DD), toDate (YYYY-MM-DD) are required",
      });
    }
    const result = await backfillEmployeeAttendance(
      employeeCode,
      new Date(fromDate),
      new Date(toDate),
    );
    res.json(result);
  } catch (err: any) {
    console.error("[backfill-employee] failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Manually trigger the full biometric sync (the same job the cron runs every
 * 20 minutes). Useful for testing whether the COSEC integration is alive
 * without waiting for the next scheduled run.
 *
 * Body: { isFinalRun?: boolean } — defaults to false (intra-day mode).
 *       Pass true to mimic the 22:00 end-of-day pass.
 *
 * The sync is heavy (fetches all active employees + hits COSEC API). To avoid
 * holding the HTTP request open for minutes, this kicks the job off in the
 * background and returns immediately. Watch the server console for progress.
 */
app.post("/api/biometric/run-sync", authenticateToken, async (req, res) => {
  const isFinalRun = !!(req.body || {}).isFinalRun;
  console.log(`[manual] biometric sync requested | isFinalRun=${isFinalRun}`);

  // Fire-and-forget so the caller isn't blocked. Errors are logged.
  runBiometricSync(isFinalRun)
    .then(() => console.log(`[manual] biometric sync finished | isFinalRun=${isFinalRun}`))
    .catch((err) => console.error("[manual] biometric sync failed:", err));

  res.status(202).json({
    started: true,
    isFinalRun,
    message: "Biometric sync started in the background. Watch server logs for progress.",
  });
});

/**
 * Debug COSEC reachability + filter behaviour from inside this process.
 * Lets you see EXACTLY what the backend gets back, instead of trusting that
 * Postman + the backend hit the same endpoint identically.
 *
 * Body (all optional):
 *   {
 *     "date":      "YYYY-MM-DD",   // defaults to today
 *     "checkCode": "JMRH463",      // userid you're looking for
 *     "noFilter":  false,          // true = strip range/id/active (matches plain Postman test)
 *     "active":    1,              // 0 or 1 — defaults to 1
 *     "orgId":     2               // defaults to 2
 *   }
 *
 * Response includes the resolved URL, total record count, every userid in the
 * response, and (if checkCode given) whether the exact code was found + a list
 * of similar codes for catching typos / casing issues.
 *
 * Run twice for a clear comparison: once with noFilter=false (matches our cron),
 * once with noFilter=true (matches your working Postman query). Difference in
 * `totalRecords` and `presence.foundExact` tells you exactly which filter
 * is dropping the user.
 */
app.post("/api/biometric/cosec-debug", authenticateToken, async (req, res) => {
  try {
    const body = req.body || {};
    const date = body.date ? new Date(body.date) : new Date();
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ error: "Invalid date — use YYYY-MM-DD" });
    }
    const result = await debugFetchCosec({
      date,
      checkCode: body.checkCode,
      noFilter:  !!body.noFilter,
      active:    body.active === 0 || body.active === 1 ? body.active : undefined,
      orgId:     body.orgId !== undefined ? Number(body.orgId) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    console.error("[cosec-debug] failed:", err?.message || err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Default route
app.get("/", (req, res) => {
  res.send("✅ HR Management API is running!");
});

startSchedulers();


// Error handler middleware (optional, but good practice)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "http:", "https:"],
    },
  },
}));


// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://127.0.0.1:${port}/`);
});

export default app;
