import { Router } from "express";
import {
  createHolidayCalendar,
  addHoliday,
  getHolidaysByYear,
  updateHoliday,
  deleteHoliday
} from "./holidays.controller";

const router = Router();

/** Holiday Calendar */
router.post("/calendar", createHolidayCalendar);
router.get("/calendar/:year", getHolidaysByYear);

/** Holiday */
router.post("/calendar/:calendarId", addHoliday);
router.put("/holiday/:id", updateHoliday);
router.delete("/holiday/:id", deleteHoliday);

export default router;
