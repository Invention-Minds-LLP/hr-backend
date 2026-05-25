"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const payroll_controller_1 = require("./payroll.controller");
const router = (0, express_1.Router)();
// Salary Structures
router.get('/salary-structures', authMiddleware_1.authenticateToken, payroll_controller_1.listSalaryStructures);
router.get('/salary-structures/:employeeId', authMiddleware_1.authenticateToken, payroll_controller_1.getEmployeeSalaryStructure);
router.post('/salary-structures', authMiddleware_1.authenticateToken, payroll_controller_1.upsertSalaryStructure);
// Payroll Runs
router.get('/runs', authMiddleware_1.authenticateToken, payroll_controller_1.listPayrollRuns);
router.post('/runs', authMiddleware_1.authenticateToken, payroll_controller_1.createPayrollRun);
router.get('/runs/:id', authMiddleware_1.authenticateToken, payroll_controller_1.getPayrollRun);
router.patch('/runs/:id/publish', authMiddleware_1.authenticateToken, payroll_controller_1.publishPayrollRun);
router.delete('/runs/:id', authMiddleware_1.authenticateToken, payroll_controller_1.deletePayrollRun);
// Summary (dashboard cards)
router.get('/summary', authMiddleware_1.authenticateToken, payroll_controller_1.getPayrollSummary);
// Payslips
router.get('/payslips/my', authMiddleware_1.authenticateToken, payroll_controller_1.getMyPayslips);
router.get('/payslips', authMiddleware_1.authenticateToken, payroll_controller_1.listPayslips);
router.get('/payslips/:id', authMiddleware_1.authenticateToken, payroll_controller_1.getPayslip);
router.patch('/payslips/:id/remarks', authMiddleware_1.authenticateToken, payroll_controller_1.updatePayslipRemarks);
exports.default = router;
