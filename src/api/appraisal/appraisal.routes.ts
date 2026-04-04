import { Router } from 'express';
import { bulkCreateAppraisals, getAllAppraisalsWithManagerReview, saveManagerReview } from './appraisal.controller';
import {
  getSelfAppraisalQuestions, createSelfAppraisalQuestion, toggleSelfAppraisalQuestion,
  hrVerifyAppraisal, submitSelfAppraisal, submitManagerAppraisalV2,
  hrReviewAppraisal, requestEdit, respondEditRequest,
  getAppraisalDetail, getEditHistory, getEmployeeInsights,
} from './appraisal-v2.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

// Existing routes
router.post('/bulk-create', authenticateToken, bulkCreateAppraisals);
router.get("/", authenticateToken, getAllAppraisalsWithManagerReview);
router.post('/manager-review', authenticateToken, saveManagerReview);

// V2: Self-appraisal questions (master)
router.get('/self-questions', authenticateToken, getSelfAppraisalQuestions);
router.post('/self-questions', authenticateToken, createSelfAppraisalQuestion);
router.patch('/self-questions/:id/toggle', authenticateToken, toggleSelfAppraisalQuestion);

// V2: Enhanced flow
router.get('/detail/:id', authenticateToken, getAppraisalDetail);
router.patch('/:id/hr-verify', authenticateToken, hrVerifyAppraisal);
router.post('/:id/self-appraisal', authenticateToken, submitSelfAppraisal);
router.post('/:id/manager-appraisal', authenticateToken, submitManagerAppraisalV2);
router.post('/:id/hr-review', authenticateToken, hrReviewAppraisal);

// V2: Edit requests
router.post('/:id/edit-request', authenticateToken, requestEdit);
router.patch('/edit-request/:requestId', authenticateToken, respondEditRequest);
router.get('/:id/edit-history', authenticateToken, getEditHistory);
router.get('/:id/insights', authenticateToken, getEmployeeInsights);

// Test/Admin endpoints
router.post('/admin/test-auto-draft', async (req, res) => {
  try {
    const { prisma } = await import('../../lib/prisma');
    const { createNotification } = await import('../notifications/notifications.controller');

    const today = new Date();
    const employees = await prisma.employee.findMany({
      where: { employmentStatus: 'ACTIVE' },
      select: { id: true, dateOfJoining: true, reportingManager: true, firstName: true, lastName: true },
    });

    let created = 0;
    const results: any[] = [];

    for (const emp of employees) {
      const doj = new Date(emp.dateOfJoining);
      const monthsSinceJoining = (today.getFullYear() - doj.getFullYear()) * 12 + (today.getMonth() - doj.getMonth());
      const yearNum = Math.floor(monthsSinceJoining / 12) + 1;
      const cycle = `Year ${yearNum} - Annual Review`;

      const existing = await prisma.appraisalForm.findFirst({
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

        await prisma.appraisalForm.create({
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
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.delete('/admin/clear-all', async (req, res) => {
  try {
    const { prisma } = await import('../../lib/prisma');

    // Delete in order to respect foreign keys
    await prisma.appraisalEditHistory.deleteMany();
    await prisma.appraisalEditRequest.deleteMany();
    await prisma.selfAppraisalAnswer.deleteMany();
    await prisma.selfAppraisal.deleteMany();
    await prisma.managerAppraisal.deleteMany();
    await prisma.hRAppraisal.deleteMany();
    await prisma.appraisalForm.deleteMany();

    return res.json({ message: 'All appraisal data cleared' });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
