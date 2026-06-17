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
exports.refreshAccessToken = exports.mobileFinalizeLogin = exports.mobileEmailVerify = exports.mobileEmailInit = exports.mobileConfirmClient = exports.getMobileClientInfo = exports.mobileConfirmIdentity = exports.mobilePhoneVerify = exports.mobilePhoneInit = void 0;
const prisma_1 = require("../../lib/prisma");
const otp_service_1 = require("../../services/otp.service");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const sms_controller_1 = require("../sms/sms.controller");
const leave_controller_1 = require("../leave/leave.controller");
const sendEmailOtp_1 = require("../../utils/sendEmailOtp");
const attendanceMode_1 = require("../../lib/attendanceMode");
const config_1 = require("../../config");
const mobilePhoneInit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const { phone } = req.body;
    // ✅ PLAY STORE REVIEW AUTO LOGIN
    if (config_1.config.playReview.mode &&
        phone === config_1.config.playReview.phone) {
        const employee = yield prisma_1.prisma.employee.findFirst({
            where: { phone },
            include: {
                designation: true,
                role: { select: { name: true } },
                Branch: { select: { attendanceMode: true } }
            }
        });
        if (!employee) {
            return res.status(404).json({ message: 'Review employee not found' });
        }
        const user = yield prisma_1.prisma.user.findUnique({
            where: { employeeCode: employee.employeeCode }
        });
        if (!user) {
            return res.status(404).json({ message: 'Review user not found' });
        }
        // 🔐 Generate tokens directly
        const empRoleName = (_b = (_a = employee.role) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : user.role;
        const accessToken = jsonwebtoken_1.default.sign({
            userId: user.id,
            empId: employee.id,
            role: empRoleName,
            reviewMode: true
        }, config_1.config.jwtSecret, { expiresIn: '1h' });
        const refreshToken = crypto_1.default.randomUUID();
        yield prisma_1.prisma.refreshToken.create({
            data: {
                userId: user.id,
                token: refreshToken,
                expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
            }
        });
        return res.json({
            autoLogin: true,
            reviewMode: true,
            // tokens
            accessToken,
            refreshToken,
            // user info
            username: user.username,
            employeeCode: user.employeeCode,
            id: user.id,
            role: empRoleName,
            // employee info
            empId: employee.id,
            deptId: employee.departmentId,
            designation: ((_c = employee.designation) === null || _c === void 0 ? void 0 : _c.name) || '',
            photoUrl: employee.photoUrl || null,
            roleId: employee.roleId,
            attendanceMode: (0, attendanceMode_1.resolveAttendanceMode)(employee)
        });
    }
    const employee = yield prisma_1.prisma.employee.findFirst({ where: { phone } });
    if (!employee) {
        return res.status(404).json({ message: 'Phone not registered' });
    }
    const session = yield prisma_1.prisma.mobileAuthSession.create({
        data: {
            employeeId: employee.id,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000)
        }
    });
    // Per-client (MOBILE_SKIP_PHONE_OTP in .env): IM skips the phone-OTP step and
    // goes phone → identity confirmation → email OTP. No phone OTP is sent.
    if (config_1.config.flags.skipPhoneOtp) {
        return res.json({ sessionId: session.id, next: 'IDENTITY_CONFIRMATION' });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    yield otp_service_1.otpService.generate(phone, otp);
    // OTP channel is per-client by which provider they own (OTP_CHANNEL in .env):
    // IM → WhatsApp (its creds + template), JMRH → SMS (its creds).
    if (config_1.config.flags.otpChannel === 'whatsapp') {
        const wa = yield (0, leave_controller_1.sendWhatsAppTemplate)({
            to: phone,
            templateId: config_1.config.whatsapp.otpTemplateId,
            placeholders: [otp], // assumes template body {{1}} = OTP code
        });
        console.log('OTP WhatsApp sent:', wa);
    }
    else {
        const sms = yield (0, sms_controller_1.sendOtpSms)({
            patientName: employee.firstName,
            otp,
            service: 'Mobile Login',
            phoneNumber: phone
        });
        console.log('OTP SMS sent:', sms.data);
    }
    res.json({ sessionId: session.id });
});
exports.mobilePhoneInit = mobilePhoneInit;
const mobilePhoneVerify = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { sessionId, otp } = req.body;
    const session = yield prisma_1.prisma.mobileAuthSession.findUnique({
        where: { id: sessionId },
        include: { employee: true }
    });
    if (!session || session.expiresAt < new Date()) {
        return res.status(401).json({ message: 'Session expired' });
    }
    const valid = yield otp_service_1.otpService.verify(session.employee.phone, otp);
    if (!valid) {
        return res.status(401).json({ message: 'Invalid OTP' });
    }
    yield prisma_1.prisma.mobileAuthSession.update({
        where: { id: sessionId },
        data: { phoneVerified: true }
    });
    res.json({ next: 'IDENTITY_CONFIRMATION' });
});
exports.mobilePhoneVerify = mobilePhoneVerify;
const mobileConfirmIdentity = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { sessionId, firstName, departmentId } = req.body;
    const session = yield prisma_1.prisma.mobileAuthSession.findUnique({
        where: { id: sessionId },
        include: { employee: true }
    });
    if (!session) {
        return res.status(401).json({ message: 'Session not found' });
    }
    if ((session === null || session === void 0 ? void 0 : session.employee.firstName) !== firstName ||
        session.employee.departmentId !== departmentId) {
        return res.status(401).json({ message: 'Identity mismatch' });
    }
    yield prisma_1.prisma.mobileAuthSession.update({
        where: { id: sessionId },
        data: { identityOk: true }
    });
    res.json({ next: 'EMAIL_OTP' });
});
exports.mobileConfirmIdentity = mobileConfirmIdentity;
const getMobileClientInfo = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    res.json({
        clientName: config_1.config.branding.mobileClientName
    });
});
exports.getMobileClientInfo = getMobileClientInfo;
const mobileConfirmClient = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { sessionId, confirmed } = req.body;
    if (!confirmed) {
        // User said "No"
        yield prisma_1.prisma.mobileAuthSession.delete({
            where: { id: sessionId }
        });
        return res.status(400).json({
            message: 'Login cancelled by user'
        });
    }
    const session = yield prisma_1.prisma.mobileAuthSession.findUnique({
        where: { id: sessionId }
    });
    if (!session) {
        return res.status(401).json({ message: 'Session not found' });
    }
    yield prisma_1.prisma.mobileAuthSession.update({
        where: { id: sessionId },
        data: { identityOk: true }
    });
    res.json({ next: 'EMAIL_OTP' });
});
exports.mobileConfirmClient = mobileConfirmClient;
const mobileEmailInit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { sessionId, email } = req.body;
    const session = yield prisma_1.prisma.mobileAuthSession.findUnique({
        where: { id: sessionId },
        include: { employee: true }
    });
    if (!session) {
        return res.status(401).json({ message: 'Session not found' });
    }
    console.log('Email OTP init for session:', sessionId, 'Employee:', session.employee, 'Provided email:', email);
    if ((session === null || session === void 0 ? void 0 : session.employee.email) !== email) {
        return res.status(401).json({ message: 'Email mismatch' });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    yield otp_service_1.otpService.generate(email, otp);
    yield (0, sendEmailOtp_1.sendEmailOtp)({
        to: email,
        otp,
        employeeName: session === null || session === void 0 ? void 0 : session.employee.firstName,
        purpose: 'Mobile Login'
    });
    res.json({ next: 'VERIFY_EMAIL_OTP' });
});
exports.mobileEmailInit = mobileEmailInit;
const mobileEmailVerify = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { sessionId, otp } = req.body;
    const session = yield prisma_1.prisma.mobileAuthSession.findUnique({
        where: { id: sessionId },
        include: { employee: true }
    });
    const valid = yield otp_service_1.otpService.verify(session.employee.email, otp);
    if (!valid)
        return res.status(401).json({ message: 'Invalid OTP' });
    yield prisma_1.prisma.mobileAuthSession.update({
        where: { id: sessionId },
        data: { emailVerified: true }
    });
    res.json({ next: 'FINAL_VERIFICATION' });
});
exports.mobileEmailVerify = mobileEmailVerify;
const mobileFinalizeLogin = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const { sessionId, employeeCode, bloodGroup } = req.body;
    const session = yield prisma_1.prisma.mobileAuthSession.findUnique({
        where: { id: sessionId },
        include: {
            employee: {
                include: {
                    designation: true,
                    Branch: { select: { attendanceMode: true } }
                }
            }
        }
    });
    const employee = session === null || session === void 0 ? void 0 : session.employee;
    console.log('Finalizing login for session:', sessionId, 'Employee:', employee);
    if (!employee ||
        employee.employeeCode !== employeeCode ||
        employee.bloodGroup !== bloodGroup) {
        return res.status(401).json({ message: 'Verification failed' });
    }
    const user = yield prisma_1.prisma.user.findUnique({
        where: { employeeCode }
    });
    // Get role from Employee table
    const empRole = yield prisma_1.prisma.role.findUnique({ where: { id: employee.roleId }, select: { name: true } });
    const roleName = (_a = empRole === null || empRole === void 0 ? void 0 : empRole.name) !== null && _a !== void 0 ? _a : user.role;
    const accessToken = jsonwebtoken_1.default.sign({
        userId: user.id,
        empId: employee.id,
        role: roleName
    }, config_1.config.jwtSecret, { expiresIn: '15m' });
    const refreshToken = crypto_1.default.randomUUID();
    yield prisma_1.prisma.refreshToken.create({
        data: {
            userId: user.id,
            token: refreshToken,
            expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        }
    });
    yield prisma_1.prisma.mobileAuthSession.delete({ where: { id: sessionId } });
    res.json({
        accessToken,
        refreshToken,
        // user details
        username: user.username,
        employeeCode: user.employeeCode,
        id: user.id,
        role: roleName,
        // employee details
        empId: employee.id,
        deptId: employee.departmentId,
        designation: ((_b = employee.designation) === null || _b === void 0 ? void 0 : _b.name) || '',
        photoUrl: employee.photoUrl || null,
        roleId: employee.roleId,
        gender: employee.gender || '',
        attendanceMode: (0, attendanceMode_1.resolveAttendanceMode)(employee)
    });
});
exports.mobileFinalizeLogin = mobileFinalizeLogin;
const refreshAccessToken = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const { refreshToken } = req.body;
    const stored = yield prisma_1.prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true }
    });
    if (!stored || stored.expiresAt < new Date()) {
        return res.status(401).json({ message: 'Invalid refresh token' });
    }
    const employee = yield prisma_1.prisma.employee.findFirst({
        where: { employeeCode: stored.user.employeeCode },
        include: { role: { select: { name: true } } }
    });
    if (!employee) {
        return res.status(404).json({ message: 'Employee not found' });
    }
    const accessToken = jsonwebtoken_1.default.sign({
        userId: stored.user.id,
        role: (_b = (_a = employee.role) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : stored.user.role,
        empId: employee.id,
    }, config_1.config.jwtSecret, { expiresIn: '12h' });
    res.json({ accessToken });
});
exports.refreshAccessToken = refreshAccessToken;
