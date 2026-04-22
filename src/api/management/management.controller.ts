import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { addDays, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths, format } from "date-fns";

function startOfDayIST(d = new Date()): Date {
  const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  ist.setHours(0, 0, 0, 0);
  return ist;
}
function endOfDayIST(d = new Date()): Date {
  const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  ist.setHours(23, 59, 59, 999);
  return ist;
}

// ═══════════════════════════════════════════════════════════
// SECTION 1 — PULSE KPIs
// GET /api/management/pulse
// ═══════════════════════════════════════════════════════════
export const getPulse = async (req: Request, res: Response) => {
  try {
    const todayStart = startOfDayIST();
    const todayEnd = endOfDayIST();
    const monthStart = startOfMonth(new Date());
    const monthEnd = endOfMonth(new Date());

    const [
      totalHeadcount,
      presentToday,
      pendingLeaves,
      pendingPermissions,
      openJobs,
      activePIPs,
      resignationsThisMonth,
      otPending,
      trainingTotal,
      trainingCompleted,
    ] = await Promise.all([
      // 1. Total active headcount
      prisma.employee.count({ where: { employmentStatus: "ACTIVE" } }),

      // 2. Present today
      prisma.attendance.count({
        where: {
          date: { gte: todayStart, lte: todayEnd },
          status: "PRESENT",
        },
      }),

      // 3. Pending leave requests
      prisma.leaveRequest.count({ where: { status: "PENDING" } }),

      // 4. Pending permissions
      prisma.permissionRequest.count({ where: { status: "PENDING" } }),

      // 5. Open job positions
      prisma.job.count({ where: { status: "OPEN" } }),

      // 6. Active PIPs
      prisma.employeePIP.count({
        where: {
          status: {
            in: ["WARNING_ISSUED", "PIP_ACTIVE", "PIP_EXTENDED"],
          },
        },
      }),

      // 7. Resignations this month
      prisma.resignationRequest.count({
        where: {
          createdAt: { gte: monthStart, lte: monthEnd },
          status: { notIn: ["WITHDRAWN", "CANCELLED", "REJECTED"] },
        },
      }),

      // 8. OT pending approval (>60 min)
      prisma.overtimeApproval.count({
        where: {
          status: "PENDING",
          managerStatus: "APPROVED",
          minutes: { gt: 60 },
        } as any,
      }),

      // 9. Training assignments total
      prisma.trainingAssignment.count(),

      // 10. Training completed
      prisma.trainingAssignment.count({ where: { status: "Completed" } }),
    ]);

    const attendancePct =
      totalHeadcount > 0
        ? Math.round((presentToday / totalHeadcount) * 100)
        : 0;

    const trainingPct =
      trainingTotal > 0
        ? Math.round((trainingCompleted / trainingTotal) * 100)
        : 0;

    res.json({
      headcount: totalHeadcount,
      presentToday,
      attendancePct,
      pendingApprovals: pendingLeaves + pendingPermissions,
      pendingLeaves,
      pendingPermissions,
      openPositions: openJobs,
      activePIPs,
      attritionMTD: resignationsThisMonth,
      otPending,
      trainingCompletionPct: trainingPct,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 2 — WORKFORCE
// GET /api/management/workforce
// ═══════════════════════════════════════════════════════════
export const getWorkforce = async (_req: Request, res: Response) => {
  try {
    // Fetch ALL employees (every status) so the donut can show every segment.
    const allEmployees = await prisma.employee.findMany({
      select: {
        firstName: true,
        lastName: true,
        employmentType: true,
        employmentStatus: true,
        Department: { select: { name: true } },
        designation: { select: { name: true } },
      },
      orderBy: [{ departmentId: "asc" }, { firstName: "asc" }],
    });

    // Active slice — used for the by-dept breakdown (currently working staff)
    const activeEmployees = allEmployees.filter((e) => e.employmentStatus === "ACTIVE");

    // By department + employment type (active only)
    const deptMap = new Map<string, Record<string, number>>();
    for (const e of activeEmployees) {
      const dept = e.Department?.name || "Unassigned";
      const type = e.employmentType || "Other";
      if (!deptMap.has(dept)) deptMap.set(dept, {});
      const row = deptMap.get(dept)!;
      row[type] = (row[type] || 0) + 1;
      row["_total"] = (row["_total"] || 0) + 1;
    }

    const byDept = Array.from(deptMap.entries())
      .sort((a, b) => (b[1]["_total"] || 0) - (a[1]["_total"] || 0))
      .map(([dept, types]) => ({ dept, ...types }));

    // By status (donut) — ALL statuses included
    const statusMap = new Map<string, number>();
    for (const e of allEmployees) {
      const s = e.employmentStatus || "UNKNOWN";
      statusMap.set(s, (statusMap.get(s) || 0) + 1);
    }

    // Preserve a canonical status order so colors stay consistent
    const statusOrder = ["ACTIVE", "NOTICE_PERIOD", "SABBATICAL", "SUSPENDED", "RESIGNED", "TERMINATED"];
    const byStatus = statusOrder
      .filter((s) => statusMap.has(s))
      .map((s) => ({ status: s, count: statusMap.get(s)! }))
      .concat(
        Array.from(statusMap.entries())
          .filter(([s]) => !statusOrder.includes(s))
          .map(([status, count]) => ({ status, count })),
      );

    // Full employee roster (all statuses) for drill-down
    const employeeList = allEmployees.map((e) => ({
      name: `${e.firstName} ${e.lastName}`,
      dept: e.Department?.name || "—",
      designation: e.designation?.name || "—",
      type: e.employmentType || "—",
      status: e.employmentStatus,
    }));

    res.json({
      byDept,
      byStatus,
      total: allEmployees.length,      // grand total across all statuses
      activeTotal: activeEmployees.length, // separate field for "active only"
      employeeList,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 3 — ATTENDANCE SUMMARY
// GET /api/management/attendance-summary?days=7|14|30
// ═══════════════════════════════════════════════════════════
export const getAttendanceSummary = async (req: Request, res: Response) => {
  try {
    const numDays = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);

    const rangeStart = startOfDayIST(addDays(new Date(), -(numDays - 1)));
    const rangeEnd   = endOfDayIST(new Date());

    // ── Determine months covered by the window ────────────────
    const monthsInRange: { year: number; month: number }[] = [];
    const seenMonths = new Set<string>();
    for (let i = numDays - 1; i >= 0; i--) {
      const d = addDays(new Date(), -i);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      if (!seenMonths.has(key)) {
        seenMonths.add(key);
        monthsInRange.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
      }
    }

    const totalActive = await prisma.employee.count({ where: { employmentStatus: "ACTIVE" } });

    // ── Public holidays in range ──────────────────────────────
    const publicHolidays = await prisma.holiday.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd } },
      select: { date: true, title: true },
    });
    const holidayMap = new Map<string, string>();
    for (const h of publicHolidays) {
      const ist = new Date(h.date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      holidayMap.set(format(ist, "yyyy-MM-dd"), h.title);
    }

    // ── Approved weekly off from ShiftApproval ────────────────
    // Fetch all approved monthly rotational shift configs for active employees
    // covering months in the trend window
    const shiftApprovals = await prisma.shiftApproval.findMany({
      where: {
        status: "APPROVED",
        month: { not: null },
        year:  { not: null },
        OR: monthsInRange.map(({ year, month }) => ({ year, month })),
      },
      select: { employeeId: true, month: true, year: true, weekOffConfig: true },
    });

    // Build per-employee week-off dates within the range
    // Map<employeeId, Set<"yyyy-MM-dd">>
    const empWeekOffDates = new Map<number, Set<string>>();
    // Track which employees have an approved shift per month
    const approvedEmpsByMonth = new Map<string, Set<number>>();

    for (const approval of shiftApprovals) {
      if (!approval.month || !approval.year) continue;

      const monthKey = `${approval.year}-${approval.month}`;
      if (!approvedEmpsByMonth.has(monthKey)) approvedEmpsByMonth.set(monthKey, new Set());
      approvedEmpsByMonth.get(monthKey)!.add(approval.employeeId);

      const cfg = approval.weekOffConfig as { weeks?: Record<string, number> } | null;
      if (!cfg?.weeks) continue;

      // Compute week-off dates: same algorithm as attendance.controller.ts
      const monthStart = new Date(approval.year, approval.month - 1, 1);
      const firstWeekStart = new Date(monthStart);
      firstWeekStart.setDate(monthStart.getDate() - monthStart.getDay()); // back to Sunday
      firstWeekStart.setHours(0, 0, 0, 0);

      if (!empWeekOffDates.has(approval.employeeId)) empWeekOffDates.set(approval.employeeId, new Set());
      const datesSet = empWeekOffDates.get(approval.employeeId)!;

      Object.entries(cfg.weeks).forEach(([weekIndexStr, dayOfWeek]) => {
        const weekIndex = Number(weekIndexStr);
        if (Number.isNaN(weekIndex) || typeof dayOfWeek !== "number") return;

        const woDate = new Date(firstWeekStart);
        woDate.setDate(firstWeekStart.getDate() + weekIndex * 7 + dayOfWeek);

        if (woDate >= rangeStart && woDate <= rangeEnd) {
          datesSet.add(format(woDate, "yyyy-MM-dd"));
        }
      });
    }

    // ── Fetch active employee roster once (for absent-list drill-down) ──
    const activeEmployees = await prisma.employee.findMany({
      where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        Department:  { select: { name: true } },
        designation: { select: { name: true } },
      },
    });
    const empMap = new Map(activeEmployees.map((e) => [e.id, {
      id: e.id,
      name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
      employeeCode: e.employeeCode,
      dept: e.Department?.name ?? "—",
      designation: e.designation?.name ?? "—",
    }]));

    // Pull all attendance records across the full range in one query
    const fullRangeRecords = await prisma.attendance.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd } },
      select: { employeeId: true, status: true, date: true },
    });
    // Group by yyyy-MM-dd → Map<employeeId, status>
    const attByDay = new Map<string, Map<number, string>>();
    for (const rec of fullRangeRecords) {
      const key = format(new Date(rec.date), "yyyy-MM-dd");
      if (!attByDay.has(key)) attByDay.set(key, new Map());
      attByDay.get(key)!.set(rec.employeeId, rec.status);
    }

    // ── Build daily summary ───────────────────────────────────
    const days: any[] = [];

    for (let i = numDays - 1; i >= 0; i--) {
      const d        = addDays(new Date(), -i);
      const dayStr   = format(d, "yyyy-MM-dd");
      const label    = numDays <= 7 ? format(d, "EEE dd") : format(d, "dd MMM");
      const monthKey = `${d.getFullYear()}-${d.getMonth() + 1}`;

      // Count employees whose approved week-off falls on this date
      let weekoffFromApprovals = 0;
      const weekoffEmpIds = new Set<number>();
      for (const [empId, dates] of empWeekOffDates.entries()) {
        if (dates.has(dayStr)) {
          weekoffFromApprovals++;
          weekoffEmpIds.add(empId);
        }
      }

      // Employees WITHOUT an approved shift this month → Sunday fallback
      const approvedThisMonth   = approvedEmpsByMonth.get(monthKey)?.size ?? 0;
      const unapprovedThisMonth = Math.max(0, totalActive - approvedThisMonth);
      const sundayFallback      = d.getDay() === 0 ? unapprovedThisMonth : 0;

      const totalWeekoff   = weekoffFromApprovals + sundayFallback;
      const holidayTitle   = holidayMap.get(dayStr);
      const isHoliday      = !!holidayTitle;
      const isWeekOff      = totalWeekoff > 0;

      // Count statuses from the pre-fetched map
      const dayMap = attByDay.get(dayStr) ?? new Map<number, string>();
      let present = 0, leave = 0, permission = 0;
      const attendedIds = new Set<number>();
      for (const [empId, st] of dayMap.entries()) {
        if (st === "PRESENT")    { present++;    attendedIds.add(empId); }
        else if (st === "LEAVE") { leave++;      attendedIds.add(empId); }
        else if (st === "PERMISSION") { permission++; attendedIds.add(empId); }
      }

      if (isHoliday) {
        // Public holiday: nobody is absent
        days.push({
          date: label, dateStr: dayStr,
          present, absent: 0, leave: 0, permission: 0,
          weekoff: Math.max(0, totalActive - present),
          isNonWorking: true, nonWorkingLabel: holidayTitle,
          absentEmployees: [],
        });
      } else {
        // Working day (may have some employees on week-off)
        const weekoffNet         = Math.max(0, totalWeekoff - present);
        const presentFromRegular = Math.max(0, present - totalWeekoff);
        const expectedRegular    = Math.max(0, totalActive - totalWeekoff);
        const absent = Math.max(0, expectedRegular - presentFromRegular - leave - permission);

        // Absent employee list: active minus on-weekoff minus those with any record today
        const absentList: any[] = [];
        for (const [empId, info] of empMap.entries()) {
          if (weekoffEmpIds.has(empId)) continue;
          if (attendedIds.has(empId)) continue;
          absentList.push(info);
        }

        days.push({
          date: label, dateStr: dayStr,
          present, absent, leave, permission,
          weekoff: weekoffNet,
          isNonWorking: false, nonWorkingLabel: isWeekOff ? "Week Off" : null,
          absentEmployees: absentList,
        });
      }
    }

    res.json({ days, totalActive, numDays });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 3b — LEAVE CALENDAR
// GET /api/management/leave-calendar?month=YYYY-MM
// ═══════════════════════════════════════════════════════════
export const getLeaveCalendar = async (req: Request, res: Response) => {
  try {
    // Helper: convert a UTC Date from DB to IST date string (yyyy-MM-dd)
    const toISTDateStr = (d: Date): string => {
      const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      return format(ist, "yyyy-MM-dd");
    };

    // Build IST month boundaries: start = IST midnight of day 1, end = IST 23:59:59 of last day
    let year = new Date().getFullYear();
    let month = new Date().getMonth() + 1; // 1-based
    if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month as string)) {
      [year, month] = (req.query.month as string).split("-").map(Number);
    }

    // IST midnight of first day → UTC  (IST = UTC+5:30, so midnight IST = prev day 18:30 UTC)
    const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
    // IST 23:59:59 of last day
    const lastDay = new Date(year, month, 0).getDate(); // days in month
    const monthEnd = new Date(Date.UTC(year, month - 1, lastDay, 23, 59, 59, 999) - 5.5 * 60 * 60 * 1000);

    console.log(`Fetching leaves overlapping ${year}-${String(month).padStart(2, "0")}-01 to ${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`);
    console.log( monthStart, monthEnd );

    const leaves = await prisma.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      select: {
        startDate: true,
        endDate: true,
        employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
        leaveType: { select: { name: true } },
      },
    });

    // Build day → entries map using IST date strings
    const dayMap = new Map<string, { count: number; entries: { name: string; type: string }[]; typeCounts: Map<string, number> }>();

    // IST date strings for month boundaries (for range filtering in the loop)
    const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEndStr   = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    for (const l of leaves) {
      let cur = new Date(l.startDate);
      const end = new Date(l.endDate);
      const leaveTypeName = l.leaveType?.name || "Leave";

      while (cur <= end) {
        const key = toISTDateStr(cur);
        // Only include days within the requested month
        if (key >= monthStartStr && key <= monthEndStr) {
          if (!dayMap.has(key)) dayMap.set(key, { count: 0, entries: [], typeCounts: new Map() });
          const entry = dayMap.get(key)!;
          entry.count += 1;
          entry.entries.push({
            name: `${l.employee.firstName} ${l.employee.lastName} (${l.employee.Department?.name || "-"})`,
            type: leaveTypeName,
          });
          entry.typeCounts.set(leaveTypeName, (entry.typeCounts.get(leaveTypeName) || 0) + 1);
        }
        cur = addDays(cur, 1);
      }
    }

    const calendar = Array.from(dayMap.entries()).map(([date, v]) => {
      // dominant leave type for colour coding
      let dominantType = "Leave";
      let maxCount = 0;
      v.typeCounts.forEach((cnt, type) => { if (cnt > maxCount) { maxCount = cnt; dominantType = type; } });
      return {
        date,
        count: v.count,
        // tooltip string: "Name (Dept) [TYPE]"
        employees: v.entries.map(e => `${e.name} [${e.type}]`),
        dominantType,
        types: Array.from(v.typeCounts.entries()).map(([type, cnt]) => ({ type, cnt })),
      };
    });

    // Top leave types this month
    const typeCount = new Map<string, number>();
    for (const l of leaves) {
      const t = l.leaveType?.name || "Leave";
      typeCount.set(t, (typeCount.get(t) || 0) + 1);
    }
    const topTypes = Array.from(typeCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => ({ type, count }));

    res.json({
      calendar,
      topTypes,
      month: `${year}-${String(month).padStart(2, "0")}`,
      monthLabel: format(new Date(year, month - 1, 1), "MMMM yyyy"),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 4 — PERFORMANCE RADAR
// GET /api/management/performance-radar
// ═══════════════════════════════════════════════════════════
export const getPerformanceRadar = async (_req: Request, res: Response) => {
  try {
    const managerAppraisals = await prisma.managerAppraisal.findMany({
      select: {
        communication: true,
        teamwork: true,
        problemSolving: true,
        initiative: true,
        reliability: true,
        attendanceRating: true,
        leadershipRating: true,
        qualityOfWorkRating: true,
        overallScore: true,
      },
    });

    const selfAppraisals = await prisma.selfAppraisal.findMany({
      select: {
        communication: true,
        teamwork: true,
        problemSolving: true,
        initiative: true,
        reliability: true,
        overallScore: true,
      },
    });

    const avg = (arr: (number | null)[]) => {
      const valid = arr.filter((v): v is number => v !== null && v !== undefined);
      return valid.length ? Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * 10) / 10 : 0;
    };

    // Map frontend dimension keys to actual DB field names
    const dimensionMap: Record<string, string> = {
      communication: "communication",
      teamwork: "teamwork",
      problemSolving: "problemSolving",
      initiative: "initiative",
      reliability: "reliability",
      attendance: "attendanceRating",
      leadership: "leadershipRating",
      qualityOfWork: "qualityOfWorkRating",
    };

    const dimensions = ["communication", "teamwork", "problemSolving", "initiative", "reliability", "attendance", "leadership", "qualityOfWork"] as const;

    const managerAvg = dimensions.map((d) => ({
      dimension: d,
      value: avg(managerAppraisals.map((a) => (a as any)[dimensionMap[d]])),
    }));

    const selfDims = ["communication", "teamwork", "problemSolving", "initiative", "reliability"] as const;
    const selfAvg = selfDims.map((d) => ({
      dimension: d,
      value: avg(selfAppraisals.map((a) => (a as any)[d])),
    }));

    res.json({
      managerRatings: managerAvg,
      selfRatings: selfAvg,
      totalAppraisals: managerAppraisals.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 4b — ACTIVE PIPs
// GET /api/management/pip-active
// ═══════════════════════════════════════════════════════════
export const getActivePIPs = async (_req: Request, res: Response) => {
  try {
    const pips = await prisma.employeePIP.findMany({
      where: {
        status: { in: ["WARNING_ISSUED", "PIP_ACTIVE", "PIP_EXTENDED"] },
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            Department: { select: { name: true } },
          },
        },
        weeklyReviews: {
          orderBy: { weekNumber: "asc" },
          select: { weekNumber: true, weeklyScore: true, status: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const result = pips.map((p) => ({
      id: p.id,
      pipNumber: p.pipNumber,
      employeeName: `${p.employee.firstName} ${p.employee.lastName}`,
      department: p.employee.Department?.name || "—",
      triggerScore: p.triggerScore,
      triggerMonth: p.triggerMonth,
      status: p.status,
      weeklyScores: p.weeklyReviews.map((r) => ({
        week: r.weekNumber,
        score: r.weeklyScore,
        status: r.status,
      })),
      trend:
        p.weeklyReviews.length >= 2
          ? (p.weeklyReviews[p.weeklyReviews.length - 1].weeklyScore || 0) >
            (p.weeklyReviews[0].weeklyScore || 0)
            ? "improving"
            : "declining"
          : "neutral",
    }));

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 5 — ATTRITION TREND (last 12 months)
// GET /api/management/attrition-trend
// ═══════════════════════════════════════════════════════════
export const getAttritionTrend = async (_req: Request, res: Response) => {
  try {
    const months: {
      month: string;
      submitted: number;
      exited: number;
      resignations: any[];   // employees who resigned this month (for drill-down)
    }[] = [];

    for (let i = 11; i >= 0; i--) {
      const d = subMonths(new Date(), i);
      const mStart = startOfMonth(d);
      const mEnd = endOfMonth(d);
      const label = format(d, "MMM yy");

      const [submitted, exited, resignList] = await Promise.all([
        prisma.resignationRequest.count({
          where: {
            createdAt: { gte: mStart, lte: mEnd },
            status: { notIn: ["WITHDRAWN", "CANCELLED"] },
          },
        }),
        prisma.resignationRequest.count({
          where: {
            actualLastWorkingDay: { gte: mStart, lte: mEnd },
            status: "COMPLETED",
          },
        }),
        prisma.resignationRequest.findMany({
          where: {
            createdAt: { gte: mStart, lte: mEnd },
            status: { notIn: ["WITHDRAWN", "CANCELLED"] },
          },
          select: {
            actualLastWorkingDay: true,
            proposedLastWorkingDay: true,
            status: true,
            employee: {
              select: {
                firstName: true, lastName: true, employeeCode: true,
                Department:  { select: { name: true } },
                designation: { select: { name: true } },
              },
            },
          },
        }),
      ]);

      const resignations = resignList.map((r) => ({
        name: `${r.employee?.firstName ?? ""} ${r.employee?.lastName ?? ""}`.trim(),
        employeeCode: r.employee?.employeeCode ?? "",
        dept: r.employee?.Department?.name ?? "—",
        designation: r.employee?.designation?.name ?? "—",
        lastDate: (r.actualLastWorkingDay ?? r.proposedLastWorkingDay)?.toISOString().slice(0, 10) ?? "—",
        status: r.status,
      }));

      months.push({ month: label, submitted, exited, resignations });
    }

    // Top exit reason from exit interviews
    const interviews = await prisma.exitInterview.findMany({
      where: { completedAt: { not: null } },
      select: { reasonForLeaving: true } as any,
    });

    const reasonMap = new Map<string, number>();
    for (const i of interviews) {
      const r = (i as any).reasonForLeaving;
      if (r) reasonMap.set(r, (reasonMap.get(r) || 0) + 1);
    }
    const topReason =
      Array.from(reasonMap.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    res.json({ months, topReason });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 5b — RECRUITMENT FUNNEL
// GET /api/management/recruitment-funnel
// ═══════════════════════════════════════════════════════════
export const getRecruitmentFunnel = async (_req: Request, res: Response) => {
  try {
    const stages = [
      { key: "applied", label: "Applied", statuses: ["APPLIED", "SCREENING"] },
      { key: "shortlisted", label: "Shortlisted", statuses: ["SHORTLISTED"] },
      { key: "interviewed", label: "Interviewed", statuses: ["INTERVIEW_SCHEDULED", "INTERVIEWED"] },
      { key: "offered", label: "Offered", statuses: ["OFFERED", "OFFER_ACCEPTED", "OFFER_DECLINED"] },
      { key: "joined", label: "Joined", statuses: ["HIRED"] },
    ];

    const counts = await Promise.all(
      stages.map((s) =>
        prisma.application.count({ where: { status: { in: s.statuses as any[] } } })
      )
    );

    const funnel = stages.map((s, i) => ({
      stage: s.label,
      count: counts[i],
      dropPct:
        i > 0 && counts[i - 1] > 0
          ? Math.round(((counts[i - 1] - counts[i]) / counts[i - 1]) * 100)
          : 0,
    }));

    // Offer acceptance rate
    const offered = await prisma.application.count({
      where: { status: { in: ["OFFERED", "OFFER_ACCEPTED", "OFFER_DECLINED"] } },
    });
    const accepted = await prisma.application.count({
      where: { status: "OFFER_ACCEPTED" },
    });
    const acceptanceRate = offered > 0 ? Math.round((accepted / offered) * 100) : 0;

    res.json({ funnel, acceptanceRate });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 6 — TRAINING BY DEPARTMENT
// GET /api/management/training-by-dept
// ═══════════════════════════════════════════════════════════
export const getTrainingByDept = async (_req: Request, res: Response) => {
  try {
    const assignments = await prisma.trainingAssignment.findMany({
      include: {
        employee: { select: { Department: { select: { name: true } } } },
      },
    });

    const deptMap = new Map<string, { total: number; completed: number }>();
    for (const a of assignments) {
      const dept = a.employee?.Department?.name || "Unassigned";
      if (!deptMap.has(dept)) deptMap.set(dept, { total: 0, completed: 0 });
      const row = deptMap.get(dept)!;
      row.total += 1;
      if (a.status === "Completed") row.completed += 1;
    }

    const result = Array.from(deptMap.entries())
      .map(([dept, v]) => ({
        dept,
        total: v.total,
        completed: v.completed,
        pct: v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 7 — ACTION ITEMS
// GET /api/management/action-items
// ═══════════════════════════════════════════════════════════
export const getActionItems = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const in7days = addDays(now, 7);
    const in30days = addDays(now, 30);

    const [
      pipTerminations,
      overdueGrievances,
      poshCases,
      probationEnding,
      expiringDocs,
      overdueClearances,
    ] = await Promise.all([
      // PIP terminations initiated
      prisma.employeePIP.findMany({
        where: { status: "TERMINATION_INITIATED" },
        select: {
          id: true,
          pipNumber: true,
          warningDate: true,
          employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
        },
      }),

      // Grievances open >7 days
      prisma.grievance.findMany({
        where: {
          status: { in: ["OPEN", "IN_REVIEW"] },
          createdAt: { lte: addDays(now, -7) },
        },
        select: {
          id: true,
          title: true,
          createdAt: true,
          employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
        },
      }),

      // Active POSH cases
      prisma.poshCase.findMany({
        where: { status: { in: ["FILED", "UNDER_INVESTIGATION"] } },
        select: {
          id: true,
          status: true,
          createdAt: true,
          complainant: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
        },
      }),

      // Probation ending in 7 days
      prisma.employee.findMany({
        where: { probationEndDate: { gte: now, lte: in7days }, employmentStatus: "ACTIVE" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          probationEndDate: true,
          Department: { select: { name: true } },
        },
      }),

      // Documents expiring in 30 days
      prisma.document.findMany({
        where: { expiryDate: { gte: now, lte: in30days } },
        select: {
          id: true,
          type: true,
          expiryDate: true,
          employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
        },
      }),

      // Overdue exit clearances (>7 days pending)
      prisma.resignationClearance.findMany({
        where: {
          decision: { not: "APPROVED" },
          createdAt: { lte: addDays(now, -7) },
        },
        select: {
          id: true,
          type: true,
          createdAt: true,
          resignation: {
            select: {
              employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
            },
          },
        },
        take: 20,
      }),
    ]);

    const items: any[] = [];

    for (const p of pipTerminations) {
      items.push({
        category: "PIP",
        severity: "danger",
        item: "Termination initiated",
        employee: `${p.employee.firstName} ${p.employee.lastName}`,
        dept: p.employee.Department?.name || "—",
        since: p.warningDate ? Math.max(0, Math.floor((now.getTime() - new Date(p.warningDate).getTime()) / 86400000)) : null,
        ref: p.id,
        tag: "pip",
      });
    }

    for (const g of overdueGrievances) {
      const days = Math.floor((now.getTime() - new Date(g.createdAt).getTime()) / 86400000);
      items.push({
        category: "Grievance",
        severity: days > 14 ? "danger" : "warn",
        item: g.title,
        employee: `${g.employee.firstName} ${g.employee.lastName}`,
        dept: g.employee.Department?.name || "—",
        since: days,
        ref: g.id,
        tag: "grievance",
      });
    }

    for (const c of poshCases) {
      const days = Math.floor((now.getTime() - new Date(c.createdAt).getTime()) / 86400000);
      items.push({
        category: "POSH",
        severity: "danger",
        item: c.status === "FILED" ? "Case filed" : "Under investigation",
        employee: `${c.complainant.firstName} ${c.complainant.lastName}`,
        dept: c.complainant.Department?.name || "—",
        since: days,
        ref: c.id,
        tag: "posh",
      });
    }

    for (const e of probationEnding) {
      const days = e.probationEndDate
        ? Math.ceil((new Date(e.probationEndDate).getTime() - now.getTime()) / 86400000)
        : null;
      items.push({
        category: "Probation",
        severity: "warn",
        item: `Ending in ${days} day(s)`,
        employee: `${e.firstName} ${e.lastName}`,
        dept: e.Department?.name || "—",
        since: null,
        daysLeft: days,
        ref: e.id,
        tag: "probation",
      });
    }

    for (const d of expiringDocs) {
      const days = d.expiryDate
        ? Math.ceil((new Date(d.expiryDate).getTime() - now.getTime()) / 86400000)
        : null;
      items.push({
        category: "Document",
        severity: days !== null && days <= 7 ? "danger" : "warn",
        item: `${d.type || "Document"} expiring in ${days} day(s)`,
        employee: `${d.employee.firstName} ${d.employee.lastName}`,
        dept: d.employee.Department?.name || "—",
        since: null,
        daysLeft: days,
        ref: d.id,
        tag: "document",
      });
    }

    for (const c of overdueClearances) {
      const days = Math.floor((now.getTime() - new Date(c.createdAt).getTime()) / 86400000);
      items.push({
        category: "Clearance",
        severity: "warn",
        item: `${c.type} clearance pending`,
        employee: `${c.resignation.employee.firstName} ${c.resignation.employee.lastName}`,
        dept: c.resignation.employee.Department?.name || "—",
        since: days,
        ref: c.id,
        tag: "clearance",
      });
    }

    // Sort: danger first, then by since desc
    items.sort((a, b) => {
      if (a.severity === "danger" && b.severity !== "danger") return -1;
      if (b.severity === "danger" && a.severity !== "danger") return 1;
      return (b.since || 0) - (a.since || 0);
    });

    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 7b — DEPARTMENT RISK ANALYSIS
// GET /api/management/dept-risk
// ═══════════════════════════════════════════════════════════
export const getDeptRisk = async (_req: Request, res: Response) => {
  try {
    const monthStart = startOfMonth(new Date());
    const monthEnd   = endOfMonth(new Date());
    const threeMonthsAgo = subMonths(new Date(), 3);

    // 1. Resignations per dept (last 3 months)
    const resignations = await prisma.resignationRequest.findMany({
      where: {
        createdAt: { gte: threeMonthsAgo },
        status: { notIn: ["WITHDRAWN", "CANCELLED", "REJECTED"] },
      },
      include: {
        employee: { select: { Department: { select: { name: true } } } },
      },
    });

    // 2. Leave requests this month per dept
    const leaves = await prisma.leaveRequest.findMany({
      where: {
        status: { in: ["APPROVED", "PENDING"] },
        startDate: { lte: monthEnd },
        endDate:   { gte: monthStart },
      },
      include: {
        employee: { select: { Department: { select: { name: true } } } },
        leaveType: { select: { name: true } },
      },
    });

    // 3. Latest appraisal scores per employee
    const appraisals = await prisma.appraisalForm.findMany({
      where: { overallScore: { not: null } },
      orderBy: { createdAt: "desc" },
      select: {
        employeeId: true,
        overallScore: true,
        employee: { select: { Department: { select: { name: true } } } },
      },
    });
    const latestScore = new Map<number, { score: number; dept: string }>();
    for (const a of appraisals) {
      if (!latestScore.has(a.employeeId)) {
        latestScore.set(a.employeeId, {
          score: a.overallScore!,
          dept: a.employee?.Department?.name || "Unassigned",
        });
      }
    }

    // 4. Active PIPs per dept
    const pips = await prisma.employeePIP.findMany({
      where: { status: { in: ["WARNING_ISSUED", "PIP_ACTIVE", "PIP_EXTENDED"] } },
      include: { employee: { select: { Department: { select: { name: true } } } } },
    });

    // 5. Headcount per dept
    const employees = await prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: { Department: { select: { name: true } } },
    });

    // Aggregate
    const deptMap = new Map<string, {
      headcount: number;
      resignations: number;
      leaveCount: number;
      leaveTypes: Map<string, number>;
      scores: number[];
      pips: number;
    }>();

    const ensureDept = (d: string) => {
      if (!deptMap.has(d)) deptMap.set(d, { headcount: 0, resignations: 0, leaveCount: 0, leaveTypes: new Map(), scores: [], pips: 0 });
      return deptMap.get(d)!;
    };

    for (const e of employees) {
      const dept = e.Department?.name || "Unassigned";
      ensureDept(dept).headcount += 1;
    }
    for (const r of resignations) {
      const dept = r.employee?.Department?.name || "Unassigned";
      ensureDept(dept).resignations += 1;
    }
    for (const l of leaves) {
      const dept = l.employee?.Department?.name || "Unassigned";
      const row = ensureDept(dept);
      row.leaveCount += 1;
      const t = l.leaveType?.name || "Leave";
      row.leaveTypes.set(t, (row.leaveTypes.get(t) || 0) + 1);
    }
    for (const [, v] of latestScore) {
      ensureDept(v.dept).scores.push(v.score);
    }
    for (const p of pips) {
      const dept = p.employee?.Department?.name || "Unassigned";
      ensureDept(dept).pips += 1;
    }

    const result = Array.from(deptMap.entries())
      .filter(([, v]) => v.headcount > 0)
      .map(([dept, v]) => {
        const avgScore = v.scores.length
          ? Math.round(v.scores.reduce((s, x) => s + x, 0) / v.scores.length)
          : null;
        const topLeaveTypes = Array.from(v.leaveTypes.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([type, count]) => `${type} (${count})`);
        // Risk score: weighted sum (resign weight=3, low score weight=2, pips weight=2, leave rate weight=1)
        const resignRate   = v.headcount > 0 ? v.resignations / v.headcount : 0;
        const leaveRate    = v.headcount > 0 ? v.leaveCount / v.headcount : 0;
        const scoreRisk    = avgScore !== null ? Math.max(0, (60 - avgScore) / 60) : 0;
        const pipRate      = v.pips / Math.max(v.headcount, 1);
        const riskScore    = Math.round(
          (resignRate * 3 + leaveRate * 1 + scoreRisk * 2 + pipRate * 2) * 33
        );
        const riskLevel    = riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low";

        // Score breakdown — individual contribution of each factor
        const breakdown = {
          resign: Math.round(resignRate * 3 * 33),
          leave:  Math.round(leaveRate  * 1 * 33),
          score:  Math.round(scoreRisk  * 2 * 33),
          pip:    Math.round(pipRate    * 2 * 33),
        };

        return {
          dept,
          headcount: v.headcount,
          resignations: v.resignations,
          leaveCount: v.leaveCount,
          topLeaveTypes,
          avgScore,
          pips: v.pips,
          riskScore: Math.min(riskScore, 100),
          riskLevel,
          breakdown,
        };
      })
      .sort((a, b) => b.riskScore - a.riskScore);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 8 — DEPARTMENT SNAPSHOT
// GET /api/management/dept-snapshot
// ═══════════════════════════════════════════════════════════
export const getDeptSnapshot = async (_req: Request, res: Response) => {
  try {
    const todayStart = startOfDayIST();
    const todayEnd = endOfDayIST();

    // All active employees grouped by dept
    const employees = await prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: { id: true, Department: { select: { name: true } } },
    });

    // Today's attendance
    const todayAttendance = await prisma.attendance.findMany({
      where: { date: { gte: todayStart, lte: todayEnd }, status: "PRESENT" },
      select: { employeeId: true },
    });
    const presentSet = new Set(todayAttendance.map((a) => a.employeeId));

    // Latest appraisal scores
    const appraisals = await prisma.appraisalForm.findMany({
      where: { overallScore: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { employeeId: true, overallScore: true },
    });
    // Keep only the latest appraisal per employee
    const latestScore = new Map<number, number>();
    for (const a of appraisals) {
      if (!latestScore.has(a.employeeId)) latestScore.set(a.employeeId, a.overallScore!);
    }

    // Active PIPs per employee
    const pips = await prisma.employeePIP.findMany({
      where: { status: { in: ["WARNING_ISSUED", "PIP_ACTIVE", "PIP_EXTENDED"] } },
      select: { employeeId: true },
    });
    const pipSet = new Set(pips.map((p) => p.employeeId));

    // Aggregate by dept
    const deptMap = new Map<string, { headcount: number; present: number; scores: number[]; pips: number }>();
    for (const e of employees) {
      const dept = e.Department?.name || "Unassigned";
      if (!deptMap.has(dept)) deptMap.set(dept, { headcount: 0, present: 0, scores: [], pips: 0 });
      const row = deptMap.get(dept)!;
      row.headcount += 1;
      if (presentSet.has(e.id)) row.present += 1;
      if (latestScore.has(e.id)) row.scores.push(latestScore.get(e.id)!);
      if (pipSet.has(e.id)) row.pips += 1;
    }

    const result = Array.from(deptMap.entries())
      .map(([dept, v]) => ({
        dept,
        headcount: v.headcount,
        present: v.present,
        attendancePct: v.headcount > 0 ? Math.round((v.present / v.headcount) * 100) : 0,
        avgScore: v.scores.length > 0 ? Math.round(v.scores.reduce((s, x) => s + x, 0) / v.scores.length) : null,
        pips: v.pips,
      }))
      .sort((a, b) => b.headcount - a.headcount);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 9 — WEEKLY RATING TREND (last 8 weeks)
// GET /api/management/weekly-trend
// ═══════════════════════════════════════════════════════════
export const getWeeklyTrend = async (_req: Request, res: Response) => {
  try {
    const eightWeeksAgo = addDays(new Date(), -56);

    const ratings = await prisma.weeklyPerformanceRating.findMany({
      where: {
        weekStartDate: { gte: eightWeeksAgo },
        status: "SUBMITTED",
        overallScore: { not: null },
      },
      select: {
        weekStartDate: true,
        weekLabel: true,
        overallScore: true,
        ratedBy: true,
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
      },
      orderBy: { weekStartDate: "asc" },
    });

    // Collect unique rater IDs so we can show who rated in the drill-down
    const raterIds = Array.from(new Set(ratings.map((r) => r.ratedBy)));
    const raters = await prisma.employee.findMany({
      where: { id: { in: raterIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const raterName = new Map(raters.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));

    // Group by week
    const weekMap = new Map<string, { label: string; scores: number[]; submissions: any[] }>();
    for (const r of ratings) {
      const key = format(new Date(r.weekStartDate), "yyyy-MM-dd");
      const label = r.weekLabel || format(new Date(r.weekStartDate), "dd MMM");
      if (!weekMap.has(key)) weekMap.set(key, { label, scores: [], submissions: [] });
      const bucket = weekMap.get(key)!;
      bucket.scores.push(r.overallScore!);
      bucket.submissions.push({
        name: `${r.employee?.firstName ?? ""} ${r.employee?.lastName ?? ""}`.trim(),
        employeeCode: r.employee?.employeeCode ?? "",
        dept: r.employee?.Department?.name ?? "—",
        designation: r.employee?.designation?.name ?? "—",
        score: r.overallScore,
        ratedBy: raterName.get(r.ratedBy) ?? "—",
      });
    }

    const weeks = Array.from(weekMap.entries()).map(([, v]) => ({
      label: v.label,
      avgScore: v.scores.length > 0 ? Math.round((v.scores.reduce((s, x) => s + x, 0) / v.scores.length) * 10) / 10 : 0,
      rated: v.scores.length,
      submissions: v.submissions,
    }));

    // Trend: comparing last 4 weeks vs previous 4 weeks
    const last4 = weeks.slice(-4);
    const prev4 = weeks.slice(-8, -4);
    const avgLast = last4.length ? last4.reduce((s, w) => s + w.avgScore, 0) / last4.length : 0;
    const avgPrev = prev4.length ? prev4.reduce((s, w) => s + w.avgScore, 0) / prev4.length : 0;
    const trend = avgLast > avgPrev ? "improving" : avgLast < avgPrev ? "declining" : "stable";

    res.json({ weeks, trend, avgLast: Math.round(avgLast * 10) / 10, avgPrev: Math.round(avgPrev * 10) / 10 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 10 — PERFORMANCE DISTRIBUTION
// GET /api/management/performance-distribution
// ═══════════════════════════════════════════════════════════
export const getPerformanceDistribution = async (_req: Request, res: Response) => {
  try {
    // Latest appraisal per employee
    const appraisals = await prisma.appraisalForm.findMany({
      where: { overallScore: { not: null } },
      orderBy: { createdAt: "desc" },
      select: {
        employeeId: true,
        overallScore: true,
        status: true,
        cycle: true,
        employee: {
          select: {
            firstName: true,
            lastName: true,
            Department:  { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
      },
    });

    const seenEmployees = new Set<number>();
    const latest: typeof appraisals = [];
    for (const a of appraisals) {
      if (!seenEmployees.has(a.employeeId)) {
        seenEmployees.add(a.employeeId);
        latest.push(a);
      }
    }

    // Score bands
    const bands = [
      { label: "Excellent (80–100)", min: 80, max: 100, color: "#22c55e" },
      { label: "Good (60–79)", min: 60, max: 79, color: "#60a5fa" },
      { label: "Average (40–59)", min: 40, max: 59, color: "#f59e0b" },
      { label: "Below Avg (<40)", min: 0, max: 39, color: "#ef4444" },
    ];

    const distribution = bands.map((b) => ({
      ...b,
      count: latest.filter((a) => (a.overallScore ?? 0) >= b.min && (a.overallScore ?? 0) <= b.max).length,
    }));

    // Drill-down: per-employee row with the band label so frontend can filter
    const bandFor = (score: number): string => {
      const b = bands.find((bb) => score >= bb.min && score <= bb.max);
      return b?.label ?? "—";
    };
    const employeeList = latest.map((a) => ({
      name: `${a.employee?.firstName ?? ""} ${a.employee?.lastName ?? ""}`.trim(),
      dept: a.employee?.Department?.name || "—",
      designation: a.employee?.designation?.name || "—",
      score: a.overallScore,
      band: bandFor(a.overallScore ?? 0),
    }));

    // Appraisal completion: employees with a submitted/completed appraisal vs total active
    const totalActive = await prisma.employee.count({ where: { employmentStatus: "ACTIVE" } });
    const withAppraisal = latest.length;
    const completionPct = totalActive > 0 ? Math.round((withAppraisal / totalActive) * 100) : 0;

    // Dept-wise avg score
    const deptScores = new Map<string, number[]>();
    for (const a of latest) {
      const dept = a.employee?.Department?.name || "Unassigned";
      if (!deptScores.has(dept)) deptScores.set(dept, []);
      deptScores.get(dept)!.push(a.overallScore!);
    }
    const deptAvg = Array.from(deptScores.entries())
      .map(([dept, scores]) => ({
        dept,
        avg: Math.round(scores.reduce((s, x) => s + x, 0) / scores.length),
        count: scores.length,
      }))
      .sort((a, b) => b.avg - a.avg);

    res.json({ distribution, completionPct, withAppraisal, totalActive, deptAvg, employeeList });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 11 — KPI DRILLDOWN DETAIL
// GET /api/management/kpi-detail?type=present|approvals|attrition|ot|positions
// ═══════════════════════════════════════════════════════════
export const getKpiDetail = async (req: Request, res: Response) => {
  const type = req.query.type as string;
  try {
    if (type === "present") {
      const todayStart = startOfDayIST();
      const todayEnd = endOfDayIST();
      const rows = await prisma.attendance.findMany({
        where: { date: { gte: todayStart, lte: todayEnd }, status: "PRESENT" },
        include: {
          employee: {
            select: {
              firstName: true, lastName: true,
              Department: { select: { name: true } },
              designation: { select: { name: true } },
            },
          },
        },
        orderBy: { checkIn: "asc" },
      });
      return res.json(rows.map((r) => ({
        name: `${r.employee?.firstName} ${r.employee?.lastName}`,
        department: r.employee?.Department?.name || "—",
        designation: r.employee?.designation?.name || "—",
        checkIn: r.checkIn ? format(new Date(r.checkIn), "hh:mm a") : "—",
        checkOut: r.checkOut ? format(new Date(r.checkOut), "hh:mm a") : "—",
      })));
    }

    if (type === "approvals") {
      const [leaves, permissions] = await Promise.all([
        prisma.leaveRequest.findMany({
          where: { status: "PENDING" },
          include: {
            employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
            leaveType: { select: { name: true } },
          },
          orderBy: { createdAt: "asc" },
          take: 50,
        }),
        prisma.permissionRequest.findMany({
          where: { status: "PENDING" },
          include: {
            employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
          },
          orderBy: { createdAt: "asc" },
          take: 50,
        }),
      ]);
      const now = new Date();
      const items = [
        ...leaves.map((l) => ({
          name: `${l.employee?.firstName} ${l.employee?.lastName}`,
          department: l.employee?.Department?.name || "—",
          type: l.leaveType?.name || "Leave",
          requestType: "Leave",
          since: Math.floor((now.getTime() - new Date(l.createdAt).getTime()) / 86400000),
        })),
        ...permissions.map((p) => ({
          name: `${p.employee?.firstName} ${p.employee?.lastName}`,
          department: p.employee?.Department?.name || "—",
          type: "Permission",
          requestType: "Permission",
          since: Math.floor((now.getTime() - new Date(p.createdAt).getTime()) / 86400000),
        })),
      ].sort((a, b) => b.since - a.since);
      return res.json(items);
    }

    if (type === "attrition") {
      const monthStart = startOfMonth(new Date());
      const monthEnd = endOfMonth(new Date());
      const rows = await prisma.resignationRequest.findMany({
        where: {
          createdAt: { gte: monthStart, lte: monthEnd },
          status: { notIn: ["WITHDRAWN", "CANCELLED", "REJECTED"] },
        },
        include: {
          employee: {
            select: {
              firstName: true, lastName: true,
              Department: { select: { name: true } },
              designation: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return res.json(rows.map((r) => ({
        name: `${r.employee?.firstName} ${r.employee?.lastName}`,
        department: r.employee?.Department?.name || "—",
        designation: r.employee?.designation?.name || "—",
        reason: r.reason || "—",
        lastDate: r.proposedLastWorkingDay ? format(new Date(r.proposedLastWorkingDay), "dd MMM yyyy") : "—",
        status: r.status,
      })));
    }

    if (type === "ot") {
      const rows = await (prisma.overtimeApproval as any).findMany({
        where: { status: "PENDING", managerStatus: "APPROVED", minutes: { gt: 60 } },
        include: {
          employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
        },
        orderBy: { date: "desc" },
        take: 50,
      });
      return res.json(rows.map((r: any) => ({
        name: `${r.employee?.firstName} ${r.employee?.lastName}`,
        department: r.employee?.Department?.name || "—",
        date: format(new Date(r.date), "dd MMM yyyy"),
        minutes: r.minutes,
        hours: `${Math.floor(r.minutes / 60)}h ${r.minutes % 60}m`,
      })));
    }

    if (type === "positions") {
      const now = new Date();
      const jobs = await prisma.job.findMany({
        where: { status: "OPEN" },
        include: { department: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      });
      return res.json(jobs.map((j) => ({
        title: j.title,
        department: j.department?.name || "—",
        headcount: j.headcount,
        openSince: Math.floor((now.getTime() - new Date(j.createdAt).getTime()) / 86400000),
        location: j.location || "—",
      })));
    }

    res.status(400).json({ error: "Unknown type. Use: present | approvals | attrition | ot | positions" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 12 — OT ANALYSIS
// GET /api/management/ot-analysis?month=YYYY-MM
// ═══════════════════════════════════════════════════════════
export const getOtAnalysis = async (req: Request, res: Response) => {
  try {
    const monthParam = req.query.month as string | undefined;
    let rangeStart: Date;
    let rangeEnd: Date;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const base = new Date(`${monthParam}-01`);
      rangeStart = startOfMonth(base);
      rangeEnd = endOfMonth(base);
    } else {
      rangeStart = startOfMonth(new Date());
      rangeEnd = endOfMonth(new Date());
    }

    // Dept-wise OT totals (approved)
    const otByDept = await prisma.overtimeApproval.groupBy({
      by: ["employeeId"],
      where: {
        date: { gte: rangeStart, lte: rangeEnd },
        status: "APPROVE",
        managerStatus: "APPROVED",
      },
      _sum: { minutes: true },
    });

    // Get employee info for dept grouping
    const empIds = otByDept.map((r) => r.employeeId);
    const employees = await prisma.employee.findMany({
      where: { id: { in: empIds } },
      include: {
        Department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });
    const empMap = new Map(employees.map((e) => [e.id, e]));

    // Aggregate by dept
    const deptMap = new Map<string, number>();
    for (const row of otByDept) {
      const emp = empMap.get(row.employeeId);
      const dept = emp?.Department?.name || "Unknown";
      deptMap.set(dept, (deptMap.get(dept) || 0) + (row._sum.minutes || 0));
    }
    const deptTotals = Array.from(deptMap.entries())
      .map(([dept, minutes]) => ({ dept, minutes, hours: +(minutes / 60).toFixed(1) }))
      .sort((a, b) => b.minutes - a.minutes);

    // All employees with OT — sorted by dept then hours desc
    const allEmployees = otByDept
      .map((row) => {
        const emp = empMap.get(row.employeeId);
        return {
          name: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
          dept: emp?.Department?.name || "—",
          designation: emp?.designation?.name || "—",
          minutes: row._sum.minutes || 0,
          hours: +(((row._sum.minutes || 0) / 60)).toFixed(1),
        };
      })
      .sort((a, b) => a.dept.localeCompare(b.dept) || b.minutes - a.minutes);

    // Top 15 for summary card
    const topEmployees = [...allEmployees].sort((a, b) => b.minutes - a.minutes).slice(0, 15);

    const monthLabel = format(rangeStart, "MMMM yyyy");
    res.json({ deptTotals, topEmployees, allEmployees, monthLabel });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 13 — LATE ARRIVALS ANALYSIS
// GET /api/management/late-arrivals?days=30
// ═══════════════════════════════════════════════════════════
export const getLateArrivals = async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt((req.query.days as string) || "30", 10) || 30, 90);
    const since = startOfDayIST(addDays(new Date(), -days + 1));

    // All late login records with employee info
    const allLate = await prisma.lateLoginLog.findMany({
      where: { date: { gte: since } },
      include: {
        employee: { include: { Department: { select: { name: true } } } },
      },
    });

    // Per-employee aggregation
    type EmpLate = { name: string; dept: string; count: number; totalMinutes: number };
    const empLateMap = new Map<number, EmpLate>();
    for (const row of allLate) {
      const emp = row.employee;
      const cur = empLateMap.get(row.employeeId) || {
        name: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
        dept: emp?.Department?.name || "—",
        count: 0,
        totalMinutes: 0,
      };
      cur.count += 1;
      cur.totalMinutes += row.lateMinutes || 0;
      empLateMap.set(row.employeeId, cur);
    }

    // All employees sorted by dept then count desc
    const allEmployees = Array.from(empLateMap.values())
      .map((e) => ({ ...e, avgMinutes: Math.round(e.totalMinutes / e.count) }))
      .sort((a, b) => a.dept.localeCompare(b.dept) || b.count - a.count);

    // Top 15 for summary card (by count desc)
    const topLate = [...allEmployees].sort((a, b) => b.count - a.count).slice(0, 15);

    // Dept heatmap
    const deptFreq = new Map<string, { count: number; totalMinutes: number }>();
    for (const row of allLate) {
      const dept = row.employee?.Department?.name || "Unknown";
      const cur = deptFreq.get(dept) || { count: 0, totalMinutes: 0 };
      cur.count += 1;
      cur.totalMinutes += row.lateMinutes || 0;
      deptFreq.set(dept, cur);
    }
    const deptHeatmap = Array.from(deptFreq.entries())
      .map(([dept, v]) => ({ dept, count: v.count, avgMinutes: Math.round(v.totalMinutes / v.count) }))
      .sort((a, b) => b.count - a.count);

    res.json({ topLate, allEmployees, deptHeatmap, days });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 14 — LEAVE BALANCE UTILIZATION
// GET /api/management/leave-utilization
// ═══════════════════════════════════════════════════════════
export const getLeaveUtilization = async (_req: Request, res: Response) => {
  try {
    const year = new Date().getFullYear();

    const balances = await prisma.employeeLeaveBalance.findMany({ where: { year } });

    // Fetch employees separately and build a map
    const empIds = [...new Set(balances.map((b) => b.employeeId))];
    const empList = await prisma.employee.findMany({
      where: { id: { in: empIds } },
      include: { Department: { select: { name: true } } },
    });
    const empMap = new Map(empList.map((e) => [e.id, e]));

    // Aggregate per employee (sum all leave-type rows per employee)
    type EmpAgg = { allowed: number; used: number };
    const empAgg = new Map<number, EmpAgg>();
    for (const b of balances) {
      const cur = empAgg.get(b.employeeId) || { allowed: 0, used: 0 };
      cur.allowed += b.totalAllowed || 0;
      cur.used += (b.used || 0) + (b.halfDayUsed || 0) * 0.5;
      empAgg.set(b.employeeId, cur);
    }

    // Dept-wise aggregation
    const deptMap = new Map<string, { allowed: number; used: number; count: number }>();
    for (const [empId, agg] of empAgg.entries()) {
      const emp = empMap.get(empId);
      const dept = emp?.Department?.name || "Unknown";
      const cur = deptMap.get(dept) || { allowed: 0, used: 0, count: 0 };
      cur.allowed += agg.allowed;
      cur.used += agg.used;
      cur.count += 1;
      deptMap.set(dept, cur);
    }

    const deptStats = Array.from(deptMap.entries())
      .map(([dept, v]) => ({
        dept,
        headcount: v.count,
        totalAllowed: v.allowed,
        totalUsed: +v.used.toFixed(1),
        remaining: +(v.allowed - v.used).toFixed(1),
        utilizationPct: v.allowed > 0 ? Math.round((v.used / v.allowed) * 100) : 0,
      }))
      .sort((a, b) => b.utilizationPct - a.utilizationPct);

    // All employees — sorted by dept then utilization desc (no limit)
    const allEmployees = Array.from(empAgg.entries())
      .map(([empId, agg]) => {
        const emp = empMap.get(empId);
        return {
          name: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
          dept: emp?.Department?.name || "—",
          allowed: agg.allowed,
          used: +agg.used.toFixed(1),
          remaining: +(agg.allowed - agg.used).toFixed(1),
          utilizationPct: agg.allowed > 0 ? Math.round((agg.used / agg.allowed) * 100) : 0,
        };
      })
      .sort((a, b) => a.dept.localeCompare(b.dept) || b.utilizationPct - a.utilizationPct);

    // Top 15 for summary card
    const topUsers = [...allEmployees]
      .filter((e) => e.used > 0)
      .sort((a, b) => b.utilizationPct - a.utilizationPct)
      .slice(0, 15);

    res.json({ deptStats, topUsers, allEmployees, year });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 15 — ABSENTEEISM TRACKING
// GET /api/management/absenteeism?days=30
// ═══════════════════════════════════════════════════════════
export const getAbsenteeism = async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt((req.query.days as string) || "30", 10) || 30, 90);
    const since = startOfDayIST(addDays(new Date(), -days + 1));

    // Count absent days per employee (ABSENT or LEAVE status without approved leave = absenteeism)
    const absentGroups = await prisma.attendance.groupBy({
      by: ["employeeId"],
      where: {
        date: { gte: since },
        status: "ABSENT",
      },
      _count: { id: true },
      having: { id: { _count: { gte: 3 } } },
      orderBy: { _count: { id: "desc" } },
    });

    const empIds = absentGroups.map((r) => r.employeeId);
    const employees = await prisma.employee.findMany({
      where: { id: { in: empIds } },
      include: { Department: { select: { name: true } } },
    });
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const chronicAbsentees = absentGroups.map((row) => {
      const emp = empMap.get(row.employeeId);
      return {
        name: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
        dept: emp?.Department?.name || "—",
        absentDays: row._count.id,
        absentRate: Math.round((row._count.id / days) * 100),
      };
    });

    // Dept-wise absent days (all employees, not just chronic)
    const allAbsent = await prisma.attendance.groupBy({
      by: ["employeeId"],
      where: {
        date: { gte: since },
        status: "ABSENT",
      },
      _count: { id: true },
    });

    const allEmpIds = allAbsent.map((r) => r.employeeId);
    const allEmpsForDept = await prisma.employee.findMany({
      where: { id: { in: allEmpIds } },
      include: { Department: { select: { name: true } } },
    });
    const allEmpMap = new Map(allEmpsForDept.map((e) => [e.id, e]));

    const deptAbsent = new Map<string, number>();
    for (const row of allAbsent) {
      const dept = allEmpMap.get(row.employeeId)?.Department?.name || "Unknown";
      deptAbsent.set(dept, (deptAbsent.get(dept) || 0) + row._count.id);
    }

    // Get headcount per dept for rate calculation
    const deptHeadcounts = await prisma.employee.groupBy({
      by: ["departmentId"],
      where: { employmentStatus: "ACTIVE" },
      _count: { id: true },
    });
    const deptNames = await prisma.department.findMany({ select: { id: true, name: true } });

    const deptSummary = Array.from(deptAbsent.entries())
      .map(([dept, totalAbsent]) => {
        const deptEntry = deptNames.find((d) => d.name === dept);
        const hc = deptEntry
          ? (deptHeadcounts.find((d) => d.departmentId === deptEntry.id)?._count.id || 1)
          : 1;
        return {
          dept,
          totalAbsentDays: totalAbsent,
          headcount: hc,
          avgAbsentDays: +(totalAbsent / hc).toFixed(1),
          absentRate: Math.round((totalAbsent / (hc * days)) * 100),
        };
      })
      .sort((a, b) => b.absentRate - a.absentRate);

    // All absent employees sorted by dept then absent days desc
    const allAbsentEmployees = allAbsent
      .map((row) => {
        const emp = allEmpMap.get(row.employeeId);
        return {
          name: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
          dept: emp?.Department?.name || "—",
          absentDays: row._count.id,
          absentRate: Math.round((row._count.id / days) * 100),
        };
      })
      .sort((a, b) => a.dept.localeCompare(b.dept) || b.absentDays - a.absentDays);

    res.json({ chronicAbsentees, deptSummary, allAbsentEmployees, days });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 16 — WORKFORCE INSIGHTS (Age/Gender + Tenure)
// GET /api/management/workforce-insights
// ═══════════════════════════════════════════════════════════
export const getWorkforceInsights = async (_req: Request, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } },
      select: {
        firstName: true,
        lastName: true,
        employeeCode: true,
        dob: true,
        gender: true,
        dateOfJoining: true,
        Department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });

    const now = new Date();

    // Helper to classify tenure into the same buckets as the chart
    const tenureBandFor = (doj: Date | null): string => {
      if (!doj) return "unknown";
      const yrs = (now.getTime() - new Date(doj).getTime()) / (365.25 * 24 * 3600 * 1000);
      if (yrs < 1) return "< 1 year";
      if (yrs < 3) return "1 – 3 yrs";
      if (yrs < 5) return "3 – 5 yrs";
      if (yrs < 10) return "5 – 10 yrs";
      return "> 10 yrs";
    };

    // Full employee list (used by frontend for drill-down popups)
    const employeeList = employees.map((e) => {
      const ageYrs = e.dob
        ? (now.getTime() - new Date(e.dob).getTime()) / (365.25 * 24 * 3600 * 1000)
        : null;
      return {
        name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
        employeeCode: e.employeeCode,
        dept: e.Department?.name || "Unassigned",
        designation: e.designation?.name || "—",
        gender: e.gender,
        age: ageYrs != null ? Math.floor(ageYrs) : null,
        ageBand: ageYrs != null ? (ageYrs <= 45 ? "≤ 45 years" : "> 45 years") : "unknown",
        dateOfJoining: e.dateOfJoining
          ? new Date(e.dateOfJoining).toISOString().slice(0, 10) : null,
        tenureBand: tenureBandFor(e.dateOfJoining),
        joiningYear: e.dateOfJoining ? new Date(e.dateOfJoining).getFullYear() : null,
      };
    });

    // ── Age-Gender Split ──────────────────────────────────
    const ageSplit = {
      below45: { MALE: 0, FEMALE: 0, OTHER: 0 },
      above45: { MALE: 0, FEMALE: 0, OTHER: 0 },
    };

    for (const e of employees) {
      if (!e.dob) continue;
      const age = (now.getTime() - new Date(e.dob).getTime()) / (365.25 * 24 * 3600 * 1000);
      const bucket = age <= 45 ? "below45" : "above45";
      const g = (e.gender === "MALE" || e.gender === "FEMALE") ? e.gender : "OTHER";
      ageSplit[bucket][g] += 1;
    }

    const ageSplitChart = [
      { label: "≤ 45 years", male: ageSplit.below45.MALE, female: ageSplit.below45.FEMALE, other: ageSplit.below45.OTHER },
      { label: "> 45 years", male: ageSplit.above45.MALE, female: ageSplit.above45.FEMALE, other: ageSplit.above45.OTHER },
    ];

    // ── Tenure Buckets ────────────────────────────────────
    const tenureBuckets = [
      { label: "< 1 year",   min: 0,  max: 1,   count: 0 },
      { label: "1 – 3 yrs",  min: 1,  max: 3,   count: 0 },
      { label: "3 – 5 yrs",  min: 3,  max: 5,   count: 0 },
      { label: "5 – 10 yrs", min: 5,  max: 10,  count: 0 },
      { label: "> 10 yrs",   min: 10, max: 9999, count: 0 },
    ];

    for (const e of employees) {
      if (!e.dateOfJoining) continue;
      const tenureYrs = (now.getTime() - new Date(e.dateOfJoining).getTime()) / (365.25 * 24 * 3600 * 1000);
      for (const b of tenureBuckets) {
        if (tenureYrs >= b.min && tenureYrs < b.max) { b.count++; break; }
      }
    }

    // ── Joining vs Resignation Year Trend ─────────────────
    // Joinings per year — from ALL employees regardless of current status
    // (since the current query filters ACTIVE + NOTICE_PERIOD, query again for full history)
    const allForTrend = await prisma.employee.findMany({
      select: { dateOfJoining: true },
    });
    const joiningYearMap = new Map<number, number>();
    for (const e of allForTrend) {
      if (!e.dateOfJoining) continue;
      const yr = new Date(e.dateOfJoining).getFullYear();
      joiningYearMap.set(yr, (joiningYearMap.get(yr) || 0) + 1);
    }

    // Resignations per year — from resignation requests that actually completed
    const resignations = await prisma.resignationRequest.findMany({
      where: { actualLastWorkingDay: { not: null } },
      select: { actualLastWorkingDay: true },
    });
    const resignationYearMap = new Map<number, number>();
    for (const r of resignations) {
      if (!r.actualLastWorkingDay) continue;
      const yr = new Date(r.actualLastWorkingDay).getFullYear();
      resignationYearMap.set(yr, (resignationYearMap.get(yr) || 0) + 1);
    }

    // Build a combined year range so both series align on the X axis
    const allYears = new Set<number>([
      ...joiningYearMap.keys(),
      ...resignationYearMap.keys(),
    ]);
    const joiningTrend = Array.from(allYears)
      .sort((a, b) => a - b)
      .map((year) => ({
        year,
        count: joiningYearMap.get(year) ?? 0,              // joinings (legacy field name kept)
        joinings: joiningYearMap.get(year) ?? 0,
        resignations: resignationYearMap.get(year) ?? 0,
        net: (joiningYearMap.get(year) ?? 0) - (resignationYearMap.get(year) ?? 0),
      }));

    // ── Dept Gender Breakdown ─────────────────────────────
    const deptGenderMap = new Map<string, { male: number; female: number; other: number }>();
    for (const e of employees) {
      const dept = e.Department?.name || "Unassigned";
      const cur = deptGenderMap.get(dept) || { male: 0, female: 0, other: 0 };
      if (e.gender === "MALE") cur.male++;
      else if (e.gender === "FEMALE") cur.female++;
      else cur.other++;
      deptGenderMap.set(dept, cur);
    }
    const deptGender = Array.from(deptGenderMap.entries())
      .map(([dept, v]) => ({ dept, ...v, total: v.male + v.female + v.other }))
      .sort((a, b) => b.total - a.total);

    res.json({ ageSplitChart, tenureBuckets, joiningTrend, deptGender, employeeList });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 17 — MOBILE LOGIN ACTIVITY
// GET /api/management/mobile-login-activity?days=14
// Detects mobile vs desktop from LoginHistory userAgent
// ═══════════════════════════════════════════════════════════
export const getMobileLoginActivity = async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 14, 90);

    const since = new Date();
    since.setDate(since.getDate() - days + 1);
    since.setHours(0, 0, 0, 0);

    const logs = await prisma.loginHistory.findMany({
      where: { attemptedAt: { gte: since }, success: true },
      select: { attemptedAt: true, userAgent: true, userId: true },
      orderBy: { attemptedAt: "asc" },
    });

    const isMobile = (ua: string | null): boolean => {
      if (!ua) return false;
      return /Mobile|Android|iPhone|iPad|Windows Phone|BlackBerry|webOS|Opera Mini/i.test(ua);
    };

    // Build a map for every day in the window
    const dayMap = new Map<string, { mobile: number; desktop: number; users: Set<number> }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
      dayMap.set(dateStr, { mobile: 0, desktop: 0, users: new Set() });
    }

    for (const log of logs) {
      const dateStr = log.attemptedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const entry = dayMap.get(dateStr);
      if (!entry) continue;
      if (isMobile(log.userAgent)) entry.mobile++;
      else entry.desktop++;
      entry.users.add(log.userId);
    }

    const daily = Array.from(dayMap.entries()).map(([date, v]) => ({
      date,
      label: new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
      mobile: v.mobile,
      desktop: v.desktop,
      total: v.mobile + v.desktop,
      uniqueUsers: v.users.size,
    }));

    const totalMobile  = daily.reduce((s, d) => s + d.mobile, 0);
    const totalDesktop = daily.reduce((s, d) => s + d.desktop, 0);
    const totalLogins  = totalMobile + totalDesktop;
    const uniqueActiveUsers = new Set(logs.map((l) => l.userId)).size;

    // Hourly distribution (IST hour 0–23)
    const hourly: { hour: number; mobile: number; desktop: number }[] = Array.from({ length: 24 }, (_, h) => ({
      hour: h, mobile: 0, desktop: 0,
    }));
    for (const log of logs) {
      const hr = new Date(log.attemptedAt.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();
      if (isMobile(log.userAgent)) hourly[hr].mobile++;
      else hourly[hr].desktop++;
    }

    res.json({
      daily,
      hourly,
      totalLogins,
      totalMobile,
      totalDesktop,
      mobilePct: totalLogins > 0 ? Math.round((totalMobile / totalLogins) * 100) : 0,
      uniqueActiveUsers,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 18 — QUALIFICATIONS ANALYTICS
// GET /api/management/qualifications
// ═══════════════════════════════════════════════════════════
export const getQualifications = async (_req: Request, res: Response) => {
  try {
    const [totalActive, qualifications] = await Promise.all([
      prisma.employee.count({ where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } } }),
      prisma.qualification.findMany({
        select: {
          degree: true,
          degreeName: true,
          institution: true,
          year: true,
          grade: true,
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              employmentStatus: true,
              Department: { select: { name: true } },
              designation: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    // Only consider active/notice-period employees
    const active = qualifications.filter(
      (q) => q.employee.employmentStatus === "ACTIVE" || q.employee.employmentStatus === "NOTICE_PERIOD"
    );

    // Academic hierarchy — higher rank = higher qualification.
    // We pick ONLY the highest degree per employee so someone with SSLC + PU + Bachelor
    // gets counted once under "Bachelor", not three times.
    const degreeRank = (raw: string): { rank: number; canonical: string } => {
      const u = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (/(PHD|DOCTORATE)/.test(u))                            return { rank: 6, canonical: "PhD" };
      if (/(MASTER|MTECH|MSC|MA|MCOM|MBA|MCA|ME|MED|POSTGRAD|PG)/.test(u))
                                                                 return { rank: 5, canonical: "Master" };
      if (/(BACHELOR|BTECH|BSC|BA|BCOM|BBA|BCA|BE|BED|UG|GRADUATE)/.test(u))
                                                                 return { rank: 4, canonical: "Bachelor" };
      if (/DIPLOMA/.test(u))                                    return { rank: 3, canonical: "Diploma" };
      if (/(PU|PUC|HSC|12)/.test(u))                             return { rank: 2, canonical: "PU" };
      if (/(SSLC|10)/.test(u))                                   return { rank: 1, canonical: "SSLC" };
      return { rank: 0, canonical: raw.trim() || "Other" };
    };

    // Reduce to one qualification per employee = the highest one
    const highestByEmp = new Map<number, {
      degree: string;
      rawDegree: string;
      institution: string | null;
      dept: string;
      designation: string;
      name: string;
      employeeCode: string;
      year: number | null;
      grade: string | null;
      rank: number;
    }>();
    for (const q of active) {
      const raw = (q.degreeName || q.degree || "Other").trim();
      const { rank, canonical } = degreeRank(raw);
      const cur = highestByEmp.get(q.employee.id);
      if (!cur || rank > cur.rank) {
        highestByEmp.set(q.employee.id, {
          degree: canonical,
          rawDegree: raw,
          institution: q.institution ?? null,
          dept: q.employee.Department?.name || "Unassigned",
          designation: q.employee.designation?.name || "—",
          name: `${q.employee.firstName ?? ""} ${q.employee.lastName ?? ""}`.trim(),
          employeeCode: q.employee.employeeCode,
          year: q.year ?? null,
          grade: q.grade ?? null,
          rank,
        });
      }
    }

    const coveredEmployeeIds = new Set(highestByEmp.keys());
    const coveragePct = totalActive > 0 ? Math.round((coveredEmployeeIds.size / totalActive) * 100) : 0;

    // Degree type distribution — based on highest per employee
    const degreeMap = new Map<string, number>();
    for (const { degree } of highestByEmp.values()) {
      degreeMap.set(degree, (degreeMap.get(degree) || 0) + 1);
    }
    const degreeDistribution = Array.from(degreeMap.entries())
      .map(([degree, count]) => ({ degree, count }))
      .sort((a, b) => b.count - a.count);

    // Top institutions — use only the HIGHEST qualification's institution per employee
    const instMap = new Map<string, number>();
    for (const { institution } of highestByEmp.values()) {
      if (!institution) continue;
      const key = institution.trim();
      instMap.set(key, (instMap.get(key) || 0) + 1);
    }
    const topInstitutions = Array.from(instMap.entries())
      .map(([institution, count]) => ({ institution, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Department-wise — most common highest-degree per dept
    const deptMap = new Map<string, { deptDegrees: Map<string, number>; total: number; empIds: Set<number> }>();
    for (const [empId, v] of highestByEmp.entries()) {
      if (!deptMap.has(v.dept)) deptMap.set(v.dept, { deptDegrees: new Map(), total: 0, empIds: new Set() });
      const entry = deptMap.get(v.dept)!;
      entry.deptDegrees.set(v.degree, (entry.deptDegrees.get(v.degree) || 0) + 1);
      entry.total++;
      entry.empIds.add(empId);
    }
    const deptBreakdown = Array.from(deptMap.entries())
      .map(([dept, v]) => {
        let topDegree = "";
        let topCount = 0;
        v.deptDegrees.forEach((cnt, deg) => { if (cnt > topCount) { topCount = cnt; topDegree = deg; } });
        return { dept, qualifiedCount: v.empIds.size, topDegree, totalQuals: v.total };
      })
      .sort((a, b) => b.qualifiedCount - a.qualifiedCount);

    // Graduation year trend (group by decade)
    const yearMap = new Map<string, number>();
    for (const q of active) {
      if (!q.year || q.year < 1960 || q.year > new Date().getFullYear()) continue;
      const decade = `${Math.floor(q.year / 10) * 10}s`;
      yearMap.set(decade, (yearMap.get(decade) || 0) + 1);
    }
    const graduationDecades = Array.from(yearMap.entries())
      .map(([decade, count]) => ({ decade, count }))
      .sort((a, b) => a.decade.localeCompare(b.decade));

    res.json({
      totalActive,
      withQualification: coveredEmployeeIds.size,
      coveragePct,
      degreeDistribution,
      topInstitutions,
      deptBreakdown,
      graduationDecades,
      // Per-employee highest qualification — powers drill-down popups
      employeeList: Array.from(highestByEmp.values()).map((v) => ({
        name: v.name,
        employeeCode: v.employeeCode,
        dept: v.dept,
        designation: v.designation,
        degree: v.degree,
        rawDegree: v.rawDegree,
        institution: v.institution,
        year: v.year,
        grade: v.grade,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
