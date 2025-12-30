import bcrypt from 'bcryptjs';

interface OtpData {
  hash: string;
  expiresAt: number;
}

const otpStore = new Map<string, OtpData>();

export class OtpService {

  async generate(empId: string, otp: string) {
    const hash = await bcrypt.hash(otp, 10);

    otpStore.set(empId, {
      hash,
      expiresAt: Date.now() + 2 * 60 * 1000 // 2 minutes
    });
  }

  async verify(empId: string, otp: string): Promise<boolean> {
    const record = otpStore.get(empId);
    console.log('Verifying OTP for', empId, 'Found record:', record);
    if (!record) return false;

    if (Date.now() > record.expiresAt) {
      otpStore.delete(empId);
      return false;
    }

    const isValid = await bcrypt.compare(otp, record.hash);
    if (!isValid) return false;

    otpStore.delete(empId); // one-time OTP
    return true;
  }
}

export const otpService = new OtpService();
