// ─────────────────────────────────────────────────────────────────────────────
//  One-time multi-company rollout script.
//
//      npm run company:backfill
//
//  Creates the default company if none exists, points every employee and
//  payroll run with a NULL companyId at it, and seeds a starting StatutoryConfig
//  carrying the same PF/ESI/PT RATES the code used before Phase 1.
//
//  ⚠️  Rates are preserved, but the WAGE BASE changed, so future runs will not
//      always match past ones. PF and ESI are now computed on wages actually
//      earned rather than on the full-month salary. The old behaviour charged
//      full PF/ESI to an employee with zero present days, producing a negative
//      net pay; contributions are legally due on wages paid, so the new figure
//      is the correct one. Employees with no LOP are unaffected.
//      Already-stored payslips are never recomputed.
//
//  Idempotent: safe to run more than once.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../lib/prisma';
import { getDefaultCompany, backfillCompanyIds } from '../lib/company';
import { LEGACY_DEFAULT_RATES } from '../api/payroll/calc/statutory';

async function main() {
  console.log('Multi-company backfill\n' + '─'.repeat(40));

  const company = await getDefaultCompany();
  console.log(`Default company: #${company.id} — ${company.name}`);

  const result = await backfillCompanyIds();
  console.log(`Employees updated:    ${result.employeesUpdated}`);
  console.log(`Payroll runs updated: ${result.payrollRunsUpdated}`);

  // Seed a statutory config only if the company has none. Effective from a date
  // far enough back that it applies to every historic month.
  const existing = await (prisma as any).statutoryConfig.count({
    where: { companyId: company.id },
  });

  if (existing > 0) {
    console.log(`Statutory config:     ${existing} already present, leaving untouched`);
  } else {
    await (prisma as any).statutoryConfig.create({
      data: {
        companyId: company.id,
        effectiveFrom: new Date('2000-01-01'),
        notes: 'Seeded by company:backfill — reproduces the pre-Phase-1 hardcoded rates.',
        pfEnabled: LEGACY_DEFAULT_RATES.pfEnabled,
        pfEmployeeRate: LEGACY_DEFAULT_RATES.pfEmployeeRate,
        pfEmployerRate: LEGACY_DEFAULT_RATES.pfEmployerRate,
        pfWageCeiling: LEGACY_DEFAULT_RATES.pfWageCeiling,
        pfCapAtCeiling: LEGACY_DEFAULT_RATES.pfCapAtCeiling,
        pfAdminChargeRate: LEGACY_DEFAULT_RATES.pfAdminChargeRate,
        edliRate: LEGACY_DEFAULT_RATES.edliRate,
        epsRate: LEGACY_DEFAULT_RATES.epsRate,
        esiEnabled: LEGACY_DEFAULT_RATES.esiEnabled,
        esiEmployeeRate: LEGACY_DEFAULT_RATES.esiEmployeeRate,
        esiEmployerRate: LEGACY_DEFAULT_RATES.esiEmployerRate,
        esiWageLimit: LEGACY_DEFAULT_RATES.esiWageLimit,
        ptEnabled: LEGACY_DEFAULT_RATES.ptEnabled,
        lwfEnabled: LEGACY_DEFAULT_RATES.lwfEnabled,
        gratuityEnabled: LEGACY_DEFAULT_RATES.gratuityEnabled,
        gratuityRate: LEGACY_DEFAULT_RATES.gratuityRate,
        bonusEnabled: LEGACY_DEFAULT_RATES.bonusEnabled,
        bonusRate: LEGACY_DEFAULT_RATES.bonusRate,
        bonusEligibilityWage: LEGACY_DEFAULT_RATES.bonusEligibilityWage,
        bonusCalculationCap: LEGACY_DEFAULT_RATES.bonusCalculationCap,
        leaveEncashEnabled: LEGACY_DEFAULT_RATES.leaveEncashEnabled,
        leaveEncashDaysYear: LEGACY_DEFAULT_RATES.leaveEncashDaysYear,
      },
    });
    console.log('Statutory config:     seeded with legacy-equivalent rates');
  }

  console.log('\nDone. Review the rates under Settings → Companies → Statutory');
  console.log('before the next payroll run, and switch LWF on if your state requires it.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
