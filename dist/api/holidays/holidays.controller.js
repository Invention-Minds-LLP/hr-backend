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
exports.deleteHoliday = exports.updateHoliday = exports.getHolidaysByYear = exports.addHoliday = exports.createHolidayCalendar = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
/**
 * Create holiday calendar for a year
 * POST /api/holidays/calendar
 */
const createHolidayCalendar = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { year, name } = req.body;
        if (!year || !name) {
            return res.status(400).json({ message: "Year and name are required" });
        }
        const calendar = yield prisma.holidayCalendar.create({
            data: { year, name }
        });
        res.status(201).json(calendar);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
});
exports.createHolidayCalendar = createHolidayCalendar;
/**
 * Add holiday to calendar
 * POST /api/holidays/calendar/:calendarId
 */
const addHoliday = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { calendarId } = req.params;
        const { title, date, description, isOptional } = req.body;
        if (!title || !date) {
            return res.status(400).json({ message: "Title and date are required" });
        }
        const holiday = yield prisma.holiday.create({
            data: {
                calendarId: Number(calendarId),
                title,
                date: new Date(date),
                description,
                isOptional: isOptional !== null && isOptional !== void 0 ? isOptional : false
            }
        });
        res.status(201).json(holiday);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
});
exports.addHoliday = addHoliday;
/**
 * Get holidays by year
 * GET /api/holidays/calendar/:year
 */
const getHolidaysByYear = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { year } = req.params;
        const calendar = yield prisma.holidayCalendar.findUnique({
            where: { year: Number(year) },
            include: {
                holidays: {
                    orderBy: { date: "asc" }
                }
            }
        });
        if (!calendar) {
            return res.status(404).json({ message: "Holiday calendar not found" });
        }
        res.json(calendar);
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
});
exports.getHolidaysByYear = getHolidaysByYear;
/**
 * Update holiday
 * PUT /api/holidays/holiday/:id
 */
const updateHoliday = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const holiday = yield prisma.holiday.update({
            where: { id: Number(id) },
            data: req.body
        });
        res.json(holiday);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
});
exports.updateHoliday = updateHoliday;
/**
 * Delete holiday
 * DELETE /api/holidays/holiday/:id
 */
const deleteHoliday = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma.holiday.delete({
            where: { id: Number(id) }
        });
        res.json({ message: "Holiday deleted successfully" });
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
});
exports.deleteHoliday = deleteHoliday;
