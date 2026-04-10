import { Router } from 'express';
import { DashboardController } from './dashboard.controller';
import {
    messageUnmarked,
    markUnmarkedException,
    bulkApproveApprovals,
    bulkRejectApprovals,
    requestProbationFeedback,
    extendProbation,
    notifyExpiringDocs,
    createRenewalTickets,
    nudgePanel,
    reassignReviewer,
    escalateClearances,
    assignDelegate,
} from './dashboard.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();
const ctrl = new DashboardController();

router.get('', authenticateToken,ctrl.getDashboard);
router.get('/list', authenticateToken,ctrl.getList);
router.get('/missing-docs', ctrl.downloadMissingDocs);
router.get('/recruiting', authenticateToken,ctrl.getRecruiting);
router.post('/ot/approve-reject', authenticateToken,ctrl.approveOrRejectOT);
router.get('/ot/manager-pending', authenticateToken, ctrl.getManagerOtPending);
router.get('/ot/hr-pending', authenticateToken, ctrl.getHROtPending);
router.post('/ot/manager-approve-reject', authenticateToken,ctrl.approveOrRejectOTManager);
// 1. Unmarked attendance
router.post("/unmarked/message", authenticateToken,messageUnmarked);
router.post("/unmarked/exception", authenticateToken,markUnmarkedException);

// 2. Pending approvals
router.post("/approvals/approve", authenticateToken,bulkApproveApprovals);
router.post("/approvals/reject", authenticateToken,bulkRejectApprovals);

// 3. Probation
router.post("/probation/request-feedback", authenticateToken,requestProbationFeedback);
router.post("/probation/extend", authenticateToken,extendProbation);

// 4. Documents expiring
router.post("/documents/notify", authenticateToken,notifyExpiringDocs);
router.post("/documents/renewal", authenticateToken,createRenewalTickets);

// 5. Interview feedback
router.post("/feedback/nudge", authenticateToken,nudgePanel);
router.post("/feedback/reassign", authenticateToken,reassignReviewer);

// 6. Exit clearances
router.post("/clearances/escalate", authenticateToken,escalateClearances);
router.post("/clearances/assign", authenticateToken,assignDelegate);

// automation: create vacancy from approved resignation
router.post('/recruiting/backfill-from-resignation', authenticateToken,ctrl.createBackfillFromResignation);

export default router;
