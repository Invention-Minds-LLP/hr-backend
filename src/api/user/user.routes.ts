import { Router } from "express";
import { adminResetPassword, createUser, listAllUsers, loginCandidate, loginUser, resetMyPassword, setCandidatePassword } from "./user.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/register", authenticateToken,createUser);
router.post("/login",loginUser);
router.post("/reset-password", authenticateToken,resetMyPassword); // self-serve
router.post("/admin/reset-password", authenticateToken,adminResetPassword); // admin only
router.post("/candidate/set-password", authenticateToken,setCandidatePassword);
router.post("/candidate/login",loginCandidate);

// Users listing (admin)
router.get("/users", listAllUsers);

export default router;
