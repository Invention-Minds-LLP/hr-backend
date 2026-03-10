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
exports.closeIdleSessions = void 0;
const prisma_1 = require("../lib/prisma");
const closeIdleSessions = () => __awaiter(void 0, void 0, void 0, function* () {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const sessions = yield prisma_1.prisma.locationSession.findMany({
        where: {
            status: "ACTIVE"
        }
    });
    for (const session of sessions) {
        const lastPoint = yield prisma_1.prisma.locationPoint.findFirst({
            where: { sessionId: session.id },
            orderBy: { recordedAt: "desc" }
        });
        if (!lastPoint || lastPoint.recordedAt < cutoff) {
            yield prisma_1.prisma.locationSession.update({
                where: { id: session.id },
                data: {
                    status: "COMPLETED",
                    endedAt: new Date()
                }
            });
        }
    }
});
exports.closeIdleSessions = closeIdleSessions;
