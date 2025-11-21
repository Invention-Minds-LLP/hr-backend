import { Router } from 'express';
import { getAttendanceCalendar, getWeeklyAttendance } from './attendance.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

//  GET /api/attendance-calendar/:employeeId?month=YYYY-MM
router.get('/:employeeId', authenticateToken, getAttendanceCalendar);

router.get("/", authenticateToken, getWeeklyAttendance);

export default router;
