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
exports.deleteDepartment = exports.updateDepartment = exports.getDepartmentById = exports.getDepartments = exports.createDepartment = void 0;
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
// Whitelist the planning/appraisal master fields a Department write may set.
const planningData = (body) => {
    const data = {};
    if (body.otBudgetHoursPerMonth !== undefined)
        data.otBudgetHoursPerMonth = Math.max(0, Number(body.otBudgetHoursPerMonth) || 0);
    if (body.minDailyStrength !== undefined)
        data.minDailyStrength = Math.max(0, Number(body.minDailyStrength) || 0);
    if (body.appraisalCycleBasis !== undefined)
        data.appraisalCycleBasis = body.appraisalCycleBasis === "CALENDAR" ? "CALENDAR" : "DOJ";
    if (body.appraisalPeriodMonths !== undefined)
        data.appraisalPeriodMonths = [6, 12].includes(Number(body.appraisalPeriodMonths)) ? Number(body.appraisalPeriodMonths) : 12;
    if (body.appraisalCalendarMonth !== undefined)
        data.appraisalCalendarMonth = body.appraisalCalendarMonth ? Math.min(12, Math.max(1, Number(body.appraisalCalendarMonth))) : null;
    return data;
};
// CREATE Department
const createDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name } = req.body;
        const department = yield prisma_1.prisma.department.create({
            data: Object.assign({ name }, planningData(req.body))
        });
        res.status(201).json(department);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to create department" });
    }
});
exports.createDepartment = createDepartment;
// GET all Departments
const getDepartments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const departments = yield prisma_1.prisma.department.findMany();
        res.json(departments);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch departments" });
    }
});
exports.getDepartments = getDepartments;
// GET Department by ID
const getDepartmentById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const department = yield prisma_1.prisma.department.findUnique({
            where: { id: Number(id) }
        });
        if (!department)
            return res.status(404).json({ error: "Department not found" });
        res.json(department);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch department" });
    }
});
exports.getDepartmentById = getDepartmentById;
// UPDATE Department
const updateDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name } = req.body;
        const updatedDepartment = yield prisma_1.prisma.department.update({
            where: { id: Number(id) },
            data: Object.assign(Object.assign({}, (name !== undefined ? { name } : {})), planningData(req.body))
        });
        res.json(updatedDepartment);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to update department" });
    }
});
exports.updateDepartment = updateDepartment;
// DELETE Department
const deleteDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma_1.prisma.department.delete({
            where: { id: Number(id) }
        });
        res.json({ message: "Department deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ error: "Failed to delete department" });
    }
});
exports.deleteDepartment = deleteDepartment;
