import { Router } from "express";
import {
  getEncashmentEligible,
  processEncashment,
  getEncashmentHistory,
} from "./encashment.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.get("/eligible", authenticateToken, getEncashmentEligible);
router.post("/process", authenticateToken, processEncashment);
router.get("/history/:employeeId", authenticateToken, getEncashmentHistory);

export default router;
