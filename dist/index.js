"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config"); // must run before any module that reads process.env at import time
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const employee_routes_1 = __importDefault(require("./api/employee/employee.routes"));
const user_routes_1 = __importDefault(require("./api/user/user.routes"));
const department_routes_1 = __importDefault(require("./api/department/department.routes"));
const branch_routes_1 = __importDefault(require("./api/branch/branch.routes"));
const role_routes_1 = __importDefault(require("./api/role/role.routes"));
const shift_routes_1 = __importDefault(require("./api/shift/shift.routes"));
const appraisal_routes_1 = __importDefault(require("./api/appraisal/appraisal.routes"));
const leave_routes_1 = __importDefault(require("./api/leave/leave.routes"));
const wfh_routes_1 = __importDefault(require("./api/wfh/wfh.routes"));
const permission_routes_1 = __importDefault(require("./api/permission/permission.routes"));
const question_bank_routes_1 = __importDefault(require("./api/question-bank/question-bank.routes"));
const questions_routes_1 = __importDefault(require("./api/questions/questions.routes"));
const evaluation_routes_1 = __importDefault(require("./api/evaluation/evaluation.routes"));
const test_assign_routes_1 = __importDefault(require("./api/test-assign/test-assign.routes"));
const test_attempt_routes_1 = __importDefault(require("./api/test-attempt/test-attempt.routes"));
const entitle_routes_1 = __importDefault(require("./api/entitle/entitle.routes"));
const resignation_routes_1 = __importDefault(require("./api/resignation/resignation.routes"));
const dashboard_routes_1 = __importDefault(require("./api/dashboard/dashboard.routes"));
const recruiting_routes_1 = __importDefault(require("./api/recruiting/recruiting.routes"));
const announcement_routes_1 = __importDefault(require("./api/announcement/announcement.routes"));
const internship_routes_1 = __importDefault(require("./api/internship/internship.routes"));
const survery_routes_1 = __importDefault(require("./api/survey/survery.routes"));
const performance_routes_1 = __importDefault(require("./api/performance/performance.routes"));
const requisition_routes_1 = __importDefault(require("./api/requisition/requisition.routes"));
const grievance_routes_1 = __importDefault(require("./api/grievance/grievance.routes"));
const posh_routes_1 = __importDefault(require("./api/posh/posh.routes"));
const notifications_routes_1 = __importDefault(require("./api/notifications/notifications.routes"));
const training_routes_1 = __importDefault(require("./api/training/training.routes"));
const attendance_routes_1 = __importDefault(require("./api/attendance/attendance.routes"));
const incident_routes_1 = __importDefault(require("./api/incident/incident.routes"));
const committee_routes_1 = __importDefault(require("./api/committee/committee.routes"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const scheduler_1 = require("./schedulers/scheduler");
const designation_routes_1 = __importDefault(require("./api/designation/designation.routes"));
const sms_routes_1 = __importDefault(require("./api/sms/sms.routes"));
const mobile_auth_routes_1 = __importDefault(require("./api/mobile-auth/mobile-auth.routes"));
const holidays_routes_1 = __importDefault(require("./api/holidays/holidays.routes"));
const geo_tracking_routes_1 = __importDefault(require("./api/geo-tracking/geo-tracking.routes"));
const export_routes_1 = __importDefault(require("./api/export/export.routes"));
const force_present_routes_1 = __importDefault(require("./api/force-present/force-present.routes"));
const hr_corrections_routes_1 = __importDefault(require("./api/hr-corrections/hr-corrections.routes"));
const payroll_routes_1 = __importDefault(require("./api/payroll/payroll.routes"));
const mobile_attendance_routes_1 = __importDefault(require("./api/mobile-attendance/mobile-attendance.routes"));
const weekly_tracker_routes_1 = __importDefault(require("./api/weekly-tracker/weekly-tracker.routes"));
const encashment_routes_1 = __importDefault(require("./api/encashment/encashment.routes"));
const comp_off_routes_1 = __importDefault(require("./api/comp-off/comp-off.routes"));
const incentive_routes_1 = __importDefault(require("./api/incentive/incentive.routes"));
const loan_routes_1 = __importDefault(require("./api/loan/loan.routes"));
const weekly_rating_routes_1 = __importDefault(require("./api/weekly-rating/weekly-rating.routes"));
const pip_routes_1 = __importStar(require("./api/pip/pip.routes"));
const management_routes_1 = __importDefault(require("./api/management/management.routes"));
const authMiddleware_1 = require("./middleware/authMiddleware");
const port = 3002;
dotenv_1.default.config();
const app = (0, express_1.default)();
// Behind a single reverse proxy (nginx). Lets express-rate-limit / req.ip use
// the real client IP from X-Forwarded-For without trusting arbitrary hops.
app.set("trust proxy", 1);
app.use((0, helmet_1.default)());
// Global API rate limit (per IP). Blanket protection against scraping/abuse.
app.use("/api/", (0, express_rate_limit_1.default)({
    windowMs: 10 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
}));
// Stricter limit on auth endpoints to blunt credential/OTP brute-forcing.
app.use(["/api/users/login", "/api/users/login-init", "/api/users/verify-otp",
    "/api/users/candidate/login", "/api/auth"], (0, express_rate_limit_1.default)({
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
const allowedOrigins = [
    'http://localhost:4300', // Angular web
    'http://192.168.3.25:4300', // LAN testing
    'https://demo.hrproindia.in',
    'http://localhost', // Capacitor Android
    'https://localhost',
    'capacitor://localhost', // Capacitor iOS
    'http://localhost:8100',
    'http://localhost:8101',
    'https://hrminds.imapps.in',
    'https://hrmindsjmrh.imapps.in',
    'http://localhost:4200',
    'https://rashtrotthanahospital.com',
    'http://192.168.8.189:4300',
    'https://www.rashtrotthanahospital.com'
];
app.use((0, cors_1.default)({
    origin: function (origin, callback) {
        // Allow mobile apps, Postman, curl (no origin)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error(`CORS blocked origin: ${origin}`));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express_1.default.json({ limit: "2mb" }));
// Routes
app.use("/api/employees", employee_routes_1.default);
app.use("/api/users", user_routes_1.default);
app.use("/api/departments", department_routes_1.default);
app.use("/api/branches", branch_routes_1.default);
app.use("/api/roles", role_routes_1.default);
app.use("/api/shifts", shift_routes_1.default);
app.use("/api/appraisals", appraisal_routes_1.default);
app.use("/api/leaves", leave_routes_1.default);
app.use("/api/wfh", wfh_routes_1.default);
app.use("/api/permission", permission_routes_1.default);
app.use("/api/question-banks", question_bank_routes_1.default);
app.use("/api/questions", questions_routes_1.default);
app.use("/api/tests", evaluation_routes_1.default);
app.use("/api/test-assign", test_assign_routes_1.default);
app.use("/api/test-attempts", test_attempt_routes_1.default);
app.use("/api/entitle", entitle_routes_1.default);
app.use('/api/resignations', resignation_routes_1.default);
app.use('/api/dashboard', dashboard_routes_1.default);
app.use('/api/recruiting', recruiting_routes_1.default);
app.use('/api/announcement', announcement_routes_1.default);
app.use('/api/internships', internship_routes_1.default);
app.use('/api/survey', survery_routes_1.default);
app.use('/api/performance', performance_routes_1.default);
app.use('/api/requisitions', requisition_routes_1.default);
app.use('/api/grievances', grievance_routes_1.default);
app.use('/api/posh', posh_routes_1.default);
app.use('/api/notifications', notifications_routes_1.default);
app.use('/api/trainings', training_routes_1.default);
app.use('/api/attendance', attendance_routes_1.default);
app.use('/api/incidents', incident_routes_1.default);
app.use('/api/committees', committee_routes_1.default);
app.use("/api/designation", designation_routes_1.default);
app.use("/api/sms", sms_routes_1.default);
app.use("/api/auth", mobile_auth_routes_1.default);
app.use("/api/holidays", holidays_routes_1.default);
app.use("/api/geo-tracking", geo_tracking_routes_1.default);
app.use("/api/export", export_routes_1.default);
app.use("/api/force-present", force_present_routes_1.default);
app.use("/api/hr-corrections", hr_corrections_routes_1.default);
app.use("/api/payroll", payroll_routes_1.default);
app.use("/api/mobile-attendance", mobile_attendance_routes_1.default);
app.use("/api/weekly-tracker", weekly_tracker_routes_1.default);
app.use("/api/encashment", encashment_routes_1.default);
app.use("/api/comp-off", comp_off_routes_1.default);
app.use("/api/incentives", incentive_routes_1.default);
app.use("/api/loans", loan_routes_1.default);
app.use("/api/weekly-rating", weekly_rating_routes_1.default);
app.use("/api/pip", pip_routes_1.default);
app.use("/api/management", management_routes_1.default);
// Public endpoint — no auth required (employee responds via token link in email)
app.post("/api/pip-respond/:token", pip_routes_1.respondViaToken);
// Utility: backfill biometric attendance for one employee across a date range
const biometric_controller_1 = require("./api/biometric/biometric.controller");
app.post("/api/biometric/backfill-employee", authMiddleware_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeCode, fromDate, toDate } = req.body;
        if (!employeeCode || !fromDate || !toDate) {
            return res.status(400).json({
                error: "employeeCode, fromDate (YYYY-MM-DD), toDate (YYYY-MM-DD) are required",
            });
        }
        const result = yield (0, biometric_controller_1.backfillEmployeeAttendance)(employeeCode, new Date(fromDate), new Date(toDate));
        res.json(result);
    }
    catch (err) {
        console.error("[backfill-employee] failed:", err);
        res.status(500).json({ error: err.message });
    }
}));
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
app.post("/api/biometric/run-sync", authMiddleware_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const isFinalRun = !!(req.body || {}).isFinalRun;
    console.log(`[manual] biometric sync requested | isFinalRun=${isFinalRun}`);
    // Fire-and-forget so the caller isn't blocked. Errors are logged.
    (0, biometric_controller_1.runBiometricSync)(isFinalRun)
        .then(() => console.log(`[manual] biometric sync finished | isFinalRun=${isFinalRun}`))
        .catch((err) => console.error("[manual] biometric sync failed:", err));
    res.status(202).json({
        started: true,
        isFinalRun,
        message: "Biometric sync started in the background. Watch server logs for progress.",
    });
}));
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
app.post("/api/biometric/cosec-debug", authMiddleware_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body || {};
        const date = body.date ? new Date(body.date) : new Date();
        if (Number.isNaN(date.getTime())) {
            return res.status(400).json({ error: "Invalid date — use YYYY-MM-DD" });
        }
        const result = yield (0, biometric_controller_1.debugFetchCosec)({
            date,
            checkCode: body.checkCode,
            noFilter: !!body.noFilter,
            active: body.active === 0 || body.active === 1 ? body.active : undefined,
            orgId: body.orgId !== undefined ? Number(body.orgId) : undefined,
        });
        res.json(result);
    }
    catch (err) {
        console.error("[cosec-debug] failed:", (err === null || err === void 0 ? void 0 : err.message) || err);
        res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || String(err) });
    }
}));
// Default route
app.get("/", (req, res) => {
    res.send("✅ HR Management API is running!");
});
(0, scheduler_1.startSchedulers)();
// Error handler middleware (optional, but good practice)
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: "Internal Server Error" });
});
// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running at http://127.0.0.1:${port}/`);
});
exports.default = app;
