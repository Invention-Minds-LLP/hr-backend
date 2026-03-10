"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const helmet_1 = __importDefault(require("helmet"));
const scheduler_1 = require("./schedulers/scheduler");
const designation_routes_1 = __importDefault(require("./api/designation/designation.routes"));
const sms_routes_1 = __importDefault(require("./api/sms/sms.routes"));
const mobile_auth_routes_1 = __importDefault(require("./api/mobile-auth/mobile-auth.routes"));
const holidays_routes_1 = __importDefault(require("./api/holidays/holidays.routes"));
const geo_tracking_routes_1 = __importDefault(require("./api/geo-tracking/geo-tracking.routes"));
const port = 3002;
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
// app.use("/api/", rateLimit({
//   windowMs: 10 * 60 * 1000, 
//   max: 300
// }));
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
app.use(express_1.default.json());
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
app.use("/api/designation", designation_routes_1.default);
app.use("/api/sms", sms_routes_1.default);
app.use("/api/auth", mobile_auth_routes_1.default);
app.use("/api/holidays", holidays_routes_1.default);
app.use("/api/geo-tracking", geo_tracking_routes_1.default);
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
