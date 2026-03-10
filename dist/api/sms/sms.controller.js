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
exports.sendOtpSmsController = exports.sendOtpSms = void 0;
const axios_1 = __importDefault(require("axios"));
// export const sendOtpSms = async ({
//   patientName,
//   otp,
//   service,
//   phoneNumber,
// }: SendOtpSmsParams) => {
//   const apiKey = process.env.SMS_API_KEY;
//   const apiUrl = process.env.SMS_API_URL;
//   const sender = process.env.SMS_SENDER;
//   const dltTemplateId = process.env.SMS_DLT_TE_ID_FOR_OTP;
//   const dltEntityId = process.env.DLT_ENTITY_ID;
//   const message = `Dear ${patientName}, ${otp} is your One Time Password from Rashtrotthana Hospital for ${service} service. Expires in 2 mins. Please do not share this OTP with anyone.`;
//   const url = `${apiUrl}/${sender}/${phoneNumber}/${encodeURIComponent(
//     message
//   )}/TXT?apikey=${apiKey}&dltentityid=${dltEntityId}&dlttempid=${dltTemplateId}`;
//   return axios.get(url);
// };
const sendOtpSms = (_a) => __awaiter(void 0, [_a], void 0, function* ({ patientName, otp, service, phoneNumber, }) {
    var _b, _c;
    try {
        const apiKey = process.env.SMS_API_KEY;
        const apiUrl = process.env.SMS_API_URL;
        const sender = process.env.SMS_SENDER;
        const dltTemplateId = process.env.SMS_DLT_TE_ID_FOR_OTP;
        const dltEntityId = process.env.DLT_ENTITY_ID;
        const message = `Dear ${patientName}, ${otp} is your One Time Password from Rashtrotthana Hospital for ${service} service. Expires in 2 mins. Please do not share this OTP with anyone.`;
        const url = `${apiUrl}/${sender}/${phoneNumber}/${encodeURIComponent(message)}/TXT?apikey=${apiKey}&dltentityid=${dltEntityId}&dlttempid=${dltTemplateId}`;
        const response = yield axios_1.default.get(url);
        console.log("✅ OTP SMS sent successfully", {
            phoneNumber,
            service,
            responseData: response.data,
        });
        return response;
    }
    catch (error) {
        console.error("❌ OTP SMS sending failed", {
            phoneNumber,
            service,
            message: error === null || error === void 0 ? void 0 : error.message,
            status: (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.status,
            data: (_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data,
        });
        throw error; // rethrow so caller can handle it
    }
});
exports.sendOtpSms = sendOtpSms;
const sendOtpSmsController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { patientName, otp, service, patientPhoneNumber } = req.body;
        if (!patientName || !otp || !service || !patientPhoneNumber) {
            res.status(400).json({
                success: false,
                message: 'Missing required fields',
            });
            return;
        }
        const response = yield (0, exports.sendOtpSms)({
            patientName,
            otp,
            service,
            phoneNumber: patientPhoneNumber,
        });
        res.status(200).json({
            success: true,
            message: 'OTP SMS sent successfully',
            providerResponse: response.data,
        });
    }
    catch (error) {
        console.error('SMS Error:', ((_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to send OTP SMS',
        });
    }
});
exports.sendOtpSmsController = sendOtpSmsController;
