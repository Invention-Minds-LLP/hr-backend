import { Router } from "express";
import { authenticateToken } from "../../middleware/authMiddleware";
import {
  listCommittees, getCommittee, createCommittee, updateCommittee,
  addCommitteeMember, updateCommitteeMember, removeCommitteeMember,
  checkPoshCompliance,
} from "./committee.controller";

const router = Router();

// Committee CRUD
router.get   ("/",                    authenticateToken, listCommittees);
router.post  ("/",                    authenticateToken, createCommittee);
router.get   ("/:id",                 authenticateToken, getCommittee);
router.patch ("/:id",                 authenticateToken, updateCommittee);

// Members
router.post  ("/:id/members",         authenticateToken, addCommitteeMember);
router.patch ("/members/:memberId",   authenticateToken, updateCommitteeMember);
router.delete("/members/:memberId",   authenticateToken, removeCommitteeMember);

// POSH ICC compliance check (Phase 2)
router.get   ("/:id/posh-compliance", authenticateToken, checkPoshCompliance);

export default router;
