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
exports.deleteDesignation = exports.updateDesignation = exports.getDesignationById = exports.getDesignations = exports.createDesignation = void 0;
const prisma_1 = require("../../lib/prisma");
// Create Designation
const createDesignation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, isActive = true } = req.body;
        if (!name) {
            return res.status(400).json({ error: "Designation name is required" });
        }
        const designation = yield prisma_1.prisma.designation.create({
            data: { name, isActive },
        });
        res.status(201).json(designation);
    }
    catch (error) {
        console.error("Error creating designation:", error);
        if (error.code === "P2002") {
            return res.status(409).json({ error: "Designation already exists" });
        }
        res.status(500).json({ error: "Failed to create designation" });
    }
});
exports.createDesignation = createDesignation;
// Get All Designations
const getDesignations = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const designations = yield prisma_1.prisma.designation.findMany({
            orderBy: { name: "asc" },
        });
        res.json(designations);
    }
    catch (error) {
        console.error("Error fetching designations:", error);
        res.status(500).json({ error: "Failed to fetch designations" });
    }
});
exports.getDesignations = getDesignations;
// Get Single Designation by ID
const getDesignationById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const designation = yield prisma_1.prisma.designation.findUnique({
            where: { id: Number(id) },
        });
        if (!designation) {
            return res.status(404).json({ error: "Designation not found" });
        }
        res.json(designation);
    }
    catch (error) {
        console.error("Error fetching designation:", error);
        res.status(500).json({ error: "Failed to fetch designation" });
    }
});
exports.getDesignationById = getDesignationById;
// Update Designation
const updateDesignation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, isActive } = req.body;
        const designation = yield prisma_1.prisma.designation.update({
            where: { id: Number(id) },
            data: Object.assign(Object.assign({}, (name !== undefined && { name })), (isActive !== undefined && { isActive })),
        });
        res.json(designation);
    }
    catch (error) {
        console.error("Error updating designation:", error);
        if (error.code === "P2025") {
            return res.status(404).json({ error: "Designation not found" });
        }
        if (error.code === "P2002") {
            return res.status(409).json({ error: "Designation name already exists" });
        }
        res.status(500).json({ error: "Failed to update designation" });
    }
});
exports.updateDesignation = updateDesignation;
// Delete Designation
const deleteDesignation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma_1.prisma.designation.delete({ where: { id: Number(id) } });
        res.json({ message: "Designation deleted successfully" });
    }
    catch (error) {
        console.error("Error deleting designation:", error);
        if (error.code === "P2025") {
            return res.status(404).json({ error: "Designation not found" });
        }
        res.status(500).json({ error: "Failed to delete designation" });
    }
});
exports.deleteDesignation = deleteDesignation;
