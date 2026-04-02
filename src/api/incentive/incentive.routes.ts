import { Router } from "express";
import { getIncentives, getTeamIncentives, createIncentive, requestIncentive, updateIncentive, deleteIncentive } from "./incentive.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.get("/", authenticateToken, getIncentives);
router.get("/team", authenticateToken, getTeamIncentives);
router.post("/", authenticateToken, createIncentive);
router.post("/request", authenticateToken, requestIncentive);
router.put("/:id", authenticateToken, updateIncentive);
router.delete("/:id", authenticateToken, deleteIncentive);

export default router;
