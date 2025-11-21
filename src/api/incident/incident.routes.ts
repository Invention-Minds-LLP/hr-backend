import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  createIncident,
  listIncidentsByEmployee,
  listIncidentsByReporter,
} from "./incident.controller";

const router = Router();

// Create an incident
router.post("/", authenticateToken, createIncident);

// List incidents reported by manager
router.get("/reported-by/:reporterId", authenticateToken, listIncidentsByReporter);

// List incidents against an employee
router.get("/employee/:employeeId", authenticateToken, listIncidentsByEmployee);

export default router;
