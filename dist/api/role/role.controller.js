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
exports.deleteRole = exports.updateRole = exports.getRoleById = exports.getRoles = exports.createRole = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// CREATE Role
const createRole = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, description } = req.body;
        const role = yield prisma.role.create({
            data: { name, description }
        });
        res.status(201).json(role);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to create role" });
    }
});
exports.createRole = createRole;
// GET all Roles
const getRoles = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const roles = yield prisma.role.findMany();
        res.json(roles);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch roles" });
    }
});
exports.getRoles = getRoles;
// GET Role by ID
const getRoleById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const role = yield prisma.role.findUnique({
            where: { id: Number(id) }
        });
        if (!role)
            return res.status(404).json({ error: "Role not found" });
        res.json(role);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch role" });
    }
});
exports.getRoleById = getRoleById;
// UPDATE Role
const updateRole = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, description } = req.body;
        const updatedRole = yield prisma.role.update({
            where: { id: Number(id) },
            data: { name, description }
        });
        res.json(updatedRole);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to update role" });
    }
});
exports.updateRole = updateRole;
// DELETE Role
const deleteRole = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma.role.delete({
            where: { id: Number(id) }
        });
        res.json({ message: "Role deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ error: "Failed to delete role" });
    }
});
exports.deleteRole = deleteRole;
