import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";

export const getIncentives = async (req: Request, res: Response) => {
  try {
    const { employeeId, status, type, requestedBy, source } = req.query;
    const where: any = {};
    if (employeeId) where.employeeId = Number(employeeId);
    if (status) where.status = String(status);
    if (type) where.type = String(type);
    if (requestedBy) where.requestedBy = Number(requestedBy);
    if (source) where.source = String(source);

    const incentives = await prisma.incentive.findMany({
      where,
      include: {
        employee: { select: { employeeCode: true, firstName: true, lastName: true, Department: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(incentives);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// Get incentives for manager's team
export const getTeamIncentives = async (req: Request, res: Response) => {
  try {
    const managerId = Number(req.query.managerId);
    if (!managerId) return res.status(400).json({ error: "managerId is required" });

    // Get employees reporting to this manager
    const teamEmployees = await prisma.employee.findMany({
      where: {
        OR: [
          { reportingManager: managerId },
          { inchargeId: managerId },
        ],
      },
      select: { id: true },
    });

    const teamIds = teamEmployees.map(e => e.id);

    const incentives = await prisma.incentive.findMany({
      where: {
        OR: [
          { employeeId: { in: teamIds } },
          { requestedBy: managerId },
        ],
      },
      include: {
        employee: { select: { employeeCode: true, firstName: true, lastName: true, Department: { select: { name: true } }, designation: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(incentives);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// Manager requests incentive for their team member
export const requestIncentive = async (req: Request, res: Response) => {
  try {
    const { employeeId, type, amount, description, effectiveDate, remarks, requestedBy } = req.body;

    if (!employeeId || !type || !amount || !effectiveDate || !requestedBy) {
      return res.status(400).json({ error: "employeeId, type, amount, effectiveDate, requestedBy are required" });
    }

    // Verify the employee reports to this manager
    const employee = await prisma.employee.findUnique({
      where: { id: Number(employeeId) },
      select: { id: true, firstName: true, lastName: true, reportingManager: true, inchargeId: true },
    });

    if (!employee) return res.status(404).json({ error: "Employee not found" });

    if (employee.reportingManager !== Number(requestedBy) && employee.inchargeId !== Number(requestedBy)) {
      return res.status(403).json({ error: "You can only request incentives for employees reporting to you" });
    }

    const incentive = await prisma.incentive.create({
      data: {
        employeeId: Number(employeeId),
        type,
        amount: Number(amount),
        description: description || null,
        effectiveDate: new Date(effectiveDate),
        remarks: remarks || null,
        requestedBy: Number(requestedBy),
        source: "REQUEST",
      },
      include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
    });

    // Notify HR (roleId = 1)
    const hrUsers = await prisma.employee.findMany({
      where: { roleId: 1 },
      select: { id: true },
    });

    const requester = await prisma.employee.findUnique({
      where: { id: Number(requestedBy) },
      select: { firstName: true, lastName: true },
    });
    const requesterName = requester ? `${requester.firstName} ${requester.lastName}` : 'Manager';
    const empName = `${incentive.employee.firstName} ${incentive.employee.lastName}`;

    for (const hr of hrUsers) {
      await createNotification(
        hr.id,
        `${requesterName} has requested ${type} incentive of ₹${amount} for ${empName}. Please review.`
      );
    }

    return res.status(201).json(incentive);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// HR creates incentive directly (manual)
export const createIncentive = async (req: Request, res: Response) => {
  try {
    const { employeeId, type, amount, description, effectiveDate, remarks } = req.body;

    if (!employeeId || !type || !amount || !effectiveDate) {
      return res.status(400).json({ error: "employeeId, type, amount, effectiveDate are required" });
    }

    const incentive = await prisma.incentive.create({
      data: {
        employeeId: Number(employeeId),
        type,
        amount: Number(amount),
        description: description || null,
        effectiveDate: new Date(effectiveDate),
        remarks: remarks || null,
        source: "MANUAL",
      },
      include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
    });

    return res.status(201).json(incentive);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// HR approves/rejects incentive request
export const updateIncentive = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status, approvedBy, paidOn, remarks, rejectedBy, rejectReason } = req.body;

    const data: any = {};
    if (status) data.status = status;
    if (remarks !== undefined) data.remarks = remarks;

    if (status === 'APPROVED' && approvedBy) {
      data.approvedBy = Number(approvedBy);
      data.approvedAt = new Date();
    }
    if (status === 'REJECTED' && rejectedBy) {
      data.rejectedBy = Number(rejectedBy);
      data.rejectedAt = new Date();
      data.rejectReason = rejectReason || null;
    }
    if (paidOn) data.paidOn = new Date(paidOn);

    const incentive = await prisma.incentive.update({
      where: { id },
      data,
      include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
    });

    // Notify requester on approval/rejection
    if (incentive.requestedBy && (status === 'APPROVED' || status === 'REJECTED')) {
      const empName = `${incentive.employee.firstName} ${incentive.employee.lastName}`;
      await createNotification(
        incentive.requestedBy,
        `Incentive request for ${empName} (₹${incentive.amount}) has been ${status.toLowerCase()}.`
      );
    }

    // Notify employee on approval
    if (status === 'APPROVED') {
      await createNotification(
        incentive.employeeId,
        `You have been granted a ${incentive.type} incentive of ₹${incentive.amount}.`
      );
    }

    return res.json(incentive);
  } catch (error: any) {
    if (error.code === "P2025") return res.status(404).json({ error: "Incentive not found" });
    return res.status(500).json({ error: error.message });
  }
};

export const deleteIncentive = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await prisma.incentive.delete({ where: { id } });
    return res.json({ message: "Incentive deleted" });
  } catch (error: any) {
    if (error.code === "P2025") return res.status(404).json({ error: "Incentive not found" });
    return res.status(500).json({ error: error.message });
  }
};
