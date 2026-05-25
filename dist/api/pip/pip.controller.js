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
exports.getPIPResponses = exports.acknowledgeResponse = exports.logManualResponse = exports.respondViaToken = exports.getEmployeePIPHistory = exports.getEmailLogs = exports.terminatePIP = exports.extendPIP = exports.closePIP = exports.addWeeklyReview = exports.getPIPDetail = exports.getPIPList = exports.initiatePIP = exports.sendWarning = exports.previewEmail = exports.getUnderperformers = exports.seedDefaultTemplates = exports.deleteTemplate = exports.updateTemplate = exports.createTemplate = exports.getTemplates = void 0;
const prisma_1 = require("../../lib/prisma");
const nodemailer_1 = __importDefault(require("nodemailer"));
const crypto_1 = __importDefault(require("crypto"));
// ── Email transporter (reuse existing SMTP config) ──────────────────────────
const transporter = nodemailer_1.default.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});
// ── Helpers ──────────────────────────────────────────────────────────────────
function fillPlaceholders(template, data) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => { var _a; return (_a = data[key]) !== null && _a !== void 0 ? _a : `{{${key}}}`; });
}
function formatDate(date) {
    if (!date)
        return "—";
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
/** Indian labour law: notice period based on years of service */
function getNoticePeriodDays(dateOfJoining) {
    const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
    const years = (Date.now() - dateOfJoining.getTime()) / msPerYear;
    if (years < 1)
        return 30;
    if (years < 3)
        return 45;
    return 60;
}
function generateResponseToken() {
    return crypto_1.default.randomBytes(24).toString("hex");
}
function generatePipNumber(employeeCode, year) {
    return __awaiter(this, void 0, void 0, function* () {
        const prefix = `PIP-${employeeCode}-${year}`;
        const count = yield prisma_1.prisma.employeePIP.count({
            where: { pipNumber: { startsWith: prefix } },
        });
        const seq = String(count + 1).padStart(3, "0");
        return `${prefix}-${seq}`;
    });
}
function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}
function buildPlaceholderData(emp, pip, extras = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const noticeDays = emp.dateOfJoining
        ? getNoticePeriodDays(new Date(emp.dateOfJoining))
        : 30;
    const lastWorkingDay = (pip === null || pip === void 0 ? void 0 : pip.warningDate)
        ? formatDate(addDays(new Date(), noticeDays))
        : "—";
    return Object.assign({ employeeName: `${emp.firstName} ${emp.lastName}`, employeeCode: (_a = emp.employeeCode) !== null && _a !== void 0 ? _a : "", department: (_e = (_c = (_b = emp.Department) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : (_d = emp.department) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "", designation: (_g = (_f = emp.designation) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : "", monthlyScore: (_j = (_h = pip === null || pip === void 0 ? void 0 : pip.triggerScore) === null || _h === void 0 ? void 0 : _h.toString()) !== null && _j !== void 0 ? _j : "", triggerMonth: (_k = pip === null || pip === void 0 ? void 0 : pip.triggerMonth) !== null && _k !== void 0 ? _k : "", pipStartDate: (pip === null || pip === void 0 ? void 0 : pip.pipStartDate) ? formatDate(new Date(pip.pipStartDate)) : "—", pipEndDate: (pip === null || pip === void 0 ? void 0 : pip.pipEndDate) ? formatDate(new Date(pip.pipEndDate)) : "—", warningDate: (pip === null || pip === void 0 ? void 0 : pip.warningDate) ? formatDate(new Date(pip.warningDate)) : formatDate(new Date()), responseDeadline: (pip === null || pip === void 0 ? void 0 : pip.responseDeadline) ? formatDate(new Date(pip.responseDeadline)) : formatDate(addDays(new Date(), 7)), noticePeriodDays: noticeDays.toString(), lastWorkingDay, currentDate: formatDate(new Date()), hospitalName: (_l = process.env.HOSPITAL_NAME) !== null && _l !== void 0 ? _l : "The Organisation", hospitalAddress: (_m = process.env.HOSPITAL_ADDRESS) !== null && _m !== void 0 ? _m : "", weekNumber: (_o = extras.weekNumber) !== null && _o !== void 0 ? _o : "", reviewDate: (_p = extras.reviewDate) !== null && _p !== void 0 ? _p : "" }, extras);
}
// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_TEMPLATES = [
    {
        name: "Performance Warning Notice",
        type: "WARNING",
        subject: "Performance Warning Notice – {{employeeName}} ({{employeeCode}})",
        body: `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#333;max-width:700px;margin:auto;">
<p><strong>Date:</strong> {{currentDate}}</p>
<br>
<p>To,<br><strong>{{employeeName}}</strong><br>Employee Code: {{employeeCode}}<br>Department: {{department}}<br>Designation: {{designation}}</p>
<br>
<p><strong>Subject: Performance Warning Notice</strong></p>
<br>
<p>Dear {{employeeName}},</p>
<p>This letter is to formally notify you that your average performance score for the month of <strong>{{triggerMonth}}</strong> has been recorded as <strong>{{monthlyScore}}/100</strong>, which is below the minimum acceptable threshold of <strong>50/100</strong>.</p>
<p>Consistent underperformance adversely impacts team productivity and the quality of patient care delivered. We expect all employees to maintain a performance standard of at least 50/100.</p>
<p><strong>You are required to respond to this notice in writing within 7 days (by {{responseDeadline}}) explaining the factors contributing to your below-par performance.</strong></p>
<p>Please note that failure to respond, or continued underperformance, may result in you being placed on a formal Performance Improvement Plan (PIP) as per the Company's HR Policy.</p>
<p>This letter is issued in accordance with applicable labour law provisions and serves as a formal record of this communication.</p>
<br>
<p>Regards,<br><strong>HR Department</strong><br>{{hospitalName}}<br>{{hospitalAddress}}</p>
</div>`,
    },
    {
        name: "PIP Initiation Letter",
        type: "PIP_INITIATION",
        subject: "Performance Improvement Plan (PIP) – {{employeeName}} ({{employeeCode}})",
        body: `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#333;max-width:700px;margin:auto;">
<p><strong>Date:</strong> {{currentDate}}</p>
<br>
<p>To,<br><strong>{{employeeName}}</strong><br>Employee Code: {{employeeCode}}<br>Department: {{department}}<br>Designation: {{designation}}</p>
<br>
<p><strong>Subject: Performance Improvement Plan – Initiation</strong></p>
<br>
<p>Dear {{employeeName}},</p>
<p>Further to the performance warning issued to you, and based on your monthly performance score of <strong>{{monthlyScore}}/100</strong> for <strong>{{triggerMonth}}</strong>, you are hereby placed on a formal <strong>Performance Improvement Plan (PIP)</strong>, effective <strong>{{pipStartDate}}</strong>.</p>
<p><strong>PIP Period:</strong> {{pipStartDate}} to {{pipEndDate}} (30 days)</p>
<p>During this period:</p>
<ul>
  <li>You will be required to meet the performance targets communicated by your reporting manager</li>
  <li>Weekly check-ins will be conducted to monitor your progress against set targets</li>
  <li>Any training programs assigned must be completed within the PIP period</li>
  <li>Your performance will be formally reviewed at the end of the 30-day period</li>
</ul>
<p>At the conclusion of the PIP, a review will determine the next course of action based on demonstrated improvement.</p>
<p>We are committed to supporting you through this process. Please approach your reporting manager or the HR department if you require any assistance.</p>
<br>
<p>Regards,<br><strong>HR Department</strong><br>{{hospitalName}}<br>{{hospitalAddress}}</p>
</div>`,
    },
    {
        name: "PIP Weekly Review Reminder",
        type: "PIP_WEEKLY_REVIEW",
        subject: "PIP Weekly Check-in – Week {{weekNumber}} – {{employeeName}}",
        body: `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#333;max-width:700px;margin:auto;">
<p><strong>Date:</strong> {{currentDate}}</p>
<br>
<p>Dear {{employeeName}},</p>
<p>This is to inform you that your <strong>Week {{weekNumber}} PIP Performance Check-in</strong> is scheduled for <strong>{{reviewDate}}</strong>.</p>
<p>Please come prepared to discuss:</p>
<ul>
  <li>Progress made on your defined targets</li>
  <li>Status of any assigned training programs</li>
  <li>Any challenges or support required</li>
</ul>
<p>Your current weekly performance score will also be reviewed during this session.</p>
<p>Kindly acknowledge receipt of this email by replying to HR.</p>
<br>
<p>Regards,<br><strong>HR Department</strong><br>{{hospitalName}}</p>
</div>`,
    },
    {
        name: "PIP Extension Notice",
        type: "PIP_EXTENSION",
        subject: "PIP Extension Notice – {{employeeName}} ({{employeeCode}})",
        body: `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#333;max-width:700px;margin:auto;">
<p><strong>Date:</strong> {{currentDate}}</p>
<br>
<p>To,<br><strong>{{employeeName}}</strong><br>Employee Code: {{employeeCode}}<br>Department: {{department}}</p>
<br>
<p><strong>Subject: Performance Improvement Plan – Extension Notice</strong></p>
<br>
<p>Dear {{employeeName}},</p>
<p>Following a review of your performance during the initial PIP period, it has been observed that while some progress has been noted, it does not yet meet the required performance standards.</p>
<p>Your PIP period has been <strong>extended for an additional 30 days</strong>, ending on <strong>{{pipEndDate}}</strong>. This extension is provided as a final opportunity to demonstrate the required level of performance improvement.</p>
<p>Please note that failure to meet the required standards at the conclusion of this extended period may result in a final disciplinary decision including termination of employment, in accordance with applicable labour law.</p>
<br>
<p>Regards,<br><strong>HR Department</strong><br>{{hospitalName}}<br>{{hospitalAddress}}</p>
</div>`,
    },
    {
        name: "PIP Successful Closure",
        type: "PIP_CLOSURE",
        subject: "PIP Successfully Completed – {{employeeName}} ({{employeeCode}})",
        body: `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#333;max-width:700px;margin:auto;">
<p><strong>Date:</strong> {{currentDate}}</p>
<br>
<p>To,<br><strong>{{employeeName}}</strong><br>Employee Code: {{employeeCode}}<br>Department: {{department}}</p>
<br>
<p><strong>Subject: Performance Improvement Plan – Successful Completion</strong></p>
<br>
<p>Dear {{employeeName}},</p>
<p>We are pleased to inform you that you have <strong>successfully completed your Performance Improvement Plan (PIP)</strong> as of {{currentDate}}.</p>
<p>Your efforts and commitment to improvement have been duly noted. The PIP record will be closed, and you are expected to maintain and further build upon the performance levels demonstrated.</p>
<p>We look forward to your continued contribution and growth within the organisation.</p>
<br>
<p>Regards,<br><strong>HR Department</strong><br>{{hospitalName}}<br>{{hospitalAddress}}</p>
</div>`,
    },
    {
        name: "Termination Notice",
        type: "TERMINATION_NOTICE",
        subject: "Notice of Termination of Employment – {{employeeName}} ({{employeeCode}})",
        body: `<div style="font-family:Arial,sans-serif;line-height:1.8;color:#333;max-width:700px;margin:auto;">
<p><strong>Date:</strong> {{currentDate}}</p>
<br>
<p>To,<br><strong>{{employeeName}}</strong><br>Employee Code: {{employeeCode}}<br>Department: {{department}}<br>Designation: {{designation}}</p>
<br>
<p><strong>Subject: Notice of Termination of Employment</strong></p>
<br>
<p>Dear {{employeeName}},</p>
<p>This letter is to formally notify you that your employment with <strong>{{hospitalName}}</strong> is being terminated effective from this date, following the conclusion of the Performance Improvement Plan process.</p>
<p>Despite the issuance of a formal performance warning and the provision of a structured Performance Improvement Plan (PIP), your performance has not met the required standards of the organisation.</p>
<p>As per the terms of your employment and applicable labour law provisions:</p>
<ul>
  <li><strong>Notice Period:</strong> {{noticePeriodDays}} days</li>
  <li><strong>Last Working Day:</strong> {{lastWorkingDay}}</li>
</ul>
<p>You are required to complete all pending handover activities, return company property, and cooperate with the exit clearance process during the notice period.</p>
<p>Your full and final settlement, including any entitled dues, will be processed after the completion of the clearance process.</p>
<p>This decision has been taken after following due process as required under applicable employment and labour law, including written warning and opportunity to improve.</p>
<br>
<p>Regards,<br><strong>HR Department</strong><br>{{hospitalName}}<br>{{hospitalAddress}}</p>
</div>`,
    },
];
// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════
const getTemplates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const templates = yield prisma_1.prisma.pIPEmailTemplate.findMany({
            orderBy: { type: "asc" },
        });
        return res.json(templates);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getTemplates = getTemplates;
const createTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, type, subject, body, cc, bcc, createdBy } = req.body;
        if (!(name === null || name === void 0 ? void 0 : name.trim()) || !type || !(subject === null || subject === void 0 ? void 0 : subject.trim()) || !(body === null || body === void 0 ? void 0 : body.trim())) {
            return res.status(400).json({ error: "name, type, subject, body are required" });
        }
        const template = yield prisma_1.prisma.pIPEmailTemplate.create({
            data: { name: name.trim(), type, subject: subject.trim(), body: body.trim(), cc: (cc === null || cc === void 0 ? void 0 : cc.trim()) || null, bcc: (bcc === null || bcc === void 0 ? void 0 : bcc.trim()) || null, createdBy: createdBy ? Number(createdBy) : null },
        });
        return res.status(201).json(template);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.createTemplate = createTemplate;
const updateTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { name, type, subject, body, cc, bcc, isActive } = req.body;
        const template = yield prisma_1.prisma.pIPEmailTemplate.update({
            where: { id },
            data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (name && { name: name.trim() })), (type && { type })), (subject && { subject: subject.trim() })), (body && { body: body.trim() })), ("cc" in req.body && { cc: (cc === null || cc === void 0 ? void 0 : cc.trim()) || null })), ("bcc" in req.body && { bcc: (bcc === null || bcc === void 0 ? void 0 : bcc.trim()) || null })), (isActive !== undefined && { isActive })),
        });
        return res.json(template);
    }
    catch (error) {
        if (error.code === "P2025")
            return res.status(404).json({ error: "Template not found" });
        return res.status(500).json({ error: error.message });
    }
});
exports.updateTemplate = updateTemplate;
const deleteTemplate = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        yield prisma_1.prisma.pIPEmailTemplate.update({ where: { id }, data: { isActive: false } });
        return res.json({ message: "Template deactivated" });
    }
    catch (error) {
        if (error.code === "P2025")
            return res.status(404).json({ error: "Template not found" });
        return res.status(500).json({ error: error.message });
    }
});
exports.deleteTemplate = deleteTemplate;
const seedDefaultTemplates = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const existing = yield prisma_1.prisma.pIPEmailTemplate.count();
        if (existing > 0)
            return res.json({ message: "Templates already seeded", count: existing });
        yield prisma_1.prisma.pIPEmailTemplate.createMany({ data: DEFAULT_TEMPLATES });
        return res.json({ message: "Default templates seeded", count: DEFAULT_TEMPLATES.length });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.seedDefaultTemplates = seedDefaultTemplates;
// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE MONITORING
// ═══════════════════════════════════════════════════════════════════════════
const getUnderperformers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        // Default to previous month if not provided
        const monthParam = req.query.month;
        let year, month;
        if (monthParam) {
            [year, month] = monthParam.split("-").map(Number);
        }
        else {
            const d = new Date();
            d.setMonth(d.getMonth() - 1);
            year = d.getFullYear();
            month = d.getMonth() + 1;
        }
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 1);
        // Get all weekly ratings for the given month
        const ratings = yield prisma_1.prisma.weeklyPerformanceRating.findMany({
            where: {
                weekStartDate: { gte: monthStart, lt: monthEnd },
                status: "SUBMITTED",
            },
            select: { employeeId: true, overallScore: true },
        });
        if (!ratings.length)
            return res.json([]);
        // Aggregate per employee
        const scoreMap = {};
        for (const r of ratings) {
            if (!scoreMap[r.employeeId])
                scoreMap[r.employeeId] = { sum: 0, count: 0 };
            scoreMap[r.employeeId].sum += (_a = r.overallScore) !== null && _a !== void 0 ? _a : 0;
            scoreMap[r.employeeId].count += 1;
        }
        // Filter ≤ 50
        const underperformerIds = Object.entries(scoreMap)
            .filter(([, v]) => v.sum / v.count <= 50)
            .map(([id]) => Number(id));
        if (!underperformerIds.length)
            return res.json([]);
        // Fetch employee details
        const employees = yield prisma_1.prisma.employee.findMany({
            where: { id: { in: underperformerIds }, employmentStatus: "ACTIVE" },
            select: {
                id: true, employeeCode: true, firstName: true, lastName: true, email: true, dateOfJoining: true,
                Department: { select: { name: true } },
                designation: { select: { name: true } },
            },
        });
        // Get existing PIPs for these employees
        const pips = yield prisma_1.prisma.employeePIP.findMany({
            where: { employeeId: { in: underperformerIds } },
            orderBy: { createdAt: "desc" },
            select: { id: true, employeeId: true, status: true, triggerMonth: true, pipStartDate: true, pipEndDate: true },
        });
        const pipMap = {};
        for (const p of pips) {
            if (!pipMap[p.employeeId])
                pipMap[p.employeeId] = p;
        }
        const result = employees.map(emp => {
            var _a, _b;
            const agg = scoreMap[emp.id];
            const avg = agg ? Math.round((agg.sum / agg.count) * 10) / 10 : 0;
            return Object.assign(Object.assign({}, emp), { monthlyAvgScore: avg, ratingCount: (_a = agg === null || agg === void 0 ? void 0 : agg.count) !== null && _a !== void 0 ? _a : 0, currentPIP: (_b = pipMap[emp.id]) !== null && _b !== void 0 ? _b : null, triggerMonth: `${year}-${String(month).padStart(2, "0")}` });
        });
        result.sort((a, b) => a.monthlyAvgScore - b.monthlyAvgScore);
        return res.json(result);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getUnderperformers = getUnderperformers;
// ═══════════════════════════════════════════════════════════════════════════
// EMAIL — Preview & Send
// ═══════════════════════════════════════════════════════════════════════════
const previewEmail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const templateId = Number(req.query.templateId);
        const employeeId = Number(req.query.employeeId);
        const triggerScore = req.query.triggerScore ? Number(req.query.triggerScore) : undefined;
        const pipId = req.query.pipId ? Number(req.query.pipId) : undefined;
        if (!templateId || !employeeId) {
            return res.status(400).json({ error: "templateId and employeeId are required" });
        }
        const [template, emp, pip] = yield Promise.all([
            prisma_1.prisma.pIPEmailTemplate.findUnique({ where: { id: templateId } }),
            prisma_1.prisma.employee.findUnique({
                where: { id: employeeId },
                select: {
                    id: true, employeeCode: true, firstName: true, lastName: true, email: true, dateOfJoining: true,
                    Department: { select: { name: true } },
                    designation: { select: { name: true } },
                },
            }),
            pipId ? prisma_1.prisma.employeePIP.findUnique({ where: { id: pipId } }) : Promise.resolve(null),
        ]);
        if (!template)
            return res.status(404).json({ error: "Template not found" });
        if (!emp)
            return res.status(404).json({ error: "Employee not found" });
        const pipData = pip !== null && pip !== void 0 ? pip : { triggerScore: triggerScore !== null && triggerScore !== void 0 ? triggerScore : 0, triggerMonth: "", warningDate: null, responseDeadline: null, pipStartDate: null, pipEndDate: null };
        const data = buildPlaceholderData(emp, pipData);
        return res.json({
            subject: fillPlaceholders(template.subject, data),
            body: fillPlaceholders(template.body, data),
        });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.previewEmail = previewEmail;
const sendWarning = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { employees: targets, templateId, triggerMonth, sentBy } = req.body;
        if (!(targets === null || targets === void 0 ? void 0 : targets.length) || !templateId || !triggerMonth || !sentBy) {
            return res.status(400).json({ error: "employees, templateId, triggerMonth, sentBy are required" });
        }
        const template = yield prisma_1.prisma.pIPEmailTemplate.findUnique({ where: { id: Number(templateId) } });
        if (!template)
            return res.status(404).json({ error: "Template not found" });
        const sent = [];
        const failed = [];
        for (const t of targets) {
            const { employeeId, triggerScore } = t;
            try {
                const emp = yield prisma_1.prisma.employee.findUnique({
                    where: { id: Number(employeeId) },
                    select: {
                        id: true, employeeCode: true, firstName: true, lastName: true, email: true, dateOfJoining: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                });
                if (!emp || !emp.email) {
                    failed.push({ employeeId, reason: "Employee not found or no email" });
                    continue;
                }
                const warningDate = new Date();
                const responseDeadline = addDays(warningDate, 7);
                // Upsert PIP record
                let pip = yield prisma_1.prisma.employeePIP.findFirst({
                    where: { employeeId: emp.id, triggerMonth },
                });
                if (!pip) {
                    const pipNumber = yield generatePipNumber(emp.employeeCode, new Date().getFullYear());
                    pip = yield prisma_1.prisma.employeePIP.create({
                        data: {
                            pipNumber,
                            employeeId: emp.id,
                            triggerScore: Number(triggerScore),
                            triggerMonth,
                            status: "WARNING_ISSUED",
                            warningDate,
                            responseDeadline,
                            initiatedBy: Number(sentBy),
                        },
                    });
                }
                else {
                    pip = yield prisma_1.prisma.employeePIP.update({
                        where: { id: pip.id },
                        data: { status: "WARNING_ISSUED", warningDate, responseDeadline },
                    });
                }
                const responseToken = generateResponseToken();
                const data = buildPlaceholderData(emp, pip, { responseLink: "", pipNumber: (_a = pip.pipNumber) !== null && _a !== void 0 ? _a : "" });
                const subject = fillPlaceholders(template.subject, data);
                const body = fillPlaceholders(template.body, data);
                let emailStatus = "SENT";
                let errorMessage = null;
                try {
                    yield transporter.sendMail({
                        from: process.env.SMTP_USER,
                        to: emp.email,
                        cc: template.cc || undefined,
                        bcc: template.bcc || undefined,
                        subject,
                        html: body,
                    });
                }
                catch (mailErr) {
                    emailStatus = "FAILED";
                    errorMessage = mailErr.message;
                }
                yield prisma_1.prisma.pIPEmailLog.create({
                    data: {
                        pipId: pip.id,
                        employeeId: emp.id,
                        templateId: template.id,
                        sentTo: emp.email,
                        subject,
                        body,
                        sentBy: Number(sentBy),
                        status: emailStatus,
                        errorMessage,
                        responseToken,
                    },
                });
                if (emailStatus === "SENT")
                    sent.push(employeeId);
                else
                    failed.push({ employeeId, reason: errorMessage !== null && errorMessage !== void 0 ? errorMessage : "Mail send failed" });
            }
            catch (err) {
                failed.push({ employeeId, reason: err.message });
            }
        }
        return res.json({ sent, failed });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.sendWarning = sendWarning;
// ═══════════════════════════════════════════════════════════════════════════
// PIP LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════
const initiatePIP = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { pipId, targets, trainingIds, initiatedBy, remarks } = req.body;
        if (!pipId || !initiatedBy) {
            return res.status(400).json({ error: "pipId and initiatedBy are required" });
        }
        const pip = yield prisma_1.prisma.employeePIP.findUnique({ where: { id: Number(pipId) } });
        if (!pip)
            return res.status(404).json({ error: "PIP record not found" });
        if (pip.status !== "WARNING_ISSUED") {
            return res.status(400).json({ error: `Cannot initiate PIP from status: ${pip.status}` });
        }
        const pipStartDate = new Date();
        const pipEndDate = addDays(pipStartDate, 30);
        const updated = yield prisma_1.prisma.employeePIP.update({
            where: { id: pip.id },
            data: {
                status: "PIP_ACTIVE",
                pipStartDate,
                pipEndDate,
                targets: targets !== null && targets !== void 0 ? targets : [],
                trainingIds: trainingIds !== null && trainingIds !== void 0 ? trainingIds : [],
                initiatedBy: Number(initiatedBy),
                remarks: remarks !== null && remarks !== void 0 ? remarks : pip.remarks,
            },
            include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true } } },
        });
        return res.json(updated);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.initiatePIP = initiatePIP;
const getPIPList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, employeeId, triggerMonth, departmentId } = req.query;
        const where = {};
        if (status)
            where.status = String(status);
        if (employeeId)
            where.employeeId = Number(employeeId);
        if (triggerMonth)
            where.triggerMonth = String(triggerMonth);
        if (departmentId)
            where.employee = { departmentId: Number(departmentId) };
        const pips = yield prisma_1.prisma.employeePIP.findMany({
            where,
            include: {
                employee: {
                    select: {
                        id: true, employeeCode: true, firstName: true, lastName: true, email: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
                weeklyReviews: { orderBy: { weekNumber: "asc" } },
                _count: { select: { emailLogs: true } },
            },
            orderBy: { createdAt: "desc" },
        });
        return res.json(pips);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getPIPList = getPIPList;
const getPIPDetail = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const pip = yield prisma_1.prisma.employeePIP.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true, employeeCode: true, firstName: true, lastName: true, email: true, dateOfJoining: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
                weeklyReviews: { orderBy: { weekNumber: "asc" } },
                emailLogs: {
                    include: { template: { select: { name: true, type: true } } },
                    orderBy: { sentAt: "desc" },
                },
            },
        });
        if (!pip)
            return res.status(404).json({ error: "PIP not found" });
        // Auto-attach weekly rating scores for the PIP period
        let weeklyRatings = [];
        if (pip.pipStartDate && pip.pipEndDate) {
            weeklyRatings = yield prisma_1.prisma.weeklyPerformanceRating.findMany({
                where: {
                    employeeId: pip.employeeId,
                    weekStartDate: { gte: pip.pipStartDate, lte: pip.pipEndDate },
                },
                select: { id: true, weekStartDate: true, weekEndDate: true, weekLabel: true, overallScore: true },
                orderBy: { weekStartDate: "asc" },
            });
        }
        return res.json(Object.assign(Object.assign({}, pip), { weeklyRatings }));
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getPIPDetail = getPIPDetail;
const addWeeklyReview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const pipId = Number(req.params.id);
        const { weekNumber, reviewDate, status, remarks, reviewedBy } = req.body;
        if (!weekNumber || !reviewDate || !status || !reviewedBy) {
            return res.status(400).json({ error: "weekNumber, reviewDate, status, reviewedBy are required" });
        }
        if (!["IMPROVED", "NOT_IMPROVED", "ONGOING"].includes(status)) {
            return res.status(400).json({ error: "status must be IMPROVED, NOT_IMPROVED, or ONGOING" });
        }
        const pip = yield prisma_1.prisma.employeePIP.findUnique({ where: { id: pipId } });
        if (!pip)
            return res.status(404).json({ error: "PIP not found" });
        if (!["PIP_ACTIVE", "PIP_EXTENDED"].includes(pip.status)) {
            return res.status(400).json({ error: "PIP must be ACTIVE or EXTENDED to add reviews" });
        }
        const rDate = new Date(reviewDate);
        const weekStart = new Date(rDate);
        weekStart.setDate(weekStart.getDate() - 6);
        // Auto-fetch weekly rating score for this employee in the review week
        const weekRating = yield prisma_1.prisma.weeklyPerformanceRating.findFirst({
            where: {
                employeeId: pip.employeeId,
                weekStartDate: { gte: weekStart, lte: rDate },
            },
            orderBy: { weekStartDate: "desc" },
            select: { overallScore: true },
        });
        const review = yield prisma_1.prisma.pIPWeeklyReview.create({
            data: {
                pipId,
                weekNumber: Number(weekNumber),
                reviewDate: rDate,
                weeklyScore: (_a = weekRating === null || weekRating === void 0 ? void 0 : weekRating.overallScore) !== null && _a !== void 0 ? _a : null,
                status,
                remarks: remarks !== null && remarks !== void 0 ? remarks : null,
                reviewedBy: Number(reviewedBy),
            },
        });
        return res.status(201).json(Object.assign(Object.assign({}, review), { autoFetchedScore: (_b = weekRating === null || weekRating === void 0 ? void 0 : weekRating.overallScore) !== null && _b !== void 0 ? _b : null }));
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.addWeeklyReview = addWeeklyReview;
const closePIP = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { closedBy, sendEmail, templateId } = req.body;
        if (!closedBy)
            return res.status(400).json({ error: "closedBy is required" });
        const pip = yield prisma_1.prisma.employeePIP.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true, employeeCode: true, firstName: true, lastName: true, email: true, dateOfJoining: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
            },
        });
        if (!pip)
            return res.status(404).json({ error: "PIP not found" });
        if (!["PIP_ACTIVE", "PIP_EXTENDED"].includes(pip.status)) {
            return res.status(400).json({ error: `Cannot close PIP from status: ${pip.status}` });
        }
        const updated = yield prisma_1.prisma.employeePIP.update({
            where: { id },
            data: { status: "PIP_CLOSED_IMPROVED", closedAt: new Date(), closedBy: Number(closedBy) },
        });
        // Optionally send closure email
        if (sendEmail && templateId) {
            const template = yield prisma_1.prisma.pIPEmailTemplate.findUnique({ where: { id: Number(templateId) } });
            if (template && pip.employee.email) {
                const data = buildPlaceholderData(pip.employee, pip);
                const subject = fillPlaceholders(template.subject, data);
                const body = fillPlaceholders(template.body, data);
                let emailStatus = "SENT";
                let errorMessage = null;
                try {
                    yield transporter.sendMail({ from: process.env.SMTP_USER, to: pip.employee.email, cc: template.cc || undefined, bcc: template.bcc || undefined, subject, html: body });
                }
                catch (e) {
                    emailStatus = "FAILED";
                    errorMessage = e.message;
                }
                yield prisma_1.prisma.pIPEmailLog.create({
                    data: { pipId: id, employeeId: pip.employeeId, templateId: Number(templateId), sentTo: pip.employee.email, subject, body, sentBy: Number(closedBy), status: emailStatus, errorMessage },
                });
            }
        }
        return res.json(updated);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.closePIP = closePIP;
const extendPIP = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const id = Number(req.params.id);
        const { extendedBy, sendEmail, templateId } = req.body;
        if (!extendedBy)
            return res.status(400).json({ error: "extendedBy is required" });
        const pip = yield prisma_1.prisma.employeePIP.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true, employeeCode: true, firstName: true, lastName: true, email: true, dateOfJoining: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
            },
        });
        if (!pip)
            return res.status(404).json({ error: "PIP not found" });
        if (pip.status !== "PIP_ACTIVE")
            return res.status(400).json({ error: "Only PIP_ACTIVE can be extended" });
        if (pip.extendedCount >= 1)
            return res.status(400).json({ error: "PIP can only be extended once. Proceed to final decision." });
        const newEndDate = addDays((_a = pip.pipEndDate) !== null && _a !== void 0 ? _a : new Date(), 30);
        const updated = yield prisma_1.prisma.employeePIP.update({
            where: { id },
            data: { status: "PIP_EXTENDED", pipEndDate: newEndDate, extendedCount: pip.extendedCount + 1 },
        });
        if (sendEmail && templateId) {
            const template = yield prisma_1.prisma.pIPEmailTemplate.findUnique({ where: { id: Number(templateId) } });
            if (template && pip.employee.email) {
                const data = buildPlaceholderData(pip.employee, Object.assign(Object.assign({}, pip), { pipEndDate: newEndDate }));
                const subject = fillPlaceholders(template.subject, data);
                const body = fillPlaceholders(template.body, data);
                let emailStatus = "SENT";
                let errorMessage = null;
                try {
                    yield transporter.sendMail({ from: process.env.SMTP_USER, to: pip.employee.email, cc: template.cc || undefined, bcc: template.bcc || undefined, subject, html: body });
                }
                catch (e) {
                    emailStatus = "FAILED";
                    errorMessage = e.message;
                }
                yield prisma_1.prisma.pIPEmailLog.create({
                    data: { pipId: id, employeeId: pip.employeeId, templateId: Number(templateId), sentTo: pip.employee.email, subject, body, sentBy: Number(extendedBy), status: emailStatus, errorMessage },
                });
            }
        }
        return res.json(updated);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.extendPIP = extendPIP;
const terminatePIP = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = Number(req.params.id);
        const { terminationReason, sentBy, sendEmail, templateId, noticePeriodDaysOverride } = req.body;
        if (!terminationReason || !sentBy) {
            return res.status(400).json({ error: "terminationReason and sentBy are required" });
        }
        const pip = yield prisma_1.prisma.employeePIP.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true, employeeCode: true, firstName: true, lastName: true, email: true, dateOfJoining: true,
                        Department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
            },
        });
        if (!pip)
            return res.status(404).json({ error: "PIP not found" });
        if (!["PIP_ACTIVE", "PIP_EXTENDED"].includes(pip.status)) {
            return res.status(400).json({ error: `Cannot terminate from status: ${pip.status}` });
        }
        const noticeDays = noticePeriodDaysOverride
            ? Number(noticePeriodDaysOverride)
            : pip.employee.dateOfJoining
                ? getNoticePeriodDays(new Date(pip.employee.dateOfJoining))
                : 30;
        const updated = yield prisma_1.prisma.employeePIP.update({
            where: { id },
            data: { status: "TERMINATION_INITIATED", terminationReason, noticePeriodDays: noticeDays },
        });
        if (sendEmail && templateId) {
            const template = yield prisma_1.prisma.pIPEmailTemplate.findUnique({ where: { id: Number(templateId) } });
            if (template && pip.employee.email) {
                const lastWorkingDay = formatDate(addDays(new Date(), noticeDays));
                const data = buildPlaceholderData(pip.employee, Object.assign(Object.assign({}, pip), { noticePeriodDays: noticeDays }), { noticePeriodDays: noticeDays.toString(), lastWorkingDay });
                const subject = fillPlaceholders(template.subject, data);
                const body = fillPlaceholders(template.body, data);
                let emailStatus = "SENT";
                let errorMessage = null;
                try {
                    yield transporter.sendMail({ from: process.env.SMTP_USER, to: pip.employee.email, cc: template.cc || undefined, bcc: template.bcc || undefined, subject, html: body });
                }
                catch (e) {
                    emailStatus = "FAILED";
                    errorMessage = e.message;
                }
                yield prisma_1.prisma.pIPEmailLog.create({
                    data: { pipId: id, employeeId: pip.employeeId, templateId: Number(templateId), sentTo: pip.employee.email, subject, body, sentBy: Number(sentBy), status: emailStatus, errorMessage },
                });
            }
        }
        return res.json(Object.assign(Object.assign({}, updated), { noticePeriodDays: noticeDays, lastWorkingDay: formatDate(addDays(new Date(), noticeDays)) }));
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.terminatePIP = terminatePIP;
// ═══════════════════════════════════════════════════════════════════════════
// EMAIL LOGS
// ═══════════════════════════════════════════════════════════════════════════
const getEmailLogs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, pipId, status, from, to } = req.query;
        const where = {};
        if (employeeId)
            where.employeeId = Number(employeeId);
        if (pipId)
            where.pipId = Number(pipId);
        if (status)
            where.status = String(status);
        if (from || to) {
            where.sentAt = {};
            if (from)
                where.sentAt.gte = new Date(String(from));
            if (to)
                where.sentAt.lte = new Date(String(to));
        }
        const logs = yield prisma_1.prisma.pIPEmailLog.findMany({
            where,
            include: {
                employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
                template: { select: { name: true, type: true } },
                pip: { select: { triggerMonth: true, status: true } },
            },
            orderBy: { sentAt: "desc" },
        });
        return res.json(logs);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getEmailLogs = getEmailLogs;
// ═══════════════════════════════════════════════════════════════════════════
// PIP HISTORY FOR EMPLOYEE
// ═══════════════════════════════════════════════════════════════════════════
const getEmployeePIPHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        const pips = yield prisma_1.prisma.employeePIP.findMany({
            where: { employeeId },
            include: {
                employee: {
                    select: {
                        id: true, employeeCode: true, firstName: true, lastName: true,
                        email: true, Department: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
                weeklyReviews: { orderBy: { weekNumber: "asc" } },
                responses: {
                    orderBy: { respondedAt: "desc" },
                    include: { employee: { select: { id: true, firstName: true, lastName: true } } },
                },
                emailLogs: { orderBy: { sentAt: "desc" }, take: 5 },
            },
            orderBy: { createdAt: "desc" },
        });
        return res.json(pips);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getEmployeePIPHistory = getEmployeePIPHistory;
// ═══════════════════════════════════════════════════════════════════════════
// EMPLOYEE RESPONDS VIA TOKEN LINK (public)
// ═══════════════════════════════════════════════════════════════════════════
const respondViaToken = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { token } = req.params;
        const { responseText } = req.body;
        if (!(responseText === null || responseText === void 0 ? void 0 : responseText.trim())) {
            return res.status(400).json({ error: "Response text is required" });
        }
        const emailLog = yield prisma_1.prisma.pIPEmailLog.findUnique({
            where: { responseToken: token },
            include: {
                pip: {
                    select: {
                        id: true, pipNumber: true, status: true,
                        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
                    },
                },
            },
        });
        if (!emailLog)
            return res.status(404).json({ error: "Invalid or expired link" });
        if (!emailLog.pip)
            return res.status(400).json({ error: "PIP not found for this token" });
        const closedStatuses = ["PIP_CLOSED_IMPROVED", "TERMINATED"];
        if (closedStatuses.includes(emailLog.pip.status)) {
            return res.status(410).json({ error: "This PIP has been closed. No further responses are accepted." });
        }
        // Check if token was already used
        const alreadyResponded = yield prisma_1.prisma.pIPEmployeeResponse.findFirst({
            where: { tokenUsed: token },
        });
        if (alreadyResponded) {
            return res.status(409).json({ error: "You have already submitted a response using this link" });
        }
        const response = yield prisma_1.prisma.pIPEmployeeResponse.create({
            data: {
                pipId: emailLog.pip.id,
                employeeId: emailLog.employeeId,
                method: "EMAIL_LINK",
                responseText: responseText.trim(),
                tokenUsed: token,
            },
        });
        return res.json({
            message: "Response submitted successfully",
            pipNumber: emailLog.pip.pipNumber,
            employee: emailLog.pip.employee,
            response,
        });
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.respondViaToken = respondViaToken;
// ═══════════════════════════════════════════════════════════════════════════
// HR LOGS MANUAL RESPONSE
// ═══════════════════════════════════════════════════════════════════════════
const logManualResponse = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const pipId = Number(req.params.id);
        const { employeeId, responseText } = req.body;
        if (!(responseText === null || responseText === void 0 ? void 0 : responseText.trim()))
            return res.status(400).json({ error: "Response text required" });
        const pip = yield prisma_1.prisma.employeePIP.findUnique({ where: { id: pipId } });
        if (!pip)
            return res.status(404).json({ error: "PIP not found" });
        const closedStatuses = ["PIP_CLOSED_IMPROVED", "TERMINATED"];
        if (closedStatuses.includes(pip.status)) {
            return res.status(410).json({ error: "This PIP is closed. Responses can only be logged while the PIP is active." });
        }
        const method = req.body.method === "EMPLOYEE_SELF" ? "EMPLOYEE_SELF" : "HR_LOGGED";
        const response = yield prisma_1.prisma.pIPEmployeeResponse.create({
            data: {
                pipId,
                employeeId: Number(employeeId || pip.employeeId),
                method,
                responseText: responseText.trim(),
            },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
            },
        });
        return res.json(response);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.logManualResponse = logManualResponse;
// ═══════════════════════════════════════════════════════════════════════════
// HR ACKNOWLEDGES A RESPONSE
// ═══════════════════════════════════════════════════════════════════════════
const acknowledgeResponse = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const responseId = Number(req.params.id);
        const { acknowledgedBy } = req.body;
        const updated = yield prisma_1.prisma.pIPEmployeeResponse.update({
            where: { id: responseId },
            data: { acknowledgedBy: Number(acknowledgedBy), acknowledgedAt: new Date() },
        });
        return res.json(updated);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.acknowledgeResponse = acknowledgeResponse;
// ═══════════════════════════════════════════════════════════════════════════
// GET ALL RESPONSES FOR A PIP
// ═══════════════════════════════════════════════════════════════════════════
const getPIPResponses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const pipId = Number(req.params.id);
        const responses = yield prisma_1.prisma.pIPEmployeeResponse.findMany({
            where: { pipId },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
            },
            orderBy: { respondedAt: "desc" },
        });
        return res.json(responses);
    }
    catch (error) {
        return res.status(500).json({ error: error.message });
    }
});
exports.getPIPResponses = getPIPResponses;
