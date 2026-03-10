"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const sms_controller_1 = require("./sms.controller");
const router = (0, express_1.Router)();
/**
 * POST /api/sms/send-otp
 */
router.post('/send-otp', sms_controller_1.sendOtpSmsController);
exports.default = router;
