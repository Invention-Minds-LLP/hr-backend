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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUnacknowledgedComplaints = exports.checkAcknowledgement = exports.getAcknowledgementsByEmployee = exports.createAcknowledgement = exports.updateGrievanceStatus = exports.addGrievanceComment = exports.listGrievances = exports.createGrievance = void 0;
const express_async_handler_1 = __importDefault(require("express-async-handler"));
// import { PrismaClient, PermissionStatus } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
// --- Create grievance
exports.createGrievance = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { title, description, category } = req.body;
    let employeeId = Number(req.body.employeeId);
    const grievance = yield prisma_1.prisma.grievance.create({
        data: { employeeId, title, description, category }
    });
    // 🔔 Notify HR
    const hrEmployees = yield prisma_1.prisma.employee.findMany({
        where: {
            departmentId: 1 // ✅ HR department
        },
        select: { id: true }
    });
    // for (const hr of hrEmployees) {
    //   await createNotification(
    //     hr.id,
    //     'New grievance submitted — requires acknowledgment'
    //   );
    // }
    res.json(grievance);
}));
// --- List grievances
exports.listGrievances = (0, express_async_handler_1.default)((_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const grievances = yield prisma_1.prisma.grievance.findMany({
        include: { employee: true, comments: { include: { employee: true } } }
    });
    res.json(grievances);
}));
// --- Add comment
exports.addGrievanceComment = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const grievanceId = Number(req.params.id);
    const { comment } = req.body;
    let employeeId = Number(req.body.employeeId);
    const c = yield prisma_1.prisma.grievanceComment.create({
        data: { grievanceId, employeeId, comment }
    });
    res.json(c);
}));
// --- Update status
exports.updateGrievanceStatus = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const grievanceId = Number(req.params.id);
    const { status } = req.body;
    const g = yield prisma_1.prisma.grievance.update({
        where: { id: grievanceId },
        data: { status }
    });
    res.json(g);
}));
const createAcknowledgement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, grievanceId, poshCaseId } = req.body;
        if (!employeeId) {
            return res.status(400).json({ message: "employeeId is required" });
        }
        if (!grievanceId && !poshCaseId) {
            return res
                .status(400)
                .json({ message: "Either grievanceId or poshCaseId must be provided" });
        }
        // Prevent duplicate acknowledgment
        const existingAck = yield prisma_1.prisma.complaintAcknowledgement.findFirst({
            where: Object.assign(Object.assign({ employeeId }, (grievanceId ? { grievanceId } : {})), (poshCaseId ? { poshCaseId } : {})),
        });
        if (existingAck) {
            return res.status(409).json({ message: "Already acknowledged" });
        }
        const acknowledgement = yield prisma_1.prisma.complaintAcknowledgement.create({
            data: {
                employeeId,
                grievanceId: grievanceId || null,
                poshCaseId: poshCaseId || null,
            },
        });
        return res.status(201).json({
            message: "Acknowledgement recorded successfully",
            data: acknowledgement,
        });
    }
    catch (error) {
        console.error("Error creating acknowledgement:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});
exports.createAcknowledgement = createAcknowledgement;
/**
 * Get all acknowledgements for a specific employee
 */
const getAcknowledgementsByEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId } = req.params;
        const acknowledgements = yield prisma_1.prisma.complaintAcknowledgement.findMany({
            where: { employeeId: Number(employeeId) },
            include: {
                grievance: true,
                poshCase: true,
            },
            orderBy: { acknowledgedAt: "desc" },
        });
        res.json({ data: acknowledgements });
    }
    catch (error) {
        console.error("Error fetching acknowledgements:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});
exports.getAcknowledgementsByEmployee = getAcknowledgementsByEmployee;
/**
 * Check if an employee has already acknowledged a specific complaint
 */
const checkAcknowledgement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, grievanceId, poshCaseId } = req.query;
        if (!employeeId) {
            return res.status(400).json({ message: "employeeId is required" });
        }
        const ack = yield prisma_1.prisma.complaintAcknowledgement.findFirst({
            where: Object.assign(Object.assign({ employeeId: Number(employeeId) }, (grievanceId ? { grievanceId: Number(grievanceId) } : {})), (poshCaseId ? { poshCaseId: Number(poshCaseId) } : {})),
        });
        res.json({ acknowledged: !!ack });
    }
    catch (error) {
        console.error("Error checking acknowledgement:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
});
exports.checkAcknowledgement = checkAcknowledgement;
const getUnacknowledgedComplaints = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const employeeId = Number(req.params.employeeId);
        if (!employeeId)
            return res.status(400).json({ message: "employeeId required" });
        // Step 1️⃣: Check if employee belongs to HR department
        const employee = yield prisma_1.prisma.employee.findUnique({
            where: { id: employeeId },
            include: { Department: true },
        });
        if (!employee)
            return res.status(404).json({ message: "Employee not found" });
        console.log("Employee Department:", (_a = employee.Department) === null || _a === void 0 ? void 0 : _a.name);
        if (!employee.Department || employee.Department.name !== "Human Resources") {
            // Not an HR user → no need to show any complaints
            return res.json({ grievances: [], poshCases: [] });
        }
        // Step 2️⃣: Fetch already acknowledged complaint IDs
        const acknowledgements = yield prisma_1.prisma.complaintAcknowledgement.findMany({
            where: { employeeId },
            select: { grievanceId: true, poshCaseId: true },
        });
        const acknowledgedGrievanceIds = acknowledgements
            .filter(a => a.grievanceId)
            .map(a => a.grievanceId);
        const acknowledgedPoshIds = acknowledgements
            .filter(a => a.poshCaseId)
            .map(a => a.poshCaseId);
        // Step 3️⃣: Find all grievances and POSH cases not yet acknowledged
        const grievances = yield prisma_1.prisma.grievance.findMany({
            where: {
                NOT: { id: { in: acknowledgedGrievanceIds } },
            },
            include: { employee: true },
            orderBy: { createdAt: "desc" },
        });
        const poshCases = yield prisma_1.prisma.poshCase.findMany({
            where: {
                NOT: { id: { in: acknowledgedPoshIds } },
            },
            include: {
                complainant: true,
                accused: true,
            },
            orderBy: { createdAt: "desc" },
        });
        return res.json({ grievances, poshCases });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
});
exports.getUnacknowledgedComplaints = getUnacknowledgedComplaints;
