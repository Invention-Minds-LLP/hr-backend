"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const appraisal_controller_1 = require("./appraisal.controller");
const appraisal_v2_controller_1 = require("./appraisal-v2.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
// Existing routes
router.post('/bulk-create', authMiddleware_1.authenticateToken, appraisal_controller_1.bulkCreateAppraisals);
router.get("/", authMiddleware_1.authenticateToken, appraisal_controller_1.getAllAppraisalsWithManagerReview);
router.post('/manager-review', authMiddleware_1.authenticateToken, appraisal_controller_1.saveManagerReview);
// V2: Self-appraisal questions (master)
router.get('/self-questions', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.getSelfAppraisalQuestions);
router.post('/self-questions', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.createSelfAppraisalQuestion);
router.patch('/self-questions/:id/toggle', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.toggleSelfAppraisalQuestion);
// V2: Enhanced flow
router.get('/detail/:id', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.getAppraisalDetail);
router.patch('/:id/hr-verify', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.hrVerifyAppraisal);
router.post('/:id/self-appraisal', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.submitSelfAppraisal);
router.post('/:id/manager-appraisal', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.submitManagerAppraisalV2);
router.post('/:id/management-appraisal', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.submitManagementAppraisal);
router.post('/:id/hr-review', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.hrReviewAppraisal);
// V2: Edit requests
router.post('/:id/edit-request', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.requestEdit);
router.patch('/edit-request/:requestId', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.respondEditRequest);
router.get('/:id/edit-history', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.getEditHistory);
router.get('/:id/insights', authMiddleware_1.authenticateToken, appraisal_v2_controller_1.getEmployeeInsights);
// Test/Admin endpoints
router.post('/admin/test-auto-draft', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { prisma } = yield Promise.resolve().then(() => __importStar(require('../../lib/prisma')));
        const { createNotification } = yield Promise.resolve().then(() => __importStar(require('../notifications/notifications.controller')));
        const today = new Date();
        const employees = yield prisma.employee.findMany({
            where: { employmentStatus: 'ACTIVE' },
            select: { id: true, dateOfJoining: true, reportingManager: true, firstName: true, lastName: true },
        });
        let created = 0;
        const results = [];
        for (const emp of employees) {
            const doj = new Date(emp.dateOfJoining);
            const monthsSinceJoining = (today.getFullYear() - doj.getFullYear()) * 12 + (today.getMonth() - doj.getMonth());
            const yearNum = Math.floor(monthsSinceJoining / 12) + 1;
            const cycle = `Year ${yearNum} - Annual Review`;
            const existing = yield prisma.appraisalForm.findFirst({
                where: { employeeId: emp.id, cycle },
            });
            const eligible = monthsSinceJoining >= 11;
            results.push({
                empId: emp.id,
                name: `${emp.firstName} ${emp.lastName}`,
                doj: doj.toISOString().split('T')[0],
                monthsSinceJoining,
                yearNum,
                cycle,
                eligible,
                alreadyExists: !!existing,
            });
            if (eligible && !existing) {
                const startDate = new Date(doj);
                startDate.setFullYear(startDate.getFullYear() + yearNum - 1);
                const endDate = new Date(startDate);
                endDate.setFullYear(endDate.getFullYear() + 1);
                yield prisma.appraisalForm.create({
                    data: {
                        employeeId: emp.id,
                        managerId: emp.reportingManager || null,
                        cycle,
                        status: 'AUTO_DRAFT',
                        appraisalStartDate: startDate,
                        appraisalEndDate: endDate,
                        dueDate: new Date(endDate.getTime() + 30 * 24 * 60 * 60 * 1000),
                    },
                });
                created++;
            }
        }
        return res.json({ created, totalEmployees: employees.length, results });
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
}));
router.delete('/admin/clear-all', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { prisma } = yield Promise.resolve().then(() => __importStar(require('../../lib/prisma')));
        // Delete in order to respect foreign keys
        yield prisma.appraisalEditHistory.deleteMany();
        yield prisma.appraisalEditRequest.deleteMany();
        yield prisma.selfAppraisalAnswer.deleteMany();
        yield prisma.selfAppraisal.deleteMany();
        yield prisma.managerAppraisal.deleteMany();
        yield prisma.hRAppraisal.deleteMany();
        yield prisma.appraisalForm.deleteMany();
        return res.json({ message: 'All appraisal data cleared' });
    }
    catch (e) {
        return res.status(500).json({ error: e.message });
    }
}));
exports.default = router;
