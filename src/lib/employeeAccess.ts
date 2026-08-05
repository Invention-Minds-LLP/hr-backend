/**
 * Employee Access Control
 * ────────────────────────
 * Centralised helpers used by:
 *   • authMiddleware.ts          — to gate every authenticated request
 *   • notifications.controller   — to silently skip inactive recipients
 *   • resignation cron           — to invalidate sessions when status flips
 *
 * The contract: an employee has SYSTEM ACCESS only if they are in
 * `ACTIVE` or `NOTICE_PERIOD` AND their `accessRevokedAt` (if set) is
 * NOT in the future of the token's issued-at time.
 *
 * Status semantics:
 *   ACTIVE / NOTICE_PERIOD  →  full access
 *   RESIGNED / TERMINATED / SUSPENDED / SABBATICAL / DEACTIVATED  →  blocked
 */

import { prisma } from './prisma';

export type EmployeeAccessStatus = {
  exists: boolean;
  active: boolean;            // ACTIVE or NOTICE_PERIOD
  status: string | null;      // raw EmploymentStatus value
  accessRevokedAt: Date | null;
};

// Tiny in-memory cache so we don't hit the DB on every authenticated request.
// 60 second TTL is short enough that revoke-on-fire propagates quickly.
const ACCESS_CACHE_TTL_MS = 60 * 1000;
const accessCache = new Map<number, { value: EmployeeAccessStatus; expires: number }>();

const ACTIVE_STATUSES = new Set(['ACTIVE', 'NOTICE_PERIOD']);

/** Read employee access state. Cached for ACCESS_CACHE_TTL_MS. */
export async function getEmployeeAccess(employeeId: number): Promise<EmployeeAccessStatus> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return { exists: false, active: false, status: null, accessRevokedAt: null };
  }

  const cached = accessCache.get(employeeId);
  if (cached && cached.expires > Date.now()) return cached.value;

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, employmentStatus: true, accessRevokedAt: true } as any,
  }) as any;

  const value: EmployeeAccessStatus = emp
    ? {
        exists: true,
        active: ACTIVE_STATUSES.has(String(emp.employmentStatus)),
        status: String(emp.employmentStatus ?? null),
        accessRevokedAt: emp.accessRevokedAt ?? null,
      }
    : { exists: false, active: false, status: null, accessRevokedAt: null };

  accessCache.set(employeeId, { value, expires: Date.now() + ACCESS_CACHE_TTL_MS });
  return value;
}

/** Quick boolean shortcut. */
export async function isEmployeeActiveForAccess(employeeId: number): Promise<boolean> {
  const a = await getEmployeeAccess(employeeId);
  return a.active;
}

/** Force the cache to forget an employee (called by `revokeEmployeeAccess`). */
export function invalidateAccessCache(employeeId?: number) {
  if (employeeId === undefined) accessCache.clear();
  else accessCache.delete(employeeId);
}

/**
 * Revoke ALL access for an employee. Called when:
 *   • Resignation cron flips their status to RESIGNED
 *   • HR manually terminates / suspends them
 *
 * Side effects (each isolated in its own try/catch — one failure must not
 * stop the rest):
 *   1. Delete DeviceToken rows  → no more mobile push
 *   2. Delete MobileAuthSession → mobile app forced to re-authenticate
 *   3. Delete RefreshToken rows → no web/mobile session can be renewed
 *   4. Stamp accessRevokedAt = now → existing JWTs (browser) become invalid
 *      because the auth middleware compares decoded.iat against this.
 *   5. Invalidate the in-memory cache so the next request sees the change.
 */
export async function revokeEmployeeAccess(
  employeeId: number,
  reason?: string,
): Promise<{ tokensDeleted: number; sessionsDeleted: number; refreshTokensDeleted: number }> {
  const summary = { tokensDeleted: 0, sessionsDeleted: 0, refreshTokensDeleted: 0 };
  console.log(`[access] revoking access for employee ${employeeId}${reason ? ` — ${reason}` : ''}`);

  // 1. Wipe FCM device tokens so push notifications stop immediately.
  try {
    const r = await prisma.deviceToken.deleteMany({ where: { employeeId } });
    summary.tokensDeleted = r.count;
  } catch (e) {
    console.error(`[access] DeviceToken cleanup failed for emp ${employeeId}:`, e);
  }

  // 2. Wipe mobile auth sessions so the mobile app boots back to login.
  try {
    const r = await prisma.mobileAuthSession.deleteMany({ where: { employeeId } });
    summary.sessionsDeleted = r.count;
  } catch (e) {
    console.error(`[access] MobileAuthSession cleanup failed for emp ${employeeId}:`, e);
  }

  // 3. Revoke refresh tokens (web httpOnly-cookie sessions AND mobile's opaque
  //    tokens). Without this, accessRevokedAt only kills the current access
  //    token — the holder could immediately mint a new one from their refresh
  //    token, because a refresh doesn't carry an old `iat` to compare against.
  try {
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { employeeCode: true },
    });
    if (emp?.employeeCode) {
      const r = await prisma.refreshToken.deleteMany({
        where: { user: { employeeCode: emp.employeeCode } },
      });
      summary.refreshTokensDeleted = r.count;
    }
  } catch (e) {
    console.error(`[access] RefreshToken cleanup failed for emp ${employeeId}:`, e);
  }

  // 4. Stamp the revoke timestamp so authenticateToken can refuse old JWTs.
  try {
    await prisma.employee.update({
      where: { id: employeeId },
      data:  { accessRevokedAt: new Date() } as any,
    });
  } catch (e) {
    console.error(`[access] accessRevokedAt update failed for emp ${employeeId}:`, e);
  }

  // 5. Bust the cache so the next authenticated request actually sees the
  //    new state without waiting for the 60s TTL.
  invalidateAccessCache(employeeId);

  console.log(
    `[access] employee ${employeeId} revoked: ` +
    `${summary.tokensDeleted} push token(s) deleted, ` +
    `${summary.sessionsDeleted} mobile session(s) deleted, ` +
    `${summary.refreshTokensDeleted} refresh token(s) deleted.`,
  );
  return summary;
}
