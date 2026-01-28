import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import expressListRoutes from 'express-list-routes';

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
import { initLeaveEndSchedular } from "./api/leave/leave.controller";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { startSchedulers } from "./schedulers/scheduler";
import designationRoutes from "./api/designation/designation.routes";
import smsRoutes from "./api/sms/sms.routes";
import mobileAuthRoutes from "./api/mobile-auth/mobile-auth.routes";
import holidayRoutes from "./api/holidays/holidays.routes";







const port = 3002;


dotenv.config();
const app = express();
app.use(helmet());
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
  'http://localhost:4300',     // Angular web
  'http://192.168.3.25:4300',  // LAN testing
  'https://demo.hrproindia.in',
  'http://localhost',          // Capacitor Android
  'https://localhost',
  'capacitor://localhost',     // Capacitor iOS
  'http://localhost:8100',
  'https://hrminds.imapps.in',
  'https://hrmindsjmrh.imapps.in',
  'http://localhost:4200',
  'https://rashtrotthanahospital.com',
  'http://192.168.8.189:4300'
];

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

app.use(express.json());

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
app.use("/api/designation", designationRoutes);
app.use("/api/sms", smsRoutes);
app.use("/api/auth", mobileAuthRoutes);
app.use("/api/holidays", holidayRoutes);


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

// Start the server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://127.0.0.1:${port}/`);
});

export default app;
