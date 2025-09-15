import { Router } from 'express';
import multer from 'multer';
import * as ann from './announcement.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();
const upload = multer({ dest: 'uploads/' });

// Create an announcement
router.post('/', upload.array('attachments', 10), ann.createAnnouncement);

// Acknowledge the latest/live announcement (or pass :id explicitly)
router.post('/:id/ack', ann.ackAnnouncement);

// List live + ack stats (rate, counts)
router.get('/live', ann.listLiveAnnouncementsWithStats);

// List all announcements (employee)
router.get('/live-employee',authenticateToken, ann.listLiveForEmployee);

export default router;
