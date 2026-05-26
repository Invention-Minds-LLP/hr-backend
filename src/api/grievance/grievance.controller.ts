import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
// import { PrismaClient, PermissionStatus } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";
import { findActiveCommittee, getCommitteeMemberEmpIds } from "../committee/committee.controller";

// --- Create grievance
export const createGrievance = asyncHandler(async (req: Request, res: Response) => {
  const {  title, description, category } = req.body;
  let employeeId = Number(req.body.employeeId);

  // Bind the case to the active Grievance Committee (if one is configured).
  // If no committee is set up, we still create the case and fall back to the
  // legacy "notify all HR" behaviour so this never breaks the existing flow.
  const committee = await findActiveCommittee('GRIEVANCE');

  const grievance = await prisma.grievance.create({
    data: { employeeId, title, description, category, committeeId: committee?.id ?? null }
  });

  // 🔔 Notify the committee members if we have one; else fall back to HR.
  let recipients: number[] = [];
  if (committee) {
    recipients = await getCommitteeMemberEmpIds(committee.id);
  }
  if (recipients.length === 0) {
    const hrEmployees = await prisma.employee.findMany({
      where: { departmentId: 1 },          // HR fallback
      select: { id: true },
    });
    recipients = hrEmployees.map((h) => h.id);
  }
  for (const rid of recipients) {
    await createNotification(rid, 'New grievance submitted — requires acknowledgment');
  }
  res.json(grievance);
});

// --- List grievances
export const listGrievances = asyncHandler(async (req: Request, res: Response) => {
  // View gating (less strict than POSH — HR Manager / Admin keep full visibility):
  //   • HR Manager / Admin / Management → all grievances
  //   • The complainant (employee who raised it) → their own
  //   • Active members of the Grievance Committee handling the case → that case
  //   • Anyone else → nothing
  const user = (req as any).user;
  const me = Number(user?.empId ?? user?.userId);
  const role = String(user?.role ?? '').toUpperCase();
  const roleId = Number(user?.roleId);
  const isPrivileged = ['HR_MANAGER', 'ADMIN', 'MANAGEMENT'].includes(role) || roleId === 1 || roleId === 4;

  let where: any = {};
  if (!isPrivileged) {
    let memberOfCommitteeIds: number[] = [];
    if (me) {
      const memberships = await (prisma as any).committeeMember.findMany({
        where: { employeeId: me, isActive: true, committee: { type: 'GRIEVANCE' } },
        select: { committeeId: true },
      });
      memberOfCommitteeIds = memberships.map((m: any) => Number(m.committeeId));
    }
    where = {
      OR: [
        { employeeId: me },
        ...(memberOfCommitteeIds.length > 0
          ? [{ committeeId: { in: memberOfCommitteeIds } }]
          : []),
      ],
    };
  }

  const grievances = await prisma.grievance.findMany({
    where,
    include: {
      employee: true,
      comments: { include: { employee: true } },
      // Committee handling this grievance (with the active member list) so the
      // UI can show "Handled by: Grievance Committee 2026" + roster.
      committee: {
        include: {
          members: {
            where: { isActive: true },
            include: {
              employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, gender: true, email: true, phone: true } },
            },
          },
        },
      },
    } as any,
  });
  res.json(grievances);
});

// --- Add comment
export const addGrievanceComment = asyncHandler(async (req: Request, res: Response) => {
  const grievanceId = Number(req.params.id);
  const { comment } = req.body;
  let employeeId = Number(req.body.employeeId);
  const c = await prisma.grievanceComment.create({
    data: { grievanceId, employeeId, comment }
  });

  // 🔔 Notify the grievance owner (not the commenter)
  const grievance = await prisma.grievance.findUnique({ where: { id: grievanceId }, select: { employeeId: true } });
  if (grievance && grievance.employeeId !== employeeId) {
    await createNotification(grievance.employeeId, `A new comment has been added to your grievance.`);
  }

  res.json(c);
});

// --- Update status
export const updateGrievanceStatus = asyncHandler(async (req: Request, res: Response) => {
  const grievanceId = Number(req.params.id);
  const { status } = req.body;
  const g = await prisma.grievance.update({
    where: { id: grievanceId },
    data: { status }
  });

  // 🔔 Notify the grievance owner
  await createNotification(g.employeeId, `Your grievance status has been updated to: ${status}.`);

  res.json(g);
});
export const createAcknowledgement = async (req: Request, res: Response) => {
  try {
    const { employeeId, grievanceId, poshCaseId } = req.body;

    if (!employeeId) {
      return res.status(400).json({ message: "employeeId is required" });
    }

    if (!grievanceId && !poshCaseId) {
      return res
        .status(400)
        .json({ message: "Either grievanceId or poshCaseId must be provided" });
    }

    // Prevent duplicate acknowledgment
    const existingAck = await prisma.complaintAcknowledgement.findFirst({
      where: {
        employeeId,
        ...(grievanceId ? { grievanceId } : {}),
        ...(poshCaseId ? { poshCaseId } : {}),
      },
    });

    if (existingAck) {
      return res.status(409).json({ message: "Already acknowledged" });
    }

    const acknowledgement = await prisma.complaintAcknowledgement.create({
      data: {
        employeeId,
        grievanceId: grievanceId || null,
        poshCaseId: poshCaseId || null,
      },
    });

    return res.status(201).json({
      message: "Acknowledgement recorded successfully",
      data: acknowledgement,
    });
  } catch (error: any) {
    console.error("Error creating acknowledgement:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get all acknowledgements for a specific employee
 */
export const getAcknowledgementsByEmployee = async (
  req: Request,
  res: Response
) => {
  try {
    const { employeeId } = req.params;

    const acknowledgements = await prisma.complaintAcknowledgement.findMany({
      where: { employeeId: Number(employeeId) },
      include: {
        grievance: true,
        poshCase: true,
      },
      orderBy: { acknowledgedAt: "desc" },
    });

    res.json({ data: acknowledgements });
  } catch (error: any) {
    console.error("Error fetching acknowledgements:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Check if an employee has already acknowledged a specific complaint
 */
export const checkAcknowledgement = async (req: Request, res: Response) => {
  try {
    const { employeeId, grievanceId, poshCaseId } = req.query;

    if (!employeeId) {
      return res.status(400).json({ message: "employeeId is required" });
    }

    const ack = await prisma.complaintAcknowledgement.findFirst({
      where: {
        employeeId: Number(employeeId),
        ...(grievanceId ? { grievanceId: Number(grievanceId) } : {}),
        ...(poshCaseId ? { poshCaseId: Number(poshCaseId) } : {}),
      },
    });

    res.json({ acknowledged: !!ack });
  } catch (error: any) {
    console.error("Error checking acknowledgement:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getUnacknowledgedComplaints = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    if (!employeeId) return res.status(400).json({ message: "employeeId required" });

    // Step 1️⃣: Check if employee belongs to HR department
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { Department: true },
    });

    if (!employee) return res.status(404).json({ message: "Employee not found" });
    console.log("Employee Department:", employee.Department?.name);

    if (!employee.Department || employee.Department.name!== "Human Resources") {
      // Not an HR user → no need to show any complaints
      return res.json({ grievances: [], poshCases: [] });
    }

    // Step 2️⃣: Fetch already acknowledged complaint IDs
    const acknowledgements = await prisma.complaintAcknowledgement.findMany({
      where: { employeeId },
      select: { grievanceId: true, poshCaseId: true },
    });

    const acknowledgedGrievanceIds = acknowledgements
      .filter(a => a.grievanceId)
      .map(a => a.grievanceId!);

    const acknowledgedPoshIds = acknowledgements
      .filter(a => a.poshCaseId)
      .map(a => a.poshCaseId!);

    // Step 3️⃣: Find all grievances and POSH cases not yet acknowledged
    const grievances = await prisma.grievance.findMany({
      where: {
        NOT: { id: { in: acknowledgedGrievanceIds } },
      },
      include: { employee: true },
      orderBy: { createdAt: "desc" },
    });

    const poshCases = await prisma.poshCase.findMany({
      where: {
        NOT: { id: { in: acknowledgedPoshIds } },
      },
      include: {
        complainant: true,
        accused: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ grievances, poshCases });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * GET /api/grievance/:id/committee-acks — committee acknowledgement progress.
 * Returns: { committee, members:[{ member, acknowledged, acknowledgedAt }],
 *           acknowledgedCount, totalMembers, allAcknowledged }
 * Used by the case-detail UI to show "3 of 5 members have acknowledged" + the
 * roster with a per-row checkmark. Only INTERNAL members (linked to an
 * Employee) are tracked — externals acknowledge out-of-band today.
 */
export const getGrievanceCommitteeAcks = async (req: Request, res: Response) => {
  return getCaseCommitteeAcks(res, { grievanceId: Number(req.params.id) });
};
export const getPoshCommitteeAcks = async (req: Request, res: Response) => {
  return getCaseCommitteeAcks(res, { poshCaseId: Number(req.params.id) });
};

async function getCaseCommitteeAcks(
  res: Response,
  caseRef: { grievanceId?: number; poshCaseId?: number },
) {
  try {
    // Resolve the case → its committee
    let committeeId: number | null = null;
    if (caseRef.grievanceId) {
      const g = await prisma.grievance.findUnique({ where: { id: caseRef.grievanceId }, select: { committeeId: true } });
      if (!g) return res.status(404).json({ error: "Grievance not found" });
      committeeId = g.committeeId;
    } else if (caseRef.poshCaseId) {
      const p = await prisma.poshCase.findUnique({ where: { id: caseRef.poshCaseId }, select: { committeeId: true } });
      if (!p) return res.status(404).json({ error: "POSH case not found" });
      committeeId = p.committeeId;
    }

    if (!committeeId) {
      return res.json({
        committee: null,
        members: [],
        acknowledgedCount: 0,
        totalMembers: 0,
        allAcknowledged: false,
      });
    }

    const [committee, acks] = await Promise.all([
      (prisma as any).committee.findUnique({
        where: { id: committeeId },
        include: {
          members: {
            where: { isActive: true },
            include: {
              employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, gender: true } },
            },
          },
        },
      }),
      prisma.complaintAcknowledgement.findMany({
        where: {
          ...(caseRef.grievanceId ? { grievanceId: caseRef.grievanceId } : {}),
          ...(caseRef.poshCaseId  ? { poshCaseId:  caseRef.poshCaseId  } : {}),
        },
        select: { employeeId: true, acknowledgedAt: true },
      }),
    ]);

    const ackMap = new Map<number, Date>();
    for (const a of acks) ackMap.set(a.employeeId, a.acknowledgedAt);

    // We track ack status only for internal members (externals don't have
    // employee accounts to record acks against).
    const internal = (committee?.members ?? []).filter((m: any) => m.employeeId);
    const memberStatuses = internal.map((m: any) => ({
      memberId: m.id,
      employeeId: m.employeeId,
      role: m.role,
      name: m.employee ? `${m.employee.firstName} ${m.employee.lastName}` : null,
      employeeCode: m.employee?.employeeCode ?? null,
      gender: m.employee?.gender ?? null,
      acknowledged: ackMap.has(m.employeeId),
      acknowledgedAt: ackMap.get(m.employeeId) ?? null,
    }));

    const acknowledgedCount = memberStatuses.filter((x: any) => x.acknowledged).length;

    return res.json({
      committee: committee ? {
        id: committee.id, name: committee.name, type: committee.type,
        termStart: committee.termStart, termEnd: committee.termEnd,
      } : null,
      members: memberStatuses,
      externalMemberCount: (committee?.members ?? []).filter((m: any) => !m.employeeId).length,
      acknowledgedCount,
      totalMembers: memberStatuses.length,
      allAcknowledged: memberStatuses.length > 0 && acknowledgedCount === memberStatuses.length,
    });
  } catch (err: any) {
    console.error("getCaseCommitteeAcks error:", err);
    return res.status(500).json({ error: err?.message || "Failed" });
  }
}