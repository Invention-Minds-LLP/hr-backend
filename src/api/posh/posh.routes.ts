import { Router } from "express";
import {
  createPoshCase,
  listPoshCases,
  addHearing,
  updatePoshStatus,
  getHearings,
  setHearingAttendees,
  getHearingAttendees,
} from "./posh.controller";
import { getPoshCommitteeAcks } from "../grievance/grievance.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.post ("/",                              authenticateToken, createPoshCase);
router.get  ("/",                              authenticateToken, listPoshCases);
router.post ("/:id/hearing",                   authenticateToken, addHearing);
router.get  ("/:id/hearing",                   authenticateToken, getHearings);
router.patch("/:id/status",                    authenticateToken, updatePoshStatus);
// Hearing attendees (quorum audit trail)
router.post ("/hearings/:hearingId/attendees", authenticateToken, setHearingAttendees);
router.get  ("/hearings/:hearingId/attendees", authenticateToken, getHearingAttendees);
// Committee-member acknowledgement progress for this case (Phase 6).
router.get  ("/:id/committee-acks",            authenticateToken, getPoshCommitteeAcks);

export default router;
