// routes/auth.routes.ts
import { Router } from "express";
import {
    mobilePhoneInit,
    mobilePhoneVerify,
    mobileConfirmIdentity,
    mobileEmailInit,
    mobileEmailVerify,
    mobileFinalizeLogin,
    refreshAccessToken,
    getMobileClientInfo,
    mobileConfirmClient
} from "./mobile-auth.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();
router.post('/mobile/phone/init', mobilePhoneInit);
router.post('/mobile/phone/verify', mobilePhoneVerify);
router.post('/mobile/confirm-identity', mobileConfirmIdentity);
router.post('/mobile/email/init', mobileEmailInit);
router.post('/mobile/email/verify', mobileEmailVerify);
router.post('/mobile/finalize', mobileFinalizeLogin);
router.post('/mobile/refresh', refreshAccessToken);
router.get('/mobile/client', getMobileClientInfo);
router.post('/mobile/confirm-client', mobileConfirmClient);


export default router;
