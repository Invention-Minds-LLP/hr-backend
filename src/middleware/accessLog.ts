// API access logging + anonymous-call detection.
//
// Two middlewares, mounted (in index.ts) BEFORE the route handlers:
//
//   softAuth     — decodes a JWT *if one is present*, but NEVER rejects. It only
//                  sets req.user so the logger downstream knows whether the call
//                  was authenticated. The real gate is still authenticateToken
//                  on each protected route; this is purely informational.
//
//   accessLogger — on response finish, records one entry per /api request to:
//                    • a daily-rotated JSONL file (logs/access-YYYY-MM-DD.jsonl)
//                    • the ApiAccessLog table (all requests, or only flagged
//                      ones, per config.security.logAllToDb)
//                  and feeds flagged requests into the security alert buffer.
//
// Everything here is best-effort: logging must never break or slow a request,
// so DB/file writes are fire-and-forget with swallowed errors, and the whole
// thing is gated by config.security.accessLogEnabled.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { classifyRequest, noteSecurityEvent, isFileProbe } from '../lib/securityAlert';

interface DecodedUser {
  empId?: number;
  userId?: number;
  [k: string]: any;
}

/* ── softAuth ────────────────────────────────────────────────────────── */

export function softAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (token) {
    try {
      (req as any).user = jwt.verify(token, config.jwtSecret) as DecodedUser;
    } catch {
      // Invalid/expired token: leave req.user unset → counted as anonymous.
      // We do NOT reject here; protected routes' authenticateToken will.
    }
  }
  next();
}

/* ── file sink (zero-dep, daily rotation) ────────────────────────────── */

const LOG_DIR = path.join(process.cwd(), 'logs');
let logDirReady = false;
function ensureLogDir() {
  if (logDirReady) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logDirReady = true;
  } catch (e) {
    console.error('[accessLog] could not create log dir:', e);
  }
}

function currentLogFile(now: Date): string {
  // access-YYYY-MM-DD.jsonl — one file per day = natural rotation, no size math.
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `access-${y}-${m}-${d}.jsonl`);
}

function writeFileLine(now: Date, entry: Record<string, unknown>) {
  ensureLogDir();
  fs.appendFile(currentLogFile(now), JSON.stringify(entry) + '\n', (err) => {
    if (err) console.error('[accessLog] file append failed:', err.message);
  });
}

/* ── accessLogger ────────────────────────────────────────────────────── */

export function accessLogger(req: Request, res: Response, next: NextFunction) {
  if (!config.security.accessLogEnabled) return next();

  const rawPath = req.originalUrl.split('?')[0];
  const isApi = req.originalUrl.startsWith('/api');
  // A non-/api request for a backend file path (.env, .git, dumps…) is a probe.
  const probe = !isApi && isFileProbe(rawPath);

  // Log API traffic and file-probe attempts only; skip /uploads and root noise.
  if (!isApi && !probe) return next();

  const startedAt = Date.now();

  res.on('finish', () => {
    const now = new Date();
    const durationMs = Date.now() - startedAt;
    // Path without the query string (avoid logging tokens/ids in query params).
    const reqPath = rawPath;
    const user = (req as any).user as DecodedUser | undefined;
    const userId = Number(user?.empId ?? user?.userId) || null;
    const isAnonymous = !user;
    const ip = (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || null;
    const userAgent = req.get('user-agent') || null;
    const statusCode = res.statusCode;

    const rules = classifyRequest({ path: reqPath, statusCode, isAnonymous });
    if (probe) rules.push('FILE_PROBE');
    const suspicious = rules.length > 0;
    const reason = suspicious ? rules.join(',') : null;

    // 1) File sink — always (full forensic trail).
    writeFileLine(now, {
      t: now.toISOString(),
      method: req.method,
      path: reqPath,
      status: statusCode,
      ms: durationMs,
      ip,
      userId,
      anon: isAnonymous,
      suspicious,
      reason,
      ua: userAgent,
    });

    // 2) DB sink — all requests, or only flagged ones, per config.
    if (config.security.logAllToDb || suspicious) {
      prisma.apiAccessLog
        .create({
          data: {
            method: req.method,
            path: reqPath,
            statusCode,
            durationMs,
            ip,
            userAgent,
            userId,
            isAnonymous,
            suspicious,
            reason,
          },
        })
        .catch((e) => console.error('[accessLog] db insert failed:', e?.message || e));
    }

    // 3) Alert buffer — only flagged requests.
    if (suspicious) {
      noteSecurityEvent({
        rules,
        ip: ip || 'unknown',
        path: reqPath,
        userAgent: userAgent || undefined,
        when: now,
      });
    }
  });

  next();
}
