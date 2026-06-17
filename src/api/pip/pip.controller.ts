import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { config } from "../../config";

// ── Email transporter (reuse existing SMTP config) ──────────────────────────
const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: { user: config.smtp.user, pass: config.smtp.pass },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function fillPlaceholders(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`);
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Indian labour law: notice period based on years of service */
function getNoticePeriodDays(dateOfJoining: Date): number {
  const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
  const years = (Date.now() - dateOfJoining.getTime()) / msPerYear;
  if (years < 1) return 30;
  if (years < 3) return 45;
  return 60;
}

function generateResponseToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

async function generatePipNumber(employeeCode: string, year: number): Promise<string> {
  const prefix = `PIP-${employeeCode}-${year}`;
  const count = await prisma.employeePIP.count({
    where: { pipNumber: { startsWith: prefix } },
  });
  const seq = String(count + 1).padStart(3, "0");
  return `${prefix}-${seq}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function buildPlaceholderData(
  emp: any,
  pip: any,
  extras: Record<string, string> = {}
): Record<string, string> {
  const noticeDays = emp.dateOfJoining
    ? getNoticePeriodDays(new Date(emp.dateOfJoining))
    : 30;
  const lastWorkingDay = pip?.warningDate
    ? formatDate(addDays(new Date(), noticeDays))
    : "—";

  return {
    employeeName: `${emp.firstName} ${emp.lastName}`,
    employeeCode: emp.employeeCode ?? "",
    department: emp.Department?.name ?? emp.department?.name ?? "",
    designation: emp.designation?.name ?? "",
    monthlyScore: pip?.triggerScore?.toString() ?? "",
    triggerMonth: pip?.triggerMonth ?? "",
    pipStartDate: pip?.pipStartDate ? formatDate(new Date(pip.pipStartDate)) : "—",
    pipEndDate: pip?.pipEndDate ? formatDate(new Date(pip.pipEndDate)) : "—",
    warningDate: pip?.warningDate ? formatDate(new Date(pip.warningDate)) : formatDate(new Date()),
    responseDeadline: pip?.responseDeadline ? formatDate(new Date(pip.responseDeadline)) : formatDate(addDays(new Date(), 7)),
    noticePeriodDays: noticeDays.toString(),
    lastWorkingDay,
    currentDate: formatDate(new Date()),
    hospitalName: config.branding.hospitalName || "The Organisation",
    hospitalAddress: config.branding.hospitalAddress,
    weekNumber: extras.weekNumber ?? "",
    reviewDate: extras.reviewDate ?? "",
    ...extras,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_TEMPLATES = [
  {
    name: "Performance Warning Notice",
    type: "WARNING" as const,
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
    type: "PIP_INITIATION" as const,
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
    type: "PIP_WEEKLY_REVIEW" as const,
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
    type: "PIP_EXTENSION" as const,
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
    type: "PIP_CLOSURE" as const,
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
    type: "TERMINATION_NOTICE" as const,
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

export const getTemplates = async (req: Request, res: Response) => {
  try {
    const templates = await prisma.pIPEmailTemplate.findMany({
      orderBy: { type: "asc" },
    });
    return res.json(templates);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createTemplate = async (req: Request, res: Response) => {
  try {
    const { name, type, subject, body, cc, bcc, createdBy } = req.body;
    if (!name?.trim() || !type || !subject?.trim() || !body?.trim()) {
      return res.status(400).json({ error: "name, type, subject, body are required" });
    }
    const template = await prisma.pIPEmailTemplate.create({
      data: { name: name.trim(), type, subject: subject.trim(), body: body.trim(), cc: cc?.trim() || null, bcc: bcc?.trim() || null, createdBy: createdBy ? Number(createdBy) : null },
    });
    return res.status(201).json(template);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateTemplate = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { name, type, subject, body, cc, bcc, isActive } = req.body;
    const template = await prisma.pIPEmailTemplate.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(type && { type }),
        ...(subject && { subject: subject.trim() }),
        ...(body && { body: body.trim() }),
        ...("cc" in req.body && { cc: cc?.trim() || null }),
        ...("bcc" in req.body && { bcc: bcc?.trim() || null }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    return res.json(template);
  } catch (error: any) {
    if (error.code === "P2025") return res.status(404).json({ error: "Template not found" });
    return res.status(500).json({ error: error.message });
  }
};

export const deleteTemplate = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await prisma.pIPEmailTemplate.update({ where: { id }, data: { isActive: false } });
    return res.json({ message: "Template deactivated" });
  } catch (error: any) {
    if (error.code === "P2025") return res.status(404).json({ error: "Template not found" });
    return res.status(500).json({ error: error.message });
  }
};

export const seedDefaultTemplates = async (_req: Request, res: Response) => {
  try {
    const existing = await prisma.pIPEmailTemplate.count();
    if (existing > 0) return res.json({ message: "Templates already seeded", count: existing });

    await prisma.pIPEmailTemplate.createMany({ data: DEFAULT_TEMPLATES });
    return res.json({ message: "Default templates seeded", count: DEFAULT_TEMPLATES.length });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE MONITORING
// ═══════════════════════════════════════════════════════════════════════════

export const getUnderperformers = async (req: Request, res: Response) => {
  try {
    // Default to previous month if not provided
    const monthParam = req.query.month as string;
    let year: number, month: number;

    if (monthParam) {
      [year, month] = monthParam.split("-").map(Number);
    } else {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      year = d.getFullYear();
      month = d.getMonth() + 1;
    }

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);

    // Get all weekly ratings for the given month
    const ratings = await prisma.weeklyPerformanceRating.findMany({
      where: {
        weekStartDate: { gte: monthStart, lt: monthEnd },
        status: "SUBMITTED",
      },
      select: { employeeId: true, overallScore: true },
    });

    if (!ratings.length) return res.json([]);

    // Aggregate per employee
    const scoreMap: Record<number, { sum: number; count: number }> = {};
    for (const r of ratings) {
      if (!scoreMap[r.employeeId]) scoreMap[r.employeeId] = { sum: 0, count: 0 };
      scoreMap[r.employeeId].sum += r.overallScore ?? 0;
      scoreMap[r.employeeId].count += 1;
    }

    // Filter ≤ 50
    const underperformerIds = Object.entries(scoreMap)
      .filter(([, v]) => v.sum / v.count <= 50)
      .map(([id]) => Number(id));

    if (!underperformerIds.length) return res.json([]);

    // Fetch employee details
    const employees = await prisma.employee.findMany({
      where: { id: { in: underperformerIds }, employmentStatus: "ACTIVE" },
      select: {
        id: true, employeeCode: true, firstName: true, lastName: true, email: true, dateOfJoining: true,
        Department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });

    // Get existing PIPs for these employees
    const pips = await prisma.employeePIP.findMany({
      where: { employeeId: { in: underperformerIds } },
      orderBy: { createdAt: "desc" },
      select: { id: true, employeeId: true, status: true, triggerMonth: true, pipStartDate: true, pipEndDate: true },
    });
    const pipMap: Record<number, any> = {};
    for (const p of pips) {
      if (!pipMap[p.employeeId]) pipMap[p.employeeId] = p;
    }

    const result = employees.map(emp => {
      const agg = scoreMap[emp.id];
      const avg = agg ? Math.round((agg.sum / agg.count) * 10) / 10 : 0;
      return {
        ...emp,
        monthlyAvgScore: avg,
        ratingCount: agg?.count ?? 0,
        currentPIP: pipMap[emp.id] ?? null,
        triggerMonth: `${year}-${String(month).padStart(2, "0")}`,
      };
    });

    result.sort((a, b) => a.monthlyAvgScore - b.monthlyAvgScore);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL — Preview & Send
// ═══════════════════════════════════════════════════════════════════════════

export const previewEmail = async (req: Request, res: Response) => {
  try {
    const templateId = Number(req.query.templateId);
    const employeeId = Number(req.query.employeeId);
    const triggerScore = req.query.triggerScore ? Number(req.query.triggerScore) : undefined;
    const pipId = req.query.pipId ? Number(req.query.pipId) : undefined;

    if (!templateId || !employeeId) {
      return res.status(400).json({ error: "templateId and employeeId are required" });
    }

    const [template, emp, pip] = await Promise.all([
      prisma.pIPEmailTemplate.findUnique({ where: { id: templateId } }),
      prisma.employee.findUnique({
        where: { id: employeeId },
        select: {
          id: true, employeeCode: true, firstName: true, lastName: true, email: true, dateOfJoining: true,
          Department: { select: { name: true } },
          designation: { select: { name: true } },
        },
      }),
      pipId ? prisma.employeePIP.findUnique({ where: { id: pipId } }) : Promise.resolve(null),
    ]);

    if (!template) return res.status(404).json({ error: "Template not found" });
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    const pipData = pip ?? { triggerScore: triggerScore ?? 0, triggerMonth: "", warningDate: null, responseDeadline: null, pipStartDate: null, pipEndDate: null };
    const data = buildPlaceholderData(emp, pipData);

    return res.json({
      subject: fillPlaceholders(template.subject, data),
      body: fillPlaceholders(template.body, data),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const sendWarning = async (req: Request, res: Response) => {
  try {
    const { employees: targets, templateId, triggerMonth, sentBy } = req.body;

    if (!targets?.length || !templateId || !triggerMonth || !sentBy) {
      return res.status(400).json({ error: "employees, templateId, triggerMonth, sentBy are required" });
    }

    const template = await prisma.pIPEmailTemplate.findUnique({ where: { id: Number(templateId) } });
    if (!template) return res.status(404).json({ error: "Template not found" });

    const sent: number[] = [];
    const failed: { employeeId: number; reason: string }[] = [];

    for (const t of targets) {
      const { employeeId, triggerScore } = t;
      try {
        const emp = await prisma.employee.findUnique({
          where: { id: Number(employeeId) },
          select: {
            id: true, employeeCode: true, firstName: true, lastName: true, email: true, dateOfJoining: true,
            Department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        });
        if (!emp || !emp.email) { failed.push({ employeeId, reason: "Employee not found or no email" }); continue; }

        const warningDate = new Date();
        const responseDeadline = addDays(warningDate, 7);

        // Upsert PIP record
        let pip = await prisma.employeePIP.findFirst({
          where: { employeeId: emp.id, triggerMonth },
        });
        if (!pip) {
          const pipNumber = await generatePipNumber(emp.employeeCode, new Date().getFullYear());
          pip = await prisma.employeePIP.create({
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
        } else {
          pip = await prisma.employeePIP.update({
            where: { id: pip.id },
            data: { status: "WARNING_ISSUED", warningDate, responseDeadline },
          });
        }

        const responseToken = generateResponseToken();
        const data = buildPlaceholderData(emp, pip, { responseLink: "", pipNumber: pip.pipNumber ?? "" });
        const subject = fillPlaceholders(template.subject, data);
        const body = fillPlaceholders(template.body, data);

        let emailStatus = "SENT";
        let errorMessage: string | null = null;
        try {
          await transporter.sendMail({
            from: config.smtp.from,
            to: emp.email,
            cc: template.cc || undefined,
            bcc: template.bcc || undefined,
            subject,
            html: body,
          });
        } catch (mailErr: any) {
          emailStatus = "FAILED";
          errorMessage = mailErr.message;
        }

        await prisma.pIPEmailLog.create({
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

        if (emailStatus === "SENT") sent.push(employeeId);
        else failed.push({ employeeId, reason: errorMessage ?? "Mail send failed" });
      } catch (err: any) {
        failed.push({ employeeId, reason: err.message });
      }
    }

    return res.json({ sent, failed });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PIP LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

export const initiatePIP = async (req: Request, res: Response) => {
  try {
    const { pipId, targets, trainingIds, initiatedBy, remarks } = req.body;
    if (!pipId || !initiatedBy) {
      return res.status(400).json({ error: "pipId and initiatedBy are required" });
    }

    const pip = await prisma.employeePIP.findUnique({ where: { id: Number(pipId) } });
    if (!pip) return res.status(404).json({ error: "PIP record not found" });
    if (pip.status !== "WARNING_ISSUED") {
      return res.status(400).json({ error: `Cannot initiate PIP from status: ${pip.status}` });
    }

    const pipStartDate = new Date();
    const pipEndDate = addDays(pipStartDate, 30);

    const updated = await prisma.employeePIP.update({
      where: { id: pip.id },
      data: {
        status: "PIP_ACTIVE",
        pipStartDate,
        pipEndDate,
        targets: targets ?? [],
        trainingIds: trainingIds ?? [],
        initiatedBy: Number(initiatedBy),
        remarks: remarks ?? pip.remarks,
      },
      include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true } } },
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getPIPList = async (req: Request, res: Response) => {
  try {
    const { status, employeeId, triggerMonth, departmentId } = req.query;
    const where: any = {};
    if (status) where.status = String(status);
    if (employeeId) where.employeeId = Number(employeeId);
    if (triggerMonth) where.triggerMonth = String(triggerMonth);
    if (departmentId) where.employee = { departmentId: Number(departmentId) };

    const pips = await prisma.employeePIP.findMany({
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
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const getPIPDetail = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const pip = await prisma.employeePIP.findUnique({
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
    if (!pip) return res.status(404).json({ error: "PIP not found" });

    // Auto-attach weekly rating scores for the PIP period
    let weeklyRatings: any[] = [];
    if (pip.pipStartDate && pip.pipEndDate) {
      weeklyRatings = await prisma.weeklyPerformanceRating.findMany({
        where: {
          employeeId: pip.employeeId,
          weekStartDate: { gte: pip.pipStartDate, lte: pip.pipEndDate },
        },
        select: { id: true, weekStartDate: true, weekEndDate: true, weekLabel: true, overallScore: true },
        orderBy: { weekStartDate: "asc" },
      });
    }

    return res.json({ ...pip, weeklyRatings });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const addWeeklyReview = async (req: Request, res: Response) => {
  try {
    const pipId = Number(req.params.id);
    const { weekNumber, reviewDate, status, remarks, reviewedBy } = req.body;

    if (!weekNumber || !reviewDate || !status || !reviewedBy) {
      return res.status(400).json({ error: "weekNumber, reviewDate, status, reviewedBy are required" });
    }
    if (!["IMPROVED", "NOT_IMPROVED", "ONGOING"].includes(status)) {
      return res.status(400).json({ error: "status must be IMPROVED, NOT_IMPROVED, or ONGOING" });
    }

    const pip = await prisma.employeePIP.findUnique({ where: { id: pipId } });
    if (!pip) return res.status(404).json({ error: "PIP not found" });
    if (!["PIP_ACTIVE", "PIP_EXTENDED"].includes(pip.status)) {
      return res.status(400).json({ error: "PIP must be ACTIVE or EXTENDED to add reviews" });
    }

    const rDate = new Date(reviewDate);
    const weekStart = new Date(rDate);
    weekStart.setDate(weekStart.getDate() - 6);

    // Auto-fetch weekly rating score for this employee in the review week
    const weekRating = await prisma.weeklyPerformanceRating.findFirst({
      where: {
        employeeId: pip.employeeId,
        weekStartDate: { gte: weekStart, lte: rDate },
      },
      orderBy: { weekStartDate: "desc" },
      select: { overallScore: true },
    });

    const review = await prisma.pIPWeeklyReview.create({
      data: {
        pipId,
        weekNumber: Number(weekNumber),
        reviewDate: rDate,
        weeklyScore: weekRating?.overallScore ?? null,
        status,
        remarks: remarks ?? null,
        reviewedBy: Number(reviewedBy),
      },
    });

    return res.status(201).json({ ...review, autoFetchedScore: weekRating?.overallScore ?? null });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const closePIP = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { closedBy, sendEmail, templateId } = req.body;
    if (!closedBy) return res.status(400).json({ error: "closedBy is required" });

    const pip = await prisma.employeePIP.findUnique({
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
    if (!pip) return res.status(404).json({ error: "PIP not found" });
    if (!["PIP_ACTIVE", "PIP_EXTENDED"].includes(pip.status)) {
      return res.status(400).json({ error: `Cannot close PIP from status: ${pip.status}` });
    }

    const updated = await prisma.employeePIP.update({
      where: { id },
      data: { status: "PIP_CLOSED_IMPROVED", closedAt: new Date(), closedBy: Number(closedBy) },
    });

    // Optionally send closure email
    if (sendEmail && templateId) {
      const template = await prisma.pIPEmailTemplate.findUnique({ where: { id: Number(templateId) } });
      if (template && pip.employee.email) {
        const data = buildPlaceholderData(pip.employee, pip);
        const subject = fillPlaceholders(template.subject, data);
        const body = fillPlaceholders(template.body, data);
        let emailStatus = "SENT";
        let errorMessage: string | null = null;
        try {
          await transporter.sendMail({ from: config.smtp.from, to: pip.employee.email, cc: template.cc || undefined, bcc: template.bcc || undefined, subject, html: body });
        } catch (e: any) { emailStatus = "FAILED"; errorMessage = e.message; }
        await prisma.pIPEmailLog.create({
          data: { pipId: id, employeeId: pip.employeeId, templateId: Number(templateId), sentTo: pip.employee.email, subject, body, sentBy: Number(closedBy), status: emailStatus, errorMessage },
        });
      }
    }

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const extendPIP = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { extendedBy, sendEmail, templateId } = req.body;
    if (!extendedBy) return res.status(400).json({ error: "extendedBy is required" });

    const pip = await prisma.employeePIP.findUnique({
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
    if (!pip) return res.status(404).json({ error: "PIP not found" });
    if (pip.status !== "PIP_ACTIVE") return res.status(400).json({ error: "Only PIP_ACTIVE can be extended" });
    if (pip.extendedCount >= 1) return res.status(400).json({ error: "PIP can only be extended once. Proceed to final decision." });

    const newEndDate = addDays(pip.pipEndDate ?? new Date(), 30);

    const updated = await prisma.employeePIP.update({
      where: { id },
      data: { status: "PIP_EXTENDED", pipEndDate: newEndDate, extendedCount: pip.extendedCount + 1 },
    });

    if (sendEmail && templateId) {
      const template = await prisma.pIPEmailTemplate.findUnique({ where: { id: Number(templateId) } });
      if (template && pip.employee.email) {
        const data = buildPlaceholderData(pip.employee, { ...pip, pipEndDate: newEndDate });
        const subject = fillPlaceholders(template.subject, data);
        const body = fillPlaceholders(template.body, data);
        let emailStatus = "SENT"; let errorMessage: string | null = null;
        try { await transporter.sendMail({ from: config.smtp.from, to: pip.employee.email, cc: template.cc || undefined, bcc: template.bcc || undefined, subject, html: body }); }
        catch (e: any) { emailStatus = "FAILED"; errorMessage = e.message; }
        await prisma.pIPEmailLog.create({
          data: { pipId: id, employeeId: pip.employeeId, templateId: Number(templateId), sentTo: pip.employee.email, subject, body, sentBy: Number(extendedBy), status: emailStatus, errorMessage },
        });
      }
    }

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const terminatePIP = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { terminationReason, sentBy, sendEmail, templateId, noticePeriodDaysOverride } = req.body;
    if (!terminationReason || !sentBy) {
      return res.status(400).json({ error: "terminationReason and sentBy are required" });
    }

    const pip = await prisma.employeePIP.findUnique({
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
    if (!pip) return res.status(404).json({ error: "PIP not found" });
    if (!["PIP_ACTIVE", "PIP_EXTENDED"].includes(pip.status)) {
      return res.status(400).json({ error: `Cannot terminate from status: ${pip.status}` });
    }

    const noticeDays = noticePeriodDaysOverride
      ? Number(noticePeriodDaysOverride)
      : pip.employee.dateOfJoining
        ? getNoticePeriodDays(new Date(pip.employee.dateOfJoining))
        : 30;

    const updated = await prisma.employeePIP.update({
      where: { id },
      data: { status: "TERMINATION_INITIATED", terminationReason, noticePeriodDays: noticeDays },
    });

    if (sendEmail && templateId) {
      const template = await prisma.pIPEmailTemplate.findUnique({ where: { id: Number(templateId) } });
      if (template && pip.employee.email) {
        const lastWorkingDay = formatDate(addDays(new Date(), noticeDays));
        const data = buildPlaceholderData(pip.employee, { ...pip, noticePeriodDays: noticeDays }, { noticePeriodDays: noticeDays.toString(), lastWorkingDay });
        const subject = fillPlaceholders(template.subject, data);
        const body = fillPlaceholders(template.body, data);
        let emailStatus = "SENT"; let errorMessage: string | null = null;
        try { await transporter.sendMail({ from: config.smtp.from, to: pip.employee.email, cc: template.cc || undefined, bcc: template.bcc || undefined, subject, html: body }); }
        catch (e: any) { emailStatus = "FAILED"; errorMessage = e.message; }
        await prisma.pIPEmailLog.create({
          data: { pipId: id, employeeId: pip.employeeId, templateId: Number(templateId), sentTo: pip.employee.email, subject, body, sentBy: Number(sentBy), status: emailStatus, errorMessage },
        });
      }
    }

    return res.json({ ...updated, noticePeriodDays: noticeDays, lastWorkingDay: formatDate(addDays(new Date(), noticeDays)) });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL LOGS
// ═══════════════════════════════════════════════════════════════════════════

export const getEmailLogs = async (req: Request, res: Response) => {
  try {
    const { employeeId, pipId, status, from, to } = req.query;
    const where: any = {};
    if (employeeId) where.employeeId = Number(employeeId);
    if (pipId) where.pipId = Number(pipId);
    if (status) where.status = String(status);
    if (from || to) {
      where.sentAt = {};
      if (from) where.sentAt.gte = new Date(String(from));
      if (to) where.sentAt.lte = new Date(String(to));
    }

    const logs = await prisma.pIPEmailLog.findMany({
      where,
      include: {
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        template: { select: { name: true, type: true } },
        pip: { select: { triggerMonth: true, status: true } },
      },
      orderBy: { sentAt: "desc" },
    });

    return res.json(logs);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PIP HISTORY FOR EMPLOYEE
// ═══════════════════════════════════════════════════════════════════════════

export const getEmployeePIPHistory = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const pips = await prisma.employeePIP.findMany({
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
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// EMPLOYEE RESPONDS VIA TOKEN LINK (public)
// ═══════════════════════════════════════════════════════════════════════════

export const respondViaToken = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { responseText } = req.body;

    if (!responseText?.trim()) {
      return res.status(400).json({ error: "Response text is required" });
    }

    const emailLog = await prisma.pIPEmailLog.findUnique({
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

    if (!emailLog) return res.status(404).json({ error: "Invalid or expired link" });
    if (!emailLog.pip) return res.status(400).json({ error: "PIP not found for this token" });

    const closedStatuses = ["PIP_CLOSED_IMPROVED", "TERMINATED"];
    if (closedStatuses.includes(emailLog.pip.status)) {
      return res.status(410).json({ error: "This PIP has been closed. No further responses are accepted." });
    }

    // Check if token was already used
    const alreadyResponded = await prisma.pIPEmployeeResponse.findFirst({
      where: { tokenUsed: token },
    });
    if (alreadyResponded) {
      return res.status(409).json({ error: "You have already submitted a response using this link" });
    }

    const response = await prisma.pIPEmployeeResponse.create({
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
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// HR LOGS MANUAL RESPONSE
// ═══════════════════════════════════════════════════════════════════════════

export const logManualResponse = async (req: Request, res: Response) => {
  try {
    const pipId = Number(req.params.id);
    const { employeeId, responseText } = req.body;

    if (!responseText?.trim()) return res.status(400).json({ error: "Response text required" });

    const pip = await prisma.employeePIP.findUnique({ where: { id: pipId } });
    if (!pip) return res.status(404).json({ error: "PIP not found" });

    const closedStatuses = ["PIP_CLOSED_IMPROVED", "TERMINATED"];
    if (closedStatuses.includes(pip.status)) {
      return res.status(410).json({ error: "This PIP is closed. Responses can only be logged while the PIP is active." });
    }

    const method = req.body.method === "EMPLOYEE_SELF" ? "EMPLOYEE_SELF" : "HR_LOGGED";

    const response = await prisma.pIPEmployeeResponse.create({
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
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// HR ACKNOWLEDGES A RESPONSE
// ═══════════════════════════════════════════════════════════════════════════

export const acknowledgeResponse = async (req: Request, res: Response) => {
  try {
    const responseId = Number(req.params.id);
    const { acknowledgedBy } = req.body;

    const updated = await prisma.pIPEmployeeResponse.update({
      where: { id: responseId },
      data: { acknowledgedBy: Number(acknowledgedBy), acknowledgedAt: new Date() },
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GET ALL RESPONSES FOR A PIP
// ═══════════════════════════════════════════════════════════════════════════

export const getPIPResponses = async (req: Request, res: Response) => {
  try {
    const pipId = Number(req.params.id);

    const responses = await prisma.pIPEmployeeResponse.findMany({
      where: { pipId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      },
      orderBy: { respondedAt: "desc" },
    });

    return res.json(responses);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
