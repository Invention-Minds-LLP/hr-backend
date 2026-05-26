import { Router } from "express";
import {
  createGrievance,
  listGrievances,
  addGrievanceComment,
  updateGrievanceStatus,
  createAcknowledgement,
  getAcknowledgementsByEmployee,
  checkAcknowledgement,
  getUnacknowledgedComplaints,
  getGrievanceCommitteeAcks,
  getPoshCommitteeAcks,
} from "./grievance.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post("/",authenticateToken, createGrievance);
router.get("/", authenticateToken,listGrievances);
router.post("/:id/comment", authenticateToken,addGrievanceComment);
router.patch("/:id/status", authenticateToken,updateGrievanceStatus);
router.post("/acknowledge", createAcknowledgement);

// Get all acknowledgements for an employee
router.get("/acknowledge/:employeeId", getAcknowledgementsByEmployee);

// Check if already acknowledged
router.get("/acknowledge", checkAcknowledgement);
router.get("/get-unacknowledged/:employeeId", getUnacknowledgedComplaints)

// Committee-member acknowledgement progress for a case (Phase 6).
router.get("/:id/committee-acks", authenticateToken, getGrievanceCommitteeAcks);

export default router;
