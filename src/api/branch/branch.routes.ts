import { Router } from "express";
import {
  createBranch,
  getBranches,
  getBranchById,
  updateBranch,
  deleteBranch
} from "./branch.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/",authenticateToken, createBranch);
router.get("/", authenticateToken,getBranches);
router.get("/:id",authenticateToken, getBranchById);
router.put("/:id",authenticateToken, updateBranch);
router.delete("/:id",authenticateToken, deleteBranch);

export default router;
