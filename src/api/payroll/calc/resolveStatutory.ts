// ─────────────────────────────────────────────────────────────────────────────
//  Loads the StatutoryConfig row that applies to a company for a given payroll
//  month and adapts it to the pure StatutoryRates shape used by statutory.ts.
//
//  Versioning: the applicable row is the one with the latest effectiveFrom that
//  is <= the first day of the payroll month. That means a rate change added
//  today does not retroactively alter last month's payslips.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../../../lib/prisma';
import { StatutoryRates, LEGACY_DEFAULT_RATES } from './statutory';

/**
 * Statutory rates in force for `companyId` during month/year.
 * Falls back to LEGACY_DEFAULT_RATES when the company has no config yet, so
 * payroll keeps working exactly as it did before Phase 1 rather than failing.
 */
export async function resolveStatutoryRates(
  companyId: number,
  month: number,
  year: number,
): Promise<{ rates: StatutoryRates; configId: number | null }> {
  // Last moment of the payroll month — a config effective mid-month still
  // applies to that month's run.
  const asOf = new Date(year, month, 0, 23, 59, 59);

  const config = await (prisma as any).statutoryConfig.findFirst({
    where: { companyId, effectiveFrom: { lte: asOf } },
    orderBy: { effectiveFrom: 'desc' },
  });

  if (!config) return { rates: { ...LEGACY_DEFAULT_RATES }, configId: null };

  return {
    configId: config.id,
    rates: {
      pfEnabled: config.pfEnabled,
      pfEmployeeRate: config.pfEmployeeRate,
      pfEmployerRate: config.pfEmployerRate,
      pfWageCeiling: config.pfWageCeiling,
      pfCapAtCeiling: config.pfCapAtCeiling,
      pfAdminChargeRate: config.pfAdminChargeRate,
      edliRate: config.edliRate,
      epsRate: config.epsRate,

      esiEnabled: config.esiEnabled,
      esiEmployeeRate: config.esiEmployeeRate,
      esiEmployerRate: config.esiEmployerRate,
      esiWageLimit: config.esiWageLimit,

      ptEnabled: config.ptEnabled,
      ptState: config.ptState,
      ptSlabs: config.ptSlabs,

      lwfEnabled: config.lwfEnabled,
      lwfEmployeeAmount: config.lwfEmployeeAmount,
      lwfEmployerAmount: config.lwfEmployerAmount,
      lwfFrequency: config.lwfFrequency,
      lwfDeductionMonths: config.lwfDeductionMonths,

      gratuityEnabled: config.gratuityEnabled,
      gratuityRate: config.gratuityRate,

      bonusEnabled: config.bonusEnabled,
      bonusRate: config.bonusRate,
      bonusEligibilityWage: config.bonusEligibilityWage,
      bonusCalculationCap: config.bonusCalculationCap,

      leaveEncashEnabled: config.leaveEncashEnabled,
      leaveEncashDaysYear: config.leaveEncashDaysYear,
    },
  };
}
