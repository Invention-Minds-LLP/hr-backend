import { Router } from 'express';
import multer from 'multer';
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
  lockPayrollRun,
  unlockPayrollRun,
} from './payroll.controller';
import { exportWorkingSheet, listSheetTemplates } from './payroll.workingsheet';
import {
  downloadStatutoryFile,
  getStatutorySummary,
  listStatutoryFilings,
  markFilingFiled,
} from './statutoryFilings';
import { downloadPayslipPdf, emailPayslipsForRun } from './payslipPdf';
import {
  getDispatchPreview, dispatchPayrollSheet, listDispatches,
} from './payrollDispatch';
import { previewImport, applyImport } from './payroll.import';
import {
  previewArrears, generateArrears, listArrears, applyArrearsToRun, cancelArrear,
} from './arrears';
import {
  getTemplateMeta, listSalaryTemplates, getSalaryTemplate, upsertSalaryTemplate,
  deleteSalaryTemplate, validateSalaryTemplate, previewSalaryTemplate,
  listEligibleEmployees, assignSalaryTemplate, getEmployeeAssignmentHistory,
} from './salaryTemplates.controller';
import {
  getPayslipCalendar, getEmployeeCalendar, getRunExceptions, getRunAdjustments,
} from './payrollCalendar.controller';

const router = Router();

// Working-sheet uploads are held in memory, not written to disk: a payroll sheet
// carries every salary in the company and has no business persisting to the
// uploads/ folder just to be parsed and discarded.
const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || file.mimetype === 'application/vnd.ms-excel'
      || /\.xlsx?$/i.test(file.originalname);
    if (ok) return cb(null, true);
    cb(new Error('Upload the .xlsx working sheet exported from this system'));
  },
});

// ── Salary structure templates ───────────────────────────────────────────────
// Literal segments declared before '/templates/:id' so they are matched first.
router.get('/templates/meta',      authenticateToken, getTemplateMeta);
router.get('/templates/eligible',  authenticateToken, listEligibleEmployees);
router.post('/templates/validate', authenticateToken, validateSalaryTemplate);
router.post('/templates/preview',  authenticateToken, previewSalaryTemplate);
router.post('/templates/assign',   authenticateToken, assignSalaryTemplate);
router.get('/templates/assignments/:employeeId', authenticateToken, getEmployeeAssignmentHistory);
router.get('/templates',           authenticateToken, listSalaryTemplates);
router.post('/templates',          authenticateToken, upsertSalaryTemplate);
router.get('/templates/:id',       authenticateToken, getSalaryTemplate);
router.patch('/templates/:id',     authenticateToken, upsertSalaryTemplate);
router.delete('/templates/:id',    authenticateToken, deleteSalaryTemplate);

// ── Approval calendar & adjustments ──────────────────────────────────────────
router.get('/runs/:id/calendar/:employeeId', authenticateToken, getPayslipCalendar);
router.get('/runs/:id/exceptions',           authenticateToken, getRunExceptions);
router.get('/runs/:id/adjustments',          authenticateToken, getRunAdjustments);
router.get('/calendar/:employeeId',          authenticateToken, getEmployeeCalendar);

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
router.get('/sheet-templates',             authenticateToken, listSheetTemplates);
router.get('/runs/:id/working-sheet.xlsx', authenticateToken, exportWorkingSheet);

// Month-end freeze
router.patch('/runs/:id/lock',   authenticateToken, lockPayrollRun);
router.patch('/runs/:id/unlock', authenticateToken, unlockPayrollRun);

// Working-sheet import. Authenticate BEFORE parsing the upload so an anonymous
// request never gets as far as buffering a salary sheet.
router.post('/runs/:id/import/preview', authenticateToken, sheetUpload.single('file'), previewImport);
router.post('/runs/:id/import',         authenticateToken, sheetUpload.single('file'), applyImport);

// Payslip distribution
router.post('/runs/:id/email-payslips', authenticateToken, emailPayslipsForRun);

// Send the verified workbook to Finance. Preview first — it reports anything
// that would make the figures wrong before they leave the building.
router.get('/runs/:id/dispatch-preview', authenticateToken, getDispatchPreview);
router.post('/runs/:id/dispatch',        authenticateToken, dispatchPayrollSheet);
router.get('/runs/:id/dispatches',       authenticateToken, listDispatches);

// Arrears. `/arrears/preview` is declared before `/arrears/:id/...` so the
// literal path is matched first.
router.get('/arrears',                authenticateToken, listArrears);
router.get('/arrears/preview',        authenticateToken, previewArrears);
router.post('/arrears/generate',      authenticateToken, generateArrears);
router.post('/arrears/apply',         authenticateToken, applyArrearsToRun);
router.patch('/arrears/:id/cancel',   authenticateToken, cancelArrear);

// Summary (dashboard cards)
router.get('/summary',       authenticateToken, getPayrollSummary);

// Statutory returns & challans. `/statutory/filings` is declared before the
// `/statutory/:type` wildcard so it isn't swallowed by it.
router.get('/statutory/summary',  authenticateToken, getStatutorySummary);
router.get('/statutory/filings',  authenticateToken, listStatutoryFilings);
router.patch('/statutory/filings/:id/filed', authenticateToken, markFilingFiled);
router.get('/statutory/:type',    authenticateToken, downloadStatutoryFile);

// Payslips
router.get('/payslips/my',   authenticateToken, getMyPayslips);
router.get('/payslips',      authenticateToken, listPayslips);
router.get('/payslips/:id',  authenticateToken, getPayslip);
router.get('/payslips/:id/pdf', authenticateToken, downloadPayslipPdf);
router.patch('/payslips/:id/remarks', authenticateToken, updatePayslipRemarks);

export default router;
