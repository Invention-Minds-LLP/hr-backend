"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const posh_controller_1 = require("./posh.controller");
const grievance_controller_1 = require("../grievance/grievance.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
router.post("/", authMiddleware_1.authenticateToken, posh_controller_1.createPoshCase);
router.get("/", authMiddleware_1.authenticateToken, posh_controller_1.listPoshCases);
router.post("/:id/hearing", authMiddleware_1.authenticateToken, posh_controller_1.addHearing);
router.get("/:id/hearing", authMiddleware_1.authenticateToken, posh_controller_1.getHearings);
router.patch("/:id/status", authMiddleware_1.authenticateToken, posh_controller_1.updatePoshStatus);
// Hearing attendees (quorum audit trail)
router.post("/hearings/:hearingId/attendees", authMiddleware_1.authenticateToken, posh_controller_1.setHearingAttendees);
router.get("/hearings/:hearingId/attendees", authMiddleware_1.authenticateToken, posh_controller_1.getHearingAttendees);
// Committee-member acknowledgement progress for this case (Phase 6).
router.get("/:id/committee-acks", authMiddleware_1.authenticateToken, grievance_controller_1.getPoshCommitteeAcks);
exports.default = router;
