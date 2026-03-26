import { Router } from 'express';
import { authenticateToken } from '../../middleware/authMiddleware';
import {
  listSalaryStructures,
  getEmployeeSalaryStructure,
  upsertSalaryStructure,
  listPayrollRuns,
  createPayrollRun,
  getPayrollRun,
  publishPayrollRun,
  deletePayrollRun,
  listPayslips,
  getMyPayslips,
  getPayslip,
  updatePayslipRemarks,
  getPayrollSummary,
} from './payroll.controller';

const router = Router();

// Salary Structures
router.get('/salary-structures',              authenticateToken, listSalaryStructures);
router.get('/salary-structures/:employeeId',  authenticateToken, getEmployeeSalaryStructure);
router.post('/salary-structures',             authenticateToken, upsertSalaryStructure);

// Payroll Runs
router.get('/runs',          authenticateToken, listPayrollRuns);
router.post('/runs',         authenticateToken, createPayrollRun);
router.get('/runs/:id',      authenticateToken, getPayrollRun);
router.patch('/runs/:id/publish', authenticateToken, publishPayrollRun);
router.delete('/runs/:id',   authenticateToken, deletePayrollRun);

// Summary (dashboard cards)
router.get('/summary',       authenticateToken, getPayrollSummary);

// Payslips
router.get('/payslips/my',   authenticateToken, getMyPayslips);
router.get('/payslips',      authenticateToken, listPayslips);
router.get('/payslips/:id',  authenticateToken, getPayslip);
router.patch('/payslips/:id/remarks', authenticateToken, updatePayslipRemarks);

export default router;
