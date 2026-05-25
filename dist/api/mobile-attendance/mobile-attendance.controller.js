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
exports.getPunchHistory = exports.getTodayPunches = exports.recordPunch = void 0;
const prisma_1 = require("../../lib/prisma");
const comOff_service_1 = require("../../services/comOff.service");
const biometric_controller_1 = require("../biometric/biometric.controller");
/**
 * POST /api/mobile-attendance/punch
 * Record a check-in or check-out punch with photo + GPS
 */
const recordPunch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, type, activityType, latitude, longitude, address, photoUrl, notes } = req.body;
        if (!employeeId || !type || !activityType || latitude == null || longitude == null) {
            return res.status(400).json({ message: "employeeId, type, activityType, latitude, and longitude are required" });
        }
        if (!["CHECK_IN", "CHECK_OUT"].includes(type)) {
            return res.status(400).json({ message: "type must be CHECK_IN or CHECK_OUT" });
        }
        if (!["OFFICE", "CLIENT_VISIT", "FIELD_WORK"].includes(activityType)) {
            return res.status(400).json({ message: "activityType must be OFFICE, CLIENT_VISIT, or FIELD_WORK" });
        }
        const now = new Date();
        // Create the punch record
        const punch = yield prisma_1.prisma.attendancePunch.create({
            data: {
                employeeId: Number(employeeId),
                type,
                activityType,
                timestamp: now,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                address: address || null,
                photoUrl: photoUrl || null,
                notes: notes || null,
            },
        });
        // If this is a CHECK_IN, upsert the daily Attendance record
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (type === "CHECK_IN") {
            const existing = yield prisma_1.prisma.attendance.findUnique({
                where: { employeeId_date: { employeeId: Number(employeeId), date: todayStart } },
            });
            if (!existing) {
                yield prisma_1.prisma.attendance.create({
                    data: {
                        employeeId: Number(employeeId),
                        date: todayStart,
                        status: "Present",
                        checkIn: now,
                    },
                });
            }
            // Mirror biometric: cancel any approved/pending leave for today
            try {
                yield (0, biometric_controller_1.autoCancelLeaveIfPresent)(Number(employeeId), todayStart);
            }
            catch (e) {
                console.error("[mobile-punch] autoCancelLeaveIfPresent failed", e);
            }
            // Compute late-login now (OT skipped here because checkOut isn't set yet)
            try {
                yield (0, biometric_controller_1.runOtAndLateLoginForDate)(todayStart);
            }
            catch (e) {
                console.error("[mobile-punch] runOtAndLateLoginForDate (CHECK_IN) failed", e);
            }
        }
        // If this is a CHECK_OUT, update the daily Attendance record's checkOut
        if (type === "CHECK_OUT") {
            yield prisma_1.prisma.attendance.updateMany({
                where: { employeeId: Number(employeeId), date: todayStart },
                data: { checkOut: now },
            });
            // Mirror biometric downstream: comp-off + late/OT (TEMP_DEPT_SHIFT path)
            const updated = yield prisma_1.prisma.attendance.findUnique({
                where: { employeeId_date: { employeeId: Number(employeeId), date: todayStart } },
            });
            if (updated) {
                try {
                    yield (0, comOff_service_1.generateCompOffIfEligible)(updated);
                }
                catch (e) {
                    console.error("[mobile-punch] generateCompOffIfEligible failed", e);
                }
            }
            try {
                yield (0, biometric_controller_1.runOtAndLateLoginForDate)(todayStart);
            }
            catch (e) {
                console.error("[mobile-punch] runOtAndLateLoginForDate failed", e);
            }
        }
        return res.status(201).json({ message: "Punch recorded successfully", punch });
    }
    catch (error) {
        console.error("Error recording punch:", error);
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.recordPunch = recordPunch;
/**
 * GET /api/mobile-attendance/today/:employeeId
 * Get all punches for today
 */
const getTodayPunches = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        if (!employeeId)
            return res.status(400).json({ message: "employeeId is required" });
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);
        const punches = yield prisma_1.prisma.attendancePunch.findMany({
            where: {
                employeeId,
                timestamp: { gte: todayStart, lt: todayEnd },
            },
            orderBy: { timestamp: "asc" },
        });
        // Also get the daily attendance record
        const attendance = yield prisma_1.prisma.attendance.findUnique({
            where: { employeeId_date: { employeeId, date: todayStart } },
        });
        return res.json({ punches, attendance });
    }
    catch (error) {
        console.error("Error fetching today punches:", error);
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getTodayPunches = getTodayPunches;
/**
 * GET /api/mobile-attendance/history/:employeeId?start=&end=
 * Get punch history for a date range
 */
const getPunchHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        const start = req.query.start;
        const end = req.query.end;
        if (!employeeId)
            return res.status(400).json({ message: "employeeId is required" });
        const where = { employeeId };
        if (start && end) {
            where.timestamp = { gte: new Date(start), lte: new Date(end) };
        }
        const punches = yield prisma_1.prisma.attendancePunch.findMany({
            where,
            orderBy: { timestamp: "desc" },
            take: 100,
        });
        return res.json(punches);
    }
    catch (error) {
        console.error("Error fetching punch history:", error);
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
});
exports.getPunchHistory = getPunchHistory;
