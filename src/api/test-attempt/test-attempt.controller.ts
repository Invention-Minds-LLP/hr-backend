import { Request, Response } from 'express';
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function getAssignedTest(req: Request, res: Response) {
    const assignmentId = Number(req.params.id);
  
    const assignment = await prisma.assignedTest.findUnique({
      where: { id: assignmentId },
      include: {
        test: true
      }
    });
  
    if (!assignment) {
      return res.status(404).json({ error: 'Assigned test not found' });
    }
  
    // ✅ Fetch questions using the test's questionBankId
    const questions = await prisma.question.findMany({
      where: { questionBankId: assignment.test.questionBankId },
      include: { options: true }
    });
  
    res.json({
      ...assignment,
      test: {
        ...assignment.test,
        questions // attach questions dynamically
      }
    });
  }
  
// POST /api/attempts/submit
// body: { attemptId, assignedTestId, responses, score }
export async function submitAttempt(req: Request, res: Response) {
  const { attemptId, assignedTestId, responses, score } = req.body;

  try {
    await prisma.$transaction([
      prisma.evaluationAttempt.update({
        where: { id: Number(attemptId) },
        data: {
          score: Number(score) || 0,
          status: 'Completed',
          response: JSON.stringify(responses ?? {}),
        },
      }),
      prisma.assignedTest.update({
        where: { id: Number(assignedTestId) },
        data: { status: 'Completed', completedAt: new Date() },
      }),
    ]);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to submit attempt' });
  }
}

export async function getAssignedTestsForEmployee(req: Request, res: Response) {
  const employeeId = Number(req.params.employeeId);

  const assignedTests = await prisma.assignedTest.findMany({
    where: { employeeId },
    include: { test: true },
    orderBy: { assignedAt: 'desc' },
  });

  // count attempts by (employeeId,testId)
  const counts = await prisma.evaluationAttempt.groupBy({
    by: ['testId'],
    where: { employeeId },
    _count: { _all: true },
  });
  const countMap = new Map<number, number>();
  counts.forEach(c => countMap.set(c.testId, c._count._all));

  const enriched = assignedTests.map(a => {
    const attemptsMade = countMap.get(a.testId) ?? 0;
    return {
      ...a,
      attemptsMade,
      canStart: attemptsMade < (a.test.maxAttempts ?? 1),
    };
  });

  res.json(enriched);
}

  

  // GET /api/evaluation-attempts
export const getAllAttempts = async (req: Request, res: Response) => {
    try {
      const attempts = await prisma.evaluationAttempt.findMany({
        include: {
          employee: true
        },
        orderBy: { createdAt: 'desc' }
      });
  
      res.json(attempts);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch attempts' });
    }
  };

export async function startAssignedTestAttempt(req: Request, res: Response) {
  const assignedTestId = Number(req.params.id);

  try {
    const assigned = await prisma.assignedTest.findUnique({
      where: { id: assignedTestId },
      include: { test: true },
    });
    if (!assigned) return res.status(404).json({ error: 'Assigned test not found' });

    // If you use auth, derive employeeId from token; otherwise trust the row
    const employeeId = assigned.employeeId;

    // Count current attempts (by employee+test)
    const attemptsMade = await prisma.evaluationAttempt.count({
      where: { employeeId, testId: assigned.testId },
    });

    if (attemptsMade >= (assigned.test.maxAttempts ?? 1)) {
      return res.status(409).json({ error: 'Max attempts reached' });
    }

    // Do both actions together
    const [attempt] = await prisma.$transaction([
      prisma.evaluationAttempt.create({
        data: {
          employeeId,
          testId: assigned.testId,
          score: 0,                         // placeholder until submit
          status: 'InProgress',
          response: null,                   // fill on submit
        },
      }),
      prisma.assignedTest.update({
        where: { id: assignedTestId },
        data: {
          attempts: { increment: 1 },      // keep counter in sync
          status: 'InProgress',
          startedAt: new Date(),
        },
      }),
    ]);

    return res.status(201).json({ attemptId: attempt.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to start attempt' });
  }
}
