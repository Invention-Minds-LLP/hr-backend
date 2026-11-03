// Module Utilization analytics.
//
// Answers: "per application module, which employees who CAN use it actually
// did something in it in a date range, and who never did?"
//
// Data source: ApiAccessLog (written by src/middleware/accessLog.ts on every
// /api request). `userId` there is the numeric Employee.id (the `empId` JWT
// claim), null for anonymous calls.
//
// NOTE: rows only land in ApiAccessLog for every request when
// config.security.logAllToDb is true; otherwise only security-flagged
// requests are stored and this report would undercount usage. Rows older than
// config.security.retentionDays are pruned, so the response says where the
// data actually starts (`dataFrom`).

import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { config } from "../../config";
import { PermissionKey } from "../../lib/permissions";
import { resolvePermissionsBulk } from "../../lib/permissionResolver";

/* ── module map ──────────────────────────────────────────────────────────
 * Maps the first path segment after /api/ (as mounted in src/index.ts) to a
 * user-facing business module. Prefixes not listed here (users, auth, me,
 * access, notifications, sms, export, download-otp, module-usage…) are
 * infrastructure and are deliberately excluded from the report.
 *
 *   writesOnly — only POST/PUT/PATCH/DELETE count. For lookup data every
 *                screen loads in the background (department/branch dropdowns,
 *                the holiday calendar): a GET there says nothing about use.
 *   audience   — who the module is for. Omitted = every active employee
 *                (self-service); otherwise employees holding ANY of the keys,
 *                so HR-only modules aren't measured against the whole staff.
 *
 * The frontend hides modules the client isn't licensed for (environment
 * payrollEnabled / weeklyTrackerEnabled), keyed by `key` — keep them in step.
 */
type ModuleDef = {
  key: string;
  label: string;
  prefixes: string[];
  writesOnly?: boolean;
  audience?: PermissionKey[];
};

const MODULE_MAP: ModuleDef[] = [
  {
    key: "attendance",
    label: "Attendance",
    prefixes: ["attendance", "mobile-attendance", "force-present", "shifts", "geo-tracking", "overtime"],
  },
  {
    key: "leave",
    label: "Leave",
    prefixes: ["leaves", "comp-off", "encashment", "permission", "wfh", "entitle"],
  },
  {
    key: "payroll",
    label: "Payroll",
    prefixes: ["payroll", "loans", "incentives", "tax"],
  },
  {
    key: "performance",
    label: "Performance",
    prefixes: ["appraisals", "performance", "weekly-rating", "pip", "probation"],
  },
  {
    key: "weekly-tracker",
    label: "Weekly Tracker",
    prefixes: ["weekly-tracker"],
    audience: ["admin.weeklyTracker.view"],
  },
  {
    key: "recruitment",
    label: "Recruitment",
    prefixes: ["recruiting", "internships", "requisitions", "tests", "test-assign", "test-attempts", "question-banks", "questions"],
    audience: ["recruitment.jobs.view", "recruitment.internships.view", "recruitment.interviews.view", "recruitment.requisition.view"],
  },
  {
    key: "employee-management",
    label: "Employee Management",
    prefixes: ["employees", "resignations", "hr-corrections", "letters", "archive"],
  },
  {
    key: "assets",
    label: "Assets",
    prefixes: ["assets"],
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
    prefixes: ["departments", "designation", "roles", "branches", "holidays", "companies"],
    writesOnly: true,
    audience: [
      "masters.departments.view", "masters.designations.view", "masters.roles.view", "masters.leaveTypes.view",
      "masters.shiftTemplates.view", "masters.holidays.view", "masters.incidentCategories.view",
      "masters.permissions.manage", "masters.dataScope.manage", "admin.companies.view",
    ],
  },
  {
    key: "dashboards",
    label: "Dashboards",
    prefixes: ["dashboard", "management", "manager"],
    audience: [
      "dashboard.hr.view", "dashboard.management.view", "dashboard.hrAnalytics.view",
      "dashboard.manager.view", "admin.moduleUtilization.view",
    ],
  },
];

/* GETs fired by shared widgets on almost every screen — the navbar's own
 * profile load, employee pickers, the announcement popup. Opening any page
 * triggers them, so they're not use of the module they happen to live in.
 * Paths are normalised (numeric segments → :id) before matching. */
const PASSIVE_GETS = new Set([
  "/api/employees/:id",
  "/api/employees/:id/requests",
  "/api/employees/active",
  "/api/employees/today",
  "/api/employees/incharge",
  "/api/employees/specific-roles",
  "/api/employees/by-role",
  "/api/employees/dept",
  "/api/announcement/live/all",
  "/api/announcement/live-employee",
  "/api/assets/meta",
]);

// prefix -> module, built once.
const PREFIX_TO_MODULE = new Map<string, ModuleDef>();
for (const m of MODULE_MAP) {
  for (const p of m.prefixes) PREFIX_TO_MODULE.set(p, m);
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

    // 1) Distinct (userId, method, normalised path) in the window. The path is
    //    kept (not just its prefix) so background lookups can be told apart
    //    from real work; numeric ids are folded so the set stays small.
    const [rows, firstLog] = await Promise.all([
      prisma.$queryRaw<{ userId: number; method: string; path: string }[]>(
        Prisma.sql`
          SELECT DISTINCT
            userId,
            method,
            REGEXP_REPLACE(path, '/[0-9]+(/|$)', '/:id$1') AS path
          FROM \`ApiAccessLog\`
          WHERE createdAt >= ${from}
            AND createdAt <= ${to}
            AND isAnonymous = false
            AND userId IS NOT NULL
            AND path LIKE '/api/%'
            AND statusCode < 400
        `,
      ),
      prisma.apiAccessLog.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ]);

    // 2) Employees who currently have system access
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
    const permsById = await resolvePermissionsBulk(eligible.map((u) => u.id));

    // 3) Per-module sets of distinct users.
    const usersByModule = new Map<string, Set<number>>();
    for (const m of MODULE_MAP) usersByModule.set(m.key, new Set());

    for (const row of rows) {
      const userId = Number(row.userId);
      if (!eligibleById.has(userId)) continue; // resigned/terminated since
      const path = String(row.path);
      const mod = PREFIX_TO_MODULE.get(path.split("/")[2] ?? "");
      if (!mod) continue; // infrastructure or unknown prefix
      const isRead = String(row.method).toUpperCase() === "GET";
      if (isRead && (mod.writesOnly || PASSIVE_GETS.has(path))) continue;
      usersByModule.get(mod.key)!.add(userId);
    }

    const modules = MODULE_MAP.map((m) => {
      const activeIds = usersByModule.get(m.key)!;
      const audience = m.audience
        ? eligible.filter((u) => m.audience!.some((k) => permsById.get(u.id)?.has(k)))
        : eligible;
      const activeUsers: UserLite[] = [];
      const inactiveUsers: UserLite[] = [];
      for (const u of audience) {
        (activeIds.has(u.id) ? activeUsers : inactiveUsers).push(u);
      }
      const eligibleCount = audience.length;
      const activeCount = activeUsers.length;
      return {
        key: m.key,
        label: m.label,
        audience: m.audience ? "access" : "all",
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
      // Earliest log row still on file, and how long rows are kept.
      dataFrom: firstLog?.createdAt.toISOString() ?? null,
      retentionDays: config.security.retentionDays,
      modules,
    });
  } catch (err: any) {
    console.error("[module-usage] summary failed:", err);
    res.status(500).json({ error: err?.message || "Internal Server Error" });
  }
};
