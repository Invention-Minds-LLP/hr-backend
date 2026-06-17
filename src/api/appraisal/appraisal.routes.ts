import { Router } from 'express';
import { bulkCreateAppraisals, getAllAppraisalsWithManagerReview, saveManagerReview } from './appraisal.controller';
import {
  getSelfAppraisalQuestions, createSelfAppraisalQuestion, toggleSelfAppraisalQuestion,
  hrVerifyAppraisal, submitSelfAppraisal, submitManagerAppraisalV2, submitManagementAppraisal,
  hrReviewAppraisal, requestEdit, respondEditRequest,
  getAppraisalDetail, getEditHistory, getEmployeeInsights,
  reassignAppraisalManager,
  listReviewQuestions, createReviewQuestion, updateReviewQuestion,
  toggleReviewQuestion, deleteReviewQuestion,
  submitInchargeAppraisal,
} from './appraisal-v2.controller';
import {
  listEmployeePauses, getActivePause, createPause, updatePause, deletePause,
} from './appraisal-pause.controller';
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
router.post('/:id/management-appraisal', authenticateToken, submitManagementAppraisal);
router.post('/:id/hr-review', authenticateToken, hrReviewAppraisal);
router.post('/:id/reassign-manager', authenticateToken, reassignAppraisalManager);
router.post('/:id/incharge-appraisal', authenticateToken, submitInchargeAppraisal);

// V2: Review-question master pool (used by Incharge / Manager / Management forms)
router.get('/review-questions', authenticateToken, listReviewQuestions);
router.post('/review-questions', authenticateToken, createReviewQuestion);
router.patch('/review-questions/:id', authenticateToken, updateReviewQuestion);
router.patch('/review-questions/:id/toggle', authenticateToken, toggleReviewQuestion);
router.delete('/review-questions/:id', authenticateToken, deleteReviewQuestion);

// V2: Edit requests
router.post('/:id/edit-request', authenticateToken, requestEdit);
router.patch('/edit-request/:requestId', authenticateToken, respondEditRequest);
router.get('/:id/edit-history', authenticateToken, getEditHistory);
router.get('/:id/insights', authenticateToken, getEmployeeInsights);

// Appraisal pause / resume (maternity, long medical leave, sabbatical).
// Pausing applies to BOTH managerial appraisal and dept-performance clocks.
router.get('/employees/:empId/pauses', authenticateToken, listEmployeePauses);
router.get('/employees/:empId/pauses/active', authenticateToken, getActivePause);
router.post('/employees/:empId/pauses', authenticateToken, createPause);
router.patch('/pauses/:pauseId', authenticateToken, updatePause);
router.delete('/pauses/:pauseId', authenticateToken, deletePause);

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

/**
 * POST /admin/seed-review-questions
 * One-shot seed for the AppraisalReviewQuestion master pool. Idempotent:
 * inserts the 13 default criteria only if the table is empty, so HR can edit
 * them afterwards without being overwritten.
 */
router.post('/admin/seed-review-questions', authenticateToken, async (_req, res) => {
  try {
    const { prisma } = await import('../../lib/prisma');
    const existing = await prisma.appraisalReviewQuestion.count();
    if (existing > 0) {
      return res.json({ inserted: 0, message: 'Questions already seeded; no changes made.' });
    }

    const defaults = [
      {
        title: 'Quality of Work',
        description: 'Accuracy, neatness and thoroughness of work effort.',
        prompts: ['How frequent are mistakes or errors?', 'How consistent is the accuracy and thoroughness of work?'],
        aboveAverage: 'Produces outstanding, neat and accurate work. Work must seldom be checked by others. Errors are rare and minor.',
        average: 'Average accuracy and neatness for qualified employees. Occasional errors. Reasonably conscientious about checking work and preventing errors.',
        belowAverage: 'Poor accuracy and neatness. Frequent errors and/or errors of substantial magnitude. Work must be checked by others. Employee shows little concern with quality of work.',
      },
      {
        title: 'Knowledge of Job',
        description: 'Demonstrates the knowledge of fundamental methods and procedures of the job.',
        prompts: ['How often does employee have to be shown job procedures?', 'How does employee handle unexpected problems or breakdowns?', 'Does employee retain knowledge of job or require substantial review?'],
        aboveAverage: 'Possesses broad and detailed knowledge of all aspects of the job. Rarely needs to ask for job information.',
        average: 'Adequate knowledge of phases of work. Possesses knowledge necessary to perform duties. Does not need substantial guidance or direction.',
        belowAverage: 'Insufficient knowledge of job duties. Has difficulty performing job tasks without substantial guidance and direction.',
      },
      {
        title: 'Teamwork',
        description: 'Ability to work effectively with co-workers and contribute to team objectives.',
        prompts: ['Does the employee cooperate with peers?', 'How well does the employee support team decisions?'],
        aboveAverage: 'Highly cooperative; actively supports team goals and helps others succeed.',
        average: 'Generally cooperative; meets team expectations.',
        belowAverage: 'Does not cooperate; disrupts team dynamics or works in isolation.',
      },
      {
        title: 'Independence',
        description: 'Ability to work without close supervision and take ownership of tasks.',
        prompts: ['Does the employee require frequent direction?', 'How proactively does the employee handle their workload?'],
        aboveAverage: 'Self-directed; consistently completes work without supervision.',
        average: 'Needs occasional guidance but otherwise works independently.',
        belowAverage: 'Requires constant supervision; struggles without close direction.',
      },
      {
        title: 'Records',
        description: 'Accuracy, completeness and timeliness of records and documentation.',
        prompts: ['Are records consistently complete and accurate?', 'Are records submitted on time?'],
        aboveAverage: 'Records are always complete, accurate and timely.',
        average: 'Records are generally accurate with occasional minor gaps.',
        belowAverage: 'Records are frequently incomplete, inaccurate or late.',
      },
      {
        title: 'Guest Service',
        description: 'Quality of interaction with patients / visitors / stakeholders.',
        prompts: ['How does the employee handle guest concerns?', 'Is the employee courteous and responsive?'],
        aboveAverage: 'Consistently exceeds expectations; goes out of the way to help.',
        average: 'Meets expected service standards.',
        belowAverage: 'Falls short of service expectations; complaints received.',
      },
      {
        title: 'Safety',
        description: 'Adherence to safety procedures and awareness of hazards.',
        prompts: ['Does the employee follow safety guidelines?', 'Does the employee report hazards?'],
        aboveAverage: 'Exemplary safety practices; proactively identifies risks.',
        average: 'Follows safety guidelines.',
        belowAverage: 'Disregards safety procedures; has been involved in preventable incidents.',
      },
      {
        title: 'Attendance',
        description: 'Punctuality and dependability in attendance.',
        prompts: ['Is the employee punctual?', 'How frequent are unplanned absences?'],
        aboveAverage: 'Always punctual; rarely absent without prior approval.',
        average: 'Generally punctual; absences within acceptable limits.',
        belowAverage: 'Frequently late or absent without notice.',
      },
      {
        title: 'Leadership',
        description: 'Ability to guide, motivate and influence others.',
        prompts: ['Does the employee take initiative in leading tasks?', 'How well does the employee influence others positively?'],
        aboveAverage: 'Strong leader; others look to them for direction.',
        average: 'Provides leadership when required.',
        belowAverage: 'Avoids leadership; struggles to influence others.',
      },
      {
        title: 'Communication',
        description: 'Effectiveness of verbal and written communication.',
        prompts: ['Are instructions and ideas conveyed clearly?', 'Does the employee listen actively?'],
        aboveAverage: 'Articulate and clear in all forms of communication.',
        average: 'Communicates effectively in most situations.',
        belowAverage: 'Communication is often unclear or causes misunderstandings.',
      },
      {
        title: 'Problem Solving',
        description: 'Ability to analyse problems and develop sound solutions.',
        prompts: ['How does the employee approach unfamiliar problems?', 'Quality of decisions made under pressure?'],
        aboveAverage: 'Tackles complex problems independently with strong outcomes.',
        average: 'Handles routine problems competently.',
        belowAverage: 'Struggles to identify or resolve problems without help.',
      },
      {
        title: 'Initiative',
        description: 'Willingness to take action without being prompted.',
        prompts: ['Does the employee seek out additional work or improvements?', 'How proactive is the employee with new ideas?'],
        aboveAverage: 'Self-starter; consistently identifies and acts on opportunities.',
        average: 'Takes initiative when expected.',
        belowAverage: 'Rarely takes initiative; waits to be told what to do.',
      },
      {
        title: 'Reliability',
        description: 'Consistency of performance and follow-through on commitments.',
        prompts: ['Does the employee meet deadlines and commitments?', 'Can the employee be counted on under pressure?'],
        aboveAverage: 'Highly dependable in all circumstances.',
        average: 'Generally reliable; meets commitments.',
        belowAverage: 'Often misses commitments; performance is inconsistent.',
      },
    ];

    let order = 1;
    for (const q of defaults) {
      await prisma.appraisalReviewQuestion.create({
        data: {
          title: q.title,
          description: q.description,
          prompts: q.prompts as any,
          aboveAverage: q.aboveAverage,
          average: q.average,
          belowAverage: q.belowAverage,
          displayOrder: order++,
          // `levels` defaults to all three in the schema.
        },
      });
    }

    return res.json({ inserted: defaults.length, message: `Seeded ${defaults.length} review questions.` });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /admin/backfill-review-answers
 *
 * One-shot migration that copies values from the legacy column tables
 * (ManagerAppraisal / ManagementAppraisal) into the new unified
 * AppraisalReviewAnswer table, so old appraisals open in the new dynamic form
 * with their previously-filled ratings + comments pre-populated.
 *
 * Idempotent: upsert keyed on (appraisalFormId, questionId, level). Safe to
 * re-run any time. Returns counts + any unmatched column → question titles
 * so HR can spot misalignments.
 */
router.post('/admin/backfill-review-answers', authenticateToken, async (_req, res) => {
  try {
    const { prisma } = await import('../../lib/prisma');

    // 1. Build a title → questionId map from the master pool.
    const questions = await prisma.appraisalReviewQuestion.findMany({
      select: { id: true, title: true },
    });
    if (!questions.length) {
      return res.status(400).json({
        error: 'No master review questions found. Run /admin/seed-review-questions first.',
      });
    }
    const titleToId = new Map<string, number>();
    for (const q of questions) {
      titleToId.set(q.title.trim().toLowerCase(), q.id);
    }
    const lookup = (title: string) => titleToId.get(title.trim().toLowerCase()) ?? null;

    // 2. Mapping table: legacy column name → master question title.
    //    Manager: 9 paired criteria + 4 standalone Float-only fields.
    //    Management: 9 paired criteria.
    const pairedCriteria: { ratingCol: string; commentsCol: string; title: string }[] = [
      { ratingCol: 'qualityOfWorkRating',  commentsCol: 'qualityOfWorkComments',  title: 'Quality of Work' },
      { ratingCol: 'knowledgeOfJobRating', commentsCol: 'knowledgeOfJobComments', title: 'Knowledge of Job' },
      { ratingCol: 'teamworkRating',       commentsCol: 'teamworkComments',       title: 'Teamwork' },
      { ratingCol: 'independenceRating',   commentsCol: 'independenceComments',   title: 'Independence' },
      { ratingCol: 'recordsRating',        commentsCol: 'recordsComments',        title: 'Records' },
      { ratingCol: 'guestServiceRating',   commentsCol: 'guestServiceComments',   title: 'Guest Service' },
      { ratingCol: 'safetyRating',         commentsCol: 'safetyComments',         title: 'Safety' },
      { ratingCol: 'attendanceRating',     commentsCol: 'attendanceComments',     title: 'Attendance' },
      { ratingCol: 'leadershipRating',     commentsCol: 'leadershipComments',     title: 'Leadership' },
    ];

    // Manager-only standalone Float fields (no comments column).
    const managerOnlyRating: { col: string; title: string }[] = [
      { col: 'communication',  title: 'Communication' },
      { col: 'problemSolving', title: 'Problem Solving' },
      { col: 'initiative',     title: 'Initiative' },
      { col: 'reliability',    title: 'Reliability' },
    ];

    const unmatched = new Set<string>();
    const stats = { manager: { rows: 0, upserts: 0 }, management: { rows: 0, upserts: 0 } };

    // 3. Backfill MANAGER answers.
    const managerRows = await prisma.managerAppraisal.findMany();
    for (const row of managerRows) {
      stats.manager.rows++;
      const r = row as any;

      for (const m of pairedCriteria) {
        const qid = lookup(m.title);
        if (!qid) { unmatched.add(m.title); continue; }
        const rating = r[m.ratingCol] as number | null;
        const comments = r[m.commentsCol] as string | null;
        if (rating == null && (!comments || !comments.trim())) continue; // nothing to copy

        await prisma.appraisalReviewAnswer.upsert({
          where: {
            appraisalFormId_questionId_level: {
              appraisalFormId: row.appraisalFormId,
              questionId: qid,
              level: 'MANAGER',
            },
          },
          create: {
            appraisalFormId: row.appraisalFormId,
            questionId: qid,
            level: 'MANAGER',
            rating: rating ?? null,
            comments: comments ?? null,
          },
          update: {
            rating: rating ?? null,
            comments: comments ?? null,
          },
        });
        stats.manager.upserts++;
      }

      for (const m of managerOnlyRating) {
        const qid = lookup(m.title);
        if (!qid) { unmatched.add(m.title); continue; }
        const rating = r[m.col] as number | null;
        if (rating == null) continue;

        await prisma.appraisalReviewAnswer.upsert({
          where: {
            appraisalFormId_questionId_level: {
              appraisalFormId: row.appraisalFormId,
              questionId: qid,
              level: 'MANAGER',
            },
          },
          create: {
            appraisalFormId: row.appraisalFormId,
            questionId: qid,
            level: 'MANAGER',
            rating,
            comments: null,
          },
          update: { rating },
        });
        stats.manager.upserts++;
      }
    }

    // 4. Backfill MANAGEMENT answers.
    const managementRows = await prisma.managementAppraisal.findMany();
    for (const row of managementRows) {
      stats.management.rows++;
      const r = row as any;

      for (const m of pairedCriteria) {
        const qid = lookup(m.title);
        if (!qid) { unmatched.add(m.title); continue; }
        const rating = r[m.ratingCol] as number | null;
        const comments = r[m.commentsCol] as string | null;
        if (rating == null && (!comments || !comments.trim())) continue;

        await prisma.appraisalReviewAnswer.upsert({
          where: {
            appraisalFormId_questionId_level: {
              appraisalFormId: row.appraisalFormId,
              questionId: qid,
              level: 'MANAGEMENT',
            },
          },
          create: {
            appraisalFormId: row.appraisalFormId,
            questionId: qid,
            level: 'MANAGEMENT',
            rating: rating ?? null,
            comments: comments ?? null,
          },
          update: {
            rating: rating ?? null,
            comments: comments ?? null,
          },
        });
        stats.management.upserts++;
      }
    }

    return res.json({
      ok: true,
      stats,
      unmatchedTitles: [...unmatched],
      message:
        `Backfilled ${stats.manager.upserts} MANAGER and ${stats.management.upserts} MANAGEMENT answers ` +
        `from ${stats.manager.rows} ManagerAppraisal and ${stats.management.rows} ManagementAppraisal rows.` +
        (unmatched.size
          ? ` ⚠️ ${unmatched.size} legacy criteria title(s) had no matching master question: ${[...unmatched].join(', ')}.`
          : ''),
    });
  } catch (e: any) {
    console.error('backfill-review-answers error:', e);
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
