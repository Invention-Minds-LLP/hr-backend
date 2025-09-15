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
exports.listShiftTemplates = exports.assignRotational = exports.addRotationItemsBulk = exports.addRotationItem = exports.createRotationPattern = exports.listRotationPatterns = exports.deleteShiftAssignment = exports.updateShiftAssignment = exports.getShiftAssignmentsByEmployee = exports.getShiftAssignments = exports.assignShift = exports.deleteShiftTemplate = exports.updateShiftTemplate = exports.getShiftTemplateById = exports.getShiftTemplates = exports.createShiftTemplate = void 0;
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
// -------- Utils
const DAY_MS = 24 * 60 * 60 * 1000;
const mod = (n, m) => ((n % m) + m) % m;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/**
 * Generate ShiftAssignment rows for an employee for a window of days,
 * based on EmployeeShiftSetting (ROTATIONAL or FIXED).
 * For ROTATIONAL, use ShiftRotationPattern + items.
 */
function generateAssignmentsForWindow(employeeId, fromDate, days) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const setting = yield prisma.employeeShiftSetting.findUnique({
            where: { employeeId },
            include: {
                rotationPattern: {
                    include: {
                        items: { include: { shift: true } }
                    }
                }
            }
        });
        if (!setting)
            throw new Error('EmployeeShiftSetting not found');
        // For simplicity, delete any existing assignments in the window and recreate.
        const from = startOfDay(fromDate);
        const to = startOfDay(new Date(from.getTime() + (days - 1) * DAY_MS));
        yield prisma.shiftAssignment.deleteMany({
            where: {
                employeeId,
                date: { gte: from, lte: to }
            }
        });
        const rows = [];
        if (setting.mode === client_1.ShiftAssignMode.FIXED) {
            if (!setting.fixedShiftId)
                throw new Error('fixedShiftId missing for FIXED mode');
            for (let i = 0; i < days; i++) {
                const date = new Date(from.getTime() + i * DAY_MS);
                rows.push({
                    employeeId,
                    shiftId: setting.fixedShiftId,
                    date,
                    acknowledged: false
                });
            }
        }
        else {
            // ROTATIONAL
            const pattern = setting.rotationPattern;
            if (!pattern)
                throw new Error('rotationPattern missing for ROTATIONAL mode');
            const items = [...pattern.items].sort((a, b) => a.dayIndex - b.dayIndex);
            if (!items.length)
                throw new Error('rotationPattern has no items');
            const cycle = pattern.cycleDays > 0 ? pattern.cycleDays : items.length;
            const start = startOfDay(new Date(setting.startDate));
            for (let i = 0; i < days; i++) {
                const date = new Date(from.getTime() + i * DAY_MS);
                const diffDays = Math.floor((date.getTime() - start.getTime()) / DAY_MS);
                const idx = mod(diffDays, cycle);
                const item = (_a = items.find((x) => x.dayIndex === idx)) !== null && _a !== void 0 ? _a : items[idx];
                if (!item)
                    throw new Error(`No rotation item for index ${idx}`);
                rows.push({
                    employeeId,
                    shiftId: item.shiftId,
                    date,
                    acknowledged: false
                });
            }
        }
        if (rows.length) {
            yield prisma.shiftAssignment.createMany({ data: rows });
        }
    });
}
// -------- Rotation patterns
const listRotationPatterns = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const patterns = yield prisma.shiftRotationPattern.findMany({
            where: { isActive: true },
            orderBy: { id: 'asc' },
            include: {
                items: {
                    orderBy: { dayIndex: 'asc' },
                    include: { shift: true }
                }
            }
        });
        res.json(patterns);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to fetch rotation patterns' });
    }
});
exports.listRotationPatterns = listRotationPatterns;
const createRotationPattern = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, cycleDays, isActive = true } = req.body;
        const p = yield prisma.shiftRotationPattern.create({
            data: { name, cycleDays, isActive }
        });
        res.status(201).json(p);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to create rotation pattern' });
    }
});
exports.createRotationPattern = createRotationPattern;
const addRotationItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const patternId = Number(req.params.patternId);
        const { dayIndex, shiftId } = req.body;
        const item = yield prisma.shiftRotationItem.create({
            data: { patternId, dayIndex, shiftId }
        });
        res.status(201).json(item);
    }
    catch (e) {
        console.error(e);
        // likely unique(dayIndex) violation
        res.status(500).json({ error: ((_a = e === null || e === void 0 ? void 0 : e.meta) === null || _a === void 0 ? void 0 : _a.cause) || 'Failed to add rotation item' });
    }
});
exports.addRotationItem = addRotationItem;
// (Optional) bulk add items
const addRotationItemsBulk = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const patternId = Number(req.params.patternId);
        const items = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.items) || [];
        // Up to you if you want to validate duplicates here.
        yield prisma.shiftRotationItem.createMany({
            data: items.map((i) => (Object.assign(Object.assign({}, i), { patternId }))),
            skipDuplicates: true
        });
        const out = yield prisma.shiftRotationItem.findMany({
            where: { patternId },
            orderBy: { dayIndex: 'asc' }
        });
        res.status(201).json(out);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to add rotation items' });
    }
});
exports.addRotationItemsBulk = addRotationItemsBulk;
// -------- Assign rotational to employee
const assignRotational = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, patternId, startDate } = req.body;
        const start = startDate ? new Date(startDate) : new Date();
        // Upsert EmployeeShiftSetting (employeeId is unique)
        yield prisma.employeeShiftSetting.upsert({
            where: { employeeId },
            update: {
                mode: 'ROTATIONAL',
                rotationPatternId: patternId,
                fixedShiftId: null,
                startDate: start
            },
            create: {
                employeeId,
                mode: 'ROTATIONAL',
                rotationPatternId: patternId,
                startDate: start
            }
        });
        // Generate next 30 days of assignments
        yield generateAssignmentsForWindow(employeeId, start, 30);
        res.json({ ok: true });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: (e === null || e === void 0 ? void 0 : e.message) || 'Failed to assign rotational' });
    }
});
exports.assignRotational = assignRotational;
// -------- (Optional) templates
const listShiftTemplates = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = yield prisma.shiftTemplate.findMany({
            orderBy: { id: 'asc' }
        });
        res.json(rows);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to fetch shift templates' });
    }
});
exports.listShiftTemplates = listShiftTemplates;
