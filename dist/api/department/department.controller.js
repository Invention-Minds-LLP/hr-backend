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
// CREATE Department
const createDepartment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name } = req.body;
        const department = yield prisma_1.prisma.department.create({
            data: { name }
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
            data: { name }
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
