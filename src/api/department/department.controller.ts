import { Request, Response } from "express";
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";

// Whitelist the planning/appraisal master fields a Department write may set.
const planningData = (body: any) => {
  const data: any = {};
  if (body.otBudgetHoursPerMonth !== undefined) data.otBudgetHoursPerMonth = Math.max(0, Number(body.otBudgetHoursPerMonth) || 0);
  if (body.minDailyStrength !== undefined) data.minDailyStrength = Math.max(0, Number(body.minDailyStrength) || 0);
  if (body.appraisalCycleBasis !== undefined) data.appraisalCycleBasis = body.appraisalCycleBasis === "CALENDAR" ? "CALENDAR" : "DOJ";
  if (body.appraisalPeriodMonths !== undefined) data.appraisalPeriodMonths = [6, 12].includes(Number(body.appraisalPeriodMonths)) ? Number(body.appraisalPeriodMonths) : 12;
  if (body.appraisalCalendarMonth !== undefined) data.appraisalCalendarMonth = body.appraisalCalendarMonth ? Math.min(12, Math.max(1, Number(body.appraisalCalendarMonth))) : null;
  // Part of the organisation-wide clearance list, used for any department that
  // has no clearance mapping of its own. Only the database could set this
  // before, so the fallback list was invisible and unmaintainable.
  if (body.isDefaultClearance !== undefined) data.isDefaultClearance = !!body.isDefaultClearance;
  return data;
};

const p: any = prisma;

/**
 * The departments that must clear someone leaving THIS department, plus the
 * checklist each of those desks works through. Both are plain master data, so
 * they live with the department rather than inside the exit screens.
 */
const CLEARANCE_INCLUDE = {
  clearanceDepartments: { select: { id: true, name: true } },
  clearanceTemplateItems: { select: { id: true, label: true, orderNo: true }, orderBy: [{ orderNo: 'asc' }, { id: 'asc' }] },
} as const;

/**
 * The clearance relations need a Prisma client generated after they were added.
 * A server still running an older client would otherwise fail the whole
 * departments list — which nearly every screen loads — so fall back to the
 * plain department rows and say what to do about it.
 */
async function withClearanceRelations<T>(query: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (e: any) {
    if (e?.name === 'PrismaClientValidationError' || /Unknown (arg|field)/i.test(String(e?.message))) {
      console.warn('[departments] clearance relations unavailable — run `npx prisma generate` and restart');
      return fallback();
    }
    throw e;
  }
}

/** `set` replaces the whole list, so clearing it in the UI actually clears it. */
const clearanceMapping = (body: any) =>
  Array.isArray(body.clearanceDepartmentIds)
    ? {
      clearanceDepartments: {
        set: body.clearanceDepartmentIds
          .map((d: any) => Number(d))
          .filter((d: number) => Number.isFinite(d))
          .map((id: number) => ({ id })),
      },
    }
    : {};

// CREATE Department
export const createDepartment = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    const department = await p.department.create({
      data: {
        name,
        ...planningData(req.body),
        ...(Array.isArray(req.body.clearanceDepartmentIds)
          ? {
            clearanceDepartments: {
              connect: req.body.clearanceDepartmentIds.map((d: any) => ({ id: Number(d) })),
            },
          }
          : {}),
      },
      include: CLEARANCE_INCLUDE,
    });

    res.status(201).json(department);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create department" });
  }
};

// GET all Departments
export const getDepartments = async (req: Request, res: Response) => {
  try {
    const departments = await withClearanceRelations(
      () => p.department.findMany({ include: CLEARANCE_INCLUDE }),
      () => prisma.department.findMany(),
    );
    res.json(departments);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch departments" });
  }
};

// GET Department by ID
export const getDepartmentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const department = await withClearanceRelations(
      () => p.department.findUnique({ where: { id: Number(id) }, include: CLEARANCE_INCLUDE }),
      () => prisma.department.findUnique({ where: { id: Number(id) } }),
    );

    if (!department) return res.status(404).json({ error: "Department not found" });
    res.json(department);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch department" });
  }
};

// UPDATE Department
export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    // A department never needs to clear its own leaver — that is the HOD
    // clearance, which is created separately.
    const mapping: any = clearanceMapping(req.body);
    if (mapping.clearanceDepartments) {
      mapping.clearanceDepartments.set = mapping.clearanceDepartments.set
        .filter((d: { id: number }) => d.id !== Number(id));
    }

    const base = { ...(name !== undefined ? { name } : {}), ...planningData(req.body) };
    const updatedDepartment = await withClearanceRelations(
      () => p.department.update({
        where: { id: Number(id) },
        data: { ...base, ...mapping },
        include: CLEARANCE_INCLUDE,
      }),
      () => prisma.department.update({ where: { id: Number(id) }, data: base }),
    );

    res.json(updatedDepartment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update department" });
  }
};

// ─── Clearance checklist per department ──────────────────────────────────────
// The lines a department ticks off when somebody leaves. Nothing could create
// these before, so every clearance fell back to one generic line.

/** GET /departments/:id/clearance-items */
export const listClearanceItems = async (req: Request, res: Response) => {
  try {
    const departmentId = Number(req.params.id);
    const items = await prisma.clearanceTemplateItem.findMany({
      where: { departmentId },
      orderBy: [{ orderNo: 'asc' }, { id: 'asc' }],
    });
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch clearance items" });
  }
};

/**
 * PUT /departments/:id/clearance-items   { items: [{ id?, label }] }
 * Saves the whole checklist in the order given. An item that keeps its id stays
 * attached to exits already in progress, so a half-finished clearance is not
 * reset by an edit here.
 */
export const saveClearanceItems = async (req: Request, res: Response) => {
  try {
    const departmentId = Number(req.params.id);
    const { items } = req.body as { items: Array<{ id?: number; label: string }> };

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "items must be an array" });
    }
    const clean = items
      .map((it, idx) => ({ id: it.id ? Number(it.id) : null, label: String(it.label ?? '').trim(), orderNo: idx + 1 }))
      .filter((it) => it.label.length > 0);

    const existing = await prisma.clearanceTemplateItem.findMany({
      where: { departmentId },
      select: { id: true },
    });
    const keep = new Set(clean.map((c) => c.id).filter(Boolean) as number[]);
    const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);

    await prisma.$transaction(async (tx) => {
      if (removed.length) {
        // Detach from clearances already generated from them, then remove.
        await tx.resignationClearanceItem.updateMany({
          where: { templateItemId: { in: removed } },
          data: { templateItemId: null },
        });
        await tx.clearanceTemplateItem.deleteMany({ where: { id: { in: removed } } });
      }
      for (const it of clean) {
        if (it.id) {
          await tx.clearanceTemplateItem.update({
            where: { id: it.id },
            data: { label: it.label, orderNo: it.orderNo },
          });
        } else {
          await tx.clearanceTemplateItem.create({
            data: { departmentId, label: it.label, orderNo: it.orderNo },
          });
        }
      }
    }, { maxWait: 10000, timeout: 20000 });

    const saved = await prisma.clearanceTemplateItem.findMany({
      where: { departmentId },
      orderBy: [{ orderNo: 'asc' }, { id: 'asc' }],
    });
    res.json(saved);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to save clearance items" });
  }
};

// DELETE Department
export const deleteDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.department.delete({
      where: { id: Number(id) }
    });

    res.json({ message: "Department deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete department" });
  }
};
