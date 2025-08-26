import { Router } from "express";
import {
  createBranch,
  getBranches,
  getBranchById,
  updateBranch,
  deleteBranch
} from "./branch.controller";

const router = Router();

router.post("/", createBranch);
router.get("/", getBranches);
router.get("/:id", getBranchById);
router.put("/:id", updateBranch);
router.delete("/:id", deleteBranch);

export default router;
