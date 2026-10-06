import { Router } from "express";
import { adminResetPassword, createUser, listAllUsers, loginCandidate, loginInit, loginUser, logout, refreshAccessToken, resetMyPassword, setCandidatePassword, syncUsersFromEmployees, verifyCandidateOtp, verifyOtp } from "./user.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/register", authenticateToken, createUser);
router.post("/login",loginUser);
router.post("/reset-password", authenticateToken, resetMyPassword); // self-serve
router.post("/admin/reset-password", authenticateToken, adminResetPassword); // admin only
router.post("/candidate/set-password", authenticateToken,setCandidatePassword);
// Candidate portal login is two-step: password sends an emailed OTP, the OTP
// exchanges for the session token. /candidate/login no longer returns a token.
router.post("/candidate/login",loginCandidate);
router.post("/candidate/login/verify-otp", verifyCandidateOtp);
router.post('/login-init', loginInit);
router.post('/verify-otp', verifyOtp);
// Cookie-authenticated (httpOnly refresh cookie + X-CSRF-Token header). No
// bearer token — by design, since these are what the SPA calls when its
// in-memory access token is missing or expired.
router.post('/refresh', refreshAccessToken);
router.post('/logout', logout);

// Users listing (admin)
router.get("/users", authenticateToken, listAllUsers);
router.post("/user-creation", authenticateToken, syncUsersFromEmployees);

export default router;
