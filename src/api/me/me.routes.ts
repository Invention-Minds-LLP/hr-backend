import { Router } from "express";
import { getMyPermissions } from "./me.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.get("/permissions", authenticateToken, getMyPermissions);

export default router;
