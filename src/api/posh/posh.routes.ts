import { Router } from "express";
import {
  createPoshCase,
  listPoshCases,
  addHearing,
  updatePoshStatus,
  getHearings,
} from "./posh.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/",authenticateToken, createPoshCase);
router.get("/",authenticateToken, listPoshCases);
router.post("/:id/hearing",authenticateToken, addHearing);
router.get("/:id/hearing",authenticateToken, getHearings);
router.patch("/:id/status",authenticateToken, updatePoshStatus);

export default router;
