import { Router } from "express";
import { recordPunch, getTodayPunches, getPunchHistory } from "./mobile-attendance.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/punch", authenticateToken, recordPunch);
router.get("/today/:employeeId", authenticateToken, getTodayPunches);
router.get("/history/:employeeId", authenticateToken, getPunchHistory);

export default router;
