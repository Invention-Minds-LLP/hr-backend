import { Router } from "express";
import {
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  listClearanceItems,
  saveClearanceItems
} from "./department.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/", authenticateToken, createDepartment);
router.get("/", authenticateToken,getDepartments);
router.get("/:id",authenticateToken, getDepartmentById);
router.get("/:id/clearance-items", authenticateToken, listClearanceItems);
router.put("/:id/clearance-items", authenticateToken, saveClearanceItems);
router.put("/:id",authenticateToken, updateDepartment);
router.delete("/:id", authenticateToken,deleteDepartment);

export default router;
