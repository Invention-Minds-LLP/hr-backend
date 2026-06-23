import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { addDays, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, format } from "date-fns";
import { config } from "../../config";

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

    // ── Period comparisons (vs last month) ───────────────────────
    // Cheap parallel fetch — only the four metrics where MoM delta is
    // meaningful. Transient counts (pending leaves, OT pending) are
    // point-in-time so we don't bother with their deltas.
    const prevMonthStart = startOfMonth(subMonths(new Date(), 1));
    const prevMonthEnd   = endOfMonth(subMonths(new Date(), 1));

    const [
      prevHeadcount,            // active employees as of end of last month
      prevAttritionFullMonth,   // resignations during entire previous month
      prevTrainingTotal,        // assignments due in last month
      prevTrainingCompleted,
      prevAttendanceAvg,        // avg daily attendance % in last month
    ] = await Promise.all([
      // Active count at end of last month — anyone whose status was ACTIVE then
      // (good-enough proxy: employees joined before end-of-prev-month and not
      // exited before end-of-prev-month is harder to compute without an audit
      // log; we use current ACTIVE employees with dateOfJoining <= prevMonthEnd
      // as the closest reasonable approximation).
      prisma.employee.count({
        where: {
          employmentStatus: "ACTIVE",
          dateOfJoining: { lte: prevMonthEnd },
        },
      }),

      prisma.resignationRequest.count({
        where: {
          createdAt: { gte: prevMonthStart, lte: prevMonthEnd },
          status: { notIn: ["WITHDRAWN", "CANCELLED", "REJECTED"] },
        },
      }),

      prisma.trainingAssignment.count({
        where: { createdAt: { gte: prevMonthStart, lte: prevMonthEnd } },
      }),

      prisma.trainingAssignment.count({
        where: {
          status: "Completed",
          createdAt: { gte: prevMonthStart, lte: prevMonthEnd },
        },
      }),

      // Avg attendance % across last month — single SQL aggregate.
      // Counts PRESENT rows divided by total attendance rows.
      (async () => {
        const [presentCount, totalCount] = await Promise.all([
          prisma.attendance.count({
            where: {
              date: { gte: prevMonthStart, lte: prevMonthEnd },
              status: "PRESENT",
            },
          }),
          prisma.attendance.count({
            where: { date: { gte: prevMonthStart, lte: prevMonthEnd } },
          }),
        ]);
        return totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;
      })(),
    ]);

    const prevTrainingPct = prevTrainingTotal > 0
      ? Math.round((prevTrainingCompleted / prevTrainingTotal) * 100)
      : 0;

    // delta() returns null when prev=0 (avoids divide-by-zero / nonsense %).
    // Return the absolute diff so the UI can show "↑ 3" or "↑ 4.2%" cleanly.
    const delta = (curr: number, prev: number) =>
      prev === 0 ? null : Number(((curr - prev) * 100 / prev).toFixed(1));

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
      // Comparison block — null = no prior data, frontend hides delta chip.
      comparisons: {
        headcount: { prev: prevHeadcount,        deltaPct: delta(totalHeadcount, prevHeadcount) },
        attendancePct: {
          prev: prevAttendanceAvg,
          // attendance % is ALREADY a percentage, so use absolute-point delta
          // (e.g. "84% vs 87% = -3 points") — `deltaPct` carried percentage diff
          // would be misleading.
          deltaPoints: prevAttendanceAvg ? Number((attendancePct - prevAttendanceAvg).toFixed(1)) : null,
        },
        attritionMTD:          { prev: prevAttritionFullMonth, deltaPct: delta(resignationsThisMonth, prevAttritionFullMonth) },
        trainingCompletionPct: { prev: prevTrainingPct,        deltaPoints: prevTrainingPct ? Number((trainingPct - prevTrainingPct).toFixed(1)) : null },
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// ATTENTION NEEDED — auto-flagged items requiring management review
// GET /api/management/attention
//
// Runs threshold checks across attendance, attrition, OT, recruitment
// and training. Returns a sorted list of alerts ({ severity, title,
// message, sectionId }). The frontend renders them as red/yellow/blue
// chips at the top of the dashboard so management can see "what needs
// my attention today" at a glance, without scrolling 19 sections.
//
// Thresholds are env-overridable so HR/Ops can tune them per hospital
// without code changes. See ATTENTION_THRESHOLDS below.
// ═══════════════════════════════════════════════════════════

const ATTENTION_THRESHOLDS = {
  attendancePctRed:    config.attn.attendanceRed,     // <80% → red
  attendancePctYellow: config.attn.attendanceYellow,  // 80-89% → yellow
  pendingLeavesYellow: config.attn.pendingLeaves,
  pendingPermsYellow:  config.attn.pendingPerms,
  pipRed:              config.attn.pipRed,
  pipYellow:           config.attn.pipYellow,
  attritionMtdRed:     config.attn.attritionRed,
  attritionMtdYellow:  config.attn.attritionYellow,
  otPendingYellow:     config.attn.otPending,
  openJobsYellow:      config.attn.openJobs,
  trainingPctRed:      config.attn.trainingRed,
  trainingPctYellow:   config.attn.trainingYellow,
};

type AttentionItem = {
  severity: 'red' | 'yellow' | 'info';
  icon: string;
  title: string;
  message: string;
  sectionId?: string;   // anchor on the dashboard to scroll to
  metric?: number;
};

export const getAttention = async (_req: Request, res: Response) => {
  try {
    const todayStart = startOfDayIST();
    const todayEnd   = endOfDayIST();
    const monthStart = startOfMonth(new Date());
    const monthEnd   = endOfMonth(new Date());
    const T = ATTENTION_THRESHOLDS;

    const [
      headcount,
      presentToday,
      pendingLeaves,
      pendingPerms,
      activePIPs,
      attritionMTD,
      otPending,
      openJobs,
      trainTotal,
      trainCompleted,
      // Departments where today's attendance is unusually low (<70%) — surfaced
      // separately so management can spot a single struggling department, not
      // just an aggregate dip.
      lowDeptAttendance,
    ] = await Promise.all([
      prisma.employee.count({ where: { employmentStatus: "ACTIVE" } }),
      prisma.attendance.count({
        where: { date: { gte: todayStart, lte: todayEnd }, status: "PRESENT" },
      }),
      prisma.leaveRequest.count({ where: { status: "PENDING" } }),
      prisma.permissionRequest.count({ where: { status: "PENDING" } }),
      prisma.employeePIP.count({
        where: { status: { in: ["WARNING_ISSUED", "PIP_ACTIVE", "PIP_EXTENDED"] } },
      }),
      prisma.resignationRequest.count({
        where: {
          createdAt: { gte: monthStart, lte: monthEnd },
          status: { notIn: ["WITHDRAWN", "CANCELLED", "REJECTED"] },
        },
      }),
      prisma.overtimeApproval.count({
        where: { status: "PENDING", managerStatus: "APPROVED", minutes: { gt: 60 } } as any,
      }),
      prisma.job.count({ where: { status: "OPEN" } }),
      prisma.trainingAssignment.count(),
      prisma.trainingAssignment.count({ where: { status: "Completed" } }),
      // Per-department attendance today. Done with two simple Prisma calls
      // (groupBy + count) instead of a $queryRaw — keeps it portable across
      // Postgres / MySQL and side-steps the ::int cast that makes the raw
      // query DB-specific.
      (async (): Promise<any[]> => {
        try {
          const deptCounts = await prisma.employee.groupBy({
            by: ['departmentId'],
            where: { employmentStatus: 'ACTIVE' },
            _count: { _all: true },
          });
          const deptIds = deptCounts.map((c) => c.departmentId);
          const [depts, presentByDept] = await Promise.all([
            prisma.department.findMany({
              where: { id: { in: deptIds } },
              select: { id: true, name: true },
            }),
            prisma.attendance.findMany({
              where: {
                date:   { gte: todayStart, lte: todayEnd },
                status: 'PRESENT',
                employee: { employmentStatus: 'ACTIVE' },
              },
              select: { employee: { select: { departmentId: true } } },
            }),
          ]);
          const presentMap = new Map<number, number>();
          for (const a of presentByDept) {
            const did = a.employee?.departmentId;
            if (did != null) presentMap.set(did, (presentMap.get(did) ?? 0) + 1);
          }
          const nameMap = new Map(depts.map((d) => [d.id, d.name]));
          return deptCounts
            .map((c) => {
              const total   = c._count._all;
              const present = presentMap.get(c.departmentId) ?? 0;
              const pct = total ? Math.round((present * 100) / total) : 0;
              return {
                departmentId:   c.departmentId,
                departmentName: nameMap.get(c.departmentId) ?? `Dept ${c.departmentId}`,
                total, present, pct,
              };
            })
            .filter((r) => r.pct < 70 && r.total >= 5);
        } catch (e) {
          console.error('[getAttention] dept-attendance aggregation failed:', e);
          return [];
        }
      })(),
    ]);

    const attendancePct = headcount > 0 ? Math.round((presentToday / headcount) * 100) : 0;
    const trainingPct   = trainTotal > 0 ? Math.round((trainCompleted / trainTotal) * 100) : 0;

    const items: AttentionItem[] = [];

    // ── Attendance ─────────────────────────────────────────────
    if (attendancePct < T.attendancePctRed) {
      items.push({
        severity: 'red', icon: '⚠️', sectionId: 'sec-attendance',
        title: 'Critically low attendance today',
        message: `Only ${attendancePct}% present today (${presentToday}/${headcount}). Threshold ${T.attendancePctRed}%.`,
        metric: attendancePct,
      });
    } else if (attendancePct < T.attendancePctYellow) {
      items.push({
        severity: 'yellow', icon: '⏰', sectionId: 'sec-attendance',
        title: 'Attendance below target',
        message: `${attendancePct}% present today (${presentToday}/${headcount}).`,
        metric: attendancePct,
      });
    }

    // Department-specific dips
    for (const d of lowDeptAttendance) {
      items.push({
        severity: d.pct < 50 ? 'red' : 'yellow', icon: '🏥', sectionId: 'sec-dept-risk',
        title: `${d.departmentName}: low attendance today`,
        message: `${d.pct}% present in ${d.departmentName} (${d.present}/${d.total}).`,
        metric: d.pct,
      });
    }

    // ── PIP ────────────────────────────────────────────────────
    if (activePIPs >= T.pipRed) {
      items.push({
        severity: 'red', icon: '📉', sectionId: 'sec-pip',
        title: 'High number of active PIPs',
        message: `${activePIPs} performance improvement plans currently active.`,
        metric: activePIPs,
      });
    } else if (activePIPs >= T.pipYellow) {
      items.push({
        severity: 'yellow', icon: '📉', sectionId: 'sec-pip',
        title: 'Active PIPs require review',
        message: `${activePIPs} performance improvement plans active.`,
        metric: activePIPs,
      });
    }

    // ── Attrition this month ──────────────────────────────────
    if (attritionMTD >= T.attritionMtdRed) {
      items.push({
        severity: 'red', icon: '📤', sectionId: 'sec-attrition',
        title: 'Elevated attrition this month',
        message: `${attritionMTD} resignation(s) recorded so far this month.`,
        metric: attritionMTD,
      });
    } else if (attritionMTD >= T.attritionMtdYellow) {
      items.push({
        severity: 'yellow', icon: '📤', sectionId: 'sec-attrition',
        title: 'Attrition activity to watch',
        message: `${attritionMTD} resignation(s) this month.`,
        metric: attritionMTD,
      });
    }

    // ── Pending approvals ─────────────────────────────────────
    if (pendingLeaves >= T.pendingLeavesYellow) {
      items.push({
        severity: 'yellow', icon: '📋', sectionId: 'sec-attendance',
        title: 'Leave approvals piling up',
        message: `${pendingLeaves} leave request(s) awaiting decision.`,
        metric: pendingLeaves,
      });
    }
    if (pendingPerms >= T.pendingPermsYellow) {
      items.push({
        severity: 'yellow', icon: '🕒', sectionId: 'sec-attendance',
        title: 'Permission requests pending',
        message: `${pendingPerms} permission request(s) awaiting decision.`,
        metric: pendingPerms,
      });
    }
    if (otPending >= T.otPendingYellow) {
      items.push({
        severity: 'yellow', icon: '⏱️', sectionId: 'sec-ot',
        title: 'Overtime approvals pending',
        message: `${otPending} OT request(s) awaiting management approval.`,
        metric: otPending,
      });
    }

    // ── Recruitment ───────────────────────────────────────────
    // Frontend combines Attrition + Recruitment into one section, so the
    // alert links to that combined section.
    if (openJobs >= T.openJobsYellow) {
      items.push({
        severity: 'yellow', icon: '💼', sectionId: 'sec-attrition',
        title: 'Many open positions',
        message: `${openJobs} job position(s) currently open.`,
        metric: openJobs,
      });
    }

    // ── Training compliance ───────────────────────────────────
    if (trainTotal > 0 && trainingPct < T.trainingPctRed) {
      items.push({
        severity: 'red', icon: '🎓', sectionId: 'sec-training',
        title: 'Training completion lagging',
        message: `Only ${trainingPct}% of assigned training completed.`,
        metric: trainingPct,
      });
    } else if (trainTotal > 0 && trainingPct < T.trainingPctYellow) {
      items.push({
        severity: 'yellow', icon: '🎓', sectionId: 'sec-training',
        title: 'Training completion below target',
        message: `${trainingPct}% of assigned training completed.`,
        metric: trainingPct,
      });
    }

    // Sort: red first, then yellow, then info — within each group keep insertion order
    const sevRank = { red: 0, yellow: 1, info: 2 } as const;
    items.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

    res.json({
      generatedAt: new Date().toISOString(),
      counts: {
        red:    items.filter((i) => i.severity === 'red').length,
        yellow: items.filter((i) => i.severity === 'yellow').length,
        info:   items.filter((i) => i.severity === 'info').length,
      },
      items,
      thresholds: T,
    });
  } catch (err: any) {
    console.error('[getAttention] failed:', err);
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

      // Count statuses from the pre-fetched map.
      // MySQL string compare is case-insensitive, but JS === is not, so normalize.
      const dayMap = attByDay.get(dayStr) ?? new Map<number, string>();
      let present = 0, leave = 0, permission = 0;
      const attendedIds = new Set<number>();
      for (const [empId, st] of dayMap.entries()) {
        const s = (st || "").toUpperCase();
        if (s === "PRESENT")    { present++;    attendedIds.add(empId); }
        else if (s === "LEAVE") { leave++;      attendedIds.add(empId); }
        else if (s === "PERMISSION") { permission++; attendedIds.add(empId); }
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
// SECTION 5 — ATTRITION TREND (last 3 months)
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

    for (let i = 2; i >= 0; i--) {
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
        avgScore: v.scores.length > 0 ? Math.round((v.scores.reduce((s, x) => s + x, 0) / v.scores.length) * 10) / 10 : null,
        pips: v.pips,
      }))
      .sort((a, b) => b.headcount - a.headcount);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// DEPT-WISE ATTENDANCE (today) — present / leave / permission /
// absent / week-off per department, with a per-dept employee list
// for the click-through popup.
// GET /api/management/dept-attendance-today
// Mirrors the status + week-off logic of getAttendanceSummary.
// ═══════════════════════════════════════════════════════════
export const getDeptAttendanceToday = async (_req: Request, res: Response) => {
  try {
    const todayStart = startOfDayIST();
    const todayEnd = endOfDayIST();
    const today = new Date();
    const dayStr = format(today, "yyyy-MM-dd");

    const employees = await prisma.employee.findMany({
      where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true,
        Department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });

    const todayAttendance = await prisma.attendance.findMany({
      where: { date: { gte: todayStart, lte: todayEnd } },
      select: { employeeId: true, status: true, checkIn: true, checkOut: true },
    });
    const attnByEmp = new Map<number, { status: string; checkIn: Date | null; checkOut: Date | null }>();
    for (const a of todayAttendance) {
      attnByEmp.set(a.employeeId, { status: (a.status || "").toUpperCase(), checkIn: a.checkIn, checkOut: a.checkOut });
    }

    const holiday = await prisma.holiday.findFirst({
      where: { date: { gte: todayStart, lte: todayEnd } },
      select: { title: true },
    });
    const isHoliday = !!holiday;

    // Week-off employees today: approved shift config + Sunday fallback.
    const weekOffSet = new Set<number>();
    if (!isHoliday) {
      const year = today.getFullYear();
      const month = today.getMonth() + 1;
      const approvals = await prisma.shiftApproval.findMany({
        where: { status: "APPROVED", month, year },
        select: { employeeId: true, weekOffConfig: true },
      });
      const approvedEmps = new Set<number>();
      const monthStart = new Date(year, month - 1, 1);
      const firstWeekStart = new Date(monthStart);
      firstWeekStart.setDate(monthStart.getDate() - monthStart.getDay());
      firstWeekStart.setHours(0, 0, 0, 0);
      for (const ap of approvals) {
        approvedEmps.add(ap.employeeId);
        const cfg = ap.weekOffConfig as { weeks?: Record<string, number> } | null;
        if (!cfg?.weeks) continue;
        for (const [wkStr, dow] of Object.entries(cfg.weeks)) {
          const wk = Number(wkStr);
          if (Number.isNaN(wk) || typeof dow !== "number") continue;
          const wo = new Date(firstWeekStart);
          wo.setDate(firstWeekStart.getDate() + wk * 7 + dow);
          if (format(wo, "yyyy-MM-dd") === dayStr) weekOffSet.add(ap.employeeId);
        }
      }
      if (today.getDay() === 0) {
        for (const e of employees) if (!approvedEmps.has(e.id)) weekOffSet.add(e.id);
      }
    }

    type Emp = { name: string; employeeCode: string; designation: string; status: string; checkIn: string | null; checkOut: string | null };
    const deptMap = new Map<string, {
      dept: string; headcount: number;
      present: number; leave: number; permission: number; absent: number; weekoff: number;
      employees: Emp[];
    }>();

    for (const e of employees) {
      const dept = e.Department?.name || "Unassigned";
      if (!deptMap.has(dept)) {
        deptMap.set(dept, { dept, headcount: 0, present: 0, leave: 0, permission: 0, absent: 0, weekoff: 0, employees: [] });
      }
      const row = deptMap.get(dept)!;
      row.headcount++;

      const rec = attnByEmp.get(e.id);
      const st = rec?.status;
      let category: string;
      if (st === "PRESENT") { row.present++; category = "Present"; }
      else if (st === "LEAVE") { row.leave++; category = "Leave"; }
      else if (st === "PERMISSION") { row.permission++; category = "Permission"; }
      else if (isHoliday || weekOffSet.has(e.id)) { row.weekoff++; category = isHoliday ? "Holiday" : "Week Off"; }
      else { row.absent++; category = "Absent"; }

      row.employees.push({
        name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
        employeeCode: e.employeeCode ?? "",
        designation: e.designation?.name ?? "—",
        status: category,
        checkIn: rec?.checkIn ? format(rec.checkIn, "HH:mm") : null,
        checkOut: rec?.checkOut ? format(rec.checkOut, "HH:mm") : null,
      });
    }

    const depts = Array.from(deptMap.values()).sort((a, b) => b.headcount - a.headcount);
    const totals = depts.reduce(
      (t, d) => ({
        headcount: t.headcount + d.headcount,
        present: t.present + d.present,
        leave: t.leave + d.leave,
        permission: t.permission + d.permission,
        absent: t.absent + d.absent,
        weekoff: t.weekoff + d.weekoff,
      }),
      { headcount: 0, present: 0, leave: 0, permission: 0, absent: 0, weekoff: 0 },
    );

    res.json({ date: dayStr, isHoliday, holidayTitle: holiday?.title ?? null, totals, depts });
  } catch (err: any) {
    console.error("getDeptAttendanceToday error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// DEPT-WISE ATTENDANCE (week) — per-department weekly attendance
// with each employee's day-by-day status for drill-down.
// GET /api/management/dept-attendance-weekly?weekStartDate=YYYY-MM-DD&weekEndDate=YYYY-MM-DD
// Defaults to the current Mon–Sun week. Reuses the same
// approved-weekoff + Sunday-fallback + holiday logic as the daily view.
// ═══════════════════════════════════════════════════════════
export const getDeptAttendanceWeekly = async (req: Request, res: Response) => {
  try {
    const { weekStartDate, weekEndDate } = req.query;
    const baseStart = startOfDay(
      weekStartDate ? new Date(String(weekStartDate)) : startOfWeek(new Date(), { weekStartsOn: 1 }),
    );
    const baseEnd = startOfDay(
      weekEndDate ? new Date(String(weekEndDate)) : addDays(baseStart, 6),
    );

    // Build the inclusive list of days in range.
    const days: Date[] = [];
    for (let d = new Date(baseStart); d <= baseEnd; d = addDays(d, 1)) days.push(new Date(d));

    const rangeStart = startOfDayIST(baseStart);
    const rangeEnd = endOfDayIST(baseEnd);

    const employees = await prisma.employee.findMany({
      where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true,
        Department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });
    const allEmpIds = employees.map(e => e.id);

    // Attendance for the whole range, bucketed by employee + IST day string.
    const attendance = await prisma.attendance.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd } },
      select: { employeeId: true, status: true, date: true, checkIn: true, checkOut: true },
    });
    const attnByEmpDay = new Map<string, { status: string; checkIn: Date | null; checkOut: Date | null }>();
    for (const a of attendance) {
      attnByEmpDay.set(`${a.employeeId}|${format(a.date, "yyyy-MM-dd")}`, {
        status: (a.status || "").toUpperCase(), checkIn: a.checkIn, checkOut: a.checkOut,
      });
    }

    // Holidays in range, by day string.
    const holidays = await prisma.holiday.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd } },
      select: { date: true, title: true },
    });
    const holidayByDay = new Map<string, string>();
    for (const h of holidays) holidayByDay.set(format(h.date, "yyyy-MM-dd"), h.title);

    // Shift approvals for every (year, month) the range touches.
    const monthKeys = new Set<string>();
    for (const d of days) monthKeys.add(`${d.getFullYear()}-${d.getMonth() + 1}`);
    const approvalsByMonth = new Map<string, { employeeId: number; weekOffConfig: any }[]>();
    for (const key of monthKeys) {
      const [yr, mo] = key.split("-").map(Number);
      const aps = await prisma.shiftApproval.findMany({
        where: { status: "APPROVED", month: mo, year: yr },
        select: { employeeId: true, weekOffConfig: true },
      });
      approvalsByMonth.set(key, aps);
    }

    // Week-off employee set for a given day (approved config + Sunday fallback).
    const weekOffEmpsForDay = (day: Date): Set<number> => {
      const set = new Set<number>();
      const year = day.getFullYear();
      const month = day.getMonth() + 1;
      const dayStr = format(day, "yyyy-MM-dd");
      const approvals = approvalsByMonth.get(`${year}-${month}`) || [];
      const approvedEmps = new Set<number>();
      const monthStart = new Date(year, month - 1, 1);
      const firstWeekStart = new Date(monthStart);
      firstWeekStart.setDate(monthStart.getDate() - monthStart.getDay());
      firstWeekStart.setHours(0, 0, 0, 0);
      for (const ap of approvals) {
        approvedEmps.add(ap.employeeId);
        const cfg = ap.weekOffConfig as { weeks?: Record<string, number> } | null;
        if (!cfg?.weeks) continue;
        for (const [wkStr, dow] of Object.entries(cfg.weeks)) {
          const wk = Number(wkStr);
          if (Number.isNaN(wk) || typeof dow !== "number") continue;
          const wo = new Date(firstWeekStart);
          wo.setDate(firstWeekStart.getDate() + wk * 7 + dow);
          if (format(wo, "yyyy-MM-dd") === dayStr) set.add(ap.employeeId);
        }
      }
      if (day.getDay() === 0) {
        for (const id of allEmpIds) if (!approvedEmps.has(id)) set.add(id);
      }
      return set;
    };

    // Precompute per-day holiday flag + week-off sets.
    const dayMeta = days.map(day => {
      const dayStr = format(day, "yyyy-MM-dd");
      const holidayTitle = holidayByDay.get(dayStr) ?? null;
      return { day, dayStr, holidayTitle, isHoliday: !!holidayTitle, weekOff: holidayTitle ? new Set<number>() : weekOffEmpsForDay(day) };
    });

    type Emp = {
      name: string; employeeCode: string; designation: string;
      statuses: { date: string; status: string; checkIn: string | null; checkOut: string | null }[];
      presentDays: number;
    };
    const deptMap = new Map<string, {
      dept: string; headcount: number;
      present: number; leave: number; permission: number; absent: number; weekoff: number;
      employees: Emp[];
    }>();

    for (const e of employees) {
      const dept = e.Department?.name || "Unassigned";
      if (!deptMap.has(dept)) {
        deptMap.set(dept, { dept, headcount: 0, present: 0, leave: 0, permission: 0, absent: 0, weekoff: 0, employees: [] });
      }
      const row = deptMap.get(dept)!;
      row.headcount++;

      const empRow: Emp = {
        name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
        employeeCode: e.employeeCode ?? "",
        designation: e.designation?.name ?? "—",
        statuses: [],
        presentDays: 0,
      };

      for (const meta of dayMeta) {
        const rec = attnByEmpDay.get(`${e.id}|${meta.dayStr}`);
        const st = rec?.status;
        let category: string;
        if (st === "PRESENT") { row.present++; empRow.presentDays++; category = "Present"; }
        else if (st === "LEAVE") { row.leave++; category = "Leave"; }
        else if (st === "PERMISSION") { row.permission++; category = "Permission"; }
        else if (meta.isHoliday) { row.weekoff++; category = "Holiday"; }
        else if (meta.weekOff.has(e.id)) { row.weekoff++; category = "Week Off"; }
        else { row.absent++; category = "Absent"; }
        empRow.statuses.push({
          date: meta.dayStr,
          status: category,
          checkIn: rec?.checkIn ? format(rec.checkIn, "HH:mm") : null,
          checkOut: rec?.checkOut ? format(rec.checkOut, "HH:mm") : null,
        });
      }

      row.employees.push(empRow);
    }

    const depts = Array.from(deptMap.values())
      .map(d => {
        const workingSlots = d.present + d.leave + d.permission + d.absent;
        return { ...d, attendancePct: workingSlots > 0 ? Math.round((d.present / workingSlots) * 100) : 0 };
      })
      .sort((a, b) => b.headcount - a.headcount);

    const totals = depts.reduce(
      (t, d) => ({
        headcount: t.headcount + d.headcount,
        present: t.present + d.present,
        leave: t.leave + d.leave,
        permission: t.permission + d.permission,
        absent: t.absent + d.absent,
        weekoff: t.weekoff + d.weekoff,
      }),
      { headcount: 0, present: 0, leave: 0, permission: 0, absent: 0, weekoff: 0 },
    );
    const totalWorkingSlots = totals.present + totals.leave + totals.permission + totals.absent;
    const attendancePct = totalWorkingSlots > 0 ? Math.round((totals.present / totalWorkingSlots) * 100) : 0;

    res.json({
      weekStartDate: format(baseStart, "yyyy-MM-dd"),
      weekEndDate: format(baseEnd, "yyyy-MM-dd"),
      days: dayMeta.map(m => ({ date: m.dayStr, isHoliday: m.isHoliday, holidayTitle: m.holidayTitle })),
      totals: { ...totals, attendancePct },
      depts,
    });
  } catch (err: any) {
    console.error("getDeptAttendanceWeekly error:", err);
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
        finalDecision: true,
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

    // Score bands — overallScore is on a 0–10 scale (mean of 0–10 ratings).
    const bands = [
      { label: "Excellent (8–10)", min: 8, max: 10, color: "#22c55e" },
      { label: "Good (6–7.9)", min: 6, max: 7.9, color: "#60a5fa" },
      { label: "Average (4–5.9)", min: 4, max: 5.9, color: "#f59e0b" },
      { label: "Below Avg (<4)", min: 0, max: 3.9, color: "#ef4444" },
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
      finalDecision: a.finalDecision ?? "",
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
        avg: Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10,
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
// BATCH 1 — HR operational analytics (leave-by-type, leave-abuse,
// weekly-perf status, incidents, OT eligibility)
// ═══════════════════════════════════════════════════════════

// #3 Weekly approved-leave volume by leave type (last N weeks) + per-week
//    employee list for the click-through popup.
// GET /api/management/leave-by-type-weekly?weeks=8
export const getLeaveByTypeWeekly = async (req: Request, res: Response) => {
  try {
    const numWeeks = Math.min(Math.max(Number(req.query.weeks) || 8, 1), 26);
    const today = new Date();
    const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 });
    const rangeStart = addDays(thisWeekStart, -7 * (numWeeks - 1));
    const rangeEnd = endOfWeek(today, { weekStartsOn: 1 });

    const leaves = await prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { gte: rangeStart, lte: rangeEnd } },
      select: {
        startDate: true, endDate: true, isHalfDay: true,
        leaveType: { select: { name: true } },
        employee: {
          select: {
            firstName: true, lastName: true, employeeCode: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
      },
    });

    const weeks: { key: string; label: string; weekStart: string; byType: Record<string, number>; total: number; employees: any[] }[] = [];
    const weekIndex = new Map<string, number>();
    for (let i = 0; i < numWeeks; i++) {
      const ws = addDays(thisWeekStart, -7 * (numWeeks - 1 - i));
      const key = format(ws, "yyyy-MM-dd");
      weekIndex.set(key, i);
      weeks.push({ key, label: format(ws, "dd MMM"), weekStart: key, byType: {}, total: 0, employees: [] });
    }

    const typeSet = new Set<string>();
    for (const lv of leaves) {
      const key = format(startOfWeek(new Date(lv.startDate), { weekStartsOn: 1 }), "yyyy-MM-dd");
      const idx = weekIndex.get(key);
      if (idx === undefined) continue;
      const type = lv.leaveType?.name || "Other";
      typeSet.add(type);
      const days = lv.isHalfDay
        ? 0.5
        : Math.max(1, Math.round((new Date(lv.endDate).getTime() - new Date(lv.startDate).getTime()) / 86400000) + 1);
      const w = weeks[idx];
      w.byType[type] = (w.byType[type] || 0) + 1;
      w.total += 1;
      const sd = new Date(lv.startDate);
      const ed = new Date(lv.endDate);
      const sameDay = format(sd, "yyyy-MM-dd") === format(ed, "yyyy-MM-dd");
      const dates = lv.isHalfDay
        ? `${format(sd, "dd MMM yyyy")} (half-day)`
        : sameDay ? format(sd, "dd MMM yyyy") : `${format(sd, "dd MMM")} – ${format(ed, "dd MMM yyyy")}`;
      w.employees.push({
        name: `${lv.employee?.firstName ?? ""} ${lv.employee?.lastName ?? ""}`.trim(),
        employeeCode: lv.employee?.employeeCode ?? "",
        dept: lv.employee?.Department?.name ?? "—",
        designation: lv.employee?.designation?.name ?? "—",
        type, days, dates,
      });
    }

    res.json({ weeks, types: Array.from(typeSet).sort() });
  } catch (err: any) {
    console.error("getLeaveByTypeWeekly error:", err);
    res.status(500).json({ error: err.message });
  }
};

// #10 Employees taking >= threshold approved leave-days in a month
//     (productivity watch — default threshold 5 of ~25 working days).
// GET /api/management/leave-abuse?month=YYYY-MM&min=5
export const getLeaveAbuse = async (req: Request, res: Response) => {
  try {
    const monthParam = req.query.month as string | undefined;
    const base = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? new Date(`${monthParam}-01`) : new Date();
    const rangeStart = startOfMonth(base);
    const rangeEnd = endOfMonth(base);
    const threshold = Math.max(1, Number(req.query.min) || 5);

    const leaves = await prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: rangeEnd }, endDate: { gte: rangeStart } },
      select: {
        employeeId: true, startDate: true, endDate: true, isHalfDay: true,
        leaveType: { select: { name: true } },
        employee: {
          select: {
            firstName: true, lastName: true, employeeCode: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
      },
    });

    const map = new Map<number, { name: string; employeeCode: string; dept: string; designation: string; totalDays: number; requests: number; byType: Record<string, number> }>();
    for (const lv of leaves) {
      const s = new Date(Math.max(new Date(lv.startDate).getTime(), rangeStart.getTime()));
      const e = new Date(Math.min(new Date(lv.endDate).getTime(), rangeEnd.getTime()));
      let days = Math.max(0, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
      if (lv.isHalfDay) days = 0.5;
      if (days <= 0) continue;
      if (!map.has(lv.employeeId)) {
        map.set(lv.employeeId, {
          name: `${lv.employee?.firstName ?? ""} ${lv.employee?.lastName ?? ""}`.trim(),
          employeeCode: lv.employee?.employeeCode ?? "",
          dept: lv.employee?.Department?.name ?? "—",
          designation: lv.employee?.designation?.name ?? "—",
          totalDays: 0, requests: 0, byType: {},
        });
      }
      const row = map.get(lv.employeeId)!;
      row.totalDays += days;
      row.requests += 1;
      const t = lv.leaveType?.name || "Other";
      row.byType[t] = (row.byType[t] || 0) + days;
    }

    const flagged = Array.from(map.values())
      .filter((r) => r.totalDays >= threshold)
      .map((r) => ({
        ...r,
        totalDays: Math.round(r.totalDays * 10) / 10,
        types: Object.entries(r.byType).map(([k, v]) => `${k}: ${v}`).join(", "),
      }))
      .sort((a, b) => b.totalDays - a.totalDays);

    res.json({
      month: format(rangeStart, "yyyy-MM"),
      monthLabel: format(rangeStart, "MMMM yyyy"),
      threshold, workingDaysRef: 25, flagged,
    });
  } catch (err: any) {
    console.error("getLeaveAbuse error:", err);
    res.status(500).json({ error: err.message });
  }
};

// #12 Weekly performance: filled (SUBMITTED manager ratings) vs pending,
//     per week over the last N weeks.
// GET /api/management/weekly-perf-status?weeks=6
export const getWeeklyPerfStatus = async (req: Request, res: Response) => {
  try {
    const numWeeks = Math.min(Math.max(Number(req.query.weeks) || 6, 1), 16);
    const today = new Date();
    const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 });
    const rangeStart = addDays(thisWeekStart, -7 * (numWeeks - 1));

    const totalActive = await prisma.employee.count({ where: { employmentStatus: "ACTIVE" } });

    const ratings = await prisma.weeklyPerformanceRating.findMany({
      where: { weekStartDate: { gte: rangeStart }, raterType: "MANAGER" },
      select: { weekStartDate: true, status: true },
    });

    const weeks: { key: string; label: string; filled: number; pending: number; expected: number }[] = [];
    const idxOf = new Map<string, number>();
    for (let i = 0; i < numWeeks; i++) {
      const ws = addDays(thisWeekStart, -7 * (numWeeks - 1 - i));
      const key = format(ws, "yyyy-MM-dd");
      idxOf.set(key, i);
      weeks.push({ key, label: format(ws, "dd MMM"), filled: 0, pending: 0, expected: totalActive });
    }
    for (const r of ratings) {
      const key = format(startOfWeek(new Date(r.weekStartDate), { weekStartsOn: 1 }), "yyyy-MM-dd");
      const idx = idxOf.get(key);
      if (idx === undefined) continue;
      if ((r.status || "").toUpperCase() === "SUBMITTED") weeks[idx].filled += 1;
    }
    for (const w of weeks) w.pending = Math.max(0, w.expected - w.filled);

    res.json({ weeks, totalActive });
  } catch (err: any) {
    console.error("getWeeklyPerfStatus error:", err);
    res.status(500).json({ error: err.message });
  }
};

// #14 Incident analytics — monthly trend, severity split, dept breakdown
//     (with per-dept incident list for the popup) + outcome totals.
// GET /api/management/incidents-analytics?months=6
export const getIncidentsAnalytics = async (req: Request, res: Response) => {
  try {
    const numMonths = Math.min(Math.max(Number(req.query.months) || 6, 1), 24);
    const rangeStart = startOfMonth(subMonths(new Date(), numMonths - 1));
    const rangeEnd = endOfMonth(new Date());

    const incidents = await prisma.incident.findMany({
      where: { incidentDate: { gte: rangeStart, lte: rangeEnd } },
      select: {
        title: true, severity: true, status: true, outcome: true,
        incidentDate: true, departmentId: true,
        category: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true, Department: { select: { name: true } } } },
      },
      orderBy: { incidentDate: "desc" },
    });

    const depts = await prisma.department.findMany({ select: { id: true, name: true } });
    const deptName = new Map(depts.map((d) => [d.id, d.name]));

    const monthIdx = new Map<string, number>();
    const byMonth: { key: string; label: string; count: number; incidents: any[] }[] = [];
    for (let i = 0; i < numMonths; i++) {
      const m = startOfMonth(subMonths(new Date(), numMonths - 1 - i));
      const key = format(m, "yyyy-MM");
      monthIdx.set(key, i);
      byMonth.push({ key, label: format(m, "MMM yy"), count: 0, incidents: [] });
    }

    const sevMap: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    const deptMap = new Map<string, { dept: string; count: number; substantiated: number; incidents: any[] }>();
    let open = 0, closed = 0, substantiated = 0, falseReport = 0;

    for (const inc of incidents) {
      const view = {
        title: inc.title,
        severity: inc.severity,
        status: inc.status,
        outcome: inc.outcome || "—",
        date: format(new Date(inc.incidentDate), "dd MMM yyyy"),
        employee: inc.employee ? `${inc.employee.firstName} ${inc.employee.lastName}` : "—",
        category: inc.category?.name || "—",
      };

      const mi = monthIdx.get(format(new Date(inc.incidentDate), "yyyy-MM"));
      if (mi !== undefined) { byMonth[mi].count += 1; byMonth[mi].incidents.push(view); }

      sevMap[inc.severity] = (sevMap[inc.severity] || 0) + 1;
      if (["OPEN", "ACKNOWLEDGED", "INVESTIGATING", "ESCALATED"].includes(inc.status)) open += 1;
      if (["RESOLVED", "CLOSED"].includes(inc.status)) closed += 1;
      if (inc.outcome === "SUBSTANTIATED") substantiated += 1;
      if (inc.outcome === "FALSE_REPORT") falseReport += 1;

      const dept = (inc.departmentId ? deptName.get(inc.departmentId) : null) || inc.employee?.Department?.name || "Unassigned";
      if (!deptMap.has(dept)) deptMap.set(dept, { dept, count: 0, substantiated: 0, incidents: [] });
      const dRow = deptMap.get(dept)!;
      dRow.count += 1;
      if (inc.outcome === "SUBSTANTIATED") dRow.substantiated += 1;
      dRow.incidents.push(view);
    }

    res.json({
      months: numMonths,
      totals: { total: incidents.length, open, closed, substantiated, falseReport },
      byMonth,
      bySeverity: Object.entries(sevMap).map(([severity, count]) => ({ severity, count })),
      byDept: Array.from(deptMap.values()).sort((a, b) => b.count - a.count),
    });
  } catch (err: any) {
    console.error("getIncidentsAnalytics error:", err);
    res.status(500).json({ error: err.message });
  }
};

// #17 OT eligibility breaches — policy: max 2 OT days/week, <= 120 min each.
//     Flags employee-weeks exceeding either, grouped by department.
// GET /api/management/ot-eligibility?month=YYYY-MM
export const getOtEligibility = async (req: Request, res: Response) => {
  try {
    const monthParam = req.query.month as string | undefined;
    const base = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? new Date(`${monthParam}-01`) : new Date();
    const rangeStart = startOfMonth(base);
    const rangeEnd = endOfMonth(base);
    const MAX_DAYS_PER_WEEK = 2;
    const MAX_MINUTES_PER_DAY = 120;

    const ot = await prisma.overtimeApproval.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd }, status: "APPROVE", managerStatus: "APPROVED" },
      select: { employeeId: true, date: true, minutes: true },
    });

    const empIds = Array.from(new Set(ot.map((o) => o.employeeId)));
    const employees = await prisma.employee.findMany({
      where: { id: { in: empIds } },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } }, designation: { select: { name: true } } },
    });
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const perEmpWeek = new Map<string, { employeeId: number; weekKey: string; days: number; totalMinutes: number; maxDay: number }>();
    for (const o of ot) {
      const weekKey = format(startOfWeek(new Date(o.date), { weekStartsOn: 1 }), "yyyy-MM-dd");
      const k = `${o.employeeId}_${weekKey}`;
      if (!perEmpWeek.has(k)) perEmpWeek.set(k, { employeeId: o.employeeId, weekKey, days: 0, totalMinutes: 0, maxDay: 0 });
      const r = perEmpWeek.get(k)!;
      r.days += 1;
      r.totalMinutes += o.minutes;
      r.maxDay = Math.max(r.maxDay, o.minutes);
    }

    const breaches: any[] = [];
    const deptMap = new Map<string, { dept: string; breachCount: number; emps: Set<number> }>();
    for (const r of perEmpWeek.values()) {
      const tooMany = r.days > MAX_DAYS_PER_WEEK;
      const tooLong = r.maxDay > MAX_MINUTES_PER_DAY;
      if (!tooMany && !tooLong) continue;
      const emp = empMap.get(r.employeeId);
      const dept = emp?.Department?.name || "—";
      const reason = [
        tooMany ? `${r.days} OT days (> ${MAX_DAYS_PER_WEEK}/wk)` : null,
        tooLong ? `${Math.round(r.maxDay)} min in a day (> ${MAX_MINUTES_PER_DAY})` : null,
      ].filter(Boolean).join(" · ");
      breaches.push({
        name: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
        employeeCode: emp?.employeeCode ?? "",
        dept, designation: emp?.designation?.name ?? "—",
        week: format(new Date(r.weekKey), "dd MMM"),
        otDays: r.days,
        totalMinutes: r.totalMinutes,
        totalHours: +(r.totalMinutes / 60).toFixed(1),
        maxDayMinutes: r.maxDay,
        reason,
      });
      if (!deptMap.has(dept)) deptMap.set(dept, { dept, breachCount: 0, emps: new Set() });
      const d = deptMap.get(dept)!;
      d.breachCount += 1;
      d.emps.add(r.employeeId);
    }

    res.json({
      month: format(rangeStart, "yyyy-MM"),
      monthLabel: format(rangeStart, "MMMM yyyy"),
      policy: `Eligible OT: max ${MAX_DAYS_PER_WEEK} days/week, ≤ ${MAX_MINUTES_PER_DAY} min each`,
      deptBreaches: Array.from(deptMap.values())
        .map((d) => ({ dept: d.dept, breachCount: d.breachCount, employees: d.emps.size }))
        .sort((a, b) => b.breachCount - a.breachCount),
      breaches: breaches.sort((a, b) => a.dept.localeCompare(b.dept) || b.totalMinutes - a.totalMinutes),
    });
  } catch (err: any) {
    console.error("getOtEligibility error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ── Shared shift resolver (mirrors dashboard.controller by-shift logic) ──
// Sets a base date's clock to a shift-template time (local hours/minutes).
function combineDateAndTime(baseDate: Date, timeTemplate: Date): Date {
  const dt = new Date(baseDate);
  const t = new Date(timeTemplate);
  dt.setHours(t.getHours(), t.getMinutes(), 0, 0);
  return dt;
}
// Resolve each employee's shift per day: ShiftAssignment(date) → fixed shift.
async function buildShiftResolver(rangeStart: Date, rangeEnd: Date) {
  const [templates, assignments, settings] = await Promise.all([
    prisma.shiftTemplate.findMany({ select: { id: true, startTime: true, endTime: true } }),
    prisma.shiftAssignment.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd } },
      select: { employeeId: true, date: true, shiftId: true },
    }),
    prisma.employeeShiftSetting.findMany({
      where: { mode: "FIXED", fixedShiftId: { not: null } },
      select: { employeeId: true, fixedShiftId: true },
    }),
  ]);
  const shiftMeta = new Map(templates.map((t) => [t.id, t]));
  const assignMap = new Map<string, number>();
  for (const a of assignments) assignMap.set(`${a.employeeId}_${format(new Date(a.date), "yyyy-MM-dd")}`, a.shiftId);
  const fixedMap = new Map<number, number>();
  for (const s of settings) if (s.fixedShiftId) fixedMap.set(s.employeeId, s.fixedShiftId);

  // Returns { startTime, endTime } template for the employee on that day, or null.
  return (employeeId: number, day: Date): { startTime: Date; endTime: Date } | null => {
    const sid = assignMap.get(`${employeeId}_${format(day, "yyyy-MM-dd")}`) ?? fixedMap.get(employeeId) ?? null;
    if (!sid) return null;
    const m = shiftMeta.get(sid);
    return m ? { startTime: m.startTime, endTime: m.endTime } : null;
  };
}

// #9 Punctuality watch — chronic lateness + early-leaving over last N weeks,
//    scored per employee. (Late > 15 min; left before shift end.)
// GET /api/management/punctuality?weeks=4
export const getPunctuality = async (req: Request, res: Response) => {
  try {
    const numWeeks = Math.min(Math.max(Number(req.query.weeks) || 4, 1), 12);
    const rangeStart = startOfDayIST(addDays(new Date(), -(numWeeks * 7 - 1)));
    const rangeEnd = endOfDayIST(new Date());

    const att = await prisma.attendance.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd }, status: "PRESENT", checkIn: { not: null } },
      select: {
        employeeId: true, date: true, checkIn: true, checkOut: true,
        employee: {
          select: {
            firstName: true, lastName: true, employeeCode: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
      },
    });

    const resolve = await buildShiftResolver(rangeStart, rangeEnd);

    type Row = { name: string; employeeCode: string; dept: string; designation: string; daysPresent: number; lateCount: number; lateMin: number; earlyCount: number; earlyMin: number };
    const map = new Map<number, Row>();
    for (const a of att) {
      if (!map.has(a.employeeId)) {
        map.set(a.employeeId, {
          name: `${a.employee?.firstName ?? ""} ${a.employee?.lastName ?? ""}`.trim(),
          employeeCode: a.employee?.employeeCode ?? "",
          dept: a.employee?.Department?.name ?? "—",
          designation: a.employee?.designation?.name ?? "—",
          daysPresent: 0, lateCount: 0, lateMin: 0, earlyCount: 0, earlyMin: 0,
        });
      }
      const row = map.get(a.employeeId)!;
      row.daysPresent++;
      const meta = resolve(a.employeeId, new Date(a.date));
      if (!meta || !a.checkIn) continue;
      const shiftStart = combineDateAndTime(new Date(a.date), meta.startTime);
      let shiftEnd = combineDateAndTime(new Date(a.date), meta.endTime);
      if (shiftEnd.getTime() <= shiftStart.getTime()) shiftEnd = addDays(shiftEnd, 1); // overnight
      const lateMin = Math.round((new Date(a.checkIn).getTime() - shiftStart.getTime()) / 60000);
      if (lateMin > 15) { row.lateCount++; row.lateMin += lateMin; }
      if (a.checkOut) {
        const earlyMin = Math.round((shiftEnd.getTime() - new Date(a.checkOut).getTime()) / 60000);
        if (earlyMin > 0) { row.earlyCount++; row.earlyMin += earlyMin; }
      }
    }

    const rows = Array.from(map.values())
      .filter((r) => r.lateCount > 0 || r.earlyCount > 0)
      .map((r) => {
        const score = Math.max(0, Math.round(100 - r.lateCount * 5 - r.earlyCount * 4));
        return {
          name: r.name, employeeCode: r.employeeCode, dept: r.dept, designation: r.designation,
          daysPresent: r.daysPresent,
          lateCount: r.lateCount, avgLateMin: r.lateCount ? Math.round(r.lateMin / r.lateCount) : 0,
          earlyCount: r.earlyCount, avgEarlyMin: r.earlyCount ? Math.round(r.earlyMin / r.earlyCount) : 0,
          score,
          rating: score >= 80 ? "Good" : score >= 60 ? "Watch" : "Poor",
        };
      })
      .sort((a, b) => a.score - b.score);

    res.json({ weeks: numWeeks, rangeStart: format(rangeStart, "dd MMM"), rangeEnd: format(rangeEnd, "dd MMM"), rows });
  } catch (err: any) {
    console.error("getPunctuality error:", err);
    res.status(500).json({ error: err.message });
  }
};

// #11 Scheduled vs actual worked hours for the current week, per employee.
//     Compares, on days present, shift duration vs (checkOut − checkIn).
// GET /api/management/worked-hours?week=YYYY-MM-DD (week start; default current)
export const getWorkedHours = async (req: Request, res: Response) => {
  try {
    const weekParam = req.query.week as string | undefined;
    const anchor = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? new Date(weekParam) : new Date();
    const weekStart = startOfDayIST(startOfWeek(anchor, { weekStartsOn: 1 }));
    const rawEnd = endOfWeek(anchor, { weekStartsOn: 1 });
    const weekEnd = endOfDayIST(rawEnd.getTime() > Date.now() ? new Date() : rawEnd);

    const att = await prisma.attendance.findMany({
      where: { date: { gte: weekStart, lte: weekEnd }, status: "PRESENT", checkIn: { not: null }, checkOut: { not: null } },
      select: {
        employeeId: true, date: true, checkIn: true, checkOut: true,
        employee: {
          select: {
            firstName: true, lastName: true, employeeCode: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
      },
    });

    const resolve = await buildShiftResolver(weekStart, weekEnd);

    type Row = { name: string; employeeCode: string; dept: string; designation: string; days: number; scheduledMin: number; actualMin: number };
    const map = new Map<number, Row>();
    for (const a of att) {
      const meta = resolve(a.employeeId, new Date(a.date));
      if (!meta || !a.checkIn || !a.checkOut) continue; // need a shift to compare against
      const shiftStart = combineDateAndTime(new Date(a.date), meta.startTime);
      let shiftEnd = combineDateAndTime(new Date(a.date), meta.endTime);
      if (shiftEnd.getTime() <= shiftStart.getTime()) shiftEnd = addDays(shiftEnd, 1);
      const schedMin = Math.round((shiftEnd.getTime() - shiftStart.getTime()) / 60000);
      const actMin = Math.round((new Date(a.checkOut).getTime() - new Date(a.checkIn).getTime()) / 60000);
      if (actMin <= 0) continue;
      if (!map.has(a.employeeId)) {
        map.set(a.employeeId, {
          name: `${a.employee?.firstName ?? ""} ${a.employee?.lastName ?? ""}`.trim(),
          employeeCode: a.employee?.employeeCode ?? "",
          dept: a.employee?.Department?.name ?? "—",
          designation: a.employee?.designation?.name ?? "—",
          days: 0, scheduledMin: 0, actualMin: 0,
        });
      }
      const row = map.get(a.employeeId)!;
      row.days++;
      row.scheduledMin += schedMin;
      row.actualMin += actMin;
    }

    const rows = Array.from(map.values())
      .map((r) => {
        const scheduledHrs = +(r.scheduledMin / 60).toFixed(1);
        const actualHrs = +(r.actualMin / 60).toFixed(1);
        return {
          name: r.name, employeeCode: r.employeeCode, dept: r.dept, designation: r.designation,
          days: r.days, scheduledHrs, actualHrs,
          diffHrs: +(actualHrs - scheduledHrs).toFixed(1),
          matchPct: r.scheduledMin ? Math.round((r.actualMin / r.scheduledMin) * 100) : 0,
        };
      })
      .sort((a, b) => a.matchPct - b.matchPct);

    res.json({
      weekLabel: `${format(weekStart, "dd MMM")} – ${format(weekEnd, "dd MMM")}`,
      coverageNote: "Days present with a resolvable shift and both punches.",
      rows,
    });
  } catch (err: any) {
    console.error("getWorkedHours error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// BATCH 2 — Recruitment ops (#6 vacancies/applications, #7 today's
// interviews/offers/joinees, #8 designation funnel).
// GET /api/management/recruitment-ops
// ═══════════════════════════════════════════════════════════
export const getRecruitmentOps = async (_req: Request, res: Response) => {
  try {
    const todayStart = startOfDayIST();
    const todayEnd = endOfDayIST();
    const funnelSince = subMonths(new Date(), 3);

    const [interviewsToday, offersToday, joinedToday, openJobs, applications] = await Promise.all([
      // #7 — today's recruitment activity
      prisma.interview.count({ where: { startTime: { gte: todayStart, lte: todayEnd } } }),
      prisma.offer.count({ where: { sentAt: { gte: todayStart, lte: todayEnd }, status: { in: ["SENT", "VIEWED", "SIGNED"] } } }),
      prisma.offer.count({ where: { proposedJoinAt: { gte: todayStart, lte: todayEnd }, joinOutcome: "JOINED" } }),
      // #6 — open vacancies with application counts
      prisma.job.findMany({
        where: { status: "OPEN" },
        select: {
          title: true, headcount: true, status: true,
          department: { select: { name: true } },
          _count: { select: { applications: true } },
        },
      }),
      // #8 — designation (job-title) funnel over the last 3 months
      prisma.application.findMany({
        where: { createdAt: { gte: funnelSince } },
        select: {
          status: true,
          job: { select: { title: true, department: { select: { name: true } } } },
          offer: { select: { joinOutcome: true } },
        },
      }),
    ]);

    const vacancies = openJobs
      .map((j) => ({
        title: j.title,
        dept: j.department?.name ?? "—",
        headcount: j.headcount,
        applications: j._count.applications,
        status: j.status,
      }))
      .sort((a, b) => b.applications - a.applications);

    const funnelMap = new Map<string, { designation: string; dept: string; applied: number; selected: number; joined: number }>();
    for (const a of applications) {
      const key = a.job?.title ?? "Unknown";
      if (!funnelMap.has(key)) {
        funnelMap.set(key, { designation: key, dept: a.job?.department?.name ?? "—", applied: 0, selected: 0, joined: 0 });
      }
      const row = funnelMap.get(key)!;
      row.applied++;
      if (["OFFERED", "OFFER_ACCEPTED", "HIRED"].includes(a.status)) row.selected++;
      if (a.status === "HIRED" || a.offer?.joinOutcome === "JOINED") row.joined++;
    }
    const byDesignation = Array.from(funnelMap.values()).sort((a, b) => b.applied - a.applied);

    res.json({
      today: { interviewsScheduled: interviewsToday, offersIssued: offersToday, joinees: joinedToday },
      vacancies,
      byDesignation,
    });
  } catch (err: any) {
    console.error("getRecruitmentOps error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// BATCH 3 — Capacity planning (#18 OT budget vs actual, #19 min
// daily strength vs present). Budget/min-strength live on the
// Department master (otBudgetHoursPerMonth, minDailyStrength).
// Read/written via raw SQL so this works regardless of whether the
// Prisma client has been regenerated for the new columns yet.
// GET  /api/management/dept-planning?month=YYYY-MM
// PUT  /api/management/dept-planning   { deptId, otBudgetHoursPerMonth, minDailyStrength }
// ═══════════════════════════════════════════════════════════
export const getDeptPlanning = async (req: Request, res: Response) => {
  try {
    const monthParam = req.query.month as string | undefined;
    const base = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? new Date(`${monthParam}-01`) : new Date();
    const rangeStart = startOfMonth(base);
    const rangeEnd = endOfMonth(base);
    const todayStart = startOfDayIST();
    const todayEnd = endOfDayIST();

    // Department masters (typed — new columns are in the regenerated client)
    const deptMasters = await prisma.department.findMany({
      select: {
        id: true, name: true, otBudgetHoursPerMonth: true, minDailyStrength: true,
        appraisalCycleBasis: true, appraisalPeriodMonths: true, appraisalCalendarMonth: true,
      },
      orderBy: { name: "asc" },
    });

    // Active headcount per department
    const activeEmps = await prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: { id: true, departmentId: true },
    });
    const headcountByDept = new Map<number, number>();
    const empDept = new Map<number, number>();
    for (const e of activeEmps) {
      if (e.departmentId == null) continue;
      empDept.set(e.id, e.departmentId);
      headcountByDept.set(e.departmentId, (headcountByDept.get(e.departmentId) || 0) + 1);
    }

    // Present today per department
    const presentToday = await prisma.attendance.findMany({
      where: { date: { gte: todayStart, lte: todayEnd }, status: "PRESENT" },
      select: { employeeId: true },
    });
    const presentByDept = new Map<number, number>();
    for (const a of presentToday) {
      const d = empDept.get(a.employeeId);
      if (d == null) continue;
      presentByDept.set(d, (presentByDept.get(d) || 0) + 1);
    }

    // Approved OT minutes this month per department
    const otRows = await prisma.overtimeApproval.groupBy({
      by: ["employeeId"],
      where: { date: { gte: rangeStart, lte: rangeEnd }, status: "APPROVE", managerStatus: "APPROVED" },
      _sum: { minutes: true },
    });
    const otMinByDept = new Map<number, number>();
    for (const r of otRows) {
      const d = empDept.get(r.employeeId);
      if (d == null) continue;
      otMinByDept.set(d, (otMinByDept.get(d) || 0) + (r._sum.minutes || 0));
    }

    const rows = deptMasters.map((d) => {
      const otBudgetHours = Number(d.otBudgetHoursPerMonth || 0);
      const otActualHours = +(((otMinByDept.get(d.id) || 0) / 60)).toFixed(1);
      const minDailyStrength = Number(d.minDailyStrength || 0);
      const headcount = headcountByDept.get(d.id) || 0;
      const present = presentByDept.get(d.id) || 0;
      return {
        deptId: d.id,
        dept: d.name,
        otBudgetHours,
        otActualHours,
        otPctUsed: otBudgetHours > 0 ? Math.round((otActualHours / otBudgetHours) * 100) : null,
        otOver: otBudgetHours > 0 && otActualHours > otBudgetHours,
        minDailyStrength,
        headcount,
        presentToday: present,
        strengthShortfall: minDailyStrength > 0 ? Math.max(0, minDailyStrength - present) : 0,
        belowMin: minDailyStrength > 0 && present < minDailyStrength,
        appraisalCycleBasis: d.appraisalCycleBasis || "DOJ",
        appraisalPeriodMonths: d.appraisalPeriodMonths || 12,
        appraisalCalendarMonth: d.appraisalCalendarMonth ?? null,
      };
    });

    res.json({ month: format(rangeStart, "yyyy-MM"), monthLabel: format(rangeStart, "MMMM yyyy"), rows });
  } catch (err: any) {
    console.error("getDeptPlanning error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const setDeptPlanning = async (req: Request, res: Response) => {
  try {
    const deptId = Number(req.body?.deptId);
    const ot = Math.max(0, Number(req.body?.otBudgetHoursPerMonth) || 0);
    const min = Math.max(0, Number(req.body?.minDailyStrength) || 0);
    if (!deptId) return res.status(400).json({ error: "deptId is required" });

    const basis = req.body?.appraisalCycleBasis === "CALENDAR" ? "CALENDAR" : "DOJ";
    const period = [6, 12].includes(Number(req.body?.appraisalPeriodMonths)) ? Number(req.body.appraisalPeriodMonths) : 12;
    const calMonth = req.body?.appraisalCalendarMonth
      ? Math.min(12, Math.max(1, Number(req.body.appraisalCalendarMonth)))
      : null;

    await prisma.department.update({
      where: { id: deptId },
      data: {
        otBudgetHoursPerMonth: ot, minDailyStrength: min,
        appraisalCycleBasis: basis, appraisalPeriodMonths: period, appraisalCalendarMonth: calMonth,
      },
    });

    res.json({ ok: true, deptId });
  } catch (err: any) {
    console.error("setDeptPlanning error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// #16 Appraisal scores — latest overall score per employee, dept
// averages, and score-band distribution (with per-band employee list).
// GET /api/management/appraisal-scores
// ═══════════════════════════════════════════════════════════
// Appraisal overallScore is stored on a 0–10 scale (mean of per-question
// ratings, each 0–10), so bands are expressed out of 10.
function scoreBand(s: number): { label: string; color: string } {
  if (s >= 8) return { label: "Excellent (8–10)", color: "#22c55e" };
  if (s >= 6) return { label: "Good (6–7.9)", color: "#60a5fa" };
  if (s >= 4) return { label: "Average (4–5.9)", color: "#f59e0b" };
  return { label: "Below (0–3.9)", color: "#ef4444" };
}
export const getAppraisalScores = async (_req: Request, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true,
        Department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });

    const forms = await prisma.appraisalForm.findMany({
      where: { overallScore: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { employeeId: true, overallScore: true, cycle: true, createdAt: true, finalDecision: true },
    });
    const latest = new Map<number, { score: number; cycle: string; date: Date; decision: string | null }>();
    for (const f of forms) {
      if (!latest.has(f.employeeId)) {
        latest.set(f.employeeId, { score: f.overallScore!, cycle: f.cycle, date: f.createdAt, decision: f.finalDecision });
      }
    }

    const bandOrder = ["Excellent (8–10)", "Good (6–7.9)", "Average (4–5.9)", "Below (0–3.9)"];
    const bandMap = new Map<string, { label: string; color: string; count: number; employees: any[] }>();
    const deptScores = new Map<string, number[]>();
    let appraised = 0;

    for (const e of employees) {
      const dept = e.Department?.name || "Unassigned";
      const rec = latest.get(e.id);
      if (!rec) continue;
      appraised++;
      const band = scoreBand(rec.score);
      if (!bandMap.has(band.label)) bandMap.set(band.label, { label: band.label, color: band.color, count: 0, employees: [] });
      const b = bandMap.get(band.label)!;
      b.count++;
      b.employees.push({
        name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
        employeeCode: e.employeeCode ?? "",
        dept, designation: e.designation?.name ?? "—",
        score: Math.round(rec.score * 10) / 10, cycle: rec.cycle,
        appraisedOn: format(new Date(rec.date), "dd MMM yyyy"),
        finalDecision: rec.decision ?? "",
      });
      if (!deptScores.has(dept)) deptScores.set(dept, []);
      deptScores.get(dept)!.push(rec.score);
    }

    const bands = bandOrder
      .map((label) => bandMap.get(label))
      .filter((b): b is NonNullable<typeof b> => !!b);
    const deptAvg = Array.from(deptScores.entries())
      .map(([dept, arr]) => ({ dept, avg: Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10, count: arr.length }))
      .sort((a, b) => b.avg - a.avg);

    res.json({
      totalActive: employees.length,
      appraised,
      notAppraised: employees.length - appraised,
      completionPct: employees.length ? Math.round((appraised / employees.length) * 100) : 0,
      bands, deptAvg,
    });
  } catch (err: any) {
    console.error("getAppraisalScores error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// #13/#21 Employee reliability score (last N months, default 6 =
// half-year) from attendance, leave discipline, weekly performance
// and incidents. Each factor is shown so HR can tune the weights.
// Eligibility (#21) = score >= cutoff (default 60).
// Weights: Attendance 40 · Leave 20 · Weekly perf 25 · Incidents 15
//          (convicted/substantiated incident = heavy negative).
// GET /api/management/reliability-scores?months=6
// ═══════════════════════════════════════════════════════════
export const getReliabilityScores = async (req: Request, res: Response) => {
  try {
    const numMonths = Math.min(Math.max(Number(req.query.months) || 6, 1), 12);
    const cutoff = 60;
    const rangeStart = startOfMonth(subMonths(new Date(), numMonths - 1));
    const rangeEnd = endOfMonth(new Date());

    const employees = await prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true,
        Department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });

    // Attendance present/absent per employee
    const attGroups = await prisma.attendance.groupBy({
      by: ["employeeId", "status"],
      where: { date: { gte: rangeStart, lte: rangeEnd } },
      _count: { _all: true },
    });
    const present = new Map<number, number>();
    const absent = new Map<number, number>();
    for (const g of attGroups) {
      const s = (g.status || "").toUpperCase();
      if (s === "PRESENT") present.set(g.employeeId, (present.get(g.employeeId) || 0) + g._count._all);
      else if (s === "ABSENT") absent.set(g.employeeId, (absent.get(g.employeeId) || 0) + g._count._all);
    }

    // Approved leave days per employee (clipped to range)
    const leaves = await prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: rangeEnd }, endDate: { gte: rangeStart } },
      select: { employeeId: true, startDate: true, endDate: true, isHalfDay: true },
    });
    const leaveDays = new Map<number, number>();
    for (const lv of leaves) {
      const s = new Date(Math.max(new Date(lv.startDate).getTime(), rangeStart.getTime()));
      const e = new Date(Math.min(new Date(lv.endDate).getTime(), rangeEnd.getTime()));
      let d = Math.max(0, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
      if (lv.isHalfDay) d = 0.5;
      if (d > 0) leaveDays.set(lv.employeeId, (leaveDays.get(lv.employeeId) || 0) + d);
    }

    // Weekly performance average per employee
    const weekly = await prisma.weeklyPerformanceRating.findMany({
      where: { weekStartDate: { gte: rangeStart }, status: "SUBMITTED", overallScore: { not: null } },
      select: { employeeId: true, overallScore: true },
    });
    const weeklyAgg = new Map<number, { sum: number; n: number }>();
    for (const w of weekly) {
      const a = weeklyAgg.get(w.employeeId) || { sum: 0, n: 0 };
      a.sum += w.overallScore!; a.n++;
      weeklyAgg.set(w.employeeId, a);
    }

    // Incidents per employee (substantiated = convicted)
    const incidents = await prisma.incident.findMany({
      where: { incidentDate: { gte: rangeStart, lte: rangeEnd }, employeeId: { not: null } },
      select: { employeeId: true, outcome: true },
    });
    const incAgg = new Map<number, { total: number; substantiated: number }>();
    for (const i of incidents) {
      const id = i.employeeId!;
      const a = incAgg.get(id) || { total: 0, substantiated: 0 };
      a.total++;
      if (i.outcome === "SUBSTANTIATED") a.substantiated++;
      incAgg.set(id, a);
    }

    const leaveThreshold = numMonths * 2; // ~2 leave-days/month before full penalty
    const rows = employees.map((e) => {
      const p = present.get(e.id) || 0;
      const ab = absent.get(e.id) || 0;
      const attDenom = p + ab;
      const attRatio = attDenom > 0 ? p / attDenom : 0.85; // no data → assume mostly fine
      const attendanceScore = +(40 * attRatio).toFixed(1);

      const lv = leaveDays.get(e.id) || 0;
      const leaveScore = +(20 * (1 - Math.min(1, lv / leaveThreshold))).toFixed(1);

      const wa = weeklyAgg.get(e.id);
      const weeklyAvg = wa ? Math.round(wa.sum / wa.n) : null;
      const weeklyScore = +(25 * (weeklyAvg != null ? weeklyAvg / 100 : 0.6)).toFixed(1); // neutral 60% if no data

      const inc = incAgg.get(e.id) || { total: 0, substantiated: 0 };
      const incidentScore = +(15 - (inc.total - inc.substantiated) * 3 - inc.substantiated * 8).toFixed(1);

      const score = Math.max(0, Math.min(100, Math.round(attendanceScore + leaveScore + weeklyScore + incidentScore)));
      return {
        name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
        employeeCode: e.employeeCode ?? "",
        dept: e.Department?.name || "Unassigned",
        designation: e.designation?.name ?? "—",
        presentDays: p, absentDays: ab, leaveDays: Math.round(lv * 10) / 10,
        weeklyAvg, incidents: inc.total, convicted: inc.substantiated,
        attendanceScore, leaveScore, weeklyScore, incidentScore,
        score,
        rating: score >= 80 ? "Good" : score >= cutoff ? "Watch" : "Risk",
        eligible: score >= cutoff,
      };
    }).sort((a, b) => a.score - b.score);

    const ready = rows.filter((r) => r.eligible).length;
    res.json({
      months: numMonths,
      cutoff,
      weights: { attendance: 40, leave: 20, weekly: 25, incidents: 15 },
      summary: { total: rows.length, ready, notReady: rows.length - ready },
      rows,
    });
  } catch (err: any) {
    console.error("getReliabilityScores error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// #15 PIP monitor — richer read-only view: status breakdown +
// per-PIP detail (weekly-review trend, response status, days-in-
// stage, extensions, nearing-termination). Actions live in /admin/pip.
// GET /api/management/pip-monitor
// ═══════════════════════════════════════════════════════════
export const getPipMonitor = async (_req: Request, res: Response) => {
  try {
    const pips = await prisma.employeePIP.findMany({
      include: {
        employee: {
          select: {
            firstName: true, lastName: true, employeeCode: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
        weeklyReviews: { orderBy: { weekNumber: "asc" }, select: { weekNumber: true, weeklyScore: true, status: true } },
        responses: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const statusOrder = ["WARNING_ISSUED", "PIP_ACTIVE", "PIP_EXTENDED", "TERMINATION_INITIATED", "PIP_CLOSED_IMPROVED", "TERMINATED"];
    const statusCounts: Record<string, number> = {};
    for (const p of pips) statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;

    const ACTIVE = ["WARNING_ISSUED", "PIP_ACTIVE", "PIP_EXTENDED", "TERMINATION_INITIATED"];
    const now = Date.now();
    const list = pips
      .filter((p) => ACTIVE.includes(p.status))
      .map((p) => {
        const reviews = p.weeklyReviews;
        const first = reviews[0]?.weeklyScore ?? null;
        const last = reviews[reviews.length - 1]?.weeklyScore ?? null;
        const trend = reviews.length >= 2 && first != null && last != null
          ? (last > first ? "improving" : last < first ? "declining" : "stable")
          : "neutral";
        const stageStart = p.pipStartDate ?? p.warningDate ?? p.createdAt;
        const daysInStage = Math.floor((now - new Date(stageStart).getTime()) / 86400000);
        return {
          pipNumber: p.pipNumber,
          employeeName: `${p.employee.firstName} ${p.employee.lastName}`,
          employeeCode: p.employee.employeeCode,
          dept: p.employee.Department?.name || "—",
          designation: p.employee.designation?.name || "—",
          status: p.status,
          triggerScore: p.triggerScore,
          triggerMonth: p.triggerMonth,
          extendedCount: p.extendedCount,
          daysInStage,
          reviewsDone: reviews.length,
          latestScore: last,
          weeklyScores: reviews.map((r) => ({ week: r.weekNumber, score: r.weeklyScore })),
          trend,
          responded: p.responses.length > 0,
          responses: p.responses.length,
          pipEndDate: p.pipEndDate ? format(new Date(p.pipEndDate), "dd MMM yyyy") : null,
          responseDeadline: p.responseDeadline ? format(new Date(p.responseDeadline), "dd MMM yyyy") : null,
          nearingTermination: p.status === "TERMINATION_INITIATED" || p.status === "PIP_EXTENDED",
        };
      });

    res.json({
      statusBreakdown: statusOrder.filter((s) => statusCounts[s]).map((s) => ({ status: s, count: statusCounts[s] })),
      active: list.length,
      closedImproved: statusCounts["PIP_CLOSED_IMPROVED"] || 0,
      list,
    });
  } catch (err: any) {
    console.error("getPipMonitor error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// #23 OT-vs-hire — per department, value this month's approved OT
// against the cost of one marginal junior hire. When OT ≈ a full
// FTE-month, flag "consider hiring". Uses current SalaryStructure
// (no revision history needed). Salary-gated on the client.
// GET /api/management/ot-vs-hire?month=YYYY-MM
// ═══════════════════════════════════════════════════════════
export const getOtVsHire = async (req: Request, res: Response) => {
  try {
    const monthParam = req.query.month as string | undefined;
    const base = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? new Date(`${monthParam}-01`) : new Date();
    const rangeStart = startOfMonth(base);
    const rangeEnd = endOfMonth(base);
    const WORK_DAYS = 26;
    const WORK_HRS_PER_DAY = 8;

    // Current monthly gross per active employee, by department
    const structures = await prisma.salaryStructure.findMany({
      select: {
        employeeId: true, basic: true, hra: true, medicalAllowance: true,
        travelAllowance: true, specialAllowance: true, otherAllowances: true,
        employee: { select: { employmentStatus: true, departmentId: true, Department: { select: { name: true } } } },
      },
    });
    const monthlyGross = (s: any) => (s.basic + s.hra + s.medicalAllowance + s.travelAllowance + s.specialAllowance + s.otherAllowances);

    const deptSalaries = new Map<string, number[]>();
    const empMonthly = new Map<number, number>();
    for (const s of structures) {
      if (s.employee?.employmentStatus !== "ACTIVE") continue;
      const dept = s.employee?.Department?.name || "Unassigned";
      const g = monthlyGross(s);
      empMonthly.set(s.employeeId, g);
      if (!deptSalaries.has(dept)) deptSalaries.set(dept, []);
      deptSalaries.get(dept)!.push(g);
    }

    // Approved OT minutes this month, per employee → per dept
    const otRows = await prisma.overtimeApproval.groupBy({
      by: ["employeeId"],
      where: { date: { gte: rangeStart, lte: rangeEnd }, status: "APPROVE", managerStatus: "APPROVED" },
      _sum: { minutes: true },
    });
    const otEmps = await prisma.employee.findMany({
      where: { id: { in: otRows.map((r) => r.employeeId) } },
      select: { id: true, Department: { select: { name: true } } },
    });
    const empDept = new Map(otEmps.map((e) => [e.id, e.Department?.name || "Unassigned"]));
    const otMinByDept = new Map<string, number>();
    for (const r of otRows) {
      const dept = empDept.get(r.employeeId) || "Unassigned";
      otMinByDept.set(dept, (otMinByDept.get(dept) || 0) + (r._sum.minutes || 0));
    }

    // Junior daily cost per dept = avg monthly gross of the lower-paid half / WORK_DAYS
    const rows = Array.from(otMinByDept.entries()).map(([dept, otMin]) => {
      const sals = (deptSalaries.get(dept) || []).slice().sort((a, b) => a - b);
      const lowerHalf = sals.length ? sals.slice(0, Math.max(1, Math.ceil(sals.length / 2))) : [];
      const juniorMonthly = lowerHalf.length ? Math.round(lowerHalf.reduce((s, x) => s + x, 0) / lowerHalf.length) : 0;
      const juniorDailyCost = juniorMonthly / WORK_DAYS;
      const otHours = +(otMin / 60).toFixed(1);
      const otEquivalentDays = +(otHours / WORK_HRS_PER_DAY).toFixed(1);
      const otCost = Math.round(otEquivalentDays * juniorDailyCost);
      const equivalentHires = juniorMonthly > 0 ? +(otCost / juniorMonthly).toFixed(2) : 0;
      return {
        dept,
        otHours,
        otEquivalentDays,
        juniorAvgMonthly: juniorMonthly,
        otCost,
        equivalentHires,
        recommendHire: equivalentHires >= 0.8, // OT ≈ a (near) full junior FTE-month
      };
    }).sort((a, b) => b.equivalentHires - a.equivalentHires);

    res.json({
      month: format(rangeStart, "yyyy-MM"),
      monthLabel: format(rangeStart, "MMMM yyyy"),
      assumptions: `Junior cost = avg of lower-paid half per dept; ${WORK_DAYS} working days × ${WORK_HRS_PER_DAY}h. Flag when OT ≥ 0.8 FTE-month.`,
      rows,
    });
  } catch (err: any) {
    console.error("getOtVsHire error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// #22 Salary increments — average increment % per department (from
// SalaryRevision history) with per-employee drill-down. Salary-gated.
// GET /api/management/salary-increments?months=12
// ═══════════════════════════════════════════════════════════
export const getSalaryIncrements = async (req: Request, res: Response) => {
  try {
    const numMonths = Math.min(Math.max(Number(req.query.months) || 12, 1), 36);
    const since = startOfMonth(subMonths(new Date(), numMonths - 1));

    const revisions = await prisma.salaryRevision.findMany({
      where: { effectiveFrom: { gte: since } },
      orderBy: { effectiveFrom: "desc" },
      select: {
        employeeId: true, previousCtc: true, newCtc: true, percentage: true, effectiveFrom: true,
        employee: {
          select: {
            firstName: true, lastName: true, employeeCode: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
      },
    });

    // Latest revision per employee within the window
    const latest = new Map<number, typeof revisions[number]>();
    for (const r of revisions) if (!latest.has(r.employeeId)) latest.set(r.employeeId, r);

    const deptMap = new Map<string, { dept: string; pcts: number[]; employees: any[] }>();
    for (const r of latest.values()) {
      const dept = r.employee?.Department?.name || "Unassigned";
      if (!deptMap.has(dept)) deptMap.set(dept, { dept, pcts: [], employees: [] });
      const d = deptMap.get(dept)!;
      d.pcts.push(r.percentage);
      d.employees.push({
        name: `${r.employee?.firstName ?? ""} ${r.employee?.lastName ?? ""}`.trim(),
        employeeCode: r.employee?.employeeCode ?? "",
        designation: r.employee?.designation?.name ?? "—",
        previousCtc: Math.round(r.previousCtc),
        newCtc: Math.round(r.newCtc),
        percentage: r.percentage,
        effectiveFrom: format(new Date(r.effectiveFrom), "dd MMM yyyy"),
      });
    }

    const deptAvg = Array.from(deptMap.values())
      .map((d) => ({
        dept: d.dept,
        avgIncrementPct: +(d.pcts.reduce((s, x) => s + x, 0) / d.pcts.length).toFixed(1),
        count: d.pcts.length,
        employees: d.employees.sort((a, b) => b.percentage - a.percentage),
      }))
      .sort((a, b) => b.avgIncrementPct - a.avgIncrementPct);

    res.json({
      months: numMonths,
      totalRevisions: revisions.length,
      employeesRevised: latest.size,
      deptAvg,
    });
  } catch (err: any) {
    console.error("getSalaryIncrements error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// #20 Appraisal eligibility — who is due for appraisal in the
// selected month, per each department's configured cycle
// (DOJ-anniversary or fixed calendar month, period 6/12).
// GET /api/management/appraisal-eligibility?month=YYYY-MM
// ═══════════════════════════════════════════════════════════
export const getAppraisalEligibility = async (req: Request, res: Response) => {
  try {
    const monthParam = req.query.month as string | undefined;
    const base = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? new Date(`${monthParam}-01`) : new Date();
    const selYear = base.getFullYear();
    const selMonth = base.getMonth() + 1; // 1-12

    const depts = await prisma.department.findMany({
      select: { id: true, name: true, appraisalCycleBasis: true, appraisalPeriodMonths: true, appraisalCalendarMonth: true },
    });
    const deptCfg = new Map(depts.map((d) => [d.id, d]));

    const employees = await prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true, dateOfJoining: true,
        departmentId: true, Department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });

    const forms = await prisma.appraisalForm.findMany({
      orderBy: { createdAt: "desc" },
      select: { employeeId: true, createdAt: true },
    });
    const lastAppraisal = new Map<number, Date>();
    for (const f of forms) if (!lastAppraisal.has(f.employeeId)) lastAppraisal.set(f.employeeId, f.createdAt);

    const due: any[] = [];
    for (const e of employees) {
      const cfg = e.departmentId ? deptCfg.get(e.departmentId) : undefined;
      const basis = cfg?.appraisalCycleBasis || "DOJ";
      const period = cfg?.appraisalPeriodMonths || 12;
      const calMonth = cfg?.appraisalCalendarMonth ?? null;
      const doj = new Date(e.dateOfJoining);
      const monthsSince = (selYear - doj.getFullYear()) * 12 + (selMonth - 1 - doj.getMonth());

      let isDue = false;
      let milestone = "";
      if (basis === "CALENDAR") {
        // Half-yearly calendar cycle runs in TWO months: the anchor and anchor+6.
        const second = calMonth ? ((calMonth - 1 + 6) % 12) + 1 : null;
        const matches = calMonth === selMonth || (period === 6 && second === selMonth);
        if (calMonth && matches && monthsSince >= period) {
          isDue = true; milestone = `Calendar (${period}mo)`;
        }
      } else {
        if (monthsSince > 0 && monthsSince % period === 0) {
          isDue = true; milestone = `${monthsSince}-month`;
        }
      }
      if (!isDue) continue;
      const last = lastAppraisal.get(e.id);
      due.push({
        name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
        employeeCode: e.employeeCode ?? "",
        dept: e.Department?.name || "Unassigned",
        designation: e.designation?.name ?? "—",
        doj: format(doj, "dd MMM yyyy"),
        tenureMonths: monthsSince,
        basis, milestone,
        lastAppraisal: last ? format(new Date(last), "dd MMM yyyy") : "Never",
      });
    }
    due.sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name));

    res.json({
      month: format(base, "yyyy-MM"),
      monthLabel: format(base, "MMMM yyyy"),
      totalActive: employees.length,
      dueCount: due.length,
      due,
      deptConfig: depts.map((d) => ({
        dept: d.name,
        basis: d.appraisalCycleBasis || "DOJ",
        period: d.appraisalPeriodMonths || 12,
        calendarMonth: d.appraisalCalendarMonth ?? null,
      })),
    });
  } catch (err: any) {
    console.error("getAppraisalEligibility error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// Probation overview — status breakdown (IN_PROGRESS / CONFIRMED /
// EXTENDED / TERMINATED / WAIVED) for the graph, plus a list of
// employees currently on (or extended) probation with end dates.
// GET /api/management/probation-overview
// ═══════════════════════════════════════════════════════════
export const getProbationOverview = async (_req: Request, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] }, probationStatus: { not: null } },
      select: {
        firstName: true, lastName: true, employeeCode: true,
        probationStatus: true, probationStartDate: true, probationEndDate: true,
        probationRemarks: true,
        Department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });

    const statusOrder = ["IN_PROGRESS", "EXTENDED", "CONFIRMED", "TERMINATED", "WAIVED"];
    const statusColor: Record<string, string> = {
      IN_PROGRESS: "#60a5fa", EXTENDED: "#f59e0b", CONFIRMED: "#22c55e", TERMINATED: "#ef4444", WAIVED: "#94a3b8",
    };
    const counts: Record<string, number> = {};
    for (const e of employees) if (e.probationStatus) counts[e.probationStatus] = (counts[e.probationStatus] || 0) + 1;

    const now = Date.now();
    const list = employees
      .filter((e) => e.probationStatus === "IN_PROGRESS" || e.probationStatus === "EXTENDED")
      .map((e) => {
        const end = e.probationEndDate ? new Date(e.probationEndDate) : null;
        const daysToEnd = end ? Math.round((end.getTime() - now) / 86400000) : null;
        return {
          name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
          employeeCode: e.employeeCode ?? "",
          dept: e.Department?.name || "—",
          designation: e.designation?.name ?? "—",
          status: e.probationStatus,
          startDate: e.probationStartDate ? format(new Date(e.probationStartDate), "dd MMM yyyy") : "—",
          endDate: end ? format(end, "dd MMM yyyy") : "—",
          daysToEnd,
          overdue: daysToEnd != null && daysToEnd < 0,
          remarks: e.probationRemarks ?? null,
        };
      })
      .sort((a, b) => (a.daysToEnd ?? 1e9) - (b.daysToEnd ?? 1e9));

    res.json({
      statusBreakdown: statusOrder.filter((s) => counts[s]).map((s) => ({ status: s, count: counts[s], color: statusColor[s] })),
      inProgress: counts["IN_PROGRESS"] || 0,
      extended: counts["EXTENDED"] || 0,
      total: employees.length,
      list,
    });
  } catch (err: any) {
    console.error("getProbationOverview error:", err);
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 19 — EL ENCASHMENT & BALANCE INSIGHTS
// GET /api/management/el-insights
// KPI tiles + balance distribution + top offenders for management oversight
// ═══════════════════════════════════════════════════════════════════════════════
export const getElInsights = async (_req: Request, res: Response) => {
  try {
    // Current financial year
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

    const el = await prisma.leaveType.findFirst({ where: { name: "EL" } });
    if (!el) return res.status(404).json({ error: "EL leave type not found" });

    const policy = await prisma.leavePolicy.findFirst({
      where: { leaveTypeId: el.id, isActive: true },
      orderBy: { createdAt: "desc" },
    });
    const policyMaxBalance     = policy?.maxBalance ?? 60;
    const policyMaxCarryForward = policy?.maxCarryForward ?? 45;

    // Thresholds used by the insights section.
    // Real encashment eligibility IS the policy max (60 days).
    // The 55-day "approaching" list is a proactive heads-up — these people are
    // close to the hard policy limit, so management can plan pay-out in advance.
    const THRESHOLD_ELIGIBLE    = policyMaxBalance; // 60 — actual encashment eligibility (policy)
    const THRESHOLD_APPROACHING = 55;               // 55 — approaching eligibility heads-up
    const THRESHOLD_WATCHLIST   = 50;               // 50 — broader watchlist

    // Pull all current-year EL balances + employee info
    const balances = await prisma.employeeLeaveBalance.findMany({
      where: { leaveTypeId: el.id, year: fyStartYear },
    });
    const empIds = balances.map(b => b.employeeId);
    const employees = await prisma.employee.findMany({
      where: { id: { in: empIds }, employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } },
      select: {
        id: true, employeeCode: true, firstName: true, lastName: true,
        Department:  { select: { name: true } },
        designation: { select: { name: true } },
      },
    });
    const empMap = new Map(employees.map(e => [e.id, e]));

    // Last leave taken per employee (to spot leave-hoarders)
    const lastLeaves = await prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: empIds },
        leaveTypeId: el.id,
        status: "APPROVED",
      },
      select: { employeeId: true, endDate: true },
      orderBy: { endDate: "desc" },
    });
    const lastLeaveMap = new Map<number, Date>();
    for (const l of lastLeaves) {
      if (!lastLeaveMap.has(l.employeeId)) {
        lastLeaveMap.set(l.employeeId, l.endDate);
      }
    }

    // Build rows
    const rows: any[] = [];
    for (const bal of balances) {
      const emp = empMap.get(bal.employeeId);
      if (!emp) continue; // skip non-active employees
      const balance = Math.max(0, bal.totalAllowed - bal.used);
      // Days past the APPROACHING threshold (55) — the heads-up buffer
      const daysOver55 = Math.max(0, balance - THRESHOLD_APPROACHING);
      // Days past the actual ELIGIBLE threshold (60, policy max) — real liability
      const daysOver60 = Math.max(0, balance - THRESHOLD_ELIGIBLE);
      const lastLeaveDate = lastLeaveMap.get(bal.employeeId) ?? null;
      rows.push({
        employeeId: bal.employeeId,
        employeeCode: emp.employeeCode,
        employeeName: `${emp.firstName} ${emp.lastName}`,
        dept: emp.Department?.name ?? "—",
        designation: emp.designation?.name ?? "—",
        totalAllowed: bal.totalAllowed,
        used: bal.used,
        balance,
        daysOver55,
        daysOver60,
        lastLeaveDate: lastLeaveDate ? lastLeaveDate.toISOString().slice(0, 10) : null,
      });
    }

    // ── Summary KPIs ────────────────────────────────────────
    // Eligible NOW = balance ≥ policy max (60). These people CAN be encashed today.
    const countEligible    = rows.filter(r => r.balance >= THRESHOLD_ELIGIBLE).length;
    // Approaching = above 55 but not yet eligible. Heads-up for planning.
    const countApproaching = rows.filter(r => r.balance > THRESHOLD_APPROACHING).length;
    // Wider watchlist
    const countWatch       = rows.filter(r => r.balance > THRESHOLD_WATCHLIST).length;
    // Actual encashment liability in days — only balances over policy max count
    const totalEligibleDays = rows.reduce((s, r) => s + r.daysOver60, 0);
    // Days already over the 55 heads-up threshold (includes eligible + approaching)
    const totalDaysOver55   = rows.reduce((s, r) => s + r.daysOver55, 0);

    // ── Distribution buckets ────────────────────────────────
    const buckets = [
      { label: "0–30 days",    key: "b1", min: 0,   max: 30,  count: 0 },
      { label: "30–45 days",   key: "b2", min: 30,  max: 45,  count: 0 },
      { label: "45–55 days",   key: "b3", min: 45,  max: 55,  count: 0 },
      { label: "55–60 days",   key: "b4", min: 55,  max: 60,  count: 0 },
      { label: "60+ days",     key: "b5", min: 60,  max: Infinity, count: 0 },
    ];
    for (const r of rows) {
      const b = buckets.find(b => r.balance >= b.min && r.balance < b.max);
      if (b) b.count++;
    }

    // Tag each row with its bucket for drill-down filtering
    const rowsWithBucket = rows.map(r => {
      const b = buckets.find(b => r.balance >= b.min && r.balance < b.max);
      return { ...r, bucket: b?.label ?? "Unknown" };
    });

    // ── Top offenders (highest balance) ─────────────────────
    const topOffenders = [...rowsWithBucket]
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 10);

    // ── Department-wise average balance (bonus for Option C flavor) ─────
    const deptMap = new Map<string, { total: number; count: number; overThreshold: number }>();
    for (const r of rowsWithBucket) {
      const cur = deptMap.get(r.dept) ?? { total: 0, count: 0, overThreshold: 0 };
      cur.total += r.balance;
      cur.count++;
      if (r.balance > THRESHOLD_ELIGIBLE) cur.overThreshold++;
      deptMap.set(r.dept, cur);
    }
    const deptAvg = Array.from(deptMap.entries())
      .map(([dept, v]) => ({
        dept,
        headcount: v.count,
        avgBalance: Math.round(v.total / v.count),
        overThreshold: v.overThreshold,
      }))
      .sort((a, b) => b.avgBalance - a.avgBalance);

    return res.json({
      year: fyStartYear,
      policyMaxBalance,
      policyMaxCarryForward,
      thresholds: {
        eligible: THRESHOLD_ELIGIBLE,        // 60 — actual encashment eligibility
        approaching: THRESHOLD_APPROACHING,  // 55 — heads-up threshold
        watchlist: THRESHOLD_WATCHLIST,      // 50 — broader watch
      },
      summary: {
        totalEmployees: rows.length,
        countEligible,        // balance >= 60, actually eligible now
        countApproaching,     // balance > 55, heads-up (includes eligible)
        countWatch,           // balance > 50, broader watchlist
        totalEligibleDays,    // days over 60 — real encashment liability
        totalDaysOver55,      // days over 55 — includes approaching window
      },
      distribution: buckets,
      topOffenders,
      deptAvg,
      employeeList: rowsWithBucket,
    });
  } catch (err: any) {
    console.error("getElInsights error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 19 — TRAINING INSIGHTS (Calendar + Performance + Feedback)
// GET /api/management/training-insights
// ═══════════════════════════════════════════════════════════════════════════════
export const getTrainingInsights = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const yearStart  = new Date(now.getFullYear(), 0, 1);

    // ── KPI tiles ────────────────────────────────────────────
    const [
      trainingsThisMonth,
      assignmentsAll,
      completedAssignments,
      attempts,
      pendingAssignedTests,
    ] = await Promise.all([
      prisma.training.count({
        where: {
          OR: [
            { startDate: { gte: monthStart, lte: monthEnd } },
            { endDate:   { gte: monthStart, lte: monthEnd } },
            { AND: [{ startDate: { lte: monthStart } }, { endDate: { gte: monthEnd } }] },
          ],
        },
      }),
      prisma.trainingAssignment.count({}),
      prisma.trainingAssignment.count({ where: { status: "Completed" } }),
      prisma.evaluationAttempt.findMany({
        where: { status: "Completed", createdAt: { gte: yearStart } },
        select: { score: true, employeeId: true, testId: true, createdAt: true },
      }),
      prisma.assignedTest.count({ where: { status: { not: "Completed" } } }),
    ]);

    const avgCompletionPct = assignmentsAll > 0
      ? Math.round((completedAssignments / assignmentsAll) * 100)
      : 0;
    const avgTestScore = attempts.length > 0
      ? Math.round(attempts.reduce((s, a) => s + (a.score ?? 0), 0) / attempts.length)
      : 0;

    // ── Department Participation (improved) ──────────────────
    const allAssignments = await prisma.trainingAssignment.findMany({
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true,
            Department:  { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
        training: { select: { id: true, title: true } },
      },
    });

    const deptMap = new Map<string, { total: number; completed: number; trainings: Set<number> }>();
    for (const a of allAssignments) {
      const dept = a.employee?.Department?.name || "Unassigned";
      const cur = deptMap.get(dept) || { total: 0, completed: 0, trainings: new Set() };
      cur.total++;
      if (a.status === "Completed") cur.completed++;
      if (a.training?.id) cur.trainings.add(a.training.id);
      deptMap.set(dept, cur);
    }
    const deptParticipation = Array.from(deptMap.entries())
      .map(([dept, v]) => ({
        dept,
        assignedEmployees: v.total,
        completed: v.completed,
        pending: v.total - v.completed,
        completionPct: v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0,
        trainingsCovered: v.trainings.size,
      }))
      .sort((a, b) => b.assignedEmployees - a.assignedEmployees);

    // ── Test Score Distribution ──────────────────────────────
    const scoreBands = [
      { label: "Excellent (80-100)", min: 80, max: 100, color: "#22c55e", count: 0 },
      { label: "Good (60-79)",       min: 60, max: 79,  color: "#60a5fa", count: 0 },
      { label: "Average (40-59)",    min: 40, max: 59,  color: "#f59e0b", count: 0 },
      { label: "Below Avg (<40)",    min: 0,  max: 39,  color: "#ef4444", count: 0 },
    ];
    for (const a of attempts) {
      const s = a.score ?? 0;
      const b = scoreBands.find(b => s >= b.min && s <= b.max);
      if (b) b.count++;
    }

    // Per-employee average score (for top/low lists)
    const empScoreMap = new Map<number, { total: number; count: number }>();
    for (const a of attempts) {
      const cur = empScoreMap.get(a.employeeId) ?? { total: 0, count: 0 };
      cur.total += a.score ?? 0;
      cur.count++;
      empScoreMap.set(a.employeeId, cur);
    }
    const perfEmpIds = Array.from(empScoreMap.keys());
    const empDetails = await prisma.employee.findMany({
      where: { id: { in: perfEmpIds } },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true,
        Department:  { select: { name: true } },
        designation: { select: { name: true } },
      },
    });
    const perfEmpMap = new Map(empDetails.map(e => [e.id, e]));

    // Helper to map a numeric score to a band label (matches scoreBands above)
    const bandFor = (score: number): string => {
      const b = scoreBands.find((b) => score >= b.min && score <= b.max);
      return b?.label ?? "—";
    };

    const performers = perfEmpIds.map(id => {
      const v = empScoreMap.get(id)!;
      const e = perfEmpMap.get(id);
      const avgScore = Math.round(v.total / v.count);
      return {
        employeeId: id,
        name: e ? `${e.firstName} ${e.lastName}` : `#${id}`,
        employeeCode: e?.employeeCode ?? "",
        dept: e?.Department?.name ?? "—",
        designation: e?.designation?.name ?? "—",
        avgScore,
        band: bandFor(avgScore),       // drill-down uses this
        attemptsCount: v.count,
      };
    });

    // Granular per-attempt rows so a dept drill-down can show
    // exactly which training and which test produced each score.
    const tests = await prisma.evaluationTest.findMany({
      where: { id: { in: [...new Set(attempts.map((a) => a.testId))] } },
      select: {
        id: true, name: true, passingPercent: true,
        TrainingTest: { select: { training: { select: { id: true, title: true } } } },
      },
    });
    const testMap = new Map(tests.map((t) => [t.id, t]));

    const attemptDetails = attempts.map((a) => {
      const e = perfEmpMap.get(a.employeeId);
      const t = testMap.get(a.testId);
      const trainingTitle = t?.TrainingTest?.[0]?.training?.title ?? "—";
      return {
        employeeId: a.employeeId,
        name: e ? `${e.firstName} ${e.lastName}` : `#${a.employeeId}`,
        employeeCode: e?.employeeCode ?? "",
        dept: e?.Department?.name ?? "—",
        designation: e?.designation?.name ?? "—",
        trainingTitle,
        testName: t?.name ?? "—",
        score: a.score ?? 0,
        passingPercent: t?.passingPercent ?? 0,
        passed: (a.score ?? 0) >= (t?.passingPercent ?? 0),
        attemptDate: a.createdAt.toISOString().slice(0, 10),
        band: bandFor(a.score ?? 0),
      };
    });

    const topPerformers = [...performers].sort((a, b) => b.avgScore - a.avgScore).slice(0, 10);
    const lowPerformers = [...performers]
      .filter(p => p.avgScore < 60 && p.attemptsCount >= 1)
      .sort((a, b) => a.avgScore - b.avgScore)
      .slice(0, 10);

    // ── Feedback / Top trainings ─────────────────────────────
    const feedbacks = await prisma.trainingFeedback.findMany({
      include: { training: { select: { id: true, title: true, startDate: true } } },
    });
    const trMap = new Map<number, {
      title: string;
      ratings: number[];
      trainerRatings: number[];
      contentRatings: number[];
      relevanceRatings: number[];
      startDate: Date | null;
    }>();
    for (const f of feedbacks) {
      const t = f.training;
      if (!t) continue;
      const cur = trMap.get(t.id) ?? {
        title: t.title, ratings: [], trainerRatings: [],
        contentRatings: [], relevanceRatings: [], startDate: t.startDate,
      };
      if (f.rating)         cur.ratings.push(f.rating);
      if (f.trainerRating)  cur.trainerRatings.push(f.trainerRating);
      if (f.contentQuality) cur.contentRatings.push(f.contentQuality);
      if (f.relevance)      cur.relevanceRatings.push(f.relevance);
      trMap.set(t.id, cur);
    }
    const avg = (arr: number[]) =>
      arr.length === 0 ? 0 : Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10;

    const trainingFeedbackList = Array.from(trMap.entries()).map(([id, v]) => ({
      trainingId: id,
      title: v.title,
      startDate: v.startDate ? v.startDate.toISOString().slice(0, 10) : null,
      avgRating:    avg(v.ratings),
      avgTrainer:   avg(v.trainerRatings),
      avgContent:   avg(v.contentRatings),
      avgRelevance: avg(v.relevanceRatings),
      feedbackCount: v.ratings.length,
    }));

    const topRatedTrainings = [...trainingFeedbackList]
      .filter(t => t.feedbackCount > 0)
      .sort((a, b) => b.avgRating - a.avgRating).slice(0, 5);
    const lowRatedTrainings = [...trainingFeedbackList]
      .filter(t => t.feedbackCount > 0)
      .sort((a, b) => a.avgRating - b.avgRating).slice(0, 5);

    return res.json({
      kpis: {
        trainingsThisMonth,
        totalAssigned: assignmentsAll,
        avgCompletionPct,
        avgTestScore,
        pendingAssignedTests,
      },
      deptParticipation,
      scoreDistribution: scoreBands,
      topPerformers,
      lowPerformers,
      topRatedTrainings,
      lowRatedTrainings,
      // Per-employee detail rows for drill-down (avg score across all attempts)
      employeeList: performers,
      // Granular per-attempt detail rows (employee × training × test)
      // — used for dept drill-down so management sees which trainings/tests
      // contributed to each dept's numbers.
      attemptDetails,
    });
  } catch (err: any) {
    console.error("getTrainingInsights error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 20 — TRAINING CALENDAR (month view)
// GET /api/management/training-calendar?month=YYYY-MM
// ═══════════════════════════════════════════════════════════════════════════════
export const getTrainingCalendar = async (req: Request, res: Response) => {
  try {
    const monthParam = String(req.query.month || "");
    const m = monthParam.match(/^(\d{4})-(\d{1,2})$/);
    const now = new Date();
    const year  = m ? Number(m[1]) : now.getFullYear();
    const month = m ? Number(m[2]) - 1 : now.getMonth();

    const monthStart = new Date(year, month, 1);
    const monthEnd   = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const trainings = await prisma.training.findMany({
      where: {
        OR: [
          { startDate: { gte: monthStart, lte: monthEnd } },
          { endDate:   { gte: monthStart, lte: monthEnd } },
          { AND: [{ startDate: { lte: monthStart } }, { endDate: { gte: monthEnd } }] },
        ],
      },
      include: {
        department:         { select: { name: true } },
        TrainingAttendance: { select: { employeeId: true, date: true, status: true } },
        assignedEmployees:  { select: { employeeId: true, status: true } },
      },
      orderBy: { startDate: "asc" },
    });

    type DayEntry = {
      trainingId: number;
      title: string;
      dept: string;
      mode: string;
      startDate: string;
      endDate: string;
      assignedCount: number;
      attendedCount: number;
      attendancePct: number;
    };
    const byDay: Record<string, DayEntry[]> = {};

    for (const t of trainings) {
      // startDate / endDate are nullable on the Training model — skip rows without dates
      if (!t.startDate) continue;
      const start = new Date(t.startDate);
      const end   = new Date(t.endDate ?? t.startDate);

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d < monthStart || d > monthEnd) continue;
        const key = d.toISOString().slice(0, 10);
        const dayAttendance = t.TrainingAttendance.filter(
          (a: any) => a.date && new Date(a.date).toISOString().slice(0, 10) === key
        );
        const attended = dayAttendance.filter(
          (a: any) => (a.status || "").toUpperCase() === "PRESENT"
        ).length;
        const assigned = t.assignedEmployees.length;

        if (!byDay[key]) byDay[key] = [];
        byDay[key].push({
          trainingId: t.id,
          title: t.title,
          dept: t.department?.name ?? "All depts",
          mode: t.mode ?? "—",
          startDate: t.startDate.toISOString().slice(0, 10),
          endDate:   (t.endDate ?? t.startDate).toISOString().slice(0, 10),
          assignedCount: assigned,
          attendedCount: attended,
          attendancePct: assigned > 0 ? Math.round((attended / assigned) * 100) : 0,
        });
      }
    }

    const days: { date: string; dayOfMonth: number; trainings: DayEntry[]; total: number; totalAttended: number }[] = [];
    const totalDays = monthEnd.getDate();
    for (let dom = 1; dom <= totalDays; dom++) {
      const d = new Date(year, month, dom);
      const key = d.toISOString().slice(0, 10);
      const list = byDay[key] ?? [];
      days.push({
        date: key,
        dayOfMonth: dom,
        trainings: list,
        total: list.length,
        totalAttended: list.reduce((s, x) => s + x.attendedCount, 0),
      });
    }

    return res.json({
      year, month: month + 1,
      monthLabel: monthStart.toLocaleString("en-US", { month: "long", year: "numeric" }),
      totalTrainings: trainings.length,
      days,
    });
  } catch (err: any) {
    console.error("getTrainingCalendar error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// PAYROLL — money cards for the management dashboard
// ═══════════════════════════════════════════════════════════
const money = (n: number) => Math.round(n * 100) / 100;

// ── Payroll cost & statutory liability for one run ─────────────
// GET /api/management/payroll-overview?month=YYYY-MM
export const getPayrollOverview = async (req: Request, res: Response) => {
  try {
    const monthParam = req.query.month as string | undefined;
    let targetYear: number;
    let targetMonth: number; // 1-12
    let labelDate: Date;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split("-").map(Number);
      targetYear = y;
      targetMonth = m;
      labelDate = new Date(`${monthParam}-01`);
    } else {
      const n = new Date();
      targetYear = n.getFullYear();
      targetMonth = n.getMonth() + 1;
      labelDate = startOfMonth(n);
    }
    const monthLabel = format(labelDate, "MMMM yyyy");

    const run = await prisma.payrollRun.findUnique({
      where: { month_year: { month: targetMonth, year: targetYear } },
      include: { payslips: true },
    });

    if (!run) {
      return res.json({
        exists: false,
        monthLabel,
        headcount: 0,
        totals: { gross: 0, net: 0, deductions: 0, employerCost: 0, lopDays: 0, otPay: 0, otHours: 0 },
        statutory: { pf: 0, esi: 0, professionalTax: 0, tds: 0 },
        byDept: [],
        byBranch: [],
      });
    }

    const slips = run.payslips;
    const sum = (fn: (p: typeof slips[number]) => number) => slips.reduce((s, p) => s + fn(p), 0);

    const gross = sum((p) => p.grossEarnings);
    const net = sum((p) => p.netPay);
    const deductions = sum((p) => p.totalDeductions);
    const pfEmployee = sum((p) => p.pfEmployee);
    const pfEmployer = sum((p) => p.pfEmployer);
    const esiEmployee = sum((p) => p.esiEmployee);
    const esiEmployer = sum((p) => p.esiEmployer);
    const professionalTax = sum((p) => p.professionalTax);
    const tds = sum((p) => p.tds);

    // Dept / branch cost split
    const empIds = slips.map((p) => p.employeeId);
    const employees = await prisma.employee.findMany({
      where: { id: { in: empIds } },
      include: { Department: { select: { name: true } }, Branch: { select: { name: true } } },
    });
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const deptMap = new Map<string, { gross: number; net: number; count: number }>();
    const branchMap = new Map<string, { gross: number; net: number; count: number }>();
    for (const p of slips) {
      const emp = empMap.get(p.employeeId);
      const dept = emp?.Department?.name || "Unknown";
      const branch = emp?.Branch?.name || "Unknown";
      const d = deptMap.get(dept) || { gross: 0, net: 0, count: 0 };
      d.gross += p.grossEarnings; d.net += p.netPay; d.count += 1;
      deptMap.set(dept, d);
      const b = branchMap.get(branch) || { gross: 0, net: 0, count: 0 };
      b.gross += p.grossEarnings; b.net += p.netPay; b.count += 1;
      branchMap.set(branch, b);
    }

    const byDept = Array.from(deptMap.entries())
      .map(([dept, v]) => ({ dept, gross: money(v.gross), net: money(v.net), count: v.count }))
      .sort((a, b) => b.gross - a.gross);
    const byBranch = Array.from(branchMap.entries())
      .map(([branch, v]) => ({ branch, gross: money(v.gross), net: money(v.net), count: v.count }))
      .sort((a, b) => b.gross - a.gross);

    res.json({
      exists: true,
      monthLabel,
      runId: run.id,
      status: run.status,
      headcount: slips.length,
      totals: {
        gross: money(gross),
        net: money(net),
        deductions: money(deductions),
        employerCost: money(gross + pfEmployer + esiEmployer),
        lopDays: money(sum((p) => p.lopDays)),
        otPay: money(sum((p) => p.overtimePay)),
        otHours: money(sum((p) => p.overtimeHours)),
      },
      statutory: {
        pf: money(pfEmployee + pfEmployer),
        esi: money(esiEmployee + esiEmployer),
        professionalTax: money(professionalTax),
        tds: money(tds),
      },
      byDept,
      byBranch,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Month-over-month payroll trend (last 6 runs) ───────────────
// GET /api/management/payroll-trend
export const getPayrollTrend = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const pairs: { year: number; month: number; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(startOfMonth(now), i);
      pairs.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: format(d, "MMM yyyy") });
    }

    const grouped = await prisma.payslip.groupBy({
      by: ["year", "month"],
      where: { OR: pairs.map((p) => ({ year: p.year, month: p.month })) },
      _sum: { grossEarnings: true, netPay: true, totalDeductions: true },
      _count: { _all: true },
    });
    const gMap = new Map(grouped.map((g) => [`${g.year}-${g.month}`, g]));

    const trend = pairs.map((p) => {
      const g = gMap.get(`${p.year}-${p.month}`);
      return {
        label: p.label,
        gross: money(g?._sum.grossEarnings || 0),
        net: money(g?._sum.netPay || 0),
        deductions: money(g?._sum.totalDeductions || 0),
        headcount: g?._count._all || 0,
      };
    });

    res.json({ trend });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Loan exposure & repayment view ─────────────────────────────
// GET /api/management/loan-overview
export const getLoanOverview = async (_req: Request, res: Response) => {
  try {
    const [active, byStatus, byType, repaymentByMode, repaidAgg] = await Promise.all([
      prisma.loan.aggregate({
        where: { status: "ACTIVE" },
        _sum: { outstandingBalance: true, emiAmount: true, principalAmount: true },
        _count: { _all: true },
      }),
      prisma.loan.groupBy({
        by: ["status"],
        _sum: { principalAmount: true, outstandingBalance: true },
        _count: { _all: true },
      }),
      prisma.loan.groupBy({
        by: ["loanType"],
        _sum: { principalAmount: true, outstandingBalance: true },
        _count: { _all: true },
      }),
      prisma.loanRepayment.groupBy({
        by: ["mode"],
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.loan.aggregate({ _sum: { totalRepaid: true, principalAmount: true } }),
    ]);

    const pending = byStatus.find((s) => s.status === "PENDING");

    res.json({
      outstandingExposure: money(active._sum.outstandingBalance || 0),
      activeLoans: active._count._all,
      emiDueThisMonth: money(active._sum.emiAmount || 0),
      totalDisbursed: money(repaidAgg._sum.principalAmount || 0),
      totalRepaid: money(repaidAgg._sum.totalRepaid || 0),
      pendingApprovals: {
        count: pending?._count._all || 0,
        amount: money(pending?._sum.principalAmount || 0),
      },
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count._all,
        principal: money(s._sum.principalAmount || 0),
        outstanding: money(s._sum.outstandingBalance || 0),
      })),
      byType: byType.map((t) => ({
        type: t.loanType,
        count: t._count._all,
        principal: money(t._sum.principalAmount || 0),
        outstanding: money(t._sum.outstandingBalance || 0),
      })),
      repaymentByMode: repaymentByMode.map((m) => ({
        mode: m.mode || "UNSPECIFIED",
        count: m._count._all,
        amount: money(m._sum.amount || 0),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Incentive payouts & pending approvals ──────────────────────
// GET /api/management/incentive-overview
export const getIncentiveOverview = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

    const [pending, byType, bySource, paidThisMonth, paidThisYear] = await Promise.all([
      prisma.incentive.aggregate({
        where: { status: "PENDING" },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.incentive.groupBy({
        by: ["type"],
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.incentive.groupBy({
        by: ["source"],
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.incentive.aggregate({
        where: { status: "PAID", paidOn: { gte: monthStart, lte: monthEnd } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.incentive.aggregate({
        where: { status: "PAID", paidOn: { gte: yearStart, lte: yearEnd } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    res.json({
      pendingApprovals: { count: pending._count._all, amount: money(pending._sum.amount || 0) },
      paidThisMonth: { count: paidThisMonth._count._all, amount: money(paidThisMonth._sum.amount || 0) },
      paidThisYear: { count: paidThisYear._count._all, amount: money(paidThisYear._sum.amount || 0) },
      byType: byType.map((t) => ({ type: t.type, count: t._count._all, amount: money(t._sum.amount || 0) })),
      bySource: bySource.map((s) => ({ source: s.source, count: s._count._all, amount: money(s._sum.amount || 0) })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ── Payroll readiness: structure gaps, CTC spread, TDS, revisions ──
// GET /api/management/payroll-readiness
export const getPayrollReadiness = async (_req: Request, res: Response) => {
  try {
    const now = new Date();

    const [missing, structures, upcoming] = await Promise.all([
      // Active employees with no salary structure → would be skipped in a run
      prisma.employee.findMany({
        where: { employmentStatus: "ACTIVE", salaryStructure: { is: null } },
        select: {
          id: true, firstName: true, lastName: true, employeeCode: true,
          Department: { select: { name: true } },
        },
        orderBy: { firstName: "asc" },
      }),
      prisma.salaryStructure.findMany({
        select: {
          basic: true, hra: true, medicalAllowance: true, travelAllowance: true,
          specialAllowance: true, otherAllowances: true, tdsMonthly: true,
        },
      }),
      // Salary revisions scheduled to take effect in the future
      prisma.salaryStructure.findMany({
        where: { effectiveFrom: { gt: now } },
        select: {
          effectiveFrom: true,
          employee: {
            select: { firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } },
          },
        },
        orderBy: { effectiveFrom: "asc" },
      }),
    ]);

    // Monthly CTC distribution buckets
    const buckets = [
      { label: "< 20k", min: 0, max: 20000, count: 0 },
      { label: "20k–40k", min: 20000, max: 40000, count: 0 },
      { label: "40k–60k", min: 40000, max: 60000, count: 0 },
      { label: "60k–1L", min: 60000, max: 100000, count: 0 },
      { label: "> 1L", min: 100000, max: Infinity, count: 0 },
    ];
    let totalMonthlyTds = 0;
    for (const s of structures) {
      const ctc = s.basic + s.hra + s.medicalAllowance + s.travelAllowance + s.specialAllowance + s.otherAllowances;
      totalMonthlyTds += s.tdsMonthly;
      const bucket = buckets.find((b) => ctc >= b.min && ctc < b.max);
      if (bucket) bucket.count += 1;
    }

    res.json({
      missingStructure: {
        count: missing.length,
        employees: missing.map((e) => ({
          name: `${e.firstName} ${e.lastName}`,
          employeeCode: e.employeeCode,
          dept: e.Department?.name || "—",
        })),
      },
      ctcDistribution: buckets.map((b) => ({ label: b.label, count: b.count })),
      totalMonthlyTds: money(totalMonthlyTds),
      structuresOnFile: structures.length,
      upcomingRevisions: {
        count: upcoming.length,
        items: upcoming.map((u) => ({
          name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : "—",
          employeeCode: u.employee?.employeeCode || "—",
          dept: u.employee?.Department?.name || "—",
          effectiveFrom: u.effectiveFrom,
        })),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
