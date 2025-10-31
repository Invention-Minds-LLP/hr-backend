import { Router } from "express";
import { createRequisition, listRequisitions, updateRequisitionStatus } from "./requisition.controller";
import { authenticateToken } from "../../middleware/authMiddleware";
console.log("🚀 requisition.routes.ts loaded!");

const router = Router();

router.post("/",authenticateToken, createRequisition);
router.get("/", authenticateToken,listRequisitions);
router.patch("/:id/status",authenticateToken, updateRequisitionStatus);

export default router;
