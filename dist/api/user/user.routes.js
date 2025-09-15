"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_controller_1 = require("./user.controller");
const router = (0, express_1.Router)();
router.post("/register", user_controller_1.createUser);
router.post("/login", user_controller_1.loginUser);
router.post("/reset-password", user_controller_1.resetMyPassword); // self-serve
router.post("/admin/reset-password", user_controller_1.adminResetPassword); // admin only
router.post("/candidate/set-password", user_controller_1.setCandidatePassword);
router.post("/candidate/login", user_controller_1.loginCandidate);
// Users listing (admin)
router.get("/users", user_controller_1.listAllUsers);
exports.default = router;
