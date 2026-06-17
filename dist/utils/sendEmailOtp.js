"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailOtp = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const config_1 = require("../config");
const transporter = nodemailer_1.default.createTransport({
    host: config_1.config.smtp.host,
    port: config_1.config.smtp.port,
    secure: config_1.config.smtp.secure,
    auth: {
        user: config_1.config.smtp.user,
        pass: config_1.config.smtp.pass
    }
});
const sendEmailOtp = (_a) => __awaiter(void 0, [_a], void 0, function* ({ to, otp, employeeName = 'Employee', purpose = 'Mobile Login Verification' }) {
    const subject = `Your OTP for ${purpose}`;
    const text = `
Dear ${employeeName},

Your One Time Password (OTP) for ${purpose} is:

${otp}

This OTP is valid for 2 minutes.
Please do not share this OTP with anyone.

Regards,
HR Team
`;
    const html = `
  <div style="font-family: Arial, sans-serif; line-height: 1.6">
    <h2>${purpose}</h2>
    <p>Dear <b>${employeeName}</b>,</p>

    <p>Your One Time Password (OTP) is:</p>

    <h1 style="letter-spacing: 4px">${otp}</h1>

    <p>This OTP is valid for <b>2 minutes</b>.</p>
    <p style="color: red"><b>Do not share this OTP with anyone.</b></p>

    <br/>
    <p>Regards,<br/>HR Team</p>
  </div>
`;
    return transporter.sendMail({
        from: config_1.config.smtp.from,
        to,
        subject,
        text,
        html
    });
});
exports.sendEmailOtp = sendEmailOtp;
