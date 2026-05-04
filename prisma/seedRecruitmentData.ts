/**
 * Recruitment Module Seed
 * ────────────────────────
 * Populates demo data so every recruitment-dashboard widget has something
 * meaningful to render (instead of empty states everywhere).
 *
 * What gets created:
 *   • 5 Jobs across multiple departments, varied createdAt for the
 *     "Open Positions Ageing" widget
 *   • ~30 Candidates with diverse names, sources, qualifications
 *   • Applications spread across every status (APPLIED → HIRED + rejects)
 *   • Some applications referred by internal employees (referrer leaderboard)
 *   • Interviews in the last 60 days (heatmap + today's interviews)
 *   • InterviewFeedback rows with varied scores (hot-candidate signal)
 *   • CandidateAssignedTests with score histogram across 5 buckets
 *   • Offers in DRAFT / SENT / SIGNED / DECLINED / EXPIRED
 *   • ApplicationAuditLog transitions (activity feed + stage duration)
 *   • BackgroundVerification with mixed CLEAR / IN_PROGRESS / FAILED
 *   • CandidateReferences (pending + completed mix)
 *   • Manpower Requisitions in mixed approval states
 *
 * Idempotent:
 *   The script DELETES previously-seeded demo records before inserting
 *   fresh ones. Demo records are tagged via candidate emails ending in
 *   `@seed.demo`, so any real candidates you've added are untouched.
 *
 * Run:
 *   npx ts-node prisma/seedRecruitmentData.ts
 */

import { PrismaClient, ApplicationStatus, OfferStatus, JobStatus } from "@prisma/client";

const prisma = new PrismaClient();

// ── Tunables ──────────────────────────────────────────────────
const DEMO_EMAIL_DOMAIN = "@seed.demo";

// Realistic candidate pool
const FIRST_NAMES = [
  "Aarav", "Priya", "Vikram", "Anjali", "Rohan", "Meera", "Arjun", "Kavya",
  "Karthik", "Sneha", "Aditya", "Divya", "Suresh", "Lakshmi", "Manish",
  "Pooja", "Rajesh", "Neha", "Sanjay", "Riya", "Harsha", "Bhavna",
  "Naveen", "Swati", "Deepak", "Tara", "Vivek", "Ishaan", "Anika", "Rahul",
];
const LAST_NAMES = [
  "Sharma", "Iyer", "Patel", "Kumar", "Reddy", "Singh", "Gupta", "Nair",
  "Mehta", "Joshi", "Rao", "Khan", "Pillai", "Desai", "Bhatt",
];
const SOURCES = [
  "LinkedIn", "Naukri", "Referral", "Indeed", "Walk-in", "Company Website",
  "Agency", "Job Fair",
];
const QUALIFICATIONS = [
  "B.Tech CSE", "MCA", "MBA", "B.Com", "BSc Nursing", "M.Tech",
  "B.Pharm", "BBA", "BA Economics", "Diploma",
];
const JOB_TITLES = [
  { title: "Senior Software Engineer",        deptName: "Engineering",      headcount: 2 },
  { title: "Staff Nurse - ICU",               deptName: "Nursing",          headcount: 4 },
  { title: "Junior Accountant",               deptName: "Finance",          headcount: 1 },
  { title: "HR Executive",                    deptName: "Human Resources",  headcount: 1 },
  { title: "Front Desk Receptionist",         deptName: "Administration",   headcount: 2 },
];
const STAGES = ["Screening", "Round 1", "Tech Round", "HR Discussion", "Final"];

// ── Helpers ───────────────────────────────────────────────────
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const between = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86400000);
const phone = () => `9${between(100000000, 999999999)}`;

// Pick `n` distinct items from arr — safe when n > arr.length (caps at length).
function sampleN<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

async function main() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🌱  Seeding recruitment demo data");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── 1. Pre-flight: existing departments + employees we can reference ──
  const departments = await prisma.department.findMany({ select: { id: true, name: true } });
  if (departments.length === 0) {
    console.error("❌ No departments found. Create departments first.");
    process.exit(1);
  }
  const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d]));

  const employees = await prisma.employee.findMany({
    where: { employmentStatus: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true, roleId: true, departmentId: true },
  });
  if (employees.length === 0) {
    console.error("❌ No active employees found. Need at least one employee for createdBy / panel members.");
    process.exit(1);
  }
  const hr = employees.find((e) => e.roleId === 1) ?? employees[0];
  const referrers = employees.slice(0, Math.min(5, employees.length));
  const panelPool = employees.slice(0, Math.min(8, employees.length));
  console.log(`Found ${departments.length} departments and ${employees.length} active employees.`);

  // Optional: existing published evaluation test (if any) — used for test assignments.
  const existingTest = await prisma.evaluationTest.findFirst({
    where: { isPublished: true },
    select: { id: true, name: true, passingPercent: true, duration: true },
  });
  if (!existingTest) {
    console.log("ℹ️  No published EvaluationTest found — test assignments will be skipped.");
  }

  // ── 2. Cleanup: remove previously-seeded demo records ───────────────
  console.log("🧹 Cleaning previously-seeded demo records…");
  const oldCandidates = await prisma.candidate.findMany({
    where: { email: { endsWith: DEMO_EMAIL_DOMAIN } },
    select: { id: true },
  });
  const oldCandIds = oldCandidates.map((c) => c.id);
  if (oldCandIds.length) {
    const oldApps = await prisma.application.findMany({
      where: { candidateId: { in: oldCandIds } },
      select: { id: true },
    });
    const oldAppIds = oldApps.map((a) => a.id);

    if (oldAppIds.length) {
      await (prisma as any).bgvCheck?.deleteMany({ where: { bgv: { applicationId: { in: oldAppIds } } } }).catch(() => {});
      await (prisma as any).bgvDocument?.deleteMany({ where: { bgv: { applicationId: { in: oldAppIds } } } }).catch(() => {});
      await (prisma as any).backgroundVerification?.deleteMany({ where: { applicationId: { in: oldAppIds } } }).catch(() => {});
      await (prisma as any).candidateReference?.deleteMany({ where: { applicationId: { in: oldAppIds } } }).catch(() => {});
      await prisma.applicationAuditLog.deleteMany({ where: { applicationId: { in: oldAppIds } } }).catch(() => {});
      await prisma.interviewFeedback.deleteMany({ where: { interview: { applicationId: { in: oldAppIds } } } }).catch(() => {});
      await prisma.interviewPanelMember.deleteMany({ where: { interview: { applicationId: { in: oldAppIds } } } }).catch(() => {});
      await prisma.interview.deleteMany({ where: { applicationId: { in: oldAppIds } } }).catch(() => {});
      await prisma.candidateAssignedTest.deleteMany({ where: { applicationId: { in: oldAppIds } } }).catch(() => {});
      await prisma.offer.deleteMany({ where: { applicationId: { in: oldAppIds } } }).catch(() => {});
      await prisma.application.deleteMany({ where: { id: { in: oldAppIds } } });
    }
    await prisma.candidate.deleteMany({ where: { id: { in: oldCandIds } } });
    console.log(`   removed ${oldCandIds.length} old demo candidates and their related rows`);
  }
  // Wipe demo jobs (titled with marker)
  await prisma.job.deleteMany({ where: { title: { startsWith: "[DEMO]" } } });
  // Wipe demo manpower requisitions
  await prisma.manpowerRequisition.deleteMany({ where: { designation: { startsWith: "[DEMO]" } } }).catch(() => {});

  // ── 3. Jobs (varied createdAt for the Ageing widget) ───────────
  console.log("\n💼 Creating jobs…");
  const jobAges = [3, 14, 35, 65, 90]; // days
  const jobs: { id: number; title: string; departmentId: number; daysOpen: number }[] = [];
  for (let i = 0; i < JOB_TITLES.length; i++) {
    const t = JOB_TITLES[i];
    const dept = deptByName.get(t.deptName.toLowerCase()) ?? departments[i % departments.length];
    const job = await prisma.job.create({
      data: {
        title: `[DEMO] ${t.title}`,
        departmentId: dept.id,
        location: pick(["Bengaluru", "Mysuru", "Hyderabad", "Chennai"]),
        headcount: t.headcount,
        status: JobStatus.OPEN,
        createdBy: hr.id,
        createdAt: daysAgo(jobAges[i]),
      },
    });
    jobs.push({ id: job.id, title: job.title, departmentId: dept.id, daysOpen: jobAges[i] });
    console.log(`   • ${job.title}  (${jobAges[i]}d open · dept ${dept.name})`);
  }

  // ── 4. Candidates ────────────────────────────────────────────
  console.log("\n👥 Creating candidates…");
  const candidates: { id: number; name: string; email: string }[] = [];
  for (let i = 0; i < 30; i++) {
    const fn = pick(FIRST_NAMES);
    const ln = pick(LAST_NAMES);
    const name = `${fn} ${ln}`;
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}${i}${DEMO_EMAIL_DOMAIN}`;
    const cand = await prisma.candidate.create({
      data: {
        name, email,
        phone: phone(),
        source: pick(SOURCES),
        qualification: pick(QUALIFICATIONS),
        experience: String(between(0, 12)),
      },
    });
    candidates.push({ id: cand.id, name, email });
  }
  console.log(`   • ${candidates.length} candidates created`);

  // ── 5. Applications spread across statuses ──────────────────
  // Distribution chosen to make every dashboard widget meaningful.
  const distribution: { status: ApplicationStatus; count: number; updatedDaysAgo: () => number }[] = [
    { status: ApplicationStatus.APPLIED,             count: 6, updatedDaysAgo: () => between(0, 12) }, // some stale
    { status: ApplicationStatus.SHORTLISTED,         count: 4, updatedDaysAgo: () => between(0, 5) },
    { status: ApplicationStatus.INTERVIEW_SCHEDULED, count: 4, updatedDaysAgo: () => between(0, 3) },
    { status: ApplicationStatus.INTERVIEWED,         count: 3, updatedDaysAgo: () => between(0, 7) },
    { status: ApplicationStatus.OFFERED,             count: 3, updatedDaysAgo: () => between(0, 5) },
    { status: ApplicationStatus.OFFER_ACCEPTED,      count: 2, updatedDaysAgo: () => between(1, 8) },
    { status: ApplicationStatus.OFFER_DECLINED,      count: 1, updatedDaysAgo: () => between(2, 15) },
    { status: ApplicationStatus.HIRED,               count: 4, updatedDaysAgo: () => between(5, 60) },
    { status: ApplicationStatus.REJECTED,            count: 2, updatedDaysAgo: () => between(2, 30) },
    { status: ApplicationStatus.NO_SHOW,             count: 1, updatedDaysAgo: () => between(2, 20) },
  ];

  console.log("\n📥 Creating applications…");
  let candIdx = 0;
  const applications: any[] = [];

  for (const block of distribution) {
    for (let i = 0; i < block.count; i++) {
      if (candIdx >= candidates.length) break;
      const cand = candidates[candIdx++];
      const job = pick(jobs);
      // 40% of HIRED + 25% of OFFERED apps get an INTERNAL referral
      let referralFields: any = {};
      const refRoll = Math.random();
      if (
        (block.status === ApplicationStatus.HIRED && refRoll < 0.4) ||
        (block.status === ApplicationStatus.OFFERED && refRoll < 0.25) ||
        (block.status === ApplicationStatus.OFFER_ACCEPTED && refRoll < 0.5)
      ) {
        const referrer = pick(referrers);
        referralFields = {
          referralType: "INTERNAL",
          referrerEmployeeId: referrer.id,
          referrerName: `${referrer.firstName} ${referrer.lastName}`,
          referralBonusStatus: block.status === ApplicationStatus.HIRED ? "PENDING_PROBATION" : "PENDING_JOIN",
        };
      } else if (refRoll < 0.6) {
        referralFields = { referralType: pick(["JOB_BOARD", "SOCIAL", "WALK_IN"] as const) };
      }

      // Consent for offered+ stages
      const consentFields: any = {};
      if (
        block.status === ApplicationStatus.OFFERED ||
        block.status === ApplicationStatus.OFFER_ACCEPTED ||
        block.status === ApplicationStatus.HIRED
      ) {
        if (Math.random() > 0.2) consentFields.referencesConsentAt = daysAgo(between(5, 25));
        if (Math.random() > 0.3) consentFields.bgvConsentAt        = daysAgo(between(3, 20));
      }

      const updatedTime = daysAgo(block.updatedDaysAgo());
      const app = await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: cand.id,
          status: block.status,
          source: pick(SOURCES),
          createdAt: daysAgo(between(block.updatedDaysAgo() + 1, block.updatedDaysAgo() + 45)),
          updatedAt: updatedTime,
          ...referralFields,
          ...consentFields,
        },
      });
      applications.push({ ...app, candidateName: cand.name, jobTitle: job.title });
    }
  }
  console.log(`   • ${applications.length} applications across ${distribution.length} statuses`);

  // ── 6. ApplicationAuditLog — past transitions for activity feed + stage duration ─
  console.log("\n📜 Audit logs…");
  const stageOrder: ApplicationStatus[] = [
    ApplicationStatus.APPLIED, ApplicationStatus.SCREENING, ApplicationStatus.SHORTLISTED,
    ApplicationStatus.INTERVIEW_SCHEDULED, ApplicationStatus.INTERVIEWED,
    ApplicationStatus.OFFERED, ApplicationStatus.OFFER_ACCEPTED, ApplicationStatus.HIRED,
  ];
  let auditCount = 0;
  for (const app of applications) {
    const targetIdx = stageOrder.indexOf(app.status);
    if (targetIdx <= 0) continue;
    const path = stageOrder.slice(0, targetIdx + 1);
    let cursor = new Date(app.createdAt);
    for (let i = 1; i < path.length; i++) {
      // Each stage takes 2-7 days
      cursor = new Date(cursor.getTime() + between(2, 7) * 86400000);
      if (cursor > new Date()) break;
      await prisma.applicationAuditLog.create({
        data: {
          applicationId: app.id,
          action: "STATUS_CHANGED",
          fromStatus: path[i - 1],
          toStatus:   path[i],
          performedAt: cursor,
          performedBy: hr.id,
        },
      });
      auditCount++;
    }
  }
  console.log(`   • ${auditCount} audit log entries`);

  // ── 7. Interviews + panel + feedback (last 60 days for the heatmap) ─
  console.log("\n🎤 Interviews + feedback…");
  const interviewables = applications.filter((a) =>
    [
      ApplicationStatus.INTERVIEW_SCHEDULED,
      ApplicationStatus.INTERVIEWED,
      ApplicationStatus.OFFERED,
      ApplicationStatus.OFFER_ACCEPTED,
      ApplicationStatus.HIRED,
    ].includes(a.status),
  );
  let ivCount = 0, fbCount = 0;
  for (const app of interviewables) {
    const isUpcoming = app.status === ApplicationStatus.INTERVIEW_SCHEDULED;
    // Today gets one slot; rest scattered over last 60d
    const start = isUpcoming
      ? new Date(new Date().setHours(between(10, 17), 0, 0, 0))
      : daysAgo(between(1, 60));
    start.setHours(between(9, 18), pick([0, 30]), 0, 0);
    const end = new Date(start.getTime() + 60 * 60000);

    const panelEmps = sampleN(panelPool, between(1, 3));
    const interview = await prisma.interview.create({
      data: {
        applicationId: app.id,
        stage: pick(STAGES),
        startTime: start,
        endTime: end,
        result: isUpcoming ? null : pick(["Pass", "Pass", "Fail", null]),
        panelUserIds: panelEmps.map((e) => e.id).join(","),
      },
    });
    for (const p of panelEmps) {
      await prisma.interviewPanelMember.create({
        data: { interviewId: interview.id, employeeId: p.id },
      });
    }
    ivCount++;
    // Feedback for completed interviews — varied averages so hot-candidate signal kicks in
    if (!isUpcoming && Math.random() > 0.2) {
      const isHot = Math.random() < 0.25;
      const avg = isHot ? between(8, 10) : between(4, 8);
      const panelist = panelEmps[0];
      await prisma.interviewFeedback.create({
        data: {
          interviewId: interview.id,
          panelUserId: panelist.id,
          name: `${panelist.firstName} ${panelist.lastName}`,
          jobSkills: avg, jobKnowledge: avg, attitude: avg, communication: avg,
          average: avg,
          status: "SUBMITTED",
          submittedAt: new Date(start.getTime() + 2 * 86400000),
        } as any,
      });
      fbCount++;
    }
  }
  console.log(`   • ${ivCount} interviews · ${fbCount} feedback rows`);

  // ── 8. CandidateAssignedTest (varied scores for histogram + hot signal) ─
  if (existingTest) {
    console.log("\n📝 Test assignments…");
    let tCount = 0;
    // Apply tests to roughly half of all applications, with a score distribution
    // that fills every histogram bucket (0-19, 20-39, 40-59, 60-79, 80-100)
    const targets = sampleN(applications, Math.floor(applications.length * 0.6));
    const scoreBuckets = [10, 35, 55, 72, 88, 95, 65, 45, 80, 30, 92, 70, 50, 25, 85];
    for (let i = 0; i < targets.length; i++) {
      const app = targets[i];
      const score = scoreBuckets[i % scoreBuckets.length] + between(-3, 3);
      await prisma.candidateAssignedTest.create({
        data: {
          applicationId: app.id,
          candidateId: app.candidateId,
          testId: existingTest.id,
          assignedBy: hr.id,
          assignedAt: daysAgo(between(5, 30)),
          status: "Completed",
          attempts: 1,
          startedAt: daysAgo(between(3, 25)),
          completedAt: daysAgo(between(2, 20)),
          score,
          reviewDecision: score >= existingTest.passingPercent ? "PASS" : "FAIL",
          reviewedAt: daysAgo(between(1, 15)),
          reviewedBy: hr.id,
        },
      });
      tCount++;
    }
    console.log(`   • ${tCount} test assignments with scored results`);
  }

  // ── 9. Offers ──────────────────────────────────────────────
  console.log("\n📨 Offers…");
  const offerables = applications.filter((a) =>
    [
      ApplicationStatus.OFFERED, ApplicationStatus.OFFER_ACCEPTED,
      ApplicationStatus.OFFER_DECLINED, ApplicationStatus.HIRED, ApplicationStatus.NO_SHOW,
    ].includes(a.status),
  );
  let oCount = 0, expiringSoon = 0;
  for (const app of offerables) {
    let status: OfferStatus = OfferStatus.SENT;
    let signedAt: Date | null = null;
    let declinedAt: Date | null = null;
    let proposedJoinAt: Date | null = daysAhead(between(7, 30));

    if (app.status === ApplicationStatus.OFFERED) {
      // Mix of SENT and VIEWED, half with proposed join in next 7 days
      status = pick([OfferStatus.SENT, OfferStatus.VIEWED]);
      if (Math.random() < 0.5) {
        proposedJoinAt = daysAhead(between(2, 6));   // expiring soon
        expiringSoon++;
      }
    } else if (app.status === ApplicationStatus.OFFER_ACCEPTED || app.status === ApplicationStatus.HIRED) {
      status = OfferStatus.SIGNED;
      signedAt = daysAgo(between(1, 60));
      proposedJoinAt = daysAhead(between(-30, 14));
    } else if (app.status === ApplicationStatus.OFFER_DECLINED) {
      status = OfferStatus.DECLINED;
      declinedAt = daysAgo(between(1, 90));
    } else if (app.status === ApplicationStatus.NO_SHOW) {
      status = OfferStatus.SIGNED;
      signedAt = daysAgo(between(15, 60));
      proposedJoinAt = daysAgo(between(1, 14));
    }

    await prisma.offer.create({
      data: {
        applicationId: app.id,
        status,
        // Every demo offer is past the DRAFT stage, so a sent timestamp is always set.
        sentAt:  daysAgo(between(2, 60)),
        signedAt,
        declinedAt,
        proposedJoinAt,
        ctc: between(300000, 1500000),
      } as any,
    });
    oCount++;
  }
  console.log(`   • ${oCount} offers (${expiringSoon} expiring within 7 days)`);

  // ── 10. Background Verification ───────────────────────────
  console.log("\n🛡️ Background verifications…");
  const bgvableApps = applications.filter((a) =>
    [ApplicationStatus.OFFERED, ApplicationStatus.OFFER_ACCEPTED, ApplicationStatus.HIRED].includes(a.status),
  );
  let bgvCount = 0;
  const bgvStatuses = ["IN_PROGRESS", "CLEAR", "FLAGGED", "FAILED"];
  for (let i = 0; i < bgvableApps.length; i++) {
    const app = bgvableApps[i];
    if (Math.random() < 0.3) continue; // some apps skip BGV (creates compliance gaps)
    const status = bgvStatuses[i % bgvStatuses.length];
    try {
      const bgv = await (prisma as any).backgroundVerification.create({
        data: {
          applicationId: app.id,
          status,
          vendor: "Internal HR",
          initiatedBy: hr.id,
          initiatedAt: daysAgo(between(3, 25)),
          completedAt: status === "CLEAR" || status === "FAILED" ? daysAgo(between(1, 10)) : null,
        },
      });
      const checkTypes = ["IDENTITY", "EDUCATION", "EMPLOYMENT", "ADDRESS", "CRIMINAL"];
      for (const t of checkTypes) {
        const checkStatus =
          status === "CLEAR" ? "CLEAR" :
          status === "FAILED" ? (t === "CRIMINAL" ? "FAILED" : "CLEAR") :
          status === "FLAGGED" ? (t === "EDUCATION" ? "DISCREPANCY" : "CLEAR") :
          pick(["PENDING", "CLEAR"]);
        await (prisma as any).bgvCheck.create({
          data: { bgvId: bgv.id, type: t, status: checkStatus },
        });
      }
      bgvCount++;
    } catch (e) {
      // Schema may not be pushed yet — soft fail
      break;
    }
  }
  console.log(`   • ${bgvCount} BGV records (mixed statuses)`);

  // ── 11. Candidate references ───────────────────────────
  console.log("\n📞 Candidate references…");
  let refCount = 0;
  for (const app of bgvableApps) {
    if (Math.random() < 0.25) continue;
    try {
      const refs = between(1, 3);
      for (let i = 0; i < refs; i++) {
        const fn = pick(FIRST_NAMES);
        const ln = pick(LAST_NAMES);
        await (prisma as any).candidateReference.create({
          data: {
            applicationId: app.id,
            refereeName: `${fn} ${ln}`,
            refereeRelation: pick(["Reporting Manager", "Peer", "HR", "Senior"]),
            refereeCompany: pick(["TCS", "Infosys", "Wipro", "Manipal Hospitals", "Apollo"]),
            refereeEmail: `${fn.toLowerCase()}.${ln.toLowerCase()}@previous.demo`,
            refereePhone: phone(),
            checkStatus: pick(["PENDING", "DONE", "DONE", "IN_PROGRESS"]),
            feedback: Math.random() > 0.5 ? "Strong performer; worked on multiple projects together." : null,
            rating: Math.random() > 0.5 ? between(3, 5) : null,
            checkedAt: Math.random() > 0.5 ? daysAgo(between(1, 14)) : null,
          },
        });
        refCount++;
      }
    } catch (e) { break; }
  }
  console.log(`   • ${refCount} reference rows`);

  // ── 12. Manpower Requisitions ─────────────────────────
  console.log("\n📋 Manpower requisitions…");
  let mrCount = 0;
  const mrStatuses = ["RAISED", "HOD_APPROVED", "COO_APPROVED", "HR_RECEIVED", "REJECTED"];
  for (let i = 0; i < 6; i++) {
    const t = pick(JOB_TITLES);
    const dept = deptByName.get(t.deptName.toLowerCase()) ?? departments[0];
    try {
      await prisma.manpowerRequisition.create({
        data: {
          requestDate: daysAgo(between(1, 60)),
          designation: `[DEMO] ${t.title}`,
          departmentId: dept.id,
          reasonType: pick(["NEW_OPENING", "REPLACEMENT", "PLANNED_ADDITION"]),
          urgent: Math.random() < 0.3,
          duration: "Permanent",
          title: `[DEMO] ${t.title}`,
          status: mrStatuses[i % mrStatuses.length],
          raisedBy: `${pick(employees).firstName} ${pick(employees).lastName}`,
          raisedByDate: daysAgo(between(1, 60)),
          createdAt: daysAgo(between(1, 60)),
        } as any,
      });
      mrCount++;
    } catch (e) { break; }
  }
  console.log(`   • ${mrCount} manpower requisitions`);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ Seed complete!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\nWhat to expect on the recruitment dashboard:");
  console.log("  • Outcomes row populated (Open Vacancies, Apps Received, Time-to-Hire, Hired, Rejected)");
  console.log("  • Pipeline funnel showing real conversion rates between stages");
  console.log("  • Today's Interviews — scheduled today");
  console.log("  • Open Positions Ageing — one job at 65/90 days will hit the red threshold");
  console.log("  • Source Effectiveness bars across LinkedIn / Naukri / Referral / etc.");
  console.log("  • Daily Operations: Jobs, Application Status, Interview tables full of data");
  console.log("  • Daily Ops insights: Stale (apps idle > 7d), Hot (test score ≥ 80), Activity feed, Stage Duration");
  console.log("  • Compliance & Risk: gaps for offered apps with missing BGV / refs / consent");
  console.log("  • Strategy: Top referrers leaderboard, demand vs supply, accept trend, score histogram");
  console.log("  • Reporting: heatmap with interview density across last 60 days\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
