import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
// import { PrismaClient, PermissionStatus } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";
import { findActiveCommittee, getCommitteeMemberEmpIds } from "../committee/committee.controller";

// --- File POSH case
export const createPoshCase = asyncHandler(async (req: Request, res: Response) => {
  const {  accusedId, description } = req.body;
  let complainantId = req.body.complainantId;
  complainantId = Number(complainantId);

  // Bind the case to the active ICC (Internal Complaints Committee) if one is
  // configured. If not, we still create the case but fall back to the legacy
  // "notify all HR" path so the existing flow keeps working.
  const committee = await findActiveCommittee('POSH');

  const posh = await prisma.poshCase.create({
    data: { complainantId, accusedId, description, committeeId: committee?.id ?? null }
  });

  // 🔔 Notify ICC members if a committee exists; otherwise fall back to HR dept.
  let recipients: number[] = [];
  if (committee) {
    recipients = await getCommitteeMemberEmpIds(committee.id);
  }
  if (recipients.length === 0) {
    const hrEmployees = await prisma.employee.findMany({
      where: { departmentId: 1 },
      select: { id: true },
    });
    recipients = hrEmployees.map((h) => h.id);
  }
  for (const rid of recipients) {
    await createNotification(rid, 'New POSH case filed — requires acknowledgment.');
  }
  res.json(posh);
});

// --- List POSH cases
export const listPoshCases = asyncHandler(async (req: Request, res: Response) => {
  // Strict view gating per POSH Act confidentiality:
  //   Only the assigned ICC members + the complainant + the accused can read.
  //   Even other HR-dept employees are NOT allowed — only members of the ICC
  //   that handles each case. ADMIN role is the one exception for emergencies.
  const me = Number((req as any).user?.empId ?? (req as any).user?.userId);
  const userRole = String((req as any).user?.role ?? '').toUpperCase();
  const isAdmin = userRole === 'ADMIN';

  // Find every committee this user is currently an active member of.
  let memberOfCommitteeIds: number[] = [];
  if (me && !isAdmin) {
    const memberships = await (prisma as any).committeeMember.findMany({
      where: { employeeId: me, isActive: true, committee: { type: 'POSH' } },
      select: { committeeId: true },
    });
    memberOfCommitteeIds = memberships.map((m: any) => Number(m.committeeId));
  }

  const where: any = isAdmin ? {} : {
    OR: [
      { complainantId: me },
      { accusedId:     me },
      ...(memberOfCommitteeIds.length > 0
        ? [{ committeeId: { in: memberOfCommitteeIds } }]
        : []),
    ],
  };

  const cases = await prisma.poshCase.findMany({
    where,
    include: {
      complainant: true,
      accused: true,
      hearings: true,
      // ICC handling this case (active members only) for the "Handled by" display.
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
  res.json(cases);
});

// --- Add hearing
export const addHearing = asyncHandler(async (req: Request, res: Response) => {
  const poshId = Number(req.params.id);
  const { date, notes, outcome } = req.body;
  const hearing = await prisma.poshHearing.create({
    data: { poshId, date, notes, outcome }
  });

  // 🔔 Notify complainant and accused
  const posh = await prisma.poshCase.findUnique({ where: { id: poshId }, select: { complainantId: true, accusedId: true } });
  if (posh) {
    const msg = `A hearing has been scheduled for your POSH case on ${new Date(date).toLocaleDateString('en-IN')}.`;
    await createNotification(posh.complainantId, msg);
    if (posh.accusedId) await createNotification(posh.accusedId, msg);
  }

  res.json(hearing);
});

// --- Update status
export const updatePoshStatus = asyncHandler(async (req: Request, res: Response) => {
  const poshId = Number(req.params.id);
  const { status, committeeNote } = req.body;
  const posh = await prisma.poshCase.update({
    where: { id: poshId },
    data: { status, committeeNote }
  });

  // 🔔 Notify complainant and accused of status update
  const msg = `Your POSH case status has been updated to: ${status}.`;
  await createNotification(posh.complainantId, msg);
  if (posh.accusedId) await createNotification(posh.accusedId, msg);

  res.json(posh);
});

// --- Get hearings by Case ID (with attendees so the UI can show quorum)
export const getHearings = asyncHandler(async (req: Request, res: Response) => {
    const poshId = Number(req.params.id);
    const hearings = await (prisma as any).poshHearing.findMany({
      where: { poshId },
      orderBy: { date: 'asc' },
      include: {
        attendees: {
          include: {
            member: {
              include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, gender: true } },
              },
            },
          },
        },
      },
    });
    res.json(hearings);
  });

/* ════════════════════════════════════════════════════════════════════
   POSH HEARING ATTENDEES — quorum audit trail
   Phase 3 of the committee module.

   POST /api/posh/hearings/:hearingId/attendees
     body: { attendees: [{ committeeMemberId, attended, remarks? }] }
     Upserts the full list for that hearing. Idempotent: safe to call repeatedly
     as HR updates the attendance sheet.

   GET /api/posh/hearings/:hearingId/attendees
     Returns the recorded attendees for that hearing.
   ════════════════════════════════════════════════════════════════════ */
export const setHearingAttendees = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const hearingId = Number(req.params.hearingId);
  const { attendees } = req.body as {
    attendees: { committeeMemberId: number; attended: boolean; remarks?: string | null }[];
  };
  if (!Array.isArray(attendees)) {
    res.status(400).json({ error: "attendees must be an array" });
    return;
  }

  // Verify the hearing exists and grab its committee link.
  const hearing = await (prisma as any).poshHearing.findUnique({
    where: { id: hearingId },
    include: { poshCase: { select: { committeeId: true } } },
  });
  if (!hearing) {
    res.status(404).json({ error: "Hearing not found" });
    return;
  }

  // Upsert each row — unique (hearingId, committeeMemberId).
  const results = [];
  for (const a of attendees) {
    if (!a.committeeMemberId) continue;
    const row = await (prisma as any).poshHearingAttendee.upsert({
      where: {
        hearingId_committeeMemberId: {
          hearingId,
          committeeMemberId: Number(a.committeeMemberId),
        },
      },
      create: {
        hearingId,
        committeeMemberId: Number(a.committeeMemberId),
        attended: !!a.attended,
        remarks: a.remarks ?? null,
      },
      update: {
        attended: !!a.attended,
        remarks: a.remarks ?? null,
      },
      include: {
        member: {
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          },
        },
      },
    });
    results.push(row);
  }
  res.json({ hearingId, attendees: results });
});

export const getHearingAttendees = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const hearingId = Number(req.params.hearingId);
  const rows = await (prisma as any).poshHearingAttendee.findMany({
    where: { hearingId },
    include: {
      member: {
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, gender: true } },
        },
      },
    },
  });
  res.json(rows);
});
  