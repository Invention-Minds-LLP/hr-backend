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
const wfh_routes_2 = __importDefault(require("./api/wfh/wfh.routes"));
const port = 3002;
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: "http://localhost:4200", // Allow your Angular app
    credentials: true // Optional: if you plan to send cookies
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
app.use("/api/permission", wfh_routes_2.default);
// Default route
app.get("/", (req, res) => {
    res.send("✅ HR Management API is running!");
});
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
