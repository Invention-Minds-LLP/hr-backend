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
exports.loginUser = exports.createUser = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// REGISTER / CREATE USER (linked to Employee)
const createUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeCode, username, password, role } = req.body;
        const hashedPassword = yield bcryptjs_1.default.hash(password, 10);
        const user = yield prisma.user.create({
            data: {
                employeeCode,
                username,
                passwordHash: hashedPassword,
                role
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
    try {
        const { employeeCode, password } = req.body;
        const user = yield prisma.user.findUnique({
            where: { employeeCode },
            include: { employee: true }
        });
        if (!user)
            return res.status(404).json({ error: "User not found" });
        const validPassword = yield bcryptjs_1.default.compare(password, user.passwordHash);
        if (!validPassword)
            return res.status(401).json({ error: "Invalid password" });
        // Generate JWT
        const token = jsonwebtoken_1.default.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "1d" });
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
            role: user.role
        });
    }
    catch (error) {
        res.status(500).json({ error: "Login failed" });
    }
});
exports.loginUser = loginUser;
