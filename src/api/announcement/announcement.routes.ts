import { Router } from 'express';
import * as ann from './announcement.controller';

const router = Router();

// Create an announcement
router.post('/', ann.createAnnouncement);

// Acknowledge the latest/live announcement (or pass :id explicitly)
router.post('/:id/ack', ann.ackAnnouncement);

// List live + ack stats (rate, counts)
router.get('/live', ann.listLiveAnnouncementsWithStats);

export default router;
