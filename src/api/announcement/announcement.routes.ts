import { Router } from 'express';
import multer from 'multer';
import * as ann from './announcement.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

// Allowed attachment types for announcements.
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB per file
    files: 10,                  // max 10 attachments
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

// Create an announcement. Authenticate BEFORE parsing the upload so anonymous
// requests can't write files to disk.
router.post('/', authenticateToken, upload.array('attachments', 10), ann.createAnnouncement);

// Acknowledge the latest/live announcement (or pass :id explicitly)
router.post('/:id/ack',authenticateToken, ann.ackAnnouncement);

// List live + ack stats (rate, counts)
router.get('/live',authenticateToken, ann.listLiveAnnouncementsWithStats);

// List all announcements (employee)
router.get('/live-employee',authenticateToken, ann.listLiveForEmployee);

router.get('/live/all', authenticateToken, ann.listAllLiveForEmployee);

export default router;
