// ─────────────────────────────────────────────────────────────────────────────
//  Employee-raised overtime requests.
//
//  Until now overtime could only appear two ways: derived automatically from a
//  late check-out, or keyed in by HR. An employee could not say "I need to stay
//  back to finish X" and have it sanctioned in advance, and nobody ever
//  confirmed the work the overtime was claimed for actually got done.
//
//  The lifecycle:
//    employee raises (states the task)  → REQUESTED
//    manager approves / rejects         → APPROVED | REJECTED
//    work happens, actual minutes logged
//    manager acknowledges the outcome   → taskCompleted true / false
//
//  Approval sanctions the HOURS. Acknowledgement confirms the WORK. They are
//  deliberately separate: an approved-but-never-acknowledged claim is exactly
//  the pattern an overtime audit looks for.
// ─────────────────────────────────────────────────────────────────────────────

import { Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { currentEmployeeId } from '../../lib/currentUser';
import { createNotification } from '../notifications/notifications.controller';

const p: any = prisma;

/** Midnight of the given day, matching how OvertimeApproval.date is stored. */
function dayOf(raw: unknown): Date {
  const d = new Date(String(raw));
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0));
}

const MAX_OT_MINUTES_PER_DAY = 8 * 60;

/**
 * POST /api/overtime/requests
 * Employee raises a request. The task description is mandatory — overtime with
 * no stated purpose is what makes an OT budget unauditable.
 */
export const createOvertimeRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = currentEmployeeId(req);
    if (!employeeId) return res.status(401).json({ message: 'Unauthorized' });

    const { date, expectedMinutes, taskDescription } = req.body;

    if (!date) return res.status(400).json({ message: 'date is required' });
    if (!taskDescription?.trim()) {
      return res.status(400).json({
        message: 'Describe the task the overtime is for — it is what your manager approves against.',
      });
    }

    const minutes = Number(expectedMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return res.status(400).json({ message: 'Enter the expected overtime in minutes' });
    }
    if (minutes > MAX_OT_MINUTES_PER_DAY) {
      return res.status(400).json({
        message: `Overtime cannot exceed ${MAX_OT_MINUTES_PER_DAY / 60} hours in a day. ` +
                 `Raise a second request for another day if the work spans one.`,
      });
    }

    const otDate = dayOf(date);

    // One row per employee per day is a hard constraint on the table, and it is
    // the right one — two competing claims for the same day is an argument, not
    // data.
    const existing = await p.overtimeApproval.findFirst({
      where: { employeeId, date: otDate },
    });
    if (existing) {
      return res.status(409).json({
        message: existing.source === 'EMPLOYEE_REQUEST'
          ? `You already have an overtime request for this date (status: ${existing.status}).`
          : 'Overtime is already recorded for this date, either automatically or by HR.',
        existing,
      });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true, reportingManager: true, overtimeEnabled: true } as any,
    });

    // Respect the per-employee eligibility flag rather than letting anyone claim.
    if ((employee as any)?.overtimeEnabled === false) {
      return res.status(403).json({
        message: 'Overtime is not enabled for you. Speak to HR if that is wrong.',
      });
    }

    const created = await p.overtimeApproval.create({
      data: {
        employeeId,
        date: otDate,
        minutes: 0,                 // actual, filled once the work is done
        expectedMinutes: minutes,
        taskDescription: taskDescription.trim(),
        source: 'EMPLOYEE_REQUEST',
        status: 'REQUESTED',
        managerStatus: 'PENDING',
        managerId: (employee as any)?.reportingManager ?? null,
        requestedAt: new Date(),
      },
    });

    if ((employee as any)?.reportingManager) {
      await createNotification(
        (employee as any).reportingManager,
        `${employee?.firstName} ${employee?.lastName} requested ${(minutes / 60).toFixed(1)}h overtime ` +
        `on ${otDate.toISOString().slice(0, 10)} for: ${taskDescription.trim().slice(0, 80)}`,
        'Overtime request',
      ).catch(() => undefined);
    }

    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** GET /api/overtime/requests/my — the employee's own requests. */
export const listMyOvertimeRequests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = currentEmployeeId(req);
    if (!employeeId) return res.status(401).json({ message: 'Unauthorized' });

    const rows = await p.overtimeApproval.findMany({
      where: { employeeId },
      orderBy: { date: 'desc' },
      take: 100,
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/overtime/requests/pending
 * The manager's queue: requests awaiting approval, plus approved ones still
 * waiting for a completion acknowledgement.
 */
export const listPendingForManager = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managerId = currentEmployeeId(req);
    if (!managerId) return res.status(401).json({ message: 'Unauthorized' });

    // Direct reports, plus anything explicitly routed to this manager.
    const reports = await prisma.employee.findMany({
      where: { reportingManager: managerId } as any,
      select: { id: true },
    });
    const reportIds = reports.map((r) => r.id);

    const scope = {
      OR: [
        { managerId },
        ...(reportIds.length ? [{ employeeId: { in: reportIds } }] : []),
      ],
    };

    const [awaitingApproval, awaitingAck] = await Promise.all([
      p.overtimeApproval.findMany({
        where: { ...scope, status: 'REQUESTED' },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
        orderBy: { date: 'asc' },
      }),
      p.overtimeApproval.findMany({
        where: {
          ...scope,
          status: 'APPROVED',
          source: 'EMPLOYEE_REQUEST',
          taskCompleted: null,
          // Only ask about days that have actually passed.
          date: { lte: new Date() },
        },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    res.json({
      awaitingApproval,
      awaitingAcknowledgement: awaitingAck,
      counts: {
        awaitingApproval: awaitingApproval.length,
        awaitingAcknowledgement: awaitingAck.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** PATCH /api/overtime/requests/:id/decide — manager approves or rejects. */
export const decideOvertimeRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managerId = currentEmployeeId(req);
    const id = Number(req.params.id);
    const approve = req.body?.approve !== false;
    const reason = req.body?.reason ? String(req.body.reason) : null;

    const request = await p.overtimeApproval.findUnique({
      where: { id },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (!request) return res.status(404).json({ message: 'Overtime request not found' });

    if (request.status !== 'REQUESTED') {
      return res.status(409).json({
        message: `This request is already ${request.status.toLowerCase()} and cannot be decided again.`,
      });
    }
    if (!approve && !reason) {
      return res.status(400).json({ message: 'Give a reason when rejecting a request' });
    }

    // Approving sanctions the hours the employee asked for. Actual minutes are
    // set later from the punch or by the manager at acknowledgement.
    const updated = await p.overtimeApproval.update({
      where: { id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        managerStatus: approve ? 'APPROVED' : 'REJECTED',
        managerId: managerId ?? request.managerId,
        managerApprovedAt: new Date(),
        approvedAt: approve ? new Date() : null,
        rejectionReason: approve ? null : reason,
      },
    });

    await createNotification(
      request.employeeId,
      approve
        ? `Your overtime request for ${new Date(request.date).toISOString().slice(0, 10)} was approved.`
        : `Your overtime request for ${new Date(request.date).toISOString().slice(0, 10)} was rejected: ${reason}`,
      approve ? 'Overtime approved' : 'Overtime rejected',
    ).catch(() => undefined);

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * PATCH /api/overtime/requests/:id/acknowledge
 * Manager confirms whether the work the overtime was claimed for actually got
 * done, and sets the actual minutes worked.
 *
 * Marking it not completed zeroes the payable minutes — the hours were
 * sanctioned for a task that did not land, so they are not paid.
 */
export const acknowledgeOvertimeTask = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managerId = currentEmployeeId(req);
    const id = Number(req.params.id);
    const completed = req.body?.completed !== false;
    const note = req.body?.note ? String(req.body.note) : null;

    const request = await p.overtimeApproval.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ message: 'Overtime request not found' });
    if (request.status !== 'APPROVED') {
      return res.status(409).json({
        message: 'Only an approved overtime request can be acknowledged.',
      });
    }
    if (!completed && !note) {
      return res.status(400).json({
        message: 'Explain why the task was not completed — this removes the overtime from payroll.',
      });
    }

    // Actual minutes: what the manager confirms, else what was asked for.
    const actual = Number(req.body?.actualMinutes);
    const payableMinutes = completed
      ? (Number.isFinite(actual) && actual >= 0 ? Math.round(actual) : request.expectedMinutes ?? 0)
      : 0;

    const updated = await p.overtimeApproval.update({
      where: { id },
      data: {
        taskCompleted: completed,
        taskAckBy: managerId,
        taskAckAt: new Date(),
        taskAckNote: note,
        minutes: payableMinutes,
      },
    });

    await createNotification(
      request.employeeId,
      completed
        ? `Your overtime on ${new Date(request.date).toISOString().slice(0, 10)} was confirmed — ` +
          `${(payableMinutes / 60).toFixed(1)}h will be paid.`
        : `Your overtime on ${new Date(request.date).toISOString().slice(0, 10)} was marked not completed ` +
          `and will not be paid: ${note}`,
      'Overtime acknowledgement',
    ).catch(() => undefined);

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** DELETE /api/overtime/requests/:id — employee withdraws a pending request. */
export const withdrawOvertimeRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = currentEmployeeId(req);
    const id = Number(req.params.id);

    const request = await p.overtimeApproval.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ message: 'Overtime request not found' });
    if (request.employeeId !== employeeId) {
      return res.status(403).json({ message: 'You can only withdraw your own requests' });
    }
    if (request.status !== 'REQUESTED') {
      return res.status(409).json({
        message: 'Only a request still awaiting approval can be withdrawn.',
      });
    }

    await p.overtimeApproval.delete({ where: { id } });
    res.json({ message: 'Overtime request withdrawn' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
