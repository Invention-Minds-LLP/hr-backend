import { Router } from "express";
import { adminResetPassword, createUser, listAllUsers, loginCandidate, loginInit, loginUser, logout, resetMyPassword, setCandidatePassword, syncUsersFromEmployees, verifyOtp } from "./user.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/register",createUser);
router.post("/login",loginUser);
router.post("/reset-password",resetMyPassword); // self-serve
router.post("/admin/reset-password",adminResetPassword); // admin only
router.post("/candidate/set-password", authenticateToken,setCandidatePassword);
router.post("/candidate/login",loginCandidate);
router.post('/login-init', loginInit);
router.post('/verify-otp', verifyOtp);
router.post('/logout', logout);

// Users listing (admin)
router.get("/users", listAllUsers);
router.post("/user-creation", syncUsersFromEmployees);

export default router;
