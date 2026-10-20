// Checks the DPDP account-security pieces that don't need the database: who
// must use Google Authenticator, the login-challenge / download-grant /
// download-ticket tokens, TOTP codes, and the picture captcha.
//
//   npx ts-node src/scripts/verify-account-security.ts
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { config } from '../config';
import {
  SecurityError,
  createCaptcha,
  isValidDownloadGrant,
  maskEmail,
  readChallenge,
  readDownloadTicket,
  requiresMfa,
  signChallenge,
  signDownloadGrant,
  signDownloadTicket,
  verifyCaptcha,
} from '../lib/accountSecurity';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`));
}

function throwsStatus(fn: () => unknown): number | null {
  try { fn(); return null; } catch (e) { return e instanceof SecurityError ? e.status : -1; }
}

async function main() {
  const hr = config.recruiting.hrDepartmentId;

  console.log('\nWho needs Google Authenticator');
  check('HR department id', requiresMfa({ departmentId: hr, roleId: 2 }), true);
  check('"Management" department by name', requiresMfa({ departmentId: 999, roleId: 2, departmentName: 'Management' }), true);
  check('"Operations" department, any case/spacing', requiresMfa({ departmentId: 999, roleId: 2, departmentName: '  operations ' }), true);
  check('Management role (roleId 4) in another department', requiresMfa({ departmentId: 999, roleId: 4, departmentName: 'SEO' }), true);
  check('Development executive does not', requiresMfa({ departmentId: 999, roleId: 2, departmentName: 'Development' }), false);
  check('"Operations Support" is not "Operations"', requiresMfa({ departmentId: 999, roleId: 2, departmentName: 'Operations Support' }), false);

  console.log('\nLogin challenge');
  check('round-trips the user id', readChallenge(signChallenge(42)), 42);
  check('a download grant is not a login challenge',
    throwsStatus(() => readChallenge(signDownloadGrant(42).grant)), 401);
  check('garbage is rejected', throwsStatus(() => readChallenge('nope')), 401);
  const expired = jwt.sign({ id: 42, purpose: 'login_challenge', exp: Math.floor(Date.now() / 1000) - 5 }, config.jwtSecret);
  check('an expired challenge is rejected', throwsStatus(() => readChallenge(expired)), 401);

  console.log('\nDownload grant + ticket');
  const { grant } = signDownloadGrant(7);
  check('grant valid for its own user', isValidDownloadGrant(grant, 7), true);
  check('grant not valid for another user', isValidDownloadGrant(grant, 8), false);
  check('a login challenge is not a grant', isValidDownloadGrant(signChallenge(7), 7), false);
  const ticket = signDownloadTicket(7, 'log-abc');
  check('ticket yields its log id', readDownloadTicket(ticket, 7), 'log-abc');
  check('ticket is bound to its user', readDownloadTicket(ticket, 8), null);
  check('a grant is not a ticket', readDownloadTicket(grant, 7), null);

  console.log('\nGoogle Authenticator codes (otplib, ±30 s window)');
  const secret = authenticator.generateSecret();
  check('current code verifies', authenticator.verify({ token: authenticator.generate(secret), secret }), true);
  check('a wrong code fails', authenticator.verify({ token: '000000', secret }) && authenticator.generate(secret) !== '000000', false);

  console.log('\nPicture captcha');
  const c = await createCaptcha(7);
  check('PNG image', c.image.startsWith('data:image/png;base64,'), true);
  check('3×3 grid', c.grid, 3);
  check('prompt names a shape', /^Select every tile that contains a (circle|square|triangle|star|heart|plus sign)$/.test(c.prompt), true);
  check('another user cannot use it', throwsStatus(() => verifyCaptcha(c.captchaId, [0], 8)), 410);
  check('…and that attempt consumed it', throwsStatus(() => verifyCaptcha(c.captchaId, [0], 7)), 410);
  const c2 = await createCaptcha(7);
  check('selecting every tile is wrong', throwsStatus(() => verifyCaptcha(c2.captchaId, [0, 1, 2, 3, 4, 5, 6, 7, 8], 7)), 400);
  const c3 = await createCaptcha(7);
  check('an empty answer is wrong', throwsStatus(() => verifyCaptcha(c3.captchaId, [], 7)), 400);

  console.log('\nEmail masking');
  check('keeps two letters + domain', maskEmail('priya.sharma@example.com'), 'pr••••••••••@example.com');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
