// ─────────────────────────────────────────────────────────────────────────────
//  Web session helpers  (browser / hr-frontend only)
//
//  The browser no longer keeps a long-lived JWT in localStorage. Instead:
//
//    access token   short-lived JWT (ACCESS_TTL, default 15m) returned in the
//                   login/refresh response BODY. The SPA holds it in a JS
//                   variable only — never localStorage — so XSS can't scrape a
//                   session out of storage and a stolen token dies in minutes.
//
//    refresh token  48 random bytes, handed to the browser in the httpOnly
//                   `hr_rt` cookie (unreadable from JS) and stored SHA-256
//                   HASHED in the RefreshToken table. That row IS the session:
//                   the server can revoke it, and it's rotated on every use.
//
//    csrf token     readable `hr_csrf` cookie echoed back in the X-CSRF-Token
//                   header (double-submit). Required on the two cookie-only
//                   endpoints (/refresh, /logout) since those carry no bearer.
//
//  Mobile (/api/auth/mobile/*) is untouched: it keeps its own opaque refresh
//  token in the request body. Its rows store the RAW token in the same column,
//  which can never collide with a 64-char hex hash.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { config } from "../../config";

export const REFRESH_COOKIE = "hr_rt";
export const CSRF_COOKIE = "hr_csrf";

const ACCESS_TTL = config.auth.accessTtl;
const REFRESH_TTL_DAYS = config.auth.refreshTtlDays;
const REFRESH_TTL_MS = REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/**
 * Read a single cookie off the raw header.
 *
 * Deliberately hand-rolled: the app doesn't depend on cookie-parser and these
 * are the only two cookies we ever read, so a 10-line reader beats a new
 * dependency and an extra global middleware.
 */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/**
 * Cookie flags are derived PER REQUEST, not from a build-time constant.
 *
 * The same backend serves the SPA over plain http on a LAN (192.168.x:4300)
 * and over https in production behind nginx. `SameSite=None` is rejected by
 * browsers unless `Secure` is also set — and `Secure` cookies are dropped over
 * http — so a single hardcoded pair would silently break one of the two.
 * Requires `app.set("trust proxy", 1)` (already set in index.ts) for
 * x-forwarded-proto to be believable.
 */
function cookieBaseOptions(req: Request) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const isHttps = req.secure || forwardedProto === "https";
  return {
    secure: isHttps,
    sameSite: (isHttps ? "none" : "lax") as "none" | "lax",
    domain: config.auth.cookieDomain || undefined,
    path: "/",
  };
}

/** Sign the short-lived access token. Payload shape is unchanged from the
 *  original 12h token, so every downstream `req.user.*` read still works. */
export function signAccessToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: ACCESS_TTL as any });
}

/** Mint a refresh token: raw value to the caller (cookie), hash to the DB. */
export async function createRefreshToken(userId: number, req: Request): Promise<string> {
  const raw = crypto.randomBytes(48).toString("hex");
  await prisma.refreshToken.create({
    data: {
      userId,
      token: sha256(raw),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: (req.headers["user-agent"] as string) || null,
      ipAddress: req.ip || null,
    },
  });
  return raw;
}

/** Resolve a raw refresh token to its live session row, or null. */
export async function validateRefreshToken(raw?: string) {
  if (!raw) return null;
  const row = await prisma.refreshToken.findUnique({ where: { token: sha256(raw) } });
  if (!row || row.revokedAt || row.expiresAt < new Date()) return null;
  return row;
}

export async function revokeRefreshTokenById(id: number): Promise<void> {
  await prisma.refreshToken
    .updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } })
    .catch(() => { });
}

export async function revokeRefreshTokenByRaw(raw?: string): Promise<void> {
  if (!raw) return;
  await prisma.refreshToken
    .updateMany({ where: { token: sha256(raw), revokedAt: null }, data: { revokedAt: new Date() } })
    .catch(() => { });
}

export function setRefreshCookie(res: Response, raw: string, req: Request): void {
  res.cookie(REFRESH_COOKIE, raw, {
    ...cookieBaseOptions(req),
    httpOnly: true,
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearAuthCookies(res: Response, req: Request): void {
  const base = cookieBaseOptions(req);
  res.clearCookie(REFRESH_COOKIE, { ...base, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false });
}

/** Issue the double-submit CSRF cookie. Readable by JS on purpose — the SPA
 *  has to copy it into the X-CSRF-Token header. */
export function issueCsrfCookie(res: Response, req: Request): string {
  const token = crypto.randomBytes(24).toString("hex");
  res.cookie(CSRF_COOKIE, token, {
    ...cookieBaseOptions(req),
    httpOnly: false,
    maxAge: REFRESH_TTL_MS,
  });
  return token;
}

/** Cookie value must match the header the caller sent. A cross-site page can
 *  make the browser send the cookie but can't read it to set the header. */
export function csrfOk(req: Request): boolean {
  const cookie = readCookie(req, CSRF_COOKIE);
  const header = req.headers["x-csrf-token"];
  return !!cookie && !!header && cookie === header;
}
