// Module Utilization analytics.
//
// Answers: "per application module, which active employees actually used it
// (hit at least one of its APIs) in a date range, and who never did?"
//
// Data source: ApiAccessLog (written by src/middleware/accessLog.ts on every
// /api request). `userId` there is the numeric Employee.id (the `empId` JWT
// claim), null for anonymous calls.
//
// NOTE: rows only land in ApiAccessLog for every request when
// config.security.logAllToDb is true; otherwise only security-flagged
// requests are stored and this report would undercount usage.

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

/* ── module map ──────────────────────────────────────────────────────────
 * Maps the first path segment after /api/ (as mounted in src/index.ts) to a
 * user-facing business module. Prefixes not listed here (users, auth,
 * notifications, sms, export, pip-respond, temp…) are infrastructure and are
 * deliberately excluded from the report.
 */
const MODULE_MAP: { key: string; label: string; prefixes: string[] }[] = [
  {
    key: "attendance",
    label: "Attendance",
    prefixes: ["attendance", "biometric", "mobile-attendance", "force-present", "shifts", "geo-tracking"],
  },
  {
    key: "leave",
    label: "Leave",
    prefixes: ["leaves", "comp-off", "encashment", "permission", "wfh", "entitle", "holidays"],
  },
  {
    key: "payroll",
    label: "Payroll",
    prefixes: ["payroll", "loans", "incentives"],
  },
  {
    key: "performance",
    label: "Performance",
    prefixes: ["appraisals", "performance", "weekly-rating", "weekly-tracker", "tests", "pip"],
  },
  {
    key: "recruitment",
    label: "Recruitment",
    prefixes: ["recruiting", "internships", "requisitions", "test-assign", "test-attempts", "question-banks", "questions"],
  },
  {
    key: "employee-management",
    label: "Employee Management",
    prefixes: ["employees", "resignations", "hr-corrections"],
  },
  {
    key: "grievance-compliance",
    label: "Grievance & Compliance",
    prefixes: ["grievances", "posh", "incidents", "committees"],
  },
  {
    key: "training",
    label: "Training",
    prefixes: ["trainings"],
  },
  {
    key: "surveys-announcements",
    label: "Surveys & Announcements",
    prefixes: ["survey", "announcement"],
  },
  {
    key: "masters",
    label: "Masters",
    prefixes: ["departments", "designation", "roles", "branches"],
  },
  {
    key: "dashboards",
    label: "Dashboards",
    prefixes: ["dashboard", "management"],
  },
];

// prefix -> module key, built once.
const PREFIX_TO_MODULE = new Map<string, string>();
for (const m of MODULE_MAP) {
  for (const p of m.prefixes) PREFIX_TO_MODULE.set(p, m.key);
}

interface UserLite {
  id: number;
  name: string;
  code: string;
  department: string | null;
}

function parseDateParam(raw: unknown): Date | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/module-usage/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Defaults to the last 30 days.
 */
export const getModuleUsageSummary = async (req: Request, res: Response) => {
  try {
    const now = new Date();

    const fromParam = parseDateParam(req.query.from);
    const toParam = parseDateParam(req.query.to);

    // to = end of the given day (inclusive); from = start of day.
    const to = toParam ? new Date(toParam.getTime() + 24 * 60 * 60 * 1000 - 1) : now;
    const from = fromParam ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (from > to) {
      return res.status(400).json({ error: "'from' must be on or before 'to'" });
    }

    // 1) Distinct (userId, path prefix) pairs in the window.
    //    SUBSTRING_INDEX(SUBSTRING_INDEX(path,'/',3),'/',-1) extracts the
    //    segment after /api/ — e.g. '/api/leaves/123' → 'leaves'.
    const rows = await prisma.$queryRaw<{ userId: number; prefix: string }[]>(
      Prisma.sql`
        SELECT DISTINCT
          userId,
          SUBSTRING_INDEX(SUBSTRING_INDEX(path, '/', 3), '/', -1) AS prefix
        FROM \`ApiAccessLog\`
        WHERE createdAt >= ${from}
          AND createdAt <= ${to}
          AND isAnonymous = false
          AND userId IS NOT NULL
          AND path LIKE '/api/%'
      `,
    );

    // 2) Eligible denominator: employees who currently have system access
    //    (same definition as src/lib/employeeAccess.ts: ACTIVE or NOTICE_PERIOD).
    const employees = await prisma.employee.findMany({
      where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        Department: { select: { name: true } },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });

    const eligible: UserLite[] = employees.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      code: e.employeeCode,
      department: e.Department?.name ?? null,
    }));
    const eligibleById = new Map(eligible.map((u) => [u.id, u]));

    // 3) Per-module sets of distinct users (only counting eligible employees).
    const usersByModule = new Map<string, Set<number>>();
    for (const m of MODULE_MAP) usersByModule.set(m.key, new Set());

    for (const row of rows) {
      const userId = Number(row.userId);
      if (!eligibleById.has(userId)) continue; // resigned/terminated since → not in denominator
      const moduleKey = PREFIX_TO_MODULE.get(String(row.prefix));
      if (!moduleKey) continue; // infrastructure or unknown prefix
      usersByModule.get(moduleKey)!.add(userId);
    }

    const modules = MODULE_MAP.map((m) => {
      const activeIds = usersByModule.get(m.key)!;
      const activeUsers: UserLite[] = [];
      const inactiveUsers: UserLite[] = [];
      for (const u of eligible) {
        (activeIds.has(u.id) ? activeUsers : inactiveUsers).push(u);
      }
      const eligibleCount = eligible.length;
      const activeCount = activeUsers.length;
      return {
        key: m.key,
        label: m.label,
        eligibleCount,
        activeCount,
        inactiveCount: eligibleCount - activeCount,
        adoptionPct: eligibleCount > 0 ? Math.round((activeCount / eligibleCount) * 1000) / 10 : 0,
        activeUsers,
        inactiveUsers,
      };
    });

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      totalEligible: eligible.length,
      modules,
    });
  } catch (err: any) {
    console.error("[module-usage] summary failed:", err);
    res.status(500).json({ error: err?.message || "Internal Server Error" });
  }
};
