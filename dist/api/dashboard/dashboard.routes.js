"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dashboard_controller_1 = require("./dashboard.controller");
const dashboard_controller_2 = require("./dashboard.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
const ctrl = new dashboard_controller_1.DashboardController();
router.get('', authMiddleware_1.authenticateToken, ctrl.getDashboard);
router.get('/list', authMiddleware_1.authenticateToken, ctrl.getList);
router.get('/recruiting', authMiddleware_1.authenticateToken, ctrl.getRecruiting);
router.post('/ot/approve-reject', authMiddleware_1.authenticateToken, ctrl.approveOrRejectOT);
// 1. Unmarked attendance
router.post("/unmarked/message", authMiddleware_1.authenticateToken, dashboard_controller_2.messageUnmarked);
router.post("/unmarked/exception", authMiddleware_1.authenticateToken, dashboard_controller_2.markUnmarkedException);
// 2. Pending approvals
router.post("/approvals/approve", authMiddleware_1.authenticateToken, dashboard_controller_2.bulkApproveApprovals);
router.post("/approvals/reject", authMiddleware_1.authenticateToken, dashboard_controller_2.bulkRejectApprovals);
// 3. Probation
router.post("/probation/request-feedback", authMiddleware_1.authenticateToken, dashboard_controller_2.requestProbationFeedback);
router.post("/probation/extend", authMiddleware_1.authenticateToken, dashboard_controller_2.extendProbation);
// 4. Documents expiring
router.post("/documents/notify", authMiddleware_1.authenticateToken, dashboard_controller_2.notifyExpiringDocs);
router.post("/documents/renewal", authMiddleware_1.authenticateToken, dashboard_controller_2.createRenewalTickets);
// 5. Interview feedback
router.post("/feedback/nudge", authMiddleware_1.authenticateToken, dashboard_controller_2.nudgePanel);
router.post("/feedback/reassign", authMiddleware_1.authenticateToken, dashboard_controller_2.reassignReviewer);
// 6. Exit clearances
router.post("/clearances/escalate", authMiddleware_1.authenticateToken, dashboard_controller_2.escalateClearances);
router.post("/clearances/assign", authMiddleware_1.authenticateToken, dashboard_controller_2.assignDelegate);
// automation: create vacancy from approved resignation
router.post('/recruiting/backfill-from-resignation', authMiddleware_1.authenticateToken, ctrl.createBackfillFromResignation);
exports.default = router;
