"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_controller_1 = require("./user.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
router.post("/register", authMiddleware_1.authenticateToken, user_controller_1.createUser);
router.post("/login", user_controller_1.loginUser);
router.post("/reset-password", authMiddleware_1.authenticateToken, user_controller_1.resetMyPassword); // self-serve
router.post("/admin/reset-password", authMiddleware_1.authenticateToken, user_controller_1.adminResetPassword); // admin only
router.post("/candidate/set-password", authMiddleware_1.authenticateToken, user_controller_1.setCandidatePassword);
router.post("/candidate/login", user_controller_1.loginCandidate);
router.post('/login-init', user_controller_1.loginInit);
router.post('/verify-otp', user_controller_1.verifyOtp);
router.post('/logout', user_controller_1.logout);
// Users listing (admin)
router.get("/users", authMiddleware_1.authenticateToken, user_controller_1.listAllUsers);
router.post("/user-creation", authMiddleware_1.authenticateToken, user_controller_1.syncUsersFromEmployees);
exports.default = router;
