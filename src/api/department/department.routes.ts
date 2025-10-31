import { Router } from "express";
import {
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment
} from "./department.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/", authenticateToken, createDepartment);
router.get("/", authenticateToken,getDepartments);
router.get("/:id",authenticateToken, getDepartmentById);
router.put("/:id",authenticateToken, updateDepartment);
router.delete("/:id", authenticateToken,deleteDepartment);

export default router;
