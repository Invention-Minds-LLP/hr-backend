"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// routes/auth.routes.ts
const express_1 = require("express");
const mobile_auth_controller_1 = require("./mobile-auth.controller");
const router = (0, express_1.Router)();
router.post('/mobile/phone/init', mobile_auth_controller_1.mobilePhoneInit);
router.post('/mobile/phone/verify', mobile_auth_controller_1.mobilePhoneVerify);
router.post('/mobile/confirm-identity', mobile_auth_controller_1.mobileConfirmIdentity);
router.post('/mobile/email/init', mobile_auth_controller_1.mobileEmailInit);
router.post('/mobile/email/verify', mobile_auth_controller_1.mobileEmailVerify);
router.post('/mobile/finalize', mobile_auth_controller_1.mobileFinalizeLogin);
router.post('/mobile/refresh', mobile_auth_controller_1.refreshAccessToken);
router.get('/mobile/client', mobile_auth_controller_1.getMobileClientInfo);
router.post('/mobile/confirm-client', mobile_auth_controller_1.mobileConfirmClient);
exports.default = router;
