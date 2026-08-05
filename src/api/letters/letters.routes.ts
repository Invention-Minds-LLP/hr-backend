import { Router } from 'express';
import { authenticateToken } from '../../middleware/authMiddleware';
import {
  listTemplates, getTemplate, upsertTemplate, deleteTemplate, getTokens,
  previewLetter, issueLetter, downloadIssuedLetter, listIssued, listMyLetters,
  revokeIssued,
} from './letters.controller';

const router = Router();

// Reference data for the template editor
router.get('/tokens', authenticateToken, getTokens);

// Employee self-service — declared before the :id routes below.
router.get('/my', authenticateToken, listMyLetters);

// Issued-letter history
router.get('/issued',                authenticateToken, listIssued);
router.get('/issued/:id/pdf',        authenticateToken, downloadIssuedLetter);
router.patch('/issued/:id/revoke',   authenticateToken, revokeIssued);

// Render + issue
router.post('/preview', authenticateToken, previewLetter);
router.post('/issue',   authenticateToken, issueLetter);

// Templates
router.get('/templates',        authenticateToken, listTemplates);
router.post('/templates',       authenticateToken, upsertTemplate);
router.get('/templates/:id',    authenticateToken, getTemplate);
router.patch('/templates/:id',  authenticateToken, upsertTemplate);
router.delete('/templates/:id', authenticateToken, deleteTemplate);

export default router;
