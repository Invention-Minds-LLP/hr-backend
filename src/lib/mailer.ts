// Shared nodemailer transporter.
//
// The SMTP transport was previously built inline in utils/sendEmailOtp.ts.
// It's extracted here so any feature that needs to send mail (OTP, security
// alerts, …) reuses one configured transport instead of each re-reading
// config.smtp. Behaviour is identical to the old inline transport.

import nodemailer from 'nodemailer';
import { config } from '../config';

export const mailer = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
});

/** Send a plain email from the configured `from` address. */
export async function sendMail(opts: {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}) {
  return mailer.sendMail({
    from: config.smtp.from,
    to: Array.isArray(opts.to) ? opts.to.join(',') : opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}
