    import { Router } from 'express';
    import { DashboardController } from './dashboard.controller';

    const router = Router();
    const ctrl = new DashboardController();

    router.get('', ctrl.getDashboard);
    router.get('/list', ctrl.getList);
    router.get('/recruiting', ctrl.getRecruiting);
    router.post('/ot/approve-reject', ctrl.approveOrRejectOT);

    // automation: create vacancy from approved resignation
    router.post('/recruiting/backfill-from-resignation', ctrl.createBackfillFromResignation);

    export default router;
