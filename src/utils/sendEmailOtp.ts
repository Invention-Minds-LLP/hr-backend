import { config } from '../config';
import { mailer as transporter } from '../lib/mailer';


interface SendEmailOtpParams {
  to: string;
  otp: string;
  employeeName?: string;
  purpose?: string;
}

export const sendEmailOtp = async ({
  to,
  otp,
  employeeName = 'Employee',
  purpose = 'Mobile Login Verification'
}: SendEmailOtpParams) => {
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
    from: config.smtp.from,
    to,
    subject,
    text,
    html
  });
};
