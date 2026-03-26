import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

function getFinancialYear(date: Date): number {
  const month = date.getMonth() + 1;
  return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

function atStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(date: Date, days: number): Date {
  const d = atStartOfDay(new Date(date));
  d.setDate(d.getDate() + days);
  return d;
}

async function getLastLedgerBalance(
  tx: Tx,
  employeeId: number,
  leaveTypeId: number,
  year: number
): Promise<number> {
  const last = await tx.leaveLedger.findFirst({
    where: { employeeId, leaveTypeId, year },
    orderBy: { id: "desc" },
    select: { balanceAfter: true },
  });
  return last?.balanceAfter ?? 0;
}

// Mark an employee as force present on a date they have an approved leave
export const markForcePresent = async (req: Request, res: Response) => {
  try {
    const { employeeId, date, reason, createCompOff } = req.body as {
      employeeId: number;
      date: string;
      reason: string;
      createCompOff?: boolean;
    };

    const performedBy: number | null = (req as any).user?.empId ?? null;

    if (!employeeId || !date || !reason) {
      return res
        .status(400)
        .json({ error: "employeeId, date, and reason are required" });
    }

    const targetDate = atStartOfDay(new Date(date));
    const year = getFinancialYear(targetDate);
    const month = targetDate.getMonth() + 1;
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const result = await prisma.$transaction(
      async (tx: Tx) => {
        // Find any APPROVED leave covering this date
        const leave = await tx.leaveRequest.findFirst({
          where: {
            employeeId: Number(employeeId),
            status: "APPROVED",
            startDate: { lte: dayEnd },
            endDate: { gte: targetDate },
            cancelledAt: null,
          } as any,
          include: { leaveType: true },
        });

        // Leave cancellation is optional — employee may have had no leave
        // (e.g., emergency, went directly to client without biometric)
        let daysRestored = 0;
        let leaveRequestId: number | null = null;

        if (leave) {
          leaveRequestId = leave.id;
          const isSingleDay = isSameDay(leave.startDate, leave.endDate);
          const isHalfDay = leave.isHalfDay && isSingleDay;
          daysRestored = isHalfDay ? 0.5 : 1;
          const isCOLeave = leave.leaveType.name === "CO";

          const isFirstDay = isSameDay(targetDate, leave.startDate);
          const isLastDay  = isSameDay(targetDate, leave.endDate);

          // Determine restoration amount from the original ledger debit for this leave,
          // not from leave.isHalfDay — avoids mismatch when the approval debited differently.
          const originalDebitEntry = await tx.leaveLedger.findFirst({
            where: {
              employeeId: Number(employeeId),
              leaveTypeId: leave.leaveTypeId,
              referenceId: leave.id,
              action: "DEBIT",
            } as any,
            orderBy: { id: "asc" },
          });
          // For multi-day leaves we restore exactly 1 day (the force-present date).
          // For single-day leaves we restore however much was actually debited (0.5 or 1).
          if (isSingleDay && originalDebitEntry) {
            daysRestored = Number(originalDebitEntry.debit);
          }

          if (isSingleDay) {
            // Cancel the entire leave
            await (tx.leaveRequest as any).update({
              where: { id: leave.id },
              data: {
                status: "CANCELLED",
                cancelledAt: new Date(),
                cancelledBy: performedBy,
                cancellationReason: `Force Present on ${date}: ${reason}`,
              },
            });
          } else if (isFirstDay) {
            // Shrink: move startDate to the next day
            await tx.leaveRequest.update({
              where: { id: leave.id },
              data: { startDate: addDays(targetDate, 1) },
            });
          } else if (isLastDay) {
            // Shrink: move endDate to the previous day
            await tx.leaveRequest.update({
              where: { id: leave.id },
              data: { endDate: addDays(targetDate, -1) },
            });
          } else {
            // Split: original leave ends the day before, new leave starts the day after
            await tx.leaveRequest.update({
              where: { id: leave.id },
              data: { endDate: addDays(targetDate, -1) },
            });
            await tx.leaveRequest.create({
              data: {
                employeeId: leave.employeeId,
                leaveTypeId: leave.leaveTypeId,
                startDate: addDays(targetDate, 1),
                endDate: leave.endDate,
                reason: `${leave.reason} [split from leave #${leave.id} due to force present on ${date}]`,
                status: "APPROVED",
                approvedBy: leave.approvedBy,
                isHalfDay: false,
                hodDecision: leave.hodDecision,
                hodDecidedAt: leave.hodDecidedAt,
                hrDecision: leave.hrDecision,
                hrDecidedAt: leave.hrDecidedAt,
                inChargeDecision: leave.inChargeDecision,
                inChargeDecidedAt: leave.inChargeDecidedAt,
              },
            });
          }

          // Restore leave balance (non-CO leaves)
          if (!isCOLeave) {
            const balance = await tx.employeeLeaveBalance.findFirst({
              where: {
                employeeId: Number(employeeId),
                leaveTypeId: leave.leaveTypeId,
                year,
              },
            });

            if (balance) {
              const currentLedgerBalance = await getLastLedgerBalance(
                tx,
                Number(employeeId),
                leave.leaveTypeId,
                year
              );

              if (isHalfDay) {
                await tx.employeeLeaveBalance.update({
                  where: { id: balance.id },
                  data: { halfDayUsed: { decrement: 1 } },
                });
              } else {
                await tx.employeeLeaveBalance.update({
                  where: { id: balance.id },
                  data: { used: { decrement: 1 } },
                });
              }

              // Insert CANCELLATION ledger entry
              await (tx.leaveLedger as any).create({
                data: {
                  employeeId: Number(employeeId),
                  leaveTypeId: leave.leaveTypeId,
                  year,
                  month,
                  credit: daysRestored,
                  balanceAfter: currentLedgerBalance + daysRestored,
                  action: "CANCELLATION",
                  referenceType: "LEAVE_REQUEST",
                  referenceId: leave.id,
                  performedBy: performedBy,
                  source: "ADMIN",
                  remarks: `Force present on ${date}: ${reason}`,
                },
              });
            }
          } else {
            // CO leave: restore the CompOff credit that was consumed
            const usedCredit = await tx.compOffCredit.findFirst({
              where: { leaveId: leave.id, used: true },
            });
            if (usedCredit) {
              await tx.compOffCredit.update({
                where: { id: usedCredit.id },
                data: { used: false, usedOn: null, leaveId: null },
              });
            }
          }
        }
        // If no leave exists: attendance is simply corrected to PRESENT
        // (no balance changes needed)

        // Upsert attendance as PRESENT with isForcedPresent flag
        const existing = await tx.attendance.findUnique({
          where: {
            employeeId_date: {
              employeeId: Number(employeeId),
              date: targetDate,
            },
          },
        });

        let attendanceId: number;
        if (existing) {
          const updated = await (tx.attendance as any).update({
            where: { id: existing.id },
            data: {
              status: "PRESENT",
              isForcedPresent: true,
              reason,
            },
          });
          attendanceId = updated.id;
        } else {
          const created = await (tx.attendance as any).create({
            data: {
              employeeId: Number(employeeId),
              date: targetDate,
              status: "PRESENT",
              isForcedPresent: true,
              createdBy: performedBy,
              reason,
            },
          });
          attendanceId = created.id;
        }

        // Optionally grant a new CompOff credit (3-month expiry)
        if (createCompOff) {
          const expiryDate = new Date(targetDate);
          expiryDate.setMonth(expiryDate.getMonth() + 2);
          await tx.compOffCredit.create({
            data: {
              employeeId: Number(employeeId),
              workDate: targetDate,
              expiryDate,
            },
          });
        }

        // Create audit record
        const action = await (tx as any).forcePresentAction.create({
          data: {
            employeeId: Number(employeeId),
            date: targetDate,
            leaveRequestId: leaveRequestId,
            daysRestored: daysRestored,
            compOffGranted: createCompOff ?? false,
            performedBy: performedBy ?? 0,
            reason,
          },
        });

        return { kind: "OK" as const, status: 200, body: action, attendanceId };
      },
      { timeout: 20000 }
    );

    // Link attendance to the force-present action outside the transaction
    // (non-critical back-reference — keeps transaction lean)
    await (prisma.attendance as any).update({
      where: { id: result.attendanceId },
      data: { forcePresentId: result.body.id },
    });

    return res.json(result.body);
  } catch (err) {
    console.error("markForcePresent error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// List force present actions with pagination
export const getForcePresentList = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const employeeId = req.query.employeeId
      ? Number(req.query.employeeId)
      : undefined;

    const where: any = {};
    if (employeeId) where.employeeId = employeeId;

    const [records, total] = await Promise.all([
      (prisma as any).forcePresentAction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              Department: { select: { name: true } },
            },
          },
          leaveRequest: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              leaveType: { select: { name: true } },
            },
          },
        },
      }),
      (prisma as any).forcePresentAction.count({ where }),
    ]);

    return res.json({ records, total, page, limit });
  } catch (err) {
    console.error("getForcePresentList error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Preview: get approved leaves for an employee on a specific date
export const getApprovedLeavesOnDate = async (req: Request, res: Response) => {
  try {
    const { employeeId, date } = req.query;

    if (!employeeId || !date) {
      return res
        .status(400)
        .json({ error: "employeeId and date are required" });
    }

    const targetDate = atStartOfDay(new Date(date as string));
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const leaves = await prisma.leaveRequest.findMany({
      where: {
        employeeId: Number(employeeId),
        status: "APPROVED",
        startDate: { lte: dayEnd },
        endDate: { gte: targetDate },
        cancelledAt: null,
      } as any,
      include: { leaveType: { select: { id: true, name: true } } },
    });

    return res.json(leaves);
  } catch (err) {
    console.error("getApprovedLeavesOnDate error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
