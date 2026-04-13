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
    const employees = await prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
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

    // By department + employment type
    const deptMap = new Map<string, Record<string, number>>();
    for (const e of employees) {
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

    // By status (donut)
    const statusMap = new Map<string, number>();
    for (const e of employees) {
      const s = e.employmentStatus || "ACTIVE";
      statusMap.set(s, (statusMap.get(s) || 0) + 1);
    }

    const byStatus = Array.from(statusMap.entries()).map(([status, count]) => ({
      status,
      count,
    }));

    // Full employee roster for drill-down
    const employeeList = employees.map((e) => ({
      name: `${e.firstName} ${e.lastName}`,
      dept: e.Department?.name || "—",
      designation: e.designation?.name || "—",
      type: e.employmentType || "—",
      status: e.employmentStatus,
    }));

    res.json({ byDept, byStatus, total: employees.length, employeeList });
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

    const days: {
      date: string;
      present: number;
      absent: number;
      leave: number;
      permission: number;
    }[] = [];

    const totalActive = await prisma.employee.count({
      where: { employmentStatus: "ACTIVE" },
    });

    for (let i = numDays - 1; i >= 0; i--) {
      const d = addDays(new Date(), -i);
      const dayStart = startOfDayIST(d);
      const dayEnd = endOfDayIST(d);
      // For 7 days: "Mon 07", for 14/30: "07 Apr"
      const label = numDays <= 7 ? format(d, "EEE dd") : format(d, "dd MMM");

      const [present, leave, permission] = await Promise.all([
        prisma.attendance.count({ where: { date: { gte: dayStart, lte: dayEnd }, status: "PRESENT" } }),
        prisma.attendance.count({ where: { date: { gte: dayStart, lte: dayEnd }, status: "LEAVE" } }),
        prisma.attendance.count({ where: { date: { gte: dayStart, lte: dayEnd }, status: "PERMISSION" } }),
      ]);

      const absent = Math.max(0, totalActive - present - leave - permission);
      days.push({ date: label, present, absent, leave, permission });
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
    let targetDate = new Date();
    if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month as string)) {
      const [y, m] = (req.query.month as string).split("-").map(Number);
      targetDate = new Date(y, m - 1, 1);
    }
    const monthStart = startOfMonth(targetDate);
    const monthEnd = endOfMonth(targetDate);

    console.log("Fetching leave calendar for month:", monthStart, "to", monthEnd);

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

    console.log(`Found ${leaves.length} approved leaves overlapping with month`);

    // Build day → entries map (includes leave type per person)
    const dayMap = new Map<string, { count: number; entries: { name: string; type: string }[]; typeCounts: Map<string, number> }>();

    for (const l of leaves) {
      let cur = new Date(l.startDate);
      const end = new Date(l.endDate);
      const leaveTypeName = l.leaveType?.name || "Leave";
      while (cur <= end && cur <= monthEnd) {
        if (cur >= monthStart) {
          const key = format(cur, "yyyy-MM-dd");
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
      month: format(targetDate, "yyyy-MM"),
      monthLabel: format(targetDate, "MMMM yyyy"),
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
    const months: { month: string; submitted: number; exited: number }[] = [];

    for (let i = 11; i >= 0; i--) {
      const d = subMonths(new Date(), i);
      const mStart = startOfMonth(d);
      const mEnd = endOfMonth(d);
      const label = format(d, "MMM yy");

      const [submitted, exited] = await Promise.all([
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
      ]);

      months.push({ month: label, submitted, exited });
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
        const riskScore    = Math.round(
          (resignRate * 3 + leaveRate * 1 + scoreRisk * 2 + (v.pips / Math.max(v.headcount, 1)) * 2) * 33
        );
        const riskLevel    = riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low";
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
        employee: { select: { Department: { select: { name: true } } } },
      },
      orderBy: { weekStartDate: "asc" },
    });

    // Group by week
    const weekMap = new Map<string, { label: string; scores: number[] }>();
    for (const r of ratings) {
      const key = format(new Date(r.weekStartDate), "yyyy-MM-dd");
      const label = r.weekLabel || format(new Date(r.weekStartDate), "dd MMM");
      if (!weekMap.has(key)) weekMap.set(key, { label, scores: [] });
      weekMap.get(key)!.scores.push(r.overallScore!);
    }

    const weeks = Array.from(weekMap.entries()).map(([, v]) => ({
      label: v.label,
      avgScore: v.scores.length > 0 ? Math.round((v.scores.reduce((s, x) => s + x, 0) / v.scores.length) * 10) / 10 : 0,
      rated: v.scores.length,
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
        employee: { select: { Department: { select: { name: true } } } },
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

    res.json({ distribution, completionPct, withAppraisal, totalActive, deptAvg });
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
        status: "APPROVED",
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
    const topUsers = [...allEmployees].sort((a, b) => b.utilizationPct - a.utilizationPct).slice(0, 15);

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
