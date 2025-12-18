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
exports.getQuestionBankById = exports.deleteQuestionBank = exports.updateQuestionBank = exports.createQuestionBank = exports.getAllQuestionBanks = void 0;
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const getAllQuestionBanks = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const banks = yield prisma_1.prisma.questionBank.findMany({
            include: { questions: true },
        });
        res.json(banks);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch question banks' });
    }
});
exports.getAllQuestionBanks = getAllQuestionBanks;
const createQuestionBank = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, role, departmentId, difficulty, createdBy } = req.body;
        const bank = yield prisma_1.prisma.questionBank.create({
            data: {
                name,
                role,
                departmentId,
                difficulty,
                createdBy,
            },
        });
        res.status(201).json(bank);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create question bank' });
    }
});
exports.createQuestionBank = createQuestionBank;
const updateQuestionBank = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { name, role, departmentId, difficulty } = req.body;
        const updated = yield prisma_1.prisma.questionBank.update({
            where: { id: Number(id) },
            data: { name, role, departmentId, difficulty },
        });
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update question bank' });
    }
});
exports.updateQuestionBank = updateQuestionBank;
const deleteQuestionBank = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma_1.prisma.questionBank.delete({ where: { id: Number(id) } });
        res.json({ message: 'Deleted successfully' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete question bank' });
    }
});
exports.deleteQuestionBank = deleteQuestionBank;
const getQuestionBankById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'Invalid id' });
        }
        const bank = yield prisma_1.prisma.questionBank.findUnique({
            where: { id },
            include: {
                questions: {
                    include: {
                        options: true, // include MCQ options if you use them
                    },
                },
            },
        });
        if (!bank) {
            return res.status(404).json({ error: 'Question bank not found' });
        }
        res.json(bank);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch question bank' });
    }
});
exports.getQuestionBankById = getQuestionBankById;
