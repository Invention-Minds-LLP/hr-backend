import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";
import crypto from "crypto";

/**
 * Incident Management Controller
 * ──────────────────────────────
 * Industry-neutral. Workflow + outcome are tracked separately:
 *   status   = where in the lifecycle (OPEN → INVESTIGATING → CLOSED)
 *   outcome  = what the investigation concluded (SUBSTANTIATED / FALSE / etc.)
 *
 * All write operations append to IncidentAuditLog so HR/legal can replay
 * the full history of any case.
 */

const SEVERITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const STATUS_VALUES   = ['OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED','RESOLVED','CLOSED','REJECTED','DUPLICATE','WITHDRAWN'] as const;
const OUTCOME_VALUES  = ['SUBSTANTIATED','PARTIALLY_SUBSTANTIATED','UNSUBSTANTIATED','FALSE_REPORT','WITHDRAWN','DUPLICATE','NOT_A_VIOLATION'] as const;

type Severity = typeof SEVERITY_VALUES[number];
type Status   = typeof STATUS_VALUES[number];

// Status transitions allowed — keeps the workflow honest. Anyone trying to
// jump from CLOSED back to OPEN or skip steps is rejected here, not in the DB.
const ALLOWED_TRANSITIONS: Record<Status, Status[]> = {
  OPEN:           ['ACKNOWLEDGED','INVESTIGATING','REJECTED','DUPLICATE','WITHDRAWN'],
  ACKNOWLEDGED:   ['INVESTIGATING','REJECTED','DUPLICATE','WITHDRAWN'],
  INVESTIGATING:  ['ESCALATED','RESOLVED','REJECTED','DUPLICATE','WITHDRAWN'],
  ESCALATED:      ['INVESTIGATING','RESOLVED','REJECTED','DUPLICATE','WITHDRAWN'],
  RESOLVED:       ['CLOSED','INVESTIGATING'],   // can re-open if new info surfaces
  CLOSED:         [],                            // terminal
  REJECTED:       [],
  DUPLICATE:      [],
  WITHDRAWN:      [],
};

/* ════════════════════════════════════════════════════════════════════
   Role helpers — used by createIncident / listIncidents to enforce that
   plain Managers can only act on their direct reports.
   ════════════════════════════════════════════════════════════════════ */

/** True if the requester is HR / HR Manager / Admin / Management — i.e.
 *  unrestricted by the manager-team scope. */
function isPrivilegedRole(user: any): boolean {
  const role = String(user?.role ?? '').toUpperCase();
  const roleId = Number(user?.roleId);
  return ['HR','HR_MANAGER','ADMIN','MANAGEMENT'].includes(role)
      || roleId === 1   // HR
      || roleId === 4;  // Management
}

/** Returns the set of employee ids that report (directly) to the given manager,
 *  including the manager themselves. Empty array if the manager has no team. */
async function getManagerTeam(managerEmpId: number): Promise<number[]> {
  if (!managerEmpId) return [];
  const reports = await prisma.employee.findMany({
    where: { reportingManager: managerEmpId },
    select: { id: true },
  });
  return [managerEmpId, ...reports.map((r) => r.id)];
}

function logAudit(tx: any, incidentId: number, action: string, opts: {
  fromValue?: string | null; toValue?: string | null; note?: string | null; performedBy?: number | null;
} = {}) {
  return tx.incidentAuditLog.create({
    data: {
      incidentId,
      action,
      fromValue: opts.fromValue ?? null,
      toValue:   opts.toValue   ?? null,
      note:      opts.note      ?? null,
      performedBy: opts.performedBy ?? null,
    },
  }).catch((err: any) => {
    // Audit failures must NEVER break business flow.
    console.error(`[incident audit] failed action=${action} on incident ${incidentId}:`, err);
  });
}

/* ════════════════════════════════════════════════════════════════════
   CATEGORIES — admin-tunable list
   ════════════════════════════════════════════════════════════════════ */

export const listCategories = async (req: Request, res: Response) => {
  try {
    // Admin pages pass ?includeInactive=true to see archived categories too.
    const includeInactive = String((req.query as any)?.includeInactive ?? '').toLowerCase() === 'true';
    const cats = await (prisma as any).incidentCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(cats);
  } catch (err) {
    console.error("Error listing categories:", err);
    res.status(500).json({ error: "Failed to list categories" });
  }
};

export const upsertCategory = async (req: Request, res: Response) => {
  try {
    const { id, name, description, defaultSeverity, defaultSlaHours, defaultAssigneeRoleId,
            isAnonymousAllowed, requiresRCAByDefault, requiresExternalReportByDefault, isActive, sortOrder } = req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });

    const data: any = {
      name, description: description ?? null,
      defaultSeverity: defaultSeverity ?? null,
      defaultSlaHours: defaultSlaHours ?? null,
      defaultAssigneeRoleId: defaultAssigneeRoleId ?? null,
      isAnonymousAllowed: isAnonymousAllowed ?? true,
      requiresRCAByDefault: requiresRCAByDefault ?? false,
      requiresExternalReportByDefault: requiresExternalReportByDefault ?? false,
      isActive: isActive ?? true,
      sortOrder: sortOrder ?? 0,
    };

    const cat = id
      ? await (prisma as any).incidentCategory.update({ where: { id: Number(id) }, data })
      : await (prisma as any).incidentCategory.create({ data });
    res.json(cat);
  } catch (err: any) {
    console.error("Error upserting category:", err);
    res.status(500).json({ error: err?.message || "Failed to save category" });
  }
};

/* ════════════════════════════════════════════════════════════════════
   INCIDENT — CREATE
   ════════════════════════════════════════════════════════════════════ */

export const createIncident = async (req: any, res: Response) => {
  try {
    const {
      employeeId, title, description, categoryId, subcategory,
      severity, location, departmentId, incidentDate,
      isAnonymous, confidentiality,
      attachments,            // [{ fileName, fileUrl }]
      witnesses,              // [{ witnessEmpId?, witnessName?, contactInfo?, statement? }]
    } = req.body || {};

    const reporterId: number | null = req.user?.empId ?? req.user?.userId ?? null;

    if (!title?.trim() || !description?.trim() || !categoryId) {
      return res.status(400).json({ error: "title, description and categoryId are required" });
    }

    // ── Manager-team scope on raise ─────────────────────────────────
    // HR / HR Manager / Admin / Management can raise about anyone.
    // Everyone else can raise only:
    //   • about themselves, OR
    //   • about an employee who reports to them, OR
    //   • without a named subject (general report).
    const subjectId = employeeId ? Number(employeeId) : null;
    if (subjectId && reporterId && !isPrivilegedRole(req.user)) {
      const team = await getManagerTeam(reporterId);
      if (!team.includes(subjectId)) {
        return res.status(403).json({
          error: "You can only raise incidents about yourself or your direct reports.",
        });
      }
    }

    // Validate category + enforce its anonymous policy
    const category: any = await (prisma as any).incidentCategory.findUnique({
      where: { id: Number(categoryId) },
    });
    if (!category) return res.status(400).json({ error: "Invalid categoryId" });
    if (!category.isActive) return res.status(400).json({ error: "Category is not active" });
    if (isAnonymous && !category.isAnonymousAllowed) {
      return res.status(400).json({ error: `Anonymous reporting is not allowed for "${category.name}"` });
    }

    const sev: Severity = SEVERITY_VALUES.includes(severity) ? severity
                       : (category.defaultSeverity as Severity ?? 'MEDIUM');

    // Auto-compute due date from category SLA
    const slaHours = Number(category.defaultSlaHours) || 72;
    const reportedAt = new Date();
    const dueDate    = new Date(reportedAt.getTime() + slaHours * 3600 * 1000);

    // Auto-assign by role if category has a default assignee role
    let autoAssigneeId: number | null = null;
    if (category.defaultAssigneeRoleId) {
      const assignee = await prisma.employee.findFirst({
        where: { roleId: category.defaultAssigneeRoleId, employmentStatus: 'ACTIVE' },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      autoAssigneeId = assignee?.id ?? null;
    }

    const incident = await prisma.$transaction(async (tx) => {
      const created = await (tx as any).incident.create({
        data: {
          title:       title.trim(),
          description: description.trim(),
          categoryId:  Number(categoryId),
          subcategory: subcategory ?? null,
          severity:    sev,
          status:      'OPEN',
          isAnonymous: !!isAnonymous,
          confidentiality: confidentiality ?? 'STANDARD',
          requiresRCA:           category.requiresRCAByDefault           ?? false,
          requiresExternalReport: category.requiresExternalReportByDefault ?? false,
          incidentDate: incidentDate ? new Date(incidentDate) : reportedAt,
          reportedAt,
          location:    location ?? null,
          departmentId: departmentId ? Number(departmentId) : null,
          employeeId:  employeeId ? Number(employeeId) : null,
          reportedBy:  isAnonymous ? null : reporterId,
          assignedTo:  autoAssigneeId,
          dueDate,
          attachments: Array.isArray(attachments) && attachments.length
            ? { create: attachments.map((a: any) => ({
                fileName: a.fileName, fileUrl: a.fileUrl,
                uploadedBy: reporterId,
              })) }
            : undefined,
          witnesses: Array.isArray(witnesses) && witnesses.length
            ? { create: witnesses.map((w: any) => ({
                witnessEmpId: w.witnessEmpId ?? null,
                witnessName:  w.witnessName ?? null,
                contactInfo:  w.contactInfo ?? null,
                statement:    w.statement   ?? null,
              })) }
            : undefined,
        },
        include: { attachments: true, witnesses: true, category: true },
      });

      await logAudit(tx, created.id, 'CREATED', {
        toValue: 'OPEN',
        note: `Severity=${sev}, anonymous=${!!isAnonymous}, category=${category.name}`,
        performedBy: isAnonymous ? null : reporterId,
      });
      if (autoAssigneeId) {
        await logAudit(tx, created.id, 'AUTO_ASSIGNED', {
          toValue: String(autoAssigneeId),
          note: `Auto-assigned by category default role`,
          performedBy: null,
        });
      }
      return created;
    }, { timeout: 15000, maxWait: 5000 });

    // ── Notifications (outside the transaction; failures don't roll back) ──
    try {
      // Notify the auto-assignee (if any).
      if (autoAssigneeId) {
        await createNotification(
          autoAssigneeId,
          `🆕 New ${sev} incident assigned to you: "${incident.title}" (${category.name}).`,
        );
      }
      // Notify the subject (named employee). They have a right to know they
      // are involved in a case, even before HR formally reaches out. Skip
      // if the subject is also the reporter (they obviously already know).
      if (subjectId && subjectId !== reporterId) {
        await createNotification(
          subjectId,
          `📩 An incident involving you has been reported in the "${category.name}" category. HR will reach out — visit the Incidents portal for details.`,
        );
      }
      // For HIGH / CRITICAL, also fan out to HR (dept 1) and any management role (4).
      if (sev === 'HIGH' || sev === 'CRITICAL') {
        const escalateTo = await prisma.employee.findMany({
          where: {
            employmentStatus: 'ACTIVE',
            OR: [{ departmentId: 1 }, { roleId: 4 }],
          },
          select: { id: true },
        });
        const seen = new Set<number>();
        if (autoAssigneeId) seen.add(autoAssigneeId);
        for (const e of escalateTo) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          await createNotification(
            e.id,
            `⚠️ ${sev} incident reported: "${incident.title}" (${category.name}). Review in HR portal.`,
          );
        }
      }
    } catch (notifyErr) {
      console.error("[incident notify] failed:", notifyErr);
    }

    res.json({ message: "Incident created", data: incident });
  } catch (err: any) {
    console.error("Error creating incident:", err);
    res.status(500).json({ error: err?.message || "Failed to create incident" });
  }
};

/* ════════════════════════════════════════════════════════════════════
   INCIDENT — LIST + DETAIL (with confidentiality enforcement)
   ════════════════════════════════════════════════════════════════════ */

/** Returns true if the requester is allowed to read MGMT_ONLY / HR_PRIVATE rows. */
function userCanReadConfidential(user: any): { hr: boolean; mgmt: boolean } {
  const role = String(user?.role ?? '').toUpperCase();
  const roleId = Number(user?.roleId);
  // Treat HR_MANAGER + ADMIN + role 1 as HR-level. MANAGEMENT + role 4 as mgmt-level.
  return {
    hr:   ['HR_MANAGER','ADMIN','HR'].includes(role) || roleId === 1,
    mgmt: ['MANAGEMENT','ADMIN'].includes(role)      || roleId === 4,
  };
}

export const listIncidents = async (req: any, res: Response) => {
  try {
    const { status, severity, categoryId, assignedTo, employeeId, q,
            from, to, page = '1', pageSize = '25' } = req.query;
    const me = req.user?.empId ?? req.user?.userId;

    const where: any = {};
    if (status)     where.status   = String(status);
    if (severity)   where.severity = String(severity);
    if (categoryId) where.categoryId = Number(categoryId);
    if (assignedTo) where.assignedTo = Number(assignedTo);
    if (employeeId) where.employeeId = Number(employeeId);
    if (q) {
      where.OR = [
        { title:       { contains: String(q) } },
        { description: { contains: String(q) } },
      ];
    }
    if (from || to) {
      where.incidentDate = {};
      if (from) where.incidentDate.gte = new Date(String(from));
      if (to)   where.incidentDate.lte = new Date(String(to));
    }

    // ── Confidentiality + manager-team scope ─────────────────────────
    // HR / Mgmt / Admin: see everything within the confidentiality gate.
    // Plain manager: see only their team's incidents (subject ∈ team OR
    //   reporter ∈ team) plus anything they're directly involved in.
    // Other employees: see only incidents they reported, were assigned, or
    //   are the subject of.
    const { hr, mgmt } = userCanReadConfidential(req.user);
    const allowedLevels = ['STANDARD'];
    if (hr)   allowedLevels.push('HR_PRIVATE');
    if (mgmt) allowedLevels.push('MGMT_ONLY','HR_PRIVATE');

    if (hr || mgmt) {
      // Privileged: full visibility within confidentiality
      where.OR = (where.OR ?? []).concat([
        { confidentiality: { in: allowedLevels } },
        { OR: [{ reportedBy: me }, { assignedTo: me }, { employeeId: me }] },
      ]);
    } else {
      // Non-privileged: scope by team. Everyone has at least themselves.
      const team = me ? await getManagerTeam(me) : [];
      const involved = [
        { reportedBy: me },
        { assignedTo: me },
        { employeeId: me },
      ];
      const teamScope = team.length > 1   // > 1 means they have direct reports
        ? [
            { employeeId: { in: team } },
            { reportedBy: { in: team } },
          ]
        : [];
      where.AND = [
        ...(where.AND ?? []),
        { confidentiality: { in: allowedLevels } },
        { OR: [...involved, ...teamScope] },
      ];
    }

    const take = Math.min(100, Number(pageSize) || 25);
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;

    const [rows, total] = await Promise.all([
      (prisma as any).incident.findMany({
        where, orderBy: [{ severity: 'desc' }, { reportedAt: 'desc' }],
        take, skip,
        include: {
          category: { select: { id: true, name: true } },
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          reporter: { select: { id: true, firstName: true, lastName: true } },
          _count:   { select: { comments: true, attachments: true, witnesses: true } },
        },
      }),
      (prisma as any).incident.count({ where }),
    ]);

    res.json({ total, rows });
  } catch (err) {
    console.error("Error listing incidents:", err);
    res.status(500).json({ error: "Failed to load incidents" });
  }
};

export const getIncident = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const me = req.user?.empId ?? req.user?.userId;

    const incident: any = await (prisma as any).incident.findUnique({
      where: { id },
      include: {
        category: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, departmentId: true } },
        reporter: { select: { id: true, firstName: true, lastName: true } },
        attachments: { orderBy: { uploadedAt: 'desc' } },
        comments:    { orderBy: { createdAt: 'asc' } },
        witnesses:   { orderBy: { recordedAt: 'asc' } },
        auditLogs:   { orderBy: { performedAt: 'desc' }, take: 100 },
      },
    });
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    // Confidentiality enforcement
    const { hr, mgmt } = userCanReadConfidential(req.user);
    const involved = [incident.reportedBy, incident.assignedTo, incident.employeeId].includes(me);
    if (incident.confidentiality === 'MGMT_ONLY' && !mgmt && !involved) {
      return res.status(403).json({ error: "Restricted by confidentiality" });
    }
    if (incident.confidentiality === 'HR_PRIVATE' && !hr && !mgmt && !involved) {
      return res.status(403).json({ error: "Restricted by confidentiality" });
    }
    res.json(incident);
  } catch (err) {
    console.error("Error fetching incident:", err);
    res.status(500).json({ error: "Failed to load incident" });
  }
};

/* ════════════════════════════════════════════════════════════════════
   INCIDENT — UPDATE / TRANSITIONS
   ════════════════════════════════════════════════════════════════════ */

export const updateIncident = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const me = req.user?.empId ?? req.user?.userId ?? null;
    const body = req.body || {};

    const existing: any = await (prisma as any).incident.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Incident not found" });

    const updates: any = {};
    const auditEntries: { action: string; from?: any; to?: any; note?: string }[] = [];

    // Status transition (validated)
    if (body.status && body.status !== existing.status) {
      if (!STATUS_VALUES.includes(body.status)) {
        return res.status(400).json({ error: `Invalid status. Allowed: ${STATUS_VALUES.join(', ')}` });
      }
      const allowed = ALLOWED_TRANSITIONS[existing.status as Status] || [];
      if (!allowed.includes(body.status)) {
        return res.status(400).json({
          error: `Cannot move from ${existing.status} → ${body.status}. Allowed next: ${allowed.join(', ') || '(terminal)'}`,
        });
      }
      // CAPA-completion gate: cannot CLOSE while corrective/preventive
      // actions are still pending. CANCELLED is treated as completed
      // (the action was explicitly dropped) so it doesn't block closure.
      if (body.status === 'CLOSED') {
        const openCAPAs = await (prisma as any).incidentCAPA.count({
          where: {
            incidentId: id,
            status: { notIn: ['DONE','CANCELLED'] },
          },
        });
        if (openCAPAs > 0) {
          return res.status(400).json({
            error: `Cannot close: ${openCAPAs} corrective/preventive action${openCAPAs === 1 ? '' : 's'} still pending. Mark them DONE or CANCELLED first.`,
          });
        }
      }

      updates.status = body.status;
      // Stamp lifecycle timestamps as we move through
      if (body.status === 'ACKNOWLEDGED' && !existing.acknowledgedAt) updates.acknowledgedAt = new Date();
      if (body.status === 'RESOLVED'     && !existing.resolvedAt)     updates.resolvedAt = new Date();
      if (body.status === 'CLOSED'       && !existing.closedAt)       updates.closedAt = new Date();
      auditEntries.push({ action: 'STATUS_CHANGED', from: existing.status, to: body.status });
    }

    // Outcome (the verdict)
    if (body.outcome !== undefined && body.outcome !== existing.outcome) {
      if (body.outcome !== null && !OUTCOME_VALUES.includes(body.outcome)) {
        return res.status(400).json({ error: `Invalid outcome. Allowed: ${OUTCOME_VALUES.join(', ')}` });
      }
      updates.outcome           = body.outcome;
      updates.outcomeRecordedAt = body.outcome ? new Date() : null;
      updates.outcomeRecordedBy = body.outcome ? me : null;
      auditEntries.push({ action: 'OUTCOME_RECORDED', from: existing.outcome, to: body.outcome });
    }

    // Assignment
    if (body.assignedTo !== undefined && Number(body.assignedTo) !== existing.assignedTo) {
      updates.assignedTo = body.assignedTo ? Number(body.assignedTo) : null;
      auditEntries.push({
        action: 'ASSIGNED',
        from: existing.assignedTo, to: updates.assignedTo,
      });
    }

    // Severity bump (e.g. case turns out worse than first thought)
    if (body.severity && body.severity !== existing.severity) {
      if (!SEVERITY_VALUES.includes(body.severity)) {
        return res.status(400).json({ error: `Invalid severity. Allowed: ${SEVERITY_VALUES.join(', ')}` });
      }
      updates.severity = body.severity;
      auditEntries.push({ action: 'SEVERITY_CHANGED', from: existing.severity, to: body.severity });
    }

    // Free-form fields — just copy across when present
    const passthrough = [
      'rootCause','actionTaken','preventiveAction','rejectionReason',
      'falseReportConsequenceTaken','falseReportConsequenceNote',
      'reportedToAuthority','authorityName','authorityReportNote','authorityReportedAt',
      'requiresRCA','requiresExternalReport','confidentiality','subcategory',
      'location','dueDate','reviewerEmpId',
    ];
    for (const k of passthrough) {
      if (body[k] !== undefined && body[k] !== existing[k]) {
        updates[k] = (k === 'dueDate' || k === 'authorityReportedAt') && body[k]
          ? new Date(body[k]) : body[k];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.json(existing);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await (tx as any).incident.update({ where: { id }, data: updates });
      for (const a of auditEntries) {
        await logAudit(tx, id, a.action, {
          fromValue: a.from != null ? String(a.from) : null,
          toValue:   a.to   != null ? String(a.to)   : null,
          note: a.note ?? null,
          performedBy: me,
        });
      }
      return u;
    });

    // Notify newly-assigned investigator
    if (updates.assignedTo && updates.assignedTo !== existing.assignedTo) {
      try {
        await createNotification(
          updates.assignedTo,
          `📋 You have been assigned an incident: "${existing.title}" — please review.`,
        );
      } catch (e) { console.error("[incident notify reassign] failed:", e); }
    }
    // Notify reporter on status change (if not anonymous)
    if (updates.status && existing.reportedBy) {
      try {
        await createNotification(
          existing.reportedBy,
          `🔔 Your incident "${existing.title}" is now ${updates.status}.`,
        );
      } catch (e) { console.error("[incident notify reporter] failed:", e); }
    }
    // Notify the subject employee on key milestones (acknowledged / resolved /
    // closed / rejected). They have a stake in the case and should be told
    // when the verdict lands. Skip if the subject is also the reporter.
    if (
      updates.status &&
      existing.employeeId &&
      existing.employeeId !== existing.reportedBy &&
      ['ACKNOWLEDGED','RESOLVED','CLOSED','REJECTED'].includes(updates.status)
    ) {
      try {
        const verb =
          updates.status === 'ACKNOWLEDGED' ? 'has been acknowledged by HR' :
          updates.status === 'RESOLVED'     ? 'has been resolved' :
          updates.status === 'CLOSED'       ? 'has been closed' :
                                              'was reviewed and no further action will be taken';
        await createNotification(
          existing.employeeId,
          `📌 The incident involving you, "${existing.title}", ${verb}.`,
        );
      } catch (e) { console.error("[incident notify subject] failed:", e); }
    }

    res.json(updated);
  } catch (err: any) {
    console.error("Error updating incident:", err);
    res.status(500).json({ error: err?.message || "Failed to update incident" });
  }
};

/* ════════════════════════════════════════════════════════════════════
   COMMENTS / WITNESSES / ATTACHMENTS
   ════════════════════════════════════════════════════════════════════ */

export const addComment = async (req: any, res: Response) => {
  try {
    const incidentId = Number(req.params.id);
    const me = req.user?.empId ?? req.user?.userId;
    const { body, isInternal } = req.body || {};
    if (!body?.trim()) return res.status(400).json({ error: "body is required" });

    const exists = await (prisma as any).incident.findUnique({ where: { id: incidentId }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: "Incident not found" });

    const comment = await (prisma as any).incidentComment.create({
      data: { incidentId, authorId: me, body: body.trim(), isInternal: !!isInternal },
    });
    await logAudit(prisma, incidentId, 'COMMENTED', { performedBy: me, note: body.slice(0, 200) });
    res.status(201).json(comment);
  } catch (err: any) {
    console.error("Error adding comment:", err);
    res.status(500).json({ error: err?.message || "Failed to add comment" });
  }
};

export const addWitness = async (req: any, res: Response) => {
  try {
    const incidentId = Number(req.params.id);
    const me = req.user?.empId ?? req.user?.userId;
    const { witnessEmpId, witnessName, contactInfo, statement } = req.body || {};
    if (!witnessEmpId && !witnessName) {
      return res.status(400).json({ error: "Either witnessEmpId or witnessName is required" });
    }
    const witness = await (prisma as any).incidentWitness.create({
      data: {
        incidentId,
        witnessEmpId: witnessEmpId ? Number(witnessEmpId) : null,
        witnessName: witnessName ?? null,
        contactInfo: contactInfo ?? null,
        statement:   statement   ?? null,
      },
    });
    await logAudit(prisma, incidentId, 'WITNESS_ADDED', { performedBy: me, note: witnessName ?? `emp#${witnessEmpId}` });
    res.status(201).json(witness);
  } catch (err: any) {
    console.error("Error adding witness:", err);
    res.status(500).json({ error: err?.message || "Failed to add witness" });
  }
};

export const addAttachment = async (req: any, res: Response) => {
  try {
    const incidentId = Number(req.params.id);
    const me = req.user?.empId ?? req.user?.userId;
    const { fileName, fileUrl } = req.body || {};
    if (!fileName?.trim() || !fileUrl?.trim()) {
      return res.status(400).json({ error: "fileName and fileUrl are required" });
    }
    const att = await (prisma as any).incidentAttachment.create({
      data: { incidentId, fileName, fileUrl, uploadedBy: me },
    });
    await logAudit(prisma, incidentId, 'ATTACHMENT_ADDED', { performedBy: me, note: fileName });
    res.status(201).json(att);
  } catch (err: any) {
    console.error("Error adding attachment:", err);
    res.status(500).json({ error: err?.message || "Failed to add attachment" });
  }
};

export const deleteAttachment = async (req: any, res: Response) => {
  try {
    const docId = Number(req.params.attachmentId);
    const att: any = await (prisma as any).incidentAttachment.findUnique({ where: { id: docId } });
    if (!att) return res.status(404).json({ error: "Attachment not found" });
    await (prisma as any).incidentAttachment.delete({ where: { id: docId } });
    await logAudit(prisma, att.incidentId, 'ATTACHMENT_REMOVED', { performedBy: req.user?.empId ?? null, note: att.fileName });
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Error deleting attachment:", err);
    res.status(500).json({ error: err?.message || "Failed to delete attachment" });
  }
};

/* ════════════════════════════════════════════════════════════════════
   SUBJECT-VIEW (employee self-portal) — redacted endpoints
   ────────────────────────────────────────────────────────────────────
   Used by the "About Me" section on the Individual page. Returns ONLY
   the rows where the logged-in employee is the named subject AND the
   case has been formally communicated (status > OPEN). The shape is
   redacted vs. the HR view:
     • reporter / assignedTo identities are stripped
     • internal comments are filtered out
     • witnesses, attachments, RCA, audit log are NOT returned
     • outcome / root-cause / actions only after status RESOLVED
   ════════════════════════════════════════════════════════════════════ */

/** GET /incidents/mine — list of my-as-subject incidents, OPEN excluded. */
export const listMyIncidents = async (req: any, res: Response) => {
  try {
    const me = req.user?.empId ?? req.user?.userId;
    if (!me) return res.status(401).json({ error: "Authentication required" });

    const rows = await (prisma as any).incident.findMany({
      where: {
        employeeId: Number(me),
        status: { not: 'OPEN' },        // hide until HR formally acknowledges
      },
      orderBy: [{ severity: 'desc' }, { reportedAt: 'desc' }],
      select: {
        id: true, title: true, severity: true, status: true,
        reportedAt: true, acknowledgedAt: true, resolvedAt: true, closedAt: true,
        isAnonymous: true, dueDate: true,
        category: { select: { id: true, name: true } },
      },
    });
    res.json({ total: rows.length, rows });
  } catch (err) {
    console.error("Error listing my incidents:", err);
    res.status(500).json({ error: "Failed to load your incidents" });
  }
};

/** GET /incidents/mine/:id — redacted detail. 404 if I'm not the subject
 *  or if the case is still OPEN (don't leak existence either way). */
export const getMyIncident = async (req: any, res: Response) => {
  try {
    const me = req.user?.empId ?? req.user?.userId;
    if (!me) return res.status(401).json({ error: "Authentication required" });
    const id = Number(req.params.id);

    const inc: any = await (prisma as any).incident.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, description: true } },
        comments: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
          select: { id: true, body: true, createdAt: true, authorId: true, isInternal: true },
        },
        capaActions: {
          where: { ownerId: Number(me) },     // only the subject's own CAPA tasks
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, type: true, description: true,
            dueDate: true, status: true, completedAt: true,
          },
        },
      },
    });

    // Treat "not the subject" and "still OPEN" identically — return 404 so
    // the existence of the case isn't leaked.
    if (!inc || inc.employeeId !== Number(me) || inc.status === 'OPEN') {
      return res.status(404).json({ error: "Not found" });
    }

    const isResolvedOrLater = ['RESOLVED','CLOSED','REJECTED','DUPLICATE','WITHDRAWN'].includes(inc.status);

    // Redacted view — strip reporter/assignedTo/witness data, expose
    // outcome fields only after RESOLVED.
    res.json({
      id: inc.id,
      title: inc.title,
      description: inc.description,
      subcategory: inc.subcategory,
      severity: inc.severity,
      status: inc.status,
      isAnonymous: inc.isAnonymous,
      location: inc.location,
      reportedAt: inc.reportedAt,
      incidentDate: inc.incidentDate,
      acknowledgedAt: inc.acknowledgedAt,
      resolvedAt: inc.resolvedAt,
      closedAt: inc.closedAt,
      dueDate: inc.dueDate,
      category: inc.category,
      comments: inc.comments,
      capa: inc.capaActions,
      // Outcome block — only after RESOLVED
      outcome:           isResolvedOrLater ? inc.outcome           : null,
      rootCause:         isResolvedOrLater ? inc.rootCause         : null,
      actionTaken:       isResolvedOrLater ? inc.actionTaken       : null,
      preventiveAction:  isResolvedOrLater ? inc.preventiveAction  : null,
      rejectionReason:   inc.status === 'REJECTED' ? inc.rejectionReason : null,
    });
  } catch (err) {
    console.error("Error fetching my incident:", err);
    res.status(500).json({ error: "Failed to load incident" });
  }
};

/** POST /incidents/mine/:id/comments — subject posts their statement.
 *  Always non-internal (HR sees it). Allowed only while the case is
 *  active (between ACKNOWLEDGED and RESOLVED). */
export const addMyComment = async (req: any, res: Response) => {
  try {
    const me = req.user?.empId ?? req.user?.userId;
    if (!me) return res.status(401).json({ error: "Authentication required" });
    const id = Number(req.params.id);
    const { body } = req.body || {};
    if (!body?.trim()) return res.status(400).json({ error: "body is required" });

    const inc: any = await (prisma as any).incident.findUnique({
      where: { id },
      select: { id: true, employeeId: true, status: true },
    });
    if (!inc || inc.employeeId !== Number(me) || inc.status === 'OPEN') {
      return res.status(404).json({ error: "Not found" });
    }
    if (!['ACKNOWLEDGED','INVESTIGATING','ESCALATED','RESOLVED'].includes(inc.status)) {
      return res.status(400).json({
        error: "This case is closed; no further statements can be added.",
      });
    }

    const comment = await (prisma as any).incidentComment.create({
      data: { incidentId: id, authorId: Number(me), body: body.trim(), isInternal: false },
    });
    await logAudit(prisma, id, 'SUBJECT_STATEMENT', { performedBy: Number(me), note: body.slice(0, 200) });
    res.status(201).json(comment);
  } catch (err: any) {
    console.error("Error posting subject comment:", err);
    res.status(500).json({ error: err?.message || "Failed to post statement" });
  }
};

/* ════════════════════════════════════════════════════════════════════
   LEGACY endpoints (kept so the existing UI doesn't break)
   ════════════════════════════════════════════════════════════════════ */

export const listIncidentsByReporter = async (req: any, res: Response) => {
  try {
    const reporterId = Number(req.params.reporterId);
    const list = await (prisma as any).incident.findMany({
      where: { reportedBy: reporterId },
      include: {
        employee: true, reporter: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { reportedAt: "desc" },
    });
    res.json(list);
  } catch (err) {
    console.error("Error fetching incidents:", err);
    res.status(500).json({ error: "Failed to load incidents" });
  }
};

export const listIncidentsByEmployee = async (req: any, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const list = await (prisma as any).incident.findMany({
      where: { employeeId },
      include: {
        employee: true, reporter: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { reportedAt: "desc" },
    });
    res.json(list);
  } catch (err) {
    console.error("Error fetching incidents:", err);
    res.status(500).json({ error: "Failed to load incidents" });
  }
};

// Kept for back-compat; delegates to the new paginated `listIncidents`.
export const listAllIncidents = listIncidents;

/* ════════════════════════════════════════════════════════════════════
   PHASE 2 — INVESTIGATION TOOLS
   ════════════════════════════════════════════════════════════════════ */

const CAPA_TYPES    = ['CORRECTIVE', 'PREVENTIVE'] as const;
const CAPA_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
const RCA_METHODS   = ['FIVE_WHY', 'FISHBONE'] as const;

/* ─── CAPA — Corrective & Preventive Actions ──────────────────────── */

export const listCAPA = async (req: any, res: Response) => {
  try {
    const incidentId = Number(req.params.id);
    const rows = await (prisma as any).incidentCAPA.findMany({
      where: { incidentId },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(rows);
  } catch (err) {
    console.error("Error listing CAPA:", err);
    res.status(500).json({ error: "Failed to list CAPA actions" });
  }
};

export const createCAPA = async (req: any, res: Response) => {
  try {
    const incidentId = Number(req.params.id);
    const me = req.user?.empId ?? req.user?.userId ?? null;
    const { type, description, ownerId, dueDate } = req.body || {};

    if (!description?.trim()) {
      return res.status(400).json({ error: "description is required" });
    }
    const capaType = CAPA_TYPES.includes(type) ? type : 'CORRECTIVE';

    const exists = await (prisma as any).incident.findUnique({ where: { id: incidentId }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: "Incident not found" });

    const capa = await prisma.$transaction(async (tx) => {
      const created = await (tx as any).incidentCAPA.create({
        data: {
          incidentId,
          type:        capaType,
          description: description.trim(),
          ownerId:     ownerId ? Number(ownerId) : null,
          dueDate:     dueDate ? new Date(dueDate) : null,
          status:      'PENDING',
          createdBy:   me,
        },
      });
      await logAudit(tx, incidentId, 'CAPA_ADDED', {
        toValue: capaType,
        note: description.slice(0, 200),
        performedBy: me,
      });
      return created;
    });

    // Notify the assigned owner so they know action is pending on them
    if (capa.ownerId) {
      try {
        await createNotification(
          capa.ownerId,
          `🛠 You have been assigned a ${capaType.toLowerCase()} action on incident #${incidentId}` +
          (capa.dueDate ? ` (due ${new Date(capa.dueDate).toLocaleDateString()})` : '') + '.',
        );
      } catch (e) {
        console.error("[CAPA notify owner] failed:", e);
      }
    }
    res.status(201).json(capa);
  } catch (err: any) {
    console.error("Error creating CAPA:", err);
    res.status(500).json({ error: err?.message || "Failed to create CAPA" });
  }
};

export const updateCAPA = async (req: any, res: Response) => {
  try {
    const capaId = Number(req.params.capaId);
    const me = req.user?.empId ?? req.user?.userId ?? null;
    const body = req.body || {};

    const existing: any = await (prisma as any).incidentCAPA.findUnique({ where: { id: capaId } });
    if (!existing) return res.status(404).json({ error: "CAPA not found" });

    const updates: any = {};
    const auditNotes: string[] = [];

    if (body.type && body.type !== existing.type) {
      if (!CAPA_TYPES.includes(body.type)) {
        return res.status(400).json({ error: `Invalid type. Allowed: ${CAPA_TYPES.join(', ')}` });
      }
      updates.type = body.type;
      auditNotes.push(`type: ${existing.type} → ${body.type}`);
    }
    if (body.status && body.status !== existing.status) {
      if (!CAPA_STATUSES.includes(body.status)) {
        return res.status(400).json({ error: `Invalid status. Allowed: ${CAPA_STATUSES.join(', ')}` });
      }
      updates.status = body.status;
      auditNotes.push(`status: ${existing.status} → ${body.status}`);
      // Stamp completion when transitioning into DONE for the first time
      if (body.status === 'DONE' && !existing.completedAt) {
        updates.completedAt = new Date();
      }
    }
    if (body.description !== undefined && body.description !== existing.description) {
      if (!body.description?.trim()) return res.status(400).json({ error: "description cannot be empty" });
      updates.description = body.description.trim();
    }
    if (body.ownerId !== undefined && Number(body.ownerId) !== existing.ownerId) {
      updates.ownerId = body.ownerId ? Number(body.ownerId) : null;
      auditNotes.push(`owner: ${existing.ownerId ?? 'none'} → ${updates.ownerId ?? 'none'}`);
    }
    if (body.dueDate !== undefined) {
      updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }
    if (body.completedNote !== undefined) {
      updates.completedNote = body.completedNote ?? null;
    }

    if (Object.keys(updates).length === 0) return res.json(existing);

    const updated = await prisma.$transaction(async (tx) => {
      const u = await (tx as any).incidentCAPA.update({ where: { id: capaId }, data: updates });
      if (auditNotes.length) {
        await logAudit(tx, existing.incidentId, 'CAPA_UPDATED', {
          note: auditNotes.join(' · '),
          performedBy: me,
        });
      }
      return u;
    });

    // Notifications
    try {
      // New owner assigned → ping them
      if (updates.ownerId && updates.ownerId !== existing.ownerId) {
        await createNotification(
          updates.ownerId,
          `🛠 You have been assigned a CAPA action on incident #${existing.incidentId}.`,
        );
      }
      // Marked DONE → ping the original creator + incident assignee for review
      if (updates.status === 'DONE' && existing.status !== 'DONE') {
        const incident: any = await (prisma as any).incident.findUnique({
          where: { id: existing.incidentId },
          select: { assignedTo: true, title: true },
        });
        const recipients = new Set<number>();
        if (existing.createdBy) recipients.add(existing.createdBy);
        if (incident?.assignedTo) recipients.add(incident.assignedTo);
        recipients.delete(me ?? -1);   // don't notify the doer themselves
        for (const id of recipients) {
          await createNotification(
            id,
            `✅ A CAPA action on incident #${existing.incidentId} has been marked DONE.`,
          );
        }
      }
    } catch (e) {
      console.error("[CAPA notify] failed:", e);
    }
    res.json(updated);
  } catch (err: any) {
    console.error("Error updating CAPA:", err);
    res.status(500).json({ error: err?.message || "Failed to update CAPA" });
  }
};

export const deleteCAPA = async (req: any, res: Response) => {
  try {
    const capaId = Number(req.params.capaId);
    const me = req.user?.empId ?? req.user?.userId ?? null;
    const existing: any = await (prisma as any).incidentCAPA.findUnique({ where: { id: capaId } });
    if (!existing) return res.status(404).json({ error: "CAPA not found" });

    await (prisma as any).incidentCAPA.delete({ where: { id: capaId } });
    await logAudit(prisma, existing.incidentId, 'CAPA_REMOVED', {
      note: `Removed: ${String(existing.description).slice(0, 200)}`,
      performedBy: me,
    });
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Error deleting CAPA:", err);
    res.status(500).json({ error: err?.message || "Failed to delete CAPA" });
  }
};

/* ─── RCA — Root Cause Analysis (5-Why or Fishbone) ───────────────── */

/**
 * Upsert the RCA record for an incident. One incident = one RCA. The body
 * can carry either 5-Why fields (`why1`..`why5`) or Fishbone fields
 * (`causesPeople`, `causesProcess`, ...) depending on `method`.
 */
export const upsertRCA = async (req: any, res: Response) => {
  try {
    const incidentId = Number(req.params.id);
    const me = req.user?.empId ?? req.user?.userId ?? null;
    const body = req.body || {};

    if (body.method && !RCA_METHODS.includes(body.method)) {
      return res.status(400).json({ error: `Invalid method. Allowed: ${RCA_METHODS.join(', ')}` });
    }

    const incident: any = await (prisma as any).incident.findUnique({
      where: { id: incidentId }, select: { id: true, requiresRCA: true },
    });
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    const data: any = {
      method:           body.method ?? 'FIVE_WHY',
      problemStatement: body.problemStatement ?? null,
      rootCauseSummary: body.rootCauseSummary ?? null,
      // 5-Why
      why1: body.why1 ?? null, why2: body.why2 ?? null, why3: body.why3 ?? null,
      why4: body.why4 ?? null, why5: body.why5 ?? null,
      // Fishbone
      causesPeople:      body.causesPeople ?? null,
      causesProcess:     body.causesProcess ?? null,
      causesEquipment:   body.causesEquipment ?? null,
      causesEnvironment: body.causesEnvironment ?? null,
      causesMaterial:    body.causesMaterial ?? null,
      causesMethod:      body.causesMethod ?? null,
      conductedBy:       me,
    };

    const existing: any = await (prisma as any).incidentRCA.findUnique({ where: { incidentId } });

    const saved = await prisma.$transaction(async (tx) => {
      const row = existing
        ? await (tx as any).incidentRCA.update({ where: { incidentId }, data })
        : await (tx as any).incidentRCA.create({ data: { ...data, incidentId } });

      await logAudit(tx, incidentId, existing ? 'RCA_UPDATED' : 'RCA_CREATED', {
        toValue: data.method,
        note: data.rootCauseSummary?.slice(0, 200) ?? null,
        performedBy: me,
      });

      // If incident is flagged requiresRCA but didn't have one yet, also
      // bubble that up via a status note — the close action will check this.
      return row;
    });
    res.json(saved);
  } catch (err: any) {
    console.error("Error saving RCA:", err);
    res.status(500).json({ error: err?.message || "Failed to save RCA" });
  }
};

export const getRCA = async (req: any, res: Response) => {
  try {
    const incidentId = Number(req.params.id);
    const rca = await (prisma as any).incidentRCA.findUnique({ where: { incidentId } });
    res.json(rca);
  } catch (err) {
    console.error("Error fetching RCA:", err);
    res.status(500).json({ error: "Failed to load RCA" });
  }
};

/* ─── Linked Incidents (parent ↔ child) ────────────────────────────── */

/**
 * Mark this incident as a child of `parentIncidentId` so investigators can
 * group related cases under one root cause. The parent must be a different
 * incident (no self-link) and the parent itself can't already point to this
 * incident as its parent (no two-cycle loops).
 */
export const linkIncident = async (req: any, res: Response) => {
  try {
    const childId  = Number(req.params.id);
    const parentId = Number(req.body?.parentIncidentId);
    const me = req.user?.empId ?? req.user?.userId ?? null;

    if (!parentId) return res.status(400).json({ error: "parentIncidentId is required" });
    if (parentId === childId) return res.status(400).json({ error: "Cannot link an incident to itself" });

    const [child, parent]: any[] = await Promise.all([
      (prisma as any).incident.findUnique({ where: { id: childId },  select: { id: true } }),
      (prisma as any).incident.findUnique({ where: { id: parentId }, select: { id: true, parentIncidentId: true } }),
    ]);
    if (!child)  return res.status(404).json({ error: "Incident not found" });
    if (!parent) return res.status(404).json({ error: "Parent incident not found" });
    if (parent.parentIncidentId === childId) {
      return res.status(400).json({ error: "Linking would create a cycle" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await (tx as any).incident.update({
        where: { id: childId },
        data:  { parentIncidentId: parentId },
      });
      await logAudit(tx, childId, 'LINKED_TO_PARENT', {
        toValue: String(parentId),
        note: `Linked to incident #${parentId}`,
        performedBy: me,
      });
      return u;
    });
    res.json({ ok: true, parentIncidentId: updated.parentIncidentId });
  } catch (err: any) {
    console.error("Error linking incident:", err);
    res.status(500).json({ error: err?.message || "Failed to link incident" });
  }
};

export const unlinkIncident = async (req: any, res: Response) => {
  try {
    const childId = Number(req.params.id);
    const me = req.user?.empId ?? req.user?.userId ?? null;

    const existing: any = await (prisma as any).incident.findUnique({
      where: { id: childId }, select: { id: true, parentIncidentId: true },
    });
    if (!existing) return res.status(404).json({ error: "Incident not found" });
    if (!existing.parentIncidentId) return res.json({ ok: true, parentIncidentId: null });

    await prisma.$transaction(async (tx) => {
      await (tx as any).incident.update({
        where: { id: childId },
        data:  { parentIncidentId: null },
      });
      await logAudit(tx, childId, 'UNLINKED_FROM_PARENT', {
        fromValue: String(existing.parentIncidentId),
        note: `Removed link to incident #${existing.parentIncidentId}`,
        performedBy: me,
      });
    });
    res.json({ ok: true, parentIncidentId: null });
  } catch (err: any) {
    console.error("Error unlinking incident:", err);
    res.status(500).json({ error: err?.message || "Failed to unlink incident" });
  }
};

/* ════════════════════════════════════════════════════════════════════
   PHASE 3 — DASHBOARD
   ════════════════════════════════════════════════════════════════════ */

/**
 * GET /incidents/dashboard
 *
 * Single consolidated analytics endpoint. Returns everything the incident
 * dashboard needs in one round-trip. Each section answers a specific
 * recruiter / HR question:
 *
 *  KPIs:
 *   • openCount               — currently un-closed incidents
 *   • criticalOpenCount       — CRITICAL or HIGH severity, not yet CLOSED
 *   • slaBreachCount          — past dueDate, still un-closed
 *   • avgResolutionDays       — closed-incident average over last 90 days
 *   • capaOverdueCount        — CAPA actions past their dueDate, not DONE
 *   • mandatoryReportingDue   — flagged requiresExternalReport, not yet reported
 *
 *  Breakdowns:
 *   • bySeverity              — counts of all-time incidents per severity
 *   • byStatus                — counts per status
 *   • byCategory              — counts per category
 *   • byOutcome               — counts per outcome (only for closed cases)
 *
 *  Trends:
 *   • trendByMonth            — last 6 months, count of new incidents
 *
 *  Hotspots / leaderboards:
 *   • hotSpotLocations        — top 5 locations with most incidents
 *   • topAssignees            — top 5 employees by current open-count
 *   • repeatEmployees         — employees in 3+ incidents over last quarter
 *
 *  Actionable lists:
 *   • slaBreaching            — list of incidents to act on now
 *   • capaOverdue             — list of overdue CAPA actions
 *   • recentActivity          — last 15 audit events for the activity feed
 */
export const getIncidentDashboard = async (_req: any, res: Response) => {
  try {
    const now            = new Date();
    const ninetyDaysAgo  = new Date(now.getTime() - 90 * 86400000);
    const quarterAgo     = new Date(now.getTime() - 90 * 86400000);
    const sixMonthsAgo   = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    // Statuses considered "still in flight"
    const OPEN_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'RESOLVED'];

    const [
      // KPIs
      openCount,
      criticalOpenCount,
      slaBreachIncidents,
      closedRecent,
      capaOverdueRows,
      mandatoryReportingDueCount,
      // Breakdowns
      bySeverityRaw,
      byStatusRaw,
      byCategoryRaw,
      byOutcomeRaw,
      // Trend (last 6 months)
      trendRows,
      // Hot-spots
      hotSpotsRaw,
      // Top assignees
      topAssigneesRaw,
      // Repeat employees
      repeatEmployeesRaw,
      // Actionable lists
      slaBreachingList,
      capaOverdueList,
      recentActivityRaw,
    ] = await Promise.all([
      (prisma as any).incident.count({ where: { status: { in: OPEN_STATUSES } } }),
      (prisma as any).incident.count({
        where: { status: { in: OPEN_STATUSES }, severity: { in: ['CRITICAL', 'HIGH'] } },
      }),
      // For SLA-breach KPI we just need the count, but list is also pulled below
      (prisma as any).incident.count({
        where: { status: { in: OPEN_STATUSES }, dueDate: { lt: now } },
      }),
      // Recent closed incidents (for avg resolution)
      (prisma as any).incident.findMany({
        where: { status: 'CLOSED', closedAt: { gte: ninetyDaysAgo } },
        select: { reportedAt: true, closedAt: true },
        take: 200,
      }),
      // Overdue CAPA actions
      (prisma as any).incidentCAPA.findMany({
        where: {
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          dueDate: { lt: now },
        },
        select: { id: true },
      }),
      (prisma as any).incident.count({
        where: { requiresExternalReport: true, reportedToAuthority: false },
      }),
      // Severity counts
      (prisma as any).incident.groupBy({
        by: ['severity'],
        _count: { id: true },
      }),
      // Status counts
      (prisma as any).incident.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      // Category counts
      (prisma as any).incident.groupBy({
        by: ['categoryId'],
        _count: { id: true },
      }),
      // Outcome distribution (closed cases only)
      (prisma as any).incident.groupBy({
        by: ['outcome'],
        where: { outcome: { not: null } },
        _count: { id: true },
      }),
      // Trend — fetch ids + reportedAt for last 6 months and bucket client-side
      (prisma as any).incident.findMany({
        where: { reportedAt: { gte: sixMonthsAgo } },
        select: { id: true, reportedAt: true },
        take: 5000,
      }),
      // Hotspots — locations with most incidents (last 6 months)
      (prisma as any).incident.groupBy({
        by: ['location'],
        where: { location: { not: null }, reportedAt: { gte: sixMonthsAgo } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
      // Top assignees by current open-count
      (prisma as any).incident.groupBy({
        by: ['assignedTo'],
        where: { assignedTo: { not: null }, status: { in: OPEN_STATUSES } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
      // Repeat employees — same employee in 3+ incidents this quarter
      (prisma as any).incident.groupBy({
        by: ['employeeId'],
        where: { employeeId: { not: null }, reportedAt: { gte: quarterAgo } },
        _count: { id: true },
        having: { id: { _count: { gte: 3 } } },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      // Actionable list — SLA-breaching open incidents
      (prisma as any).incident.findMany({
        where: { status: { in: OPEN_STATUSES }, dueDate: { lt: now } },
        select: {
          id: true, title: true, severity: true, status: true,
          dueDate: true, reportedAt: true, assignedTo: true,
          category: { select: { name: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
      // Actionable list — overdue CAPA (with owner + parent incident title)
      (prisma as any).incidentCAPA.findMany({
        where: {
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          dueDate: { lt: now },
        },
        select: {
          id: true, type: true, description: true, ownerId: true, dueDate: true,
          status: true, incidentId: true,
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
      // Recent activity — last 15 audit events
      (prisma as any).incidentAuditLog.findMany({
        select: {
          id: true, incidentId: true, action: true, fromValue: true, toValue: true,
          note: true, performedAt: true, performedBy: true,
        },
        orderBy: { performedAt: 'desc' },
        take: 15,
      }),
    ]);

    // ── KPI: avg resolution days ───────────────────────────────
    const resolutionDays = closedRecent
      .filter((c: any) => c.closedAt && c.reportedAt)
      .map((c: any) => (c.closedAt.getTime() - c.reportedAt.getTime()) / 86400000);
    const avgResolutionDays = resolutionDays.length
      ? Math.round((resolutionDays.reduce((s: number, x: number) => s + x, 0) / resolutionDays.length) * 10) / 10
      : 0;

    // ── Breakdown: bySeverity (in display order) ───────────────
    const SEV_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const sevMap = new Map<string, number>(
      bySeverityRaw.map((r: any) => [r.severity as string, Number(r._count.id) || 0] as [string, number]),
    );
    const bySeverity = SEV_ORDER.map((s) => ({ severity: s, count: sevMap.get(s) ?? 0 }));

    // ── Breakdown: byStatus (in workflow order) ────────────────
    const STATUS_ORDER = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REJECTED', 'DUPLICATE', 'WITHDRAWN'];
    const statMap = new Map<string, number>(
      byStatusRaw.map((r: any) => [r.status as string, Number(r._count.id) || 0] as [string, number]),
    );
    const byStatus = STATUS_ORDER.map((s) => ({ status: s, count: statMap.get(s) ?? 0 }))
      .filter((b) => b.count > 0);

    // ── Breakdown: byCategory (hydrate names) ──────────────────
    const catIds = byCategoryRaw.map((r: any) => r.categoryId).filter((x: any) => x != null);
    const cats = catIds.length
      ? await (prisma as any).incidentCategory.findMany({
          where: { id: { in: catIds } },
          select: { id: true, name: true },
        })
      : [];
    const catNameMap = new Map(cats.map((c: any) => [c.id, c.name]));
    const byCategory = byCategoryRaw
      .map((r: any) => ({
        categoryId: r.categoryId,
        categoryName: r.categoryId != null ? (catNameMap.get(r.categoryId) ?? `#${r.categoryId}`) : 'Uncategorised',
        count: r._count.id,
      }))
      .sort((a: any, b: any) => b.count - a.count);

    // ── Breakdown: byOutcome ───────────────────────────────────
    const byOutcome = byOutcomeRaw
      .map((r: any) => ({ outcome: r.outcome, count: r._count.id }))
      .sort((a: any, b: any) => b.count - a.count);

    // ── Trend: bucket the last-6-months rows by YYYY-MM ───────
    const monthBuckets = new Map<string, number>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthBuckets.set(key, 0);
    }
    for (const row of trendRows) {
      const t = row.reportedAt as Date;
      const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
      if (monthBuckets.has(key)) monthBuckets.set(key, (monthBuckets.get(key) ?? 0) + 1);
    }
    const trendByMonth = Array.from(monthBuckets.entries()).map(([month, count]) => ({ month, count }));

    // ── Hotspots ───────────────────────────────────────────────
    const hotSpotLocations = hotSpotsRaw.map((r: any) => ({
      location: r.location, count: r._count.id,
    }));

    // ── Top assignees (hydrate names) ─────────────────────────
    const assigneeIds = topAssigneesRaw.map((r: any) => r.assignedTo).filter((x: any) => x);
    const assigneeEmps = assigneeIds.length
      ? await prisma.employee.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, firstName: true, lastName: true, employeeCode: true,
            Department: { select: { name: true } } },
        })
      : [];
    const assigneeMap = new Map(assigneeEmps.map((e) => [e.id, e]));
    const topAssignees = topAssigneesRaw.map((r: any) => {
      const emp = assigneeMap.get(r.assignedTo);
      return {
        employeeId: r.assignedTo,
        name: emp ? `${emp.firstName} ${emp.lastName}` : `Employee #${r.assignedTo}`,
        employeeCode: emp?.employeeCode ?? '—',
        dept: emp?.Department?.name ?? '—',
        openCount: r._count.id,
      };
    });

    // ── Repeat employees (hydrate names) ──────────────────────
    const repeatIds = repeatEmployeesRaw.map((r: any) => r.employeeId).filter((x: any) => x);
    const repeatEmps = repeatIds.length
      ? await prisma.employee.findMany({
          where: { id: { in: repeatIds } },
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        })
      : [];
    const repeatEmpMap = new Map(repeatEmps.map((e) => [e.id, e]));
    const repeatEmployees = repeatEmployeesRaw.map((r: any) => {
      const emp = repeatEmpMap.get(r.employeeId);
      return {
        employeeId: r.employeeId,
        name: emp ? `${emp.firstName} ${emp.lastName}` : `Employee #${r.employeeId}`,
        employeeCode: emp?.employeeCode ?? '—',
        incidentCount: r._count.id,
      };
    });

    // ── SLA-breaching list (with days-overdue + assignee name) ─
    const slaBreachAssigneeIds: number[] = Array.from(new Set(
      slaBreachingList.map((r: any) => r.assignedTo).filter(Boolean),
    )) as number[];
    const slaBreachEmps = slaBreachAssigneeIds.length
      ? await prisma.employee.findMany({
          where: { id: { in: slaBreachAssigneeIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const slaBreachEmpMap = new Map(slaBreachEmps.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
    const slaBreaching = slaBreachingList.map((r: any) => ({
      id: r.id,
      title: r.title,
      severity: r.severity,
      status: r.status,
      categoryName: r.category?.name ?? '—',
      dueDate: r.dueDate,
      reportedAt: r.reportedAt,
      assigneeName: r.assignedTo ? slaBreachEmpMap.get(r.assignedTo) ?? '—' : '—',
      daysOverdue: r.dueDate
        ? Math.max(0, Math.floor((now.getTime() - r.dueDate.getTime()) / 86400000))
        : 0,
    }));

    // ── CAPA overdue (hydrate owner + incident title) ─────────
    const capaOwnerIds: number[] = Array.from(new Set(
      capaOverdueList.map((r: any) => r.ownerId).filter(Boolean),
    )) as number[];
    const capaIncidentIds: number[] = Array.from(
      new Set(capaOverdueList.map((r: any) => r.incidentId)),
    ) as number[];
    const [capaOwners, capaIncidents] = await Promise.all([
      capaOwnerIds.length
        ? prisma.employee.findMany({
            where: { id: { in: capaOwnerIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : Promise.resolve([] as any[]),
      capaIncidentIds.length
        ? (prisma as any).incident.findMany({
            where: { id: { in: capaIncidentIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([] as any[]),
    ]);
    const capaOwnerMap = new Map(capaOwners.map((e: any) => [e.id, `${e.firstName} ${e.lastName}`]));
    const capaIncidentMap = new Map(capaIncidents.map((i: any) => [i.id, i.title]));
    const capaOverdue = capaOverdueList.map((r: any) => ({
      capaId: r.id,
      type: r.type,
      description: r.description,
      status: r.status,
      dueDate: r.dueDate,
      daysOverdue: r.dueDate
        ? Math.max(0, Math.floor((now.getTime() - r.dueDate.getTime()) / 86400000))
        : 0,
      ownerId: r.ownerId,
      ownerName: r.ownerId ? capaOwnerMap.get(r.ownerId) ?? '—' : '—',
      incidentId: r.incidentId,
      incidentTitle: capaIncidentMap.get(r.incidentId) ?? `#${r.incidentId}`,
    }));

    // ── Recent activity (hydrate incident titles + actor names) ─
    const recentIncidentIds: number[] = Array.from(
      new Set(recentActivityRaw.map((r: any) => r.incidentId)),
    ) as number[];
    const recentActorIds: number[] = Array.from(new Set(
      recentActivityRaw.map((r: any) => r.performedBy).filter(Boolean),
    )) as number[];
    const [recentIncidents, recentActors] = await Promise.all([
      recentIncidentIds.length
        ? (prisma as any).incident.findMany({
            where: { id: { in: recentIncidentIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([] as any[]),
      recentActorIds.length
        ? prisma.employee.findMany({
            where: { id: { in: recentActorIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : Promise.resolve([] as any[]),
    ]);
    const recentIncidentMap = new Map(recentIncidents.map((i: any) => [i.id, i.title]));
    const recentActorMap = new Map(recentActors.map((e: any) => [e.id, `${e.firstName} ${e.lastName}`]));
    const recentActivity = recentActivityRaw.map((r: any) => ({
      id: r.id,
      action: r.action,
      fromValue: r.fromValue,
      toValue: r.toValue,
      note: r.note,
      at: r.performedAt,
      incidentId: r.incidentId,
      incidentTitle: recentIncidentMap.get(r.incidentId) ?? `#${r.incidentId}`,
      actorName: r.performedBy ? recentActorMap.get(r.performedBy) ?? 'System' : 'System',
    }));

    res.json({
      generatedAt: now.toISOString(),
      kpis: {
        openCount,
        criticalOpenCount,
        slaBreachCount: slaBreachIncidents,
        avgResolutionDays,
        capaOverdueCount: capaOverdueRows.length,
        mandatoryReportingDue: mandatoryReportingDueCount,
      },
      bySeverity,
      byStatus,
      byCategory,
      byOutcome,
      trendByMonth,
      hotSpotLocations,
      topAssignees,
      repeatEmployees,
      slaBreaching,
      capaOverdue,
      recentActivity,
    });
  } catch (err: any) {
    console.error("Error building incident dashboard:", err);
    res.status(500).json({ error: err?.message || "Failed to load incident dashboard" });
  }
};

/* ════════════════════════════════════════════════════════════════════
   PHASE 4 — PUBLIC ANONYMOUS REPORTING + AUTO-ESCALATION
   ════════════════════════════════════════════════════════════════════ */

/* ─── Public endpoints (no auth, rate-limited at the route layer) ── */

/** Generate a URL-safe tracking token for anonymous reporters. */
function makeTrackingToken(): string {
  // 24 random bytes → 32-char base64url. Roughly the strength of a UUID
  // but URL-safe and no dashes — fits cleanly in a follow-up link the
  // reporter can bookmark.
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * GET /api/incidents/public/categories
 * Returns ONLY categories with `isAnonymousAllowed=true`. We never expose
 * the full category list publicly because it might leak internal taxonomy.
 */
export const listPublicCategories = async (_req: Request, res: Response) => {
  try {
    const cats = await (prisma as any).incidentCategory.findMany({
      where: { isActive: true, isAnonymousAllowed: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, description: true },
    });
    res.json(cats);
  } catch (err) {
    console.error("Error listing public categories:", err);
    res.status(500).json({ error: "Failed to list categories" });
  }
};

/**
 * POST /api/incidents/public/report
 * Anonymous incident submission. Returns a tracking token the reporter can
 * use to come back via GET /public/track/:token.
 *
 * Hard rules:
 *   • Category must be active AND have isAnonymousAllowed=true.
 *   • The submitted record always gets isAnonymous=true and reportedBy=null,
 *     regardless of what the body says.
 *   • Confidentiality is forced to STANDARD (we don't trust public input).
 */
export const submitPublicIncident = async (req: Request, res: Response) => {
  try {
    const { title, description, categoryId, location, incidentDate, attachments } = req.body || {};
    if (!title?.trim()  || title.trim().length    < 4  || title.length    > 200) {
      return res.status(400).json({ error: "title is required (4–200 chars)" });
    }
    if (!description?.trim() || description.trim().length < 10 || description.length > 5000) {
      return res.status(400).json({ error: "description is required (10–5000 chars)" });
    }
    if (!categoryId) return res.status(400).json({ error: "categoryId is required" });

    const category: any = await (prisma as any).incidentCategory.findUnique({
      where: { id: Number(categoryId) },
    });
    if (!category || !category.isActive) {
      return res.status(400).json({ error: "Invalid category" });
    }
    if (!category.isAnonymousAllowed) {
      return res.status(403).json({
        error: `Anonymous reporting is not allowed for "${category.name}". Please log in to report this category.`,
      });
    }

    // Reporter context for audit (NOT linked to a person — we just keep the
    // IP + UA so abuse / pattern detection is possible later).
    const fwd = req.headers['x-forwarded-for'];
    const ip  = (typeof fwd === 'string' && fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
    const ua  = req.headers['user-agent'] || 'unknown';

    const sev = (category.defaultSeverity as string) || 'MEDIUM';
    const slaHours   = Number(category.defaultSlaHours) || 72;
    const reportedAt = new Date();
    const dueDate    = new Date(reportedAt.getTime() + slaHours * 3600 * 1000);
    const trackingToken = makeTrackingToken();

    // Auto-assign by category default role (same as logged-in flow)
    let autoAssigneeId: number | null = null;
    if (category.defaultAssigneeRoleId) {
      const a = await prisma.employee.findFirst({
        where: { roleId: category.defaultAssigneeRoleId, employmentStatus: 'ACTIVE' },
        select: { id: true }, orderBy: { id: 'asc' },
      });
      autoAssigneeId = a?.id ?? null;
    }

    const incident = await prisma.$transaction(async (tx) => {
      const created = await (tx as any).incident.create({
        data: {
          title:       title.trim(),
          description: description.trim(),
          categoryId:  Number(categoryId),
          severity:    sev,
          status:      'OPEN',
          isAnonymous: true,                // forced
          confidentiality: 'STANDARD',      // forced — public can't pick MGMT_ONLY
          requiresRCA:           category.requiresRCAByDefault           ?? false,
          requiresExternalReport: category.requiresExternalReportByDefault ?? false,
          incidentDate: incidentDate ? new Date(incidentDate) : reportedAt,
          reportedAt,
          location:    location ?? null,
          reportedBy:  null,                // anonymous
          assignedTo:  autoAssigneeId,
          dueDate,
          publicTrackingToken: trackingToken,
          attachments: Array.isArray(attachments) && attachments.length
            ? { create: attachments.slice(0, 10).map((a: any) => ({
                fileName: String(a.fileName ?? '').slice(0, 200),
                fileUrl:  String(a.fileUrl  ?? '').slice(0, 500),
                uploadedBy: null,
              })) }
            : undefined,
        },
      });

      await logAudit(tx, created.id, 'CREATED_ANONYMOUS', {
        toValue: 'OPEN',
        note: `Anonymous report from IP ${ip} · UA: ${String(ua).slice(0, 120)}`,
      });
      if (autoAssigneeId) {
        await logAudit(tx, created.id, 'AUTO_ASSIGNED', {
          toValue: String(autoAssigneeId),
          note: `Auto-assigned by category default role`,
        });
      }
      return created;
    }, { timeout: 15000, maxWait: 5000 });

    // Notify the auto-assignee + HR/Mgmt for HIGH/CRITICAL anonymous reports.
    // (Anonymous reports are often sensitive — always pin HR even on MEDIUM.)
    try {
      if (autoAssigneeId) {
        await createNotification(
          autoAssigneeId,
          `🆕 New ANONYMOUS ${sev} incident assigned to you: "${incident.title}" (${category.name}).`,
        );
      }
      const escalateTo = await prisma.employee.findMany({
        where: {
          employmentStatus: 'ACTIVE',
          OR: [{ departmentId: 1 }, { roleId: 4 }],   // HR + management
        },
        select: { id: true },
      });
      const seen = new Set<number>(autoAssigneeId ? [autoAssigneeId] : []);
      for (const e of escalateTo) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        await createNotification(
          e.id,
          `🤐 Anonymous incident reported: "${incident.title}" (${category.name}, ${sev}). Review in HR portal.`,
        );
      }
    } catch (notifyErr) {
      console.error("[public report notify] failed:", notifyErr);
    }

    // Return the tracking token + a friendly case reference. Don't leak the
    // numeric incident ID — the token is the only pointer the reporter gets.
    res.status(201).json({
      ok: true,
      message: "Your report has been submitted and assigned for review. Please save the tracking token below to follow up.",
      trackingToken,
      caseReference: `INC-${String(incident.id).padStart(6, '0')}`,
    });
  } catch (err: any) {
    console.error("Error submitting public incident:", err);
    res.status(500).json({ error: err?.message || "Failed to submit report" });
  }
};

/**
 * GET /api/incidents/public/track/:token
 * Sanitised follow-up endpoint. Returns ONLY: status, severity, category,
 * outcome, last-update timestamp. Never leaks employee names, internal
 * comments, attachments, or audit logs.
 */
export const trackPublicIncident = async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || '').slice(0, 64);
    if (!token) return res.status(400).json({ error: "Tracking token required" });

    const incident: any = await (prisma as any).incident.findFirst({
      where: { publicTrackingToken: token },
      select: {
        id: true, title: true, status: true, severity: true, outcome: true,
        reportedAt: true, updatedAt: true, closedAt: true,
        category: { select: { name: true } },
      },
    });
    if (!incident) return res.status(404).json({ error: "No incident found for this tracking token" });

    res.json({
      caseReference: `INC-${String(incident.id).padStart(6, '0')}`,
      title:        incident.title,
      categoryName: incident.category?.name ?? null,
      severity:     incident.severity,
      status:       incident.status,
      outcome:      incident.outcome,
      reportedAt:   incident.reportedAt,
      lastUpdate:   incident.updatedAt,
      closedAt:     incident.closedAt,
    });
  } catch (err) {
    console.error("Error tracking public incident:", err);
    res.status(500).json({ error: "Failed to look up incident" });
  }
};

/* ─── Cron-callable: auto-escalation + mandatory-reporting nudge ───── */

/**
 * Daily housekeeping job for incidents.
 *
 * (1) AUTO-ESCALATION
 *     For incidents that:
 *       • are still in flight (status not in terminal set), AND
 *       • have dueDate < now (SLA breached), AND
 *       • have not been escalated in the last 24 hours
 *     We:
 *       • bump severity (MEDIUM → HIGH → CRITICAL; CRITICAL stays)
 *       • flip status to ESCALATED if currently OPEN/ACKNOWLEDGED/INVESTIGATING
 *       • notify HR + Management + the assignee
 *       • stamp lastEscalatedAt so we don't escalate again tomorrow
 *
 * (2) MANDATORY-REPORTING NUDGE
 *     For incidents flagged requiresExternalReport=true and reportedToAuthority=false:
 *       • Notify HR + reviewer (if any) once per day
 *
 * Returns a small summary so the cron runner can log the outcome.
 */
export async function runIncidentDailyTasks(): Promise<{
  escalated: number; nudged: number;
}> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const TERMINAL = ['CLOSED', 'REJECTED', 'DUPLICATE', 'WITHDRAWN'];
  const SEV_NEXT: Record<string, string> = { LOW: 'MEDIUM', MEDIUM: 'HIGH', HIGH: 'CRITICAL', CRITICAL: 'CRITICAL' };

  let escalated = 0;
  let nudged = 0;

  // ── (1) Escalation ──────────────────────────────────────────
  try {
    const breaching: any[] = await (prisma as any).incident.findMany({
      where: {
        status:  { notIn: TERMINAL },
        dueDate: { lt: now },
        OR: [
          { lastEscalatedAt: null },
          { lastEscalatedAt: { lt: dayAgo } },
        ],
      },
      select: {
        id: true, title: true, status: true, severity: true,
        assignedTo: true, dueDate: true,
        category: { select: { name: true } },
      },
      take: 200,
    });

    if (breaching.length) {
      // Resolve HR + management recipients ONCE for all rows
      const stewards = await prisma.employee.findMany({
        where: {
          employmentStatus: 'ACTIVE',
          OR: [{ departmentId: 1 }, { roleId: 4 }],
        },
        select: { id: true },
      });
      const stewardIds = stewards.map((s) => s.id);

      for (const inc of breaching) {
        const newSev = SEV_NEXT[inc.severity] || inc.severity;
        const shouldFlipStatus = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING'].includes(inc.status);
        const newStatus = shouldFlipStatus ? 'ESCALATED' : inc.status;

        await prisma.$transaction(async (tx) => {
          await (tx as any).incident.update({
            where: { id: inc.id },
            data: {
              severity:        newSev,
              status:          newStatus,
              lastEscalatedAt: now,
            },
          });
          if (newSev !== inc.severity) {
            await logAudit(tx, inc.id, 'AUTO_ESCALATED_SEVERITY', {
              fromValue: inc.severity, toValue: newSev,
              note: `SLA breached on ${inc.dueDate?.toISOString?.() ?? '—'}`,
            });
          }
          if (newStatus !== inc.status) {
            await logAudit(tx, inc.id, 'AUTO_ESCALATED_STATUS', {
              fromValue: inc.status, toValue: newStatus,
              note: 'Auto-escalated due to SLA breach',
            });
          }
        });

        // Fan-out notifications. Notify the assignee + the steward set,
        // de-duped against the assignee.
        const recipients = new Set<number>(stewardIds);
        if (inc.assignedTo) recipients.add(inc.assignedTo);
        const overdueDays = Math.max(
          0,
          Math.floor((now.getTime() - new Date(inc.dueDate).getTime()) / 86400000),
        );
        const msg =
          `🚨 Incident #${inc.id} ("${inc.title}", ${inc.category?.name ?? 'category'}) ` +
          `has been auto-escalated — ${overdueDays} day(s) past SLA. New severity: ${newSev}.`;
        for (const rid of recipients) {
          try { await createNotification(rid, msg); }
          catch (e) { console.error(`[incident escalation notify] emp ${rid}:`, e); }
        }
        escalated++;
      }
    }
  } catch (e) {
    console.error('[incident escalation] failed:', e);
  }

  // ── (2) Mandatory-reporting nudge ───────────────────────────
  try {
    const overdue: any[] = await (prisma as any).incident.findMany({
      where: {
        requiresExternalReport: true,
        reportedToAuthority:    false,
        status: { notIn: TERMINAL },
      },
      select: {
        id: true, title: true, severity: true,
        category: { select: { name: true } },
        reviewerEmpId: true,
      },
      take: 100,
    });

    if (overdue.length) {
      const hrAndMgmt = await prisma.employee.findMany({
        where: {
          employmentStatus: 'ACTIVE',
          OR: [{ departmentId: 1 }, { roleId: 4 }],
        },
        select: { id: true },
      });
      const baseRecipientIds = hrAndMgmt.map((e) => e.id);

      for (const inc of overdue) {
        const recipients = new Set<number>(baseRecipientIds);
        if (inc.reviewerEmpId) recipients.add(inc.reviewerEmpId);
        const msg =
          `📜 Incident #${inc.id} ("${inc.title}", ${inc.category?.name ?? 'category'}, ${inc.severity}) ` +
          `is flagged for mandatory external reporting. No authority report logged yet — please action.`;
        for (const rid of recipients) {
          try { await createNotification(rid, msg); }
          catch (e) { console.error(`[incident reporting nudge] emp ${rid}:`, e); }
        }
        nudged++;
      }
    }
  } catch (e) {
    console.error('[incident reporting nudge] failed:', e);
  }

  if (escalated || nudged) {
    console.log(`[incident cron] escalated=${escalated}, mandatoryReportingNudges=${nudged}`);
  }
  return { escalated, nudged };
}

/** Convenience endpoint — returns the parent + all sibling incidents. */
export const getLinkedIncidents = async (req: any, res: Response) => {
  try {
    const id = Number(req.params.id);
    const incident: any = await (prisma as any).incident.findUnique({
      where: { id },
      include: {
        parentIncident: {
          select: { id: true, title: true, status: true, severity: true, reportedAt: true },
        },
        linkedIncidents: {
          select: { id: true, title: true, status: true, severity: true, reportedAt: true },
          orderBy: { reportedAt: 'desc' },
        },
      },
    });
    if (!incident) return res.status(404).json({ error: "Incident not found" });
    res.json({
      parent:   incident.parentIncident,   // null when this incident is the root
      children: incident.linkedIncidents,  // empty when this incident has no children
    });
  } catch (err) {
    console.error("Error fetching linked incidents:", err);
    res.status(500).json({ error: "Failed to load linked incidents" });
  }
};
