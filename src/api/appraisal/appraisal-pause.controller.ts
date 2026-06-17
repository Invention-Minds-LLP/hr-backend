import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Sum of paused days for an employee that overlap the window [from, to].
 * Used by:
 *   - The auto-draft cron (subtract from elapsed months before threshold check)
 *   - getEmployeeInsights (exclude paused windows when counting incidents/ratings)
 *   - The frontend period selector (subtract before deciding MONTH_1/3/6/YEAR_1)
 *
 * An ongoing pause (endDate=null) is treated as ending at `to`. Overlap is
 * clipped to the [from, to] window.
 */
export async function getPausedDaysBetween(
  employeeId: number,
  from: Date,
  to: Date,
): Promise<number> {
  const pauses = await prisma.employeeAppraisalPause.findMany({
    where: {
      employeeId,
      startDate: { lte: to },
      OR: [{ endDate: null }, { endDate: { gte: from } }],
    },
    select: { startDate: true, endDate: true },
  });

  let days = 0;
  for (const p of pauses) {
    const a = p.startDate < from ? from : p.startDate;
    const bRaw = p.endDate ?? to;
    const b = bRaw > to ? to : bRaw;
    if (b <= a) continue;
    days += Math.ceil((b.getTime() - a.getTime()) / MS_PER_DAY);
  }
  return days;
}

/**
 * Quick check: is the employee currently in an open pause window?
 * Used by every submit endpoint to refuse reviews mid-pause.
 */
export async function getActivePauseForEmployee(employeeId: number) {
  return prisma.employeeAppraisalPause.findFirst({
    where: { employeeId, endDate: null },
    orderBy: { startDate: "desc" },
  });
}

/**
 * Returns true if the actor is an HR Manager (roleId=1) or an HR Executive
 * (deptId=1 + roleId=2). HR is allowed to override the pause-block.
 */
export async function isHRActor(actorEmpId: number | null | undefined): Promise<boolean> {
  if (!actorEmpId) return false;
  const actor = await prisma.employee.findUnique({
    where: { id: actorEmpId },
    select: { roleId: true, departmentId: true },
  });
  if (!actor) return false;
  return actor.roleId === 1 || (actor.departmentId === 1 && actor.roleId === 2);
}

/**
 * Guard for submit endpoints. If the employee is currently paused AND the
 * actor is not HR, returns { blocked: true } and a 423-ready message. HR
 * (roleId 1, or dept 1 + roleId 2) is allowed through.
 *
 *   const guard = await assertNotPausedOrHR(empId, actorEmpId);
 *   if (guard.blocked) return res.status(423).json({ error: guard.message });
 */
export async function assertNotPausedOrHR(
  employeeId: number,
  actorEmpId: number | null | undefined,
): Promise<{ blocked: false } | { blocked: true; message: string; pause: any }> {
  const active = await getActivePauseForEmployee(employeeId);
  if (!active) return { blocked: false };

  if (await isHRActor(actorEmpId)) return { blocked: false };

  return {
    blocked: true,
    pause: active,
    message: `Employee's appraisal is paused (since ${active.startDate.toISOString().slice(0, 10)}: ${active.reason}). Only HR can override.`,
  };
}

/**
 * Effective months an employee has been "actively working" since their DOJ
 * (or any fromDate), with paused windows subtracted.
 */
export async function getEffectiveMonthsSinceJoining(
  employeeId: number,
  doj: Date,
  asOf: Date = new Date(),
): Promise<number> {
  const rawMs = asOf.getTime() - doj.getTime();
  const pausedDays = await getPausedDaysBetween(employeeId, doj, asOf);
  const effectiveMs = rawMs - pausedDays * MS_PER_DAY;
  return effectiveMs / (MS_PER_DAY * 30.4375); // mean month length
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD endpoints
// ═══════════════════════════════════════════════════════════════════════════

export const listEmployeePauses = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.empId);
    const pauses = await prisma.employeeAppraisalPause.findMany({
      where: { employeeId },
      orderBy: { startDate: "desc" },
    });
    res.json(pauses);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Returns the currently-active pause for an employee (endDate IS NULL),
 * plus convenience fields the UI uses for badges/labels.
 */
export const getActivePause = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.empId);
    const active = await prisma.employeeAppraisalPause.findFirst({
      where: { employeeId, endDate: null },
      orderBy: { startDate: "desc" },
    });
    res.json({ active });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const createPause = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.empId);
    const { startDate, endDate, reason, createdBy } = req.body as {
      startDate?: string;
      endDate?: string | null;
      reason?: string;
      createdBy?: number;
    };

    if (!startDate) return res.status(400).json({ error: "startDate is required" });
    if (!reason || !reason.trim()) return res.status(400).json({ error: "reason is required" });
    if (!createdBy) return res.status(400).json({ error: "createdBy is required" });

    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;
    if (end && end <= start) {
      return res.status(400).json({ error: "endDate must be after startDate" });
    }

    // Refuse a new pause when one is already active (UI should hit PATCH instead).
    const active = await prisma.employeeAppraisalPause.findFirst({
      where: { employeeId, endDate: null },
    });
    if (active && (!end || end > new Date())) {
      return res.status(409).json({
        error: "Employee already has an active pause. End the existing pause before starting a new one.",
        activePauseId: active.id,
      });
    }

    const pause = await prisma.employeeAppraisalPause.create({
      data: {
        employeeId,
        startDate: start,
        endDate: end,
        reason: reason.trim(),
        createdBy,
      },
    });
    res.json(pause);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Update an existing pause — used to end an active pause, fix the reason,
 * or correct a date. Endpoint is also used by the "Resume" button: it sets
 * endDate=today and endedBy=<actor>.
 */
export const updatePause = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.pauseId);
    const { startDate, endDate, reason, endedBy } = req.body as {
      startDate?: string;
      endDate?: string | null;
      reason?: string;
      endedBy?: number;
    };

    const existing = await prisma.employeeAppraisalPause.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Pause not found" });

    const data: any = {};
    if (startDate) data.startDate = new Date(startDate);
    if (endDate !== undefined) {
      data.endDate = endDate ? new Date(endDate) : null;
      // Closing an ongoing pause → record who closed it + when.
      if (endDate && !existing.endDate) {
        data.endedBy = endedBy ?? null;
        data.endedAt = new Date();
      }
    }
    if (reason !== undefined) data.reason = reason.trim();

    if (data.startDate && data.endDate && data.endDate <= data.startDate) {
      return res.status(400).json({ error: "endDate must be after startDate" });
    }
    if (!data.startDate && data.endDate && data.endDate <= existing.startDate) {
      return res.status(400).json({ error: "endDate must be after startDate" });
    }

    const updated = await prisma.employeeAppraisalPause.update({
      where: { id },
      data,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const deletePause = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.pauseId);
    const existing = await prisma.employeeAppraisalPause.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Pause not found" });
    await prisma.employeeAppraisalPause.delete({ where: { id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};
