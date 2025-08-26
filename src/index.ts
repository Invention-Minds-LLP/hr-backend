import express from "express";
import cors from "cors";
import dotenv from "dotenv";

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




const port = 3002;


dotenv.config();
const app = express();

app.use(cors({
    origin: "http://localhost:4200", // Allow your Angular app
    credentials: true               // Optional: if you plan to send cookies
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





// Default route
app.get("/", (req, res) => {
    res.send("✅ HR Management API is running!");
  });
  
  // Error handler middleware (optional, but good practice)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: "Internal Server Error" });
  });
  
  // Start the server
  app.listen(port, '0.0.0.0',() => {
    console.log(`🚀 Server running at http://127.0.0.1:${port}/`);
  });

export default app;
