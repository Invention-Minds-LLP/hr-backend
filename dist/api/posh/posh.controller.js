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
exports.getHearings = exports.updatePoshStatus = exports.addHearing = exports.listPoshCases = exports.createPoshCase = void 0;
const express_async_handler_1 = __importDefault(require("express-async-handler"));
// import { PrismaClient, PermissionStatus } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
// --- File POSH case
exports.createPoshCase = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { accusedId, description } = req.body;
    let complainantId = req.body.complainantId;
    complainantId = Number(complainantId);
    const posh = yield prisma_1.prisma.poshCase.create({
        data: { complainantId, accusedId, description }
    });
    const hrEmployees = yield prisma_1.prisma.employee.findMany({
        where: {
            departmentId: 1 // ✅ HR department
        },
        select: { id: true }
    });
    for (const hr of hrEmployees) {
        yield (0, notifications_controller_1.createNotification)(hr.id, 'New posh submitted — requires acknowledgment.');
    }
    res.json(posh);
}));
// --- List POSH cases
exports.listPoshCases = (0, express_async_handler_1.default)((_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const cases = yield prisma_1.prisma.poshCase.findMany({
        include: { complainant: true, accused: true, hearings: true }
    });
    res.json(cases);
}));
// --- Add hearing
exports.addHearing = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const poshId = Number(req.params.id);
    const { date, notes, outcome } = req.body;
    const hearing = yield prisma_1.prisma.poshHearing.create({
        data: { poshId, date, notes, outcome }
    });
    res.json(hearing);
}));
// --- Update status
exports.updatePoshStatus = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const poshId = Number(req.params.id);
    const { status, committeeNote } = req.body;
    const posh = yield prisma_1.prisma.poshCase.update({
        where: { id: poshId },
        data: { status, committeeNote }
    });
    res.json(posh);
}));
// --- Get hearings by Case ID
exports.getHearings = (0, express_async_handler_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const poshId = Number(req.params.id);
    const hearings = yield prisma_1.prisma.poshHearing.findMany({
        where: { poshId },
        orderBy: { date: 'asc' },
    });
    res.json(hearings);
}));
