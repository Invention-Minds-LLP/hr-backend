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
exports.updatePermissionStatus = exports.getPermissionRequests = exports.createPermissionRequest = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const createPermissionRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, permissionType, timing, day, startTime, endTime, reason } = req.body;
        console.log(employeeId, permissionType, day, timing, reason);
        if (!employeeId || !permissionType || !timing || !day || !reason) {
            return res.status(400).json({ error: "All fields are required" });
        }
        const request = yield prisma.permissionRequest.create({
            data: {
                employeeId,
                permissionType,
                timing,
                day: new Date(day),
                startTime: startTime ? new Date(startTime) : undefined,
                endTime: endTime ? new Date(endTime) : undefined,
                reason
            },
            include: { employee: true }
        });
        res.status(201).json(request);
    }
    catch (error) {
        console.error("Error creating permission request:", error);
        res.status(500).json({ error: "Failed to create permission request" });
    }
});
exports.createPermissionRequest = createPermissionRequest;
const getPermissionRequests = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const requests = yield prisma.permissionRequest.findMany({
            include: { employee: true },
            orderBy: { createdAt: "desc" }
        });
        res.json(requests);
    }
    catch (error) {
        console.error("Error fetching permission requests:", error);
        res.status(500).json({ error: "Failed to fetch permission requests" });
    }
});
exports.getPermissionRequests = getPermissionRequests;
const updatePermissionStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status, userId, declineReason } = req.body;
        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status value' });
        }
        const data = {
            status: status === 'APPROVED' ? client_1.PermissionStatus.APPROVED : client_1.PermissionStatus.REJECTED,
            approvedBy: null,
            declinedBy: null,
            declineReason: null,
            approvedDate: null,
            declinedDate: null
        };
        if (status === 'APPROVED') {
            data.approvedBy = userId;
            data.approvedDate = new Date();
        }
        else if (status === 'REJECTED') {
            data.declinedBy = userId;
            data.declinedDate = new Date();
            data.declineReason = declineReason;
        }
        const updated = yield prisma.permissionRequest.update({
            where: { id: Number(id) },
            data,
            include: { employee: true }
        });
        res.json(updated);
    }
    catch (error) {
        console.error("Error updating permission status:", error);
        res.status(500).json({ error: "Failed to update permission status" });
    }
});
exports.updatePermissionStatus = updatePermissionStatus;
