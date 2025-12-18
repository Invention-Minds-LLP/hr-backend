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
exports.listIncidentsByEmployee = exports.listIncidentsByReporter = exports.createIncident = void 0;
// import { PrismaClient, PermissionStatus } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const createIncident = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { employeeId, title, description, attachment } = req.body;
        const reportedBy = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId; // Authenticated user
        if (!employeeId || !title || !description) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        const incident = yield prisma_1.prisma.incident.create({
            data: {
                employeeId: Number(employeeId),
                reportedBy: Number(reportedBy),
                title,
                description,
                status: "OPEN",
                attachment: attachment || null,
            },
        });
        res.json({ message: "Incident created successfully", data: incident });
    }
    catch (err) {
        console.error("Error creating incident:", err);
        res.status(500).json({ error: "Failed to create incident" });
    }
});
exports.createIncident = createIncident;
// 📌 List all incidents reported BY this manager
const listIncidentsByReporter = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const reporterId = Number(req.params.reporterId);
        const list = yield prisma_1.prisma.incident.findMany({
            where: { reportedBy: reporterId },
            include: {
                employee: true,
                reporter: true,
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(list);
    }
    catch (err) {
        console.error("Error fetching incidents:", err);
        res.status(500).json({ error: "Failed to load incidents" });
    }
});
exports.listIncidentsByReporter = listIncidentsByReporter;
// 📌 List all incidents filed AGAINST an employee
const listIncidentsByEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        const list = yield prisma_1.prisma.incident.findMany({
            where: { employeeId },
            include: {
                employee: true,
                reporter: true,
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(list);
    }
    catch (err) {
        console.error("Error fetching incidents:", err);
        res.status(500).json({ error: "Failed to load incidents" });
    }
});
exports.listIncidentsByEmployee = listIncidentsByEmployee;
