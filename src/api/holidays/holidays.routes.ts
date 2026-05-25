import { Router } from "express";
import {
  createHolidayCalendar,
  addHoliday,
  getHolidaysByYear,
  updateHoliday,
  deleteHoliday
} from "./holidays.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

// All holiday endpoints require a valid login.
router.use(authenticateToken);

/** Holiday Calendar */
router.post("/calendar", createHolidayCalendar);
router.get("/calendar/:year", getHolidaysByYear);

/** Holiday */
router.post("/calendar/:calendarId", addHoliday);
router.put("/holiday/:id", updateHoliday);
router.delete("/holiday/:id", deleteHoliday);

export default router;
