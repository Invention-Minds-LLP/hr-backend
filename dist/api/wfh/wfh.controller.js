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
exports.updateWFHStatus = exports.getWFHRequests = exports.createWFHRequest = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// Create WFH request
const createWFHRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, startDate, endDate, reason } = req.body;
        if (!employeeId || !startDate || !endDate || !reason) {
            return res.status(400).json({ error: "All fields are required" });
        }
        const newWFH = yield prisma.wFHRequest.create({
            data: {
                employeeId,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                reason,
            },
            include: { employee: true },
        });
        res.status(201).json(newWFH);
    }
    catch (error) {
        console.error("Error creating WFH request:", error);
        res.status(500).json({ error: "Failed to create WFH request" });
    }
});
exports.createWFHRequest = createWFHRequest;
// Get all WFH requests
const getWFHRequests = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const requests = yield prisma.wFHRequest.findMany({
            include: { employee: true },
            orderBy: { createdAt: "desc" },
        });
        res.json(requests);
    }
    catch (error) {
        console.error("Error fetching WFH requests:", error);
        res.status(500).json({ error: "Failed to fetch WFH requests" });
    }
});
exports.getWFHRequests = getWFHRequests;
// Update WFH request status
const updateWFHStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status, userId, declineReason } = req.body;
        if (!["Approved", "Declined"].includes(status)) {
            return res.status(400).json({ error: "Invalid status value" });
        }
        const data = {
            status: status === "APPROVED" ? client_1.WFHStatus.APPROVED : client_1.WFHStatus.REJECTED,
            approvedBy: null,
            declinedBy: null,
            approvedDate: null,
            declinedDate: null,
            declineReason: null,
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
        const updatedWFH = yield prisma.wFHRequest.update({
            where: { id: Number(id) },
            data,
            include: { employee: true },
        });
        res.json(updatedWFH);
    }
    catch (error) {
        console.error("Error updating WFH request status:", error);
        res.status(500).json({ error: "Failed to update WFH request status" });
    }
});
exports.updateWFHStatus = updateWFHStatus;
