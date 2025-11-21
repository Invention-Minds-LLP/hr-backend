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
exports.updateGrievanceStatus = exports.addGrievanceComment = exports.listGrievances = exports.createGrievance = void 0;
const express_async_handler_1 = __importDefault(require("express-async-handler"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// --- Create grievance
exports.createGrievance = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { title, description, category } = req.body;
    let employeeId = Number(req.body.employeeId);
    const grievance = yield prisma.grievance.create({
        data: { employeeId, title, description, category }
    });
    res.json(grievance);
}));
// --- List grievances
exports.listGrievances = (0, express_async_handler_1.default)((_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const grievances = yield prisma.grievance.findMany({
        include: { employee: true, comments: { include: { employee: true } } }
    });
    res.json(grievances);
}));
// --- Add comment
exports.addGrievanceComment = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const grievanceId = Number(req.params.id);
    const { comment } = req.body;
    let employeeId = Number(req.body.employeeId);
    const c = yield prisma.grievanceComment.create({
        data: { grievanceId, employeeId, comment }
    });
    res.json(c);
}));
// --- Update status
exports.updateGrievanceStatus = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const grievanceId = Number(req.params.id);
    const { status } = req.body;
    const g = yield prisma.grievance.update({
        where: { id: grievanceId },
        data: { status }
    });
    res.json(g);
}));
