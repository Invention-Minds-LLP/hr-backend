// ─────────────────────────────────────────────────────────────────────────────
//  Salary structure templates — CRUD, preview, and bulk assignment.
//
//  The bulk path is the reason this module exists. Defining a structure per
//  employee is fine for ten people and impossible for 250, so HR filters by
//  department / designation / role / branch, picks the matching employees, and
//  assigns one template with one figure each.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { currentEmployeeId } from '../../lib/currentUser';
import { resolveCompanyId, coerceCompanyId } from '../../lib/company';
import { resolveStatutoryRates } from './calc/resolveStatutory';
import {
  validateTemplate, applyTemplate, DEFAULT_COMPONENTS,
  TemplateComponent, InputMode, PERCENTAGE_KEYS, FIXED_KEYS,
} from './calc/salaryTemplate';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function toComponents(raw: any[]): TemplateComponent[] {
  return (Array.isArray(raw) ? raw : []).map((c: any, i: number) => ({
    key: String(c.key || '').trim(),
    label: String(c.label || c.key || '').trim(),
    percentage: Number(c.percentage) || 0,
    isFixed: !!c.isFixed,
    fixedAmount: Number(c.fixedAmount) || 0,
    isBalancing: !!c.isBalancing,
    orderNo: Number(c.orderNo) || i + 1,
  }));
}

// ─── reference data ──────────────────────────────────────────────────────────

export const getTemplateMeta = (_req: Request, res: Response) => {
  res.json({
    percentageKeys: PERCENTAGE_KEYS.map((k) => ({ key: k, label: prettyKey(k) })),
    fixedKeys: FIXED_KEYS.map((k) => ({ key: k, label: prettyKey(k) })),
    defaultComponents: DEFAULT_COMPONENTS,
    inputModes: [
      { value: 'GROSS', label: 'Monthly Gross', hint: 'Components are a percentage of this figure.' },
      { value: 'CTC', label: 'Monthly CTC', hint: 'Gross is derived by removing employer PF and fixed add-ons.' },
      { value: 'NET', label: 'Net take-home', hint: 'Gross is solved backwards. Statutory slabs mean an exact net is not always reachable — the variance is reported.' },
    ],
    note:
      'Percentage components must total exactly 100% of monthly gross. Fixed components ' +
      '(LTA, mobile, meal) are flat amounts that sit outside the 100%.',
  });
};

function prettyKey(k: string): string {
  const map: Record<string, string> = {
    basic: 'Basic',
    hra: 'House Rent Allowance',
    medicalAllowance: 'Medical Allowance',
    travelAllowance: 'Conveyance',
    specialAllowance: 'Special Allowance',
    otherAllowances: 'Other Allowances',
    lta: 'LTA',
    mobileInternet: 'Mobile & Internet',
    mealFuel: 'Meal & Fuel',
  };
  return map[k] ?? k;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export const listSalaryTemplates = async (req: Request, res: Response) => {
  try {
    const { departmentId, designationId, includeInactive } = req.query as any;

    const templates = await (prisma as any).salaryTemplate.findMany({
      where: {
        ...(includeInactive === 'true' ? {} : { isActive: true }),
        ...(departmentId ? { departmentId: Number(departmentId) } : {}),
        ...(designationId ? { designationId: Number(designationId) } : {}),
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        components: { orderBy: { orderNo: 'asc' } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
        _count: { select: { assignments: true } },
      },
    });

    res.json(templates);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getSalaryTemplate = async (req: Request, res: Response) => {
  try {
    const template = await (prisma as any).salaryTemplate.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        components: { orderBy: { orderNo: 'asc' } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });
    if (!template) return res.status(404).json({ message: 'Template not found' });
    res.json(template);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const upsertSalaryTemplate = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id ? Number(req.params.id) : null;
    const {
      name, code, description, components: rawComponents,
      departmentId, designationId, roleId, branchId, employmentType,
      pfApplicable, esiApplicable, ptApplicable, isActive, companyId: rawCompanyId,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ message: 'Template name is required' });

    const components = toComponents(rawComponents);
    const validation = validateTemplate(components);

    // A template that does not total 100% must never become active — every
    // structure built from it would be wrong.
    const wantsActive = isActive !== false;
    if (wantsActive && !validation.valid) {
      return res.status(400).json({
        message: 'Template cannot be activated until it is valid.',
        errors: validation.errors,
        warnings: validation.warnings,
        totalPercentage: validation.totalPercentage,
      });
    }

    const data: any = {
      name: name.trim(),
      code: code || null,
      description: description || null,
      basis: 'GROSS',
      isActive: wantsActive && validation.valid,
      departmentId: departmentId ? Number(departmentId) : null,
      designationId: designationId ? Number(designationId) : null,
      roleId: roleId ? Number(roleId) : null,
      branchId: branchId ? Number(branchId) : null,
      employmentType: employmentType || null,
      pfApplicable: pfApplicable !== false,
      esiApplicable: esiApplicable !== false,
      ptApplicable: ptApplicable !== false,
      companyId: await coerceCompanyId(rawCompanyId),
    };

    const saved = await prisma.$transaction(
      async (tx: any) => {
        const template = id
          ? await tx.salaryTemplate.update({ where: { id }, data })
          : await tx.salaryTemplate.create({ data: { ...data, createdBy: currentEmployeeId(req) } });

        // Components are replaced wholesale — simpler than diffing, and the set
        // is never more than a dozen rows.
        await tx.salaryTemplateComponent.deleteMany({ where: { templateId: template.id } });
        if (components.length) {
          await tx.salaryTemplateComponent.createMany({
            data: components.map((c) => ({ ...c, templateId: template.id })),
          });
        }
        return template;
      },
      { maxWait: 15000, timeout: 30000 },
    );

    const full = await (prisma as any).salaryTemplate.findUnique({
      where: { id: saved.id },
      include: { components: { orderBy: { orderNo: 'asc' } } },
    });

    res.status(id ? 200 : 201).json({ ...full, validation });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteSalaryTemplate = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const assignments = await (prisma as any).salaryTemplateAssignment.count({
      where: { templateId: id },
    });

    if (assignments > 0) {
      const updated = await (prisma as any).salaryTemplate.update({
        where: { id }, data: { isActive: false },
      });
      return res.json({
        message: `Template deactivated — ${assignments} employee structure(s) were created from it, so the audit trail is kept.`,
        template: updated,
      });
    }

    await (prisma as any).salaryTemplate.delete({ where: { id } });
    res.json({ message: 'Template deleted' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** POST /validate — live feedback for the builder, without saving. */
export const validateSalaryTemplate = (req: Request, res: Response) => {
  const components = toComponents(req.body?.components);
  res.json(validateTemplate(components));
};

// ─── preview ─────────────────────────────────────────────────────────────────

/**
 * POST /preview — what would this template produce for this figure?
 * Accepts a saved templateId or raw components, so the builder can preview
 * unsaved edits.
 */
export const previewSalaryTemplate = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const inputMode = String(req.body.inputMode || 'GROSS').toUpperCase() as InputMode;
    const inputAmount = Number(req.body.inputAmount) || 0;

    if (!['GROSS', 'CTC', 'NET'].includes(inputMode)) {
      return res.status(400).json({ message: 'inputMode must be GROSS, CTC or NET' });
    }

    let template: any;
    if (req.body.templateId) {
      template = await (prisma as any).salaryTemplate.findUnique({
        where: { id: Number(req.body.templateId) },
        include: { components: true },
      });
      if (!template) return res.status(404).json({ message: 'Template not found' });
    } else {
      const components = toComponents(req.body.components);
      const validation = validateTemplate(components);
      if (!validation.valid) {
        return res.status(400).json({ message: 'Template is not valid', ...validation });
      }
      template = {
        components,
        pfApplicable: req.body.pfApplicable !== false,
        esiApplicable: req.body.esiApplicable !== false,
        ptApplicable: req.body.ptApplicable !== false,
      };
    }

    const companyId = await coerceCompanyId(req.body.companyId);
    const now = new Date();
    const { rates } = await resolveStatutoryRates(
      companyId, Number(req.body.month) || now.getMonth() + 1, Number(req.body.year) || now.getFullYear(),
    );

    const result = applyTemplate(template, inputMode, inputAmount, rates, {
      month: Number(req.body.month) || now.getMonth() + 1,
      includeTds: !!req.body.includeTds,
      monthlyTds: Number(req.body.monthlyTds) || 0,
    });

    res.json({
      ...result,
      annualGross: round2(result.monthlyGross * 12),
      annualCtc: round2(result.monthlyCtc * 12),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── employee filtering for bulk assign ──────────────────────────────────────

/**
 * GET /eligible — employees matching a filter, with their current structure so
 * HR can see who already has one before overwriting anything.
 */
export const listEligibleEmployees = async (req: Request, res: Response) => {
  try {
    const { departmentId, designationId, roleId, branchId, employmentType, search, onlyWithoutStructure } =
      req.query as any;

    const employees = await prisma.employee.findMany({
      where: {
        employmentStatus: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
        ...(departmentId ? { departmentId: Number(departmentId) } : {}),
        ...(designationId ? { designationId: Number(designationId) } : {}),
        ...(roleId ? { roleId: Number(roleId) } : {}),
        ...(branchId ? { branchId: Number(branchId) } : {}),
        ...(employmentType ? { employmentType: String(employmentType) as any } : {}),
        ...(onlyWithoutStructure === 'true' ? { salaryStructure: { is: null } } : {}),
        ...(search
          ? {
              OR: [
                { firstName: { contains: String(search) } },
                { lastName: { contains: String(search) } },
                { employeeCode: { contains: String(search) } },
              ],
            }
          : {}),
      } as any,
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true,
        employmentType: true,
        Department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        Branch: { select: { id: true, name: true } },
        role: { select: { id: true, name: true } },
        salaryStructure: true,
      } as any,
      orderBy: { employeeCode: 'asc' },
    });

    const data = employees.map((e: any) => {
      const s = e.salaryStructure;
      const currentGross = s
        ? round2(s.basic + s.hra + s.medicalAllowance + s.travelAllowance + s.specialAllowance + s.otherAllowances)
        : null;
      return {
        id: e.id,
        employeeCode: e.employeeCode,
        name: `${e.firstName} ${e.lastName}`.trim(),
        department: e.Department?.name ?? null,
        designation: e.designation?.name ?? null,
        branch: e.Branch?.name ?? null,
        role: e.role?.name ?? null,
        employmentType: e.employmentType,
        hasStructure: !!s,
        currentGross,
      };
    });

    res.json({ total: data.length, data });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── assignment ──────────────────────────────────────────────────────────────

/**
 * POST /assign — apply a template to one or many employees.
 *
 * Each employee carries their own figure, because two nurses on the same
 * template rarely earn the same. `dryRun` returns exactly what would be written
 * without writing it, which is what the confirmation screen shows.
 */
export const assignSalaryTemplate = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const templateId = Number(req.body.templateId);
    const inputMode = String(req.body.inputMode || 'GROSS').toUpperCase() as InputMode;
    const dryRun = !!req.body.dryRun;
    const overwrite = req.body.overwrite !== false;

    const assignments: Array<{ employeeId: number; amount: number }> =
      Array.isArray(req.body.assignments)
        ? req.body.assignments.map((a: any) => ({
            employeeId: Number(a.employeeId),
            amount: Number(a.amount) || 0,
          })).filter((a: any) => a.employeeId && a.amount > 0)
        : [];

    if (!templateId) return res.status(400).json({ message: 'templateId is required' });
    if (!assignments.length) {
      return res.status(400).json({ message: 'Provide at least one employee with an amount above zero' });
    }

    const template = await (prisma as any).salaryTemplate.findUnique({
      where: { id: templateId },
      include: { components: true },
    });
    if (!template) return res.status(404).json({ message: 'Template not found' });

    const validation = validateTemplate(template.components);
    if (!validation.valid) {
      return res.status(400).json({
        message: 'This template is not valid and cannot be assigned.',
        errors: validation.errors,
      });
    }

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const assignedBy = currentEmployeeId(req);
    const effectiveFrom = req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : now;

    const applied: any[] = [];
    const skipped: Array<{ employeeId: number; reason: string }> = [];

    for (const a of assignments) {
      const companyId = await resolveCompanyId(a.employeeId);
      const { rates } = await resolveStatutoryRates(companyId, month, year);

      const result = applyTemplate(template, inputMode, a.amount, rates, { month });
      const c = result.components;

      const existing = await (prisma as any).salaryStructure.findUnique({
        where: { employeeId: a.employeeId },
      });
      if (existing && !overwrite) {
        skipped.push({ employeeId: a.employeeId, reason: 'Already has a structure and overwrite is off' });
        continue;
      }

      const previousGross = existing
        ? round2(existing.basic + existing.hra + existing.medicalAllowance +
                 existing.travelAllowance + existing.specialAllowance + existing.otherAllowances)
        : 0;

      const row = {
        employeeId: a.employeeId,
        inputAmount: a.amount,
        monthlyGross: result.monthlyGross,
        monthlyCtc: result.monthlyCtc,
        monthlyNet: result.monthlyNet,
        previousGross,
        components: c,
        netVariance: result.netSolve?.variance ?? 0,
        netExact: result.netSolve?.exact ?? true,
        netNote: result.netSolve?.note,
      };

      if (!dryRun) {
        await prisma.$transaction(
          async (tx: any) => {
            const structureData = {
              basic: c.basic,
              hra: c.hra,
              medicalAllowance: c.medicalAllowance,
              travelAllowance: c.travelAllowance,
              specialAllowance: c.specialAllowance,
              otherAllowances: c.otherAllowances,
              lta: c.lta,
              mobileInternet: c.mobileInternet,
              mealFuel: c.mealFuel,
              pfApplicable: template.pfApplicable,
              esiApplicable: template.esiApplicable,
              ptApplicable: template.ptApplicable,
              effectiveFrom,
            };

            await tx.salaryStructure.upsert({
              where: { employeeId: a.employeeId },
              create: { employeeId: a.employeeId, tdsMonthly: 0, ...structureData },
              update: structureData,
            });

            // Record the revision so arrears and the increment report can see it.
            if (previousGross > 0 && Math.abs(previousGross - result.monthlyGross) > 0.01) {
              await tx.salaryRevision.create({
                data: {
                  employeeId: a.employeeId,
                  previousCtc: previousGross,
                  newCtc: result.monthlyGross,
                  percentage: previousGross
                    ? round2(((result.monthlyGross - previousGross) / previousGross) * 100)
                    : 0,
                  effectiveFrom,
                  reason: `Salary template "${template.name}" applied`,
                  createdBy: assignedBy,
                },
              });
            }

            await tx.salaryTemplateAssignment.create({
              data: {
                templateId,
                employeeId: a.employeeId,
                inputMode,
                inputAmount: a.amount,
                monthlyGross: result.monthlyGross,
                monthlyCtc: result.monthlyCtc,
                monthlyNet: result.monthlyNet,
                netVariance: result.netSolve?.variance ?? 0,
                effectiveFrom,
                assignedBy,
              },
            });
          },
          { maxWait: 20000, timeout: 60000 },
        );
      }

      applied.push(row);
    }

    res.json({
      dryRun,
      templateId,
      templateName: template.name,
      inputMode,
      applied: applied.length,
      skippedCount: skipped.length,
      skipped,
      results: applied,
      // Surfaced so the confirmation screen can warn before committing.
      inexactNetCount: applied.filter((r) => !r.netExact).length,
      warnings: validation.warnings,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** GET /assignments/:employeeId — why does this person's structure look like this? */
export const getEmployeeAssignmentHistory = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const rows = await (prisma as any).salaryTemplateAssignment.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      include: { template: { select: { id: true, name: true, code: true } } },
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
