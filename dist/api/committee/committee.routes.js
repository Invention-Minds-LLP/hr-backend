"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const committee_controller_1 = require("./committee.controller");
const router = (0, express_1.Router)();
// Committee CRUD
router.get("/", authMiddleware_1.authenticateToken, committee_controller_1.listCommittees);
router.post("/", authMiddleware_1.authenticateToken, committee_controller_1.createCommittee);
router.get("/:id", authMiddleware_1.authenticateToken, committee_controller_1.getCommittee);
router.patch("/:id", authMiddleware_1.authenticateToken, committee_controller_1.updateCommittee);
// Members
router.post("/:id/members", authMiddleware_1.authenticateToken, committee_controller_1.addCommitteeMember);
router.patch("/members/:memberId", authMiddleware_1.authenticateToken, committee_controller_1.updateCommitteeMember);
router.delete("/members/:memberId", authMiddleware_1.authenticateToken, committee_controller_1.removeCommitteeMember);
// POSH ICC compliance check (Phase 2)
router.get("/:id/posh-compliance", authMiddleware_1.authenticateToken, committee_controller_1.checkPoshCompliance);
exports.default = router;
