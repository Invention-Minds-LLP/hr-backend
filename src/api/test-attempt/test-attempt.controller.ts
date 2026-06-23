import { Request, Response } from 'express';
// import { PrismaClient } from "@prisma/client";
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
// Legacy FTP upload (kept for reference / fallback). Files now go to local disk.
// import { Client } from 'basic-ftp';
import { saveLocal, publicUrl } from '../../lib/fileStorage';
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { createNotification } from '../notifications/notifications.controller';
import { config } from '../../config';

// Legacy FTP credentials — no longer used now that uploads are stored locally.
// const FTP_CONFIG = {
//   host: config.ftp.host,
//   user: config.ftp.user,
//   password: config.ftp.pass,
//   secure: config.ftp.secure,
// }
const TEMP_FOLDER = path.join(__dirname, '../temp'); // absolute path

if (!fs.existsSync(TEMP_FOLDER)) {
  fs.mkdirSync(TEMP_FOLDER, { recursive: true });
}

export async function getAssignedTest(req: Request, res: Response) {
  const assignmentId = Number(req.params.id);

  const assignment = await prisma.assignedTest.findUnique({
    where: { id: assignmentId },
    include: {
      test: {
        include: { questions: false } // No need here, you load questionBank separately
      }
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

  const totalAttempts = assignment.test.maxAttempts; // Allowed attempts from test
  const attemptsTaken = assignment.attempts; // Attempts used

  res.json({
    ...assignment,
    attemptsInfo: {
      totalAttempts,
      attemptsTaken,
      attemptsLeft: totalAttempts - attemptsTaken
    },
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
// 2️⃣ Fetch employee + test details
    const assigned = await prisma.assignedTest.findUnique({
      where: { id: Number(assignedTestId) },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true }
        },
        test: {
          select: { name: true }
        }
      }
    });

    if (assigned?.employee) {
      const emp = assigned.employee;
      const employeeName = `${emp.firstName} ${emp.lastName}`;
      const testName = assigned.test?.name || "Test";

      // 🔔 Notify employee
      // await createNotification(
      //   emp.id,
      //   `You have successfully completed the ${testName}.`
      // );

      // 🔔 Notify HR
      const hrIds = await getHRIds();
      const message = `${employeeName} has completed the ${testName}.`;

      // for (const hrId of hrIds) {
      //   await createNotification(hrId, message);
      // }
    }
    
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to submit attempt' });
  }
}
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/\s+/g, '_'); // replace spaces with underscore
}

async function uploadToFTP(localFilePath: string, remoteFileName: string): Promise<any> {
  // Local disk storage (current). remoteFileName is a legacy
  // "/public_html/<folder>/<file>" path; saveLocal stores it under UPLOADS_DIR.
  await saveLocal(localFilePath, remoteFileName);

  // ── Legacy FTP upload (kept for reference / fallback) ─────────────────────
  // const client = new Client();
  // client.ftp.verbose = false;
  // try {
  //   await client.access(FTP_CONFIG);
  //   const folder = path.dirname(remoteFileName);
  //   await client.ensureDir(folder);
  //   console.log(remoteFileName)
  //   await client.uploadFrom(localFilePath, remoteFileName);
  //   await client.close();
  //
  //   // return `https://hrproindia.in/documents/${remoteFileName}`; // public URL
  // } catch (error) {
  //   console.error("FTP Upload Error:", error);
  //   throw new Error("FTP upload failed");
  // }
}

export const submitAttemptDescriptive = async (req: Request, res: Response) => {
  try {
    const form = formidable({
      uploadDir: TEMP_FOLDER,
      keepExtensions: true,
      multiples: true,
    });

    form.parse(req, async (err, fields, files) => {
      if (err) return res.status(500).json({ error: err.message });

      const attemptId = Number(fields.attemptId);
      const assignedTestId = Number(fields.assignedTestId);
      const testId = Number(fields.testId);
      const rawResponses = Array.isArray(fields.responses)
        ? fields.responses[0]              // formidable sometimes gives array
        : fields.responses ?? '[]';        // fallback if undefined
      let responses: any[] = JSON.parse(rawResponses);


      // process uploaded files
      for (const [field, fileData] of Object.entries(files)) {
        const file = Array.isArray(fileData) ? fileData[0] : fileData;
        if (!file) continue; // skip if undefined/null
        
        const tempFilePath = file.filepath!;
                
        const qid = Number(field.replace('file_', ''));
        const fileName = sanitizeFileName(
          file.originalFilename ?? `ans_${qid}_${Date.now()}.pdf`
        );

        const remoteFilePath = `/public_html/test-answers/${fileName}`;
        await uploadToFTP(tempFilePath, remoteFilePath);
        // const fileUrl = `https://hrproindia.in/test-answers/${fileName}`; // legacy FTP URL
        const fileUrl = publicUrl(remoteFilePath);
        fs.unlinkSync(tempFilePath);

        // inject fileUrl into response
        const r = responses.find((x: any) => x.questionId === qid);
        if (r) r.fileUrl = fileUrl;
      }

      // detect if descriptive exists
      const hasDescriptive = responses.some((r: any) => r.fileUrl || (typeof r.answer === 'string' && r.answer.trim().length > 0));

      let score = 0;
      let status = 'Completed';

      if (hasDescriptive) {
        // manual HR scoring later
        status = 'Pending Review';
      } else {
        // pure MCQ auto-score
        score = await calcMCQScore(responses, testId); // implement like your quick scoring
      }

      await prisma.$transaction([
        prisma.evaluationAttempt.update({
          where: { id: attemptId },
          data: {
            response: JSON.stringify(responses),
            score,
            status,
          },
        }),
        prisma.assignedTest.update({
          where: { id: assignedTestId },
          data: { status, completedAt: new Date() },
        }),
      ]);

      return res.json({ ok: true, score, status });
    });
  } catch (error) {
    console.error('Submit Attempt Error:', error);
    return res.status(500).json({ error: 'Failed to submit attempt' });
  }
};

async function calcMCQScore(responses: any[], testId: number): Promise<number> {
  // fetch questions + correct answers from DB
  const test = await prisma.evaluationTest.findUnique({
    where: { id: testId },
    include: { questions: { include: { options: true } } },
  });
  if (!test) return 0;

  let total = 0;
  let correctCount = 0;

  for (const q of test.questions) {
    if (q.type !== 'MCQ') continue;
    total++;

    // correct options
    const correct = q.options.filter((o: any) => o.isCorrect).map((o: any) => o.id).sort();

    // given options
    const r = responses.find((x: any) => x.questionId === q.id);
    const selected = Array.isArray(r?.answer) ? r.answer.slice().sort() : [];

    if (JSON.stringify(correct) === JSON.stringify(selected)) {
      correctCount++;
    }
  }

  return total > 0 ? Math.round((correctCount / total) * 100) : 0;
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
// POST /api/tests/attempts/:id/review
export const reviewAttempt = async (req: Request, res: Response) => {
  try {
    const attemptId = Number(req.params.id);
    const { scores, finalScore } = req.body;

    // update scores in responses JSON
    const attempt = await prisma.evaluationAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

    let responses = JSON.parse(attempt.response || '[]');
    for (const s of scores) {
      const r = responses.find((x: any) => x.questionId === s.questionId);
      if (r) r.hrScore = s.hrScore;
    }

    const updated = await prisma.evaluationAttempt.update({
      where: { id: attemptId },
      data: {
        response: JSON.stringify(responses),
        score: finalScore,
        status: 'Reviewed',
        // reviewedAt: new Date(),
        // reviewedBy: req.user?.id || null, // assuming you have auth
      }
    });

    res.json({ ok: true, attempt: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to review attempt' });
  }
};
export const evaluateAttempt = async (req: Request, res: Response) => {
  try {
    const { attemptId, evaluations } = req.body;

    const attempt = await prisma.evaluationAttempt.findUnique({
      where: { id: attemptId }
    });
    if (!attempt) return res.status(404).json({ error: "Attempt not found" });

    let responses: any[] = attempt.response ? JSON.parse(attempt.response) : [];

    console.log("Initial Responses:", responses);

    // merge manual scores into responses
    for (const ev of evaluations) {
      const r = responses.find((x: any) => x.questionId === ev.questionId);
      if (r) {
        r.manualScore = ev.manualScore;
        r.remarks = ev.remarks;
      }
    }
    const test = await prisma.evaluationTest.findUnique({
      where: { id: attempt.testId },
      include: {
        questions: { include: { options: true } }
      }
    });
    if (!test) throw new Error("Test not found");
    
    let questions = test.questions;
    if (questions.length === 0) {
      const bank = await prisma.questionBank.findUnique({
        where: { id: test.questionBankId },
        include: { questions: { include: { options: true } } }
      });
      questions = bank?.questions ?? [];
    }
    

    // weighted score calculation
    let totalMarks = 0;
    let obtainedMarks = 0;

    for (const q of questions) {
      const qMarks = q.weight || 1; // default 1 if not set
      console.log(`Question ID: ${q.id}, Type: ${q.type}, Weight: ${qMarks}`);
      totalMarks += qMarks;
      console.log(`Accumulated Total Marks: ${totalMarks}`);

      console.log(`Evaluating QID ${q.id}`, responses);

      const r = responses.find((x: any) => x.questionId === q.id);
      console.log(`Response for QID ${q.id}:`, r);

      if (q.type === "MCQ") {
        const correctIds = q.options.filter(o => o.isCorrect).map(o => o.id).sort();
        const selected = Array.isArray(r?.answer) ? r.answer.slice().sort() : [];

        if (JSON.stringify(correctIds) === JSON.stringify(selected)) {
          obtainedMarks += qMarks;
          if (r) r.isCorrect = true;
        } else {
          if (r) r.isCorrect = false;
        }
      } else if (q.type === "DESCRIPTIVE") {
        console.log(`Evaluating Descriptive QID ${q.id}`, r.manualScore, r);
        if (r?.manualScore != null) {
          console.log(`Descriptive QID ${q.id} has manual score: ${r.manualScore}`);
          // manualScore is awarded out of qMarks
          obtainedMarks += Math.min(r.manualScore, qMarks);
          console.log(`Descriptive QID ${q.id} awarded ${r.manualScore}/${qMarks}`);
        }
      }
    }

    console.log(`Total Marks: ${totalMarks}, Obtained Marks: ${obtainedMarks}`);

    const finalScore = totalMarks > 0
      ? Math.round((obtainedMarks / totalMarks) * 100)
      : 0;

    await prisma.evaluationAttempt.update({
      where: { id: attemptId },
      data: {
        response: JSON.stringify(responses),
        score: finalScore,
        status: "Reviewed", // better than "Completed"
      }
    });

    res.json({ ok: true, finalScore, obtainedMarks, totalMarks });
  } catch (err) {
    console.error("Manual evaluation error:", err);
    res.status(500).json({ error: "Failed to evaluate" });
  }
};

async function getHRIds(): Promise<number[]> {
  const hrs = await prisma.employee.findMany({
    where: {
      departmentId: 1,
      employmentStatus: 'ACTIVE'
    },
    select: { id: true }
  });

  return hrs.map(h => h.id);
}