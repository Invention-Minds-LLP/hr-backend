// ─────────────────────────────────────────────────────────────────────────────
//  Company (legal entity) CRUD + statutory configuration.
//
//  Company is the legal construct: it owns the PF/ESI/PT registration codes,
//  the payroll runs and the Form 16 identity. Branch remains the location
//  construct. A single-entity client never touches this module — the default
//  company is bootstrapped automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { getDefaultCompany, backfillCompanyIds } from '../../lib/company';

const COMPANY_FIELDS = [
  'name', 'legalName', 'isActive',
  'pan', 'tan', 'gstin', 'cin',
  'pfEstablishmentCode', 'esiEmployerCode', 'ptRegistrationNumber', 'lwfRegistrationNumber',
  'addressLine1', 'addressLine2', 'city', 'state', 'pincode',
  'signatoryName', 'signatoryDesignation', 'signatoryPlace', 'logoUrl',
  'financeEmails',
] as const;

function pickCompanyFields(body: any): Record<string, any> {
  const data: Record<string, any> = {};
  for (const key of COMPANY_FIELDS) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  return data;
}

export const listCompanies = async (_req: Request, res: Response) => {
  try {
    const companies = await (prisma as any).company.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { employees: true, payrollRuns: true } } },
    });

    // Legacy employees with a NULL companyId belong to the default company for
    // every practical purpose; surface that so the count isn't misleading.
    const unassigned = await prisma.employee.count({ where: { companyId: null } as any });

    res.json({ data: companies, unassignedEmployees: unassigned });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getCompany = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const company = await (prisma as any).company.findUnique({
      where: { id },
      include: {
        statutoryConfigs: { orderBy: { effectiveFrom: 'desc' } },
        _count: { select: { employees: true, payrollRuns: true } },
      },
    });
    if (!company) return res.status(404).json({ message: 'Company not found' });
    res.json(company);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const createCompany = async (req: Request, res: Response) => {
  try {
    const data = pickCompanyFields(req.body);
    if (!data.name) return res.status(400).json({ message: 'name is required' });

    // First company created becomes the default.
    const count = await (prisma as any).company.count();
    const company = await (prisma as any).company.create({
      data: { ...data, isDefault: count === 0 },
    });
    res.status(201).json(company);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ message: 'A company with that name already exists' });
    }
    res.status(500).json({ message: err.message });
  }
};

export const updateCompany = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const company = await (prisma as any).company.update({
      where: { id },
      data: pickCompanyFields(req.body),
    });
    res.json(company);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ message: 'A company with that name already exists' });
    }
    res.status(500).json({ message: err.message });
  }
};

/** Exactly one company is the default; switching clears the previous flag. */
export const setDefaultCompany = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const target = await (prisma as any).company.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ message: 'Company not found' });

    await prisma.$transaction(
      async (tx: any) => {
        await tx.company.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        await tx.company.update({ where: { id }, data: { isDefault: true } });
      },
      { maxWait: 15000, timeout: 30000 },
    );

    res.json({ message: 'Default company updated', companyId: id });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** Move employees between legal entities in bulk. */
export const assignEmployees = async (req: Request, res: Response) => {
  try {
    const companyId = Number(req.params.id);
    const employeeIds: number[] = Array.isArray(req.body.employeeIds)
      ? req.body.employeeIds.map(Number).filter(Boolean)
      : [];

    if (!employeeIds.length) {
      return res.status(400).json({ message: 'employeeIds array is required' });
    }

    const company = await (prisma as any).company.findUnique({ where: { id: companyId } });
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const result = await prisma.employee.updateMany({
      where: { id: { in: employeeIds } },
      data: { companyId } as any,
    });

    res.json({ companyId, updated: result.count });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** Point every NULL companyId row at the default company. Idempotent. */
export const runCompanyBackfill = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await backfillCompanyIds();
    res.json({ message: 'Backfill complete', ...result });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getDefault = async (_req: Request, res: Response) => {
  try {
    res.json(await getDefaultCompany());
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── statutory configuration ─────────────────────────────────────────────────

const STATUTORY_FIELDS = [
  'pfEnabled', 'pfEmployeeRate', 'pfEmployerRate', 'pfWageCeiling', 'pfCapAtCeiling',
  'pfAdminChargeRate', 'edliRate', 'epsRate',
  'esiEnabled', 'esiEmployeeRate', 'esiEmployerRate', 'esiWageLimit',
  'ptEnabled', 'ptState', 'ptSlabs',
  'lwfEnabled', 'lwfState', 'lwfEmployeeAmount', 'lwfEmployerAmount',
  'lwfFrequency', 'lwfDeductionMonths',
  'gratuityEnabled', 'gratuityRate', 'gratuityMinYears',
  'bonusEnabled', 'bonusRate', 'bonusEligibilityWage', 'bonusCalculationCap',
  'leaveEncashEnabled', 'leaveEncashDaysYear',
  'notes',
] as const;

export const listStatutoryConfigs = async (req: Request, res: Response) => {
  try {
    const companyId = Number(req.params.id);
    const configs = await (prisma as any).statutoryConfig.findMany({
      where: { companyId },
      orderBy: { effectiveFrom: 'desc' },
    });
    res.json(configs);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Create or replace the config effective from a date. Versioned rather than
 * edited in place so historic payslips stay explainable — payroll always reads
 * the row in force for the month it is processing.
 */
export const upsertStatutoryConfig = async (req: Request, res: Response) => {
  try {
    const companyId = Number(req.params.id);
    const company = await (prisma as any).company.findUnique({ where: { id: companyId } });
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const effectiveFrom = req.body.effectiveFrom
      ? new Date(req.body.effectiveFrom)
      : new Date();

    if (Number.isNaN(effectiveFrom.getTime())) {
      return res.status(400).json({ message: 'effectiveFrom is not a valid date' });
    }

    const data: Record<string, any> = {};
    for (const key of STATUTORY_FIELDS) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }

    // Validate the PT slab shape early — a malformed slab would otherwise fail
    // silently at payroll time by falling back to the defaults.
    if (data.ptSlabs != null) {
      if (!Array.isArray(data.ptSlabs)) {
        return res.status(400).json({ message: 'ptSlabs must be an array' });
      }
      for (const slab of data.ptSlabs) {
        const validUpTo = slab.upTo === null || typeof slab.upTo === 'number';
        if (!validUpTo || typeof slab.amount !== 'number') {
          return res.status(400).json({
            message: 'Each ptSlab needs a numeric "amount" and an "upTo" that is a number or null',
          });
        }
      }
    }

    const config = await (prisma as any).statutoryConfig.upsert({
      where: { companyId_effectiveFrom: { companyId, effectiveFrom } },
      create: { companyId, effectiveFrom, ...data },
      update: data,
    });

    res.json(config);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteStatutoryConfig = async (req: Request, res: Response) => {
  try {
    const configId = Number(req.params.configId);
    await (prisma as any).statutoryConfig.delete({ where: { id: configId } });
    res.json({ message: 'Statutory config deleted' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
