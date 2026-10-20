// ─────────────────────────────────────────────────────────────────────────────
//  Manager / HOD dashboard.
//
//  Every endpoint here answers the same question in a different shape: "what is
//  happening to the people who report to me". The team is resolved once per
//  request by lib/team.ts and never re-derived inline — that is the whole point
//  of the module, because the counts on this screen sit next to each other and
//  have to be counted over the same people.
//
//  NOT an extension of management.controller.ts. That one is deliberately
//  global (it powers the Management and HR Analytics dashboards) and threading
//  a scope parameter through its ~50 endpoints would put two live dashboards at
//  risk to serve a third.
//
//  FIVE SECTIONS, fixed by the spec:
//    1. Team composition — headcount, gender split, and the week outlook.
//    2. Every request waiting on this manager, in ONE place.
//    3. Shift roster, this week and next.
//    4. Weekly performance still to be given, and the top performers.
//    5. Today's attendance measured against each person's rostered shift.
//
//  PAST vs PLANNED. Attendance rows only exist for days that have happened, so
//  a future week has no present/absent to report. Those periods return planned
//  state only — approved leave, sanctioned permissions, roster week-offs — and
//  say so in the payload rather than letting the UI imply an actual.
//
//  APPROVAL CHAINS differ per request type. In-charge → HOD → HR for leave,
//  permission and weekly reports; a single manager step for OT and comp-off;
//  and the roster's RM step exists only when the employee has an in-charge at
//  all. So "waiting on me" is not one query — it depends on which relation this
//  manager holds over that particular employee, which is why TeamScope carries
//  the relation per member rather than per manager.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { addDays, format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { currentEmployeeId, currentDeptId } from "../../lib/currentUser";
import { normalizeAttendanceStatus } from "../../lib/attendanceStatus";
import { getTeamScope, TeamScope, TeamMember } from "../../lib/team";

// Same IST helpers the other dashboards use — the server runs on UTC in some
// deployments, so "today" has to be pinned to the business timezone.
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

/** Resolve the caller's team, or null when the token carries no employee. */
async function scopeFor(req: Request): Promise<TeamScope | null> {
  const empId = currentEmployeeId(req as any);
  if (!empId) return null;
  return getTeamScope(empId);
}

const UNAUTHORIZED = { error: "Unauthorized" };

// ── Attendance categorisation ───────────────────────────────────────────────
// Ported from getDeptAttendanceToday so the manager's numbers agree with the
// management dashboard's: a day with no attendance row is only "Absent" once
// holiday and week-off have been ruled out.

type DayContext = {
  isHoliday: boolean;
  holidayTitle: string | null;
  weekOff: Set<number>;
};

/** Holiday + per-employee week-off for one calendar day, for these employees. */
async function dayContext(day: Date, employeeIds: number[]): Promise<DayContext> {
  const dayStart = startOfDayIST(day);
  const dayEnd = endOfDayIST(day);
  const dayStr = format(day, "yyyy-MM-dd");

  const holiday = await prisma.holiday.findFirst({
    where: { date: { gte: dayStart, lte: dayEnd } },
    select: { title: true },
  });
  if (holiday) {
    return { isHoliday: true, holidayTitle: holiday.title ?? null, weekOff: new Set() };
  }

  const weekOff = new Set<number>();
  if (!employeeIds.length) return { isHoliday: false, holidayTitle: null, weekOff };

  const year = day.getFullYear();
  const month = day.getMonth() + 1;
  const approvals = await prisma.shiftApproval.findMany({
    where: { status: "APPROVED", month, year, employeeId: { in: employeeIds } },
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
      if (format(wo, "yyyy-MM-dd") === dayStr) weekOff.add(ap.employeeId);
    }
  }

  // Sunday is the fallback week-off for anyone without an approved config.
  if (day.getDay() === 0) {
    for (const id of employeeIds) if (!approvedEmps.has(id)) weekOff.add(id);
  }

  return { isHoliday: false, holidayTitle: null, weekOff };
}

type Category = "Present" | "Leave" | "Permission" | "Holiday" | "Week Off" | "Absent";

function categorise(rawStatus: unknown, employeeId: number, ctx: DayContext): Category {
  const st = normalizeAttendanceStatus(rawStatus);
  if (st === "PRESENT") return "Present";
  if (st === "HALF_DAY") return "Present";
  if (st === "LEAVE") return "Leave";
  if (st === "PERMISSION") return "Permission";
  if (ctx.isHoliday) return "Holiday";
  if (ctx.weekOff.has(employeeId)) return "Week Off";
  return "Absent";
}

// ── Period resolution (section 1's filter) ──────────────────────────────────

type Period = { key: string; label: string; from: Date; to: Date };

/** current week | next week | this month, Monday-based like the rest of the app. */
function resolvePeriod(raw: unknown): Period {
  const key = String(raw ?? "current");
  const now = new Date();
  if (key === "next") {
    const from = startOfWeek(addDays(now, 7), { weekStartsOn: 1 });
    return { key, label: "Next week", from: startOfDayIST(from), to: endOfDayIST(endOfWeek(from, { weekStartsOn: 1 })) };
  }
  if (key === "month") {
    return {
      key,
      label: format(now, "MMMM yyyy"),
      from: startOfDayIST(startOfMonth(now)),
      to: endOfDayIST(endOfMonth(now)),
    };
  }
  const from = startOfWeek(now, { weekStartsOn: 1 });
  return { key: "current", label: "This week", from: startOfDayIST(from), to: endOfDayIST(endOfWeek(from, { weekStartsOn: 1 })) };
}

/**
 * Holiday + week-off for a whole range in two queries instead of two per day.
 * Returns a per-day lookup with the same shape `categorise` already expects.
 */
async function rangeContext(from: Date, to: Date, employeeIds: number[]): Promise<Map<string, DayContext>> {
  const out = new Map<string, DayContext>();

  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: from, lte: to } },
    select: { date: true, title: true },
  });
  const holidayByDay = new Map(holidays.map((h) => [format(new Date(h.date), "yyyy-MM-dd"), h.title ?? null]));

  // Shift approvals are keyed by (month, year), so collect every month the
  // range touches rather than assuming it sits inside one.
  const months = new Set<string>();
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) months.add(`${d.getFullYear()}-${d.getMonth() + 1}`);
  const approvals = employeeIds.length
    ? await prisma.shiftApproval.findMany({
        where: {
          status: "APPROVED",
          employeeId: { in: employeeIds },
          OR: [...months].map((m) => {
            const [y, mo] = m.split("-").map(Number);
            return { year: y, month: mo };
          }),
        },
        select: { employeeId: true, weekOffConfig: true, month: true, year: true },
      })
    : [];

  // employeeId → set of yyyy-MM-dd that are their week-off
  const weekOffDays = new Map<number, Set<string>>();
  const configured = new Set<number>();
  for (const ap of approvals) {
    configured.add(ap.employeeId);
    const cfg = ap.weekOffConfig as { weeks?: Record<string, number> } | null;
    if (!cfg?.weeks || ap.month == null || ap.year == null) continue;
    const monthStart = new Date(ap.year, ap.month - 1, 1);
    const firstWeekStart = new Date(monthStart);
    firstWeekStart.setDate(monthStart.getDate() - monthStart.getDay());
    firstWeekStart.setHours(0, 0, 0, 0);
    for (const [wkStr, dow] of Object.entries(cfg.weeks)) {
      const wk = Number(wkStr);
      if (Number.isNaN(wk) || typeof dow !== "number") continue;
      const wo = new Date(firstWeekStart);
      wo.setDate(firstWeekStart.getDate() + wk * 7 + dow);
      if (!weekOffDays.has(ap.employeeId)) weekOffDays.set(ap.employeeId, new Set());
      weekOffDays.get(ap.employeeId)!.add(format(wo, "yyyy-MM-dd"));
    }
  }

  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const key = format(d, "yyyy-MM-dd");
    if (holidayByDay.has(key)) {
      out.set(key, { isHoliday: true, holidayTitle: holidayByDay.get(key)!, weekOff: new Set() });
      continue;
    }
    const weekOff = new Set<number>();
    for (const id of employeeIds) {
      if (weekOffDays.get(id)?.has(key)) weekOff.add(id);
      // Sunday is the fallback for anyone with no approved configuration.
      else if (d.getDay() === 0 && !configured.has(id)) weekOff.add(id);
    }
    out.set(key, { isHoliday: false, holidayTitle: null, weekOff });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// SECTION 2 — ALERTS TICKER
// GET /api/manager/alerts
//
// One time-ordered feed of the two things a manager is expected to have seen:
// their own unread notifications (the system telling them something happened)
// and the circulars currently in force. Merged rather than tabbed, because the
// panel scrolls on its own and a tab the reader never clicks shows nothing.
// ═══════════════════════════════════════════════════════════
export const getAlerts = async (req: Request, res: Response) => {
  try {
    const empId = currentEmployeeId(req as any);
    if (!empId) return res.status(401).json(UNAUTHORIZED);

    const now = new Date();
    const [notifications, announcements] = await Promise.all([
      prisma.notification.findMany({
        where: { employeeId: empId, isRead: false },
        select: { id: true, title: true, message: true, channel: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.announcement.findMany({
        where: {
          archivedAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gte: now } }],
        },
        select: {
          id: true, title: true, body: true, type: true, isPinned: true,
          requireAck: true, circularCode: true, startsAt: true,
        },
        orderBy: [{ isPinned: "desc" }, { startsAt: "desc" }],
        take: 20,
      }),
    ]);

    const items = [
      ...notifications.map((n) => ({
        kind: "NOTIFICATION" as const,
        id: `n${n.id}`,
        title: n.title || "Notification",
        // Notification.message is the payload; announcements carry a body.
        body: n.message,
        at: n.createdAt,
        pinned: false,
        tag: String(n.channel),
      })),
      ...announcements.map((a) => ({
        kind: "ANNOUNCEMENT" as const,
        id: `a${a.id}`,
        title: a.title,
        // Circular bodies are LongText and can carry markup from the editor;
        // stripped here so the ticker never renders half a tag.
        body: String(a.body ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240),
        at: a.startsAt,
        pinned: a.isPinned,
        tag: a.circularCode || a.type || "Circular",
        requireAck: a.requireAck,
      })),
    ]
      // Pinned circulars ride at the top of the loop; everything else is newest
      // first, so the ticker opens on what changed most recently.
      .sort((x, y) => Number(y.pinned) - Number(x.pinned) || new Date(y.at).getTime() - new Date(x.at).getTime());

    return res.json({
      counts: { notifications: notifications.length, announcements: announcements.length, total: items.length },
      // Announcement.audience is free text with no department or team
      // targeting behind it, so circulars here are institution-wide, not a
      // team-filtered feed.
      teamFiltered: false,
      items,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// SECTION 1 — TEAM COMPOSITION
// GET /api/manager/team-composition?period=current|next|month
//
// Headcount and its gender split, plus the day-by-day outlook for the chosen
// period. Days already past report ACTUAL attendance; days still ahead report
// only what is PLANNED — approved leave, sanctioned permission, roster
// week-offs — because there is no attendance row for a day that has not
// happened. Both are returned separately so the UI never shows a forecast in a
// column labelled "present".
// ═══════════════════════════════════════════════════════════
export const getTeamComposition = async (req: Request, res: Response) => {
  try {
    const scope = await scopeFor(req);
    if (!scope) return res.status(401).json(UNAUTHORIZED);

    const period = resolvePeriod(req.query.period);
    if (scope.isEmpty) {
      return res.json({
        headcount: 0,
        gender: [],
        period: { ...period, isFuture: false },
        days: [],
        totals: { present: 0, leave: 0, permission: 0, absent: 0, weekOff: 0 },
        plannedTotals: { leave: 0, permission: 0, weekOff: 0, scheduled: 0 },
        hasActual: false,
        hasPlanned: false,
        empty: true,
      });
    }

    const ids = scope.employeeIds;
    const todayKey = format(new Date(), "yyyy-MM-dd");

    const [attendance, ctx, leaves, permissions, genderRows] = await Promise.all([
      prisma.attendance.findMany({
        where: { employeeId: { in: ids }, date: { gte: period.from, lte: period.to } },
        select: { employeeId: true, date: true, status: true },
      }),
      rangeContext(period.from, period.to, ids),
      // Approved leave overlapping the window — this is what makes a future day
      // knowable at all.
      prisma.leaveRequest.findMany({
        where: {
          employeeId: { in: ids },
          status: "APPROVED",
          startDate: { lte: period.to },
          endDate: { gte: period.from },
        },
        select: { employeeId: true, startDate: true, endDate: true },
      }),
      prisma.permissionRequest.findMany({
        where: { employeeId: { in: ids }, status: "APPROVED", day: { gte: period.from, lte: period.to } },
        select: { employeeId: true, day: true },
      }),
      prisma.employee.groupBy({
        by: ["gender"],
        where: { id: { in: ids } },
        _count: { _all: true },
      }),
    ]);

    const actualByKey = new Map<string, Map<number, string>>();
    for (const a of attendance) {
      const k = format(new Date(a.date), "yyyy-MM-dd");
      if (!actualByKey.has(k)) actualByKey.set(k, new Map());
      actualByKey.get(k)!.set(a.employeeId, a.status ?? "");
    }

    const leaveByKey = new Map<string, Set<number>>();
    for (const l of leaves) {
      for (let d = new Date(l.startDate); d <= new Date(l.endDate); d = addDays(d, 1)) {
        const k = format(d, "yyyy-MM-dd");
        if (!leaveByKey.has(k)) leaveByKey.set(k, new Set());
        leaveByKey.get(k)!.add(l.employeeId);
      }
    }
    const permByKey = new Map<string, Set<number>>();
    for (const p of permissions) {
      const k = format(new Date(p.day), "yyyy-MM-dd");
      if (!permByKey.has(k)) permByKey.set(k, new Set());
      permByKey.get(k)!.add(p.employeeId);
    }

    const days: any[] = [];
    const totals = { present: 0, leave: 0, permission: 0, absent: 0, weekOff: 0 };
    const plannedTotals = { leave: 0, permission: 0, weekOff: 0, scheduled: 0 };

    for (let d = new Date(period.from); d <= period.to; d = addDays(d, 1)) {
      const key = format(d, "yyyy-MM-dd");
      const dctx = ctx.get(key) ?? { isHoliday: false, holidayTitle: null, weekOff: new Set<number>() };
      const isFuture = key > todayKey;

      if (!isFuture) {
        const statuses = actualByKey.get(key) ?? new Map();
        const row = { date: key, label: format(d, "EEE dd"), planned: false, holiday: dctx.holidayTitle,
                      present: 0, leave: 0, permission: 0, absent: 0, weekOff: 0 };
        for (const id of ids) {
          switch (categorise(statuses.get(id), id, dctx)) {
            case "Present": row.present++; totals.present++; break;
            case "Leave": row.leave++; totals.leave++; break;
            case "Permission": row.permission++; totals.permission++; break;
            case "Holiday":
            case "Week Off": row.weekOff++; totals.weekOff++; break;
            default: row.absent++; totals.absent++;
          }
        }
        days.push(row);
        continue;
      }

      // Future day: only what is already committed is knowable.
      const row = { date: key, label: format(d, "EEE dd"), planned: true, holiday: dctx.holidayTitle,
                    leave: 0, permission: 0, weekOff: 0, scheduled: 0 };
      for (const id of ids) {
        if (dctx.isHoliday || dctx.weekOff.has(id)) { row.weekOff++; plannedTotals.weekOff++; }
        else if (leaveByKey.get(key)?.has(id)) { row.leave++; plannedTotals.leave++; }
        else if (permByKey.get(key)?.has(id)) { row.permission++; plannedTotals.permission++; }
        else { row.scheduled++; plannedTotals.scheduled++; }
      }
      days.push(row);
    }

    const GENDER_LABELS: Record<string, string> = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };
    const gender = genderRows
      .map((g: any) => ({
        key: String(g.gender),
        label: GENDER_LABELS[String(g.gender)] ?? String(g.gender),
        value: g._count._all,
      }))
      .sort((a, b) => b.value - a.value);

    return res.json({
      headcount: ids.length,
      gender,
      period: { ...period, isFuture: period.from > new Date() },
      days,
      totals,
      plannedTotals,
      hasActual: days.some((d) => !d.planned),
      hasPlanned: days.some((d) => d.planned),
      empty: false,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 1b. TEAM SNAPSHOT — the KPI row
// GET /api/manager/team-snapshot
// ═══════════════════════════════════════════════════════════
export const getTeamSnapshot = async (req: Request, res: Response) => {
  try {
    const scope = await scopeFor(req);
    if (!scope) return res.status(401).json(UNAUTHORIZED);

    if (scope.isEmpty) {
      return res.json({
        teamStrength: 0,
        presentToday: 0,
        presentPct: 0,
        onLeave: 0,
        absent: 0,
        weekOff: 0,
        avgTeamScore: null,
        scoreScaleMax: 100,
        ratedThisWeek: 0,
        pendingApprovals: 0,
        probationDue: 0,
        relations: { incharge: 0, hod: 0 },
        empty: true,
      });
    }

    const ids = scope.employeeIds;
    const todayStart = startOfDayIST();
    const todayEnd = endOfDayIST();
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const in30Days = addDays(new Date(), 30);

    const [attendance, ctx, ratings, pending, probationDue] = await Promise.all([
      prisma.attendance.findMany({
        where: { employeeId: { in: ids }, date: { gte: todayStart, lte: todayEnd } },
        select: { employeeId: true, status: true },
      }),
      dayContext(new Date(), ids),
      prisma.weeklyPerformanceRating.findMany({
        where: {
          employeeId: { in: ids },
          weekStartDate: { gte: addDays(weekStart, -7) },
          status: "SUBMITTED",
          overallScore: { not: null },
          // MANAGER only. A SELF row is the employee's own assessment (the
          // writer stamps raterType from employeeId === ratedBy), so counting
          // it here would let someone raise their manager's team average by
          // rating themselves.
          raterType: "MANAGER",
        },
        select: { overallScore: true },
      }),
      allPendingApprovals(scope, currentDeptId(req as any)),
      prisma.employee.count({
        where: {
          id: { in: ids },
          probationStatus: "IN_PROGRESS" as any,
          probationEndDate: { gte: new Date(), lte: in30Days },
        },
      }),
    ]);

    const statusByEmp = new Map(attendance.map((a) => [a.employeeId, a.status]));
    let present = 0, onLeave = 0, absent = 0, weekOff = 0, permission = 0;
    for (const id of ids) {
      switch (categorise(statusByEmp.get(id), id, ctx)) {
        case "Present": present++; break;
        case "Leave": onLeave++; break;
        case "Permission": permission++; break;
        case "Holiday":
        case "Week Off": weekOff++; break;
        default: absent++;
      }
    }

    const scores = ratings.map((r) => r.overallScore!).filter((s) => s != null);
    const avg = scores.length
      ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 100) / 100
      : null;

    // Present % is measured against the people who were actually expected in —
    // counting holidays and week-offs as "not present" makes every Sunday look
    // like an attendance collapse.
    const expected = ids.length - weekOff;

    return res.json({
      teamStrength: ids.length,
      presentToday: present,
      presentPct: expected > 0 ? Math.round((present / expected) * 1000) / 10 : 0,
      onLeave,
      permission,
      absent,
      weekOff,
      holiday: ctx.isHoliday ? ctx.holidayTitle : null,
      // The stored overallScore is `round(avg(1–10 answers) × 10)` — see
      // weekly-rating.controller — so it lands on a 0–100 scale, NOT the 1–10
      // of the individual answers and not the /5 of the mockup. Sent explicitly
      // so the UI renders the number it was given instead of guessing a scale.
      avgTeamScore: avg,
      scoreScaleMax: 100,
      ratedThisWeek: scores.length,
      pendingApprovals: pending.counts.total,
      approvalBreakdown: pending.counts,
      probationDue,
      relations: {
        incharge: scope.members.filter((m) => m.relation === "INCHARGE").length,
        hod: scope.members.filter((m) => m.relation === "HOD").length,
      },
      empty: false,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 2. ATTENDANCE TODAY — per-person list behind the KPI tiles
// GET /api/manager/attendance-today
// ═══════════════════════════════════════════════════════════
export const getAttendanceToday = async (req: Request, res: Response) => {
  try {
    const scope = await scopeFor(req);
    if (!scope) return res.status(401).json(UNAUTHORIZED);
    if (scope.isEmpty) {
      return res.json({ date: new Date(), holiday: null, summary: {}, lateCount: 0, earlyOutCount: 0, rosteredCount: 0, rows: [] });
    }

    const ids = scope.employeeIds;
    const todayStart = startOfDayIST();
    const todayEnd = endOfDayIST();

    const [attendance, ctx, assignments] = await Promise.all([
      prisma.attendance.findMany({
        where: { employeeId: { in: ids }, date: { gte: todayStart, lte: todayEnd } },
        select: { employeeId: true, status: true, checkIn: true, checkOut: true },
      }),
      dayContext(new Date(), ids),
      // Today's rostered shift per person — without it "checked in at 09:40" is
      // meaningless, because it is early for one shift and late for another.
      prisma.shiftAssignment.findMany({
        where: { employeeId: { in: ids }, date: { gte: todayStart, lte: todayEnd } },
        select: {
          employeeId: true,
          shift: { select: { name: true, startTime: true, endTime: true } },
        },
      }),
    ]);
    const shiftByEmp = new Map(assignments.filter((a) => a.shift).map((a) => [a.employeeId, a.shift!]));

    /** Anchor a shift's time-of-day onto today, so the two are comparable. */
    const anchor = (t: Date) => {
      const d = new Date(todayStart);
      const src = new Date(t);
      d.setHours(src.getHours(), src.getMinutes(), 0, 0);
      return d;
    };
    const minutesBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 60000);

    const attnByEmp = new Map(attendance.map((a) => [a.employeeId, a]));
    const summary: Record<string, number> = {
      Present: 0, Leave: 0, Permission: 0, "Week Off": 0, Holiday: 0, Absent: 0,
    };

    let lateCount = 0, earlyOutCount = 0;

    const rows = scope.members.map((m) => {
      const rec = attnByEmp.get(m.id);
      const category = categorise(rec?.status, m.id, ctx);
      summary[category] = (summary[category] ?? 0) + 1;

      const shift = shiftByEmp.get(m.id) ?? null;
      const shiftStart = shift ? anchor(shift.startTime) : null;
      const shiftEnd = shift ? anchor(shift.endTime) : null;

      // Positive = minutes late in / minutes short at the end of the day. Null
      // whenever either half of the comparison is missing, so the UI shows a
      // dash instead of a confident zero.
      const lateByMin = rec?.checkIn && shiftStart ? Math.max(minutesBetween(new Date(rec.checkIn), shiftStart), 0) : null;
      const earlyOutMin = rec?.checkOut && shiftEnd ? Math.max(minutesBetween(shiftEnd, new Date(rec.checkOut)), 0) : null;
      const workedMin = rec?.checkIn && rec?.checkOut
        ? minutesBetween(new Date(rec.checkOut), new Date(rec.checkIn))
        : null;

      if (lateByMin && lateByMin > 0) lateCount++;
      if (earlyOutMin && earlyOutMin > 0) earlyOutCount++;

      return {
        employeeId: m.id,
        name: m.name,
        employeeCode: m.employeeCode,
        designation: m.designation ?? "—",
        department: m.departmentName ?? "—",
        photoUrl: m.photoUrl,
        relation: m.relation,
        status: category,
        checkIn: rec?.checkIn ?? null,
        checkOut: rec?.checkOut ?? null,
        shiftName: shift?.name ?? null,
        shiftStart,
        shiftEnd,
        lateByMin,
        earlyOutMin,
        workedMin,
      };
    });

    return res.json({
      date: todayStart,
      holiday: ctx.isHoliday ? ctx.holidayTitle : null,
      summary,
      // Counted here rather than in the browser so the tile and the table can
      // never disagree about what "late" means.
      lateCount,
      earlyOutCount,
      rosteredCount: shiftByEmp.size,
      rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 3. ATTENDANCE WEEKLY — the donut + the trend bars
// GET /api/manager/attendance-weekly?weeks=4
// ═══════════════════════════════════════════════════════════
export const getAttendanceWeekly = async (req: Request, res: Response) => {
  try {
    const scope = await scopeFor(req);
    if (!scope) return res.status(401).json(UNAUTHORIZED);
    if (scope.isEmpty) return res.json({ weeks: [], overall: { present: 0, leave: 0, absent: 0 } });

    const weeksBack = Math.min(Math.max(Number(req.query.weeks) || 4, 1), 12);
    const ids = scope.employeeIds;
    const rangeStart = startOfDayIST(startOfWeek(addDays(new Date(), -7 * (weeksBack - 1)), { weekStartsOn: 1 }));
    const rangeEnd = endOfDayIST();

    const attendance = await prisma.attendance.findMany({
      where: { employeeId: { in: ids }, date: { gte: rangeStart, lte: rangeEnd } },
      select: { employeeId: true, date: true, status: true },
    });

    // Bucket by week. Only rows that exist are counted here — a missing row is
    // an absence only after holiday/week-off elimination, which is a per-day
    // query, so the weekly view reports what was actually recorded and leaves
    // the "why is there no row" question to the daily view.
    const buckets = new Map<string, { label: string; present: number; leave: number; permission: number; absent: number }>();
    for (let i = weeksBack - 1; i >= 0; i--) {
      const ws = startOfWeek(addDays(new Date(), -7 * i), { weekStartsOn: 1 });
      buckets.set(format(ws, "yyyy-MM-dd"), {
        label: format(ws, "dd MMM"),
        present: 0, leave: 0, permission: 0, absent: 0,
      });
    }

    for (const a of attendance) {
      const key = format(startOfWeek(new Date(a.date), { weekStartsOn: 1 }), "yyyy-MM-dd");
      const b = buckets.get(key);
      if (!b) continue;
      const st = normalizeAttendanceStatus(a.status);
      if (st === "PRESENT" || st === "HALF_DAY") b.present++;
      else if (st === "LEAVE") b.leave++;
      else if (st === "PERMISSION") b.permission++;
      else if (st === "ABSENT") b.absent++;
    }

    const weeks = Array.from(buckets.values());
    const overall = weeks.reduce(
      (acc, w) => ({
        present: acc.present + w.present,
        leave: acc.leave + w.leave,
        permission: acc.permission + w.permission,
        absent: acc.absent + w.absent,
      }),
      { present: 0, leave: 0, permission: 0, absent: 0 },
    );

    return res.json({ weeks, overall });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 4. PENDING APPROVALS — the manager's actual inbox
// GET /api/manager/pending-approvals
// ═══════════════════════════════════════════════════════════

/**
 * Leave / permission are three-tier. This manager is the NEXT approver only if:
 *   • they hold the person as In-charge and the in-charge box is still PENDING, or
 *   • they hold them as HOD and either there is no in-charge, or the in-charge
 *     has already approved.
 * Skipping that second condition is what makes a naive "hodDecision = PENDING"
 * count show an HOD work that is not yet theirs.
 */
function approverFilter(scope: TeamScope) {
  const inchargeIds = scope.members.filter((m) => m.relation === "INCHARGE").map((m) => m.id);
  const hodIds = scope.members.filter((m) => m.relation === "HOD").map((m) => m.id);
  return { inchargeIds, hodIds };
}

async function pendingLeave(scope: TeamScope) {
  const { inchargeIds, hodIds } = approverFilter(scope);
  const or: any[] = [];
  if (inchargeIds.length) {
    or.push({ employeeId: { in: inchargeIds }, inChargeDecision: "PENDING" });
  }
  if (hodIds.length) {
    or.push({
      employeeId: { in: hodIds },
      hodDecision: "PENDING",
      OR: [
        { employee: { inchargeId: null } },
        { inChargeDecision: "APPROVED" },
      ],
    });
  }
  if (!or.length) return [];
  return prisma.leaveRequest.findMany({
    where: { status: "PENDING", OR: or },
    select: {
      id: true, employeeId: true, startDate: true, endDate: true, reason: true,
      isHalfDay: true, createdAt: true,
      leaveType: { select: { name: true } },
    },
    orderBy: { startDate: "asc" },
    take: 100,
  });
}

async function pendingPermission(scope: TeamScope) {
  const { inchargeIds, hodIds } = approverFilter(scope);
  const or: any[] = [];
  if (inchargeIds.length) {
    or.push({ employeeId: { in: inchargeIds }, inChargeDecision: "PENDING" });
  }
  if (hodIds.length) {
    or.push({
      employeeId: { in: hodIds },
      hodDecision: "PENDING",
      OR: [
        { employee: { inchargeId: null } },
        { inChargeDecision: "APPROVED" },
      ],
    });
  }
  if (!or.length) return [];
  return prisma.permissionRequest.findMany({
    where: { status: "PENDING", OR: or },
    select: {
      id: true, employeeId: true, day: true, startTime: true, endTime: true,
      reason: true, permissionType: true, createdAt: true,
    },
    orderBy: { day: "asc" },
    take: 100,
  });
}

/**
 * Weekly performance reports. Same two-tier rule as leave — the tracker's
 * approve handler refuses an HOD decision while `inChargeDecision !== APPROVED`
 * (weekly-tracker.controller), so the queue has to mirror it.
 */
async function pendingWeeklyReports(scope: TeamScope) {
  const { inchargeIds, hodIds } = approverFilter(scope);
  const or: any[] = [];
  if (inchargeIds.length) {
    or.push({ employeeId: { in: inchargeIds }, inChargeDecision: "PENDING" });
  }
  if (hodIds.length) {
    or.push({
      employeeId: { in: hodIds },
      hodDecision: "PENDING",
      OR: [{ employee: { inchargeId: null } }, { inChargeDecision: "APPROVED" }],
    });
  }
  if (!or.length) return [];
  return prisma.weeklyPerformanceReport.findMany({
    where: { status: "SUBMITTED", OR: or },
    select: {
      id: true, employeeId: true, weekStartDate: true, weekEndDate: true,
      weekLabel: true, employeeSummary: true, submittedAt: true,
    },
    orderBy: { weekStartDate: "desc" },
    take: 100,
  });
}

/**
 * Roster/shift plans awaiting the reporting manager. The RM step exists ONLY
 * for employees who have an in-charge — shift.controller returns "RM approval
 * not required" otherwise — so `hasIncharge` is part of the queue, not an
 * optimisation.
 */
async function pendingRoster(scope: TeamScope) {
  return prisma.shiftApproval.findMany({
    where: {
      status: "PENDING",
      hasIncharge: true,
      rmDecision: "PENDING",
      employeeId: { in: scope.employeeIds },
    },
    select: {
      id: true, employeeId: true, month: true, year: true, startDate: true,
      requestedAt: true, requestedMode: true, isMonthly: true,
    },
    orderBy: { requestedAt: "asc" },
    take: 100,
  });
}

/** Resignations waiting on the manager's decision — stage one of the exit. */
async function pendingResignations(scope: TeamScope) {
  return prisma.resignationRequest.findMany({
    where: {
      managerDecision: "PENDING",
      status: { in: ["SUBMITTED", "UNDER_REVIEW", "ON_HOLD"] },
      OR: [{ managerId: scope.managerId }, { employeeId: { in: scope.employeeIds } }],
    },
    select: {
      id: true, employeeId: true, reason: true, noticePeriodDays: true,
      proposedLastWorkingDay: true, status: true, createdAt: true,
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

/**
 * OT is a single manager step, but "pending" means two different things by
 * source and the two must be matched separately:
 *
 *  - AUTO / MANUAL: derived from a punch, awaiting managerStatus. The
 *    `minutes > 60` floor matches the manager queue in dashboard.controller —
 *    anything shorter never reaches a human there, so counting it would show
 *    work that cannot be actioned.
 *  - EMPLOYEE_REQUEST: raised in advance and awaiting a decision, so it sits at
 *    status REQUESTED with minutes still 0. The minutes floor would hide every
 *    one of them.
 */
async function pendingOt(scope: TeamScope) {
  return prisma.overtimeApproval.findMany({
    where: {
      employeeId: { in: scope.employeeIds },
      OR: [
        { source: { not: "EMPLOYEE_REQUEST" }, managerStatus: "PENDING", minutes: { gt: 60 } },
        { source: "EMPLOYEE_REQUEST", status: "REQUESTED" },
      ],
    } as any,
    select: {
      id: true, employeeId: true, date: true, minutes: true, expectedMinutes: true,
      taskDescription: true, source: true, scheduledEnd: true, checkOut: true,
    },
    orderBy: { date: "desc" },
    take: 100,
  });
}

/** Comp-off: PENDING_MANAGER, either routed to this manager or raised by a report. */
async function pendingCompOff(scope: TeamScope) {
  return prisma.compOffRequest.findMany({
    where: {
      status: "PENDING_MANAGER",
      OR: [
        { managerId: scope.managerId },
        { employeeId: { in: scope.employeeIds } },
      ],
    },
    select: {
      id: true, employeeId: true, workDate: true, qualifier: true,
      workedMinutes: true, shiftMinutes: true, reason: true, createdAt: true,
    },
    orderBy: { workDate: "asc" },
    take: 100,
  });
}

/**
 * Manpower requisitions awaiting the HOD signature.
 *
 * Scoped by DEPARTMENT, not by manager — and that is a real limitation worth
 * knowing: ManpowerRequisition carries no managerId. `approvedByHoDEmpId` is
 * only stamped once someone has already approved, so it cannot identify who is
 * being waited on. The queue is therefore "RAISED requisitions in my
 * department", which is right for a single HOD per department and slightly wide
 * where a department has several.
 */
async function pendingRequisitions(scope: TeamScope, deptId: number | null) {
  if (!deptId) return [];
  return prisma.manpowerRequisition.findMany({
    where: { status: "RAISED", departmentId: deptId },
    select: {
      id: true, designation: true, vacancies: true, reasonType: true,
      reasonDetails: true, urgent: true, requestDate: true, raisedBy: true,
      createdAt: true,
    },
    orderBy: [{ urgent: "desc" }, { requestDate: "asc" }],
    take: 100,
  });
}

const EMPTY_APPROVAL_COUNTS = {
  total: 0, leave: 0, permission: 0, ot: 0, compOff: 0,
  weeklyReports: 0, roster: 0, resignation: 0, requisition: 0,
};

/** Every queue at once. One place, so the tile and the inbox can never disagree. */
async function allPendingApprovals(scope: TeamScope, deptId: number | null = null) {
  const [leave, permission, ot, compOff, weeklyReports, roster, resignation, requisition] = await Promise.all([
    pendingLeave(scope),
    pendingPermission(scope),
    pendingOt(scope),
    pendingCompOff(scope),
    pendingWeeklyReports(scope),
    pendingRoster(scope),
    pendingResignations(scope),
    pendingRequisitions(scope, deptId),
  ]);
  const counts = {
    leave: leave.length,
    permission: permission.length,
    ot: ot.length,
    compOff: compOff.length,
    weeklyReports: weeklyReports.length,
    roster: roster.length,
    resignation: resignation.length,
    requisition: requisition.length,
    total:
      leave.length + permission.length + ot.length + compOff.length +
      weeklyReports.length + roster.length + resignation.length + requisition.length,
  };
  return { counts, leave, permission, ot, compOff, weeklyReports, roster, resignation, requisition };
}

export const getPendingApprovals = async (req: Request, res: Response) => {
  try {
    const scope = await scopeFor(req);
    if (!scope) return res.status(401).json(UNAUTHORIZED);
    if (scope.isEmpty) {
      return res.json({
        counts: EMPTY_APPROVAL_COUNTS,
        leave: [], permission: [], ot: [], compOff: [],
        weeklyReports: [], roster: [], resignation: [], requisition: [],
      });
    }

    const { counts, leave, permission, ot, compOff, weeklyReports, roster, resignation, requisition } =
      await allPendingApprovals(scope, currentDeptId(req as any));

    // One shared decorator: every queue is keyed by employeeId and the team is
    // already in memory, so nothing here goes back to the DB for names.
    const decorate = <T extends { employeeId: number }>(rows: T[]) =>
      rows.map((r) => {
        const m = scope.byId.get(r.employeeId);
        return {
          ...r,
          employeeName: m?.name ?? "—",
          employeeCode: m?.employeeCode ?? "—",
          designation: m?.designation ?? "—",
          photoUrl: m?.photoUrl ?? null,
          relation: m?.relation ?? null,
        };
      });

    return res.json({
      counts,
      leave: decorate(leave),
      permission: decorate(permission),
      ot: decorate(ot),
      compOff: decorate(compOff),
      weeklyReports: decorate(weeklyReports),
      roster: decorate(roster),
      resignation: decorate(resignation),
      // Requisitions are department-level, not per-employee, so they carry no
      // employee to decorate — the raiser's name is on the row already.
      requisition,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 8. PERFORMANCE TREND — weekly team average + per-person latest
// GET /api/manager/performance-trend?weeks=8
// ═══════════════════════════════════════════════════════════
export const getPerformanceTrend = async (req: Request, res: Response) => {
  try {
    const scope = await scopeFor(req);
    if (!scope) return res.status(401).json(UNAUTHORIZED);
    if (scope.isEmpty) {
      return res.json({ scoreScaleMax: 100, weeks: [], members: [], unrated: [], topPerformers: [] });
    }

    const weeksBack = Math.min(Math.max(Number(req.query.weeks) || 8, 1), 26);
    const since = addDays(new Date(), -7 * weeksBack);

    const ratings = await prisma.weeklyPerformanceRating.findMany({
      where: {
        employeeId: { in: scope.employeeIds },
        weekStartDate: { gte: since },
        status: "SUBMITTED",
        overallScore: { not: null },
        // Manager-given ratings only — the self-assessment is a separate row.
        raterType: "MANAGER",
      },
      select: {
        employeeId: true, weekStartDate: true, weekLabel: true,
        overallScore: true, raterType: true, managerRemarks: true,
      },
      orderBy: { weekStartDate: "asc" },
    });

    const weekMap = new Map<string, { label: string; scores: number[] }>();
    const latestByEmp = new Map<number, { score: number; weekStart: Date; remarks: string | null }>();

    for (const r of ratings) {
      const key = format(new Date(r.weekStartDate), "yyyy-MM-dd");
      const label = r.weekLabel || format(new Date(r.weekStartDate), "dd MMM");
      if (!weekMap.has(key)) weekMap.set(key, { label, scores: [] });
      weekMap.get(key)!.scores.push(r.overallScore!);

      // Rows arrive oldest-first, so the last write per employee is the latest.
      latestByEmp.set(r.employeeId, {
        score: r.overallScore!,
        weekStart: r.weekStartDate,
        remarks: r.managerRemarks ?? null,
      });
    }

    const weeks = Array.from(weekMap.values()).map((v) => ({
      label: v.label,
      avgScore: Math.round((v.scores.reduce((s, x) => s + x, 0) / v.scores.length) * 100) / 100,
      rated: v.scores.length,
    }));

    const members = scope.members.map((m) => {
      const latest = latestByEmp.get(m.id);
      return {
        employeeId: m.id,
        name: m.name,
        employeeCode: m.employeeCode,
        designation: m.designation ?? "—",
        photoUrl: m.photoUrl,
        relation: m.relation,
        latestScore: latest?.score ?? null,
        latestWeek: latest?.weekStart ?? null,
        remarks: latest?.remarks ?? null,
      };
    });

    // Top performers are ranked on the AVERAGE across the window, not on the
    // single latest week — one good week is noise, and a manager naming the top
    // five off a lucky week is exactly the failure this is meant to avoid.
    const avgByEmp = new Map<number, { total: number; n: number }>();
    for (const r of ratings) {
      const e = avgByEmp.get(r.employeeId) ?? { total: 0, n: 0 };
      e.total += r.overallScore!;
      e.n += 1;
      avgByEmp.set(r.employeeId, e);
    }
    const topPerformers = [...avgByEmp.entries()]
      .map(([employeeId, v]) => {
        const m = scope.byId.get(employeeId);
        return {
          employeeId,
          name: m?.name ?? "—",
          employeeCode: m?.employeeCode ?? "—",
          designation: m?.designation ?? "—",
          photoUrl: m?.photoUrl ?? null,
          avgScore: Math.round((v.total / v.n) * 100) / 100,
          weeksRated: v.n,
          latestScore: latestByEmp.get(employeeId)?.score ?? null,
        };
      })
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 5);

    return res.json({
      // 0–100 — see the note on team-snapshot.
      scoreScaleMax: 100,
      weeks,
      members: members.filter((m) => m.latestScore != null),
      unrated: members.filter((m) => m.latestScore == null),
      topPerformers,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 6. ROSTER — shift assignments for the team, one week at a time
// GET /api/manager/roster?from=YYYY-MM-DD&to=YYYY-MM-DD
// ═══════════════════════════════════════════════════════════
export const getRoster = async (req: Request, res: Response) => {
  try {
    const scope = await scopeFor(req);
    if (!scope) return res.status(401).json(UNAUTHORIZED);
    if (scope.isEmpty) return res.json({ from: null, to: null, days: [], rows: [] });

    const now = new Date();
    const from = req.query.from ? startOfDayIST(new Date(String(req.query.from))) : startOfDayIST(startOfWeek(now, { weekStartsOn: 1 }));
    const to = req.query.to ? endOfDayIST(new Date(String(req.query.to))) : endOfDayIST(endOfWeek(now, { weekStartsOn: 1 }));

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ error: "Invalid from/to date" });
    }

    const assignments = await prisma.shiftAssignment.findMany({
      where: { employeeId: { in: scope.employeeIds }, date: { gte: from, lte: to } },
      select: {
        employeeId: true, date: true, acknowledged: true,
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
      orderBy: { date: "asc" },
    });

    const days: string[] = [];
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) days.push(format(d, "yyyy-MM-dd"));

    const byEmp = new Map<number, Record<string, any>>();
    for (const a of assignments) {
      const key = format(new Date(a.date), "yyyy-MM-dd");
      if (!byEmp.has(a.employeeId)) byEmp.set(a.employeeId, {});
      byEmp.get(a.employeeId)![key] = {
        shiftId: a.shift?.id ?? null,
        shift: a.shift?.name ?? "—",
        startTime: a.shift?.startTime ?? null,
        endTime: a.shift?.endTime ?? null,
        acknowledged: a.acknowledged,
      };
    }

    const rows = scope.members.map((m) => ({
      employeeId: m.id,
      name: m.name,
      employeeCode: m.employeeCode,
      designation: m.designation ?? "—",
      relation: m.relation,
      shifts: byEmp.get(m.id) ?? {},
      // An unacknowledged roster is the thing a manager chases, so it is
      // surfaced as a count rather than buried in the grid.
      unacknowledged: Object.values(byEmp.get(m.id) ?? {}).filter((s: any) => !s.acknowledged).length,
    }));

    return res.json({ from, to, days, rows });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
// 9. TEAM LIST — the roster of people, for the "who reports to me" panel
// GET /api/manager/team
// ═══════════════════════════════════════════════════════════
export const getTeam = async (req: Request, res: Response) => {
  try {
    const scope = await scopeFor(req);
    if (!scope) return res.status(401).json(UNAUTHORIZED);

    return res.json({
      managerId: scope.managerId,
      count: scope.employeeIds.length,
      members: scope.members.map((m: TeamMember) => ({
        employeeId: m.id,
        name: m.name,
        employeeCode: m.employeeCode,
        designation: m.designation ?? "—",
        department: m.departmentName ?? "—",
        photoUrl: m.photoUrl,
        dateOfJoining: m.dateOfJoining,
        employmentStatus: m.employmentStatus,
        probationStatus: m.probationStatus,
        probationEndDate: m.probationEndDate,
        relation: m.relation,
      })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};
