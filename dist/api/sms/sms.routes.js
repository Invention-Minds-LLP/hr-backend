"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const sms_controller_1 = require("./sms.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
/**
 * POST /api/sms/send-otp
 * Authenticated only — this hits a paid SMS gateway with a caller-supplied
 * phone number/message, so leaving it public is an open SMS relay.
 */
router.post('/send-otp', authMiddleware_1.authenticateToken, sms_controller_1.sendOtpSmsController);
exports.default = router;
