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
exports.updateLeaveStatus = exports.getLeaveTypes = exports.createLeaveType = exports.getLeaveRequests = exports.createLeaveRequest = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// Create Leave Request
const createLeaveRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, leaveTypeId, startDate, endDate, reason } = req.body;
        if (!employeeId || !leaveTypeId || !startDate || !endDate || !reason) {
            return res.status(400).json({ error: "All fields are required" });
        }
        const leaveRequest = yield prisma.leaveRequest.create({
            data: {
                employeeId,
                leaveTypeId,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                reason,
            },
            include: {
                leaveType: true,
                employee: {
                    select: { firstName: true, lastName: true, employeeCode: true }
                }
            }
        });
        res.status(201).json(leaveRequest);
    }
    catch (error) {
        console.error("Error creating leave request:", error);
        res.status(500).json({ error: "Failed to create leave request" });
    }
});
exports.createLeaveRequest = createLeaveRequest;
// Get All Leave Requests (optional)
const getLeaveRequests = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leaves = yield prisma.leaveRequest.findMany({
            include: { leaveType: true, employee: true },
            orderBy: { createdAt: "desc" }
        });
        res.json(leaves);
    }
    catch (error) {
        console.error("Error fetching leave requests:", error);
        res.status(500).json({ error: "Failed to fetch leave requests" });
    }
});
exports.getLeaveRequests = getLeaveRequests;
const createLeaveType = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: "Leave type name is required" });
        }
        const leaveType = yield prisma.leaveType.create({
            data: { name },
        });
        res.status(201).json(leaveType);
    }
    catch (error) {
        console.error("Error creating leave type:", error);
        res.status(500).json({ error: "Failed to create leave type" });
    }
});
exports.createLeaveType = createLeaveType;
// Get All Leave Types
const getLeaveTypes = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const leaveTypes = yield prisma.leaveType.findMany({
            orderBy: { name: "asc" }
        });
        res.json(leaveTypes);
    }
    catch (error) {
        console.error("Error fetching leave types:", error);
        res.status(500).json({ error: "Failed to fetch leave types" });
    }
});
exports.getLeaveTypes = getLeaveTypes;
const updateLeaveStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status, declineReason, userId } = req.body; // userId = logged-in admin
        if (!['Approved', 'Declined'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status value' });
        }
        const data = {
            status: status === 'Approved' ? client_1.LeaveStatus.APPROVED : client_1.LeaveStatus.REJECTED,
            approvedBy: null,
            declinedBy: null,
            declineReason: null
        };
        if (data.status === "APPROVED") {
            data.approvedBy = userId;
            data.approvedDate = new Date();
        }
        else if (data.status === "REJECTED") {
            data.declinedBy = userId;
            data.declinedDate = new Date();
            data.declineReason = declineReason;
        }
        console.log(data, status);
        const updatedLeave = yield prisma.leaveRequest.update({
            where: { id: Number(id) },
            data,
            include: {
                employee: true,
                leaveType: true,
            }
        });
        res.json(updatedLeave);
    }
    catch (error) {
        console.error("Error updating leave status:", error);
        res.status(500).json({ error: "Failed to update leave status" });
    }
});
exports.updateLeaveStatus = updateLeaveStatus;
