import { Router } from "express";
import { getCompOffCredits, createCompOff, deleteCompOff } from "./comp-off.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.get("/", authenticateToken, getCompOffCredits);
router.post("/", authenticateToken, createCompOff);
router.delete("/:id", authenticateToken, deleteCompOff);

export default router;
