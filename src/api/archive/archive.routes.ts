import { Router } from "express";
import {
  listArchive,
  listArchiveModules,
  archive,
  restore,
} from "./archive.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

// Static "modules" first so it isn't swallowed by a parameterised route later.
router.get("/modules", authenticateToken, listArchiveModules);
router.get("/", authenticateToken, listArchive);
router.post("/", authenticateToken, archive);
router.post("/restore", authenticateToken, restore);

export default router;
