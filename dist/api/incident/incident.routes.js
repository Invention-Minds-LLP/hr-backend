"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const incident_controller_1 = require("./incident.controller");
const router = (0, express_1.Router)();
// Create an incident
router.post("/", authMiddleware_1.authenticateToken, incident_controller_1.createIncident);
router.get("/", incident_controller_1.listAllIncidents);
// List incidents reported by manager
router.get("/reported-by/:reporterId", authMiddleware_1.authenticateToken, incident_controller_1.listIncidentsByReporter);
// List incidents against an employee
router.get("/employee/:employeeId", authMiddleware_1.authenticateToken, incident_controller_1.listIncidentsByEmployee);
exports.default = router;
