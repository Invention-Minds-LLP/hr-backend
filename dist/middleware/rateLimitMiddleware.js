"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimit = rateLimit;
const buckets = new Map();
// Periodic cleanup so the map doesn't grow unbounded
setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets.entries()) {
        if (b.resetAt <= now)
            buckets.delete(key);
    }
}, 60000).unref();
function getClientIp(req) {
    var _a;
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd)
        return fwd.split(',')[0].trim();
    return ((_a = req.socket) === null || _a === void 0 ? void 0 : _a.remoteAddress) || 'unknown';
}
function rateLimit(opts) {
    const { max, windowMs, keyPrefix = 'rl' } = opts;
    return (req, res, next) => {
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
