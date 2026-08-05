import { Router } from 'express';
import { authenticateToken } from '../../middleware/authMiddleware';
import {
  getTaxProfile,
  updateTaxProfile,
  getDeclaration,
  saveDeclaration,
  submitDeclaration,
  reviewDeclaration,
  listDeclarations,
  getRegimeComparison,
  getTaxProjection,
  getDeclarationSections,
} from './tax.controller';
import { downloadForm16, emailForm16Batch, listForm16 } from './form16';

const router = Router();

// Reference data for the declaration form
router.get('/sections', authenticateToken, getDeclarationSections);

// ── Employee self-service ─────────────────────────────────────────────────────
// No :employeeId → acts on the caller (req.user.employeeId).
router.get('/profile',        authenticateToken, getTaxProfile);
router.patch('/profile',      authenticateToken, updateTaxProfile);
router.get('/declaration',    authenticateToken, getDeclaration);
router.post('/declaration',   authenticateToken, saveDeclaration);
router.post('/declaration/submit', authenticateToken, submitDeclaration);
router.get('/projection',     authenticateToken, getTaxProjection);
router.get('/comparison',     authenticateToken, getRegimeComparison);

// ── HR ────────────────────────────────────────────────────────────────────────
router.get('/declarations',   authenticateToken, listDeclarations);
router.patch('/declarations/:id/review', authenticateToken, reviewDeclaration);

// Per-employee views for HR. Declared after the self-service routes so the
// literal paths above are matched first.
router.get('/profile/:employeeId',    authenticateToken, getTaxProfile);
router.patch('/profile/:employeeId',  authenticateToken, updateTaxProfile);
router.get('/projection/:employeeId', authenticateToken, getTaxProjection);
router.get('/comparison/:employeeId', authenticateToken, getRegimeComparison);

// ── Form 16 ───────────────────────────────────────────────────────────────────
router.get('/form16',            authenticateToken, listForm16);
router.post('/form16/email',     authenticateToken, emailForm16Batch);
router.get('/form16/download',   authenticateToken, downloadForm16);
router.get('/form16/download/:employeeId', authenticateToken, downloadForm16);

export default router;
