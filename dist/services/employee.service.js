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
exports.UserAuthService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../lib/prisma");
class UserAuthService {
    constructor() {
        this.finalizeLogin = (userId, ipAddress, userAgent) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const user = yield prisma_1.prisma.user.findUnique({
                where: { id: userId },
                include: {
                    employee: {
                        select: {
                            id: true,
                            departmentId: true,
                            photoUrl: true,
                            roleId: true,
                            designation: {
                                select: { name: true }
                            }
                        }
                    }
                }
            });
            if (!user || !user.employee) {
                throw new Error('User or Employee not found');
            }
            // JWT payload (same as loginUser)
            const payload = {
                userId: user.id,
                role: user.role,
                empId: user.employee.id,
                deptId: user.employee.departmentId,
                employeeCode: user.employeeCode,
                username: user.username,
            };
            const token = jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });
            // Update last login
            yield prisma_1.prisma.user.update({
                where: { id: user.id },
                data: { lastLogin: new Date() }
            });
            return {
                token,
                username: user.username,
                employeeCode: user.employeeCode,
                id: user.id,
                role: user.role,
                empId: user.employee.id,
                deptId: user.employee.departmentId,
                designation: ((_a = user.employee.designation) === null || _a === void 0 ? void 0 : _a.name) || '',
                photoUrl: user.employee.photoUrl || null,
                roleId: user.employee.roleId,
            };
        });
    }
    validateCredentials(employeeCode, password) {
        return __awaiter(this, void 0, void 0, function* () {
            const user = yield prisma_1.prisma.user.findUnique({
                where: { employeeCode },
                include: { employee: true }
            });
            if (!user)
                return null;
            const isMatch = yield bcryptjs_1.default.compare(password, user.passwordHash);
            if (!isMatch)
                return null;
            return user;
        });
    }
    getUserWithEmployee(employeeCode) {
        return __awaiter(this, void 0, void 0, function* () {
            return prisma_1.prisma.user.findUnique({
                where: { employeeCode },
                include: { employee: true }
            });
        });
    }
}
exports.UserAuthService = UserAuthService;
