// ─────────────────────────────────────────────────────────────────────────────
//  Income-tax API: regime selection, investment declarations, HR review and
//  the employee-facing projection.
//
//  The declaration flow mirrors LeaveRequest (DRAFT → SUBMITTED → reviewed) so
//  the frontend can reuse the approval patterns it already has.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { currentEmployeeId } from '../../lib/currentUser';
import { resolveCompanyId } from '../../lib/company';
import { createNotification } from '../notifications/notifications.controller';
import { financialYearFor } from '../payroll/calc/taxSlabs';
import { projectRegimeComparison, buildTaxContext } from '../payroll/calc/resolveTds';
import { compareRegimes, computeAnnualTax, SECTION_CAPS, Regime } from '../payroll/calc/tax';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Current FY unless the caller pins one. */
function fyFromQuery(raw: unknown): string {
  const value = String(raw || '').trim();
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  const now = new Date();
  return financialYearFor(now.getMonth() + 1, now.getFullYear());
}

/** Employee the request is acting on: explicit param for HR, else self. */
function targetEmployeeId(req: AuthenticatedRequest): number | null {
  const explicit = Number(req.params.employeeId ?? req.query.employeeId);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  // currentEmployeeId already validates and returns null when absent.
  return currentEmployeeId(req);
}

// ─── tax profile (regime + declaration inputs) ───────────────────────────────

export const getTaxProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = targetEmployeeId(req);
    if (!employeeId) return res.status(400).json({ message: 'employeeId required' });

    const financialYear = fyFromQuery(req.query.financialYear);

    let profile = await (prisma as any).employeeTaxProfile.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
    });

    // Materialise a default profile rather than returning 404 — the employee's
    // screen needs something to bind to on first visit.
    if (!profile) {
      const companyId = await resolveCompanyId(employeeId);
      profile = await (prisma as any).employeeTaxProfile.create({
        data: { employeeId, companyId, financialYear },
      });
    }

    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const updateTaxProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = targetEmployeeId(req);
    if (!employeeId) return res.status(400).json({ message: 'employeeId required' });

    const financialYear = fyFromQuery(req.body.financialYear ?? req.query.financialYear);
    const companyId = await resolveCompanyId(employeeId);

    const {
      regime, autoComputeTds, rentPaidAnnual, metroCity, landlordPan,
      previousEmployerIncome, previousEmployerTds, previousEmployerPf,
      otherIncome, housePropertyLoss,
    } = req.body;

    const existing = await (prisma as any).employeeTaxProfile.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
    });

    // Regime is locked once payroll has run for the FY — changing it mid-year
    // would silently invalidate every payslip already issued.
    const wantsRegimeChange =
      regime && existing && existing.regime !== String(regime).toUpperCase();

    if (wantsRegimeChange && existing.regimeLocked) {
      return res.status(409).json({
        message:
          'Regime is locked for this financial year because payroll has already been processed. HR must reverse the affected runs to change it.',
      });
    }

    const data: any = {
      ...(regime ? { regime: String(regime).toUpperCase(), regimeSetAt: new Date() } : {}),
      ...(autoComputeTds != null ? { autoComputeTds: !!autoComputeTds } : {}),
      ...(rentPaidAnnual != null ? { rentPaidAnnual: Number(rentPaidAnnual) || 0 } : {}),
      ...(metroCity != null ? { metroCity: !!metroCity } : {}),
      ...(landlordPan !== undefined ? { landlordPan: landlordPan || null } : {}),
      ...(previousEmployerIncome != null ? { previousEmployerIncome: Number(previousEmployerIncome) || 0 } : {}),
      ...(previousEmployerTds != null ? { previousEmployerTds: Number(previousEmployerTds) || 0 } : {}),
      ...(previousEmployerPf != null ? { previousEmployerPf: Number(previousEmployerPf) || 0 } : {}),
      ...(otherIncome != null ? { otherIncome: Number(otherIncome) || 0 } : {}),
      ...(housePropertyLoss != null ? { housePropertyLoss: Number(housePropertyLoss) || 0 } : {}),
    };

    const profile = await (prisma as any).employeeTaxProfile.upsert({
      where: { employeeId_financialYear: { employeeId, financialYear } },
      create: { employeeId, companyId, financialYear, ...data },
      update: data,
    });

    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── investment declarations ─────────────────────────────────────────────────

export const getDeclaration = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = targetEmployeeId(req);
    if (!employeeId) return res.status(400).json({ message: 'employeeId required' });

    const financialYear = fyFromQuery(req.query.financialYear);

    const declaration = await (prisma as any).taxDeclaration.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
      include: { items: { orderBy: { section: 'asc' } } },
    });

    res.json(
      declaration ?? {
        employeeId, financialYear, status: 'DRAFT',
        totalDeclared: 0, totalApproved: 0, items: [],
      },
    );
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Create or replace the employee's declaration lines for a financial year.
 * Items are replaced wholesale — simpler than diffing, and the payload is small.
 * Rejected once submitted, so HR always reviews what the employee actually sent.
 */
export const saveDeclaration = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = targetEmployeeId(req);
    if (!employeeId) return res.status(400).json({ message: 'employeeId required' });

    const financialYear = fyFromQuery(req.body.financialYear);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const companyId = await resolveCompanyId(employeeId);

    const existing = await (prisma as any).taxDeclaration.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
    });

    if (existing && existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
      return res.status(409).json({
        message: `Declaration is ${existing.status} and can no longer be edited. Ask HR to reopen it.`,
      });
    }

    const cleaned = items
      .map((it: any) => ({
        section: String(it.section || '').toUpperCase().trim(),
        category: String(it.category || '').trim(),
        description: it.description ? String(it.description) : null,
        declaredAmount: Math.max(0, Number(it.declaredAmount) || 0),
        proofUrl: it.proofUrl || null,
      }))
      .filter((it: any) => it.section && it.declaredAmount > 0);

    const totalDeclared = round2(
      cleaned.reduce((s: number, it: any) => s + it.declaredAmount, 0),
    );

    // Remote DB is slow; give the multi-write transaction explicit budgets so a
    // large declaration doesn't trip the default 5s limit.
    const saved = await prisma.$transaction(
      async (tx: any) => {
        const decl = await tx.taxDeclaration.upsert({
          where: { employeeId_financialYear: { employeeId, financialYear } },
          create: { employeeId, companyId, financialYear, status: 'DRAFT', totalDeclared },
          update: { status: 'DRAFT', totalDeclared, reviewedBy: null, reviewedAt: null, remarks: null },
        });

        await tx.taxDeclarationItem.deleteMany({ where: { declarationId: decl.id } });
        if (cleaned.length) {
          await tx.taxDeclarationItem.createMany({
            data: cleaned.map((it: any) => ({ ...it, declarationId: decl.id })),
          });
        }
        return decl;
      },
      { maxWait: 15000, timeout: 30000 },
    );

    const full = await (prisma as any).taxDeclaration.findUnique({
      where: { id: saved.id },
      include: { items: true },
    });
    res.json(full);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const submitDeclaration = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = targetEmployeeId(req);
    if (!employeeId) return res.status(400).json({ message: 'employeeId required' });

    const financialYear = fyFromQuery(req.body.financialYear);

    const declaration = await (prisma as any).taxDeclaration.findUnique({
      where: { employeeId_financialYear: { employeeId, financialYear } },
      include: { items: true },
    });

    if (!declaration) return res.status(404).json({ message: 'No declaration to submit' });
    if (!declaration.items.length) {
      return res.status(400).json({ message: 'Add at least one investment before submitting' });
    }
    if (declaration.status === 'SUBMITTED') {
      return res.status(409).json({ message: 'Declaration is already submitted' });
    }

    const updated = await (prisma as any).taxDeclaration.update({
      where: { id: declaration.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });

    // Notification is deliberately outside any transaction — a notification
    // failure must never roll back the submission.
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true, reportingManager: true },
    });
    if (employee?.reportingManager) {
      await createNotification(
        employee.reportingManager,
        `${employee.firstName} ${employee.lastName} submitted their ${financialYear} investment declaration for review.`,
        'Investment declaration submitted',
      ).catch(() => undefined);
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** HR review — approve per line, so partial approval is expressible. */
export const reviewDeclaration = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const declarationId = Number(req.params.id);
    const { items, remarks, status } = req.body;
    const reviewerId = currentEmployeeId(req);

    const declaration = await (prisma as any).taxDeclaration.findUnique({
      where: { id: declarationId },
      include: { items: true },
    });
    if (!declaration) return res.status(404).json({ message: 'Declaration not found' });

    const decisions: Record<number, { approvedAmount: number; proofStatus?: string; remarks?: string }> = {};
    for (const it of Array.isArray(items) ? items : []) {
      const id = Number(it.id);
      if (!Number.isInteger(id)) continue;
      decisions[id] = {
        approvedAmount: Math.max(0, Number(it.approvedAmount) || 0),
        proofStatus: it.proofStatus,
        remarks: it.remarks,
      };
    }

    let totalApproved = 0;
    for (const item of declaration.items) {
      // A line HR didn't rule on defaults to rejected (0), not auto-approved.
      const decision = decisions[item.id] ?? { approvedAmount: 0 };
      const approved = Math.min(decision.approvedAmount, item.declaredAmount);
      totalApproved += approved;
    }
    totalApproved = round2(totalApproved);

    const resolvedStatus =
      status ||
      (totalApproved === 0
        ? 'REJECTED'
        : totalApproved < declaration.totalDeclared
          ? 'PARTIALLY_APPROVED'
          : 'APPROVED');

    await prisma.$transaction(
      async (tx: any) => {
        for (const item of declaration.items) {
          const decision = decisions[item.id] ?? { approvedAmount: 0 };
          await tx.taxDeclarationItem.update({
            where: { id: item.id },
            data: {
              approvedAmount: Math.min(decision.approvedAmount, item.declaredAmount),
              ...(decision.proofStatus ? { proofStatus: decision.proofStatus } : {}),
              ...(decision.remarks !== undefined ? { remarks: decision.remarks } : {}),
            },
          });
        }
        await tx.taxDeclaration.update({
          where: { id: declarationId },
          data: {
            status: resolvedStatus,
            totalApproved,
            reviewedBy: reviewerId,
            reviewedAt: new Date(),
            remarks: remarks ?? null,
          },
        });
      },
      { maxWait: 15000, timeout: 30000 },
    );

    await createNotification(
      declaration.employeeId,
      `Your ${declaration.financialYear} declaration was reviewed. Approved amount: ₹${totalApproved.toLocaleString('en-IN')}.`,
      `Investment declaration ${resolvedStatus.toLowerCase().replace('_', ' ')}`,
    ).catch(() => undefined);

    const full = await (prisma as any).taxDeclaration.findUnique({
      where: { id: declarationId },
      include: { items: true },
    });
    res.json(full);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** HR queue of declarations awaiting review. */
export const listDeclarations = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, page = '1', limit = '20' } = req.query as any;
    const financialYear = fyFromQuery(req.query.financialYear);
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = { financialYear, ...(status ? { status: String(status) } : {}) };

    const [rows, total] = await Promise.all([
      (prisma as any).taxDeclaration.findMany({
        where, skip, take: Number(limit),
        orderBy: { submittedAt: 'desc' },
        include: {
          items: true,
          employee: {
            select: {
              id: true, firstName: true, lastName: true, employeeCode: true,
              Department: { select: { name: true } },
            },
          },
        },
      }),
      (prisma as any).taxDeclaration.count({ where }),
    ]);

    res.json({ data: rows, total, page: Number(page), limit: Number(limit) });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── projection & comparison ─────────────────────────────────────────────────

/** Old vs New for the employee, based on current salary + approved declarations. */
export const getRegimeComparison = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = targetEmployeeId(req);
    if (!employeeId) return res.status(400).json({ message: 'employeeId required' });

    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();

    const result = await projectRegimeComparison(employeeId, month, year);
    if (!result) {
      return res.status(404).json({ message: 'No salary structure configured for this employee' });
    }

    res.json({
      financialYear: result.context.financialYear,
      currentRegime: result.context.regime,
      annualGrossSalary: result.context.annualGrossSalary,
      tdsDeductedSoFar: result.context.tdsDeductedSoFar,
      ...result.comparison,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** Full projection detail for the employee's tax screen. */
export const getTaxProjection = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = targetEmployeeId(req);
    if (!employeeId) return res.status(400).json({ message: 'employeeId required' });

    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();

    const ctx = await buildTaxContext(employeeId, month, year);
    if (!ctx) {
      return res.status(404).json({ message: 'No salary structure configured for this employee' });
    }

    const input = {
      financialYear: ctx.financialYear,
      annualGrossSalary: ctx.annualGrossSalary,
      previousEmployerIncome: ctx.previousEmployerIncome,
      previousEmployerTds: ctx.previousEmployerTds,
      otherIncome: ctx.otherIncome,
      housePropertyLoss: ctx.housePropertyLoss,
      deductions: ctx.deductions,
      annualEmployeePf: ctx.annualEmployeePf,
      annualProfessionalTax: ctx.annualProfessionalTax,
      age: ctx.age,
      hra: {
        annualBasic: ctx.annualBasic,
        annualHraReceived: ctx.annualHra,
        annualRentPaid: ctx.rentPaidAnnual,
        metroCity: ctx.metroCity,
      },
    };

    res.json({
      financialYear: ctx.financialYear,
      regime: ctx.regime,
      autoComputeTds: ctx.autoComputeTds,
      tdsDeductedSoFar: ctx.tdsDeductedSoFar,
      breakdown: computeAnnualTax({ ...input, regime: ctx.regime as Regime }),
      comparison: compareRegimes(input),
      sectionCaps: SECTION_CAPS,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** Static reference data for the declaration form. */
export const getDeclarationSections = async (_req: Request, res: Response) => {
  res.json({
    sections: [
      { section: '80C', label: 'Section 80C — investments', cap: SECTION_CAPS['80C'],
        categories: ['LIC Premium', 'PPF', 'ELSS', 'NSC', 'Tax Saver FD', 'Tuition Fees', 'Home Loan Principal', 'Sukanya Samriddhi'] },
      { section: '80CCD1B', label: 'Section 80CCD(1B) — additional NPS', cap: SECTION_CAPS['80CCD1B'], categories: ['NPS Contribution'] },
      { section: '80D', label: 'Section 80D — medical insurance', cap: SECTION_CAPS['80D'], categories: ['Self & Family Premium', 'Parents Premium', 'Preventive Health Check-up'] },
      { section: '80DD', label: 'Section 80DD — dependant with disability', cap: SECTION_CAPS['80DD'], categories: ['Dependant Treatment'] },
      { section: '80DDB', label: 'Section 80DDB — specified diseases', cap: SECTION_CAPS['80DDB'], categories: ['Medical Treatment'] },
      { section: '80E', label: 'Section 80E — education loan interest', cap: null, categories: ['Education Loan Interest'] },
      { section: '80G', label: 'Section 80G — donations', cap: null, categories: ['Donation'] },
      { section: '80TTA', label: 'Section 80TTA — savings interest', cap: SECTION_CAPS['80TTA'], categories: ['Savings Account Interest'] },
      { section: '80TTB', label: 'Section 80TTB — senior citizen interest', cap: SECTION_CAPS['80TTB'], categories: ['Deposit Interest'] },
      { section: '80U', label: 'Section 80U — self disability', cap: SECTION_CAPS['80U'], categories: ['Disability'] },
      { section: '24B', label: 'Section 24(b) — home loan interest', cap: SECTION_CAPS['24B'], categories: ['Home Loan Interest'] },
    ],
    note: 'Chapter VI-A deductions and HRA exemption apply only under the Old Regime.',
  });
};
