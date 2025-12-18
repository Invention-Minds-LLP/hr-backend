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
exports.getDesignationById = exports.getDesignations = exports.createDesignation = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
/* ==========================
   DESIGNATION CONTROLLERS
   ========================== */
// Create Designation
const createDesignation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, isActive = true } = req.body;
        if (!name) {
            return res.status(400).json({ error: "Designation name is required" });
        }
        const designation = yield prisma.designation.create({
            data: {
                name,
                isActive
            }
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
        const designations = yield prisma.designation.findMany({
            orderBy: { name: "asc" }
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
        const designation = yield prisma.designation.findUnique({
            where: { id: Number(id) }
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
