/**
 * One-shot directory backfill — pushes every active employee from this backend
 * to the central HRMinds directory.
 *
 * Run from the repo root:
 *   npx ts-node src/scripts/directory-backfill.ts
 *
 * Requires .env to have:
 *   DIRECTORY_URL
 *   DIRECTORY_API_KEY
 *
 * Use this for the initial population AFTER deploying the directory and
 * before flipping the unified mobile app live.
 */

import 'dotenv/config';
import { runDirectoryBackfillNow } from '../schedulers/directory-sync.scheduler';

async function main() {
  if (!process.env.DIRECTORY_URL || !process.env.DIRECTORY_API_KEY) {
    console.error('❌ DIRECTORY_URL and DIRECTORY_API_KEY must be set in .env');
    process.exit(1);
  }

  console.log('🔄 Pushing all employees to directory...');
  const result = await runDirectoryBackfillNow();
  if (result.ok) {
    console.log('✅ Done:', result.result);
  } else {
    console.error('❌ Failed:', result.error);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ crashed:', e);
  process.exit(1);
});
