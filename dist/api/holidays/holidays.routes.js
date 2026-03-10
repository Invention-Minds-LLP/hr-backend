"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const holidays_controller_1 = require("./holidays.controller");
const router = (0, express_1.Router)();
/** Holiday Calendar */
router.post("/calendar", holidays_controller_1.createHolidayCalendar);
router.get("/calendar/:year", holidays_controller_1.getHolidaysByYear);
/** Holiday */
router.post("/calendar/:calendarId", holidays_controller_1.addHoliday);
router.put("/holiday/:id", holidays_controller_1.updateHoliday);
router.delete("/holiday/:id", holidays_controller_1.deleteHoliday);
exports.default = router;
