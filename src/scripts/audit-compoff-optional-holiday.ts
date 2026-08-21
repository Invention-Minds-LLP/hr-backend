// Read-only audit: comp-off credits that were granted for working an OPTIONAL
// holiday (RH). An optional holiday is a normal working day, so working it
// compensates nothing — but isHoliday() used to match optional rows too, and
// auto-generation issued a credit anyway.
//
// A flagged credit is NOT automatically wrong: if the same day was also the
// employee's week-off, the credit was earned for that reason and is fine. Those
// rows are marked so they can be left alone.
//
//   npm run audit:compoff-rh
//
// Writes nothing. Deleting a credit someone may already have spent is a
// decision for HR, not for a script.
import { prisma } from '../lib/prisma';
import { isWeeklyOff } from '../services/comOff.service';

/** IST calendar date, independent of how the DateTime was written. */
const istKey = (d: Date) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const show = (d: Date | null) => (d ? istKey(d) : '—');

async function main() {
  console.log('── Comp-off credits on optional holidays (read-only) ──\n');

  const optional = await prisma.holiday.findMany({
    where: { isOptional: true },
    select: { date: true, title: true, branchId: true },
  });

  if (!optional.length) {
    console.log('  no optional holidays configured — nothing to audit');
    return;
  }

  const byDate = new Map<string, string[]>();
  for (const h of optional) {
    const key = istKey(h.date);
    byDate.set(key, [...(byDate.get(key) ?? []), h.title]);
  }
  console.log(`  optional holidays configured: ${optional.length} across ${byDate.size} date(s)\n`);

  const credits = await prisma.compOffCredit.findMany({
    select: {
      id: true, employeeId: true, workDate: true, expiryDate: true,
      used: true, usedOn: true, isManualGrant: true, grantReason: true,
      employee: { select: { employeeCode: true, firstName: true, lastName: true } },
    },
    orderBy: { workDate: 'asc' },
  });

  let flagged = 0;
  let unused = 0;
  let alsoWeekOff = 0;

  for (const c of credits) {
    const titles = byDate.get(istKey(c.workDate));
    if (!titles) continue;

    // Same day being their week-off is an independent, valid reason to hold it.
    const weekOff = await isWeeklyOff(c.employeeId, new Date(c.workDate));
    flagged++;
    if (weekOff) alsoWeekOff++;
    else if (!c.used) unused++;

    const who = `${c.employee.employeeCode} ${c.employee.firstName} ${c.employee.lastName}`.trim();
    const verdict = weekOff
      ? 'OK — also their week-off'
      : c.used
        ? `ALREADY SPENT on ${show(c.usedOn)} — cannot be undone silently`
        : 'UNEARNED, still unused';

    console.log(
      `  credit #${c.id}  ${istKey(c.workDate)}  ${who}\n` +
      `      holiday: ${titles.join(', ')} (optional)\n` +
      `      granted: ${c.isManualGrant ? `manual — ${c.grantReason ?? 'no reason'}` : 'auto-generated'}\n` +
      `      verdict: ${verdict}\n`,
    );
  }

  console.log(`  credits scanned: ${credits.length}`);
  console.log(`  falling on an optional holiday: ${flagged}`);
  console.log(`    of those, also a week-off (leave alone): ${alsoWeekOff}`);
  console.log(`    unearned and still unused (safe to remove): ${unused}`);
  console.log(`    unearned but already spent (needs an HR decision): ${flagged - alsoWeekOff - unused}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
