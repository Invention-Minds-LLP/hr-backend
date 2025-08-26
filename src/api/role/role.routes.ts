import { Router } from "express";
import {
  createRole,
  getRoles,
  getRoleById,
  updateRole,
  deleteRole
} from "./role.controller";

const router = Router();

router.post("/", createRole);
router.get("/", getRoles);
router.get("/:id", getRoleById);
router.put("/:id", updateRole);
router.delete("/:id", deleteRole);

export default router;
