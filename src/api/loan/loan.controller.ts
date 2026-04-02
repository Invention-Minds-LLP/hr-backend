import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

export const getLoans = async (req: Request, res: Response) => {
  try {
    const { employeeId, status } = req.query;
    const where: any = {};
    if (employeeId) where.employeeId = Number(employeeId);
    if (status) where.status = String(status);

    const loans = await prisma.loan.findMany({
      where,
      include: {
        employee: { select: { employeeCode: true, firstName: true, lastName: true, Department: { select: { name: true } } } },
        repayments: { orderBy: { paidOn: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(loans);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createLoan = async (req: Request, res: Response) => {
  try {
    const { employeeId, loanType, principalAmount, interestRate, tenure, reason } = req.body;

    if (!employeeId || !loanType || !principalAmount || !tenure) {
      return res.status(400).json({ error: "employeeId, loanType, principalAmount, tenure are required" });
    }

    const rate = Number(interestRate) || 0;
    const principal = Number(principalAmount);
    const months = Number(tenure);
    const totalWithInterest = principal + (principal * rate * months) / (12 * 100);
    const emi = Math.round((totalWithInterest / months) * 100) / 100;

    const loan = await prisma.loan.create({
      data: {
        employeeId: Number(employeeId),
        loanType,
        principalAmount: principal,
        interestRate: rate,
        tenure: months,
        emiAmount: emi,
        outstandingBalance: principal,
        reason: reason || null,
      },
      include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
    });

    return res.status(201).json(loan);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateLoan = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status, approvedBy, disbursedOn, remarks } = req.body;

    const data: any = {};
    if (status) data.status = status;
    if (approvedBy) { data.approvedBy = Number(approvedBy); data.approvedAt = new Date(); }
    if (disbursedOn) data.disbursedOn = new Date(disbursedOn);
    if (remarks !== undefined) data.remarks = remarks;

    const loan = await prisma.loan.update({
      where: { id }, data,
      include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
    });

    return res.json(loan);
  } catch (error: any) {
    if (error.code === "P2025") return res.status(404).json({ error: "Loan not found" });
    return res.status(500).json({ error: error.message });
  }
};

export const addRepayment = async (req: Request, res: Response) => {
  try {
    const loanId = Number(req.params.id);
    const { amount, paidOn, mode, remarks } = req.body;

    if (!amount || !paidOn) {
      return res.status(400).json({ error: "amount and paidOn are required" });
    }

    const loan = await prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    if (loan.status !== "ACTIVE") return res.status(400).json({ error: "Loan is not active" });

    const repayAmount = Number(amount);
    const newOutstanding = Math.max(0, loan.outstandingBalance - repayAmount);
    const newTotalRepaid = loan.totalRepaid + repayAmount;

    const [repayment] = await prisma.$transaction([
      prisma.loanRepayment.create({
        data: {
          loanId,
          employeeId: loan.employeeId,
          amount: repayAmount,
          paidOn: new Date(paidOn),
          mode: mode || null,
          remarks: remarks || null,
        },
      }),
      prisma.loan.update({
        where: { id: loanId },
        data: {
          totalRepaid: newTotalRepaid,
          outstandingBalance: newOutstanding,
          status: newOutstanding <= 0 ? "CLOSED" : "ACTIVE",
        },
      }),
    ]);

    return res.status(201).json(repayment);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const deleteLoan = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const loan = await prisma.loan.findUnique({ where: { id }, include: { repayments: true } });
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    if (loan.repayments.length > 0) return res.status(400).json({ error: "Cannot delete loan with repayments" });

    await prisma.loan.delete({ where: { id } });
    return res.json({ message: "Loan deleted" });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
