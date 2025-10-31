import { Router } from "express";
import {
  createRole,
  getRoles,
  getRoleById,
  updateRole,
  deleteRole
} from "./role.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/", authenticateToken,createRole);
router.get("/", authenticateToken,getRoles);
router.get("/:id", authenticateToken,getRoleById);
router.put("/:id", authenticateToken,updateRole);
router.delete("/:id",authenticateToken, deleteRole);

export default router;
