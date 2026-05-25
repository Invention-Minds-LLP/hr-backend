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
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
exports.listEmployeeInterviews = exports.listInterviews = exports.getSummary = exports.saveHrReview = exports.updateReferralBonus = exports.deleteBgvDocument = exports.listBgvDocuments = exports.addBgvDocument = exports.completeBgv = exports.resolveBgvDiscrepancy = exports.updateBgvCheck = exports.getBgv = exports.initiateBgv = exports.recordReferenceCheck = exports.deleteReference = exports.updateReference = exports.addReference = exports.listReferences = exports.recordConsent = exports.upsertFeedback = exports.RecruitingController = void 0;
exports.expireStaleOffers = expireStaleOffers;
exports.processReferralBonusEligibility = processReferralBonusEligibility;
exports.sendInterviewMail = sendInterviewMail;
exports.generateRandomPassword = generateRandomPassword;
exports.sendCandidateTestMail = sendCandidateTestMail;
exports.sendOfferLetterMail = sendOfferLetterMail;
const client_1 = require("@prisma/client");
const formidable_1 = __importDefault(require("formidable"));
const fs_1 = __importDefault(require("fs"));
const basic_ftp_1 = require("basic-ftp");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const notifications_controller_1 = require("../notifications/notifications.controller");
const offerLetterPdf_1 = require("./offerLetterPdf");
const prisma = new client_1.PrismaClient();
// FTP credentials are loaded from environment variables. Add the following to your `.env`:
//   FTP_HOST=srv680.main-hosting.eu
//   FTP_USER=u948610439.hrproindia.in
//   FTP_PASSWORD=*****
//   FTP_SECURE=false
const FTP_CONFIG = {
    host: (_a = process.env.FTP_HOST) !== null && _a !== void 0 ? _a : "",
    user: (_b = process.env.FTP_USER) !== null && _b !== void 0 ? _b : "",
    password: (_c = process.env.FTP_PASS) !== null && _c !== void 0 ? _c : "",
    secure: process.env.FTP_SECURE === "true",
};
if (!FTP_CONFIG.host || !FTP_CONFIG.user || !FTP_CONFIG.password) {
    console.warn("⚠️  [recruiting] FTP_HOST / FTP_USER / FTP_PASSWORD not set in env — file uploads will fail");
}
// Default IDs that used to be hard-coded throughout this file. Override per
// environment by adding these to your `.env`:
//   HR_DEPARTMENT_ID=1
//   DEFAULT_BRANCH_ID=1
//   DEFAULT_EMPLOYEE_ROLE_ID=3
//   DEFAULT_HR_ROLE_ID=1
const RECRUITING_DEFAULTS = {
    hrDepartmentId: Number(process.env.HR_DEPARTMENT_ID) || 1,
    defaultBranchId: Number(process.env.DEFAULT_BRANCH_ID) || 1,
    defaultEmployeeRoleId: Number(process.env.DEFAULT_EMPLOYEE_ROLE_ID) || 3,
    defaultHrRoleId: Number(process.env.DEFAULT_HR_ROLE_ID) || 1,
};
/**
 * Read panel member IDs for an interview, preferring the new junction table
 * (`InterviewPanelMember`) and falling back to the legacy CSV column for any
 * row that hasn't been backfilled yet. Use this helper everywhere instead of
 * parsing the CSV directly so we stay forward-compatible.
 */
function readInterviewPanelIds(itv) {
    var _a;
    if (itv.panel && itv.panel.length) {
        return itv.panel.map((p) => p.employeeId);
    }
    return String((_a = itv.panelUserIds) !== null && _a !== void 0 ? _a : "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
}
/**
 * Append an audit-log entry for an Application. Pass the request's transaction
 * client (`tx`) when called inside a transaction so the log is committed atomically.
 * Failures are logged but never throw — auditing must not break business flows.
 */
function logApplicationAction(tx_1, applicationId_1, action_1) {
    return __awaiter(this, arguments, void 0, function* (tx, applicationId, action, opts = {}) {
        var _a, _b, _c, _d;
        try {
            yield tx.applicationAuditLog.create({
                data: {
                    applicationId,
                    action,
                    fromStatus: (_a = opts.fromStatus) !== null && _a !== void 0 ? _a : null,
                    toStatus: (_b = opts.toStatus) !== null && _b !== void 0 ? _b : null,
                    note: (_c = opts.note) !== null && _c !== void 0 ? _c : null,
                    performedBy: (_d = opts.performedBy) !== null && _d !== void 0 ? _d : null,
                },
            });
        }
        catch (err) {
            console.error(`[audit] failed to log ${action} on application ${applicationId}:`, err);
        }
    });
}
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
                var _a, _b, _c, _d;
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
                    // Optional referral block — sent as JSON-encoded `referral` form field.
                    // Shape: { type, referrerEmployeeId?, referrerName?, referrerEmail?,
                    //          referrerPhone?, referrerCompany? }. Validated below.
                    const referralRaw = fields.referral
                        ? Array.isArray(fields.referral) ? fields.referral[0] : fields.referral
                        : null;
                    const referral = referralRaw ? JSON.parse(referralRaw) : null;
                    if (!jobId)
                        return res.status(400).json({ error: "jobId is required" });
                    // Validate referral payload (if any). INTERNAL must point to a real
                    // employee (via either referrerEmployeeId OR referrerEmployeeCode —
                    // candidates know the code, not our internal numeric id). EXTERNAL /
                    // AGENCY must supply a name. Other types are open.
                    const REFERRAL_TYPES = ['INTERNAL', 'EXTERNAL', 'AGENCY', 'JOB_BOARD', 'SOCIAL', 'WALK_IN', 'OTHER'];
                    let referralData = null;
                    if (referral && referral.type) {
                        if (!REFERRAL_TYPES.includes(referral.type)) {
                            return res.status(400).json({ error: `referral.type must be one of ${REFERRAL_TYPES.join(',')}` });
                        }
                        if (referral.type === 'INTERNAL' && !referral.referrerEmployeeId && !referral.referrerEmployeeCode) {
                            return res.status(400).json({ error: 'INTERNAL referral requires referrerEmployeeId or referrerEmployeeCode' });
                        }
                        if ((referral.type === 'EXTERNAL' || referral.type === 'AGENCY') && !referral.referrerName) {
                            return res.status(400).json({ error: `${referral.type} referral requires referrerName` });
                        }
                        // Resolve to a numeric Employee.id. Prefer explicit id when both are
                        // sent. If only code provided, look it up.
                        let resolvedEmployeeId = null;
                        if (referral.referrerEmployeeId) {
                            const emp = yield prisma.employee.findUnique({
                                where: { id: Number(referral.referrerEmployeeId) },
                                select: { id: true },
                            });
                            if (!emp)
                                return res.status(400).json({ error: 'referrerEmployeeId not found' });
                            resolvedEmployeeId = emp.id;
                        }
                        else if (referral.referrerEmployeeCode) {
                            const emp = yield prisma.employee.findUnique({
                                where: { employeeCode: String(referral.referrerEmployeeCode).trim() },
                                select: { id: true, employmentStatus: true },
                            });
                            if (!emp)
                                return res.status(400).json({ error: `Employee code "${referral.referrerEmployeeCode}" not found` });
                            if (emp.employmentStatus !== 'ACTIVE') {
                                return res.status(400).json({ error: `Referrer must be an active employee` });
                            }
                            resolvedEmployeeId = emp.id;
                        }
                        referralData = {
                            referralType: referral.type,
                            referrerEmployeeId: resolvedEmployeeId,
                            referrerName: (_a = referral.referrerName) !== null && _a !== void 0 ? _a : null,
                            referrerEmail: (_b = referral.referrerEmail) !== null && _b !== void 0 ? _b : null,
                            referrerPhone: (_c = referral.referrerPhone) !== null && _c !== void 0 ? _c : null,
                            referrerCompany: (_d = referral.referrerCompany) !== null && _d !== void 0 ? _d : null,
                            // Internal referrals start in NOT_APPLICABLE — flipped to PENDING_JOIN
                            // when the offer is signed (so we don't track bonus for rejected apps).
                            referralBonusStatus: 'NOT_APPLICABLE',
                        };
                    }
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
                            data: Object.assign({ jobId, candidateId: candId, status: client_1.ApplicationStatus.APPLIED }, (referralData !== null && referralData !== void 0 ? referralData : {})),
                            include: { candidate: true, job: true },
                        });
                    }));
                    // 🔔 Notify HR about new application
                    try {
                        const hrEmployees = yield prisma.employee.findMany({
                            where: {
                                departmentId: RECRUITING_DEFAULTS.hrDepartmentId,
                                employmentStatus: 'ACTIVE'
                            },
                            select: { id: true }
                        });
                        const hrIds = hrEmployees.map(e => e.id);
                        if (hrIds.length) {
                            const message = `New application received for ${app.job.title} from ${app.candidate.name}.`;
                            for (const id of hrIds) {
                                yield (0, notifications_controller_1.createNotification)(id, message);
                            }
                        }
                    }
                    catch (notifyErr) {
                        console.error("HR notification failed:", notifyErr);
                    }
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
            const updated = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                const u = yield tx.application.update({
                    where: { id },
                    data: {
                        status: to,
                        rejectReason: to === client_1.ApplicationStatus.REJECTED ? rejectReason : null,
                        currentStage: to === client_1.ApplicationStatus.SHORTLISTED ? currentStage : app.currentStage,
                        shortlistNote: to === client_1.ApplicationStatus.SHORTLISTED ? shortListNote : app.shortlistNote,
                    },
                });
                yield logApplicationAction(tx, id, 'STATUS_CHANGE', {
                    fromStatus: app.status,
                    toStatus: to,
                    note: to === client_1.ApplicationStatus.REJECTED ? `Rejected: ${rejectReason}` : (shortListNote || null),
                    performedBy: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null,
                });
                return u;
            }));
            res.json(updated);
        }));
        /**
         * GET /recruiter-dashboard
         * Single endpoint that powers the recruiter management view:
         *   • Hiring funnel (counts at each stage)
         *   • Time-to-hire (avg days from APPLIED → HIRED, last 90 days)
         *   • Source effectiveness (applications per source + how many got hired)
         *   • Panel utilization (top 10 employees by interview load — last 30 days)
         *   • Open positions vs. seats filled
         *   • Pending actions: review queue, offers awaiting response, scheduled interviews
         */
        this.getRecruiterDashboard = asyncHandler((_req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e;
            const now = new Date();
            const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const [openHeadcountAgg, filledSeats, 
            // Funnel counts
            totalApps, countApplied, countShortlisted, countInterviewScheduled, countInterviewed, countOffered, countAccepted, countHired, countRejected, countDeclined, 
            // Pending actions
            pendingTestReviews, pendingOfferResponses, upcomingInterviews, 
            // Time-to-hire raw data
            hiredApplications, 
            // Source effectiveness raw
            sourceData, 
            // Panel utilization raw
            recentInterviews,] = yield Promise.all([
                prisma.job.aggregate({ where: { status: client_1.JobStatus.OPEN }, _sum: { headcount: true } }),
                prisma.application.count({
                    where: {
                        job: { status: client_1.JobStatus.OPEN },
                        status: { in: [client_1.ApplicationStatus.OFFER_ACCEPTED, client_1.ApplicationStatus.HIRED] },
                    },
                }),
                prisma.application.count(),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.APPLIED } }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.SHORTLISTED } }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.INTERVIEW_SCHEDULED } }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.INTERVIEWED } }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.OFFERED } }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.OFFER_ACCEPTED } }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.HIRED } }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.REJECTED } }),
                prisma.application.count({ where: { status: client_1.ApplicationStatus.OFFER_DECLINED } }),
                prisma.candidateAssignedTest.count({
                    where: { status: 'Completed', reviewedAt: null },
                }),
                prisma.offer.count({
                    where: { status: { in: [client_1.OfferStatus.SENT, client_1.OfferStatus.VIEWED] } },
                }),
                prisma.interview.count({
                    where: { startTime: { gte: now }, result: null },
                }),
                prisma.application.findMany({
                    where: { status: client_1.ApplicationStatus.HIRED, updatedAt: { gte: ninetyDaysAgo } },
                    select: { id: true, createdAt: true, updatedAt: true, source: true },
                }),
                prisma.application.groupBy({
                    by: ['source'],
                    _count: { id: true },
                }),
                prisma.interview.findMany({
                    where: { startTime: { gte: thirtyDaysAgo } },
                    select: { panel: { select: { employeeId: true } }, panelUserIds: true, startTime: true },
                }),
            ]);
            // Funnel — ordered list with counts + drop-off %
            const funnelStages = [
                { stage: 'Applied', count: countApplied + countShortlisted + countInterviewScheduled + countInterviewed + countOffered + countAccepted + countHired + countRejected + countDeclined },
                { stage: 'Shortlisted', count: countShortlisted + countInterviewScheduled + countInterviewed + countOffered + countAccepted + countHired },
                { stage: 'Interview Scheduled', count: countInterviewScheduled + countInterviewed + countOffered + countAccepted + countHired },
                { stage: 'Interviewed', count: countInterviewed + countOffered + countAccepted + countHired },
                { stage: 'Offered', count: countOffered + countAccepted + countHired },
                { stage: 'Accepted', count: countAccepted + countHired },
                { stage: 'Hired', count: countHired },
            ];
            // Compute drop-off % stage-over-stage
            const funnel = funnelStages.map((s, i) => {
                const prev = i === 0 ? s.count : funnelStages[i - 1].count;
                const dropPct = prev > 0 ? Math.round(((prev - s.count) / prev) * 100) : 0;
                return Object.assign(Object.assign({}, s), { dropPct });
            });
            // Time-to-hire (avg days)
            const ttHires = hiredApplications.map((a) => (a.updatedAt.getTime() - a.createdAt.getTime()) / (1000 * 60 * 60 * 24));
            const avgTimeToHire = ttHires.length
                ? Math.round((ttHires.reduce((s, x) => s + x, 0) / ttHires.length) * 10) / 10
                : 0;
            const medianTimeToHire = ttHires.length
                ? (() => {
                    const sorted = [...ttHires].sort((a, b) => a - b);
                    const m = Math.floor(sorted.length / 2);
                    return Math.round((sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m]) * 10) / 10;
                })()
                : 0;
            // Source effectiveness — total apps + how many got hired
            const sourceMap = new Map();
            for (const s of sourceData) {
                sourceMap.set((_a = s.source) !== null && _a !== void 0 ? _a : 'Unknown', {
                    total: s._count.id,
                    hired: 0,
                });
            }
            // Count hired per source
            const hiredBySource = yield prisma.application.groupBy({
                by: ['source'],
                where: { status: client_1.ApplicationStatus.HIRED },
                _count: { id: true },
            });
            for (const h of hiredBySource) {
                const cur = sourceMap.get((_b = h.source) !== null && _b !== void 0 ? _b : 'Unknown');
                if (cur)
                    cur.hired = h._count.id;
            }
            const sourceEffectiveness = Array.from(sourceMap.entries())
                .map(([source, v]) => ({
                source,
                total: v.total,
                hired: v.hired,
                conversionPct: v.total > 0 ? Math.round((v.hired / v.total) * 100) : 0,
            }))
                .sort((a, b) => b.total - a.total);
            // Panel utilization (last 30 days) — top 10 employees by interview count
            const panelLoad = new Map();
            for (const itv of recentInterviews) {
                const ids = readInterviewPanelIds(itv);
                for (const id of ids) {
                    panelLoad.set(id, ((_c = panelLoad.get(id)) !== null && _c !== void 0 ? _c : 0) + 1);
                }
            }
            const panelIds = Array.from(panelLoad.keys());
            const panelEmps = panelIds.length
                ? yield prisma.employee.findMany({
                    where: { id: { in: panelIds } },
                    select: {
                        id: true, firstName: true, lastName: true, employeeCode: true,
                        Department: { select: { name: true } },
                    },
                })
                : [];
            const panelUtilization = panelEmps
                .map((e) => {
                var _a, _b, _c;
                return ({
                    employeeId: e.id,
                    name: `${e.firstName} ${e.lastName}`,
                    employeeCode: e.employeeCode,
                    dept: (_b = (_a = e.Department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '—',
                    interviewCount: (_c = panelLoad.get(e.id)) !== null && _c !== void 0 ? _c : 0,
                });
            })
                .sort((a, b) => b.interviewCount - a.interviewCount)
                .slice(0, 10);
            res.json({
                vacancies: Math.max(0, ((_d = openHeadcountAgg._sum.headcount) !== null && _d !== void 0 ? _d : 0) - filledSeats),
                openHeadcount: (_e = openHeadcountAgg._sum.headcount) !== null && _e !== void 0 ? _e : 0,
                filledSeats,
                kpis: {
                    totalApps,
                    avgTimeToHireDays: avgTimeToHire,
                    medianTimeToHireDays: medianTimeToHire,
                    offerAcceptanceRate: (countOffered + countAccepted + countHired + countDeclined) > 0
                        ? Math.round(((countAccepted + countHired) / (countOffered + countAccepted + countHired + countDeclined)) * 100)
                        : 0,
                    rejectionRate: totalApps > 0 ? Math.round((countRejected / totalApps) * 100) : 0,
                },
                pendingActions: {
                    testReviews: pendingTestReviews,
                    offerResponses: pendingOfferResponses,
                    upcomingInterviews,
                },
                funnel,
                sourceEffectiveness,
                panelUtilization,
            });
        }));
        /**
         * GET /recruiter-insights
         *
         * Action-oriented analytics for the recruitment dashboard. Returns 12
         * widgets in one shot to keep API chatter low. Each section answers a
         * specific recruiter question:
         *
         *  Today's work:
         *   • staleCandidates       — apps untouched > N days, not in terminal stage
         *   • hotCandidates         — high test/interview scores, not yet hired
         *   • activityFeed          — chronological audit-log of recent moves
         *   • stageDurationDays     — avg days spent in each pipeline stage
         *
         *  Prevent mistakes:
         *   • complianceGaps        — offered apps missing BGV / refs / consent
         *   • offerExpiringSoon     — sent offers approaching join date, unsigned
         *
         *  Strategy:
         *   • topReferrers          — employees with most successful referrals
         *   • demandVsSupplyByDept  — open seats vs apps received per dept
         *   • offerAcceptTrend      — accept vs decline last 6 months
         *   • testScoreDistribution — histogram of candidate test scores
         *
         *  Reporting:
         *   • interviewHeatmap      — interview density by weekday × hour
         *
         * Configurable via ENV:
         *   RECRUIT_STALE_DAYS=7
         *   RECRUIT_HOT_TEST_SCORE=80
         *   RECRUIT_HOT_INTERVIEW_AVG=8
         */
        this.getRecruiterInsights = asyncHandler((_req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const STALE_DAYS = Number(process.env.RECRUIT_STALE_DAYS) || 7;
            const HOT_TEST_SCORE = Number(process.env.RECRUIT_HOT_TEST_SCORE) || 80;
            const HOT_INTERVIEW_AVG = Number(process.env.RECRUIT_HOT_INTERVIEW_AVG) || 8;
            const now = new Date();
            const staleCutoff = new Date(now.getTime() - STALE_DAYS * 86400000);
            const sevenDaysAhead = new Date(now.getTime() + 7 * 86400000);
            const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
            // Terminal statuses: don't surface these in stale or last-touch widgets
            const TERMINAL = [
                client_1.ApplicationStatus.HIRED,
                client_1.ApplicationStatus.REJECTED,
                client_1.ApplicationStatus.WITHDRAWN,
                client_1.ApplicationStatus.OFFER_DECLINED,
                client_1.ApplicationStatus.NO_SHOW,
            ];
            const [
            // Today's work
            staleApps, hotTestApps, hotInterviewFeedback, activityRows, auditForStageDuration, 
            // Prevent mistakes
            offeredApps, offerExpiringSoon, 
            // Strategy
            hiredReferrals, jobsOpenAgg, appsByDept, offerHistory, testScores, 
            // Reporting
            recentInterviews,] = yield Promise.all([
                // 🥶 Stale: apps not touched recently and still in flight
                prisma.application.findMany({
                    where: {
                        updatedAt: { lt: staleCutoff },
                        status: { notIn: TERMINAL },
                    },
                    select: {
                        id: true, status: true, updatedAt: true,
                        candidate: { select: { name: true, email: true } },
                        job: { select: { title: true } },
                    },
                    orderBy: { updatedAt: 'asc' },
                    take: 20,
                }),
                // 🔥 Hot — top test scorers not yet hired
                prisma.candidateAssignedTest.findMany({
                    where: {
                        score: { gte: HOT_TEST_SCORE },
                        application: { status: { notIn: TERMINAL } },
                    },
                    select: {
                        id: true, score: true, reviewDecision: true,
                        application: {
                            select: {
                                id: true, status: true,
                                candidate: { select: { name: true, email: true } },
                                job: { select: { title: true } },
                            },
                        },
                    },
                    orderBy: { score: 'desc' },
                    take: 10,
                }),
                // 🔥 Hot — high panel-feedback averages
                prisma.interviewFeedback.findMany({
                    where: {
                        average: { gte: HOT_INTERVIEW_AVG },
                        interview: { application: { status: { notIn: TERMINAL } } },
                    },
                    select: {
                        id: true, average: true,
                        interview: {
                            select: {
                                id: true,
                                application: {
                                    select: {
                                        id: true, status: true,
                                        candidate: { select: { name: true, email: true } },
                                        job: { select: { title: true } },
                                    },
                                },
                            },
                        },
                    },
                    orderBy: { average: 'desc' },
                    take: 10,
                }),
                // 📜 Activity feed — last 25 audit log entries.
                // The schema doesn't define an `application` relation on the audit log,
                // so we hydrate candidate / job details client-side after this query.
                prisma.applicationAuditLog.findMany({
                    select: {
                        id: true, applicationId: true,
                        action: true, fromStatus: true, toStatus: true,
                        note: true, performedAt: true, performedBy: true,
                    },
                    orderBy: { performedAt: 'desc' },
                    take: 25,
                }),
                // 🕒 Stage duration — pull all status-change audit entries from the
                // last 90 days, then compute avg dwell time per fromStatus client-side
                prisma.applicationAuditLog.findMany({
                    where: {
                        performedAt: { gte: new Date(now.getTime() - 90 * 86400000) },
                        fromStatus: { not: null },
                        toStatus: { not: null },
                    },
                    select: {
                        applicationId: true, fromStatus: true, toStatus: true, performedAt: true,
                    },
                    orderBy: [{ applicationId: 'asc' }, { performedAt: 'asc' }],
                }),
                // ⚠️ Compliance — offered or offer-accepted apps; later we filter
                // those missing consent / refs / BGV
                prisma.application.findMany({
                    where: { status: { in: [client_1.ApplicationStatus.OFFERED, client_1.ApplicationStatus.OFFER_ACCEPTED] } },
                    select: {
                        id: true, status: true,
                        referencesConsentAt: true, bgvConsentAt: true,
                        candidate: { select: { name: true } },
                        job: { select: { title: true } },
                        references: { select: { id: true, checkStatus: true } },
                        bgv: { select: { id: true, status: true } },
                    },
                    take: 50,
                }).catch(() => []),
                // 🛑 Offer expiry — sent / viewed offers approaching proposedJoinAt
                prisma.offer.findMany({
                    where: {
                        status: { in: [client_1.OfferStatus.SENT, client_1.OfferStatus.VIEWED] },
                        proposedJoinAt: { gte: now, lte: sevenDaysAhead },
                    },
                    select: {
                        id: true, status: true, sentAt: true, proposedJoinAt: true,
                        application: {
                            select: {
                                id: true,
                                candidate: { select: { name: true, email: true } },
                                job: { select: { title: true } },
                            },
                        },
                    },
                    orderBy: { proposedJoinAt: 'asc' },
                    take: 10,
                }),
                // 🎁 Top referrers — internal referrals that became HIRED
                prisma.application.groupBy({
                    by: ['referrerEmployeeId'],
                    where: {
                        referralType: 'INTERNAL',
                        referrerEmployeeId: { not: null },
                        status: client_1.ApplicationStatus.HIRED,
                    },
                    _count: { id: true },
                    orderBy: { _count: { id: 'desc' } },
                    take: 10,
                }).catch(() => []),
                // 💼 Demand — open job seats per department
                prisma.job.groupBy({
                    by: ['departmentId'],
                    where: { status: client_1.JobStatus.OPEN },
                    _sum: { headcount: true },
                }),
                // 💼 Supply — apps received per department in the last 30 days
                prisma.application.findMany({
                    where: { createdAt: { gte: new Date(now.getTime() - 30 * 86400000) } },
                    select: { job: { select: { departmentId: true } } },
                }),
                // 📈 Offer trend — accepted/declined offers in the last 6 months
                prisma.offer.findMany({
                    where: {
                        OR: [
                            { signedAt: { gte: sixMonthsAgo } },
                            { declinedAt: { gte: sixMonthsAgo } },
                        ],
                    },
                    select: { status: true, signedAt: true, declinedAt: true },
                }),
                // 🎯 Test scores for histogram
                prisma.candidateAssignedTest.findMany({
                    where: { score: { not: null } },
                    select: { score: true },
                    take: 500,
                }),
                // 📅 Calendar heatmap — interviews in the last 60 days
                prisma.interview.findMany({
                    where: { startTime: { gte: new Date(now.getTime() - 60 * 86400000) } },
                    select: { startTime: true },
                }),
            ]);
            // ── Process: stale candidates ─────────────────────────────
            const staleCandidates = staleApps.map((a) => ({
                applicationId: a.id,
                candidateName: a.candidate.name,
                candidateEmail: a.candidate.email,
                jobTitle: a.job.title,
                status: a.status,
                lastUpdate: a.updatedAt,
                daysIdle: Math.floor((now.getTime() - a.updatedAt.getTime()) / 86400000),
            }));
            // ── Process: hot candidates (merge test + interview, dedup by appId) ──
            const hotMap = new Map();
            for (const t of hotTestApps) {
                const app = t.application;
                hotMap.set(app.id, {
                    applicationId: app.id,
                    candidateName: app.candidate.name,
                    candidateEmail: app.candidate.email,
                    jobTitle: app.job.title,
                    status: app.status,
                    signal: 'TEST',
                    score: t.score,
                    scoreOutOf: 100,
                });
            }
            for (const fb of hotInterviewFeedback) {
                const app = fb.interview.application;
                // Test signal wins if both exist (numeric score is more objective)
                if (!hotMap.has(app.id)) {
                    hotMap.set(app.id, {
                        applicationId: app.id,
                        candidateName: app.candidate.name,
                        candidateEmail: app.candidate.email,
                        jobTitle: app.job.title,
                        status: app.status,
                        signal: 'INTERVIEW',
                        score: fb.average,
                        scoreOutOf: 10,
                    });
                }
            }
            const hotCandidates = Array.from(hotMap.values())
                .sort((a, b) => (b.score / b.scoreOutOf) - (a.score / a.scoreOutOf))
                .slice(0, 10);
            // ── Process: activity feed ────────────────────────────────
            // Hydrate candidate name + job title in one batched lookup since the
            // audit log doesn't have a direct `application` relation in this schema.
            const activityAppIds = Array.from(new Set(activityRows.map((r) => r.applicationId)));
            const activityApps = activityAppIds.length
                ? yield prisma.application.findMany({
                    where: { id: { in: activityAppIds } },
                    select: {
                        id: true,
                        candidate: { select: { name: true } },
                        job: { select: { title: true } },
                    },
                })
                : [];
            const activityAppMap = new Map(activityApps.map((a) => [a.id, a]));
            const activityFeed = activityRows.map((r) => {
                var _a, _b, _c, _d;
                const app = activityAppMap.get(r.applicationId);
                return {
                    id: r.id,
                    action: r.action,
                    fromStatus: r.fromStatus,
                    toStatus: r.toStatus,
                    note: r.note,
                    at: r.performedAt,
                    applicationId: r.applicationId,
                    candidateName: (_b = (_a = app === null || app === void 0 ? void 0 : app.candidate) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : 'Unknown',
                    jobTitle: (_d = (_c = app === null || app === void 0 ? void 0 : app.job) === null || _c === void 0 ? void 0 : _c.title) !== null && _d !== void 0 ? _d : 'Unknown role',
                };
            });
            // ── Process: stage duration ─────────────────────────────
            // For each application, walk its sorted history, compute (next.performedAt - this.performedAt)
            // for each row whose fromStatus === a stage of interest. Average per fromStatus.
            const stageBuckets = new Map();
            let prevApp = null;
            let prevAt = null;
            let prevStatus = null;
            for (const row of auditForStageDuration) {
                if (row.applicationId !== prevApp) {
                    prevApp = row.applicationId;
                    prevAt = row.performedAt;
                    prevStatus = row.toStatus;
                    continue;
                }
                if (prevStatus && prevAt) {
                    const days = (row.performedAt.getTime() - prevAt.getTime()) / 86400000;
                    if (days >= 0 && days < 365) {
                        const arr = (_a = stageBuckets.get(prevStatus)) !== null && _a !== void 0 ? _a : [];
                        arr.push(days);
                        stageBuckets.set(prevStatus, arr);
                    }
                }
                prevAt = row.performedAt;
                prevStatus = row.toStatus;
            }
            const stageDurationDays = Array.from(stageBuckets.entries())
                .map(([stage, arr]) => ({
                stage,
                avgDays: Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10,
                sampleSize: arr.length,
            }))
                .sort((a, b) => b.avgDays - a.avgDays);
            // ── Process: compliance gaps ───────────────────────────
            const complianceGaps = offeredApps.map((a) => {
                var _a, _b;
                const refsCount = (a.references || []).length;
                const refsCompletedCount = (a.references || []).filter((r) => r.checkStatus === 'DONE' || r.checkStatus === 'UNREACHABLE').length;
                const bgvStatus = (_b = (_a = a.bgv) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : 'NOT_INITIATED';
                const issues = [];
                if (!a.referencesConsentAt)
                    issues.push('Reference consent missing');
                if (!a.bgvConsentAt)
                    issues.push('BGV consent missing');
                if (refsCount === 0)
                    issues.push('No references captured');
                if (refsCount > 0 && refsCompletedCount < refsCount)
                    issues.push(`${refsCount - refsCompletedCount} reference check(s) pending`);
                if (bgvStatus === 'NOT_INITIATED')
                    issues.push('BGV not started');
                else if (bgvStatus === 'IN_PROGRESS')
                    issues.push('BGV in progress');
                else if (bgvStatus === 'FAILED' || bgvStatus === 'FLAGGED')
                    issues.push(`BGV ${bgvStatus}`);
                return {
                    applicationId: a.id,
                    candidateName: a.candidate.name,
                    jobTitle: a.job.title,
                    status: a.status,
                    issues,
                };
            }).filter((x) => x.issues.length > 0);
            // ── Process: offer expiring soon ───────────────────────
            const offerExpiringSoonOut = offerExpiringSoon.map((o) => ({
                offerId: o.id,
                applicationId: o.application.id,
                candidateName: o.application.candidate.name,
                jobTitle: o.application.job.title,
                offerStatus: o.status,
                sentAt: o.sentAt,
                proposedJoinAt: o.proposedJoinAt,
                daysUntilJoin: o.proposedJoinAt
                    ? Math.ceil((o.proposedJoinAt.getTime() - now.getTime()) / 86400000)
                    : null,
            }));
            // ── Process: top referrers ────────────────────────────
            const referrerIds = hiredReferrals.map((r) => r.referrerEmployeeId).filter(Boolean);
            const referrerEmps = referrerIds.length
                ? yield prisma.employee.findMany({
                    where: { id: { in: referrerIds } },
                    select: { id: true, firstName: true, lastName: true, employeeCode: true, Department: { select: { name: true } } },
                })
                : [];
            const refMap = new Map(referrerEmps.map((e) => [e.id, e]));
            const topReferrers = hiredReferrals
                .map((r) => {
                var _a, _b, _c;
                const emp = refMap.get(r.referrerEmployeeId);
                return {
                    employeeId: r.referrerEmployeeId,
                    name: emp ? `${emp.firstName} ${emp.lastName}` : `Employee #${r.referrerEmployeeId}`,
                    employeeCode: (_a = emp === null || emp === void 0 ? void 0 : emp.employeeCode) !== null && _a !== void 0 ? _a : '—',
                    dept: (_c = (_b = emp === null || emp === void 0 ? void 0 : emp.Department) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : '—',
                    hiredCount: r._count.id,
                };
            });
            // ── Process: demand vs supply by dept ───────────────────
            // Need dept names too — fetch them once for the involved IDs.
            const demandDeptIds = jobsOpenAgg.map((j) => j.departmentId).filter((x) => x != null);
            const supplyDeptIds = appsByDept.map((a) => { var _a; return (_a = a.job) === null || _a === void 0 ? void 0 : _a.departmentId; }).filter((x) => x != null);
            const allDeptIds = Array.from(new Set([...demandDeptIds, ...supplyDeptIds]));
            const depts = allDeptIds.length
                ? yield prisma.department.findMany({
                    where: { id: { in: allDeptIds } },
                    select: { id: true, name: true },
                })
                : [];
            const deptNameMap = new Map(depts.map((d) => [d.id, d.name]));
            const supplyMap = new Map();
            for (const a of appsByDept) {
                const did = (_b = a.job) === null || _b === void 0 ? void 0 : _b.departmentId;
                if (did != null)
                    supplyMap.set(did, ((_c = supplyMap.get(did)) !== null && _c !== void 0 ? _c : 0) + 1);
            }
            const demandVsSupply = jobsOpenAgg.map((j) => {
                var _a, _b, _c;
                return ({
                    departmentId: j.departmentId,
                    departmentName: j.departmentId != null ? ((_a = deptNameMap.get(j.departmentId)) !== null && _a !== void 0 ? _a : '—') : '—',
                    openSeats: (_b = j._sum.headcount) !== null && _b !== void 0 ? _b : 0,
                    applicationsLast30d: j.departmentId != null ? ((_c = supplyMap.get(j.departmentId)) !== null && _c !== void 0 ? _c : 0) : 0,
                });
            }).sort((a, b) => b.openSeats - a.openSeats);
            // ── Process: offer accept trend (last 6 calendar months) ──
            const monthBuckets = new Map();
            for (let i = 5; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                monthBuckets.set(key, { signed: 0, declined: 0 });
            }
            for (const o of offerHistory) {
                const ts = (_d = o.signedAt) !== null && _d !== void 0 ? _d : o.declinedAt;
                if (!ts)
                    continue;
                const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}`;
                const bucket = monthBuckets.get(key);
                if (!bucket)
                    continue;
                if (o.signedAt)
                    bucket.signed++;
                if (o.declinedAt)
                    bucket.declined++;
            }
            const offerAcceptTrend = Array.from(monthBuckets.entries()).map(([month, v]) => {
                const total = v.signed + v.declined;
                return {
                    month,
                    signed: v.signed,
                    declined: v.declined,
                    acceptPct: total > 0 ? Math.round((v.signed / total) * 100) : 0,
                };
            });
            // ── Process: test score histogram ─────────────────────
            const buckets = [
                { label: '0-19', min: 0, max: 20 },
                { label: '20-39', min: 20, max: 40 },
                { label: '40-59', min: 40, max: 60 },
                { label: '60-79', min: 60, max: 80 },
                { label: '80-100', min: 80, max: 101 },
            ];
            const testScoreDistribution = buckets.map((b) => ({
                label: b.label,
                count: testScores.filter((t) => t.score != null && t.score >= b.min && t.score < b.max).length,
            }));
            // ── Process: interview heatmap (weekday × hour) ──────
            // Output a 7×24 matrix-of-counts plus row/col totals for easy frontend rendering
            const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
            for (const itv of recentInterviews) {
                const t = new Date(itv.startTime);
                const dow = t.getDay();
                const hr = t.getHours();
                heatmap[dow][hr]++;
            }
            const interviewHeatmap = {
                counts: heatmap,
                totalsByDay: heatmap.map((row) => row.reduce((s, x) => s + x, 0)),
                totalsByHour: Array.from({ length: 24 }, (_, h) => heatmap.reduce((s, row) => s + row[h], 0)),
            };
            res.json({
                generatedAt: now.toISOString(),
                thresholds: { staleDays: STALE_DAYS, hotTestScore: HOT_TEST_SCORE, hotInterviewAvg: HOT_INTERVIEW_AVG },
                // Today's work
                staleCandidates,
                hotCandidates,
                activityFeed,
                stageDurationDays,
                // Prevent mistakes
                complianceGaps,
                offerExpiringSoon: offerExpiringSoonOut,
                // Strategy
                topReferrers,
                demandVsSupply,
                offerAcceptTrend,
                testScoreDistribution,
                // Reporting
                interviewHeatmap,
            });
        }));
        // GET /applications/:id/audit-log — full timeline of actions
        this.getApplicationAuditLog = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            const id = Number(req.params.id);
            const logs = yield prisma.applicationAuditLog.findMany({
                where: { applicationId: id },
                orderBy: { performedAt: 'desc' },
            });
            // Attach actor names where we have an employee id
            const empIds = [...new Set(logs.map((l) => l.performedBy).filter((x) => !!x))];
            const emps = empIds.length
                ? yield prisma.employee.findMany({
                    where: { id: { in: empIds } },
                    select: { id: true, firstName: true, lastName: true, employeeCode: true },
                })
                : [];
            const empMap = new Map(emps.map((e) => [e.id, e]));
            res.json(logs.map((l) => {
                var _a, _b, _c, _d;
                return (Object.assign(Object.assign({}, l), { performedByName: l.performedBy
                        ? `${(_b = (_a = empMap.get(l.performedBy)) === null || _a === void 0 ? void 0 : _a.firstName) !== null && _b !== void 0 ? _b : ''} ${(_d = (_c = empMap.get(l.performedBy)) === null || _c === void 0 ? void 0 : _c.lastName) !== null && _d !== void 0 ? _d : ''}`.trim() || `#${l.performedBy}`
                        : 'System' }));
            }));
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
            var _a, _b, _c, _d, _e, _f;
            const applicationId = Number(req.params.id);
            const { stage, startTime, endTime, panelUserIds, feedbackDue } = req.body || {};
            if (!stage || !startTime || !endTime)
                return bad(res, 'stage, startTime, endTime are required');
            // ── Validate interview times ────────────────────────────────────
            const start = new Date(startTime);
            const end = new Date(endTime);
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                return bad(res, 'Invalid startTime or endTime');
            }
            if (end <= start) {
                return bad(res, 'endTime must be after startTime');
            }
            const now = new Date();
            if (start < new Date(now.getTime() - 5 * 60 * 1000)) {
                // allow up to 5-min clock skew but reject anything noticeably in the past
                return bad(res, 'startTime cannot be in the past');
            }
            const durationMin = (end.getTime() - start.getTime()) / 60000;
            if (durationMin < 5)
                return bad(res, 'Interview must be at least 5 minutes long');
            if (durationMin > 8 * 60)
                return bad(res, 'Interview cannot exceed 8 hours');
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
                ? panelUserIds.map(Number).filter((n) => Number.isFinite(n))
                : typeof panelUserIds === 'string'
                    ? panelUserIds.split(',').map(s => Number(s.trim())).filter((n) => Number.isFinite(n))
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
            // (start and end already validated and declared above)
            // ✅ Step 2: Check for overlapping interviews via the junction table.
            // Find every interview that (a) overlaps the requested time window and
            // (b) has at least one panel member in common with our requested panel.
            const overlapsRaw = yield prisma.interview.findMany({
                where: {
                    startTime: { lt: end },
                    endTime: { gt: start },
                    OR: [
                        // New: junction-table match (preferred)
                        { panel: { some: { employeeId: { in: panels } } } },
                        // Legacy fallback for rows that haven't been backfilled yet.
                        // Filtering here is approximate (CSV `contains`) but we'll recheck
                        // exact membership in JS below.
                        { panelUserIds: { not: null } },
                    ],
                },
                include: {
                    panel: { select: { employeeId: true } },
                    application: {
                        include: {
                            candidate: { select: { name: true } },
                            job: { select: { title: true } },
                        },
                    },
                },
            });
            // Filter out false positives from the legacy CSV branch by re-checking
            // exact panel membership using the helper.
            const overlaps = overlapsRaw.filter((o) => {
                const ids = readInterviewPanelIds(o);
                return ids.some((id) => panels.includes(id));
            });
            // ✅ Step 3: If overlaps found → find which employee(s)
            if (overlaps.length > 0) {
                const allPanelIdsInConflicts = new Set();
                overlaps.forEach(o => {
                    readInterviewPanelIds(o)
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
                    const overlappingPanelIds = readInterviewPanelIds(o)
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
            // ✅ Step 4: No conflicts → create the interview + populate junction table
            const itv = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                if (app.status === client_1.ApplicationStatus.SHORTLISTED ||
                    app.status === client_1.ApplicationStatus.SCREENING) {
                    yield tx.application.update({
                        where: { id: applicationId },
                        data: { status: client_1.ApplicationStatus.INTERVIEW_SCHEDULED },
                    });
                }
                const created = yield tx.interview.create({
                    data: {
                        applicationId,
                        stage,
                        startTime: start,
                        endTime: end,
                        // Keep legacy CSV in sync for any old code path still reading it.
                        // Junction table is the source of truth going forward.
                        panelUserIds: panels.join(','),
                        feedbackDue: feedbackDue ? new Date(feedbackDue) : null,
                        panel: {
                            create: panels.map((employeeId) => ({ employeeId })),
                        },
                    },
                    include: { panel: { select: { employeeId: true } } },
                });
                yield logApplicationAction(tx, applicationId, 'INTERVIEW_SCHEDULED', {
                    toStatus: client_1.ApplicationStatus.INTERVIEW_SCHEDULED,
                    note: `${stage} on ${start.toLocaleString()} (panel: ${panelNames})`,
                    performedBy: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null,
                });
                return created;
            }));
            // Email failure must NOT block interview creation — log and continue
            let mailStatus = "skipped";
            let mailError;
            if (app.candidate.email) {
                try {
                    yield sendInterviewMail({
                        to: app.candidate.email,
                        candidateName: app.candidate.name,
                        jobTitle: app.job.title,
                        stage,
                        startTime: start.toLocaleString(),
                        endTime: end.toLocaleString(),
                        panelNames,
                        hospitalName: (_a = process.env.HOSPITAL_NAME) !== null && _a !== void 0 ? _a : "",
                        hospitalAddress: (_b = process.env.HOSPITAL_ADDRESS) !== null && _b !== void 0 ? _b : "",
                        googleLocationUrl: (_c = process.env.HOSPITAL_GOOGLE_MAP) !== null && _c !== void 0 ? _c : "",
                    });
                    mailStatus = "sent";
                }
                catch (e) {
                    mailStatus = "failed";
                    mailError = (e === null || e === void 0 ? void 0 : e.message) || "email send failed";
                    console.error("[scheduleInterview] candidate email failed:", e);
                }
            }
            // ── Notify panel members ──────────────────────────────────────
            // In-app bell + email so they know they're on the panel BEFORE the
            // interview start time. Failures are isolated per panelist; one bad
            // email never blocks others or the response.
            let panelNotifyCount = 0;
            let panelMailCount = 0;
            try {
                const panelDetails = yield prisma.employee.findMany({
                    where: { id: { in: panels } },
                    select: { id: true, firstName: true, lastName: true, email: true },
                });
                const inAppMessage = `🎤 You have been scheduled as a panel member for ${stage} interview ` +
                    `with ${app.candidate.name} (${app.job.title}) on ${start.toLocaleString()}.`;
                for (const p of panelDetails) {
                    try {
                        yield (0, notifications_controller_1.createNotification)(p.id, inAppMessage);
                        panelNotifyCount++;
                    }
                    catch (e) {
                        console.error(`[scheduleInterview] notify failed for emp ${p.id}:`, e);
                    }
                    if (p.email) {
                        try {
                            yield sendInterviewMail({
                                to: p.email,
                                candidateName: app.candidate.name,
                                jobTitle: app.job.title,
                                stage,
                                startTime: start.toLocaleString(),
                                endTime: end.toLocaleString(),
                                panelNames,
                                hospitalName: (_d = process.env.HOSPITAL_NAME) !== null && _d !== void 0 ? _d : "",
                                hospitalAddress: (_e = process.env.HOSPITAL_ADDRESS) !== null && _e !== void 0 ? _e : "",
                                googleLocationUrl: (_f = process.env.HOSPITAL_GOOGLE_MAP) !== null && _f !== void 0 ? _f : "",
                                // Hint to the email helper that this is the panelist copy. Helper
                                // can use it to re-write the salutation if needed; if it ignores
                                // the field, the candidate-facing text still reads OK.
                                recipientType: "PANELIST",
                                recipientName: `${p.firstName} ${p.lastName}`.trim(),
                            });
                            panelMailCount++;
                        }
                        catch (e) {
                            console.error(`[scheduleInterview] panel email failed for emp ${p.id}:`, e);
                        }
                    }
                }
                console.log(`[scheduleInterview] interview #${itv.id} → ` +
                    `${panelNotifyCount}/${panelDetails.length} panel notified, ` +
                    `${panelMailCount}/${panelDetails.length} emailed.`);
            }
            catch (e) {
                console.error("[scheduleInterview] panel notification block failed:", e);
            }
            res.status(201).json(Object.assign(Object.assign({}, itv), { mailStatus,
                mailError, panelNotified: panelNotifyCount, panelEmailed: panelMailCount }));
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
        /**
         * POST /offers/:id/send
         * Body: { proposedJoinAt?, ctc?, joinLocation?, workMode?, customNotes?, cc?, bcc? }
         *
         * Persists offer-letter fields, transitions Offer → SENT and Application → OFFERED,
         * generates the offer-letter PDF, and emails it to the candidate (with optional
         * CC / BCC). Email failures are caught — the state transition still commits so
         * HR can re-send via GET /offers/:id/pdf or by calling this endpoint again.
         */
        this.sendOffer = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const id = Number(req.params.id);
            const { proposedJoinAt, ctc, joinLocation, workMode, customNotes, cc, bcc, } = req.body || {};
            const offer = yield prisma.offer.findUnique({
                where: { id },
                include: {
                    application: {
                        include: {
                            candidate: true,
                            job: { include: { department: { select: { name: true } } } },
                        },
                    },
                },
            });
            if (!offer)
                return bad(res, 'Offer not found', 404);
            if (!offerNext[offer.status].includes(client_1.OfferStatus.SENT)) {
                return bad(res, `Cannot move offer from ${offer.status} → SENT`);
            }
            // Normalize CC / BCC inputs — accept either a CSV string or an array
            const toEmailList = (v) => {
                if (!v)
                    return [];
                const arr = Array.isArray(v) ? v : String(v).split(",");
                return arr
                    .map((s) => String(s).trim())
                    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
            };
            const ccList = toEmailList(cc);
            const bccList = toEmailList(bcc);
            const ctcNum = ctc !== undefined && ctc !== null && ctc !== ''
                ? Number(ctc) : ((_a = offer.ctc) !== null && _a !== void 0 ? _a : null);
            if (ctc !== undefined && ctc !== null && ctc !== '' && Number.isNaN(Number(ctc))) {
                return bad(res, 'ctc must be a number');
            }
            const finalProposedJoinAt = proposedJoinAt
                ? new Date(proposedJoinAt)
                : offer.proposedJoinAt;
            // Persist offer-letter inputs + flip status inside one transaction
            const updated = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                const of = yield tx.offer.update({
                    where: { id },
                    data: {
                        status: client_1.OfferStatus.SENT,
                        sentAt: new Date(),
                        proposedJoinAt: finalProposedJoinAt,
                        ctc: ctcNum,
                        joinLocation: joinLocation !== null && joinLocation !== void 0 ? joinLocation : offer.joinLocation,
                        workMode: workMode !== null && workMode !== void 0 ? workMode : offer.workMode,
                        customNotes: customNotes !== null && customNotes !== void 0 ? customNotes : offer.customNotes,
                        ccEmails: ccList.length ? ccList.join(',') : offer.ccEmails,
                        bccEmails: bccList.length ? bccList.join(',') : offer.bccEmails,
                    },
                });
                yield tx.application.update({
                    where: { id: offer.applicationId },
                    data: { status: client_1.ApplicationStatus.OFFERED },
                });
                yield logApplicationAction(tx, offer.applicationId, 'OFFER_SENT', {
                    toStatus: client_1.ApplicationStatus.OFFERED,
                    note: `Offer #${id} sent to ${offer.application.candidate.email}`,
                    performedBy: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
                });
                return of;
            }));
            // Generate PDF + send email outside the transaction so SMTP latency doesn't
            // hold a DB connection; email failures shouldn't roll back the state change.
            let emailWarning;
            try {
                const letterData = {
                    candidateName: offer.application.candidate.name,
                    candidateEmail: offer.application.candidate.email,
                    jobTitle: offer.application.job.title,
                    departmentName: (_c = (_b = offer.application.job.department) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : null,
                    ctc: ctcNum,
                    joinLocation: updated.joinLocation,
                    workMode: updated.workMode,
                    proposedJoinAt: updated.proposedJoinAt,
                    customNotes: updated.customNotes,
                    companyName: process.env.COMPANY_NAME || undefined,
                    companyAddress: process.env.COMPANY_ADDRESS || undefined,
                    hrName: process.env.HR_SIGNATORY_NAME || undefined,
                    hrTitle: process.env.HR_SIGNATORY_TITLE || undefined,
                };
                const pdfBuffer = yield (0, offerLetterPdf_1.generateOfferLetterPdf)(letterData);
                yield sendOfferLetterMail({
                    to: offer.application.candidate.email,
                    cc: ccList,
                    bcc: bccList,
                    candidateName: offer.application.candidate.name,
                    jobTitle: offer.application.job.title,
                    proposedJoinAt: updated.proposedJoinAt,
                    ctc: ctcNum,
                    joinLocation: updated.joinLocation,
                    pdfBuffer,
                });
            }
            catch (err) {
                console.error('[sendOffer] PDF/email failed:', err);
                emailWarning = `Offer marked as SENT but email delivery failed: ${(err === null || err === void 0 ? void 0 : err.message) || err}`;
            }
            res.json(Object.assign(Object.assign({}, updated), (emailWarning ? { emailWarning } : {})));
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
            const app = offer.application;
            const advanceReferralBonus = app.referralType === 'INTERNAL'
                && app.referrerEmployeeId
                && app.referralBonusStatus === 'NOT_APPLICABLE';
            const updated = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                const of = yield tx.offer.update({ where: { id }, data: { status: client_1.OfferStatus.SIGNED, signedAt: new Date() } });
                yield tx.application.update({
                    where: { id: offer.applicationId },
                    data: Object.assign({ status: client_1.ApplicationStatus.OFFER_ACCEPTED }, (advanceReferralBonus ? { referralBonusStatus: 'PENDING_JOIN' } : {})),
                });
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
        /**
         * GET /offers/:id/pdf
         * Streams the offer-letter PDF inline (preview) or as a download with `?download=1`.
         * Regenerates from the persisted offer fields each call — no PDF is stored on disk
         * unless you opt-in to FTP archival.
         */
        this.downloadOfferLetterPdf = asyncHandler((req, res) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            const id = Number(req.params.id);
            const offer = yield prisma.offer.findUnique({
                where: { id },
                include: {
                    application: {
                        include: {
                            candidate: true,
                            job: { include: { department: { select: { name: true } } } },
                        },
                    },
                },
            });
            if (!offer)
                return bad(res, 'Offer not found', 404);
            const pdfBuffer = yield (0, offerLetterPdf_1.generateOfferLetterPdf)({
                candidateName: offer.application.candidate.name,
                candidateEmail: offer.application.candidate.email,
                jobTitle: offer.application.job.title,
                departmentName: (_b = (_a = offer.application.job.department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
                ctc: (_c = offer.ctc) !== null && _c !== void 0 ? _c : null,
                joinLocation: (_d = offer.joinLocation) !== null && _d !== void 0 ? _d : null,
                workMode: (_e = offer.workMode) !== null && _e !== void 0 ? _e : null,
                proposedJoinAt: (_f = offer.proposedJoinAt) !== null && _f !== void 0 ? _f : null,
                customNotes: (_g = offer.customNotes) !== null && _g !== void 0 ? _g : null,
                companyName: process.env.COMPANY_NAME || undefined,
                companyAddress: process.env.COMPANY_ADDRESS || undefined,
                hrName: process.env.HR_SIGNATORY_NAME || undefined,
                hrTitle: process.env.HR_SIGNATORY_TITLE || undefined,
            });
            const safeName = offer.application.candidate.name.replace(/\s+/g, '_');
            const filename = `Offer-Letter-${safeName}.pdf`;
            const disposition = req.query.download ? 'attachment' : 'inline';
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
            res.setHeader('Content-Length', pdfBuffer.length.toString());
            res.end(pdfBuffer);
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
            // HR can pass these in the body to override the placeholder defaults.
            // All optional — defaults applied if missing.
            const { dob, gender, employeeType, branchId, roleId, reportingManager, bloodGroup, age, } = req.body || {};
            // Validate dob if provided
            let parsedDob = null;
            if (dob) {
                parsedDob = new Date(dob);
                if (isNaN(parsedDob.getTime())) {
                    return bad(res, 'Invalid dob');
                }
                if (parsedDob > new Date()) {
                    return bad(res, 'dob cannot be in the future');
                }
            }
            // Validate gender if provided
            const validGenders = ['MALE', 'FEMALE', 'OTHER'];
            if (gender && !validGenders.includes(String(gender).toUpperCase())) {
                return bad(res, `gender must be one of ${validGenders.join(', ')}`);
            }
            // bgvOverride lets a senior HR user knowingly bypass the BGV gate when
            // BGV is FAILED or still IN_PROGRESS. Override is logged on the application
            // audit trail so the decision is traceable.
            const bgvOverride = !!(req.body || {}).bgvOverride;
            const bgvOverrideReason = (req.body || {}).bgvOverrideReason;
            const offer = yield prisma.offer.findUnique({
                where: { id },
                include: {
                    application: {
                        include: { candidate: true, job: true, bgv: true }
                    }
                }
            });
            if (!offer)
                return bad(res, 'Offer not found', 404);
            // Don't allow re-marking if already done (avoids duplicate Employee rows)
            if (offer.joinOutcome === client_1.JoinOutcome.JOINED) {
                return bad(res, 'This offer is already marked as joined');
            }
            // BGV gate — refuse to mark joined when BGV is FAILED or still in progress
            // unless the caller explicitly overrides with a reason.
            const bgv = offer.application.bgv;
            if (bgv && (bgv.status === 'FAILED' || bgv.status === 'IN_PROGRESS' || bgv.status === 'FLAGGED')) {
                if (!bgvOverride) {
                    return bad(res, `Cannot mark joined — BGV status is ${bgv.status}. ` +
                        `Resolve the BGV first, or pass { bgvOverride: true, bgvOverrideReason: '...' } to bypass.`);
                }
                if (!bgvOverrideReason || !bgvOverrideReason.trim()) {
                    return bad(res, 'bgvOverrideReason is required when bypassing the BGV gate');
                }
            }
            const updated = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c, _d, _e, _f;
                // 1. Update offer + application
                const of = yield tx.offer.update({
                    where: { id },
                    data: { joinOutcome: client_1.JoinOutcome.JOINED }
                });
                yield tx.application.update({
                    where: { id: offer.applicationId },
                    data: { status: client_1.ApplicationStatus.HIRED }
                });
                yield logApplicationAction(tx, offer.applicationId, 'CANDIDATE_JOINED', {
                    fromStatus: offer.application.status,
                    toStatus: client_1.ApplicationStatus.HIRED,
                    note: `Marked joined; offer #${id}`,
                    performedBy: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null,
                });
                // Audit any BGV-gate override so the decision is traceable forever.
                if (bgv && bgvOverride) {
                    yield logApplicationAction(tx, offer.applicationId, 'BGV_GATE_OVERRIDDEN', {
                        note: `Joined despite BGV=${bgv.status}. Reason: ${bgvOverrideReason}`,
                        performedBy: (_d = (_c = req.user) === null || _c === void 0 ? void 0 : _c.empId) !== null && _d !== void 0 ? _d : null,
                    });
                }
                // 2. Auto-create Employee if not already exists
                const { candidate, job } = offer.application;
                // Race-safe code generation inside the SAME transaction
                const employeeCode = yield generateEmployeeCode(tx);
                // 🔹 STEP 1: resolve designation
                const designationName = ((_e = job.title) === null || _e === void 0 ? void 0 : _e.trim()) || 'Employee';
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
                // Resolve gender enum value safely
                const genderValue = gender
                    ? (_f = client_1.Gender[String(gender).toUpperCase()]) !== null && _f !== void 0 ? _f : client_1.Gender.OTHER
                    : client_1.Gender.OTHER;
                const employee = yield tx.employee.create({
                    data: {
                        employeeCode,
                        referenceCode: null,
                        firstName: candidate.name.split(" ")[0],
                        lastName: candidate.name.split(" ").slice(1).join(" ") || "",
                        gender: genderValue,
                        // dob: caller-supplied or null sentinel "unknown" (1970-01-01) so it's
                        // obvious this needs to be filled in by HR later. NEVER use a fake DOB
                        // that looks plausible (like 2000-01-01).
                        dob: parsedDob !== null && parsedDob !== void 0 ? parsedDob : new Date("1970-01-01"),
                        photoUrl: null,
                        phone: candidate.phone || "",
                        email: candidate.email,
                        departmentId: job.departmentId,
                        designationId: designation.id,
                        branchId: Number(branchId) || RECRUITING_DEFAULTS.defaultBranchId,
                        dateOfJoining: offer.proposedJoinAt || new Date(),
                        employmentType: client_1.EmploymentType.PERMANENT,
                        employmentStatus: client_1.EmploymentStatus.ACTIVE,
                        // Caller can pass employeeType ("CLINICAL" / "NONCLINICAL" / etc.)
                        // — falls back to a sensible default if not provided.
                        employeeType: employeeType ? String(employeeType).toUpperCase() : "NONCLINICAL",
                        roleId: Number(roleId) || RECRUITING_DEFAULTS.defaultEmployeeRoleId,
                        reportingManager: reportingManager ? Number(reportingManager) : null,
                        age: age ? Number(age) : null,
                        bloodGroup: bloodGroup ? String(bloodGroup) : null,
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
            var _a, _b, _c, _d;
            const applicationId = Number(req.params.id);
            const { testId, testDate, deadlineDate, assignedBy } = req.body || {};
            if (!testId)
                return res.status(400).json({ error: 'testId is required' });
            // ── Validate test/deadline dates ────────────────────────────────
            const now = new Date();
            let parsedTestDate = null;
            let parsedDeadline = null;
            if (testDate) {
                parsedTestDate = new Date(testDate);
                if (isNaN(parsedTestDate.getTime())) {
                    return res.status(400).json({ error: 'Invalid testDate' });
                }
                if (parsedTestDate < new Date(now.getTime() - 5 * 60 * 1000)) {
                    return res.status(400).json({ error: 'testDate cannot be in the past' });
                }
            }
            if (deadlineDate) {
                parsedDeadline = new Date(deadlineDate);
                if (isNaN(parsedDeadline.getTime())) {
                    return res.status(400).json({ error: 'Invalid deadlineDate' });
                }
                if (parsedDeadline < now) {
                    return res.status(400).json({ error: 'deadlineDate cannot be in the past' });
                }
                if (parsedTestDate && parsedDeadline < parsedTestDate) {
                    return res.status(400).json({ error: 'deadlineDate must be on/after testDate' });
                }
            }
            const app = yield prisma.application.findUnique({
                where: { id: applicationId },
                include: { candidate: true },
            });
            if (!app)
                return res.status(404).json({ error: 'Application not found' });
            // Generate a secure random one-time password for first-time candidates.
            // The plain value is emailed once and never stored in plaintext.
            let plainPasswordForEmail = null;
            if (!app.candidate.passwordHash) {
                plainPasswordForEmail = generateRandomPassword(10);
                const hash = yield bcryptjs_1.default.hash(plainPasswordForEmail, 10);
                yield prisma.candidate.update({
                    where: { id: app.candidateId },
                    data: { passwordHash: hash },
                });
            }
            const assigned = yield prisma.candidateAssignedTest.create({
                data: {
                    applicationId,
                    candidateId: app.candidateId,
                    testId: Number(testId),
                    assignedBy: assignedBy || 0, // adjust to your auth
                    testDate: parsedTestDate,
                    deadlineDate: parsedDeadline,
                    status: 'NotStarted',
                },
            });
            // optional: create an Interview round ("Test")
            let interview = null;
            if (parsedTestDate) {
                const start = new Date(parsedTestDate);
                const end = new Date(parsedTestDate);
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
            // Notify candidate (and surface their login if first-time)
            let mailStatus = "skipped";
            let mailError;
            if (app.candidate.email) {
                try {
                    const test = yield prisma.evaluationTest.findUnique({
                        where: { id: Number(testId) },
                        select: { name: true, duration: true, passingPercent: true },
                    });
                    yield sendCandidateTestMail({
                        to: app.candidate.email,
                        candidateName: app.candidate.name,
                        testName: (_a = test === null || test === void 0 ? void 0 : test.name) !== null && _a !== void 0 ? _a : 'Assessment',
                        duration: (_b = test === null || test === void 0 ? void 0 : test.duration) !== null && _b !== void 0 ? _b : 0,
                        passingPercent: (_c = test === null || test === void 0 ? void 0 : test.passingPercent) !== null && _c !== void 0 ? _c : 0,
                        deadlineDate: parsedDeadline !== null && parsedDeadline !== void 0 ? parsedDeadline : null,
                        loginEmail: app.candidate.email,
                        // Only sent on first-time assign — null on subsequent assigns
                        firstTimePassword: plainPasswordForEmail,
                        portalUrl: (_d = process.env.CANDIDATE_PORTAL_URL) !== null && _d !== void 0 ? _d : '',
                    });
                    mailStatus = "sent";
                }
                catch (e) {
                    mailStatus = "failed";
                    mailError = (e === null || e === void 0 ? void 0 : e.message) || 'email send failed';
                    console.error('[assignTestToApplication] candidate email failed:', e);
                }
            }
            res.json({ assigned, interview, mailStatus, mailError });
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
            // Pull `maxAttempts` in the same SELECT so we don't need a second query per row
            const rows = yield prisma.candidateAssignedTest.findMany({
                where: { candidateId },
                include: {
                    test: {
                        select: {
                            id: true, name: true, duration: true, passingPercent: true,
                            randomization: true, maxAttempts: true,
                        },
                    },
                },
                orderBy: { assignedAt: 'desc' },
            });
            const out = rows.map((r) => {
                var _a, _b, _c;
                return (Object.assign(Object.assign({}, r), { canStart: ((_b = (_a = r.test) === null || _a === void 0 ? void 0 : _a.maxAttempts) !== null && _b !== void 0 ? _b : 1) > ((_c = r.attempts) !== null && _c !== void 0 ? _c : 0) &&
                        r.status !== 'Completed' &&
                        r.status !== 'Cancelled' }));
            });
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
            // Reject submission past the deadline (small grace window for clock skew)
            if (assigned.deadlineDate && new Date() > new Date(assigned.deadlineDate.getTime() + 5 * 60 * 1000)) {
                return res.status(400).json({
                    error: 'Submission window has closed',
                    deadline: assigned.deadlineDate,
                });
            }
            // Block resubmission once already completed
            if (assigned.status === 'Completed') {
                return res.status(400).json({ error: 'This test has already been submitted' });
            }
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
    var _a, _b;
    const interviewId = Number(req.params.id);
    // NEW: take panelId from the client (e.g., from localStorage on the frontend)
    const panelId = Number(req.body.panelId);
    if (!Number.isFinite(panelId)) {
        return bad(res, 'panelId (number) is required', 400);
    }
    const { name, designation, jobSkills, jobKnowledge, attitude, communication, notes, signature, submit } = req.body;
    // Fetch interview & authorize: panelId must belong to this interview
    const itv = yield prisma.interview.findUnique({
        where: { id: interviewId },
        include: {
            panel: { select: { employeeId: true } },
            application: { include: { candidate: true } },
        },
    });
    if (!itv)
        return bad(res, 'Interview not found', 404);
    // Read panel via junction-first helper (falls back to legacy CSV automatically)
    const allowedPanelIds = readInterviewPanelIds(itv);
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
    if (submit) {
        const candidateName = ((_b = (_a = itv.application) === null || _a === void 0 ? void 0 : _a.candidate) === null || _b === void 0 ? void 0 : _b.name) || 'Candidate';
        // get panel member name from Employee
        const panelEmp = yield prisma.employee.findUnique({
            where: { id: panelId },
            select: { firstName: true, lastName: true }
        });
        const panelName = panelEmp
            ? `${panelEmp.firstName} ${panelEmp.lastName}`
            : name || `Panel #${panelId}`;
        // fetch HR employees
        const hrUsers = yield prisma.employee.findMany({
            where: {
                departmentId: RECRUITING_DEFAULTS.hrDepartmentId,
                roleId: RECRUITING_DEFAULTS.defaultHrRoleId,
                employmentStatus: 'ACTIVE'
            },
            select: { id: true }
        });
        const hrIds = hrUsers.map(u => u.id);
        if (hrIds.length) {
            for (const hrId of hrIds) {
                yield (0, notifications_controller_1.createNotification)(hrId, `${panelName} submitted interview feedback for ${candidateName}.`);
            }
        }
    }
    res.json(fb);
}));
/**
 * Generate the next employee code (e.g. EMP015).
 *
 * Race-safe: must be called inside a Prisma transaction. Reads + retry-creates
 * within the same transaction client so two parallel hires can't produce
 * duplicate codes. On unique-key violation (P2002) we re-read max and bump.
 */
/**
 * Cron-callable: mark unsigned offers as EXPIRED once their `proposedJoinAt`
 * has passed. Safe to call repeatedly. Returns the number of expired rows.
 *
 * Wire this up in your scheduler (e.g. node-cron) to run daily:
 *
 *   import cron from "node-cron";
 *   import { expireStaleOffers } from "./api/recruiting/recruiting.controller";
 *   cron.schedule("0 2 * * *", () => expireStaleOffers().catch(console.error));
 */
function expireStaleOffers() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        // Eligible: SENT or VIEWED (not yet signed/declined/withdrawn) AND
        // proposed-join date has already passed.
        const result = yield prisma.offer.updateMany({
            where: {
                status: { in: [client_1.OfferStatus.SENT, client_1.OfferStatus.VIEWED] },
                proposedJoinAt: { not: null, lt: now },
            },
            data: { status: client_1.OfferStatus.EXPIRED },
        });
        if (result.count > 0) {
            console.log(`[expireStaleOffers] expired ${result.count} stale offer(s)`);
        }
        return { expired: result.count };
    });
}
// ───────────────────────────────────────────────────────────────────
// Recruitment: Consent / References / BGV / Referral-bonus exports
// ───────────────────────────────────────────────────────────────────
/**
 * POST /applications/:id/consent  { type: 'REFERENCES' | 'BGV' | 'BOTH' }
 * Records the candidate's DPDP-Act consent before HR contacts referees /
 * initiates background verification. Idempotent — repeated calls just
 * refresh the timestamp.
 */
exports.recordConsent = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const applicationId = Number(req.params.id);
    const { type } = req.body || {};
    if (!['REFERENCES', 'BGV', 'BOTH'].includes(String(type))) {
        return bad(res, "type must be 'REFERENCES', 'BGV', or 'BOTH'");
    }
    const now = new Date();
    const data = {};
    if (type === 'REFERENCES' || type === 'BOTH')
        data.referencesConsentAt = now;
    if (type === 'BGV' || type === 'BOTH')
        data.bgvConsentAt = now;
    const updated = yield prisma.application.update({
        where: { id: applicationId },
        data,
        select: { id: true, referencesConsentAt: true, bgvConsentAt: true },
    });
    res.json(updated);
}));
// ─── References ────────────────────────────────────────────────────
/** GET /applications/:id/references */
exports.listReferences = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const applicationId = Number(req.params.id);
    const rows = yield prisma.candidateReference.findMany({
        where: { applicationId },
        orderBy: { createdAt: 'asc' },
    });
    res.json(rows);
}));
/** POST /applications/:id/references — body matches CandidateReference fields */
exports.addReference = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const applicationId = Number(req.params.id);
    const { refereeName, refereeRelation, refereeCompany, refereeEmail, refereePhone } = req.body || {};
    if (!refereeName)
        return bad(res, 'refereeName required');
    if (!refereeRelation)
        return bad(res, 'refereeRelation required');
    const row = yield prisma.candidateReference.create({
        data: {
            applicationId, refereeName, refereeRelation,
            refereeCompany: refereeCompany !== null && refereeCompany !== void 0 ? refereeCompany : null,
            refereeEmail: refereeEmail !== null && refereeEmail !== void 0 ? refereeEmail : null,
            refereePhone: refereePhone !== null && refereePhone !== void 0 ? refereePhone : null,
        },
    });
    res.status(201).json(row);
}));
/** PATCH /references/:id — edit referee details (only while PENDING) */
exports.updateReference = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = Number(req.params.id);
    const existing = yield prisma.candidateReference.findUnique({ where: { id } });
    if (!existing)
        return bad(res, 'Reference not found', 404);
    if (existing.checkStatus !== 'PENDING') {
        return bad(res, 'Cannot edit referee details after the check has started');
    }
    const { refereeName, refereeRelation, refereeCompany, refereeEmail, refereePhone } = req.body || {};
    const row = yield prisma.candidateReference.update({
        where: { id },
        data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (refereeName !== undefined ? { refereeName } : {})), (refereeRelation !== undefined ? { refereeRelation } : {})), (refereeCompany !== undefined ? { refereeCompany } : {})), (refereeEmail !== undefined ? { refereeEmail } : {})), (refereePhone !== undefined ? { refereePhone } : {})),
    });
    res.json(row);
}));
/** DELETE /references/:id */
exports.deleteReference = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = Number(req.params.id);
    yield prisma.candidateReference.delete({ where: { id } });
    res.json({ ok: true });
}));
/**
 * POST /references/:id/check  { status, feedback?, rating? }
 * HR records the outcome of contacting the referee.
 */
exports.recordReferenceCheck = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const id = Number(req.params.id);
    const { status, feedback, rating } = req.body || {};
    const VALID = ['PENDING', 'IN_PROGRESS', 'DONE', 'UNREACHABLE', 'FLAGGED'];
    if (!VALID.includes(String(status)))
        return bad(res, `status must be one of ${VALID.join(',')}`);
    const ref = yield prisma.candidateReference.findUnique({
        where: { id }, include: { application: true },
    });
    if (!ref)
        return bad(res, 'Reference not found', 404);
    if (!ref.application.referencesConsentAt) {
        return bad(res, 'Candidate consent for reference checks has not been recorded');
    }
    const ratingNum = rating !== undefined && rating !== null && rating !== '' ? Number(rating) : null;
    if (ratingNum !== null && (Number.isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5)) {
        return bad(res, 'rating must be a number 1-5');
    }
    const updated = yield prisma.candidateReference.update({
        where: { id },
        data: {
            checkStatus: status,
            feedback: feedback !== null && feedback !== void 0 ? feedback : ref.feedback,
            rating: ratingNum !== null && ratingNum !== void 0 ? ratingNum : ref.rating,
            checkedBy: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
            checkedAt: status === 'PENDING' ? null : new Date(),
        },
    });
    res.json(updated);
}));
// ─── Background Verification ───────────────────────────────────────
const DEFAULT_BGV_CHECK_TYPES = [
    'IDENTITY', 'EDUCATION', 'EMPLOYMENT', 'ADDRESS', 'CRIMINAL',
];
/**
 * POST /applications/:id/bgv  { vendor?, vendorRef?, checkTypes?: string[] }
 * Initiates background verification. Creates the BGV row + a default set of
 * checks (one per type). Idempotent: returns existing BGV if already started.
 */
exports.initiateBgv = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const applicationId = Number(req.params.id);
    const { vendor, vendorRef, checkTypes } = req.body || {};
    const app = yield prisma.application.findUnique({ where: { id: applicationId } });
    if (!app)
        return bad(res, 'Application not found', 404);
    if (!app.bgvConsentAt)
        return bad(res, 'Candidate consent for BGV has not been recorded');
    const existing = yield prisma.backgroundVerification.findUnique({
        where: { applicationId },
        include: { checks: true, documents: true },
    });
    if (existing)
        return res.json(existing);
    const types = Array.isArray(checkTypes) && checkTypes.length
        ? checkTypes : DEFAULT_BGV_CHECK_TYPES;
    const VALID_TYPES = ['EDUCATION', 'EMPLOYMENT', 'CRIMINAL', 'ADDRESS', 'IDENTITY', 'DRUG', 'REFERENCE', 'CREDIT'];
    for (const t of types) {
        if (!VALID_TYPES.includes(t))
            return bad(res, `Invalid check type ${t}`);
    }
    const bgv = yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const row = yield tx.backgroundVerification.create({
            data: {
                applicationId,
                status: 'IN_PROGRESS',
                vendor: vendor !== null && vendor !== void 0 ? vendor : 'Internal HR',
                vendorRef: vendorRef !== null && vendorRef !== void 0 ? vendorRef : null,
                initiatedBy: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
                initiatedAt: new Date(),
                checks: { create: types.map((type) => ({ type })) },
            },
            include: { checks: true, documents: true },
        });
        yield logApplicationAction(tx, applicationId, 'BGV_INITIATED', {
            note: `BGV started with ${types.length} check(s) [${types.join(', ')}]`,
            performedBy: (_d = (_c = req.user) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null,
        });
        return row;
    }));
    res.status(201).json(bgv);
}));
/** GET /applications/:id/bgv */
exports.getBgv = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const applicationId = Number(req.params.id);
    const bgv = yield prisma.backgroundVerification.findUnique({
        where: { applicationId },
        include: {
            checks: { orderBy: { type: 'asc' } },
            documents: { orderBy: { receivedAt: 'desc' } },
        },
    });
    if (!bgv)
        return res.json(null);
    res.json(bgv);
}));
/**
 * PATCH /bgv/:bgvId/checks/:checkId  { status, evidenceUrl?, note? }
 * HR updates a single check.
 */
exports.updateBgvCheck = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const bgvId = Number(req.params.bgvId);
    const checkId = Number(req.params.checkId);
    const { status, evidenceUrl, note } = req.body || {};
    const VALID = ['PENDING', 'CLEAR', 'DISCREPANCY', 'DISCREPANCY_RESOLVED', 'FAILED', 'SKIPPED'];
    if (status && !VALID.includes(String(status))) {
        return bad(res, `status must be one of ${VALID.join(',')}`);
    }
    const check = yield prisma.bgvCheck.findUnique({ where: { id: checkId } });
    if (!check || check.bgvId !== bgvId)
        return bad(res, 'Check not found', 404);
    const updated = yield prisma.bgvCheck.update({
        where: { id: checkId },
        data: Object.assign(Object.assign(Object.assign({}, (status !== undefined ? { status } : {})), (evidenceUrl !== undefined ? { evidenceUrl } : {})), (note !== undefined ? { note } : {})),
    });
    res.json(updated);
}));
/**
 * POST /bgv/:bgvId/checks/:checkId/resolve  { resolutionNote }
 * Marks a DISCREPANCY check as DISCREPANCY_RESOLVED with audit trail.
 */
exports.resolveBgvDiscrepancy = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const bgvId = Number(req.params.bgvId);
    const checkId = Number(req.params.checkId);
    const { resolutionNote } = req.body || {};
    if (!resolutionNote)
        return bad(res, 'resolutionNote required');
    const check = yield prisma.bgvCheck.findUnique({ where: { id: checkId } });
    if (!check || check.bgvId !== bgvId)
        return bad(res, 'Check not found', 404);
    if (check.status !== 'DISCREPANCY') {
        return bad(res, `Cannot resolve a check in status ${check.status}`);
    }
    const updated = yield prisma.bgvCheck.update({
        where: { id: checkId },
        data: {
            status: 'DISCREPANCY_RESOLVED',
            resolutionNote,
            resolvedBy: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
            resolvedAt: new Date(),
        },
    });
    res.json(updated);
}));
/**
 * POST /bgv/:id/complete  { reportUrl?, overallNote? }
 * Recomputes overall BGV status from individual checks:
 *   - any FAILED       → FAILED
 *   - any DISCREPANCY  → FLAGGED
 *   - all CLEAR/DISCREPANCY_RESOLVED/SKIPPED → CLEAR
 *   - otherwise        → IN_PROGRESS (caller is told to wait)
 */
exports.completeBgv = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const id = Number(req.params.id);
    const { reportUrl, overallNote } = req.body || {};
    const bgv = yield prisma.backgroundVerification.findUnique({
        where: { id }, include: { checks: true },
    });
    if (!bgv)
        return bad(res, 'BGV not found', 404);
    const statuses = bgv.checks.map((c) => c.status);
    let overall;
    if (statuses.includes('FAILED'))
        overall = 'FAILED';
    else if (statuses.includes('DISCREPANCY'))
        overall = 'FLAGGED';
    else if (statuses.every((s) => s === 'CLEAR' || s === 'DISCREPANCY_RESOLVED' || s === 'SKIPPED'))
        overall = 'CLEAR';
    else
        return bad(res, 'Some checks are still PENDING — cannot finalise BGV yet');
    const updated = yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const row = yield tx.backgroundVerification.update({
            where: { id },
            data: {
                status: overall,
                completedAt: new Date(),
                reportUrl: reportUrl !== null && reportUrl !== void 0 ? reportUrl : bgv.reportUrl,
                overallNote: overallNote !== null && overallNote !== void 0 ? overallNote : bgv.overallNote,
            },
        });
        yield logApplicationAction(tx, bgv.applicationId, `BGV_${overall}`, {
            note: overallNote !== null && overallNote !== void 0 ? overallNote : `BGV finalised as ${overall}`,
            performedBy: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
        });
        return row;
    }));
    res.json(updated);
}));
/** POST /bgv/:id/documents  { docType, fileName, fileUrl } */
exports.addBgvDocument = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const bgvId = Number(req.params.id);
    const { docType, fileName, fileUrl } = req.body || {};
    if (!docType || !fileName || !fileUrl) {
        return bad(res, 'docType, fileName and fileUrl are required');
    }
    const bgv = yield prisma.backgroundVerification.findUnique({ where: { id: bgvId } });
    if (!bgv)
        return bad(res, 'BGV not found', 404);
    const doc = yield prisma.bgvDocument.create({
        data: {
            bgvId, docType, fileName, fileUrl,
            uploadedBy: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
        },
    });
    res.status(201).json(doc);
}));
/** GET /bgv/:id/documents */
exports.listBgvDocuments = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const bgvId = Number(req.params.id);
    const rows = yield prisma.bgvDocument.findMany({
        where: { bgvId }, orderBy: { receivedAt: 'desc' },
    });
    res.json(rows);
}));
/** DELETE /bgv/documents/:docId */
exports.deleteBgvDocument = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const docId = Number(req.params.docId);
    yield prisma.bgvDocument.delete({ where: { id: docId } });
    res.json({ ok: true });
}));
// ─── Referral-bonus eligibility cron ───────────────────────────────
/**
 * processReferralBonusEligibility — run daily.
 * Walks two pots:
 *   1. PENDING_JOIN apps where the candidate has actually JOINED → flip to PENDING_PROBATION
 *      (with the new employee's `dateOfJoining` as the start of the probation clock).
 *   2. PENDING_PROBATION apps whose probation window (env REFERRAL_PROBATION_DAYS,
 *      default 90) has elapsed → flip to ELIGIBLE (HR can then mark PAID manually).
 *
 * Idempotent — safe to call multiple times.
 */
function processReferralBonusEligibility() {
    return __awaiter(this, void 0, void 0, function* () {
        const probationDays = parseInt(process.env.REFERRAL_PROBATION_DAYS || '90', 10);
        // Pot 1: candidate joined → start probation clock
        const pendingJoin = yield prisma.application.findMany({
            where: {
                referralType: 'INTERNAL',
                referralBonusStatus: 'PENDING_JOIN',
                status: 'HIRED',
            },
            select: { id: true },
        });
        let joinedCount = 0;
        for (const a of pendingJoin) {
            yield prisma.application.update({
                where: { id: a.id },
                data: { referralBonusStatus: 'PENDING_PROBATION' },
            });
            joinedCount++;
        }
        // Pot 2: probation elapsed → eligible
        const cutoff = new Date(Date.now() - probationDays * 24 * 60 * 60 * 1000);
        const pendingProbation = yield prisma.application.findMany({
            where: {
                referralType: 'INTERNAL',
                referralBonusStatus: 'PENDING_PROBATION',
                status: 'HIRED',
                // Use the offer's signedAt as a proxy for join date — simpler than joining
                // the Employee table here; HR can override on the UI if needed.
                offer: { signedAt: { lt: cutoff } },
            },
            select: { id: true },
        });
        let eligibleCount = 0;
        for (const a of pendingProbation) {
            yield prisma.application.update({
                where: { id: a.id },
                data: { referralBonusStatus: 'ELIGIBLE' },
            });
            eligibleCount++;
        }
        if (joinedCount || eligibleCount) {
            console.log(`[referralBonus] joined→probation=${joinedCount}, probation→eligible=${eligibleCount}`);
        }
        return { joined: joinedCount, eligible: eligibleCount };
    });
}
/** POST /applications/:id/referral-bonus  { status, amount?, note? } — manual HR action */
exports.updateReferralBonus = asyncHandler((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const applicationId = Number(req.params.id);
    const { status, amount, note } = req.body || {};
    const VALID = ['NOT_APPLICABLE', 'PENDING_JOIN', 'PENDING_PROBATION', 'ELIGIBLE', 'PAID', 'FORFEITED'];
    if (status && !VALID.includes(String(status))) {
        return bad(res, `status must be one of ${VALID.join(',')}`);
    }
    const data = {};
    if (status !== undefined)
        data.referralBonusStatus = status;
    if (amount !== undefined && amount !== null && amount !== '') {
        const n = Number(amount);
        if (Number.isNaN(n))
            return bad(res, 'amount must be a number');
        data.referralBonusAmount = n;
    }
    if (note !== undefined)
        data.referralBonusNote = note;
    if (status === 'PAID')
        data.referralBonusPaidAt = new Date();
    const updated = yield prisma.application.update({
        where: { id: applicationId }, data,
    });
    res.json(updated);
}));
function generateEmployeeCode() {
    return __awaiter(this, arguments, void 0, function* (tx = prisma) {
        const prefix = process.env.EMPLOYEE_CODE_PREFIX || 'EMP';
        const startNumber = parseInt(process.env.EMPLOYEE_CODE_START || '1', 10);
        // Find the highest existing numeric suffix among employee codes that
        // start with our prefix. Doing this inside the same `tx` ensures we
        // see uncommitted inserts from concurrent hires.
        const all = yield tx.employee.findMany({
            where: { employeeCode: { startsWith: prefix } },
            select: { employeeCode: true },
        });
        let maxNum = startNumber - 1;
        for (const e of all) {
            const numPart = parseInt((e.employeeCode || '').replace(/\D/g, ''), 10);
            if (Number.isFinite(numPart) && numPart > maxNum)
                maxNum = numPart;
        }
        return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
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
    const empId = Number(employeeId);
    if (!Number.isFinite(empId)) {
        return res.status(400).json({ error: 'employeeId must be a number' });
    }
    // Match interviews where this employee is on the panel — junction-first,
    // legacy-CSV fallback to catch any rows that haven't been backfilled.
    const all = yield prisma.interview.findMany({
        where: {
            OR: [
                { panel: { some: { employeeId: empId } } },
                // Legacy CSV — still buggy on its own (could match "13" via "3"),
                // so we re-filter with an exact-match check below.
                { panelUserIds: { contains: empId.toString() } },
            ],
        },
        orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
        include: {
            panel: { select: { employeeId: true } },
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
                            resumeUrl: true
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
    // Exact-match re-filter to drop false positives from the legacy CSV branch
    const items = all.filter((i) => readInterviewPanelIds(i).includes(empId));
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
// ─────────────────────────────────────────────────────────────────────
// Random password generator for first-time candidate logins.
// 10 chars, mixed alphanumeric, no ambiguous chars (no I/l/O/0/1).
// ─────────────────────────────────────────────────────────────────────
function generateRandomPassword(length = 10) {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < length; i++) {
        out += charset[Math.floor(Math.random() * charset.length)];
    }
    return out;
}
// ─────────────────────────────────────────────────────────────────────
// Email candidate when a test is assigned to them.
// Includes test details + (only on first-time) their portal credentials.
// ─────────────────────────────────────────────────────────────────────
function sendCandidateTestMail(props) {
    return __awaiter(this, void 0, void 0, function* () {
        const { to, candidateName, testName, duration, passingPercent, deadlineDate, loginEmail, firstTimePassword, portalUrl, } = props;
        const deadlineStr = deadlineDate
            ? new Date(deadlineDate).toLocaleString()
            : "No specific deadline";
        const credentialsBlock = firstTimePassword
            ? `
Your candidate portal login (please change after first login):
  Email:    ${loginEmail}
  Password: ${firstTimePassword}

Portal: ${portalUrl || '[contact HR for the link]'}
`
            : "";
        const text = `
Hi ${candidateName},

You have been assigned a new assessment as part of your application.

Test: ${testName}
Duration: ${duration} minutes
Passing score: ${passingPercent}%
Deadline: ${deadlineStr}
${credentialsBlock}
Please log in and complete the test before the deadline.

Best regards,
HR Team
`;
        const credsHtml = firstTimePassword
            ? `
<h3>🔐 Candidate Portal Login</h3>
<ul>
  <li><b>Email:</b> ${loginEmail}</li>
  <li><b>Password:</b> ${firstTimePassword}</li>
</ul>
<p><i>This is a one-time password — please change it after your first login.</i></p>
${portalUrl ? `<p><a href="${portalUrl}" target="_blank">Open candidate portal</a></p>` : ""}
`
            : "";
        const html = `
<h2>New Assessment Assigned</h2>
<p>Hi <b>${candidateName}</b>,</p>
<p>You have been assigned a new assessment as part of your application.</p>

<h3>📝 Test Details</h3>
<ul>
  <li><b>Test:</b> ${testName}</li>
  <li><b>Duration:</b> ${duration} minutes</li>
  <li><b>Passing score:</b> ${passingPercent}%</li>
  <li><b>Deadline:</b> ${deadlineStr}</li>
</ul>

${credsHtml}

<p>Please log in and complete the test before the deadline.</p>

<br>
<p>Best regards,<br>HR Team</p>
`;
        yield transporter.sendMail({
            from: process.env.SMTP_USER,
            to,
            subject: `Assessment Assigned – ${testName}`,
            text,
            html,
        });
    });
}
/**
 * Send the generated offer letter PDF to the candidate (with optional
 * CC / BCC recipients). The PDF buffer is attached as `Offer-Letter-<name>.pdf`.
 *
 * Caller is responsible for generating the PDF — keeping these concerns
 * separate so the same PDF can be downloaded via GET /offers/:id/pdf without
 * re-sending an email.
 */
function sendOfferLetterMail(props) {
    return __awaiter(this, void 0, void 0, function* () {
        const { to, cc, bcc, candidateName, jobTitle, proposedJoinAt, ctc, joinLocation, pdfBuffer, filename, } = props;
        const joinStr = proposedJoinAt
            ? new Date(proposedJoinAt).toLocaleDateString("en-IN", {
                year: "numeric", month: "long", day: "numeric",
            })
            : "the date discussed";
        const ctcStr = typeof ctc === "number"
            ? new Intl.NumberFormat("en-IN", {
                style: "currency", currency: "INR", maximumFractionDigits: 0,
            }).format(ctc)
            : null;
        const text = `
Dear ${candidateName},

Congratulations! We are pleased to extend an offer for the position of ${jobTitle}.

Proposed join date: ${joinStr}${joinLocation ? `\nJoining location: ${joinLocation}` : ""}${ctcStr ? `\nAnnual CTC: ${ctcStr}` : ""}

Please find your detailed offer letter attached. Kindly review it and confirm
your acceptance through the candidate portal at the earliest.

We look forward to welcoming you to the team.

Best regards,
HR Team
`;
        const html = `
<h2 style="color:#1f3a93;">Offer of Employment</h2>
<p>Dear <b>${candidateName}</b>,</p>
<p>Congratulations! We are pleased to extend an offer for the position of
<b>${jobTitle}</b>.</p>

<table style="border-collapse:collapse;font-size:14px;margin:12px 0;">
  <tr><td style="padding:4px 12px 4px 0;"><b>Proposed join date:</b></td><td>${joinStr}</td></tr>
  ${joinLocation ? `<tr><td style="padding:4px 12px 4px 0;"><b>Joining location:</b></td><td>${joinLocation}</td></tr>` : ""}
  ${ctcStr ? `<tr><td style="padding:4px 12px 4px 0;"><b>Annual CTC:</b></td><td>${ctcStr}</td></tr>` : ""}
</table>

<p>Please find your detailed offer letter attached as a PDF. Kindly review it
and confirm your acceptance through the candidate portal at the earliest.</p>

<p>We look forward to welcoming you to the team.</p>

<br>
<p>Best regards,<br>HR Team</p>
`;
        yield transporter.sendMail({
            from: process.env.SMTP_USER,
            to,
            cc: cc && cc.length ? cc : undefined,
            bcc: bcc && bcc.length ? bcc : undefined,
            subject: `Offer of Employment – ${jobTitle}`,
            text,
            html,
            attachments: [
                {
                    filename: filename || `Offer-Letter-${candidateName.replace(/\s+/g, "_")}.pdf`,
                    content: pdfBuffer,
                    contentType: "application/pdf",
                },
            ],
        });
    });
}
