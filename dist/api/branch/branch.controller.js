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
exports.deleteBranch = exports.updateBranch = exports.getBranchById = exports.getBranches = exports.createBranch = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// CREATE Branch
const createBranch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, location } = req.body;
        const branch = yield prisma.branch.create({
            data: { name, location }
        });
        res.status(201).json(branch);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to create branch" });
    }
});
exports.createBranch = createBranch;
// GET all Branches
const getBranches = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const branches = yield prisma.branch.findMany();
        res.json(branches);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch branches" });
    }
});
exports.getBranches = getBranches;
// GET Branch by ID
const getBranchById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const branch = yield prisma.branch.findUnique({
            where: { id: Number(id) }
        });
        if (!branch)
            return res.status(404).json({ error: "Branch not found" });
        res.json(branch);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch branch" });
    }
});
exports.getBranchById = getBranchById;
// UPDATE Branch
const updateBranch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, location } = req.body;
        const updatedBranch = yield prisma.branch.update({
            where: { id: Number(id) },
            data: { name, location }
        });
        res.json(updatedBranch);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to update branch" });
    }
});
exports.updateBranch = updateBranch;
// DELETE Branch
const deleteBranch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma.branch.delete({
            where: { id: Number(id) }
        });
        res.json({ message: "Branch deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ error: "Failed to delete branch" });
    }
});
exports.deleteBranch = deleteBranch;
