import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  markForcePresent,
  getForcePresentList,
  getApprovedLeavesOnDate,
} from "./force-present.controller";

const router = Router();

router.post("/", authenticateToken, markForcePresent);
router.get("/", authenticateToken, getForcePresentList);
router.get("/preview", authenticateToken, getApprovedLeavesOnDate);

export default router;
