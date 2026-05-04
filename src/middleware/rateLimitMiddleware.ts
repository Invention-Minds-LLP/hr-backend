import { Request, Response, NextFunction } from "express";

/**
 * Lightweight in-memory rate limiter.
 * ────────────────────────────────────
 * Used to protect PUBLIC endpoints (no auth) from abuse — most importantly
 * the anonymous incident-report form. Tracks per-IP request counts in a
 * sliding window. Counters live in process memory; if you scale to multiple
 * Node instances you'll want to swap this for Redis, but for a single-server
 * deployment this is plenty.
 *
 * Usage:
 *   router.post('/public/report', rateLimit({ max: 5, windowMs: 60_000 }), handler)
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Periodic cleanup so the map doesn't grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets.entries()) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();

interface RateLimitOpts {
  /** Max requests per `windowMs` per key */
  max: number;
  /** Window length in milliseconds */
  windowMs: number;
  /** Optional: name a key dimension. Default = client IP. */
  keyPrefix?: string;
}

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function rateLimit(opts: RateLimitOpts) {
  const { max, windowMs, keyPrefix = 'rl' } = opts;
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${keyPrefix}:${getClientIp(req)}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (b.count >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfterSeconds: retryAfterSec,
      });
    }
    b.count++;
    next();
  };
}
