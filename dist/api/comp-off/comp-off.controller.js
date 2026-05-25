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
exports.deleteCompOff = exports.createCompOff = exports.getCompOffCredits = void 0;
const prisma_1 = require("../../lib/prisma");
const getCompOffCredits = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, status } = req.query;
        const where = {};
        if (employeeId)
            where.employeeId = Number(employeeId);
        if (status === 'used')
            where.used = true;
        if (status === 'unused')
            where.used = false;
        const credits = yield prisma_1.prisma.compOffCredit.findMany({
            where,
            include: {
                employee: { select: { employeeCode: true, firstName: true, lastName: true, Department: { select: { name: true } } } },
            },
            orderBy: { createdAt: "desc" },
        });
        return res.json(credits);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getCompOffCredits = getCompOffCredits;
const createCompOff = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, workDate, expiryDate, grantedBy, grantReason } = req.body;
        if (!employeeId || !workDate) {
            return res.status(400).json({ error: "employeeId and workDate are required" });
        }
        const credit = yield prisma_1.prisma.compOffCredit.create({
            data: {
                employeeId: Number(employeeId),
                workDate: new Date(workDate),
                expiryDate: expiryDate ? new Date(expiryDate) : new Date(new Date(workDate).setMonth(new Date(workDate).getMonth() + 3)),
                isManualGrant: true,
                grantedBy: grantedBy ? Number(grantedBy) : null,
                grantReason: grantReason || null,
            },
            include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
        });
        return res.status(201).json(credit);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.createCompOff = createCompOff;
const deleteCompOff = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const credit = yield prisma_1.prisma.compOffCredit.findUnique({ where: { id } });
        if (!credit)
            return res.status(404).json({ error: "Comp off not found" });
        if (credit.used)
            return res.status(400).json({ error: "Cannot delete a used comp off" });
        yield prisma_1.prisma.compOffCredit.delete({ where: { id } });
        return res.json({ message: "Comp off deleted" });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.deleteCompOff = deleteCompOff;
