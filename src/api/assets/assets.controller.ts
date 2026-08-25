// ─────────────────────────────────────────────────────────────────────────────
//  Asset register — company property issued to employees, and recovered at exit.
//
//  The register and the allocation history are kept apart on purpose. An asset
//  passed between three employees has one Asset row and three AssetAllocation
//  rows, only one of which is open. `Asset.status` is denormalised from the open
//  allocation so the register lists without a join per row.
//
//  The exit hook is the point of the module: `getPendingForExit` answers
//  "what is this person still holding?", which is what makes an FnF settlement
//  correct rather than optimistic.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { currentEmployeeId } from '../../lib/currentUser';
import { coerceCompanyId } from '../../lib/company';
import { createNotification } from '../notifications/notifications.controller';

const CATEGORIES = [
  'LAPTOP', 'DESKTOP', 'MOBILE', 'SIM', 'VEHICLE', 'FURNITURE',
  'ID_CARD', 'ACCESS_CARD', 'TOOL', 'OTHER',
];

const RETURN_CONDITIONS = ['GOOD', 'MINOR_DAMAGE', 'MAJOR_DAMAGE', 'LOST'];

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── register ────────────────────────────────────────────────────────────────

export const listAssets = async (req: Request, res: Response) => {
  try {
    const { search = '', status, category, page = '1', limit = '20' } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);

    // Archived assets are kept but stay out of the register. Distinct from
    // status RETIRED, which is a lifecycle fact the register still shows.
    const where: any = {
      archivedAt: null,
      ...(status ? { status: String(status).toUpperCase() } : {}),
      ...(category ? { category: String(category).toUpperCase() } : {}),
      ...(search
        ? {
            OR: [
              { assetTag: { contains: String(search) } },
              { name: { contains: String(search) } },
              { serialNumber: { contains: String(search) } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      (prisma as any).asset.findMany({
        where, skip, take: Number(limit),
        orderBy: { assetTag: 'asc' },
        include: {
          allocations: {
            where: { returnedOn: null },
            take: 1,
            include: {
              employee: {
                select: { id: true, firstName: true, lastName: true, employeeCode: true },
              },
            },
          },
        },
      }),
      (prisma as any).asset.count({ where }),
    ]);

    // Flatten the open allocation so the table binds to one shape.
    const data = rows.map((a: any) => ({
      ...a,
      currentHolder: a.allocations?.[0]?.employee ?? null,
      allocatedOn: a.allocations?.[0]?.allocatedOn ?? null,
      allocationId: a.allocations?.[0]?.id ?? null,
    }));

    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getAsset = async (req: Request, res: Response) => {
  try {
    const asset = await (prisma as any).asset.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        allocations: {
          orderBy: { allocatedOn: 'desc' },
          include: {
            employee: {
              select: { id: true, firstName: true, lastName: true, employeeCode: true },
            },
          },
        },
      },
    });
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    res.json(asset);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const upsertAsset = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id ? Number(req.params.id) : null;
    const {
      assetTag, name, category, serialNumber, make, model, description,
      purchaseDate, purchaseCost, warrantyEnd, currentValue, location, remarks,
      status, companyId: rawCompanyId,
    } = req.body;

    if (!assetTag?.trim()) return res.status(400).json({ message: 'Asset tag is required' });
    if (!name?.trim())     return res.status(400).json({ message: 'Asset name is required' });

    const resolvedCategory = String(category || 'OTHER').toUpperCase();
    if (!CATEGORIES.includes(resolvedCategory)) {
      return res.status(400).json({ message: `category must be one of ${CATEGORIES.join(', ')}` });
    }

    const data: any = {
      assetTag: assetTag.trim(),
      name: name.trim(),
      category: resolvedCategory,
      serialNumber: serialNumber || null,
      make: make || null,
      model: model || null,
      description: description || null,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
      purchaseCost: Number(purchaseCost) || 0,
      warrantyEnd: warrantyEnd ? new Date(warrantyEnd) : null,
      currentValue: Number(currentValue) || 0,
      location: location || null,
      remarks: remarks || null,
      companyId: await coerceCompanyId(rawCompanyId),
    };

    // Status is owned by the allocation flow once an asset is out. Only let it
    // be set directly when the asset is not currently allocated.
    if (status && !id) data.status = String(status).toUpperCase();

    if (id) {
      const existing = await (prisma as any).asset.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ message: 'Asset not found' });
      if (status && existing.status !== 'ALLOCATED') {
        data.status = String(status).toUpperCase();
      }
      const updated = await (prisma as any).asset.update({ where: { id }, data });
      return res.json(updated);
    }

    const createdAsset = await (prisma as any).asset.create({
      data: { ...data, createdBy: currentEmployeeId(req) },
    });
    res.status(201).json(createdAsset);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ message: 'An asset with that tag already exists' });
    }
    res.status(500).json({ message: err.message });
  }
};

export const deleteAsset = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const openAllocation = await (prisma as any).assetAllocation.findFirst({
      where: { assetId: id, returnedOn: null },
    });
    if (openAllocation) {
      return res.status(409).json({
        message: 'This asset is currently allocated. Record its return before deleting it.',
      });
    }

    const history = await (prisma as any).assetAllocation.count({ where: { assetId: id } });
    if (history > 0) {
      // Keep the audit trail; retire instead of destroying it.
      const retired = await (prisma as any).asset.update({
        where: { id },
        data: { status: 'RETIRED' },
      });
      return res.json({
        message: `Asset retired — ${history} allocation record(s) are kept for audit.`,
        asset: retired,
      });
    }

    await (prisma as any).asset.delete({ where: { id } });
    res.json({ message: 'Asset deleted' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getMeta = (_req: Request, res: Response) => {
  res.json({
    categories: CATEGORIES,
    returnConditions: RETURN_CONDITIONS,
    statuses: ['AVAILABLE', 'ALLOCATED', 'IN_REPAIR', 'LOST', 'SCRAPPED', 'RETIRED'],
  });
};

// ─── allocation ──────────────────────────────────────────────────────────────

/** POST /api/assets/:id/allocate */
export const allocateAsset = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assetId = Number(req.params.id);
    const employeeId = Number(req.body.employeeId);
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required' });

    const asset = await (prisma as any).asset.findUnique({ where: { id: assetId } });
    if (!asset) return res.status(404).json({ message: 'Asset not found' });

    const open = await (prisma as any).assetAllocation.findFirst({
      where: { assetId, returnedOn: null },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (open) {
      return res.status(409).json({
        message: `Already allocated to ${open.employee?.firstName} ${open.employee?.lastName}. Record the return first.`,
      });
    }
    if (['LOST', 'SCRAPPED', 'RETIRED'].includes(asset.status)) {
      return res.status(409).json({ message: `Asset is ${asset.status} and cannot be allocated` });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, firstName: true, employmentStatus: true },
    });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const allocation = await prisma.$transaction(
      async (tx: any) => {
        const row = await tx.assetAllocation.create({
          data: {
            assetId,
            employeeId,
            allocatedBy: currentEmployeeId(req),
            allocatedOn: req.body.allocatedOn ? new Date(req.body.allocatedOn) : new Date(),
            dueOn: req.body.dueOn ? new Date(req.body.dueOn) : null,
            purpose: req.body.purpose || null,
            remarks: req.body.remarks || null,
            status: 'ALLOCATED',
          },
        });
        await tx.asset.update({ where: { id: assetId }, data: { status: 'ALLOCATED' } });
        return row;
      },
      { maxWait: 15000, timeout: 30000 },
    );

    await createNotification(
      employeeId,
      `${asset.name} (${asset.assetTag}) has been allocated to you. Please acknowledge receipt.`,
      'Asset allocated',
    ).catch(() => undefined);

    res.status(201).json(allocation);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** POST /api/assets/allocations/:id/return */
export const returnAsset = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const allocationId = Number(req.params.id);
    const { returnCondition, recoveryAmount, recoveryWaived, remarks } = req.body;

    const allocation = await (prisma as any).assetAllocation.findUnique({
      where: { id: allocationId },
      include: { asset: true },
    });
    if (!allocation) return res.status(404).json({ message: 'Allocation not found' });
    if (allocation.returnedOn) {
      return res.status(409).json({ message: 'This allocation is already closed' });
    }

    const condition = String(returnCondition || 'GOOD').toUpperCase();
    if (!RETURN_CONDITIONS.includes(condition)) {
      return res.status(400).json({
        message: `returnCondition must be one of ${RETURN_CONDITIONS.join(', ')}`,
      });
    }

    // A lost asset defaults to recovering its current book value; damage is a
    // judgement call, so HR supplies the figure.
    const waived = !!recoveryWaived;
    const recovery = waived
      ? 0
      : recoveryAmount != null
        ? Math.max(0, Number(recoveryAmount) || 0)
        : condition === 'LOST'
          ? round2(allocation.asset?.currentValue || allocation.asset?.purchaseCost || 0)
          : 0;

    const updated = await prisma.$transaction(
      async (tx: any) => {
        const row = await tx.assetAllocation.update({
          where: { id: allocationId },
          data: {
            returnedOn: new Date(),
            returnedTo: currentEmployeeId(req),
            returnCondition: condition,
            recoveryAmount: recovery,
            recoveryWaived: waived,
            status: condition === 'LOST' ? 'LOST' : 'RETURNED',
            remarks: remarks ?? allocation.remarks,
          },
        });

        await tx.asset.update({
          where: { id: allocation.assetId },
          data: {
            status: condition === 'LOST' ? 'LOST'
              : condition === 'MAJOR_DAMAGE' ? 'IN_REPAIR'
              : 'AVAILABLE',
          },
        });

        return row;
      },
      { maxWait: 15000, timeout: 30000 },
    );

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** PATCH /api/assets/allocations/:id/acknowledge — employee confirms receipt. */
export const acknowledgeAllocation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const allocationId = Number(req.params.id);
    const employeeId = currentEmployeeId(req);

    const allocation = await (prisma as any).assetAllocation.findUnique({
      where: { id: allocationId },
    });
    if (!allocation) return res.status(404).json({ message: 'Allocation not found' });
    if (allocation.employeeId !== employeeId) {
      return res.status(403).json({ message: 'You can only acknowledge your own allocations' });
    }

    const updated = await (prisma as any).assetAllocation.update({
      where: { id: allocationId },
      data: { acknowledgedAt: new Date() },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** GET /api/assets/my — what the caller currently holds. */
export const listMyAssets = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = currentEmployeeId(req);
    if (!employeeId) return res.status(401).json({ message: 'Unauthorized' });

    const rows = await (prisma as any).assetAllocation.findMany({
      where: { employeeId },
      orderBy: { allocatedOn: 'desc' },
      include: { asset: true },
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** GET /api/assets/employee/:employeeId — HR view of one person's holdings. */
export const listEmployeeAssets = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const rows = await (prisma as any).assetAllocation.findMany({
      where: { employeeId },
      orderBy: { allocatedOn: 'desc' },
      include: { asset: true },
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── exit / full-and-final ───────────────────────────────────────────────────

/**
 * GET /api/assets/exit/:employeeId
 * What the employee still holds, plus the recovery already booked against
 * returns. This is what an FnF settlement needs to be correct — clearing an
 * exit while someone still has a laptop is how companies lose hardware.
 */
export const getPendingForExit = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);

    const allocations = await (prisma as any).assetAllocation.findMany({
      where: { employeeId },
      include: { asset: true },
      orderBy: { allocatedOn: 'desc' },
    });

    const outstanding = allocations.filter((a: any) => !a.returnedOn);
    const returned = allocations.filter((a: any) => a.returnedOn);

    const recoveryDue = round2(
      returned.reduce((s: number, a: any) => s + (a.recoveryWaived ? 0 : a.recoveryAmount || 0), 0),
    );

    // What it would cost if everything still out were written off — the worst
    // case HR should be aware of before signing the clearance.
    const outstandingValue = round2(
      outstanding.reduce(
        (s: number, a: any) => s + (a.asset?.currentValue || a.asset?.purchaseCost || 0), 0,
      ),
    );

    res.json({
      employeeId,
      clear: outstanding.length === 0,
      outstandingCount: outstanding.length,
      outstandingValue,
      recoveryDue,
      outstanding: outstanding.map((a: any) => ({
        allocationId: a.id,
        assetId: a.assetId,
        assetTag: a.asset?.assetTag,
        name: a.asset?.name,
        category: a.asset?.category,
        allocatedOn: a.allocatedOn,
        value: a.asset?.currentValue || a.asset?.purchaseCost || 0,
      })),
      returned: returned.map((a: any) => ({
        allocationId: a.id,
        assetTag: a.asset?.assetTag,
        name: a.asset?.name,
        returnedOn: a.returnedOn,
        returnCondition: a.returnCondition,
        recoveryAmount: a.recoveryWaived ? 0 : a.recoveryAmount,
        recoveryWaived: a.recoveryWaived,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** GET /api/assets/summary — register dashboard counts. */
export const getAssetSummary = async (req: Request, res: Response) => {
  try {
    const [byStatus, byCategory, totals, overdue] = await Promise.all([
      (prisma as any).asset.groupBy({ by: ['status'], _count: { _all: true } }),
      (prisma as any).asset.groupBy({ by: ['category'], _count: { _all: true }, _sum: { purchaseCost: true } }),
      (prisma as any).asset.aggregate({ _sum: { purchaseCost: true, currentValue: true }, _count: { _all: true } }),
      (prisma as any).assetAllocation.count({
        where: { returnedOn: null, dueOn: { lt: new Date() } },
      }),
    ]);

    res.json({
      totalAssets: totals._count._all,
      totalPurchaseCost: round2(totals._sum.purchaseCost || 0),
      totalCurrentValue: round2(totals._sum.currentValue || 0),
      overdueReturns: overdue,
      byStatus: byStatus.map((s: any) => ({ status: s.status, count: s._count._all })),
      byCategory: byCategory.map((c: any) => ({
        category: c.category,
        count: c._count._all,
        purchaseCost: round2(c._sum.purchaseCost || 0),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
