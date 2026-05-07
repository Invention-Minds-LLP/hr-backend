import { Router } from "express";
import { createRequisition, listRequisitions, updateRequisitionStatus, withdrawRequisition } from "./requisition.controller";
import { authenticateToken } from "../../middleware/authMiddleware";
console.log("🚀 requisition.routes.ts loaded!");

const router = Router();

router.post("/",authenticateToken, createRequisition);
router.get("/", authenticateToken,listRequisitions);
router.patch("/:id/status",authenticateToken, updateRequisitionStatus);
router.patch("/:id/withdraw", authenticateToken, withdrawRequisition);

export default router;
