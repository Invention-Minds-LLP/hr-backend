/**
 * One-shot data migration — canonicalize WeeklyPerformanceRating.weekStartDate.
 *
 * Historically SELF and MANAGER ratings were saved with the week date serialized
 * differently (SELF sent a full ISO instant = IST-midnight → previous-day 18:30
 * UTC; MANAGER sent a date-only string → UTC midnight). So the two rows for the
 * same week were stored ~5.5h apart and never paired on exact weekStartDate.
 *
 * This rewrites every row's weekStartDate to the canonical IST week-start
 * (Monday 00:00 IST) and weekEndDate to Monday+6, matching what submitRating now
 * stores. Rows that collapse onto the same (employeeId, weekStartDate, raterType)
 * are de-duplicated, keeping the most recently updated one.
 *
 * Run from the repo root:
 *   npx ts-node src/scripts/normalize-weekly-rating-dates.ts          # DRY RUN (no writes)
 *   npx ts-node src/scripts/normalize-weekly-rating-dates.ts --apply  # actually migrate
 */

import 'dotenv/config';
import { prisma } from '../lib/prisma';

// Snap an instant to the NEAREST IST Monday (00:00 IST).
//
// NOTE: this is deliberately "nearest", not "previous Monday" like the live
// controller. Legacy manager rows were saved date-only → UTC midnight, which is
// Sunday 05:30 IST (one day BEFORE the intended Monday); the matching self rows
// were saved at 18:30 UTC = Monday 00:00 IST. Snapping to the previous Monday
// would push the Sunday-shifted manager rows a whole week earlier and split them
// from the self rows. Nearest-Monday maps both onto the same Monday so they pair.
function nearestIstMonday(now: Date): Date {
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const dow = ist.getDay();            // 0=Sun..6=Sat
  const prev = (dow + 6) % 7;          // days back to Monday
  const next = (8 - dow) % 7;          // days forward to Monday (0 if already Monday)
  const shift = next === 0 ? 0 : (next < prev ? next : -prev); // ties → previous
  const mon = new Date(ist);
  mon.setDate(ist.getDate() + shift);
  const pad = (n: number) => String(n).padStart(2, '0');
  return new Date(`${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}T00:00:00+05:30`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`[normalize-wkr] ${apply ? 'APPLY' : 'DRY RUN'} — scanning weekly ratings…`);

  const rows = await prisma.weeklyPerformanceRating.findMany({
    select: { id: true, employeeId: true, raterType: true, weekStartDate: true, weekEndDate: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });

  let updated = 0;
  let unchanged = 0;
  let deletedDupes = 0;

  // key = employeeId|raterType|canonicalISO → the row we keep for that slot
  const kept = new Map<string, { id: number; updatedAt: Date }>();

  for (const r of rows) {
    const canon = nearestIstMonday(new Date(r.weekStartDate));
    const end = new Date(canon);
    end.setDate(canon.getDate() + 6);
    const key = `${r.employeeId}|${r.raterType}|${canon.toISOString()}`;

    const winner = kept.get(key);
    if (winner) {
      // Collision: two rows map to the same canonical week. Keep the newer one.
      const loserId = r.updatedAt > winner.updatedAt ? winner.id : r.id;
      const keepId = r.updatedAt > winner.updatedAt ? r.id : winner.id;
      console.log(`[normalize-wkr] dup emp=${r.employeeId} ${r.raterType} ${canon.toISOString().slice(0, 10)} → keep #${keepId}, delete #${loserId}`);
      if (apply) {
        await prisma.weeklyRatingAnswer.deleteMany({ where: { ratingId: loserId } });
        await prisma.weeklyPerformanceRating.delete({ where: { id: loserId } });
        await prisma.weeklyPerformanceRating.update({ where: { id: keepId }, data: { weekStartDate: canon, weekEndDate: end } });
      }
      deletedDupes++;
      kept.set(key, { id: keepId, updatedAt: r.updatedAt > winner.updatedAt ? r.updatedAt : winner.updatedAt });
      continue;
    }

    kept.set(key, { id: r.id, updatedAt: r.updatedAt });

    const alreadyCanonical = new Date(r.weekStartDate).getTime() === canon.getTime();
    if (alreadyCanonical) {
      unchanged++;
      continue;
    }
    console.log(`[normalize-wkr] emp=${r.employeeId} ${r.raterType} #${r.id}: ${new Date(r.weekStartDate).toISOString()} → ${canon.toISOString()}`);
    if (apply) {
      await prisma.weeklyPerformanceRating.update({ where: { id: r.id }, data: { weekStartDate: canon, weekEndDate: end } });
    }
    updated++;
  }

  console.log(`[normalize-wkr] done. updated=${updated}, unchanged=${unchanged}, duplicatesRemoved=${deletedDupes}, total=${rows.length}`);
  if (!apply) console.log('[normalize-wkr] DRY RUN only — re-run with --apply to write changes.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
