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
exports.updateTest = exports.getAllTests = exports.createTest = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const createTest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, questionBankId, duration, passingPercent, maxAttempts, role, level, purpose, // 'HIRING' | 'TRAINING' | 'ASSESSMENT' | 'OTHER'
        randomization, // 'NONE' | 'SHUFFLE_QUESTIONS' | 'SHUFFLE_OPTIONS' | 'BOTH'
        instructions, isPublished, activeFrom, activeTo } = req.body;
        const test = yield prisma.evaluationTest.create({
            data: {
                name,
                questionBankId,
                duration,
                passingPercent,
                maxAttempts,
                role: role !== null && role !== void 0 ? role : null,
                level: level !== null && level !== void 0 ? level : null,
                purpose: purpose !== null && purpose !== void 0 ? purpose : null,
                randomization: randomization !== null && randomization !== void 0 ? randomization : 'NONE',
                instructions: instructions !== null && instructions !== void 0 ? instructions : null,
                isPublished: isPublished !== null && isPublished !== void 0 ? isPublished : true,
                activeFrom: activeFrom ? new Date(activeFrom) : null,
                activeTo: activeTo ? new Date(activeTo) : null
            }
        });
        res.status(201).json(test);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create evaluation test' });
    }
});
exports.createTest = createTest;
const getAllTests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const tests = yield prisma.evaluationTest.findMany({
            include: { questions: true }
        });
        const bankIds = [...new Set(tests.map(t => t.questionBankId))];
        const banks = yield prisma.questionBank.findMany({
            where: { id: { in: bankIds } },
            select: { id: true, name: true }
        });
        const bankMap = Object.fromEntries(banks.map(b => [b.id, b.name]));
        const shaped = tests.map(t => {
            var _a;
            return (Object.assign(Object.assign({}, t), { questionBankName: (_a = bankMap[t.questionBankId]) !== null && _a !== void 0 ? _a : null }));
        });
        res.json(shaped);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch tests' });
    }
});
exports.getAllTests = getAllTests;
const updateTest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { name, questionBankId, duration, passingPercent, maxAttempts, role, level, purpose, randomization, instructions, isPublished, activeFrom, activeTo } = req.body;
        const updated = yield prisma.evaluationTest.update({
            where: { id },
            data: {
                name,
                questionBankId,
                duration,
                passingPercent,
                maxAttempts,
                role: role !== null && role !== void 0 ? role : null,
                level: level !== null && level !== void 0 ? level : null,
                purpose: purpose !== null && purpose !== void 0 ? purpose : null,
                randomization: randomization !== null && randomization !== void 0 ? randomization : 'NONE',
                instructions: instructions !== null && instructions !== void 0 ? instructions : null,
                isPublished: isPublished !== null && isPublished !== void 0 ? isPublished : false,
                activeFrom: activeFrom ? new Date(activeFrom) : null,
                activeTo: activeTo ? new Date(activeTo) : null,
            }
        });
        res.json(updated);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to update evaluation test' });
    }
});
exports.updateTest = updateTest;
