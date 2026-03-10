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
exports.otpService = exports.OtpService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const otpStore = new Map();
class OtpService {
    generate(empId, otp) {
        return __awaiter(this, void 0, void 0, function* () {
            const hash = yield bcryptjs_1.default.hash(otp, 10);
            otpStore.set(empId, {
                hash,
                expiresAt: Date.now() + 2 * 60 * 1000 // 2 minutes
            });
        });
    }
    verify(empId, otp) {
        return __awaiter(this, void 0, void 0, function* () {
            const record = otpStore.get(empId);
            console.log('Verifying OTP for', empId, 'Found record:', record);
            if (!record)
                return false;
            if (Date.now() > record.expiresAt) {
                otpStore.delete(empId);
                return false;
            }
            const isValid = yield bcryptjs_1.default.compare(otp, record.hash);
            if (!isValid)
                return false;
            otpStore.delete(empId); // one-time OTP
            return true;
        });
    }
}
exports.OtpService = OtpService;
exports.otpService = new OtpService();
