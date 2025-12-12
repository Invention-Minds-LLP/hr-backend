// recruiting.controller.ts
import { Request, Response, NextFunction } from 'express';
import { PrismaClient, JobStatus, ApplicationStatus, OfferStatus, JoinOutcome, RejectReason, EmploymentType, EmploymentStatus, Gender } from '@prisma/client';
import formidable, { File as FormidableFile } from "formidable";
import fs from "fs";
import { Client } from 'basic-ftp';
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";


const prisma = new PrismaClient();

const FTP_CONFIG = {
  host: "srv680.main-hosting.eu", // Your FTP hostname
  user: "u948610439.hrproindia.in", // Your FTP username
  password: "Bsrenuk@1993", // Your FTP password
  secure: false // Set to true if using FTPS
};
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function uploadToFTP(localFilePath: string, remoteFileName: string): Promise<any> {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(FTP_CONFIG);
    const remoteDir = "/public_html/resume";
    await client.ensureDir(remoteDir); // Change folder for HR docs
    console.log(remoteFileName)
    await client.uploadFrom(localFilePath, remoteFileName);
    await client.close();

    // return `https://hrproindia.in/documents/${remoteFileName}`; // public URL
  } catch (error) {
    console.error("FTP Upload Error:", error);
    throw new Error("FTP upload failed");
  }
}

/** Small helper to catch async errors */
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
    (req: Request, res: Response, next: NextFunction) =>
      fn(req, res, next).catch(next);

function bad(res: Response, msg: string, code = 400) {
  return res.status(code).json({ error: msg });
}

const ALLOWED_FOR_OFFER = new Set<ApplicationStatus>([
  ApplicationStatus.INTERVIEWED,
  ApplicationStatus.OFFERED,
  ApplicationStatus.OFFER_ACCEPTED,
]);

/** Guard helpers */
const canAdvanceTo: Record<ApplicationStatus, ApplicationStatus[]> = {
  APPLIED: ['SCREENING', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN'],
  SCREENING: ['SHORTLISTED', 'REJECTED', 'WITHDRAWN'],
  SHORTLISTED: ['INTERVIEW_SCHEDULED', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW_SCHEDULED: ['INTERVIEWED', 'REJECTED', 'WITHDRAWN', 'NO_SHOW'],
  INTERVIEWED: ['OFFERED', 'REJECTED', 'WITHDRAWN'],
  OFFERED: ['OFFER_ACCEPTED', 'OFFER_DECLINED', 'WITHDRAWN'],
  OFFER_ACCEPTED: ['HIRED', 'NO_SHOW'],
  OFFER_DECLINED: [],
  REJECTED: [],
  WITHDRAWN: [],
  HIRED: [],
  NO_SHOW: [],
};

const offerNext: Record<OfferStatus, OfferStatus[]> = {
  DRAFT: ['SENT', 'WITHDRAWN'],
  SENT: ['VIEWED', 'SIGNED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'],
  VIEWED: ['SIGNED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'],
  SIGNED: [],
  DECLINED: [],
  WITHDRAWN: [],
  EXPIRED: [],
};

export class RecruitingController {
  // ---------------- Jobs ----------------

  /** POST /jobs */
  createJob = asyncHandler(async (req, res) => {
    const { title, departmentId, location, headcount = 1, createdBy, backfillForEmployeeId } = req.body || {};
    if (!title || !departmentId || !createdBy) return bad(res, 'title, departmentId, createdBy are required');

    const job = await prisma.job.create({
      data: { title, departmentId: Number(departmentId), location, headcount: Number(headcount), createdBy, backfillForEmployeeId },
    });
    res.status(201).json(job);
  });

  /** GET /jobs?status=OPEN&dept=2&q=engineer&page=1&pageSize=20 */
  listJobs = asyncHandler(async (req, res) => {
    const { status, dept, q, page = '1', pageSize = '20' } = req.query as any;

    const where: any = {};
    if (status) where.status = status as JobStatus;
    if (dept) where.departmentId = Number(dept);
    if (q) where.title = { contains: String(q), mode: 'insensitive' };

    const take = Math.min(100, Number(pageSize) || 20);
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;

    const [rows, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          department: { select: { id: true, name: true } },  // only what you need
          _count: { select: { applications: true } },
        },
        take,
        skip,
      }),
      prisma.job.count({ where }),
    ]);

    // Flatten department name + keep a compact shape
    const out = rows.map((j) => ({
      id: j.id,
      title: j.title,
      departmentId: j.departmentId,
      departmentName: j.department?.name ?? null,
      location: j.location,
      headcount: j.headcount,
      status: j.status,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      applicationsCount: j._count.applications,
    }));

    res.json({ total, rows: out });
  });


  /** PATCH /jobs/:id/status { status } */
  changeJobStatus = asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body || {};
    if (!status) return bad(res, 'status required');
    const job = await prisma.job.update({ where: { id }, data: { status } });
    res.json(job);
  });

  // ---------------- Candidates & Applications ----------------

  /** POST /candidates (raw) */
  createCandidate = asyncHandler(async (req, res) => {
    const { name, email, phone, source, resumeUrl, address } = req.body || {};
    if (!name || !email) return bad(res, 'name and email are required');
    const cand = await prisma.candidate.create({ data: { name, email, phone, source, resumeUrl, address } });
    res.status(201).json(cand);
  });

  /** POST /applications  { jobId, candidate: { name, email, ... } } OR { jobId, candidateId } */
  // createApplication = asyncHandler(async (req, res) => {
  //   const { jobId, candidateId, candidate } = req.body || {};
  //   if (!jobId) return bad(res, 'jobId is required');

  //   const app = await prisma.$transaction(async (tx) => {
  //     let candId = candidateId ? Number(candidateId) : undefined;

  //     if (!candId) {
  //       if (!candidate?.name || !candidate?.email) throw new Error('candidate.name and candidate.email are required');
  //       // upsert by email
  //       const cand = await tx.candidate.upsert({
  //         where: { email: candidate.email },
  //         update: { name: candidate.name, phone: candidate.phone, source: candidate.source, resumeUrl: candidate.resumeUrl, experience: candidate.experience.toString(), qualification: candidate.qualification },
  //         create: { name: candidate.name, email: candidate.email, phone: candidate.phone, source: candidate.source, resumeUrl: candidate.resumeUrl, experience: candidate.experience.toString(), qualification: candidate.qualification },
  //       });
  //       candId = cand.id;
  //     }

  //     return tx.application.create({
  //       data: { jobId: Number(jobId), candidateId: candId, status: ApplicationStatus.APPLIED },
  //       include: { candidate: true, job: true },
  //     });
  //   });

  //   res.status(201).json(app);
  // });


  createApplication = asyncHandler(async (req, res) => {
    const form = formidable({ multiples: false });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error("Form parse error:", err);
        return res.status(400).json({ error: "File upload failed" });
      }

      try {
        // fields can be string | string[] | undefined
        const jobId = fields.jobId
          ? Number(Array.isArray(fields.jobId) ? fields.jobId[0] : fields.jobId)
          : undefined;

        const candidateId = fields.candidateId
          ? Number(Array.isArray(fields.candidateId) ? fields.candidateId[0] : fields.candidateId)
          : undefined;

        const candidateRaw = fields.candidate
          ? Array.isArray(fields.candidate)
            ? fields.candidate[0]
            : fields.candidate
          : "{}";

        const candidate = JSON.parse(candidateRaw);

        if (!jobId) return res.status(400).json({ error: "jobId is required" });

        const resumeField = files.resume as FormidableFile | FormidableFile[] | undefined;
        let resumeUrl: string | undefined;
        let resumeFile: FormidableFile | undefined;
        if (Array.isArray(resumeField)) {
          resumeFile = resumeField[0]; // take the first file if multiple
        } else {
          resumeFile = resumeField;
        }

        if (resumeFile) {
          const filePath = resumeFile.filepath;
          const fileName = `${Date.now()}_${resumeFile.originalFilename}`;
          const remoteFilePath = `/public_html/resume/${fileName}`;

          await uploadToFTP(filePath, remoteFilePath);
          resumeUrl = `https://hrproindia.in/resume/${fileName}`;
          console.log("Uploaded resume URL:", resumeUrl);

          fs.unlinkSync(filePath);
        }

        console.log("Resume URL to save:", resumeUrl);


        // --- Transaction ---
        const app = await prisma.$transaction(async (tx) => {
          let candId = candidateId;

          if (!candId) {
            if (!candidate?.name || !candidate?.email) {
              throw new Error("candidate.name and candidate.email are required");
            }

            // Upsert by email
            const cand = await tx.candidate.upsert({
              where: { email: candidate.email },
              update: {
                name: candidate.name,
                phone: candidate.phone.toString(),
                source: candidate.source,
                resumeUrl: resumeUrl || candidate.resumeUrl,
                experience: candidate.experience?.toString(),
                qualification: candidate.qualification,
                address: candidate.address,
              },
              create: {
                name: candidate.name,
                email: candidate.email,
                phone: candidate.phone.toString(),
                source: candidate.source,
                resumeUrl: resumeUrl || candidate.resumeUrl,
                experience: candidate.experience?.toString(),
                qualification: candidate.qualification,
                address: candidate.address,
              },
            });

            candId = cand.id;
          }

          return tx.application.create({
            data: {
              jobId,
              candidateId: candId,
              status: ApplicationStatus.APPLIED,
            },
            include: { candidate: true, job: true },
          });
        });

        res.status(201).json(app);
      } catch (error) {
        console.error("Error creating application:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
  });


  /** GET /applications?jobId=..&status=..&q=.. */
  listApplications = asyncHandler(async (req, res) => {
    const { jobId, status, q, page = '1', pageSize = '20' } = req.query as any;
    const where: any = {};
    if (jobId) where.jobId = Number(jobId);
    if (status) where.status = status as ApplicationStatus;
    if (q) where.OR = [{ candidate: { name: { contains: q, mode: 'insensitive' } } }, { candidate: { email: { contains: q, mode: 'insensitive' } } }];

    const take = Math.min(100, Number(pageSize) || 20);
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;

    const [rows, total] = await Promise.all([
      prisma.application.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        include: { candidate: true, job: true, offer: true, interviews: true, CandidateAssignedTest: true },
        take,
        skip,
      }),
      prisma.application.count({ where }),
    ]);
    res.json({ total, rows });
  });

  /** PATCH /applications/:id/status { to, rejectReason?, currentStage? } */
  /** PATCH /applications/:id/status { to, rejectReason?, currentStage? } */
  moveApplication = asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { to, rejectReason, currentStage, shortListNote } = req.body || {};
    if (!to) return bad(res, '`to` is required');

    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) return bad(res, 'Application not found', 404);

    if (!canAdvanceTo[app.status as ApplicationStatus]?.includes(to as ApplicationStatus)) {
      return bad(res, `Cannot move application from ${app.status} → ${to}`);
    }

    // Enforce inputs for specific transitions
    if (to === ApplicationStatus.REJECTED && !rejectReason) {
      return bad(res, 'rejectReason is required when rejecting');
    }
    if (to === ApplicationStatus.SHORTLISTED && !shortListNote) {
      return bad(res, 'shortlistNotes is required when shortlisting (e.g., "Tech Round 1")');
    }

    // (optional) validate enum
    if (to === ApplicationStatus.REJECTED) {
      const valid = Object.values(RejectReason).includes(rejectReason as RejectReason);
      if (!valid) return bad(res, `rejectReason must be one of: ${Object.values(RejectReason).join(', ')}`);
    }

    const updated = await prisma.application.update({
      where: { id },
      data: {
        status: to as ApplicationStatus,
        rejectReason: to === ApplicationStatus.REJECTED ? (rejectReason as RejectReason) : null,
        currentStage: to === ApplicationStatus.SHORTLISTED ? currentStage : app.currentStage,
        shortlistNote: to === ApplicationStatus.SHORTLISTED ? shortListNote : app.shortlistNote,
      },
    });


    res.json(updated);
  });


  // ---------------- Interviews ----------------

  /** POST /applications/:id/interviews  { stage, startTime, endTime, panelUserIds?, feedbackDue? } */
  // scheduleInterview = asyncHandler(async (req, res) => {
  //   const applicationId = Number(req.params.id);
  //   const { stage, startTime, endTime, panelUserIds, feedbackDue } = req.body || {};
  //   if (!stage || !startTime || !endTime) return bad(res, 'stage, startTime, endTime are required');

  //   const app = await prisma.application.findUnique({ where: { id: applicationId } });
  //   if (!app) return bad(res, 'Application not found', 404);

  //   const itv = await prisma.$transaction(async (tx) => {
  //     // move status if needed
  //     if (app.status === ApplicationStatus.SHORTLISTED || app.status === ApplicationStatus.SCREENING) {
  //       await tx.application.update({ where: { id: applicationId }, data: { status: ApplicationStatus.INTERVIEW_SCHEDULED } });
  //     }
  //     return tx.interview.create({
  //       data: {
  //         applicationId,
  //         stage,
  //         startTime: new Date(startTime),
  //         endTime: new Date(endTime),
  //         panelUserIds,
  //         feedbackDue: feedbackDue ? new Date(feedbackDue) : null,
  //       },
  //     });
  //   });

  //   res.status(201).json(itv);
  // });
  /** POST /applications/:id/interviews  
 * body: { stage, startTime, endTime, panelUserIds: number[], feedbackDue? }
 */
  scheduleInterview = asyncHandler(async (req, res) => {
    const applicationId = Number(req.params.id);
    const { stage, startTime, endTime, panelUserIds, feedbackDue } = req.body || {};

    if (!stage || !startTime || !endTime) return bad(res, 'stage, startTime, endTime are required');

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        candidate: true,
        job: true,
      }
    });
    if (!app) return bad(res, 'Application not found', 404);

    // ✅ Step 1: Parse panelUserIds safely
    const panels: number[] = Array.isArray(panelUserIds)
      ? panelUserIds.map(Number)
      : typeof panelUserIds === 'string'
        ? panelUserIds.split(',').map(s => Number(s.trim()))
        : [];

    if (!panels.length) return bad(res, 'At least one panel member is required');

    const panelEmployees = await prisma.employee.findMany({
      where: { id: { in: panels } },
      select: { firstName: true, lastName: true }
    });
  
    const panelNames = panelEmployees
    .map(e => `${e.firstName} ${e.lastName}`)
    .join(', ');
    const start = new Date(startTime);
    const end = new Date(endTime);

    // ✅ Step 2: Check for overlapping interviews
    const overlaps = await prisma.interview.findMany({
      where: {
        AND: [
          {
            OR: panels.map(pid => ({
              panelUserIds: { contains: pid.toString() },
            })),
          },
          {
            startTime: { lt: end },
            endTime: { gt: start },
          },
        ],
      },
      include: {
        application: {
          include: {
            candidate: { select: { name: true } },
            job: { select: { title: true } },
          },
        },
      },
    });

    // ✅ Step 3: If overlaps found → find which employee(s)
    if (overlaps.length > 0) {
      const allPanelIdsInConflicts = new Set<number>();

      overlaps.forEach(o => {
        (o.panelUserIds || '')
          .split(',')
          .map(id => Number(id.trim()))
          .filter(id => panels.includes(id))
          .forEach(id => allPanelIdsInConflicts.add(id));
      });

      // Get employee names for the conflicting panel members
      const conflictingEmployees = await prisma.employee.findMany({
        where: { id: { in: Array.from(allPanelIdsInConflicts) } },
        select: { id: true, firstName: true, lastName: true, employeeCode: true },
      });

      // Build detailed message list
      const conflicts = overlaps.map(o => {
        const overlappingPanelIds = (o.panelUserIds || '')
          .split(',')
          .map(id => Number(id.trim()))
          .filter(id => panels.includes(id));

        const names = conflictingEmployees
          .filter(e => overlappingPanelIds.includes(e.id))
          .map(e => `${e.firstName} ${e.lastName}${e.employeeCode ? ` (${e.employeeCode})` : ''}`)
          .join(', ');

        const startT = new Date(o.startTime).toLocaleString();
        const endT = new Date(o.endTime).toLocaleString();
        return `🕒 ${names} already scheduled for "${o.application.job.title}" with candidate "${o.application.candidate.name}" from ${startT} to ${endT}`;
      });

      return res.status(409).json({
        warning: true,
        message: 'Some panel members already have interviews scheduled during this time.',
        conflicts,
      });
    }

    // ✅ Step 4: No conflicts → create the interview
    const itv = await prisma.$transaction(async (tx) => {
      if (
        app.status === ApplicationStatus.SHORTLISTED ||
        app.status === ApplicationStatus.SCREENING
      ) {
        await tx.application.update({
          where: { id: applicationId },
          data: { status: ApplicationStatus.INTERVIEW_SCHEDULED },
        });
      }

      return tx.interview.create({
        data: {
          applicationId,
          stage,
          startTime: start,
          endTime: end,
          panelUserIds: panels.join(','), // store CSV
          feedbackDue: feedbackDue ? new Date(feedbackDue) : null,
        },
      });


    });

    await sendInterviewMail({
      to: app.candidate.email!,
      candidateName: app.candidate.name,
      jobTitle: app.job.title,
      stage,
      startTime: start.toLocaleString(),
      endTime: end.toLocaleString(),
      panelNames,
      hospitalName: process.env.HOSPITAL_NAME!,
      hospitalAddress: process.env.HOSPITAL_ADDRESS!,
      googleLocationUrl: process.env.HOSPITAL_GOOGLE_MAP!,
    });

    res.status(201).json(itv);
  });


  /** PATCH /interviews/:id/feedback  { result, feedbackUrl?, feedbackAt? } */
  recordInterviewFeedback = asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { result, feedbackUrl, feedbackAt } = req.body || {};
    const itv = await prisma.interview.update({
      where: { id },
      data: { result, feedbackUrl: feedbackUrl ?? null, feedbackAt: feedbackAt ? new Date(feedbackAt) : new Date() },
    });

    // If this was the final interview and passed, you may choose to set application to INTERVIEWED here (or do it explicitly in UI)
    await prisma.application.update({
      where: { id: itv.applicationId },
      data: { status: ApplicationStatus.INTERVIEWED },
    });

    res.json(itv);
  });

  // ---------------- Offers ----------------

  /** POST /applications/:id/offer  -> creates a DRAFT offer if missing */
  createOffer = asyncHandler(async (req, res) => {
    const applicationId = Number(req.params.id);
    const app = await prisma.application.findUnique({ where: { id: applicationId }, include: { offer: true } });
    if (!app) return bad(res, 'Application not found', 404);
    if (app.offer) return res.json(app.offer); // already exists

    // Only allow for INTERVIEWED or later
    if (!ALLOWED_FOR_OFFER.has(app.status as ApplicationStatus)) {
      return bad(res, `Application must be in INTERVIEWED or later to create an offer (current ${app.status})`);
    }

    const offer = await prisma.offer.create({
      data: { applicationId, status: OfferStatus.DRAFT },
    });
    res.status(201).json(offer);
  });

  /** POST /offers/:id/send  { proposedJoinAt? } -> Offer SENT + Application OFFERED */
  sendOffer = asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { proposedJoinAt } = req.body || {};
    const offer = await prisma.offer.findUnique({ where: { id }, include: { application: true } });
    if (!offer) return bad(res, 'Offer not found', 404);
    if (!offerNext[offer.status].includes(OfferStatus.SENT)) return bad(res, `Cannot move offer from ${offer.status} → SENT`);

    const updated = await prisma.$transaction(async (tx) => {
      const of = await tx.offer.update({
        where: { id },
        data: { status: OfferStatus.SENT, sentAt: new Date(), proposedJoinAt: proposedJoinAt ? new Date(proposedJoinAt) : offer.proposedJoinAt },
      });
      await tx.application.update({ where: { id: offer.applicationId }, data: { status: ApplicationStatus.OFFERED } });
      return of;
    });

    res.json(updated);
  });

  /** POST /offers/:id/view -> mark viewed */
  markOfferViewed = asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const offer = await prisma.offer.findUnique({ where: { id } });
    if (!offer) return bad(res, 'Offer not found', 404);
    if (!offerNext[offer.status].includes(OfferStatus.VIEWED)) return bad(res, `Cannot move offer from ${offer.status} → VIEWED`);
    const updated = await prisma.offer.update({ where: { id }, data: { status: OfferStatus.VIEWED, viewedAt: new Date() } });
    res.json(updated);
  });

  /** POST /offers/:id/sign -> SIGNED + Application OFFER_ACCEPTED */
  markOfferSigned = asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const offer = await prisma.offer.findUnique({ where: { id }, include: { application: true } });
    if (!offer) return bad(res, 'Offer not found', 404);
    if (!offerNext[offer.status].includes(OfferStatus.SIGNED)) return bad(res, `Cannot move offer from ${offer.status} → SIGNED`);

    const updated = await prisma.$transaction(async (tx) => {
      const of = await tx.offer.update({ where: { id }, data: { status: OfferStatus.SIGNED, signedAt: new Date() } });
      await tx.application.update({ where: { id: offer.applicationId }, data: { status: ApplicationStatus.OFFER_ACCEPTED } });
      return of;
    });

    res.json(updated);
  });

  /** POST /offers/:id/decline  { reason? } -> DECLINED + Application OFFER_DECLINED */
  declineOffer = asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { reason } = req.body || {};
    const offer = await prisma.offer.findUnique({ where: { id }, include: { application: true } });
    if (!offer) return bad(res, 'Offer not found', 404);
    if (!offerNext[offer.status].includes(OfferStatus.DECLINED)) return bad(res, `Cannot move offer from ${offer.status} → DECLINED`);

    const updated = await prisma.$transaction(async (tx) => {
      const of = await tx.offer.update({ where: { id }, data: { status: OfferStatus.DECLINED, declinedAt: new Date(), declineReason: reason ?? null } });
      await tx.application.update({ where: { id: offer.applicationId }, data: { status: ApplicationStatus.OFFER_DECLINED } });
      return of;
    });

    res.json(updated);
  });

  /** POST /offers/:id/withdraw -> WITHDRAWN (doesn't change application unless you want to) */
  withdrawOffer = asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const offer = await prisma.offer.findUnique({ where: { id } });
    if (!offer) return bad(res, 'Offer not found', 404);
    if (!offerNext[offer.status].includes(OfferStatus.WITHDRAWN)) return bad(res, `Cannot move offer from ${offer.status} → WITHDRAWN`);
    const updated = await prisma.offer.update({ where: { id }, data: { status: OfferStatus.WITHDRAWN } });
    res.json(updated);
  });

  /** POST /offers/:id/expire -> EXPIRED */
  expireOffer = asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const offer = await prisma.offer.findUnique({ where: { id } });
    if (!offer) return bad(res, 'Offer not found', 404);
    if (!offerNext[offer.status].includes(OfferStatus.EXPIRED)) return bad(res, `Cannot move offer from ${offer.status} → EXPIRED`);
    const updated = await prisma.offer.update({ where: { id }, data: { status: OfferStatus.EXPIRED } });
    res.json(updated);
  });

  /** PATCH /offers/:id/schedule-join  { proposedJoinAt } */
  scheduleJoin = asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { proposedJoinAt } = req.body || {};
    if (!proposedJoinAt) return bad(res, 'proposedJoinAt required');
    const offer = await prisma.offer.update({ where: { id }, data: { proposedJoinAt: new Date(proposedJoinAt) } });
    res.json(offer);
  });

  /** POST /offers/:id/mark-joined -> Application HIRED + JoinOutcome JOINED */
  // markJoined = asyncHandler(async (req, res) => {
  //   const id = Number(req.params.id);
  //   const offer = await prisma.offer.findUnique({ where: { id }, include: { application: true } });
  //   if (!offer) return bad(res, 'Offer not found', 404);

  //   const updated = await prisma.$transaction(async (tx) => {
  //     const of = await tx.offer.update({ where: { id }, data: { joinOutcome: JoinOutcome.JOINED } });
  //     await tx.application.update({ where: { id: offer.applicationId }, data: { status: ApplicationStatus.HIRED } });
  //     return of;
  //   });

  //   res.json(updated);
  // });


  markJoined = asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    const offer = await prisma.offer.findUnique({
      where: { id },
      include: {
        application: {
          include: { candidate: true, job: true }
        }
      }
    });
    if (!offer) return bad(res, 'Offer not found', 404);

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Update offer + application
      const of = await tx.offer.update({
        where: { id },
        data: { joinOutcome: JoinOutcome.JOINED }
      });

      await tx.application.update({
        where: { id: offer.applicationId },
        data: { status: ApplicationStatus.HIRED }
      });

      // 2. Auto-create Employee if not already exists
      const { candidate, job } = offer.application;

      // // generate employeeCode e.g., EMP001, EMP002
      // const count = await tx.employee.count();
      // const employeeCode = `EMP${String(count + 1).padStart(3, "0")}`;
      const employeeCode = await generateEmployeeCode();

      const employee = await tx.employee.create({
        data: {
          employeeCode,
          referenceCode: null,
          firstName: candidate.name.split(" ")[0],
          lastName: candidate.name.split(" ").slice(1).join(" ") || "",
          gender: Gender.OTHER, // maybe derive from candidate if stored
          dob: new Date("2000-01-01"), // 🔹 placeholder, or collect from candidate form
          photoUrl: null,

          phone: candidate.phone || "",
          email: candidate.email,

          designation: job.title,
          departmentId: job.departmentId,
          branchId: 1, // 🔹 set default or map from job
          dateOfJoining: offer.proposedJoinAt || new Date(),
          employmentType: EmploymentType.PERMANENT,
          employmentStatus: EmploymentStatus.ACTIVE,
          employeeType: "NONCLINICAL", // or map from job/department

          roleId: 3, // 🔹 default role, e.g., "Employee"

          reportingManager: null,
          age: null,
          bloodGroup: null,
        }
      });

      return { ...of, employee };
    });

    res.json(updated);
  });


  /** POST /offers/:id/mark-no-show  { reason? } -> Application NO_SHOW + JoinOutcome NO_SHOW */
  markNoShow = asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { reason } = req.body || {};
    const offer = await prisma.offer.findUnique({ where: { id }, include: { application: true } });
    if (!offer) return bad(res, 'Offer not found', 404);

    const updated = await prisma.$transaction(async (tx) => {
      const of = await tx.offer.update({ where: { id }, data: { joinOutcome: JoinOutcome.NO_SHOW, noShowReason: reason ?? null } });
      await tx.application.update({ where: { id: offer.applicationId }, data: { status: ApplicationStatus.NO_SHOW } });
      return of;
    });

    res.json(updated);
  });

  // ---------------- Pipeline quick stats ----------------

  /** GET /recruiting/pipeline-stats */
  pipelineStats = asyncHandler(async (_req, res) => {
    const [
      // total requested headcount on OPEN jobs
      openHeadcountAgg,
      // seats already taken on those OPEN jobs
      filledSeats,
      // totals
      applicationsReceived,
      applied,
      shortlisted,
      interviewing,
      offered,
      offerDeclined,
      accepted,
      hired,
      rejected,
    ] = await Promise.all([
      prisma.job.aggregate({
        where: { status: JobStatus.OPEN },
        _sum: { headcount: true },
      }),

      prisma.application.count({
        where: {
          job: { status: JobStatus.OPEN },
          status: { in: [ApplicationStatus.OFFER_ACCEPTED, ApplicationStatus.HIRED] },
        },
      }),

      prisma.application.count(), // all applications ever received

      prisma.application.count({ where: { status: ApplicationStatus.APPLIED } }),
      prisma.application.count({ where: { status: ApplicationStatus.SHORTLISTED } }),
      prisma.application.count({
        where: { status: { in: [ApplicationStatus.INTERVIEW_SCHEDULED, ApplicationStatus.INTERVIEWED] } },
      }),
      prisma.application.count({ where: { status: ApplicationStatus.OFFERED } }),
      prisma.application.count({
        where: { status: ApplicationStatus.OFFER_DECLINED }, // or offer: { status: 'DECLINED' }
      }),
      prisma.application.count({ where: { status: ApplicationStatus.OFFER_ACCEPTED } }),
      prisma.application.count({ where: { status: ApplicationStatus.HIRED } }),
      prisma.application.count({ where: { status: ApplicationStatus.REJECTED } }),
    ]);

    const openHeadcount = openHeadcountAgg._sum.headcount ?? 0;
    const vacancies = Math.max(0, openHeadcount - filledSeats);

    res.json({
      vacancies,
      applicationsReceived,
      applied,
      shortlisted,
      interviewing,
      offered,
      offerDeclined,
      accepted,
      hired,
      rejected,
    });
  });


  // List published tests to pick from (UI dropdown)
  listPublishedTests = asyncHandler(async (_req, res) => {
    const tests = await prisma.evaluationTest.findMany({
      where: { isPublished: true, purpose: 'HIRING' },
      select: { id: true, name: true, duration: true, passingPercent: true, maxAttempts: true },
      orderBy: { name: 'asc' },
    });
    res.json(tests);
  });

  // Assign a test as an interview round
  assignTestToApplication = asyncHandler(async (req, res) => {
    const applicationId = Number(req.params.id);
    const { testId, testDate, deadlineDate, assignedBy } = req.body || {};

    if (!testId) return res.status(400).json({ error: 'testId is required' });

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { candidate: true },
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    if (!app.candidate.passwordHash) {
      const plainPassword = app.candidate.email.toLowerCase(); // email as password
      const hash = await bcrypt.hash(plainPassword, 10);

      await prisma.candidate.update({
        where: { id: app.candidateId },
        data: { passwordHash: hash }
      });
    }

    const assigned = await prisma.candidateAssignedTest.create({
      data: {
        applicationId,
        candidateId: app.candidateId,
        testId: Number(testId),
        assignedBy: assignedBy || 0, // adjust to your auth
        testDate: testDate ? new Date(testDate) : null,
        deadlineDate: deadlineDate ? new Date(deadlineDate) : null,
        status: 'NotStarted',
      },
    });

    // optional: create an Interview round ("Test")
    let interview = null as any;
    if (testDate) {
      const start = new Date(testDate);
      const end = new Date(testDate);
      // rough end time using test duration if available
      const t = await prisma.evaluationTest.findUnique({ where: { id: Number(testId) }, select: { duration: true } });
      if (t?.duration) end.setMinutes(end.getMinutes() + t.duration);

      interview = await prisma.interview.create({
        data: {
          applicationId,
          stage: 'Test',
          startTime: start,
          endTime: end,
          candidateAssignedTestId: assigned.id,
        },
      });
    }

    res.json({ assigned, interview });
  });

  // Get all assigned tests for an application
  listApplicationTests = asyncHandler(async (req, res) => {
    const applicationId = Number(req.params.id);
    const rows = await prisma.candidateAssignedTest.findMany({
      where: { applicationId },
      include: { test: { select: { name: true, duration: true, passingPercent: true } } },
      orderBy: { assignedAt: 'desc' },
    });
    res.json(rows);
  });

  // Mark a test as started (increments attempts, sets startedAt)
  startCandidateTest = asyncHandler(async (req, res) => {
    const applicationId = Number(req.params.id);
    const aid = Number(req.params.aid);

    const ct = await prisma.candidateAssignedTest.findFirst({ where: { id: aid, applicationId } });
    if (!ct) return res.status(404).json({ error: 'Assigned test not found' });

    const updated = await prisma.candidateAssignedTest.update({
      where: { id: aid },
      data: { status: 'InProgress', attempts: { increment: 1 }, startedAt: new Date() },
    });
    res.json(updated);
  });

  // Submit result
  //   submitCandidateTest = asyncHandler(async (req, res) => {
  //     const applicationId = Number(req.params.id);
  //     const aid = Number(req.params.aid);
  //     const { score, response } = req.body || {};

  //     const ct = await prisma.candidateAssignedTest.findFirst({ where: { id: aid, applicationId } });
  //     if (!ct) return res.status(404).json({ error: 'Assigned test not found' });

  //     const updated = await prisma.candidateAssignedTest.update({
  //       where: { id: aid },
  //       data: {
  //         status: 'Completed',
  //         completedAt: new Date(),
  //         score: typeof score === 'number' ? score : null,
  //         response: response ?? null,
  //       },
  //     });
  //     res.json(updated);
  //   });
  // ===== Catalog for candidate's "My Assigned Tests" page =====
  /** GET /candidate/:candidateId/tests  OR  /applications/:id/tests (if you prefer appId) */
  getCandidateAssignedTests = asyncHandler(async (req, res) => {
    const candidateId = Number(req.params.candidateId);
    const rows = await prisma.candidateAssignedTest.findMany({
      where: { candidateId },
      include: {
        test: { select: { id: true, name: true, duration: true, passingPercent: true, randomization: true } }
      },
      orderBy: { assignedAt: 'desc' },
    });

    // add "canStart" flag (respect maxAttempts from test)
    const out = await Promise.all(rows.map(async r => {
      const t = await prisma.evaluationTest.findUnique({ where: { id: r.testId }, select: { maxAttempts: true } });
      const canStart = (t?.maxAttempts ?? 1) > (r.attempts ?? 0) && r.status !== 'Completed' && r.status !== 'Cancelled';
      return { ...r, canStart };
    }));
    res.json(out);
  });

  // ===== Test to take: deliver questions safely (no answers) =====
  /** GET /candidate/tests/:assignedId */
  getAssignedTestDetail = asyncHandler(async (req, res) => {
    const aid = Number(req.params.assignedId);

    const assigned = await prisma.candidateAssignedTest.findUnique({
      where: { id: aid },
      include: {
        test: true, // only pull test, we’ll fetch questions separately
      },
    });
    if (!assigned) return res.status(404).json({ error: 'Assigned test not found' });

    // ✅ Fetch questions via QuestionBank
    const questions = await prisma.question.findMany({
      where: { questionBankId: assigned.test.questionBankId },
      include: { options: true },
    });

    // sanitize output
    const q = questions.map(q => ({
      id: q.id,
      text: q.text,
      type: q.type,
      weight: q.weight,
      options: q.options.map(o => ({ id: o.id, text: o.text })),
    }));

    res.json({
      assignedId: assigned.id,
      testId: assigned.test.id,
      name: assigned.test.name,
      duration: assigned.test.duration,
      maxAttempts: assigned.test.maxAttempts,
      passingPercent: assigned.test.passingPercent,
      questions: q,
    });
  });

  // ===== Start (attempt counter + startedAt) =====
  /** POST /candidate/tests/:assignedId/start */
  startCandidateAssignedTest = asyncHandler(async (req, res) => {
    const aid = Number(req.params.assignedId);
    const current = await prisma.candidateAssignedTest.findUnique({ where: { id: aid } });
    if (!current) return res.status(404).json({ error: 'Assigned test not found' });

    const test = await prisma.evaluationTest.findUnique({ where: { id: current.testId }, select: { maxAttempts: true } });
    const maxAttempts = test?.maxAttempts ?? 1;
    if ((current.attempts ?? 0) >= maxAttempts) {
      return res.status(400).json({ error: 'Max attempts reached' });
    }

    const updated = await prisma.candidateAssignedTest.update({
      where: { id: aid },
      data: { status: 'InProgress', attempts: { increment: 1 }, startedAt: new Date() },
    });
    res.json(updated);
  });
  /** POST /candidate/tests/:assignedId/submit  { answers: [{questionId, answer}] } */
  submitCandidateAssignedTest = asyncHandler(async (req, res) => {
    const aid = Number(req.params.assignedId);
    const { answers } = req.body || [];

    const assigned = await prisma.candidateAssignedTest.findUnique({
      where: { id: aid },
      include: {
        application: { include: { job: true, candidate: true } },
        test: { include: { questions: { include: { options: true } } } },
      },
    });
    if (!assigned) return res.status(404).json({ error: 'Assigned test not found' });

    // --- score MCQs ---
    const ansMap = new Map<number, any>();
    for (const a of answers || []) ansMap.set(Number(a.questionId), a.answer);

    let totalWeight = 0, earned = 0;
    for (const q of assigned.test.questions) {
      const w = q.weight ?? 1;
      totalWeight += w;
      if (q.type === 'MCQ') {
        const correct = (q.correctAnswerIds || '')
          .split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
        const given = (Array.isArray(ansMap.get(q.id)) ? ansMap.get(q.id) : [ansMap.get(q.id)])
          .filter((x: any) => x != null).map((x: any) => Number(x)).sort((a: number, b: number) => a - b);
        const ok = correct.length === given.length && correct.every((v, i) => v === given[i]);
        if (ok) earned += w;
      }
    }
    const percent = totalWeight ? Math.round((earned / totalWeight) * 100) : 0;

    // Persist results — NO app status change here
    const updated = await prisma.candidateAssignedTest.update({
      where: { id: aid },
      data: {
        status: 'Completed',
        completedAt: new Date(),
        score: percent,
        response: JSON.stringify(answers ?? []),
        // reset/clear any prior review
        reviewedAt: null, reviewedBy: null, reviewDecision: null, reviewNote: null,
      },
      include: { application: true },
    });

    // // Optional: add an "audit" interview row with pending review
    // await prisma.interview.create({
    //   data: {
    //     applicationId: updated.applicationId,
    //     stage: 'Test — Submitted',
    //     startTime: updated.startedAt ?? new Date(),
    //     endTime: new Date(),
    //     result: 'Pending review',
    //   },
    // }).catch(() => { });

    // Notify HR / job owner to review
    const hrUserId = assigned.application.job.createdBy ?? 0;
    // await prisma.notification.create({
    //   data: { employeeId: hrUserId, message: `Test submitted by ${assigned.application.candidate.name} — review needed`, channel: 'PUSH' as any }
    // }).catch(()=>{});

    // (Optional) candidate “thanks” mail
    // await sendEmail(assigned.application.candidate.email, `We received your ${assigned.test.name}`, `Thanks! Our team will review it.`);

    res.json({ ok: true, score: percent });
  });
  /** POST /applications/:id/tests/:aid/review  { decision:'PASS'|'FAIL', note?:string } */
  reviewCandidateTest = asyncHandler(async (req, res) => {
    const applicationId = Number(req.params.id);
    const aid = Number(req.params.aid);
    const { decision, note, reviewedBy } = req.body || {};
    if (!['PASS', 'FAIL'].includes(decision)) return res.status(400).json({ error: 'decision must be PASS or FAIL' });

    const updated = await prisma.candidateAssignedTest.update({
      where: { id: aid },
      data: {
        reviewedBy: reviewedBy || 0,   // or your auth user id
        reviewedAt: new Date(),
        reviewDecision: decision,
        reviewNote: note ?? null,
      },
      include: {
        application: { include: { candidate: true, job: true } },
        test: true,
      },
    });

    // Notify candidate of decision
    try {
      //   await prisma.notification.create({
      //     data: {
      //       employeeId: updated.application.job.createdBy ?? 0,
      //       message: `You marked ${updated.application.candidate.name}'s test as ${decision}`,
      //       channel: 'PUSH' as any
      //     }
      //   });
      // await sendEmail(updated.application.candidate.email, `Your ${updated.test.name} review`, decision==='PASS'?'You passed review.':'Thanks, not shortlisted this time.');
    } catch { }

    res.json({ ok: true });
  });
  /** GET /tests/review-queue?dept=&jobId= */
  getTestReviewQueue = asyncHandler(async (req, res) => {
    const { jobId } = req.query || {};
    const where: any = { status: 'Completed', reviewedAt: null };
    if (jobId) where.application = { jobId: Number(jobId) };

    const rows = await prisma.candidateAssignedTest.findMany({
      where,
      include: {
        application: { include: { candidate: true, job: true } },
        test: { select: { name: true, duration: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 100,
    });
    res.json(rows);
  });

  getApplicationSummary = asyncHandler(async (req, res) => {
    try {
      const app = await prisma.application.findUnique({
        where: { id: Number(req.params.id) },
        include: {
          candidate: true,
          job: true,
          interviews: {
            include: {
              InterviewFeedback: true,
              InterviewHRReview: true,
            },
            orderBy: { startTime: 'asc' },
          },
          CandidateAssignedTest: {
            include: { test: true },
          },
          offer: true,
        },
      });

      if (!app) {
        return res.status(404).json({ error: 'Application not found' });
      }

      res.json(app);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load application summary' });
    }
  });
}

// POST /api/interviews/:id/feedback
export const upsertFeedback = asyncHandler(async (req, res) => {
  const interviewId = Number(req.params.id);

  // NEW: take panelId from the client (e.g., from localStorage on the frontend)
  const panelId = Number(req.body.panelId);
  if (!Number.isFinite(panelId)) {
    return bad(res, 'panelId (number) is required', 400);
  }

  const {
    name, designation, jobSkills, jobKnowledge, attitude, communication,
    notes, signature, submit
  } = req.body;

  // Fetch interview & authorize: panelId must belong to this interview
  const itv = await prisma.interview.findUnique({ where: { id: interviewId } });
  if (!itv) return bad(res, 'Interview not found', 404);

  // Parse CSV "panelUserIds" safely into numbers
  const allowedPanelIds = String(itv.panelUserIds || '')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n));

  if (!allowedPanelIds.includes(panelId)) {
    return bad(res, 'Not in panel', 403);
  }

  // OPTIONAL: also require the logged-in user to match the chosen panel slot.
  // If you want to allow HR to submit on behalf of panelists, remove this.
  // if (req.user.id !== panelId) return bad(res, 'Cannot submit for another panelist', 403);

  // Compute average from provided scores
  const scores = [jobSkills, jobKnowledge, attitude, communication]
    .map(n => (typeof n === 'number' ? n : null))
    .filter((n): n is number => n != null);
  const average = scores.length
    ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
    : null;

  const status = submit ? 'SUBMITTED' : 'DRAFT';

  const fb = await prisma.interviewFeedback.upsert({
    where: { interviewId_panelUserId: { interviewId, panelUserId: panelId } }, // <-- use panelId
    update: {
      name, designation, jobSkills, jobKnowledge, attitude, communication,
      average, notes, signature,
      status,
      submittedAt: submit ? new Date() : null,
    },
    create: {
      interviewId,
      panelUserId: panelId, // <-- use panelId
      name, designation,
      jobSkills, jobKnowledge, attitude, communication,
      average, notes, signature,
      status,
      submittedAt: submit ? new Date() : null,
    },
  });

  res.json(fb);
});
async function generateEmployeeCode() {
  const prefix = process.env.EMPLOYEE_CODE_PREFIX || 'EMP';
  const startNumber = process.env.EMPLOYEE_CODE_START || '001';
  const lastEmployee = await prisma.employee.findFirst({
    orderBy: { employeeCode: 'desc' },
    select: { employeeCode: true }
  });

  let newCode = `${prefix}${startNumber}`;
  if (lastEmployee?.employeeCode) {
    const lastNumber = parseInt(lastEmployee.employeeCode.replace(/\D/g, ''), 10);
    newCode = `${prefix}${String(lastNumber + 1).padStart(3, '0')}`;
  }
  return newCode;
}

// POST /api/interviews/:id/hr-review
export const saveHrReview = asyncHandler(async (req, res) => {
  const interviewId = Number(req.params.id);
  const { presentSalary, payslip, expectedSalary, grossOffer, conclusion, remarks, reviewerUserId, expectedDoj, noticePeriod } = req.body;

  const review = await prisma.interviewHRReview.upsert({
    where: { interviewId },
    update: {
      presentSalary, payslip, expectedSalary, grossOffer,
      conclusion, remarks,
      reviewerUserId: reviewerUserId,
      reviewedAt: new Date(),
      expectedDoj, noticePeriod

    },
    create: {
      interviewId,
      presentSalary, payslip, expectedSalary, grossOffer,
      conclusion, remarks,
      reviewerUserId: reviewerUserId,
      reviewedAt: new Date(),
      expectedDoj, noticePeriod
    },
  });

  // keep Interview in sync (optional)
  await prisma.interview.update({
    where: { id: interviewId },
    data: { result: conclusion || null, feedbackAt: new Date() },
  });

  // (optional) bump Application status to INTERVIEWED
  const itv = await prisma.interview.findUnique({ where: { id: interviewId }, select: { applicationId: true } });
  if (itv) {
    await prisma.application.update({
      where: { id: itv.applicationId },
      data: { status: ApplicationStatus.INTERVIEWED },
    });
  }

  res.json(review);
});
// GET /api/interviews/:id/summary
export const getSummary = asyncHandler(async (req, res) => {
  const interviewId = Number(req.params.id);

  const [itv, feedbacks, hr] = await Promise.all([
    prisma.interview.findUnique({
      where: { id: interviewId },
      include: { application: { include: { candidate: true, job: true } } },
    }),
    prisma.interviewFeedback.findMany({ where: { interviewId }, orderBy: { panelUserId: 'asc' } }),
    prisma.interviewHRReview.findUnique({ where: { interviewId } }),
  ]);
  if (!itv) return bad(res, 'Interview not found', 404);

  const panelAvg = feedbacks.length
    ? +(feedbacks
      .map(f => f.average)
      .filter((x): x is number => typeof x === 'number')
      .reduce((a, b) => a + b, 0) / feedbacks.length).toFixed(1)
    : null;

  res.json({ interview: itv, feedbacks, panelAvg, hr });
});
// recruitingRouter.get('/interview', listInterviews);
// GET /recruiting/interview
// export const listInterviews = asyncHandler(async (req, res) => {
//   const items = await prisma.interview.findMany({
//     orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
//     include: {
//       application: {
//         select: {
//           id: true,
//           candidate: { select: { id: true, name: true, email: true, phone: true, experience: true, qualification: true } },
//           job: { select: { id: true, title: true, department: { select: { id: true, name: true } } } }
//         }
//       },
//       candidateAssignedTest: {   // ✅ add this
//         select: {
//           id: true,
//           status: true,
//           score: true,
//           reviewedAt: true,
//           reviewDecision: true,
//           completedAt: true,
//           test: { select: { id: true, name: true } }
//         }
//       },

//       // ⬇️ bring HR review (one record max)
//       InterviewHRReview: {
//         select: {
//           presentSalary: true,
//           payslip: true,
//           expectedSalary: true,
//           grossOffer: true,
//           conclusion: true,
//           remarks: true,
//           reviewerUserId: true,
//           reviewedAt: true,
//         }
//       },

//       // ⬇️ bring all panel feedback rows (you can filter to SUBMITTED if you like)
//       InterviewFeedback: {
//         where: { status: 'SUBMITTED' },           // drop this line if you want drafts too
//         orderBy: { submittedAt: 'desc' },
//         select: {
//           id: true,
//           panelUserId: true,
//           name: true,
//           designation: true,
//           jobSkills: true,
//           jobKnowledge: true,
//           attitude: true,
//           communication: true,
//           average: true,
//           notes: true,
//           status: true,
//           submittedAt: true,
//         }
//       },
//     },
//   });

//   res.json(items);
// });
export const listInterviews = asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const pageSize = Math.min(50, Number(req.query.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  const where: any = {}; // empty: no filters

  const [items, total] = await Promise.all([
    prisma.interview.findMany({
      skip,
      take: pageSize,
      orderBy: [{ startTime: "desc" }, { id: "desc" }],
      include: {
        application: {
          select: {
            id: true,
            candidate: { select: { id: true, name: true, email: true, phone: true, experience: true, qualification: true } },
            job: { select: { id: true, title: true, department: { select: { id: true, name: true } } } }
          }
        },

        candidateAssignedTest: {
          select: {
            id: true,
            status: true,
            score: true,
            reviewedAt: true,
            reviewDecision: true,
            completedAt: true,
            test: { select: { id: true, name: true } }
          }
        },

        InterviewHRReview: {
          select: {
            presentSalary: true,
            payslip: true,
            expectedSalary: true,
            grossOffer: true,
            conclusion: true,
            remarks: true,
            reviewerUserId: true,
            reviewedAt: true,
          }
        },

        InterviewFeedback: {
          where: { status: "SUBMITTED" },
          orderBy: { submittedAt: "desc" },
          select: {
            id: true,
            panelUserId: true,
            name: true,
            designation: true,
            jobSkills: true,
            jobKnowledge: true,
            attitude: true,
            communication: true,
            average: true,
            notes: true,
            status: true,
            submittedAt: true,
          }
        }
      }
    }),

    prisma.interview.count({ where })
  ]);

  res.json({
    data: items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
});


export const listEmployeeInterviews = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;

  if (!employeeId) {
    res.status(400);
    throw new Error('Employee ID is required');
  }

  const all = await prisma.interview.findMany({
    where: {
      panelUserIds: {
        contains: employeeId.toString(), // match employeeId in CSV
      },
    },
    orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
    include: {
      application: {
        select: {
          id: true,
          candidate: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              experience: true,
              qualification: true,
            },
          },
          job: {
            select: {
              id: true,
              title: true,
              department: {
                select: { id: true, name: true },
              },
            },
          },
        },
      },
      candidateAssignedTest: {
        select: {
          id: true,
          status: true,
          score: true,
          reviewedAt: true,
          reviewDecision: true,
          completedAt: true,
          test: { select: { id: true, name: true } },
        },
      },
      InterviewHRReview: {
        select: {
          presentSalary: true,
          payslip: true,
          expectedSalary: true,
          grossOffer: true,
          conclusion: true,
          remarks: true,
          reviewerUserId: true,
          reviewedAt: true,
        },
      },
      InterviewFeedback: {
        where: { status: 'SUBMITTED' },
        orderBy: { submittedAt: 'desc' },
        select: {
          id: true,
          panelUserId: true,
          name: true,
          designation: true,
          jobSkills: true,
          jobKnowledge: true,
          attitude: true,
          communication: true,
          average: true,
          notes: true,
          status: true,
          submittedAt: true,
        },
      },
    },
  });
  const items = all.filter(i =>
    i.panelUserIds?.split(',').map(id => id.trim()).includes(employeeId.toString())
  );

  res.json(items);
});

export async function sendInterviewMail(props: any) {
  const {
    to,
    candidateName,
    jobTitle,
    stage,
    startTime,
    endTime,
    hospitalName,
    hospitalAddress,
    googleLocationUrl,
    panelNames,
  } = props;

  // Convert to CSV if array
  const recipients = Array.isArray(to) ? to.join(", ") : to;

  const text = `
Interview Scheduled

Candidate Name: ${candidateName}
Job Title: ${jobTitle}
Stage: ${stage}

Start Time: ${startTime}
End Time: ${endTime}

Panel Members: ${panelNames}

Venue:
${hospitalName}
${hospitalAddress}

Google Maps:
${googleLocationUrl}

Best Regards,
HR Team
`;

  const html = `
  <h2>Interview Scheduled</h2>
  <p>Dear <b>${candidateName}</b>,</p>

  <p>Your interview has been scheduled for the position of <b>${jobTitle}</b>.</p>

  <h3>📅 Interview Details</h3>
  <ul>
    <li><b>Stage:</b> ${stage}</li>
    <li><b>Start Time:</b> ${startTime}</li>
    <li><b>End Time:</b> ${endTime}</li>
    <li><b>Panel:</b> ${panelNames}</li>
  </ul>

  <h3>📍 Venue</h3>
  <p><b>${hospitalName}</b><br>${hospitalAddress}</p>

  <p>
    <a href="${googleLocationUrl}" target="_blank">
      📌 View Location on Google Maps
    </a>
  </p>

  <br>
  <p>Best Regards,<br>HR Team</p>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: recipients,
    subject: `Interview Scheduled – ${jobTitle}`,
    text,
    html,
  });
}