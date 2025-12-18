"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listEmployeeInterviews = exports.listInterviews = exports.getSummary = exports.saveHrReview = exports.upsertFeedback = exports.RecruitingController = void 0;
exports.sendInterviewMail = sendInterviewMail;
const client_1 = require("@prisma/client");
const formidable_1 = __importDefault(require("formidable"));
const fs_1 = __importDefault(require("fs"));
const basic_ftp_1 = require("basic-ftp");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const prisma = new client_1.PrismaClient();
const FTP_CONFIG = {
    host: "srv680.main-hosting.eu", // Your FTP hostname
    user: "u948610439.hrproindia.in", // Your FTP username
    password: "Bsrenuk@1993", // Your FTP password
    secure: false // Set to true if using FTPS
};
const transporter = nodemailer_1.default.createTransport({
    service: 'gmail',
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});
function uploadToFTP(localFilePath, remoteFileName) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = false;
        try {
            yield client.access(FTP_CONFIG);
            const remoteDir = "/public_html/resume";
            yield client.ensureDir(remoteDir); // Change folder for HR docs
            console.log(remoteFileName);
            yield client.uploadFrom(localFilePath, remoteFileName);
            yield client.close();
            // return `https://hrproindia.in/documents/${remoteFileName}`; // public URL
        }
        catch (error) {
            console.error("FTP Upload Error:", error);
            throw new Error("FTP upload failed");
        }
    });
}
/** Small helper to catch async errors */
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);
function bad(res, msg, code = 400) {
    return res.status(code).json({ error: msg });
}
const ALLOWED_FOR_OFFER = new Set([
    client_1.ApplicationStatus.INTERVIEWED,
    client_1.ApplicationStatus.OFFERED,
    client_1.ApplicationStatus.OFFER_ACCEPTED,
]);
/** Guard helpers */
const canAdvanceTo = {
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
const offerNext = {
    DRAFT: ['SENT', 'WITHDRAWN'],
    SENT: ['VIEWED', 'SIGNED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'],
    VIEWED: ['SIGNED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'],
    SIGNED: [],
    DECLINED: [],
    WITHDRAWN: [],
    EXPIRED: [],
};
class RecruitingController {
    constructor() {
        // ---------------- Jobs ----------------
        /** POST /jobs */
        this.createJob = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const { title, departmentId, location, headcount = 1, createdBy, backfillForEmployeeId } = req.body || {};
            if (!title || !departmentId || !createdBy)
                return bad(res, 'title, departmentId, createdBy are required');
            const job = yield prisma.job.create({
                data: { title, departmentId: Number(departmentId), location, headcount: Number(headcount), createdBy, backfillForEmployeeId },
            });
            res.status(201).json(job);
        }));
        /** GET /jobs?status=OPEN&dept=2&q=engineer&page=1&pageSize=20 */
        this.listJobs = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const { status, dept, q, page = '1', pageSize = '20' } = req.query;
            const where = {};
            if (status)
                where.status = status;
            if (dept)
                where.departmentId = Number(dept);
            if (q)
                where.title = { contains: String(q), mode: 'insensitive' };
            const take = Math.min(100, Number(pageSize) || 20);
            const skip = (Math.max(1, Number(page) || 1) - 1) * take;
            const [rows, total] = yield Promise.all([
                prisma.job.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    include: {
                        department: { select: { id: true, name: true } }, // only what you need
                        _count: { select: { applications: true } },
                    },
                    take,
                    skip,
                }),
                prisma.job.count({ where }),
            ]);
            // Flatten department name + keep a compact shape
            const out = rows.map((j) => {
                var _a, _b;
                return ({
                    id: j.id,
                    title: j.title,
                    departmentId: j.departmentId,
                    departmentName: (_b = (_a = j.department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
                    location: j.location,
                    headcount: j.headcount,
                    status: j.status,
                    createdAt: j.createdAt,
                    updatedAt: j.updatedAt,
                    applicationsCount: j._count.applications,
                });
            });
            res.json({ total, rows: out });
        }));
        /** PATCH /jobs/:id/status { status } */
        this.changeJobStatus = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const id = Number(req.params.id);
            const { status } = req.body || {};
            if (!status)
                return bad(res, 'status required');
            const job = yield prisma.job.update({ where: { id }, data: { status } });
            res.json(job);
        }));
        // ---------------- Candidates & Applications ----------------
        /** POST /candidates (raw) */
        this.createCandidate = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const { name, email, phone, source, resumeUrl, address } = req.body || {};
            if (!name || !email)
                return bad(res, 'name and email are required');
            const cand = yield prisma.candidate.create({ data: { name, email, phone, source, resumeUrl, address } });
            res.status(201).json(cand);
        }));
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
        this.createApplication = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const form = (0, formidable_1.default)({ multiples: false });
            form.parse(req, (err, fields, files) => __awaiter(this, void 0, void 0, function* () {
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
                    if (!jobId)
                        return res.status(400).json({ error: "jobId is required" });
                    const resumeField = files.resume;
                    let resumeUrl;
                    let resumeFile;
                    if (Array.isArray(resumeField)) {
                        resumeFile = resumeField[0]; // take the first file if multiple
                    }
                    else {
                        resumeFile = resumeField;
                    }
                    if (resumeFile) {
                        const filePath = resumeFile.filepath;
                        const fileName = `${Date.now()}_${resumeFile.originalFilename}`;
                        const remoteFilePath = `/public_html/resume/${fileName}`;
                        yield uploadToFTP(filePath, remoteFilePath);
                        resumeUrl = `https://hrproindia.in/resume/${fileName}`;
                        console.log("Uploaded resume URL:", resumeUrl);
                        fs_1.default.unlinkSync(filePath);
                    }
                    console.log("Resume URL to save:", resumeUrl);
                    // --- Transaction ---
                    const app = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                        var _a, _b;
                        let candId = candidateId;
                        if (!candId) {
                            if (!(candidate === null || candidate === void 0 ? void 0 : candidate.name) || !(candidate === null || candidate === void 0 ? void 0 : candidate.email)) {
                                throw new Error("candidate.name and candidate.email are required");
                            }
                            // Upsert by email
                            const cand = yield tx.candidate.upsert({
                                where: { email: candidate.email },
                                update: {
                                    name: candidate.name,
                                    phone: candidate.phone.toString(),
                                    source: candidate.source,
                                    resumeUrl: resumeUrl || candidate.resumeUrl,
                                    experience: (_a = candidate.experience) === null || _a === void 0 ? void 0 : _a.toString(),
                                    qualification: candidate.qualification,
                                    address: candidate.address,
                                },
                                create: {
                                    name: candidate.name,
                                    email: candidate.email,
                                    phone: candidate.phone.toString(),
                                    source: candidate.source,
                                    resumeUrl: resumeUrl || candidate.resumeUrl,
                                    experience: (_b = candidate.experience) === null || _b === void 0 ? void 0 : _b.toString(),
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
                                status: client_1.ApplicationStatus.APPLIED,
                            },
                            include: { candidate: true, job: true },
                        });
                    }));
                    res.status(201).json(app);
                }
                catch (error) {
                    console.error("Error creating application:", error);
                    res.status(500).json({ error: "Internal server error" });
                }
            }));
        }));
        /** GET /applications?jobId=..&status=..&q=.. */
        this.listApplications = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const { jobId, status, q, page = '1', pageSize = '20' } = req.query;
            const where = {};
            if (jobId)
                where.jobId = Number(jobId);
            if (status)
                where.status = status;
            if (q)
                where.OR = [{ candidate: { name: { contains: q, mode: 'insensitive' } } }, { candidate: { email: { contains: q, mode: 'insensitive' } } }];
            const take = Math.min(100, Number(pageSize) || 20);
            const skip = (Math.max(1, Number(page) || 1) - 1) * take;
            const [rows, total] = yield Promise.all([
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
        }));
        /** PATCH /applications/:id/status { to, rejectReason?, currentStage? } */
        /** PATCH /applications/:id/status { to, rejectReason?, currentStage? } */
        this.moveApplication = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const id = Number(req.params.id);
            const { to, rejectReason, currentStage, shortListNote } = req.body || {};
            if (!to)
                return bad(res, '`to` is required');
            const app = yield prisma.application.findUnique({ where: { id } });
            if (!app)
                return bad(res, 'Application not found', 404);
            if (!((_a = canAdvanceTo[app.status]) === null || _a === void 0 ? void 0 : _a.includes(to))) {
                return bad(res, `Cannot move application from ${app.status} → ${to}`);
            }
            // Enforce inputs for specific transitions
            if (to === client_1.ApplicationStatus.REJECTED && !rejectReason) {
                return bad(res, 'rejectReason is required when rejecting');
            }
            if (to === client_1.ApplicationStatus.SHORTLISTED && !shortListNote) {
                return bad(res, 'shortlistNotes is required when shortlisting (e.g., "Tech Round 1")');
            }
            // (optional) validate enum
            if (to === client_1.ApplicationStatus.REJECTED) {
                const valid = Object.values(client_1.RejectReason).includes(rejectReason);
                if (!valid)
                    return bad(res, `rejectReason must be one of: ${Object.values(client_1.RejectReason).join(', ')}`);
            }
            const updated = yield prisma.application.update({
                where: { id },
                data: {
                    status: to,
                    rejectReason: to === client_1.ApplicationStatus.REJECTED ? rejectReason : null,
                    currentStage: to === client_1.ApplicationStatus.SHORTLISTED ? currentStage : app.currentStage,
                    shortlistNote: to === client_1.ApplicationStatus.SHORTLISTED ? shortListNote : app.shortlistNote,
                },
            });
            res.json(updated);
        }));
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
        this.scheduleInterview = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const applicationId = Number(req.params.id);
            const { stage, startTime, endTime, panelUserIds, feedbackDue } = req.body || {};
            if (!stage || !startTime || !endTime)
                return bad(res, 'stage, startTime, endTime are required');
            const app = yield prisma.application.findUnique({
                where: { id: applicationId },
                include: {
                    candidate: true,
                    job: true,
                }
            });
            if (!app)
                return bad(res, 'Application not found', 404);
            // ✅ Step 1: Parse panelUserIds safely
            const panels = Array.isArray(panelUserIds)
                ? panelUserIds.map(Number)
                : typeof panelUserIds === 'string'
                    ? panelUserIds.split(',').map(s => Number(s.trim()))
                    : [];
            if (!panels.length)
                return bad(res, 'At least one panel member is required');
            const panelEmployees = yield prisma.employee.findMany({
                where: { id: { in: panels } },
                select: { firstName: true, lastName: true }
            });
            const panelNames = panelEmployees
                .map(e => `${e.firstName} ${e.lastName}`)
                .join(', ');
            const start = new Date(startTime);
            const end = new Date(endTime);
            // ✅ Step 2: Check for overlapping interviews
            const overlaps = yield prisma.interview.findMany({
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
                const allPanelIdsInConflicts = new Set();
                overlaps.forEach(o => {
                    (o.panelUserIds || '')
                        .split(',')
                        .map(id => Number(id.trim()))
                        .filter(id => panels.includes(id))
                        .forEach(id => allPanelIdsInConflicts.add(id));
                });
                // Get employee names for the conflicting panel members
                const conflictingEmployees = yield prisma.employee.findMany({
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
            const itv = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                if (app.status === client_1.ApplicationStatus.SHORTLISTED ||
                    app.status === client_1.ApplicationStatus.SCREENING) {
                    yield tx.application.update({
                        where: { id: applicationId },
                        data: { status: client_1.ApplicationStatus.INTERVIEW_SCHEDULED },
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
            }));
            yield sendInterviewMail({
                to: app.candidate.email,
                candidateName: app.candidate.name,
                jobTitle: app.job.title,
                stage,
                startTime: start.toLocaleString(),
                endTime: end.toLocaleString(),
                panelNames,
                hospitalName: process.env.HOSPITAL_NAME,
                hospitalAddress: process.env.HOSPITAL_ADDRESS,
                googleLocationUrl: process.env.HOSPITAL_GOOGLE_MAP,
            });
            res.status(201).json(itv);
        }));
        /** PATCH /interviews/:id/feedback  { result, feedbackUrl?, feedbackAt? } */
        this.recordInterviewFeedback = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const id = Number(req.params.id);
            const { result, feedbackUrl, feedbackAt } = req.body || {};
            const itv = yield prisma.interview.update({
                where: { id },
                data: { result, feedbackUrl: feedbackUrl !== null && feedbackUrl !== void 0 ? feedbackUrl : null, feedbackAt: feedbackAt ? new Date(feedbackAt) : new Date() },
            });
            // If this was the final interview and passed, you may choose to set application to INTERVIEWED here (or do it explicitly in UI)
            yield prisma.application.update({
                where: { id: itv.applicationId },
                data: { status: client_1.ApplicationStatus.INTERVIEWED },
            });
            res.json(itv);
        }));
        // ---------------- Offers ----------------
        /** POST /applications/:id/offer  -> creates a DRAFT offer if missing */
        this.createOffer = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const applicationId = Number(req.params.id);
            const app = yield prisma.application.findUnique({ where: { id: applicationId }, include: { offer: true } });
            if (!app)
                return bad(res, 'Application not found', 404);
            if (app.offer)
                return res.json(app.offer); // already exists
            // Only allow for INTERVIEWED or later
            if (!ALLOWED_FOR_OFFER.has(app.status)) {
                return bad(res, `Application must be in INTERVIEWED or later to create an offer (current ${app.status})`);
            }
            const offer = yield prisma.offer.create({
                data: { applicationId, status: client_1.OfferStatus.DRAFT },
            });
            res.status(201).json(offer);
        }));
        /** POST /offers/:id/send  { proposedJoinAt? } -> Offer SENT + Application OFFERED */
        this.sendOffer = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const id = Number(req.params.id);
            const { proposedJoinAt } = req.body || {};
            const offer = yield prisma.offer.findUnique({ where: { id }, include: { application: true } });
            if (!offer)
                return bad(res, 'Offer not found', 404);
            if (!offerNext[offer.status].includes(client_1.OfferStatus.SENT))
                return bad(res, `Cannot move offer from ${offer.status} → SENT`);
            const updated = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                const of = yield tx.offer.update({
                    where: { id },
                    data: { status: client_1.OfferStatus.SENT, sentAt: new Date(), proposedJoinAt: proposedJoinAt ? new Date(proposedJoinAt) : offer.proposedJoinAt },
                });
                yield tx.application.update({ where: { id: offer.applicationId }, data: { status: client_1.ApplicationStatus.OFFERED } });
                return of;
            }));
            res.json(updated);
        }));
        /** POST /offers/:id/view -> mark viewed */
        this.markOfferViewed = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const id = Number(req.params.id);
            const offer = yield prisma.offer.findUnique({ where: { id } });
            if (!offer)
                return bad(res, 'Offer not found', 404);
            if (!offerNext[offer.status].includes(client_1.OfferStatus.VIEWED))
                return bad(res, `Cannot move offer from ${offer.status} → VIEWED`);
            const updated = yield prisma.offer.update({ where: { id }, data: { status: client_1.OfferStatus.VIEWED, viewedAt: new Date() } });
            res.json(updated);
        }));
        /** POST /offers/:id/sign -> SIGNED + Application OFFER_ACCEPTED */
        this.markOfferSigned = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const id = Number(req.params.id);
            const offer = yield prisma.offer.findUnique({ where: { id }, include: { application: true } });
            if (!offer)
                return bad(res, 'Offer not found', 404);
            if (!offerNext[offer.status].includes(client_1.OfferStatus.SIGNED))
                return bad(res, `Cannot move offer from ${offer.status} → SIGNED`);
            const updated = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                const of = yield tx.offer.update({ where: { id }, data: { status: client_1.OfferStatus.SIGNED, signedAt: new Date() } });
                yield tx.application.update({ where: { id: offer.applicationId }, data: { status: client_1.ApplicationStatus.OFFER_ACCEPTED } });
                return of;
            }));
            res.json(updated);
        }));
        /** POST /offers/:id/decline  { reason? } -> DECLINED + Application OFFER_DECLINED */
        this.declineOffer = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const id = Number(req.params.id);
            const { reason } = req.body || {};
            const offer = yield prisma.offer.findUnique({ where: { id }, include: { application: true } });
            if (!offer)
                return bad(res, 'Offer not found', 404);
            if (!offerNext[offer.status].includes(client_1.OfferStatus.DECLINED))
                return bad(res, `Cannot move offer from ${offer.status} → DECLINED`);
            const updated = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                const of = yield tx.offer.update({ where: { id }, data: { status: client_1.OfferStatus.DECLINED, declinedAt: new Date(), declineReason: reason !== null && reason !== void 0 ? reason : null } });
                yield tx.application.update({ where: { id: offer.applicationId }, data: { status: client_1.ApplicationStatus.OFFER_DECLINED } });
                return of;
            }));
            res.json(updated);
        }));
        /** POST /offers/:id/withdraw -> WITHDRAWN (doesn't change application unless you want to) */
        this.withdrawOffer = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const id = Number(req.params.id);
            const offer = yield prisma.offer.findUnique({ where: { id } });
            if (!offer)
                return bad(res, 'Offer not found', 404);
            if (!offerNext[offer.status].includes(client_1.OfferStatus.WITHDRAWN))
                return bad(res, `Cannot move offer from ${offer.status} → WITHDRAWN`);
            const updated = yield prisma.offer.update({ where: { id }, data: { status: client_1.OfferStatus.WITHDRAWN } });
            res.json(updated);
        }));
        /** POST /offers/:id/expire -> EXPIRED */
        this.expireOffer = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const id = Number(req.params.id);
            const offer = yield prisma.offer.findUnique({ where: { id } });
            if (!offer)
                return bad(res, 'Offer not found', 404);
            if (!offerNext[offer.status].includes(client_1.OfferStatus.EXPIRED))
                return bad(res, `Cannot move offer from ${offer.status} → EXPIRED`);
            const updated = yield prisma.offer.update({ where: { id }, data: { status: client_1.OfferStatus.EXPIRED } });
            res.json(updated);
        }));
        /** PATCH /offers/:id/schedule-join  { proposedJoinAt } */
        this.scheduleJoin = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const id = Number(req.params.id);
            const { proposedJoinAt } = req.body || {};
            if (!proposedJoinAt)
                return bad(res, 'proposedJoinAt required');
            const offer = yield prisma.offer.update({ where: { id }, data: { proposedJoinAt: new Date(proposedJoinAt) } });
            res.json(offer);
        }));
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
        this.markJoined = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const id = Number(req.params.id);
            const offer = yield prisma.offer.findUnique({
                where: { id },
                include: {
                    application: {
                        include: { candidate: true, job: true }
                    }
                }
            });
            if (!offer)
                return bad(res, 'Offer not found', 404);
            const updated = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                // 1. Update offer + application
                const of = yield tx.offer.update({
                    where: { id },
                    data: { joinOutcome: client_1.JoinOutcome.JOINED }
                });
                yield tx.application.update({
                    where: { id: offer.applicationId },
                    data: { status: client_1.ApplicationStatus.HIRED }
                });
                // 2. Auto-create Employee if not already exists
                const { candidate, job } = offer.application;
                // // generate employeeCode e.g., EMP001, EMP002
                // const count = await tx.employee.count();
                // const employeeCode = `EMP${String(count + 1).padStart(3, "0")}`;
                const employeeCode = yield generateEmployeeCode();
                // 🔹 STEP 1: resolve designation
                const designationName = ((_a = job.title) === null || _a === void 0 ? void 0 : _a.trim()) || 'Employee';
                let designation = yield tx.designation.findFirst({
                    where: { name: designationName }
                });
                if (!designation) {
                    designation = yield tx.designation.create({
                        data: {
                            name: designationName,
                            isActive: true
                        }
                    });
                }
                const employee = yield tx.employee.create({
                    data: {
                        employeeCode,
                        referenceCode: null,
                        firstName: candidate.name.split(" ")[0],
                        lastName: candidate.name.split(" ").slice(1).join(" ") || "",
                        gender: client_1.Gender.OTHER, // maybe derive from candidate if stored
                        dob: new Date("2000-01-01"), // 🔹 placeholder, or collect from candidate form
                        photoUrl: null,
                        phone: candidate.phone || "",
                        email: candidate.email,
                        departmentId: job.departmentId,
                        designationId: designation.id,
                        branchId: 1, // 🔹 set default or map from job
                        dateOfJoining: offer.proposedJoinAt || new Date(),
                        employmentType: client_1.EmploymentType.PERMANENT,
                        employmentStatus: client_1.EmploymentStatus.ACTIVE,
                        employeeType: "NONCLINICAL", // or map from job/department
                        roleId: 3, // 🔹 default role, e.g., "Employee"
                        reportingManager: null,
                        age: null,
                        bloodGroup: null,
                    },
                });
                return Object.assign(Object.assign({}, of), { employee });
            }));
            res.json(updated);
        }));
        /** POST /offers/:id/mark-no-show  { reason? } -> Application NO_SHOW + JoinOutcome NO_SHOW */
        this.markNoShow = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const id = Number(req.params.id);
            const { reason } = req.body || {};
            const offer = yield prisma.offer.findUnique({ where: { id }, include: { application: true } });
            if (!offer)
                return bad(res, 'Offer not found', 404);
            const updated = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                const of = yield tx.offer.update({ where: { id }, data: { joinOutcome: client_1.JoinOutcome.NO_SHOW, noShowReason: reason !== null && reason !== void 0 ? reason : null } });
                yield tx.application.update({ where: { id: offer.applicationId }, data: { status: client_1.ApplicationStatus.NO_SHOW } });
                return of;
            }));
            res.json(updated);
        }));
        // ---------------- Pipeline quick stats ----------------
        /** GET /recruiting/pipeline-stats */
        this.pipelineStats = asyncHandler((_req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const [
            // total requested headcount on OPEN jobs
            openHeadcountAgg, 
            // seats already taken on those OPEN jobs
            filledSeats, 
            // totals
            applicationsReceived, applied, shortlisted, interviewing, offered, offerDeclined, accepted, hired, rejected,] = yield Promise.all([
                prisma.job.aggregate({
                    where: { status: client_1.JobStatus.OPEN },
                    _sum: { headcount: true },
                }),
                prisma.application.count({
                    where: {
                        job: { status: client_1.JobStatus.OPEN },
                        status: { in: [client_1.ApplicationStatus.OFFER_ACCEPTED, client_1.ApplicationStatus.HIRED] },
                    },
                }),
                prisma.application.count(), // all applications ever received
                prisma.application.count({ where: { status: client_1.ApplicationStatus.APPLIED } }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.SHORTLISTED } }),
                prisma.application.count({
                    where: { status: { in: [client_1.ApplicationStatus.INTERVIEW_SCHEDULED, client_1.ApplicationStatus.INTERVIEWED] } },
                }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.OFFERED } }),
                prisma.application.count({
                    where: { status: client_1.ApplicationStatus.OFFER_DECLINED }, // or offer: { status: 'DECLINED' }
                }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.OFFER_ACCEPTED } }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.HIRED } }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.REJECTED } }),
            ]);
            const openHeadcount = (_a = openHeadcountAgg._sum.headcount) !== null && _a !== void 0 ? _a : 0;
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
        }));
        // List published tests to pick from (UI dropdown)
        this.listPublishedTests = asyncHandler((_req, res) => __awaiter(this, void 0, void 0, function* () {
            const tests = yield prisma.evaluationTest.findMany({
                where: { isPublished: true, purpose: 'HIRING' },
                select: { id: true, name: true, duration: true, passingPercent: true, maxAttempts: true },
                orderBy: { name: 'asc' },
            });
            res.json(tests);
        }));
        // Assign a test as an interview round
        this.assignTestToApplication = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const applicationId = Number(req.params.id);
            const { testId, testDate, deadlineDate, assignedBy } = req.body || {};
            if (!testId)
                return res.status(400).json({ error: 'testId is required' });
            const app = yield prisma.application.findUnique({
                where: { id: applicationId },
                include: { candidate: true },
            });
            if (!app)
                return res.status(404).json({ error: 'Application not found' });
            if (!app.candidate.passwordHash) {
                const plainPassword = app.candidate.email.toLowerCase(); // email as password
                const hash = yield bcryptjs_1.default.hash(plainPassword, 10);
                yield prisma.candidate.update({
                    where: { id: app.candidateId },
                    data: { passwordHash: hash }
                });
            }
            const assigned = yield prisma.candidateAssignedTest.create({
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
            let interview = null;
            if (testDate) {
                const start = new Date(testDate);
                const end = new Date(testDate);
                // rough end time using test duration if available
                const t = yield prisma.evaluationTest.findUnique({ where: { id: Number(testId) }, select: { duration: true } });
                if (t === null || t === void 0 ? void 0 : t.duration)
                    end.setMinutes(end.getMinutes() + t.duration);
                interview = yield prisma.interview.create({
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
        }));
        // Get all assigned tests for an application
        this.listApplicationTests = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const applicationId = Number(req.params.id);
            const rows = yield prisma.candidateAssignedTest.findMany({
                where: { applicationId },
                include: { test: { select: { name: true, duration: true, passingPercent: true } } },
                orderBy: { assignedAt: 'desc' },
            });
            res.json(rows);
        }));
        // Mark a test as started (increments attempts, sets startedAt)
        this.startCandidateTest = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const applicationId = Number(req.params.id);
            const aid = Number(req.params.aid);
            const ct = yield prisma.candidateAssignedTest.findFirst({ where: { id: aid, applicationId } });
            if (!ct)
                return res.status(404).json({ error: 'Assigned test not found' });
            const updated = yield prisma.candidateAssignedTest.update({
                where: { id: aid },
                data: { status: 'InProgress', attempts: { increment: 1 }, startedAt: new Date() },
            });
            res.json(updated);
        }));
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
        this.getCandidateAssignedTests = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const candidateId = Number(req.params.candidateId);
            const rows = yield prisma.candidateAssignedTest.findMany({
                where: { candidateId },
                include: {
                    test: { select: { id: true, name: true, duration: true, passingPercent: true, randomization: true } }
                },
                orderBy: { assignedAt: 'desc' },
            });
            // add "canStart" flag (respect maxAttempts from test)
            const out = yield Promise.all(rows.map((r) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                const t = yield prisma.evaluationTest.findUnique({ where: { id: r.testId }, select: { maxAttempts: true } });
                const canStart = ((_a = t === null || t === void 0 ? void 0 : t.maxAttempts) !== null && _a !== void 0 ? _a : 1) > ((_b = r.attempts) !== null && _b !== void 0 ? _b : 0) && r.status !== 'Completed' && r.status !== 'Cancelled';
                return Object.assign(Object.assign({}, r), { canStart });
            })));
            res.json(out);
        }));
        // ===== Test to take: deliver questions safely (no answers) =====
        /** GET /candidate/tests/:assignedId */
        this.getAssignedTestDetail = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const aid = Number(req.params.assignedId);
            const assigned = yield prisma.candidateAssignedTest.findUnique({
                where: { id: aid },
                include: {
                    test: true, // only pull test, we’ll fetch questions separately
                },
            });
            if (!assigned)
                return res.status(404).json({ error: 'Assigned test not found' });
            // ✅ Fetch questions via QuestionBank
            const questions = yield prisma.question.findMany({
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
        }));
        // ===== Start (attempt counter + startedAt) =====
        /** POST /candidate/tests/:assignedId/start */
        this.startCandidateAssignedTest = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const aid = Number(req.params.assignedId);
            const current = yield prisma.candidateAssignedTest.findUnique({ where: { id: aid } });
            if (!current)
                return res.status(404).json({ error: 'Assigned test not found' });
            const test = yield prisma.evaluationTest.findUnique({ where: { id: current.testId }, select: { maxAttempts: true } });
            const maxAttempts = (_a = test === null || test === void 0 ? void 0 : test.maxAttempts) !== null && _a !== void 0 ? _a : 1;
            if (((_b = current.attempts) !== null && _b !== void 0 ? _b : 0) >= maxAttempts) {
                return res.status(400).json({ error: 'Max attempts reached' });
            }
            const updated = yield prisma.candidateAssignedTest.update({
                where: { id: aid },
                data: { status: 'InProgress', attempts: { increment: 1 }, startedAt: new Date() },
            });
            res.json(updated);
        }));
        /** POST /candidate/tests/:assignedId/submit  { answers: [{questionId, answer}] } */
        this.submitCandidateAssignedTest = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const aid = Number(req.params.assignedId);
            const { answers } = req.body || [];
            const assigned = yield prisma.candidateAssignedTest.findUnique({
                where: { id: aid },
                include: {
                    application: { include: { job: true, candidate: true } },
                    test: { include: { questions: { include: { options: true } } } },
                },
            });
            if (!assigned)
                return res.status(404).json({ error: 'Assigned test not found' });
            // --- score MCQs ---
            const ansMap = new Map();
            for (const a of answers || [])
                ansMap.set(Number(a.questionId), a.answer);
            let totalWeight = 0, earned = 0;
            for (const q of assigned.test.questions) {
                const w = (_a = q.weight) !== null && _a !== void 0 ? _a : 1;
                totalWeight += w;
                if (q.type === 'MCQ') {
                    const correct = (q.correctAnswerIds || '')
                        .split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
                    const given = (Array.isArray(ansMap.get(q.id)) ? ansMap.get(q.id) : [ansMap.get(q.id)])
                        .filter((x) => x != null).map((x) => Number(x)).sort((a, b) => a - b);
                    const ok = correct.length === given.length && correct.every((v, i) => v === given[i]);
                    if (ok)
                        earned += w;
                }
            }
            const percent = totalWeight ? Math.round((earned / totalWeight) * 100) : 0;
            // Persist results — NO app status change here
            const updated = yield prisma.candidateAssignedTest.update({
                where: { id: aid },
                data: {
                    status: 'Completed',
                    completedAt: new Date(),
                    score: percent,
                    response: JSON.stringify(answers !== null && answers !== void 0 ? answers : []),
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
            const hrUserId = (_b = assigned.application.job.createdBy) !== null && _b !== void 0 ? _b : 0;
            // await prisma.notification.create({
            //   data: { employeeId: hrUserId, message: `Test submitted by ${assigned.application.candidate.name} — review needed`, channel: 'PUSH' as any }
            // }).catch(()=>{});
            // (Optional) candidate “thanks” mail
            // await sendEmail(assigned.application.candidate.email, `We received your ${assigned.test.name}`, `Thanks! Our team will review it.`);
            res.json({ ok: true, score: percent });
        }));
        /** POST /applications/:id/tests/:aid/review  { decision:'PASS'|'FAIL', note?:string } */
        this.reviewCandidateTest = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const applicationId = Number(req.params.id);
            const aid = Number(req.params.aid);
            const { decision, note, reviewedBy } = req.body || {};
            if (!['PASS', 'FAIL'].includes(decision))
                return res.status(400).json({ error: 'decision must be PASS or FAIL' });
            const updated = yield prisma.candidateAssignedTest.update({
                where: { id: aid },
                data: {
                    reviewedBy: reviewedBy || 0, // or your auth user id
                    reviewedAt: new Date(),
                    reviewDecision: decision,
                    reviewNote: note !== null && note !== void 0 ? note : null,
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
            }
            catch (_a) { }
            res.json({ ok: true });
        }));
        /** GET /tests/review-queue?dept=&jobId= */
        this.getTestReviewQueue = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const { jobId } = req.query || {};
            const where = { status: 'Completed', reviewedAt: null };
            if (jobId)
                where.application = { jobId: Number(jobId) };
            const rows = yield prisma.candidateAssignedTest.findMany({
                where,
                include: {
                    application: { include: { candidate: true, job: true } },
                    test: { select: { name: true, duration: true } },
                },
                orderBy: { completedAt: 'desc' },
                take: 100,
            });
            res.json(rows);
        }));
        this.getApplicationSummary = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            try {
                const app = yield prisma.application.findUnique({
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
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: 'Failed to load application summary' });
            }
        }));
    }
}
exports.RecruitingController = RecruitingController;
// POST /api/interviews/:id/feedback
exports.upsertFeedback = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const interviewId = Number(req.params.id);
    // NEW: take panelId from the client (e.g., from localStorage on the frontend)
    const panelId = Number(req.body.panelId);
    if (!Number.isFinite(panelId)) {
        return bad(res, 'panelId (number) is required', 400);
    }
    const { name, designation, jobSkills, jobKnowledge, attitude, communication, notes, signature, submit } = req.body;
    // Fetch interview & authorize: panelId must belong to this interview
    const itv = yield prisma.interview.findUnique({ where: { id: interviewId } });
    if (!itv)
        return bad(res, 'Interview not found', 404);
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
        .filter((n) => n != null);
    const average = scores.length
        ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
        : null;
    const status = submit ? 'SUBMITTED' : 'DRAFT';
    const fb = yield prisma.interviewFeedback.upsert({
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
}));
function generateEmployeeCode() {
    return __awaiter(this, void 0, void 0, function* () {
        const prefix = process.env.EMPLOYEE_CODE_PREFIX || 'EMP';
        const startNumber = process.env.EMPLOYEE_CODE_START || '001';
        const lastEmployee = yield prisma.employee.findFirst({
            orderBy: { employeeCode: 'desc' },
            select: { employeeCode: true }
        });
        let newCode = `${prefix}${startNumber}`;
        if (lastEmployee === null || lastEmployee === void 0 ? void 0 : lastEmployee.employeeCode) {
            const lastNumber = parseInt(lastEmployee.employeeCode.replace(/\D/g, ''), 10);
            newCode = `${prefix}${String(lastNumber + 1).padStart(3, '0')}`;
        }
        return newCode;
    });
}
// POST /api/interviews/:id/hr-review
exports.saveHrReview = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const interviewId = Number(req.params.id);
    const { presentSalary, payslip, expectedSalary, grossOffer, conclusion, remarks, reviewerUserId, expectedDoj, noticePeriod } = req.body;
    const review = yield prisma.interviewHRReview.upsert({
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
    yield prisma.interview.update({
        where: { id: interviewId },
        data: { result: conclusion || null, feedbackAt: new Date() },
    });
    // (optional) bump Application status to INTERVIEWED
    const itv = yield prisma.interview.findUnique({ where: { id: interviewId }, select: { applicationId: true } });
    if (itv) {
        yield prisma.application.update({
            where: { id: itv.applicationId },
            data: { status: client_1.ApplicationStatus.INTERVIEWED },
        });
    }
    res.json(review);
}));
// GET /api/interviews/:id/summary
exports.getSummary = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const interviewId = Number(req.params.id);
    const [itv, feedbacks, hr] = yield Promise.all([
        prisma.interview.findUnique({
            where: { id: interviewId },
            include: { application: { include: { candidate: true, job: true } } },
        }),
        prisma.interviewFeedback.findMany({ where: { interviewId }, orderBy: { panelUserId: 'asc' } }),
        prisma.interviewHRReview.findUnique({ where: { interviewId } }),
    ]);
    if (!itv)
        return bad(res, 'Interview not found', 404);
    const panelAvg = feedbacks.length
        ? +(feedbacks
            .map(f => f.average)
            .filter((x) => typeof x === 'number')
            .reduce((a, b) => a + b, 0) / feedbacks.length).toFixed(1)
        : null;
    res.json({ interview: itv, feedbacks, panelAvg, hr });
}));
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
exports.listInterviews = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const page = Number((_a = req.query.page) !== null && _a !== void 0 ? _a : 1);
    const pageSize = Math.min(50, Number((_b = req.query.pageSize) !== null && _b !== void 0 ? _b : 10));
    const skip = (page - 1) * pageSize;
    const where = {}; // empty: no filters
    const [items, total] = yield Promise.all([
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
}));
exports.listEmployeeInterviews = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { employeeId } = req.params;
    if (!employeeId) {
        res.status(400);
        throw new Error('Employee ID is required');
    }
    const all = yield prisma.interview.findMany({
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
    const items = all.filter(i => { var _a; return (_a = i.panelUserIds) === null || _a === void 0 ? void 0 : _a.split(',').map(id => id.trim()).includes(employeeId.toString()); });
    res.json(items);
}));
function sendInterviewMail(props) {
    return __awaiter(this, void 0, void 0, function* () {
        const { to, candidateName, jobTitle, stage, startTime, endTime, hospitalName, hospitalAddress, googleLocationUrl, panelNames, } = props;
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
        yield transporter.sendMail({
            from: process.env.SMTP_USER,
            to: recipients,
            subject: `Interview Scheduled – ${jobTitle}`,
            text,
            html,
        });
    });
}
