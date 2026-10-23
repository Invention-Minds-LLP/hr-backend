import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { prisma } from './prisma';
import { config } from '../config';
import { sendMail } from './mailer';

/**
 * DPDP account-security controls (ported from DocMinds):
 *   • Google Authenticator (TOTP) at web login for HR / Management / Operations
 *   • email OTP before downloads — one OTP unlocks downloads for 60 minutes
 *   • every download additionally needs a picture captcha + reason, recorded
 *     in DownloadLog; server file routes consume a one-time ticket for it
 */

const CHALLENGE_TTL = '10m';
const DOWNLOAD_GRANT_TTL_MIN = 60;
const DOWNLOAD_TICKET_TTL = '2m';
const CAPTCHA_TTL_MS = 3 * 60 * 1000;
const EMAIL_OTP_TTL_MIN = 5;
const EMAIL_OTP_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_OTP_MAX_PER_WINDOW = 5;
const EMAIL_OTP_MAX_ATTEMPTS = 5;
const TOTP_ISSUER = config.branding.companyName || 'HR Minds';

export const MIN_REASON = 5;
export const MAX_REASON = 500;

authenticator.options = { window: 1 }; // accept ±30s clock drift

export class SecurityError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---- TOTP secret encryption (AES-256-GCM) ----------------------------------

const keyFrom = (raw: string): Buffer => crypto.createHash('sha256').update(raw).digest();

function encKey(): Buffer {
  return keyFrom(config.security.mfaEncKey || config.jwtSecret);
}

function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decryptWith(key: Buffer, stored: string): string {
  const [iv, tag, data] = stored.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * Decrypts with the current key. Secrets enrolled before MFA_ENC_KEY was set
 * were encrypted with the JWT_SECRET fallback — those still open, and
 * `legacy` tells the caller to re-encrypt under the current key.
 */
function decryptSecret(stored: string): { secret: string; legacy: boolean } {
  try {
    return { secret: decryptWith(encKey(), stored), legacy: false };
  } catch (e) {
    if (!config.security.mfaEncKey) throw e;
    return { secret: decryptWith(keyFrom(config.jwtSecret), stored), legacy: true };
  }
}

// ---- Who needs Google Authenticator ----------------------------------------

export interface MfaSubject {
  departmentId: number;
  roleId: number;
  departmentName?: string | null;
}

export function requiresMfa(emp: MfaSubject): boolean {
  if (!config.security.mfaEnabled) return false;
  if (emp.departmentId === config.recruiting.hrDepartmentId) return true;
  if (config.security.mfaRoleIds.includes(emp.roleId)) return true;
  const name = (emp.departmentName || '').trim().toLowerCase();
  return !!name && config.security.mfaDepartments.some((d) => d.trim().toLowerCase() === name);
}

/** IT (MFA_RESET_DEPARTMENTS) resets a user's authenticator after a lost / reinstalled phone. */
export function canResetMfa(departmentName: string | null | undefined): boolean {
  const name = (departmentName || '').trim().toLowerCase();
  return !!name && config.security.mfaResetDepartments.some((d) => d.trim().toLowerCase() === name);
}

// ---- Login challenge token -------------------------------------------------
// Issued after a correct password when MFA is required. It is NOT a session:
// it only lets the holder call /users/login/mfa within 10 minutes.

interface ChallengePayload {
  id: number;
  purpose: 'login_challenge';
}

export function signChallenge(userId: number): string {
  const payload: ChallengePayload = { id: userId, purpose: 'login_challenge' };
  return jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256', expiresIn: CHALLENGE_TTL });
}

/** Verifies a challenge token; returns the userId it was issued to. */
export function readChallenge(token: unknown): number {
  let payload: ChallengePayload;
  try {
    payload = jwt.verify(String(token ?? ''), config.jwtSecret, { algorithms: ['HS256'] }) as ChallengePayload;
  } catch {
    throw new SecurityError(401, 'Your login session has expired. Please sign in again.');
  }
  if (payload.purpose !== 'login_challenge') throw new SecurityError(401, 'Invalid login session.');
  return payload.id;
}

// ---- Google Authenticator --------------------------------------------------

type TotpUser = { id: number; username: string; employeeCode: string; totpSecret: string | null; totpEnabledAt: Date | null };

/** Returns the pending secret's QR + manual key, creating the secret if needed. */
export async function getMfaSetup(user: TotpUser): Promise<{ qrDataUrl: string; manualKey: string }> {
  let secret: string | null = null;
  if (user.totpSecret && !user.totpEnabledAt) {
    try {
      secret = decryptSecret(user.totpSecret).secret; // keep the same secret across retries
    } catch {
      secret = null; // unreadable pending secret — nothing enrolled yet, so just issue a new one
    }
  }
  if (!secret) {
    secret = authenticator.generateSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: encryptSecret(secret), totpEnabledAt: null } });
  }
  const uri = authenticator.keyuri(user.employeeCode || user.username, TOTP_ISSUER, secret);
  return { qrDataUrl: await QRCode.toDataURL(uri), manualKey: secret };
}

/** Checks a 6-digit authenticator code; enables MFA on the first successful setup. */
export async function verifyMfaCode(user: TotpUser, code: unknown): Promise<void> {
  const token = String(code ?? '').trim();
  if (!/^\d{6}$/.test(token) || !user.totpSecret) throw new SecurityError(400, 'Enter the 6-digit code from Google Authenticator.');
  let secret: string;
  let legacy: boolean;
  try {
    ({ secret, legacy } = decryptSecret(user.totpSecret));
  } catch {
    // Encrypted under a key this server no longer has — IT must reset it.
    throw new SecurityError(409, 'Your authenticator needs to be set up again. Please contact your IT team.');
  }
  if (!authenticator.verify({ token, secret })) {
    throw new SecurityError(401, 'Incorrect authenticator code.');
  }
  const data: { totpEnabledAt?: Date; totpSecret?: string } = {};
  if (!user.totpEnabledAt) data.totpEnabledAt = new Date();
  if (legacy) data.totpSecret = encryptSecret(secret); // move to the current MFA_ENC_KEY
  if (Object.keys(data).length) {
    await prisma.user.update({ where: { id: user.id }, data });
  }
}

// ---- Email OTP -------------------------------------------------------------

const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

type OtpPurpose = 'download';
const PURPOSE_LABEL: Record<OtpPurpose, string> = {
  download: 'downloading a file',
};

async function sendOtpEmail(to: string, otp: string, purposeLabel: string, ttlMinutes: number): Promise<boolean> {
  const brand = config.branding.companyName || 'HR Minds';
  const subject = `${brand} verification code: ${otp}`;
  const text = `Your ${brand} verification code for ${purposeLabel} is ${otp}.\n\n` +
    `It expires in ${ttlMinutes} minutes. If you did not request this, contact HR immediately.`;
  const html = `<div style="font-family: Arial, sans-serif; line-height: 1.6">
    <p>Your ${brand} verification code for <b>${purposeLabel}</b> is:</p>
    <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px">${otp}</p>
    <p>It expires in ${ttlMinutes} minutes.</p>
    <p style="color: #b91c1c"><b>Do not share this code. If you did not request it, contact HR immediately.</b></p>
  </div>`;
  try {
    await sendMail({ to, subject, text, html });
    return true;
  } catch (err) {
    console.error('[accountSecurity] failed to send OTP email:', err);
    return false;
  }
}

/** Generates, stores and emails an OTP. Throws SecurityError on throttle / send failure. */
export async function sendEmailOtp(userId: number, purpose: OtpPurpose, email: string): Promise<{ expiresAt: Date }> {
  const since = new Date(Date.now() - EMAIL_OTP_WINDOW_MS);
  const recent = await prisma.userEmailOtp.count({ where: { userId, purpose, createdAt: { gte: since } } });
  if (recent >= EMAIL_OTP_MAX_PER_WINDOW) {
    throw new SecurityError(429, 'Too many OTP requests. Please wait a few minutes and try again.');
  }
  const otp = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_MIN * 60 * 1000);
  // Only the newest OTP for a purpose is usable.
  await prisma.userEmailOtp.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
  await prisma.userEmailOtp.create({ data: { userId, purpose, email, codeHash: sha256(otp), expiresAt } });
  const sent = await sendOtpEmail(email, otp, PURPOSE_LABEL[purpose], EMAIL_OTP_TTL_MIN);
  if (!sent) throw new SecurityError(502, 'We could not send the email right now. Please try again shortly.');
  return { expiresAt };
}

/** Verifies and consumes the latest OTP for a purpose. Returns the email it was sent to. */
export async function verifyEmailOtp(userId: number, purpose: OtpPurpose, otp: unknown): Promise<string> {
  const code = String(otp ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw new SecurityError(400, 'Please enter the 6-digit OTP.');

  const row = await prisma.userEmailOtp.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.expiresAt.getTime() < Date.now()) throw new SecurityError(410, 'This OTP has expired. Please request a new one.');

  // Reserve an attempt atomically so parallel guesses can't exceed the cap.
  const reserved = await prisma.userEmailOtp.updateMany({
    where: { id: row.id, consumedAt: null, attempts: { lt: EMAIL_OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count !== 1) throw new SecurityError(429, 'Too many wrong attempts. Please request a new OTP.');

  const given = Buffer.from(sha256(code), 'hex');
  const stored = Buffer.from(row.codeHash, 'hex');
  if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
    const left = EMAIL_OTP_MAX_ATTEMPTS - (row.attempts + 1);
    if (left <= 0) throw new SecurityError(429, 'Too many wrong attempts. Please request a new OTP.');
    throw new SecurityError(400, `Incorrect OTP. ${left} attempt${left === 1 ? '' : 's'} left.`);
  }

  const consumed = await prisma.userEmailOtp.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw new SecurityError(410, 'This OTP was already used. Please request a new one.');
  return row.email;
}

export const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
};

// ---- Download grant --------------------------------------------------------

export function signDownloadGrant(userId: number): { grant: string; expiresAt: Date } {
  const grant = jwt.sign({ id: userId, purpose: 'download' }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: `${DOWNLOAD_GRANT_TTL_MIN}m`,
  });
  return { grant, expiresAt: new Date(Date.now() + DOWNLOAD_GRANT_TTL_MIN * 60 * 1000) };
}

/** True when the grant is valid and was issued to this user. */
export function isValidDownloadGrant(grant: unknown, userId: number): boolean {
  if (typeof grant !== 'string' || !grant) return false;
  try {
    const p = jwt.verify(grant, config.jwtSecret, { algorithms: ['HS256'] }) as { id: number; purpose: string };
    return p.purpose === 'download' && p.id === userId;
  } catch {
    return false;
  }
}

// ---- Per-download ticket ---------------------------------------------------
// Issued after captcha + reason; binds one server file download to its
// DownloadLog row. Single use is enforced by DownloadLog.servedAt.

export function signDownloadTicket(userId: number, logId: string): string {
  return jwt.sign({ id: userId, purpose: 'download_ticket', logId }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: DOWNLOAD_TICKET_TTL,
  });
}

/** Returns the DownloadLog id the ticket authorises for this user, or null. */
export function readDownloadTicket(ticket: unknown, userId: number): string | null {
  if (typeof ticket !== 'string' || !ticket) return null;
  try {
    const p = jwt.verify(ticket, config.jwtSecret, { algorithms: ['HS256'] }) as { id: number; purpose: string; logId: string };
    return p.purpose === 'download_ticket' && p.id === userId ? p.logId : null;
  } catch {
    return null;
  }
}

// ---- Picture captcha -------------------------------------------------------
// "Select all tiles with a <shape>" on a 3×3 grid. The whole grid is drawn as
// one SVG and rasterised to PNG with sharp, so which tiles hold the target
// never reaches the browser. Shapes vary in size, colour, rotation, fill
// style, and decoys + noise cross tile borders. Answers live in process
// memory (single use, 3 min) — same per-process trade-off as otp.service.ts.

const CAPTCHA_GRID = 3;
const CAPTCHA_TILE = 96;
const CAPTCHA_GAP = 4;

type CaptchaShape = 'circle' | 'square' | 'triangle' | 'star' | 'heart' | 'plus';
const CAPTCHA_SHAPES: Record<CaptchaShape, { label: string; draw: (s: number) => string }> = {
  circle: { label: 'circle', draw: (s) => `<circle r="${(s / 2).toFixed(1)}"/>` },
  square: { label: 'square', draw: (s) => `<rect x="${(-s / 2).toFixed(1)}" y="${(-s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}"/>` },
  triangle: { label: 'triangle', draw: (s) => `<polygon points="0,${(-s / 2).toFixed(1)} ${(s / 2).toFixed(1)},${(s * 0.4).toFixed(1)} ${(-s / 2).toFixed(1)},${(s * 0.4).toFixed(1)}"/>` },
  star: {
    label: 'star',
    draw: (s) => {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 === 0 ? s / 2 : s / 5;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
      });
      return `<polygon points="${pts.join(' ')}"/>`;
    },
  },
  heart: {
    label: 'heart',
    draw: (s) => {
      const f = (n: number) => (n * s).toFixed(1);
      return `<path d="M0 ${f(0.38)} C${f(-0.62)} ${f(-0.08)},${f(-0.28)} ${f(-0.58)},0 ${f(-0.2)} C${f(0.28)} ${f(-0.58)},${f(0.62)} ${f(-0.08)},0 ${f(0.38)}Z"/>`;
    },
  },
  plus: {
    label: 'plus sign',
    draw: (s) => {
      const a = s / 2, b = s / 6;
      return `<polygon points="${[[-b, -a], [b, -a], [b, -b], [a, -b], [a, b], [b, b], [b, a], [-b, a], [-b, b], [-a, b], [-a, -b], [-b, -b]].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}"/>`;
    },
  },
};
const SHAPE_KEYS = Object.keys(CAPTCHA_SHAPES) as CaptchaShape[];

const captchaStore = new Map<string, { hash: string; userId: number; expiresAt: number }>();

const rnd = (min: number, max: number) => min + crypto.randomInt(0, 1_000_000) / 1_000_000 * (max - min);
const darkColor = () => `hsl(${Math.floor(rnd(0, 360))},${Math.floor(rnd(45, 80))}%,${Math.floor(rnd(18, 38))}%)`;

const shuffle = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

/** One shape at (cx, cy): random size, rotation, colour and fill/outline style. */
function shapeSvg(shape: CaptchaShape, cx: number, cy: number, size: number): string {
  const color = darkColor();
  const outline = crypto.randomInt(0, 3) === 0; // 1 in 3 drawn as an outline only
  const style = outline
    ? `fill="none" stroke="${color}" stroke-width="${rnd(3, 5).toFixed(1)}"`
    : `fill="${color}" stroke="${darkColor()}" stroke-width="${rnd(0.5, 2).toFixed(1)}"`;
  return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${rnd(-40, 40).toFixed(1)}) skewX(${rnd(-12, 12).toFixed(1)})" ${style} opacity="${rnd(0.8, 1).toFixed(2)}">` +
    `${CAPTCHA_SHAPES[shape].draw(size)}</g>`;
}

function captchaGridSvg(target: CaptchaShape, targetTiles: Set<number>): string {
  const size = CAPTCHA_GRID * CAPTCHA_TILE + (CAPTCHA_GRID + 1) * CAPTCHA_GAP;
  const parts: string[] = [`<rect width="${size}" height="${size}" fill="#e2e8f0"/>`];
  const others = SHAPE_KEYS.filter((s) => s !== target);

  for (let i = 0; i < CAPTCHA_GRID * CAPTCHA_GRID; i++) {
    const x = CAPTCHA_GAP + (i % CAPTCHA_GRID) * (CAPTCHA_TILE + CAPTCHA_GAP);
    const y = CAPTCHA_GAP + Math.floor(i / CAPTCHA_GRID) * (CAPTCHA_TILE + CAPTCHA_GAP);
    const hue = Math.floor(rnd(0, 360));
    parts.push(`<rect x="${x}" y="${y}" width="${CAPTCHA_TILE}" height="${CAPTCHA_TILE}" rx="6" fill="hsl(${hue},${Math.floor(rnd(35, 60))}%,${Math.floor(rnd(80, 90))}%)"/>`);
    // Background clutter inside the tile.
    for (let k = 0; k < 4; k++) {
      parts.push(`<line x1="${(x + rnd(0, CAPTCHA_TILE)).toFixed(1)}" y1="${(y + rnd(0, CAPTCHA_TILE)).toFixed(1)}" x2="${(x + rnd(0, CAPTCHA_TILE)).toFixed(1)}" y2="${(y + rnd(0, CAPTCHA_TILE)).toFixed(1)}" stroke="hsl(${hue},40%,${Math.floor(rnd(55, 70))}%)" stroke-width="${rnd(1, 3).toFixed(1)}"/>`);
    }
    // A target tile holds the target (sometimes plus a decoy); other tiles
    // hold one or two non-target shapes.
    const shapes: CaptchaShape[] = targetTiles.has(i)
      ? [target, ...(crypto.randomInt(0, 2) ? [others[crypto.randomInt(0, others.length)]] : [])]
      : Array.from({ length: 1 + crypto.randomInt(0, 2) }, () => others[crypto.randomInt(0, others.length)]);
    shuffle(shapes).forEach((shape, idx) => {
      const big = shapes.length === 1;
      const s = big ? rnd(44, 62) : rnd(30, 42);
      const cx = x + (big ? CAPTCHA_TILE / 2 + rnd(-10, 10) : (idx === 0 ? rnd(26, 40) : rnd(56, 70)));
      const cy = y + (big ? CAPTCHA_TILE / 2 + rnd(-10, 10) : rnd(28, 68));
      parts.push(shapeSvg(shape, cx, cy, s));
    });
  }
  // Noise across the whole grid so tiles can't be cleanly cut apart.
  for (let i = 0; i < 5; i++) {
    parts.push(`<path d="M${rnd(-10, 40)} ${rnd(0, size)} C${rnd(60, 140)} ${rnd(-40, size + 40)},${rnd(160, 240)} ${rnd(-40, size + 40)},${rnd(size - 40, size + 10)} ${rnd(0, size)}" stroke="${darkColor()}" stroke-width="${rnd(1, 2.2).toFixed(1)}" fill="none" opacity="0.45"/>`);
  }
  for (let i = 0; i < 260; i++) {
    parts.push(`<circle cx="${rnd(0, size).toFixed(1)}" cy="${rnd(0, size).toFixed(1)}" r="${rnd(0.6, 1.8).toFixed(1)}" fill="${darkColor()}" opacity="0.5"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${parts.join('')}</svg>`;
}

const answerKey = (tiles: number[]): string => [...new Set(tiles)].sort((a, b) => a - b).join(',');

/** Creates a single-use picture captcha for this user. */
export async function createCaptcha(userId: number): Promise<{ captchaId: string; image: string; prompt: string; grid: number }> {
  const now = Date.now();
  for (const [id, c] of captchaStore) if (c.expiresAt < now) captchaStore.delete(id);

  const target = SHAPE_KEYS[crypto.randomInt(0, SHAPE_KEYS.length)];
  const tileCount = CAPTCHA_GRID * CAPTCHA_GRID;
  const targetTiles = new Set(shuffle(Array.from({ length: tileCount }, (_, i) => i)).slice(0, 2 + crypto.randomInt(0, 3))); // 2–4 tiles
  const png = await sharp(Buffer.from(captchaGridSvg(target, targetTiles))).png().toBuffer();
  const captchaId = crypto.randomUUID();
  captchaStore.set(captchaId, { hash: sha256(answerKey([...targetTiles])), userId, expiresAt: now + CAPTCHA_TTL_MS });
  return {
    captchaId,
    image: `data:image/png;base64,${png.toString('base64')}`,
    prompt: `Select every tile that contains a ${CAPTCHA_SHAPES[target].label}`,
    grid: CAPTCHA_GRID,
  };
}

/** Checks (and always consumes) a captcha. `answer` is the selected tile indices (0–8, row by row). */
export function verifyCaptcha(captchaId: unknown, answer: unknown, userId: number): void {
  const entry = typeof captchaId === 'string' ? captchaStore.get(captchaId) : undefined;
  if (typeof captchaId === 'string') captchaStore.delete(captchaId);
  if (!entry || entry.userId !== userId || entry.expiresAt < Date.now()) {
    throw new SecurityError(410, 'The captcha has expired. Please try the new one.');
  }
  const tiles = Array.isArray(answer) ? answer.map(Number) : [];
  const valid = tiles.length > 0 && tiles.every((t) => Number.isInteger(t) && t >= 0 && t < CAPTCHA_GRID * CAPTCHA_GRID);
  if (!valid || sha256(answerKey(tiles)) !== entry.hash) {
    throw new SecurityError(400, 'Incorrect selection. Please try the new picture.');
  }
}
