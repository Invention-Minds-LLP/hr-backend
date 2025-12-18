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
exports.updateQuestion = exports.deleteQuestion = exports.createQuestion = exports.getQuestionsByBank = void 0;
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const getQuestionsByBank = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const bankId = Number(req.params.bankId);
        const questions = yield prisma_1.prisma.question.findMany({
            where: { questionBankId: bankId },
            include: { options: true }
        });
        res.json(questions);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch questions' });
    }
});
exports.getQuestionsByBank = getQuestionsByBank;
const createQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { questionBankId, text, type, weight, options } = req.body;
        const question = yield prisma_1.prisma.question.create({
            data: {
                questionBankId,
                text,
                type,
                weight,
                options: {
                    create: options !== null && options !== void 0 ? options : [] // Only for MCQs
                }
            },
            include: { options: true }
        });
        res.status(201).json(question);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create question' });
    }
});
exports.createQuestion = createQuestion;
const deleteQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        yield prisma_1.prisma.questionOption.deleteMany({ where: { questionId: id } });
        yield prisma_1.prisma.question.delete({ where: { id } });
        res.json({ message: 'Deleted' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete question' });
    }
});
exports.deleteQuestion = deleteQuestion;
// controllers/questions.ts
const updateQuestion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { text, type, weight, answerType, options } = req.body;
        yield prisma_1.prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Update question fields
            yield tx.question.update({
                where: { id },
                data: { text, type, weight }
                // (store answerType too if you add a DB column for it)
            });
            // Clear options if not descriptive; else remove any existing
            yield tx.questionOption.deleteMany({ where: { questionId: id } });
            if (type !== 'Descriptive' && Array.isArray(options) && options.length) {
                yield tx.questionOption.createMany({
                    data: options.map((o) => ({
                        questionId: id,
                        text: o.text,
                        isCorrect: !!o.isCorrect
                    }))
                });
            }
        }));
        const updated = yield prisma_1.prisma.question.findUnique({
            where: { id },
            include: { options: true }
        });
        res.json(updated);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update question' });
    }
});
exports.updateQuestion = updateQuestion;
