/**
 * Nightly directory backfill — pushes the entire active employee list to the
 * central directory service. Acts as a safety net for any real-time sync that
 * may have failed (network blip, directory briefly down, manual DB edits).
 *
 * Runs at 02:30 every day. Configurable via env: DIRECTORY_SYNC_CRON.
 */

import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { syncBulkToDirectory } from '../lib/directory';

const prisma = new PrismaClient();

const SCHEDULE = process.env.DIRECTORY_SYNC_CRON ?? '30 2 * * *';

export function initDirectorySyncCron() {
  if (!process.env.DIRECTORY_URL || !process.env.DIRECTORY_API_KEY) {
    console.log('[directory-sync] DIRECTORY_URL or DIRECTORY_API_KEY not set — nightly cron disabled');
    return;
  }

  cron.schedule(SCHEDULE, async () => {
    console.log('[directory-sync] starting nightly backfill...');

    try {
      const employees = await prisma.employee.findMany({
        where: { phone: { not: '' } },
        select: {
          phone: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          // Treat employees without an employmentStatus = TERMINATED as active.
          // Adjust if your schema uses a different "active" indicator.
          employmentStatus: true,
        },
      });

      const payload = employees.map((e) => ({
        phone: e.phone,
        employeeCode: e.employeeCode,
        firstName: e.firstName,
        lastName: e.lastName,
        isActive: e.employmentStatus !== 'TERMINATED' && e.employmentStatus !== 'RESIGNED',
      }));

      const result = await syncBulkToDirectory(payload);
      if (result.ok) {
        console.log('[directory-sync] nightly OK:', result.result);
      } else {
        console.error('[directory-sync] nightly FAILED:', result.error);
      }
    } catch (err: any) {
      console.error('[directory-sync] nightly cron crashed:', err?.message);
    }
  });

  console.log(`[directory-sync] nightly cron registered (${SCHEDULE})`);
}

/** Run the backfill once, immediately. Call from `npm run sync:directory` or admin endpoint. */
export async function runDirectoryBackfillNow(): Promise<{ ok: boolean; result?: any; error?: string }> {
  const employees = await prisma.employee.findMany({
    where: { phone: { not: '' } },
    select: {
      phone: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      employmentStatus: true,
    },
  });

  const payload = employees.map((e) => ({
    phone: e.phone,
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    isActive: e.employmentStatus !== 'TERMINATED' && e.employmentStatus !== 'RESIGNED',
  }));

  return syncBulkToDirectory(payload);
}
