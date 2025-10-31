import { Router } from "express";
import {
  createGrievance,
  listGrievances,
  addGrievanceComment,
  updateGrievanceStatus,
} from "./grievance.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/",authenticateToken, createGrievance);
router.get("/", authenticateToken,listGrievances);
router.post("/:id/comment", authenticateToken,addGrievanceComment);
router.patch("/:id/status", authenticateToken,updateGrievanceStatus);

export default router;
