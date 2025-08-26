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
exports.deleteShiftAssignment = exports.updateShiftAssignment = exports.getShiftAssignmentsByEmployee = exports.getShiftAssignments = exports.assignShift = exports.deleteShiftTemplate = exports.updateShiftTemplate = exports.getShiftTemplateById = exports.getShiftTemplates = exports.createShiftTemplate = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
/* ==========================
   SHIFT TEMPLATE CONTROLLERS
   ========================== */
// Create Shift Template
const createShiftTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, shiftType, startTime, endTime } = req.body;
        const template = yield prisma.shiftTemplate.create({
            data: {
                name,
                shiftType,
                startTime: new Date(startTime),
                endTime: new Date(endTime)
            }
        });
        res.status(201).json(template);
    }
    catch (error) {
        console.error("Error creating shift template:", error);
        res.status(500).json({ error: "Failed to create shift template" });
    }
});
exports.createShiftTemplate = createShiftTemplate;
// Get All Shift Templates
const getShiftTemplates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const templates = yield prisma.shiftTemplate.findMany();
        res.json(templates);
    }
    catch (error) {
        console.error("Error fetching shift templates:", error);
        res.status(500).json({ error: "Failed to fetch shift templates" });
    }
});
exports.getShiftTemplates = getShiftTemplates;
// Get Single Shift Template
const getShiftTemplateById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const template = yield prisma.shiftTemplate.findUnique({
            where: { id: Number(id) }
        });
        if (!template) {
            return res.status(404).json({ error: "Shift template not found" });
        }
        res.json(template);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch shift template" });
    }
});
exports.getShiftTemplateById = getShiftTemplateById;
// Update Shift Template
const updateShiftTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, shiftType, startTime, endTime } = req.body;
        const updatedTemplate = yield prisma.shiftTemplate.update({
            where: { id: Number(id) },
            data: {
                name,
                shiftType,
                startTime: new Date(startTime),
                endTime: new Date(endTime)
            }
        });
        res.json(updatedTemplate);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to update shift template" });
    }
});
exports.updateShiftTemplate = updateShiftTemplate;
// Delete Shift Template
const deleteShiftTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma.shiftTemplate.delete({
            where: { id: Number(id) }
        });
        res.json({ message: "Shift template deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ error: "Failed to delete shift template" });
    }
});
exports.deleteShiftTemplate = deleteShiftTemplate;
/* ==========================
   SHIFT ASSIGNMENT CONTROLLERS
   ========================== */
// Assign Shift to Employee
const assignShift = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, shiftId, date } = req.body;
        const assignment = yield prisma.shiftAssignment.create({
            data: {
                employeeId,
                shiftId,
                date: new Date(date),
                acknowledged: false
            },
            include: {
                employee: true,
                shift: true
            }
        });
        const employee = yield prisma.employee.update({
            where: {
                id: employeeId
            },
            data: {
                shiftId: shiftId
            }
        });
        res.status(201).json(assignment);
    }
    catch (error) {
        console.error("Error assigning shift:", error);
        res.status(500).json({ error: "Failed to assign shift" });
    }
});
exports.assignShift = assignShift;
// Get All Shift Assignments
const getShiftAssignments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assignments = yield prisma.shiftAssignment.findMany({
            include: {
                employee: true,
                shift: true
            }
        });
        res.json(assignments);
    }
    catch (error) {
        console.error("Error fetching shift assignments:", error);
        res.status(500).json({ error: "Failed to fetch shift assignments" });
    }
});
exports.getShiftAssignments = getShiftAssignments;
// Get Shift Assignments for a Single Employee
const getShiftAssignmentsByEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId } = req.params;
        const assignments = yield prisma.shiftAssignment.findMany({
            where: { employeeId: Number(employeeId) },
            include: {
                shift: true
            }
        });
        res.json(assignments);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch shift assignments" });
    }
});
exports.getShiftAssignmentsByEmployee = getShiftAssignmentsByEmployee;
// Update Shift Assignment (e.g., Acknowledge)
const updateShiftAssignment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { acknowledged } = req.body;
        const updatedAssignment = yield prisma.shiftAssignment.update({
            where: { id: Number(id) },
            data: { acknowledged }
        });
        res.json(updatedAssignment);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to update shift assignment" });
    }
});
exports.updateShiftAssignment = updateShiftAssignment;
// Delete Shift Assignment
const deleteShiftAssignment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma.shiftAssignment.delete({
            where: { id: Number(id) }
        });
        res.json({ message: "Shift assignment deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ error: "Failed to delete shift assignment" });
    }
});
exports.deleteShiftAssignment = deleteShiftAssignment;
