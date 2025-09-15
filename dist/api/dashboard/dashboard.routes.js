"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dashboard_controller_1 = require("./dashboard.controller");
const router = (0, express_1.Router)();
const ctrl = new dashboard_controller_1.DashboardController();
router.get('', ctrl.getDashboard);
router.get('/list', ctrl.getList);
router.get('/recruiting', ctrl.getRecruiting);
router.post('/ot/approve-reject', ctrl.approveOrRejectOT);
// automation: create vacancy from approved resignation
router.post('/recruiting/backfill-from-resignation', ctrl.createBackfillFromResignation);
exports.default = router;
