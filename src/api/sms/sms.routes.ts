import { Router } from 'express';
import { sendOtpSmsController } from './sms.controller';

const router = Router();

/**
 * POST /api/sms/send-otp
 */
router.post('/send-otp', sendOtpSmsController);

export default router;
