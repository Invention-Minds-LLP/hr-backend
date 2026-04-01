import { Router } from "express";
import {
  createDesignation,
  getDesignations,
  getDesignationById,
  updateDesignation,
  deleteDesignation,
} from "./designation.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/", authenticateToken, createDesignation);
router.get("/", authenticateToken, getDesignations);
router.get("/:id", authenticateToken, getDesignationById);
router.put("/:id", authenticateToken, updateDesignation);
router.delete("/:id", authenticateToken, deleteDesignation);

export default router;
