import { Request, Response } from 'express';
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { sendWhatsAppTemplate } from '../leave/leave.controller';
import { createNotification } from '../notifications/notifications.controller';

const TEST_ASSIGNED_TEMPLATE_ID = '888289';

const fmtDate = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

const fmtTime = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

function formatPhoneNumber(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("91")) return `+${digits}`;
  if (digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("+")) return digits;
  return `+${digits}`;
}

export const assignTestToEmployees = async (req: Request, res: Response) => {
  try {
    const { testId, employeeIds, assignedBy, deadlineDate, testDate } = req.body;

    const data = employeeIds.map((employeeId: number) => ({
      testId,
      employeeId,
      assignedBy,
      deadlineDate,
      testDate,
      status: 'NotStarted'
    }));

    await prisma.assignedTest.createMany({ data });

    // Fetch test name (and fallback schedule)
    const test = await prisma.evaluationTest.findUnique({
      where: { id: Number(testId) },
      select: { name: true, activeFrom: true }
    });

    // Fetch employees’ names & phones
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { firstName: true, lastName: true, phone: true, id: true }
    });

    const scheduleSrc: Date | string | null = testDate ?? test?.activeFrom ?? null;
    const dateLabel = fmtDate(scheduleSrc) || "-";
    const timeLabel = fmtTime(scheduleSrc) || "-";
    const testName = test?.name || "-";

    // Fire-and-forget WhatsApp (don’t fail API if a send fails)
    await Promise.all(
      employees.map(async (emp) => {
        const to = formatPhoneNumber(emp.phone || "");
        if (!to) return;

        const employeeName = [emp.firstName, emp.lastName].filter(Boolean).join(" ");
        // 📩 Notification message
        const message = `You have been assigned the ${testName} scheduled on ${dateLabel} at ${timeLabel}.\nKindly ensure to complete it as instructed.`;

        // --- In-App Notification
        try {
          await createNotification(emp.id, message); // creates + broadcasts
        } catch (e) {
          console.error("Test assign in-app notification failed:", e);
        }
        try {
          await sendWhatsAppTemplate({
            to,
            templateId: TEST_ASSIGNED_TEMPLATE_ID,
            placeholders: [employeeName, testName, dateLabel]
          });
        } catch (e) {
          console.error("Test assignment WA send failed:", e);
        }
      })
    );

    res.json({ message: 'Test assigned to employees' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign test' });
  }
};

// export const getAssignedTests = async (req: Request, res: Response) => {
//   try {
//     const assignments = await prisma.assignedTest.findMany({
//       include: { employee: true, test: true }
//     });
//     res.json(assignments);
//   } catch (error) {
//     res.status(500).json({ error: 'Failed to fetch assignments' });
//   }
// };
export const getAssignedTests = async (req: Request, res: Response) => {
  try {
    // 1) Assignments with employee & test (need passingPercent)
    const assignments = await prisma.assignedTest.findMany({
      include: { employee: true, test: true },
      orderBy: { assignedAt: 'desc' },
    });

    if (assignments.length === 0) return res.json([]);

    // 2) Pull all attempts for the employee/test pairs, newest first
    const employeeIds = Array.from(new Set(assignments.map(a => a.employeeId)));
    const testIds = Array.from(new Set(assignments.map(a => a.testId)));

    const attempts = await prisma.evaluationAttempt.findMany({
      where: {
        employeeId: { in: employeeIds },
        testId: { in: testIds },
      },
      orderBy: { createdAt: 'desc' }, // newest first
      select: { id: true, employeeId: true, testId: true, score: true, status: true, createdAt: true },
    });



    // 3) Latest attempt per (employeeId:testId)
    const latestAttemptMap = new Map<string, typeof attempts[number]>();
    for (const att of attempts) {
      const key = `${att.employeeId}:${att.testId}`;
      if (!latestAttemptMap.has(key)) latestAttemptMap.set(key, att); // first (newest) wins
    }

    // 4) Enrich each assignment
    const enriched = assignments.map(a => {
      const key = `${a.employeeId}:${a.testId}`;
      const latest = latestAttemptMap.get(key) || null;

      console.log('latest', latest);

      const score = latest?.score ?? null;
      const passThreshold = a.test?.passingPercent ?? null;

      // Assumes score is already a percentage (0–100). If not, adjust here.
      const pass =
        score !== null && passThreshold !== null ? Number(score) >= Number(passThreshold) : null;

      return {
        ...a,
        status: latest ? latest.status : a.status, // if attempted, show latest status
        latestAttempt: latest,               // { id, score, status, createdAt, ... } or null
        latestScore: score,                  // number | null
        result: pass === null ? null : pass ? 'Pass' : 'Fail', // 'Pass' | 'Fail' | null
      };
    });

    res.json(enriched);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
};

export const getAssignedTestOverview = async (req: Request, res: Response) => {
  try {
    const assignedTestId = Number(req.params.id);

    const assignment = await prisma.assignedTest.findUnique({
      where: { id: assignedTestId },
      include: { employee: true, test: true },
    });
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    // latest attempt for this employee+test
    const attempt = await prisma.evaluationAttempt.findFirst({
      where: { employeeId: assignment.employeeId, testId: assignment.testId },
      orderBy: { createdAt: 'desc' },
    });
    if (!attempt) {
      return res.json({
        assignmentId: assignment.id,
        attemptId: null,
        startedAt: assignment.startedAt,
        completedAt: assignment.completedAt,
        employeeName: `${assignment.employee.firstName} ${assignment.employee.lastName}`,
        testId: assignment.testId,
        testName: assignment.test.name,
        timeTakenSec: timeDiffSec(assignment.startedAt, assignment.completedAt),
        totals: { total: 0, autoGradable: 0, correct: 0, wrong: 0, unanswered: 0 },
        rows: [],
        status: "NotStarted",
      });
    }

    // questions from the bank used by this test
    const questions = await prisma.question.findMany({
      where: { questionBankId: assignment.test.questionBankId },
      include: { options: true },
    });

    const responses = safeParse<any[]>(attempt.response) ?? [];
    const byQ = new Map<number, any>(responses.map(r => [Number(r.questionId), r]));

    let correct = 0, wrong = 0, unanswered = 0, autoGradable = 0;

    const rows = questions.map((q, idx) => {
      const r = byQ.get(q.id);
      const type = (q.type || '').toUpperCase(); // 'MCQ'|'DESCRIPTIVE'
      const correctIds = q.options.filter(o => o.isCorrect).map(o => o.id).sort((a, b) => a - b);
      let selectedIds: number[] = [];

      if (r) {
        if (Array.isArray(r.answer)) selectedIds = r.answer.map(Number).sort((a: any, b: any) => a - b);
        else if (typeof r.answer === 'string' && r.answer.trim()) selectedIds = []; // descriptive text
      }

      let isCorrect: boolean | null = null;
      if (type === 'MCQ') {
        autoGradable++;
        if (!r || (Array.isArray(r.answer) && r.answer.length === 0)) {
          unanswered++;
          isCorrect = false;
        } else {
          isCorrect = JSON.stringify(selectedIds) === JSON.stringify(correctIds);
          isCorrect ? correct++ : wrong++;
        }
      } else {
        // descriptive → not auto-graded here
        isCorrect = null;
      }

      console.log('r', r)

      return {
        no: idx + 1,
        questionId: q.id,
        text: q.text,
        weight: q.weight,
        type,
        selectedOptionIds: selectedIds,
        selectedOptionTexts: q.options.filter(o => selectedIds.includes(o.id)).map(o => o.text),
        correctOptionIds: correctIds,
        correctOptionTexts: q.options.filter(o => correctIds.includes(o.id)).map(o => o.text),
        isCorrect, // true/false/null
        rawAnswer: !Array.isArray(r?.answer) ? (r?.answer ?? '') : null, // descriptive text if any
        fileUrl: r?.fileUrl ?? null, // descriptive file if any
        manualScore: r?.manualScore ?? null,   // ✅ show manual evaluation score
        remarks: r?.remarks ?? null,           // ✅ show remarks

      };
    });

    const startedAt = assignment.startedAt;
    const completedAt = assignment.completedAt;
    const timeTakenSec = timeDiffSec(startedAt, completedAt);

    res.json({
      assignmentId: assignment.id,
      attemptId: attempt.id,
      startedAt,
      completedAt,
      timeTakenSec,
      totals: {
        total: questions.length,
        autoGradable,
        correct,
        wrong,
        unanswered,
      },
      rows,
      employeeName: `${assignment.employee.firstName} ${assignment.employee.lastName}`,
      testId: assignment.testId,
      testName: assignment.test.name,
      status: attempt.status,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to build overview' });
  }
};

function safeParse<T>(s: any): T | null {
  try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
}
function timeDiffSec(start?: Date | null, end?: Date | null): number | null {
  if (!start || !end) return null;
  return Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}
