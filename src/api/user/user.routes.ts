import { Router } from "express";
import { adminResetPassword, createUser, listAllUsers, loginCandidate, loginUser, resetMyPassword, setCandidatePassword } from "./user.controller";

const router = Router();

router.post("/register", createUser);
router.post("/login", loginUser);
router.post("/reset-password", resetMyPassword); // self-serve
router.post("/admin/reset-password", adminResetPassword); // admin only
router.post("/candidate/set-password", setCandidatePassword);
router.post("/candidate/login", loginCandidate);

// Users listing (admin)
router.get("/users", listAllUsers);

export default router;
