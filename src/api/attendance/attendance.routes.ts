import { Router } from 'express';
import { getAttendanceCalendar } from './attendance.controller';

const router = Router();

//  GET /api/attendance-calendar/:employeeId?month=YYYY-MM
router.get('/:employeeId', getAttendanceCalendar);

export default router;
