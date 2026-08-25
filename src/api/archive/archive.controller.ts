/**
 * HR's Archive screen — one list of everything retired across the modules.
 *
 * Reads ArchiveLog only. Each module still filters its own rows on its own
 * `archivedAt`; this is the index that makes a single sortable, pageable screen
 * possible without querying seven tables and merging in memory.
 *
 * Archiving and restoring go through lib/archivable.ts so the record's flag and
 * the index are always written together.
 */

import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import {
  ARCHIVE_MODULES,
  archiveModule,
  archiveRecord,
  restoreRecord,
} from "../../lib/archivable";

/**
 * Archiving is an administrative act, so it is HR's alone — matching
 * `admin.archive.view`, which seeds to HR Manager. Management is included for
 * reading the same way it is everywhere else in the appraisal modules.
 */
function isArchiveAdmin(req: Request): boolean {
  const user = (req as any).user;
  const role = (user?.role || "").trim();
  if (role === "HR" || role === "HR Manager" || role === "Management") return true;
  // HR department, matching how the performance module identifies HR staff.
  return Number(user?.deptId) === 1;
}

function userId(req: Request): number | null {
  const raw = Number((req as any).user?.empId);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** GET /archive/modules — the filter dropdown. */
export const listArchiveModules = async (req: Request, res: Response) => {
  try {
    if (!isArchiveAdmin(req)) {
      return res.status(403).json({ error: "You cannot view the archive" });
    }

    // Counts alongside the names, so HR sees where the archived records are
    // without opening each filter.
    const counts = await prisma.archiveLog.groupBy({
      by: ["module"],
      where: { restoredAt: null },
      _count: { _all: true },
    });
    const byKey = new Map(counts.map((c) => [c.module, c._count._all]));

    res.json(
      ARCHIVE_MODULES.map((m) => ({
        key: m.key,
        label: m.label,
        count: byKey.get(m.key) ?? 0,
      })),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /archive
 *   ?module=       one module key
 *   ?employeeId=   records about one person
 *   ?from= &to=    archived within a date range (yyyy-mm-dd)
 *   ?q=            substring of the frozen label
 *   ?includeRestored=true   also show records already brought back
 *   ?page= &limit=
 */
export const listArchive = async (req: Request, res: Response) => {
  try {
    if (!isArchiveAdmin(req)) {
      return res.status(403).json({ error: "You cannot view the archive" });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
    const includeRestored = req.query.includeRestored === "true";

    const where: any = {};
    if (!includeRestored) where.restoredAt = null;

    const moduleKey = String(req.query.module ?? "").trim();
    if (moduleKey) {
      if (!archiveModule(moduleKey)) {
        return res.status(400).json({ error: `Unknown module "${moduleKey}"` });
      }
      where.module = moduleKey;
    }

    const employeeId = Number(req.query.employeeId);
    if (employeeId) where.employeeId = employeeId;

    const q = String(req.query.q ?? "").trim();
    if (q) where.label = { contains: q };

    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
      return res.status(400).json({ error: "from/to must be dates (yyyy-mm-dd)" });
    }
    if (from || to) {
      where.archivedAt = {};
      if (from) where.archivedAt.gte = from;
      // `to` is a day, so take the whole of it rather than midnight.
      if (to) where.archivedAt.lte = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1);
    }

    const [total, rows] = await Promise.all([
      prisma.archiveLog.count({ where }),
      prisma.archiveLog.findMany({
        where,
        orderBy: { archivedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Who pressed the button, resolved in one query rather than per row.
    const actorIds = [
      ...new Set(
        rows.flatMap((r) => [r.archivedBy, r.restoredBy]).filter((v): v is number => !!v),
      ),
    ];
    const actors = actorIds.length
      ? await prisma.employee.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        })
      : [];
    const actorMap = new Map(
      actors.map((a) => [a.id, `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() || a.employeeCode]),
    );

    res.json({
      page,
      limit,
      total,
      rows: rows.map((r) => ({
        ...r,
        moduleLabel: archiveModule(r.module)?.label ?? r.module,
        archivedByName: r.archivedBy ? actorMap.get(r.archivedBy) ?? null : null,
        restoredByName: r.restoredBy ? actorMap.get(r.restoredBy) ?? null : null,
        restored: !!r.restoredAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** POST /archive  { module, recordId, reason? } */
export const archive = async (req: Request, res: Response) => {
  try {
    if (!isArchiveAdmin(req)) {
      return res.status(403).json({ error: "Only HR can archive a record" });
    }

    const moduleKey = String(req.body?.module ?? "").trim();
    const recordId = Number(req.body?.recordId);
    if (!moduleKey || !recordId) {
      return res.status(400).json({ error: "module and recordId are required" });
    }

    const result = await archiveRecord(moduleKey, recordId, userId(req), req.body?.reason);
    if (!result.ok) return res.status(result.status ?? 400).json({ error: result.error });

    res.json({
      ...result.record,
      archived: true,
      message: "Kept but hidden from the working list. Restore it from the Archive screen.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** POST /archive/restore  { module, recordId } */
export const restore = async (req: Request, res: Response) => {
  try {
    if (!isArchiveAdmin(req)) {
      return res.status(403).json({ error: "Only HR can restore a record" });
    }

    const moduleKey = String(req.body?.module ?? "").trim();
    const recordId = Number(req.body?.recordId);
    if (!moduleKey || !recordId) {
      return res.status(400).json({ error: "module and recordId are required" });
    }

    const result = await restoreRecord(moduleKey, recordId, userId(req));
    if (!result.ok) return res.status(result.status ?? 400).json({ error: result.error });

    res.json({ ...result.record, archived: false, message: "The record is active again." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
