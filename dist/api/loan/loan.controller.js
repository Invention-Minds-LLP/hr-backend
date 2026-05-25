"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteLoan = exports.addRepayment = exports.updateLoan = exports.createLoan = exports.getLoans = void 0;
const prisma_1 = require("../../lib/prisma");
const getLoans = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, status } = req.query;
        const where = {};
        if (employeeId)
            where.employeeId = Number(employeeId);
        if (status)
            where.status = String(status);
        const loans = yield prisma_1.prisma.loan.findMany({
            where,
            include: {
                employee: { select: { employeeCode: true, firstName: true, lastName: true, Department: { select: { name: true } } } },
                repayments: { orderBy: { paidOn: "desc" } },
            },
            orderBy: { createdAt: "desc" },
        });
        return res.json(loans);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getLoans = getLoans;
const createLoan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const loan = yield prisma_1.prisma.loan.create({
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
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.createLoan = createLoan;
const updateLoan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { status, approvedBy, disbursedOn, remarks } = req.body;
        const data = {};
        if (status)
            data.status = status;
        if (approvedBy) {
            data.approvedBy = Number(approvedBy);
            data.approvedAt = new Date();
        }
        if (disbursedOn)
            data.disbursedOn = new Date(disbursedOn);
        if (remarks !== undefined)
            data.remarks = remarks;
        const loan = yield prisma_1.prisma.loan.update({
            where: { id }, data,
            include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
        });
        return res.json(loan);
    }
    catch (error) {
        if (error.code === "P2025")
            return res.status(404).json({ error: "Loan not found" });
        return res.status(500).json({ error: error.message });
    }
});
exports.updateLoan = updateLoan;
const addRepayment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const loanId = Number(req.params.id);
        const { amount, paidOn, mode, remarks } = req.body;
        if (!amount || !paidOn) {
            return res.status(400).json({ error: "amount and paidOn are required" });
        }
        const loan = yield prisma_1.prisma.loan.findUnique({ where: { id: loanId } });
        if (!loan)
            return res.status(404).json({ error: "Loan not found" });
        if (loan.status !== "ACTIVE")
            return res.status(400).json({ error: "Loan is not active" });
        const repayAmount = Number(amount);
        const newOutstanding = Math.max(0, loan.outstandingBalance - repayAmount);
        const newTotalRepaid = loan.totalRepaid + repayAmount;
        const [repayment] = yield prisma_1.prisma.$transaction([
            prisma_1.prisma.loanRepayment.create({
                data: {
                    loanId,
                    employeeId: loan.employeeId,
                    amount: repayAmount,
                    paidOn: new Date(paidOn),
                    mode: mode || null,
                    remarks: remarks || null,
                },
            }),
            prisma_1.prisma.loan.update({
                where: { id: loanId },
                data: {
                    totalRepaid: newTotalRepaid,
                    outstandingBalance: newOutstanding,
                    status: newOutstanding <= 0 ? "CLOSED" : "ACTIVE",
                },
            }),
        ]);
        return res.status(201).json(repayment);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.addRepayment = addRepayment;
const deleteLoan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const loan = yield prisma_1.prisma.loan.findUnique({ where: { id }, include: { repayments: true } });
        if (!loan)
            return res.status(404).json({ error: "Loan not found" });
        if (loan.repayments.length > 0)
            return res.status(400).json({ error: "Cannot delete loan with repayments" });
        yield prisma_1.prisma.loan.delete({ where: { id } });
        return res.json({ message: "Loan deleted" });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.deleteLoan = deleteLoan;
