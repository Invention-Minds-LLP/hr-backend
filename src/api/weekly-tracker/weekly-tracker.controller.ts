import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";

// ── Helper: ISO week label (e.g. "2026-W14") ──────────────────────────────────
function getWeekLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// ── Helper: get employee name map ──────────────────────────────────────────────
async function getEmployeeMap(): Promise<Map<number, string>> {
  const emps = await prisma.employee.findMany({
    select: { id: true, firstName: true, lastName: true },
  });
  return new Map(emps.map(e => [e.id, `${e.firstName} ${e.lastName}`]));
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE WEEKLY REPORT
// ═══════════════════════════════════════════════════════════════════════════════
export const createWeeklyReport = async (req: Request, res: Response) => {
  try {
    const { employeeId, weekStartDate, weekEndDate, employeeSummary } = req.body;

    if (!employeeId || !weekStartDate || !weekEndDate) {
      return res.status(400).json({ error: "employeeId, weekStartDate, weekEndDate are required" });
    }

    const start = new Date(weekStartDate);
    const end = new Date(weekEndDate);

    const existing = await prisma.weeklyPerformanceReport.findUnique({
      where: { employeeId_weekStartDate: { employeeId: Number(employeeId), weekStartDate: start } },
    });
    if (existing) {
      return res.status(400).json({ error: "A report already exists for this employee and week" });
    }

    const report = await prisma.weeklyPerformanceReport.create({
      data: {
        employeeId: Number(employeeId),
        weekStartDate: start,
        weekEndDate: end,
        weekLabel: getWeekLabel(start),
        employeeSummary: employeeSummary || null,
      },
      include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } }, dailyTasks: true },
    });

    return res.status(201).json(report);
  } catch (error: any) {
    console.error("createWeeklyReport error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET WEEKLY REPORTS (list)
// ═══════════════════════════════════════════════════════════════════════════════
export const getWeeklyReports = async (req: Request, res: Response) => {
  try {
    const { employeeId, departmentId, status, weekStartDate, weekEndDate, page, limit } = req.query;

    const where: any = {};
    if (employeeId) where.employeeId = Number(employeeId);
    if (status) where.status = String(status);
    if (departmentId) where.employee = { departmentId: Number(departmentId) };
    if (weekStartDate || weekEndDate) {
      where.weekStartDate = {};
      if (weekStartDate) where.weekStartDate.gte = new Date(String(weekStartDate));
      if (weekEndDate) where.weekStartDate.lte = new Date(String(weekEndDate));
    }

    const take = Number(limit) || 20;
    const skip = ((Number(page) || 1) - 1) * take;

    const [reports, total] = await Promise.all([
      prisma.weeklyPerformanceReport.findMany({
        where,
        include: {
          employee: {
            select: {
              employeeCode: true, firstName: true, lastName: true,
              Department: { select: { name: true } },
              designation: { select: { name: true } },
            },
          },
          _count: { select: { dailyTasks: true } },
        },
        orderBy: { weekStartDate: "desc" },
        take,
        skip,
      }),
      prisma.weeklyPerformanceReport.count({ where }),
    ]);

    return res.json({ data: reports, total, page: Number(page) || 1, limit: take });
  } catch (error: any) {
    console.error("getWeeklyReports error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET SINGLE REPORT BY ID
// ═══════════════════════════════════════════════════════════════════════════════
export const getWeeklyReportById = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const empMap = await getEmployeeMap();

    const report = await prisma.weeklyPerformanceReport.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            employeeCode: true, firstName: true, lastName: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } },
            inchargeId: true, reportingManager: true, roleId: true, departmentId: true,
          },
        },
        dailyTasks: { orderBy: [{ taskDate: "asc" }, { createdAt: "asc" }] },
      },
    });

    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }

    const tasksWithAssignerName = report.dailyTasks.map(t => ({
      ...t,
      assignedByName: t.assignedById ? (empMap.get(t.assignedById) ?? null) : null,
    }));

    return res.json({ ...report, dailyTasks: tasksWithAssignerName });
  } catch (error: any) {
    console.error("getWeeklyReportById error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE WEEKLY REPORT (DRAFT only)
// ═══════════════════════════════════════════════════════════════════════════════
export const updateWeeklyReport = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const report = await prisma.weeklyPerformanceReport.findUnique({ where: { id } });

    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.status !== "DRAFT") return res.status(400).json({ error: "Can only edit DRAFT reports" });

    const { employeeSummary, weekStartDate, weekEndDate } = req.body;
    const data: any = {};
    if (employeeSummary !== undefined) data.employeeSummary = employeeSummary;
    if (weekStartDate) {
      data.weekStartDate = new Date(weekStartDate);
      data.weekLabel = getWeekLabel(new Date(weekStartDate));
    }
    if (weekEndDate) data.weekEndDate = new Date(weekEndDate);

    const updated = await prisma.weeklyPerformanceReport.update({
      where: { id },
      data,
      include: { dailyTasks: true },
    });

    return res.json(updated);
  } catch (error: any) {
    console.error("updateWeeklyReport error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SUBMIT WEEKLY REPORT (DRAFT -> SUBMITTED)
// ═══════════════════════════════════════════════════════════════════════════════
export const submitWeeklyReport = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const report = await prisma.weeklyPerformanceReport.findUnique({
      where: { id },
      include: {
        employee: { select: { firstName: true, lastName: true, inchargeId: true, reportingManager: true } },
        _count: { select: { dailyTasks: true } },
      },
    });

    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.status !== "DRAFT") return res.status(400).json({ error: "Only DRAFT reports can be submitted" });
    if (report._count.dailyTasks === 0) return res.status(400).json({ error: "Add at least one task before submitting" });

    const updated = await prisma.weeklyPerformanceReport.update({
      where: { id },
      data: { status: "SUBMITTED", submittedAt: new Date() },
      include: { dailyTasks: true },
    });

    // Notify approver
    const empName = `${report.employee.firstName} ${report.employee.lastName}`;
    const notifyId = report.employee.inchargeId || report.employee.reportingManager;
    if (notifyId) {
      await createNotification(
        notifyId,
        `${empName} has submitted weekly performance report (${updated.weekLabel}) for your review.`
      );
    }

    return res.json(updated);
  } catch (error: any) {
    console.error("submitWeeklyReport error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE REPORT STATUS (3-level approval: INCHARGE -> HOD -> HR)
// ═══════════════════════════════════════════════════════════════════════════════
export const updateWeeklyReportStatus = async (req: Request, res: Response) => {
  try {
    const reportId = Number(req.params.id);
    const { role, status, userId, declineReason, rating, note } = req.body as {
      role: "INCHARGE" | "REPORTING_MANAGER" | "HR_MANAGER" | "MANAGEMENT";
      status: "Approved" | "Declined";
      userId?: number;
      declineReason?: string;
      rating?: number;
      note?: string;
    };

    if (!reportId || !role || !status) {
      return res.status(400).json({ error: "id, role, status are required" });
    }
    if (!["Approved", "Declined"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const approved = status === "Approved";

    const report = await prisma.weeklyPerformanceReport.findUnique({
      where: { id: reportId },
      include: { employee: true },
    });

    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.status === "APPROVED" || report.status === "REJECTED") {
      return res.status(400).json({ error: "Report already finalized" });
    }
    if (report.status === "DRAFT") {
      return res.status(400).json({ error: "Report must be submitted first" });
    }

    const emp = report.employee;
    const roleId = emp.roleId;
    const deptId = emp.departmentId;
    const isHRDept = deptId === 1;
    const hasIncharge = !!emp.inchargeId;

    const data: any = {};

    // ── INCHARGE LEVEL ─────────────────────────────────────────────────────
    if (hasIncharge && role === "INCHARGE") {
      data.inChargeDecision = approved ? "APPROVED" : "REJECTED";
      data.inChargeDecidedAt = new Date();
      data.inChargeNote = note || null;
      if (rating) data.inChargeRating = rating;

      if (!approved) {
        data.status = "REJECTED";
        data.declinedBy = userId ?? null;
        data.declinedDate = new Date();
        data.declineReason = declineReason || null;
      } else {
        // Notify reporting manager
        if (emp.reportingManager) {
          const empName = `${emp.firstName} ${emp.lastName}`;
          await createNotification(
            emp.reportingManager,
            `Weekly performance report of ${empName} (${report.weekLabel}) has been approved by incharge and is pending your review.`
          );
        }
      }

      const updated = await prisma.weeklyPerformanceReport.update({
        where: { id: reportId }, data,
        include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } }, dailyTasks: true },
      });
      return res.json(updated);
    }

    // Block others until incharge approves
    if (hasIncharge && report.inChargeDecision !== "APPROVED") {
      return res.status(400).json({ error: "Incharge approval required first" });
    }

    // ── HR EMPLOYEE (dept=1, roleId != 1) → HR_MANAGER final ─────────────
    if (isHRDept && roleId !== 1) {
      if (role !== "HR_MANAGER") {
        return res.status(400).json({ error: "Only HR Manager can approve HR employees" });
      }
      data.hodDecision = approved ? "APPROVED" : "REJECTED";
      data.hodDecidedAt = new Date();
      data.hrDecision = approved ? "APPROVED" : "REJECTED";
      data.hrDecidedAt = new Date();
      data.hrNote = note || null;
      if (rating) data.hrRating = rating;
      data.status = approved ? "APPROVED" : "REJECTED";

      if (approved) {
        data.approvedBy = userId ?? null;
        data.approvedDate = new Date();
      } else {
        data.declinedBy = userId ?? null;
        data.declinedDate = new Date();
        data.declineReason = declineReason || null;
      }
    }

    // ── HR MANAGER (roleId=1) → MANAGEMENT final ────────────────────────
    else if (roleId === 1) {
      if (role !== "MANAGEMENT") {
        return res.status(400).json({ error: "Only Management can approve HR Manager reports" });
      }
      data.hodDecision = approved ? "APPROVED" : "REJECTED";
      data.hodDecidedAt = new Date();
      data.hrDecision = approved ? "APPROVED" : "REJECTED";
      data.hrDecidedAt = new Date();
      data.hodNote = note || null;
      if (rating) data.hodRating = rating;
      data.status = approved ? "APPROVED" : "REJECTED";

      if (approved) {
        data.approvedBy = userId ?? null;
        data.approvedDate = new Date();
      } else {
        data.declinedBy = userId ?? null;
        data.declinedDate = new Date();
        data.declineReason = declineReason || null;
      }
    }

    // ── HOD / SENIOR HOD (roleId 3 or 5) ────────────────────────────────
    else if (roleId === 3 || roleId === 5) {
      if (role === "MANAGEMENT") {
        data.hodDecision = approved ? "APPROVED" : "REJECTED";
        data.hodDecidedAt = new Date();
        data.hodNote = note || null;
        if (rating) data.hodRating = rating;

        if (!approved) {
          data.status = "REJECTED";
          data.declinedBy = userId ?? null;
          data.declinedDate = new Date();
          data.declineReason = declineReason || null;
        }
      } else if (role === "HR_MANAGER") {
        if (report.hodDecision !== "APPROVED") {
          return res.status(400).json({ error: "Management approval required first" });
        }
        data.hrDecision = approved ? "APPROVED" : "REJECTED";
        data.hrDecidedAt = new Date();
        data.hrNote = note || null;
        if (rating) data.hrRating = rating;
        data.status = approved ? "APPROVED" : "REJECTED";

        if (approved) {
          data.approvedBy = userId ?? null;
          data.approvedDate = new Date();
        } else {
          data.declinedBy = userId ?? null;
          data.declinedDate = new Date();
          data.declineReason = declineReason || null;
        }
      } else {
        return res.status(400).json({ error: "Invalid approver for HOD/Senior HOD" });
      }
    }

    // ── NORMAL EMPLOYEE (roleId=2) ──────────────────────────────────────
    else if (roleId === 2) {
      if (role === "REPORTING_MANAGER") {
        data.hodDecision = approved ? "APPROVED" : "REJECTED";
        data.hodDecidedAt = new Date();
        data.hodNote = note || null;
        if (rating) data.hodRating = rating;

        if (!approved) {
          data.status = "REJECTED";
          data.declinedBy = userId ?? null;
          data.declinedDate = new Date();
          data.declineReason = declineReason || null;
        }
      } else if (role === "HR_MANAGER") {
        if (report.hodDecision !== "APPROVED") {
          return res.status(400).json({ error: "Manager approval required first" });
        }
        data.hrDecision = approved ? "APPROVED" : "REJECTED";
        data.hrDecidedAt = new Date();
        data.hrNote = note || null;
        if (rating) data.hrRating = rating;
        data.status = approved ? "APPROVED" : "REJECTED";

        if (approved) {
          data.approvedBy = userId ?? null;
          data.approvedDate = new Date();
        } else {
          data.declinedBy = userId ?? null;
          data.declinedDate = new Date();
          data.declineReason = declineReason || null;
        }
      } else {
        return res.status(400).json({ error: "Invalid approver for Employee" });
      }
    }

    const updated = await prisma.weeklyPerformanceReport.update({
      where: { id: reportId }, data,
      include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } }, dailyTasks: true },
    });

    // Notify employee on final decision
    if (data.status === "APPROVED" || data.status === "REJECTED") {
      await createNotification(
        report.employeeId,
        `Your weekly performance report (${report.weekLabel}) has been ${data.status.toLowerCase()}.`
      );
    }

    return res.json(updated);
  } catch (error: any) {
    console.error("updateWeeklyReportStatus error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE WEEKLY REPORT (DRAFT only)
// ═══════════════════════════════════════════════════════════════════════════════
export const deleteWeeklyReport = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const report = await prisma.weeklyPerformanceReport.findUnique({ where: { id } });

    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.status !== "DRAFT") return res.status(400).json({ error: "Can only delete DRAFT reports" });

    await prisma.weeklyPerformanceReport.delete({ where: { id } });
    return res.json({ message: "Report deleted" });
  } catch (error: any) {
    console.error("deleteWeeklyReport error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ADD TASK ENTRY
// ═══════════════════════════════════════════════════════════════════════════════
export const addTaskEntry = async (req: Request, res: Response) => {
  try {
    const reportId = Number(req.params.id);
    const report = await prisma.weeklyPerformanceReport.findUnique({ where: { id: reportId } });

    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.status !== "DRAFT") return res.status(400).json({ error: "Can only add tasks to DRAFT reports" });

    const {
      taskDate, taskDescription, category, priority, taskStatus,
      percentComplete, assignedById, deadline, completionDate, remarks,
      isCarriedForward, carriedFromEntryId,
    } = req.body;

    if (!taskDate || !taskDescription) {
      return res.status(400).json({ error: "taskDate and taskDescription are required" });
    }

    const task = await prisma.weeklyTaskEntry.create({
      data: {
        reportId,
        taskDate: new Date(taskDate),
        taskDescription,
        category: category || null,
        priority: priority || "MEDIUM",
        taskStatus: taskStatus || "NOT_STARTED",
        percentComplete: percentComplete ?? 0,
        assignedById: assignedById ? Number(assignedById) : null,
        deadline: deadline ? new Date(deadline) : null,
        completionDate: completionDate ? new Date(completionDate) : null,
        remarks: remarks || null,
        isCarriedForward: isCarriedForward || false,
        carriedFromEntryId: carriedFromEntryId ? Number(carriedFromEntryId) : null,
      },
    });

    return res.status(201).json(task);
  } catch (error: any) {
    console.error("addTaskEntry error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE TASK ENTRY
// ═══════════════════════════════════════════════════════════════════════════════
export const updateTaskEntry = async (req: Request, res: Response) => {
  try {
    const taskId = Number(req.params.taskId);
    const task = await prisma.weeklyTaskEntry.findUnique({
      where: { id: taskId },
      include: { report: { select: { status: true } } },
    });

    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.report.status !== "DRAFT") return res.status(400).json({ error: "Can only edit tasks in DRAFT reports" });

    const {
      taskDate, taskDescription, category, priority, taskStatus,
      percentComplete, assignedById, deadline, completionDate, remarks,
    } = req.body;

    const data: any = {};
    if (taskDate !== undefined) data.taskDate = new Date(taskDate);
    if (taskDescription !== undefined) data.taskDescription = taskDescription;
    if (category !== undefined) data.category = category;
    if (priority !== undefined) data.priority = priority;
    if (taskStatus !== undefined) {
      data.taskStatus = taskStatus;
      if (taskStatus === "COMPLETED") {
        data.percentComplete = 100;
        if (!completionDate) data.completionDate = new Date();
      }
    }
    if (percentComplete !== undefined) data.percentComplete = percentComplete;
    if (assignedById !== undefined) data.assignedById = assignedById ? Number(assignedById) : null;
    if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
    if (completionDate !== undefined) data.completionDate = completionDate ? new Date(completionDate) : null;
    if (remarks !== undefined) data.remarks = remarks;

    const updated = await prisma.weeklyTaskEntry.update({ where: { id: taskId }, data });
    return res.json(updated);
  } catch (error: any) {
    console.error("updateTaskEntry error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE TASK ENTRY
// ═══════════════════════════════════════════════════════════════════════════════
export const deleteTaskEntry = async (req: Request, res: Response) => {
  try {
    const taskId = Number(req.params.taskId);
    const task = await prisma.weeklyTaskEntry.findUnique({
      where: { id: taskId },
      include: { report: { select: { status: true } } },
    });

    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.report.status !== "DRAFT") return res.status(400).json({ error: "Can only delete tasks from DRAFT reports" });

    await prisma.weeklyTaskEntry.delete({ where: { id: taskId } });
    return res.json({ message: "Task deleted" });
  } catch (error: any) {
    console.error("deleteTaskEntry error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CARRY FORWARD INCOMPLETE TASKS TO NEXT WEEK
// ═══════════════════════════════════════════════════════════════════════════════
export const carryForwardTasks = async (req: Request, res: Response) => {
  try {
    const fromReportId = Number(req.params.id);
    const { toReportId, taskEntryIds } = req.body as { toReportId?: number; taskEntryIds?: number[] };

    const fromReport = await prisma.weeklyPerformanceReport.findUnique({
      where: { id: fromReportId },
      include: { dailyTasks: true },
    });

    if (!fromReport) return res.status(404).json({ error: "Source report not found" });

    // Get incomplete tasks
    let tasksToCarry = fromReport.dailyTasks.filter(
      t => t.taskStatus !== "COMPLETED" && t.taskStatus !== "CARRIED_FORWARD"
    );
    if (taskEntryIds?.length) {
      tasksToCarry = tasksToCarry.filter(t => taskEntryIds.includes(t.id));
    }
    if (tasksToCarry.length === 0) {
      return res.status(400).json({ error: "No incomplete tasks to carry forward" });
    }

    // Find or create target report
    let targetReportId = toReportId;
    if (!targetReportId) {
      const nextStart = new Date(fromReport.weekStartDate);
      nextStart.setDate(nextStart.getDate() + 7);
      const nextEnd = new Date(fromReport.weekEndDate);
      nextEnd.setDate(nextEnd.getDate() + 7);

      const existingNext = await prisma.weeklyPerformanceReport.findUnique({
        where: { employeeId_weekStartDate: { employeeId: fromReport.employeeId, weekStartDate: nextStart } },
      });

      if (existingNext) {
        targetReportId = existingNext.id;
      } else {
        const newReport = await prisma.weeklyPerformanceReport.create({
          data: {
            employeeId: fromReport.employeeId,
            weekStartDate: nextStart,
            weekEndDate: nextEnd,
            weekLabel: getWeekLabel(nextStart),
            previousWeekId: fromReportId,
          },
        });
        targetReportId = newReport.id;
      }
    }

    // Create carried-forward entries in target report
    for (const task of tasksToCarry) {
      await prisma.weeklyTaskEntry.create({
        data: {
          reportId: targetReportId,
          taskDate: task.taskDate,
          taskDescription: task.taskDescription,
          category: task.category,
          priority: task.priority,
          taskStatus: "NOT_STARTED",
          percentComplete: task.percentComplete,
          assignedById: task.assignedById,
          deadline: task.deadline,
          remarks: `Carried forward from ${fromReport.weekLabel}`,
          isCarriedForward: true,
          carriedFromEntryId: task.id,
        },
      });

      // Mark original as carried forward
      await prisma.weeklyTaskEntry.update({
        where: { id: task.id },
        data: { taskStatus: "CARRIED_FORWARD" },
      });
    }

    const targetReport = await prisma.weeklyPerformanceReport.findUnique({
      where: { id: targetReportId },
      include: { dailyTasks: true },
    });

    return res.json({ message: `${tasksToCarry.length} tasks carried forward`, targetReport });
  } catch (error: any) {
    console.error("carryForwardTasks error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
export const getTrackerDashboard = async (req: Request, res: Response) => {
  try {
    const { employeeId, departmentId } = req.query;

    const where: any = {};
    if (employeeId) where.employeeId = Number(employeeId);
    if (departmentId) where.employee = { departmentId: Number(departmentId) };

    const [draft, submitted, approved, rejected, total] = await Promise.all([
      prisma.weeklyPerformanceReport.count({ where: { ...where, status: "DRAFT" } }),
      prisma.weeklyPerformanceReport.count({ where: { ...where, status: "SUBMITTED" } }),
      prisma.weeklyPerformanceReport.count({ where: { ...where, status: "APPROVED" } }),
      prisma.weeklyPerformanceReport.count({ where: { ...where, status: "REJECTED" } }),
      prisma.weeklyPerformanceReport.count({ where }),
    ]);

    // Pending reviews (submitted but not fully approved)
    const pendingReview = await prisma.weeklyPerformanceReport.findMany({
      where: { ...where, status: "SUBMITTED" },
      include: {
        employee: {
          select: {
            employeeCode: true, firstName: true, lastName: true,
            Department: { select: { name: true } },
          },
        },
      },
      orderBy: { submittedAt: "asc" },
      take: 20,
    });

    // Recent approvals
    const recentApproved = await prisma.weeklyPerformanceReport.findMany({
      where: { ...where, status: "APPROVED" },
      include: {
        employee: {
          select: { employeeCode: true, firstName: true, lastName: true },
        },
      },
      orderBy: { approvedDate: "desc" },
      take: 10,
    });

    return res.json({
      counts: { draft, submitted, approved, rejected, total },
      pendingReview,
      recentApproved,
    });
  } catch (error: any) {
    console.error("getTrackerDashboard error:", error);
    return res.status(500).json({ error: error.message });
  }
};
