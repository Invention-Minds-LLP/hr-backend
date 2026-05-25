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
exports.deleteIncentive = exports.updateIncentive = exports.createIncentive = exports.requestIncentive = exports.getTeamIncentives = exports.getIncentives = void 0;
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
const getIncentives = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, status, type, requestedBy, source } = req.query;
        const where = {};
        if (employeeId)
            where.employeeId = Number(employeeId);
        if (status)
            where.status = String(status);
        if (type)
            where.type = String(type);
        if (requestedBy)
            where.requestedBy = Number(requestedBy);
        if (source)
            where.source = String(source);
        const incentives = yield prisma_1.prisma.incentive.findMany({
            where,
            include: {
                employee: { select: { employeeCode: true, firstName: true, lastName: true, Department: { select: { name: true } } } },
            },
            orderBy: { createdAt: "desc" },
        });
        return res.json(incentives);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getIncentives = getIncentives;
// Get incentives for manager's team
const getTeamIncentives = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = Number(req.query.managerId);
        if (!managerId)
            return res.status(400).json({ error: "managerId is required" });
        // Get employees reporting to this manager
        const teamEmployees = yield prisma_1.prisma.employee.findMany({
            where: {
                OR: [
                    { reportingManager: managerId },
                    { inchargeId: managerId },
                ],
            },
            select: { id: true },
        });
        const teamIds = teamEmployees.map(e => e.id);
        const incentives = yield prisma_1.prisma.incentive.findMany({
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
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getTeamIncentives = getTeamIncentives;
// Manager requests incentive for their team member
const requestIncentive = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, type, amount, description, effectiveDate, remarks, requestedBy } = req.body;
        if (!employeeId || !type || !amount || !effectiveDate || !requestedBy) {
            return res.status(400).json({ error: "employeeId, type, amount, effectiveDate, requestedBy are required" });
        }
        // Verify the employee reports to this manager
        const employee = yield prisma_1.prisma.employee.findUnique({
            where: { id: Number(employeeId) },
            select: { id: true, firstName: true, lastName: true, reportingManager: true, inchargeId: true },
        });
        if (!employee)
            return res.status(404).json({ error: "Employee not found" });
        if (employee.reportingManager !== Number(requestedBy) && employee.inchargeId !== Number(requestedBy)) {
            return res.status(403).json({ error: "You can only request incentives for employees reporting to you" });
        }
        const incentive = yield prisma_1.prisma.incentive.create({
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
        const hrUsers = yield prisma_1.prisma.employee.findMany({
            where: { roleId: 1 },
            select: { id: true },
        });
        const requester = yield prisma_1.prisma.employee.findUnique({
            where: { id: Number(requestedBy) },
            select: { firstName: true, lastName: true },
        });
        const requesterName = requester ? `${requester.firstName} ${requester.lastName}` : 'Manager';
        const empName = `${incentive.employee.firstName} ${incentive.employee.lastName}`;
        for (const hr of hrUsers) {
            yield (0, notifications_controller_1.createNotification)(hr.id, `${requesterName} has requested ${type} incentive of ₹${amount} for ${empName}. Please review.`);
        }
        return res.status(201).json(incentive);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.requestIncentive = requestIncentive;
// HR creates incentive directly (manual)
const createIncentive = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, type, amount, description, effectiveDate, remarks } = req.body;
        if (!employeeId || !type || !amount || !effectiveDate) {
            return res.status(400).json({ error: "employeeId, type, amount, effectiveDate are required" });
        }
        const incentive = yield prisma_1.prisma.incentive.create({
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
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.createIncentive = createIncentive;
// HR approves/rejects incentive request
const updateIncentive = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { status, approvedBy, paidOn, remarks, rejectedBy, rejectReason } = req.body;
        const data = {};
        if (status)
            data.status = status;
        if (remarks !== undefined)
            data.remarks = remarks;
        if (status === 'APPROVED' && approvedBy) {
            data.approvedBy = Number(approvedBy);
            data.approvedAt = new Date();
        }
        if (status === 'REJECTED' && rejectedBy) {
            data.rejectedBy = Number(rejectedBy);
            data.rejectedAt = new Date();
            data.rejectReason = rejectReason || null;
        }
        if (paidOn)
            data.paidOn = new Date(paidOn);
        const incentive = yield prisma_1.prisma.incentive.update({
            where: { id },
            data,
            include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
        });
        // Notify requester on approval/rejection
        if (incentive.requestedBy && (status === 'APPROVED' || status === 'REJECTED')) {
            const empName = `${incentive.employee.firstName} ${incentive.employee.lastName}`;
            yield (0, notifications_controller_1.createNotification)(incentive.requestedBy, `Incentive request for ${empName} (₹${incentive.amount}) has been ${status.toLowerCase()}.`);
        }
        // Notify employee on approval
        if (status === 'APPROVED') {
            yield (0, notifications_controller_1.createNotification)(incentive.employeeId, `You have been granted a ${incentive.type} incentive of ₹${incentive.amount}.`);
        }
        return res.json(incentive);
    }
    catch (error) {
        if (error.code === "P2025")
            return res.status(404).json({ error: "Incentive not found" });
        return res.status(500).json({ error: error.message });
    }
});
exports.updateIncentive = updateIncentive;
const deleteIncentive = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        yield prisma_1.prisma.incentive.delete({ where: { id } });
        return res.json({ message: "Incentive deleted" });
    }
    catch (error) {
        if (error.code === "P2025")
            return res.status(404).json({ error: "Incentive not found" });
        return res.status(500).json({ error: error.message });
    }
});
exports.deleteIncentive = deleteIncentive;
