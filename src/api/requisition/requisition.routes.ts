import { Router } from "express";
import { createRequisition, listRequisitions, updateRequisitionStatus } from "./requisition.controller";
console.log("🚀 requisition.routes.ts loaded!");

const router = Router();

router.post("/", createRequisition);
router.get("/", listRequisitions);
router.patch("/:id/status", updateRequisitionStatus);

export default router;
