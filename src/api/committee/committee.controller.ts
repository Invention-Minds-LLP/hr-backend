import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

/**
 * Committee module — manages POSH ICC and Grievance Redressal Committees.
 *
 * One Committee row per committee instance ("ICC 2026"). Members come via
 * CommitteeMember; internal members link to an Employee, external members
 * (NGO / lawyer) are stored as free-text + email.
 *
 * The active committee for a given type drives:
 *   - who handles a new grievance / POSH case
 *   - who gets notified on case creation, hearings, status changes
 *   - who's allowed to view the case (later phase)
 */

const VALID_ROLES = [
  'PRESIDING_OFFICER', 'CHAIR', 'MEMBER', 'EXTERNAL_MEMBER', 'SECRETARY',
] as const;
type CommitteeRole = typeof VALID_ROLES[number];

/* ════════════════════════════════════════════════════════════════════
   Committee CRUD
   ════════════════════════════════════════════════════════════════════ */

/** GET /api/committees?type=POSH|GRIEVANCE&active=true */
export const listCommittees = async (req: Request, res: Response) => {
  try {
    const { type, active } = req.query as { type?: string; active?: string };
    const where: any = {};
    if (type)   where.type     = String(type).toUpperCase();
    if (active) where.isActive = active === 'true';

    const rows = await (prisma as any).committee.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { termStart: 'desc' }],
      include: {
        members: {
          where: { isActive: true },
          orderBy: { addedOn: 'asc' },
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, gender: true, email: true, phone: true } },
          },
        },
      },
    });
    return res.json(rows);
  } catch (err: any) {
    console.error("listCommittees error:", err);
    return res.status(500).json({ error: err?.message || "Failed to list committees" });
  }
};

/** GET /api/committees/:id — full detail incl. inactive members. */
export const getCommittee = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const row = await (prisma as any).committee.findUnique({
      where: { id },
      include: {
        members: {
          orderBy: [{ isActive: 'desc' }, { addedOn: 'asc' }],
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, gender: true, email: true, phone: true } },
          },
        },
      },
    });
    if (!row) return res.status(404).json({ error: "Committee not found" });
    return res.json(row);
  } catch (err: any) {
    console.error("getCommittee error:", err);
    return res.status(500).json({ error: err?.message || "Failed" });
  }
};

/** POST /api/committees — create a new committee.
 *  Body: { type, name, scope?, termStart, termEnd, notes? } */
export const createCommittee = async (req: Request, res: Response) => {
  try {
    const { type, name, scope, termStart, termEnd, notes } = req.body || {};
    if (!type || !name || !termStart || !termEnd) {
      return res.status(400).json({ error: "type, name, termStart and termEnd are required" });
    }
    if (!['POSH', 'GRIEVANCE'].includes(String(type).toUpperCase())) {
      return res.status(400).json({ error: "type must be 'POSH' or 'GRIEVANCE'" });
    }
    const ts = new Date(termStart);
    const te = new Date(termEnd);
    if (isNaN(ts.getTime()) || isNaN(te.getTime())) {
      return res.status(400).json({ error: "Invalid termStart / termEnd dates" });
    }
    if (te < ts) {
      return res.status(400).json({ error: "termEnd cannot be before termStart" });
    }

    const created = await (prisma as any).committee.create({
      data: {
        type: String(type).toUpperCase(),
        name: String(name).trim(),
        scope: scope ?? 'ORG_WIDE',
        termStart: ts,
        termEnd:   te,
        notes: notes ?? null,
        isActive: true,
      },
    });
    return res.status(201).json(created);
  } catch (err: any) {
    console.error("createCommittee error:", err);
    return res.status(500).json({ error: err?.message || "Failed to create committee" });
  }
};

/** PATCH /api/committees/:id — update name / scope / dates / notes / isActive. */
export const updateCommittee = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { name, scope, termStart, termEnd, notes, isActive } = req.body || {};
    const data: any = {};
    if (name !== undefined)      data.name      = String(name).trim();
    if (scope !== undefined)     data.scope     = scope;
    if (termStart !== undefined) data.termStart = new Date(termStart);
    if (termEnd !== undefined)   data.termEnd   = new Date(termEnd);
    if (notes !== undefined)     data.notes     = notes;
    if (isActive !== undefined)  data.isActive  = !!isActive;

    const updated = await (prisma as any).committee.update({ where: { id }, data });
    return res.json(updated);
  } catch (err: any) {
    console.error("updateCommittee error:", err);
    return res.status(500).json({ error: err?.message || "Failed to update committee" });
  }
};

/* ════════════════════════════════════════════════════════════════════
   Committee Members — add / update / soft-remove
   ════════════════════════════════════════════════════════════════════ */

/** POST /api/committees/:id/members
 *  Body: { employeeId?, externalName?, externalEmail?, externalOrg?, role }
 *  Provide employeeId for internal members; externalName/Email for external. */
export const addCommitteeMember = async (req: Request, res: Response) => {
  try {
    const committeeId = Number(req.params.id);
    const { employeeId, externalName, externalEmail, externalPhone, externalOrg, role } = req.body || {};

    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({
        error: `role is required and must be one of: ${VALID_ROLES.join(', ')}`,
      });
    }
    if (!employeeId && !externalName) {
      return res.status(400).json({
        error: "Provide either employeeId (internal) or externalName (external)",
      });
    }
    if (employeeId && externalName) {
      return res.status(400).json({
        error: "Pick one — internal (employeeId) OR external (externalName), not both",
      });
    }

    // Prevent adding the same internal employee twice to an active committee.
    if (employeeId) {
      const existing = await (prisma as any).committeeMember.findFirst({
        where: { committeeId, employeeId: Number(employeeId), isActive: true },
      });
      if (existing) {
        return res.status(400).json({ error: "This employee is already an active member of this committee" });
      }
    }

    const member = await (prisma as any).committeeMember.create({
      data: {
        committeeId,
        employeeId:    employeeId    ? Number(employeeId) : null,
        externalName:  externalName  ?? null,
        externalEmail: externalEmail ?? null,
        externalPhone: externalPhone ?? null,
        externalOrg:   externalOrg   ?? null,
        role,
        isActive: true,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, gender: true, email: true, phone: true } },
      },
    });
    return res.status(201).json(member);
  } catch (err: any) {
    console.error("addCommitteeMember error:", err);
    return res.status(500).json({ error: err?.message || "Failed to add member" });
  }
};

/** PATCH /api/committees/members/:memberId — update role (e.g. promote MEMBER → CHAIR). */
export const updateCommitteeMember = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.memberId);
    const { role, externalName, externalEmail, externalPhone, externalOrg } = req.body || {};
    const data: any = {};
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
      }
      data.role = role;
    }
    if (externalName  !== undefined) data.externalName  = externalName;
    if (externalEmail !== undefined) data.externalEmail = externalEmail;
    if (externalPhone !== undefined) data.externalPhone = externalPhone;
    if (externalOrg   !== undefined) data.externalOrg   = externalOrg;

    const updated = await (prisma as any).committeeMember.update({ where: { id }, data });
    return res.json(updated);
  } catch (err: any) {
    console.error("updateCommitteeMember error:", err);
    return res.status(500).json({ error: err?.message || "Failed to update member" });
  }
};

/** DELETE /api/committees/members/:memberId — soft-remove (sets isActive=false). */
export const removeCommitteeMember = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.memberId);
    const updated = await (prisma as any).committeeMember.update({
      where: { id },
      data: { isActive: false, removedOn: new Date() },
    });
    return res.json(updated);
  } catch (err: any) {
    console.error("removeCommitteeMember error:", err);
    return res.status(500).json({ error: err?.message || "Failed to remove member" });
  }
};

/* ════════════════════════════════════════════════════════════════════
   Helpers used by other controllers (grievance/posh) and the compliance
   validator below.
   ════════════════════════════════════════════════════════════════════ */

/** Returns the currently-active committee of a given type, or null. */
export async function findActiveCommittee(type: 'POSH' | 'GRIEVANCE') {
  const now = new Date();
  return (prisma as any).committee.findFirst({
    where: {
      type,
      isActive: true,
      termStart: { lte: now },
      termEnd:   { gte: now },
    },
    include: {
      members: {
        where: { isActive: true },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, gender: true, email: true, phone: true } },
        },
      },
    },
    orderBy: { termStart: 'desc' },
  });
}

/** Returns active member empIds for notification fan-out (skip externals). */
export async function getCommitteeMemberEmpIds(committeeId: number | null | undefined): Promise<number[]> {
  if (!committeeId) return [];
  const members = await (prisma as any).committeeMember.findMany({
    where: { committeeId, isActive: true, employeeId: { not: null } },
    select: { employeeId: true },
  });
  return members.map((m: any) => Number(m.employeeId));
}

/* ════════════════════════════════════════════════════════════════════
   POSH compliance validator (Phase 2)
   Checks the ICC against the POSH Act 2013 composition rules.
   GET /api/committees/:id/posh-compliance
   ════════════════════════════════════════════════════════════════════ */
export const checkPoshCompliance = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const committee: any = await (prisma as any).committee.findUnique({
      where: { id },
      include: {
        members: {
          where: { isActive: true },
          include: { employee: { select: { gender: true } } },
        },
      },
    });
    if (!committee) return res.status(404).json({ error: "Committee not found" });
    if (committee.type !== 'POSH') {
      return res.status(400).json({ error: "POSH compliance only applies to type=POSH committees" });
    }

    const warnings: { code: string; message: string }[] = [];
    const errors:   { code: string; message: string }[] = [];

    const now = new Date();
    const members = committee.members ?? [];

    // 1) Term expired or not active
    if (!committee.isActive) {
      errors.push({ code: 'INACTIVE', message: 'Committee is marked inactive.' });
    }
    if (new Date(committee.termEnd) < now) {
      errors.push({ code: 'TERM_EXPIRED', message: 'Committee term has expired — reconstitute it.' });
    }

    // 2) Minimum member count (POSH Act doesn't fix a number, but ICC convention is ≥4)
    if (members.length < 4) {
      errors.push({ code: 'TOO_FEW_MEMBERS', message: `Only ${members.length} active member(s). The Act expects ≥4: 1 Presiding Officer + ≥2 employee members + ≥1 external member.` });
    }

    // 3) Presiding Officer present
    const officer = members.find((m: any) => m.role === 'PRESIDING_OFFICER');
    if (!officer) {
      errors.push({ code: 'NO_PRESIDING_OFFICER', message: 'No Presiding Officer set. Required: a senior woman employee.' });
    } else {
      // Officer must be a woman (POSH Act requirement)
      const officerGender = officer.employee?.gender ?? null;
      if (officer.employeeId && officerGender !== 'FEMALE') {
        errors.push({
          code: 'PRESIDING_OFFICER_NOT_WOMAN',
          message: 'POSH Act requires the Presiding Officer to be a woman employee.',
        });
      }
      if (!officer.employeeId) {
        warnings.push({
          code: 'PRESIDING_OFFICER_EXTERNAL',
          message: 'The Presiding Officer should be a senior internal employee, not an external member.',
        });
      }
    }

    // 4) ≥1 external member
    const externals = members.filter((m: any) => m.role === 'EXTERNAL_MEMBER' || !m.employeeId);
    if (externals.length < 1) {
      errors.push({
        code: 'NO_EXTERNAL_MEMBER',
        message: 'POSH Act requires at least 1 external member (NGO / lawyer / women\'s welfare expert).',
      });
    }

    // 5) ≥50% women
    const internalMembers = members.filter((m: any) => m.employeeId);
    if (internalMembers.length > 0) {
      const women = internalMembers.filter((m: any) => m.employee?.gender === 'FEMALE').length;
      const pct = Math.round((women / internalMembers.length) * 100);
      if (pct < 50) {
        errors.push({
          code: 'WOMEN_BELOW_HALF',
          message: `Only ${pct}% of internal members are women — POSH Act requires at least 50%.`,
        });
      }
    }

    // 6) Term ending soon (informational)
    const daysUntilExpiry = Math.ceil((new Date(committee.termEnd).getTime() - now.getTime()) / (24 * 3600 * 1000));
    if (daysUntilExpiry > 0 && daysUntilExpiry <= 60) {
      warnings.push({
        code: 'TERM_ENDING_SOON',
        message: `Committee term ends in ${daysUntilExpiry} day(s). Plan reconstitution.`,
      });
    }

    return res.json({
      committeeId: id,
      compliant: errors.length === 0,
      errors,
      warnings,
      stats: {
        memberCount: members.length,
        womenCount: members.filter((m: any) => m.employee?.gender === 'FEMALE').length,
        externalCount: externals.length,
        hasPresidingOfficer: !!officer,
        termEndsInDays: daysUntilExpiry,
      },
    });
  } catch (err: any) {
    console.error("checkPoshCompliance error:", err);
    return res.status(500).json({ error: err?.message || "Failed to check compliance" });
  }
};
