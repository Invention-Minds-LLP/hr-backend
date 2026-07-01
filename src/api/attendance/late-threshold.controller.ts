import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";

// Monthly cumulative-late threshold (minutes). Once an employee's total late
// minutes for the month cross this, they (and HR + their reporting manager) are
// notified once for that month.
const LATE_THRESHOLD_MIN = 120;

// [start, end) instants + a "YYYY-MM" label for a given 1-based year/month.
function monthRange(y: number, mo1: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const nextY = mo1 === 12 ? y + 1 : y;
  const nextMo1 = mo1 === 12 ? 1 : mo1 + 1;
  return {
    start: new Date(`${y}-${pad(mo1)}-01T00:00:00+05:30`),
    end: new Date(`${nextY}-${pad(nextMo1)}-01T00:00:00+05:30`),
    yearMonth: `${y}-${pad(mo1)}`,
  };
}

// Current IST month.
function istMonthInfo(now: Date = new Date()) {
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return monthRange(ist.getFullYear(), ist.getMonth() + 1);
}

const fmtMins = (m: number): string => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}h ${mm}m` : `${mm}m`;
};

/**
 * Notify employees whose cumulative late minutes for the current month have
 * crossed LATE_THRESHOLD_MIN. The employee is told to meet HR; HR (managers +
 * dept-1 executives) and the employee's reporting manager get an informational
 * alert. A LateThresholdNotice row dedupes so each employee is alerted only
 * once per month. Intended to run daily.
 */
export async function runMonthlyLateThresholdCheck(): Promise<{ notified: number }> {
  const { start, end, yearMonth } = istMonthInfo();

  // Sum this month's late minutes per employee.
  const grouped = await prisma.lateLoginLog.groupBy({
    by: ["employeeId"],
    where: { date: { gte: start, lt: end } },
    _sum: { lateMinutes: true },
  });
  const overThreshold = grouped.filter(g => (g._sum.lateMinutes ?? 0) >= LATE_THRESHOLD_MIN);
  if (!overThreshold.length) return { notified: 0 };

  const empIds = overThreshold.map(g => g.employeeId);

  // Skip anyone already alerted this month.
  const existingNotices = await prisma.lateThresholdNotice.findMany({
    where: { yearMonth, employeeId: { in: empIds } },
    select: { employeeId: true },
  });
  const alreadyNotified = new Set(existingNotices.map(n => n.employeeId));

  const employees = await prisma.employee.findMany({
    where: { id: { in: empIds }, employmentStatus: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true, reportingManager: true },
  });
  const empById = new Map(employees.map(e => [e.id, e]));

  // HR receives the info alert: HR managers (roleId 1) plus HR executives
  // (department 1, roleId 2), all active.
  const hrStaff = await prisma.employee.findMany({
    where: {
      employmentStatus: "ACTIVE",
      OR: [
        { roleId: 1 },
        { departmentId: 1, roleId: 2 },
      ],
    },
    select: { id: true },
  });
  const hrIds = hrStaff.map(h => h.id);

  let notified = 0;
  for (const g of overThreshold) {
    const emp = empById.get(g.employeeId);
    if (!emp || alreadyNotified.has(g.employeeId)) continue;

    const totalLate = g._sum.lateMinutes ?? 0;
    const name = `${emp.firstName} ${emp.lastName}`;
    const pretty = fmtMins(totalLate);
    const title = "⏰ Attendance Alert";

    // Employee — told to meet HR.
    await createNotification(
      emp.id,
      `⏰ You have been late by a total of ${pretty} this month. Please meet HR.`,
      title,
    );

    // HR staff — informational.
    for (const hrId of hrIds) {
      await createNotification(
        hrId,
        `⏰ ${name} has been late by ${pretty} this month (over the ${LATE_THRESHOLD_MIN}-min limit). They have been asked to meet you.`,
        title,
      );
    }

    // Reporting manager — informational.
    if (emp.reportingManager) {
      await createNotification(
        emp.reportingManager,
        `⏰ ${name} (your reportee) has been late by ${pretty} this month and has been asked to meet HR.`,
        title,
      );
    }

    await prisma.lateThresholdNotice.create({
      data: { employeeId: emp.id, yearMonth, lateMinutes: totalLate },
    });
    notified++;
  }

  return { notified };
}
