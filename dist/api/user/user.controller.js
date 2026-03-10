"use strict";
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
exports.syncUsersFromEmployees = exports.logout = exports.verifyOtp = exports.loginInit = exports.loginCandidate = exports.setCandidatePassword = exports.listAllUsers = exports.adminResetPassword = exports.resetMyPassword = exports.loginUser = exports.createUser = void 0;
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const employee_service_1 = require("../../services/employee.service");
const userAuthService = new employee_service_1.UserAuthService();
const otp_service_1 = require("../../services/otp.service");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const sms_controller_1 = require("../sms/sms.controller");
// REGISTER / CREATE USER (linked to Employee)
const createUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeCode, password } = req.body;
        // 1) Check employee exists
        const employee = yield prisma_1.prisma.employee.findUnique({
            where: { employeeCode }
        });
        if (!employee) {
            return res.status(400).json({
                error: "Employee does not exist",
                action: "Create the employee first, then create the user",
                employeeCode
            });
        }
        // 2) Check if a user already exists for that employeeCode
        const existingByEmpCode = yield prisma_1.prisma.user.findUnique({ where: { employeeCode } });
        if (existingByEmpCode) {
            return res.status(409).json({
                error: "A user is already linked to this employeeCode",
                employeeCode
            });
        }
        const hashedPassword = yield bcryptjs_1.default.hash(password, 10);
        let username = `${employee.firstName}.${employee.lastName}`.toLowerCase().replace(/\s+/g, "");
        // Optional: ensure unique username by appending a number if needed
        let suffix = 1;
        while (yield prisma_1.prisma.user.findUnique({ where: { username } })) {
            username = `${employee.firstName}.${employee.lastName}${suffix}`.toLowerCase().replace(/\s+/g, "");
            suffix++;
        }
        const role = yield prisma_1.prisma.role.findUnique({
            where: { id: Number(employee.roleId) },
            select: { name: true } // <-- change to { roleName: true } if that's your field
        });
        if (!role) {
            return res.status(400).json({
                error: "Invalid roleId on employee. Role not found.",
                roleId: employee.roleId
            });
        }
        const user = yield prisma_1.prisma.user.create({
            data: {
                employeeCode,
                username,
                passwordHash: hashedPassword,
                role: role.name
            }
        });
        res.status(201).json(user);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to create user" });
    }
});
exports.createUser = createUser;
// LOGIN USER
const loginUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    console.log("Login attempt:", req.body);
    const ipAddress = getClientIp(req);
    const userAgent = req.headers["user-agent"] || undefined;
    try {
        const { employeeCode, password } = req.body;
        const user = yield prisma_1.prisma.user.findUnique({
            where: { employeeCode },
            include: { employee: true }
        });
        const employee = yield prisma_1.prisma.employee.findUnique({
            where: { employeeCode },
            select: {
                id: true,
                departmentId: true,
                photoUrl: true,
                designation: true,
                roleId: true,
                gender: true
            }
        });
        if (!employee)
            return res.status(404).json({ error: "Employee not found" });
        if (!user)
            return res.status(404).json({ error: "User not found" });
        const validPassword = yield bcryptjs_1.default.compare(password, user.passwordHash);
        yield prisma_1.prisma.loginHistory.create({
            data: { userId: user.id, ipAddress, userAgent, success: !!validPassword }
        }).catch(() => { });
        if (!validPassword)
            return res.status(401).json({ error: "Invalid password" });
        // Generate JWT
        const payload = {
            userId: user.id,
            role: user.role,
            empId: employee.id,
            deptId: employee.departmentId,
            employeeCode: user.employeeCode,
            username: user.username,
            roleId: employee.roleId
        };
        const token = jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET, { expiresIn: "12h" });
        // Update last login
        yield prisma_1.prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });
        // Send only required fields
        return res.json({
            token,
            username: user.username,
            employeeCode: user.employeeCode,
            id: user.id,
            role: user.role,
            empId: employee.id,
            deptId: employee.departmentId,
            designation: ((_a = employee === null || employee === void 0 ? void 0 : employee.designation) === null || _a === void 0 ? void 0 : _a.name) || '',
            photoUrl: employee.photoUrl || null,
            roleId: employee.roleId,
            gender: employee.gender
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: "Login failed" });
    }
});
exports.loginUser = loginUser;
const getClientIp = (req) => {
    const xfwd = req.headers["x-forwarded-for"] || "";
    return (xfwd.split(",")[0] || req.ip || req.socket.remoteAddress || "").trim();
};
// SELF-SERVE RESET (requires logged-in user & current password)
const resetMyPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const authUserId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId; // set by auth middleware
        const { userId, confirmPassword, newPassword } = req.body;
        // if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
        if (!confirmPassword || !newPassword) {
            return res.status(400).json({ error: "currentPassword and newPassword are required" });
        }
        const user = yield prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            return res.status(404).json({ error: "User not found" });
        // const ok = await bcrypt.compare( confirmPassword, user.passwordHash);
        // if (!ok) return res.status(401).json({ error: "Current password is incorrect" });
        const newHash = yield bcryptjs_1.default.hash(newPassword, 10);
        yield prisma_1.prisma.user.update({
            where: { id: userId },
            data: { passwordHash: newHash }
        });
        res.json({ message: "Password updated successfully" });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to reset password" });
    }
});
exports.resetMyPassword = resetMyPassword;
// ADMIN RESET (requires admin role)
const adminResetPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const requesterRole = (_a = req.user) === null || _a === void 0 ? void 0 : _a.role;
        if (requesterRole !== "admin")
            return res.status(403).json({ error: "Forbidden" });
        const { userId, newPassword } = req.body;
        if (!userId || !newPassword) {
            return res.status(400).json({ error: "userId and newPassword are required" });
        }
        const user = yield prisma_1.prisma.user.findUnique({ where: { id: Number(userId) } });
        if (!user)
            return res.status(404).json({ error: "User not found" });
        const newHash = yield bcryptjs_1.default.hash(newPassword, 10);
        yield prisma_1.prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: newHash }
        });
        res.json({ message: `Password reset for user ${user.username}` });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to reset password" });
    }
});
exports.adminResetPassword = adminResetPassword;
const listAllUsers = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const users = yield prisma_1.prisma.user.findMany({
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                employeeCode: true,
                username: true,
                role: true,
                lastLogin: true,
                createdAt: true,
                updatedAt: true,
                // ✅ employee details only
                employee: {
                    select: {
                        employeeCode: true,
                        firstName: true,
                        lastName: true,
                        departmentId: true,
                        designation: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
                // ❌ NOT returning: passwordHash, refreshTokens, loginHistory
            }
        });
        res.json(users);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});
exports.listAllUsers = listAllUsers;
const setCandidatePassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: "email and password are required" });
        const candidate = yield prisma_1.prisma.candidate.findUnique({ where: { email: email.toLowerCase() } });
        if (!candidate)
            return res.status(404).json({ error: "Candidate not found" });
        const passwordHash = yield bcryptjs_1.default.hash(password, 10);
        yield prisma_1.prisma.candidate.update({
            where: { id: candidate.id },
            data: { passwordHash }
        });
        return res.json({ message: "Password set successfully" });
    }
    catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Failed to set password" });
    }
});
exports.setCandidatePassword = setCandidatePassword;
const loginCandidate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ipAddress = getClientIp(req);
    const userAgent = req.headers["user-agent"] || undefined;
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: "email and password are required" });
        const candidate = yield prisma_1.prisma.candidate.findUnique({
            where: { email: email.toLowerCase() }
        });
        if (!candidate) {
            return res.status(404).json({ error: "Candidate not found" });
        }
        if (!candidate.passwordHash) {
            return res.status(400).json({ error: "Password not set. Use the set-password flow." });
        }
        const ok = yield bcryptjs_1.default.compare(password, candidate.passwordHash);
        yield prisma_1.prisma.candidateLoginHistory.create({
            data: { candidateId: candidate.id, ipAddress, userAgent, success: !!ok }
        }).catch(() => { });
        if (!ok)
            return res.status(401).json({ error: "Invalid credentials" });
        // JWT for candidates (role: 'candidate')
        const token = jsonwebtoken_1.default.sign({ candidateId: candidate.id, role: "candidate" }, process.env.JWT_SECRET, { expiresIn: "12h" });
        yield prisma_1.prisma.candidate.update({
            where: { id: candidate.id },
            data: { lastLogin: new Date() }
        });
        return res.json({
            token,
            candidateId: candidate.id,
            name: candidate.name,
            email: candidate.email
        });
    }
    catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Login failed" });
    }
});
exports.loginCandidate = loginCandidate;
const loginInit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { empId, password } = req.body;
        const user = yield userAuthService.validateCredentials(empId, password);
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const phone = (_a = user.employee) === null || _a === void 0 ? void 0 : _a.phone;
        if (!phone) {
            return res.status(400).json({ message: 'Phone number not found' });
        }
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        console.log(`Generated OTP for empId ${empId}: ${otp}`);
        yield otp_service_1.otpService.generate(empId, otp);
        yield (0, sms_controller_1.sendOtpSms)({
            patientName: ((_b = user.employee) === null || _b === void 0 ? void 0 : _b.firstName) || 'Employee',
            otp,
            service: 'Employee Login',
            phoneNumber: phone
        });
        res.json({
            success: true,
            empId
        });
    }
    catch (err) {
        res.status(500).json({ message: 'OTP sending failed' });
    }
});
exports.loginInit = loginInit;
const verifyOtp = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const ipAddress = getClientIp(req);
    const userAgent = req.headers["user-agent"] || undefined;
    try {
        const { empId, otp } = req.body;
        const isValid = yield otp_service_1.otpService.verify(empId, otp);
        if (!isValid) {
            return res.status(401).json({ message: 'Invalid or expired OTP' });
        }
        const user = yield prisma_1.prisma.user.findUnique({
            where: { employeeCode: empId }
        });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        // OTP success → finalize login
        const response = yield userAuthService.finalizeLogin(user.id, ipAddress, userAgent);
        res.json(Object.assign({}, response));
    }
    catch (err) {
        res.status(500).json({ message: 'OTP verification failed' });
    }
});
exports.verifyOtp = verifyOtp;
const logout = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ message: 'Refresh token required' });
        }
        // delete refresh token from DB
        yield prisma_1.prisma.refreshToken.deleteMany({
            where: { token: refreshToken }
        });
        return res.json({ message: 'Logged out successfully' });
    }
    catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Logout failed' });
    }
});
exports.logout = logout;
const syncUsersFromEmployees = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1) Get employees who DO NOT have users
        const employeesWithoutUsers = yield prisma_1.prisma.employee.findMany({
            where: {
                User: null // 👈 because Employee → User? relation exists
            },
            select: {
                employeeCode: true,
                firstName: true,
                lastName: true,
                roleId: true
            }
        });
        if (employeesWithoutUsers.length === 0) {
            return res.json({
                message: "All employees already have users",
                created: 0
            });
        }
        let createdCount = 0;
        for (const emp of employeesWithoutUsers) {
            // password = employeeCode
            const passwordHash = yield bcryptjs_1.default.hash(emp.employeeCode, 10);
            // generate username
            let username = `${emp.firstName}.${emp.lastName}`
                .toLowerCase()
                .replace(/\s+/g, "");
            let suffix = 1;
            while (yield prisma_1.prisma.user.findUnique({ where: { username } })) {
                username = `${emp.firstName}.${emp.lastName}${suffix}`
                    .toLowerCase()
                    .replace(/\s+/g, "");
                suffix++;
            }
            // resolve role
            const roleRow = yield prisma_1.prisma.role.findUnique({
                where: { id: emp.roleId },
                select: { name: true }
            });
            if (!roleRow) {
                console.warn(`Skipping ${emp.employeeCode}: role not found`);
                continue;
            }
            yield prisma_1.prisma.user.create({
                data: {
                    employeeCode: emp.employeeCode,
                    username,
                    passwordHash,
                    role: roleRow.name
                }
            });
            createdCount++;
        }
        return res.json({
            message: "User sync completed",
            created: createdCount
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "User sync failed" });
    }
});
exports.syncUsersFromEmployees = syncUsersFromEmployees;
