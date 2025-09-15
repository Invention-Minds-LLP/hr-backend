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
exports.loginCandidate = exports.setCandidatePassword = exports.listAllUsers = exports.adminResetPassword = exports.resetMyPassword = exports.loginUser = exports.createUser = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// REGISTER / CREATE USER (linked to Employee)
const createUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeCode, password } = req.body;
        // 1) Check employee exists
        const employee = yield prisma.employee.findUnique({
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
        const existingByEmpCode = yield prisma.user.findUnique({ where: { employeeCode } });
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
        while (yield prisma.user.findUnique({ where: { username } })) {
            username = `${employee.firstName}.${employee.lastName}${suffix}`.toLowerCase().replace(/\s+/g, "");
            suffix++;
        }
        const role = yield prisma.role.findUnique({
            where: { id: Number(employee.roleId) },
            select: { name: true } // <-- change to { roleName: true } if that's your field
        });
        if (!role) {
            return res.status(400).json({
                error: "Invalid roleId on employee. Role not found.",
                roleId: employee.roleId
            });
        }
        const user = yield prisma.user.create({
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
    const ipAddress = getClientIp(req);
    const userAgent = req.headers["user-agent"] || undefined;
    try {
        const { employeeCode, password } = req.body;
        const user = yield prisma.user.findUnique({
            where: { employeeCode },
            include: { employee: true }
        });
        const employee = yield prisma.employee.findUnique({
            where: { employeeCode },
            select: {
                id: true,
                departmentId: true
            }
        });
        if (!employee)
            return res.status(404).json({ error: "Employee not found" });
        if (!user)
            return res.status(404).json({ error: "User not found" });
        const validPassword = yield bcryptjs_1.default.compare(password, user.passwordHash);
        yield prisma.loginHistory.create({
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
        };
        const token = jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET, { expiresIn: "1d" });
        // Update last login
        yield prisma.user.update({
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
            deptId: employee.departmentId
        });
    }
    catch (error) {
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
        const user = yield prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            return res.status(404).json({ error: "User not found" });
        // const ok = await bcrypt.compare( confirmPassword, user.passwordHash);
        // if (!ok) return res.status(401).json({ error: "Current password is incorrect" });
        const newHash = yield bcryptjs_1.default.hash(newPassword, 10);
        yield prisma.user.update({
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
        const user = yield prisma.user.findUnique({ where: { id: Number(userId) } });
        if (!user)
            return res.status(404).json({ error: "User not found" });
        const newHash = yield bcryptjs_1.default.hash(newPassword, 10);
        yield prisma.user.update({
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
        const users = yield prisma.user.findMany({
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                employeeCode: true,
                username: true,
                role: true,
                lastLogin: true,
                createdAt: true,
                updatedAt: true,
                employee: {
                    select: {
                        employeeCode: true,
                        firstName: true,
                        lastName: true,
                        departmentId: true,
                        designation: true
                    }
                }
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
        const candidate = yield prisma.candidate.findUnique({ where: { email: email.toLowerCase() } });
        if (!candidate)
            return res.status(404).json({ error: "Candidate not found" });
        const passwordHash = yield bcryptjs_1.default.hash(password, 10);
        yield prisma.candidate.update({
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
        const candidate = yield prisma.candidate.findUnique({
            where: { email: email.toLowerCase() }
        });
        if (!candidate) {
            return res.status(404).json({ error: "Candidate not found" });
        }
        if (!candidate.passwordHash) {
            return res.status(400).json({ error: "Password not set. Use the set-password flow." });
        }
        const ok = yield bcryptjs_1.default.compare(password, candidate.passwordHash);
        yield prisma.candidateLoginHistory.create({
            data: { candidateId: candidate.id, ipAddress, userAgent, success: !!ok }
        }).catch(() => { });
        if (!ok)
            return res.status(401).json({ error: "Invalid credentials" });
        // JWT for candidates (role: 'candidate')
        const token = jsonwebtoken_1.default.sign({ candidateId: candidate.id, role: "candidate" }, process.env.JWT_SECRET, { expiresIn: "1d" });
        yield prisma.candidate.update({
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
