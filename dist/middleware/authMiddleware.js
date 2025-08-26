"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || "your_default_secret"; // make sure to store in .env
const authenticateToken = (req, res, next) => {
    var _a;
    const token = (_a = req.headers.authorization) === null || _a === void 0 ? void 0 : _a.split(' ')[1];
    if (!token) {
        res.status(401).json({ message: "Unauthorized: No token provided" });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded; // attach decoded payload to request
        next();
        return;
    }
    catch (error) {
        console.error("JWT verification failed:", error);
        res.status(403).json({ message: "Forbidden: Invalid token" });
        return;
    }
};
exports.authenticateToken = authenticateToken;
