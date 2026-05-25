import { Router } from 'express';
import { sendOtpSmsController } from './sms.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

/**
 * POST /api/sms/send-otp
 * Authenticated only — this hits a paid SMS gateway with a caller-supplied
 * phone number/message, so leaving it public is an open SMS relay.
 */
router.post('/send-otp', authenticateToken, sendOtpSmsController);

export default router;
