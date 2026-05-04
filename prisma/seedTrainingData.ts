/**
 * Seed script for the Training module + dependencies (tests, attempts, feedback,
 * attendance) so the management dashboard's Training Insights section has data
 * to render.
 *
 * Run with:
 *    npx ts-node prisma/seedTrainingData.ts
 *
 * Safe to re-run — it deletes only the rows it previously created (matched by
 * the "[SEED]" prefix in titles/names) before re-inserting.
 */

import { PrismaClient, TrainingStatus, TestPurpose } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_TAG = "[SEED]";

async function main() {
  console.log("\n──────────────────────────────────────────────");
  console.log("🌱 Seeding training data...");
  console.log("──────────────────────────────────────────────\n");

  // ── 0. Pick fixtures we need ─────────────────────────────────
  const employees = await prisma.employee.findMany({
    where: { employmentStatus: { in: ["ACTIVE", "NOTICE_PERIOD"] } },
    select: { id: true, departmentId: true, firstName: true, lastName: true },
    take: 30,
  });
  if (employees.length === 0) {
    console.error("❌ No active employees found. Aborting.");
    return;
  }

  const departments = await prisma.department.findMany({
    select: { id: true, name: true },
  });
  if (departments.length === 0) {
    console.error("❌ No departments found. Aborting.");
    return;
  }

  // Use the first employee as the creator/trainer
  const creator = employees[0];
  console.log(`👤 Using employee #${creator.id} (${creator.firstName} ${creator.lastName}) as creator`);
  console.log(`👥 ${employees.length} employees, ${departments.length} departments available\n`);

  // ── 1. Wipe existing seed data ───────────────────────────────
  console.log("🧹 Cleaning previous seed rows...");
  // Prisma cascades won't be set up, so delete in dependency order
  const oldTrainings = await prisma.training.findMany({
    where: { title: { startsWith: SEED_TAG } },
    select: { id: true },
  });
  const oldTrainingIds = oldTrainings.map((t) => t.id);
  if (oldTrainingIds.length) {
    await prisma.trainingFeedback.deleteMany({ where: { trainingId: { in: oldTrainingIds } } });
    await prisma.trainingAttendance.deleteMany({ where: { trainingId: { in: oldTrainingIds } } });
    await prisma.trainingTest.deleteMany({ where: { trainingId: { in: oldTrainingIds } } });
    await prisma.trainingAssignment.deleteMany({ where: { trainingId: { in: oldTrainingIds } } });
    await prisma.training.deleteMany({ where: { id: { in: oldTrainingIds } } });
    console.log(`   removed ${oldTrainings.length} previous training rows`);
  }

  const oldTests = await prisma.evaluationTest.findMany({
    where: { name: { startsWith: SEED_TAG } },
    select: { id: true, questionBankId: true },
  });
  if (oldTests.length) {
    const testIds = oldTests.map((t) => t.id);
    const bankIds = [...new Set(oldTests.map((t) => t.questionBankId))];
    await prisma.evaluationAttempt.deleteMany({ where: { testId: { in: testIds } } });
    await prisma.assignedTest.deleteMany({ where: { testId: { in: testIds } } });
    await prisma.questionOption.deleteMany({ where: { question: { questionBankId: { in: bankIds } } } });
    await prisma.question.deleteMany({ where: { questionBankId: { in: bankIds } } });
    await prisma.evaluationTest.deleteMany({ where: { id: { in: testIds } } });
    await prisma.questionBank.deleteMany({ where: { id: { in: bankIds } } });
    console.log(`   removed ${oldTests.length} previous test rows + question banks`);
  }

  // ── 2. Create question banks + tests ─────────────────────────
  console.log("\n📝 Creating question banks + tests...");
  const testTemplates = [
    { topic: "Workplace Safety", level: "BASIC",        passing: 70 },
    { topic: "Customer Service", level: "INTERMEDIATE", passing: 60 },
    { topic: "Leadership Skills", level: "ADVANCED",    passing: 65 },
    { topic: "POSH Compliance",   level: "BASIC",        passing: 80 },
    { topic: "Data Security",     level: "INTERMEDIATE", passing: 70 },
  ];
  const createdTests: { id: number; name: string; passing: number }[] = [];
  for (const tpl of testTemplates) {
    const bank = await prisma.questionBank.create({
      data: {
        name: `${SEED_TAG} ${tpl.topic} Bank`,
        role: tpl.level,
        createdBy: creator.id,
      },
    });
    // 5 sample MCQ questions per bank
    for (let i = 1; i <= 5; i++) {
      await prisma.question.create({
        data: {
          questionBankId: bank.id,
          text: `${tpl.topic} — sample question ${i}?`,
          type: "MCQ",
          weight: 1,
          correctAnswerIds: "1",
          options: {
            create: [
              { text: "Correct answer", isCorrect: true },
              { text: "Wrong A",        isCorrect: false },
              { text: "Wrong B",        isCorrect: false },
              { text: "Wrong C",        isCorrect: false },
            ],
          },
        },
      });
    }
    const test = await prisma.evaluationTest.create({
      data: {
        name: `${SEED_TAG} ${tpl.topic} Test`,
        questionBankId: bank.id,
        duration: 30,
        passingPercent: tpl.passing,
        maxAttempts: 3,
        isPublished: true,
        level: tpl.level,
        purpose: TestPurpose.TRAINING,
      },
    });
    createdTests.push({ id: test.id, name: test.name, passing: tpl.passing });
    console.log(`   ✓ ${test.name}`);
  }

  // ── 3. Create trainings spanning the current month ──────────
  console.log("\n🎓 Creating trainings spread across the current month...");
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // 8 trainings: some earlier in month, some today/upcoming
  const trainingTemplates: { offset: number; days: number; title: string; mode: string; deptIdx: number; trainerName: string; testIdx?: number }[] = [
    { offset: -20, days: 1, title: "Workplace Safety Refresher",   mode: "OFFLINE", deptIdx: 0, trainerName: "Aditya Sharma",   testIdx: 0 },
    { offset: -14, days: 2, title: "Customer Service Excellence",  mode: "ONLINE",  deptIdx: 1, trainerName: "Priya Iyer",       testIdx: 1 },
    { offset: -10, days: 1, title: "Leadership 101 for New Mgrs",  mode: "OFFLINE", deptIdx: 2, trainerName: "Rajesh Kumar",     testIdx: 2 },
    { offset:  -7, days: 1, title: "POSH Annual Compliance",       mode: "ONLINE",  deptIdx: 0, trainerName: "Meera Joshi",      testIdx: 3 },
    { offset:  -3, days: 2, title: "Data Security Awareness",      mode: "ONLINE",  deptIdx: 1, trainerName: "Arun Reddy",       testIdx: 4 },
    { offset:   0, days: 1, title: "Effective Communication",      mode: "OFFLINE", deptIdx: 2, trainerName: "Sneha Patel" },
    { offset:   3, days: 1, title: "Conflict Resolution Workshop", mode: "OFFLINE", deptIdx: 0, trainerName: "Vikram Singh" },
    { offset:   7, days: 2, title: "Time Management Skills",       mode: "ONLINE",  deptIdx: 1, trainerName: "Kavya Nair" },
  ];

  for (const tpl of trainingTemplates) {
    const startDate = new Date(now);
    startDate.setDate(now.getDate() + tpl.offset);
    startDate.setHours(10, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + tpl.days - 1);
    endDate.setHours(17, 0, 0, 0);

    const dept = departments[tpl.deptIdx % departments.length];
    const status: TrainingStatus =
      endDate < now ? TrainingStatus.COMPLETED :
      startDate > now ? TrainingStatus.ACTIVE :
      TrainingStatus.ACTIVE;

    const training = await prisma.training.create({
      data: {
        title: `${SEED_TAG} ${tpl.title}`,
        description: `Auto-seeded training: ${tpl.title}`,
        objectives: "Build skills relevant to role",
        trainerType: "INTERNAL",
        trainerName: tpl.trainerName,
        mode: tpl.mode,
        location: tpl.mode === "OFFLINE" ? "Conference Room A" : "Zoom",
        startDate,
        endDate,
        status,
        durationHours: tpl.days * 7,
        departmentId: dept.id,
        createdBy: creator.id,
      },
    });

    // Pick 5–10 random employees from the dept (or any employees) for assignment
    const deptEmps = employees.filter((e) => e.departmentId === dept.id);
    const pool = deptEmps.length >= 5 ? deptEmps : employees;
    const assignedSize = Math.min(pool.length, Math.floor(Math.random() * 6) + 5); // 5–10
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, assignedSize);

    for (const emp of shuffled) {
      const isCompleted = endDate < now && Math.random() > 0.2; // 80% completion for past trainings
      await prisma.trainingAssignment.create({
        data: {
          trainingId: training.id,
          employeeId: emp.id,
          assignedBy: creator.id,
          status: isCompleted ? "Completed" : "NotStarted",
          progress: isCompleted ? 100 : 0,
          completedAt: isCompleted ? endDate : null,
        },
      });

      // Mark attendance for past or current trainings
      if (startDate <= now) {
        for (let d = new Date(startDate); d <= endDate && d <= now; d.setDate(d.getDate() + 1)) {
          const attDay = new Date(d);
          attDay.setHours(0, 0, 0, 0);
          const present = Math.random() > 0.15; // 85% attendance
          await prisma.trainingAttendance.create({
            data: {
              trainingId: training.id,
              employeeId: emp.id,
              date: attDay,
              status: present ? "Present" : "Absent",
              markedBy: creator.id,
            },
          });
        }
      }

      // Add feedback for completed trainings
      if (isCompleted && Math.random() > 0.3) {
        const r = (mu = 4) => Math.max(1, Math.min(5, Math.round(mu + (Math.random() - 0.5) * 2)));
        await prisma.trainingFeedback.create({
          data: {
            trainingId: training.id,
            employeeId: emp.id,
            rating: r(4),
            trainerRating: r(4),
            contentQuality: r(4),
            relevance: r(4),
            feedback: "Auto-seeded feedback",
          },
        });
      }
    }

    // Link a test to the training (if template has testIdx)
    if (tpl.testIdx !== undefined && createdTests[tpl.testIdx]) {
      const test = createdTests[tpl.testIdx];
      await prisma.trainingTest.create({
        data: {
          trainingId: training.id,
          testId: test.id,
          isMandatory: true,
          orderNo: 1,
          deadlineDate: new Date(endDate.getTime() + 7 * 24 * 60 * 60 * 1000),
          testDate: endDate,
        },
      });

      // For each assigned employee, create AssignedTest + an attempt with a score
      for (const emp of shuffled) {
        const at = await prisma.assignedTest.create({
          data: {
            testId: test.id,
            employeeId: emp.id,
            assignedBy: creator.id,
            attempts: 1,
            status: endDate < now ? "Completed" : "NotStarted",
            startedAt: endDate < now ? endDate : null,
            completedAt: endDate < now ? endDate : null,
            deadlineDate: new Date(endDate.getTime() + 7 * 24 * 60 * 60 * 1000),
            testDate: endDate,
          },
        });

        if (endDate < now) {
          // Generate a realistic distribution of scores:
          // 25% Excellent (80-100), 35% Good (60-79), 25% Average (40-59), 15% Below (0-39)
          const r = Math.random();
          let score: number;
          if      (r < 0.25) score = Math.floor(80 + Math.random() * 21);
          else if (r < 0.60) score = Math.floor(60 + Math.random() * 20);
          else if (r < 0.85) score = Math.floor(40 + Math.random() * 20);
          else               score = Math.floor(Math.random() * 40);

          await prisma.evaluationAttempt.create({
            data: {
              employeeId: emp.id,
              testId: test.id,
              score,
              status: "Completed",
              response: JSON.stringify({ seeded: true }),
            },
          });
        }
      }
    }

    console.log(`   ✓ ${training.title}  (${assignedSize} assigned, ${tpl.mode}, dept: ${dept.name})`);
  }

  console.log("\n──────────────────────────────────────────────");
  console.log("✅ Training seed completed!");
  console.log("──────────────────────────────────────────────\n");

  // Summary counts
  const [tCount, taCount, attCount, fbCount, attemptCount] = await Promise.all([
    prisma.training.count({ where: { title: { startsWith: SEED_TAG } } }),
    prisma.trainingAssignment.count({ where: { training: { title: { startsWith: SEED_TAG } } } }),
    prisma.trainingAttendance.count({ where: { training: { title: { startsWith: SEED_TAG } } } }),
    prisma.trainingFeedback.count({ where: { training: { title: { startsWith: SEED_TAG } } } }),
    prisma.evaluationAttempt.count({ where: { response: { contains: '"seeded":true' } } }),
  ]);
  console.log(`   trainings:        ${tCount}`);
  console.log(`   assignments:      ${taCount}`);
  console.log(`   attendance rows:  ${attCount}`);
  console.log(`   feedback rows:    ${fbCount}`);
  console.log(`   test attempts:    ${attemptCount}\n`);
}

main()
  .catch((e) => {
    console.error("\n❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
