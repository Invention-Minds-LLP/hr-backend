import { Router } from 'express';
import { authenticateToken } from '../../middleware/authMiddleware';
import {
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  setDefaultCompany,
  assignEmployees,
  runCompanyBackfill,
  getDefault,
  listStatutoryConfigs,
  upsertStatutoryConfig,
  deleteStatutoryConfig,
} from './company.controller';

const router = Router();

// Companies (legal entities)
router.get('/',            authenticateToken, listCompanies);
router.get('/default',     authenticateToken, getDefault);
router.post('/backfill',   authenticateToken, runCompanyBackfill);
router.post('/',           authenticateToken, createCompany);
router.get('/:id',         authenticateToken, getCompany);
router.patch('/:id',       authenticateToken, updateCompany);
router.patch('/:id/default',   authenticateToken, setDefaultCompany);
router.post('/:id/employees',  authenticateToken, assignEmployees);

// Statutory configuration, versioned per company
router.get('/:id/statutory',    authenticateToken, listStatutoryConfigs);
router.post('/:id/statutory',   authenticateToken, upsertStatutoryConfig);
router.delete('/:id/statutory/:configId', authenticateToken, deleteStatutoryConfig);

export default router;
