import { Router } from 'express';
import { approveAttendance, getAttendanceCalendar, getAttendanceHistory, getMonthlyAttendanceRegister, getTodayAttendanceList, getWeeklyAttendance } from './attendance.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

//  GET /api/attendance-calendar/:employeeId?month=YYYY-MM
router.get('/today', getTodayAttendanceList);
router.get('/history', getAttendanceHistory);
router.get('/register', getMonthlyAttendanceRegister);

router.get('/:employeeId', authenticateToken, getAttendanceCalendar);

router.get("/", authenticateToken, getWeeklyAttendance);
router.post("/approve", authenticateToken, approveAttendance);



export default router;
