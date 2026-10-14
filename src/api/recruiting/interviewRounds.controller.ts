// ─────────────────────────────────────────────────────────────────────────────
//  Interview round configuration
//
//  Which rounds a candidate goes through, and in what order. This used to be
//  hardcoded in the frontend as Panel → Test → Management, so a client who
//  tests first and interviews second could not be supported at all.
//
//  Three layers:
//    • InterviewRoundTemplate  — the reusable sequence HR maintains in Settings
//    • JobInterviewRound       — the copy taken when a job is created
//    • Interview.roundSeq      — which configured round a scheduled interview
//                                actually fulfilled
//
//  The copy is the point: editing a template must never reshuffle a job whose
//  candidates are already half-way through.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import {
  InterviewRoundType,
  isInterviewRoundType,
  LEGACY_ROUND_SEQUENCE,
} from './recruiting.constants';

type RoundInput = {
  seq?: number;
  type?: string;
  name?: string;
  testId?: number | string | null;
  isRequired?: boolean;
};

/**
 * Clean a submitted round list: drop anything unusable, renumber from 1 in the
 * order given (the client reorders by dragging, it shouldn't have to maintain
 * seq), and keep a testId only where it means something.
 */
function normaliseRounds(rounds: RoundInput[]): {
  rows: { seq: number; type: InterviewRoundType; name: string; testId: number | null; isRequired: boolean }[];
  rejected: { index: number; reason: string }[];
} {
  const rows: { seq: number; type: InterviewRoundType; name: string; testId: number | null; isRequired: boolean }[] = [];
  const rejected: { index: number; reason: string }[] = [];

  rounds.forEach((r, index) => {
    const type = String(r?.type || '').toUpperCase();
    if (!isInterviewRoundType(type)) {
      rejected.push({ index, reason: 'type must be TEST, PANEL or MANAGEMENT' });
      return;
    }
    const name = String(r?.name || '').trim() || type.charAt(0) + type.slice(1).toLowerCase();
    const testIdRaw = r?.testId === '' || r?.testId === null || r?.testId === undefined ? null : Number(r.testId);
    if (testIdRaw !== null && !Number.isFinite(testIdRaw)) {
      rejected.push({ index, reason: 'testId must be a number or empty' });
      return;
    }
    rows.push({
      seq: rows.length + 1,
      type,
      // A test is only meaningful on a TEST round.
      testId: type === 'TEST' ? testIdRaw : null,
      name,
      isRequired: r?.isRequired !== false,
    });
  });

  return { rows, rejected };
}

/** GET /recruiting/round-templates */
export const listRoundTemplates = async (_req: Request, res: Response) => {
  try {
    const templates = await prisma.interviewRoundTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        department: { select: { id: true, name: true } },
        items: { orderBy: { seq: 'asc' }, include: { test: { select: { id: true, name: true } } } },
      },
    });
    res.json(templates);
  } catch (error) {
    console.error('listRoundTemplates error:', error);
    res.status(500).json({ error: 'Failed to fetch interview round templates' });
  }
};

/** POST /recruiting/round-templates */
export const createRoundTemplate = async (req: Request, res: Response) => {
  try {
    const { name, departmentId, isDefault, rounds } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'name is required' });

    const { rows, rejected } = normaliseRounds(Array.isArray(rounds) ? rounds : []);
    if (!rows.length) return res.status(400).json({ error: 'At least one round is required', rejected });

    const created = await prisma.$transaction(async (tx) => {
      // Only one default: a second one would make "which template applies?"
      // unanswerable.
      if (isDefault) {
        await tx.interviewRoundTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.interviewRoundTemplate.create({
        data: {
          name: String(name).trim(),
          departmentId: departmentId ? Number(departmentId) : null,
          isDefault: !!isDefault,
          createdBy: Number((req as any).user?.empId) || null,
          items: { create: rows },
        },
        include: { items: { orderBy: { seq: 'asc' } } },
      });
    });

    res.status(201).json({ ...created, rejected });
  } catch (error) {
    console.error('createRoundTemplate error:', error);
    res.status(500).json({ error: 'Failed to create the interview round template' });
  }
};

/** PUT /recruiting/round-templates/:id */
export const updateRoundTemplate = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { name, departmentId, isDefault, isActive, rounds } = req.body || {};

    const existing = await prisma.interviewRoundTemplate.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    let rejected: { index: number; reason: string }[] = [];
    let rows: ReturnType<typeof normaliseRounds>['rows'] = [];
    if (Array.isArray(rounds)) {
      ({ rows, rejected } = normaliseRounds(rounds));
      if (!rows.length) return res.status(400).json({ error: 'At least one round is required', rejected });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.interviewRoundTemplate.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      if (rows.length) {
        // Replace wholesale — the unique (templateId, seq) makes an in-place
        // reorder fiddlier than it is worth, and this is a tiny table.
        await tx.interviewRoundTemplateItem.deleteMany({ where: { templateId: id } });
        await tx.interviewRoundTemplateItem.createMany({
          data: rows.map((r) => ({ ...r, templateId: id })),
        });
      }
      return tx.interviewRoundTemplate.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: String(name).trim() } : {}),
          ...(departmentId !== undefined ? { departmentId: departmentId ? Number(departmentId) : null } : {}),
          ...(isDefault !== undefined ? { isDefault: !!isDefault } : {}),
          ...(isActive !== undefined ? { isActive: !!isActive } : {}),
        },
        include: { items: { orderBy: { seq: 'asc' } } },
      });
    });

    res.json({ ...updated, rejected });
  } catch (error) {
    console.error('updateRoundTemplate error:', error);
    res.status(500).json({ error: 'Failed to update the interview round template' });
  }
};

/** DELETE /recruiting/round-templates/:id — deactivates, keeps history. */
export const deleteRoundTemplate = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await prisma.interviewRoundTemplate.update({ where: { id }, data: { isActive: false, isDefault: false } });
    res.json({ ok: true });
  } catch (error) {
    console.error('deleteRoundTemplate error:', error);
    res.status(500).json({ error: 'Failed to delete the interview round template' });
  }
};

/**
 * The template that applies to a department: its own, else the default.
 * Exported so job creation can copy it without duplicating the rule.
 */
export async function templateForDepartment(departmentId: number | null | undefined) {
  if (departmentId) {
    const own = await prisma.interviewRoundTemplate.findFirst({
      where: { departmentId, isActive: true },
      orderBy: { id: 'desc' },
      include: { items: { orderBy: { seq: 'asc' } } },
    });
    if (own) return own;
  }
  return prisma.interviewRoundTemplate.findFirst({
    where: { isDefault: true, isActive: true },
    include: { items: { orderBy: { seq: 'asc' } } },
  });
}

/**
 * Copy a template's rounds onto a job. Called at job creation; safe to call
 * again (it replaces whatever the job had). Returns the number of rounds set,
 * or 0 when there is no template to copy — the job then falls back to the
 * legacy order, so nothing breaks for clients who never configure this.
 */
export async function applyRoundsToJob(
  jobId: number,
  templateId?: number | null,
  departmentId?: number | null,
): Promise<number> {
  const template = templateId
    ? await prisma.interviewRoundTemplate.findUnique({
        where: { id: templateId },
        include: { items: { orderBy: { seq: 'asc' } } },
      })
    : await templateForDepartment(departmentId);

  if (!template || !template.items.length) return 0;

  await prisma.$transaction(async (tx) => {
    await tx.jobInterviewRound.deleteMany({ where: { jobId } });
    await tx.jobInterviewRound.createMany({
      data: template.items.map((i) => ({
        jobId, seq: i.seq, type: i.type, name: i.name, testId: i.testId, isRequired: i.isRequired,
      })),
    });
  });

  return template.items.length;
}

/** GET /recruiting/jobs/:id/rounds */
export const getJobRounds = async (req: Request, res: Response) => {
  try {
    const jobId = Number(req.params.id);
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, departmentId: true } });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const rounds = await prisma.jobInterviewRound.findMany({
      where: { jobId },
      orderBy: { seq: 'asc' },
      include: { test: { select: { id: true, name: true } } },
    });

    // A job configured before this feature has no rounds of its own; say so
    // explicitly rather than pretending the legacy order was chosen.
    res.json({
      jobId,
      configured: rounds.length > 0,
      rounds: rounds.length ? rounds : LEGACY_ROUND_SEQUENCE.map((r) => ({ ...r, testId: null, isRequired: true })),
    });
  } catch (error) {
    console.error('getJobRounds error:', error);
    res.status(500).json({ error: 'Failed to fetch the job rounds' });
  }
};

/** PUT /recruiting/jobs/:id/rounds  { rounds: [...] } or { templateId } */
export const setJobRounds = async (req: Request, res: Response) => {
  try {
    const jobId = Number(req.params.id);
    const { rounds, templateId } = req.body || {};

    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, departmentId: true } });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (templateId) {
      const count = await applyRoundsToJob(jobId, Number(templateId));
      if (!count) return res.status(400).json({ error: 'That template has no rounds' });
    } else {
      const { rows, rejected } = normaliseRounds(Array.isArray(rounds) ? rounds : []);
      if (!rows.length) return res.status(400).json({ error: 'At least one round is required', rejected });
      await prisma.$transaction(async (tx) => {
        await tx.jobInterviewRound.deleteMany({ where: { jobId } });
        await tx.jobInterviewRound.createMany({ data: rows.map((r) => ({ ...r, jobId })) });
      });
    }

    const saved = await prisma.jobInterviewRound.findMany({
      where: { jobId }, orderBy: { seq: 'asc' },
      include: { test: { select: { id: true, name: true } } },
    });
    res.json({ jobId, configured: true, rounds: saved });
  } catch (error) {
    console.error('setJobRounds error:', error);
    res.status(500).json({ error: 'Failed to save the job rounds' });
  }
};

/**
 * Where a candidate stands in the job's sequence: what each round is, what has
 * happened to it, which one is next, and what may be scheduled now.
 *
 * Shared by the progress endpoint and the scheduling guard so the order can't
 * mean one thing on screen and another on save. Returns null if there's no
 * such application.
 */
export async function computeApplicationRounds(applicationId: number) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, jobId: true },
  });
  if (!application) return null;

  const configured = await prisma.jobInterviewRound.findMany({
    where: { jobId: application.jobId },
    orderBy: { seq: 'asc' },
    include: { test: { select: { id: true, name: true } } },
  });
  const sequence: any[] = configured.length
    ? configured
    : LEGACY_ROUND_SEQUENCE.map((r) => ({ ...r, id: 0, jobId: application.jobId, testId: null, isRequired: true, test: null }));

  const [interviews, tests] = await Promise.all([
    prisma.interview.findMany({
      where: { applicationId },
      orderBy: { startTime: 'asc' },
      select: {
        id: true, stage: true, roundSeq: true, startTime: true,
        result: true, cancelledAt: true, candidateAssignedTestId: true,
      },
    }),
    prisma.candidateAssignedTest.findMany({
      where: { applicationId },
      orderBy: { assignedAt: 'asc' },
      select: { id: true, status: true, score: true, reviewDecision: true, testId: true },
    }),
  ]);

  const live = interviews.filter((i) => !i.cancelledAt);

  const rounds = sequence.map((round) => {
    // Match on the configured round first; fall back to the stage name so
    // interviews scheduled before roundSeq existed still line up.
    const matches = live.filter((i) =>
      i.roundSeq != null
        ? i.roundSeq === round.seq
        : String(i.stage || '').toLowerCase() === String(round.name || '').toLowerCase(),
    );

    let state: 'NOT_STARTED' | 'SCHEDULED' | 'COMPLETED' = 'NOT_STARTED';
    let detail: any = null;

    if (round.type === 'TEST') {
      const assigned = round.testId ? tests.find((t) => t.testId === round.testId) : tests[0];
      if (assigned) {
        state = assigned.status === 'Completed' ? 'COMPLETED' : 'SCHEDULED';
        detail = {
          assignedTestId: assigned.id, status: assigned.status,
          score: assigned.score, reviewDecision: assigned.reviewDecision,
        };
      }
    } else if (matches.length) {
      state = matches.some((m) => !!m.result) ? 'COMPLETED' : 'SCHEDULED';
      detail = { interviewIds: matches.map((m) => m.id), startTime: matches[0].startTime, result: matches[0].result };
    }

    return { ...round, state, detail };
  });

  // The next round is the first one not finished. Everything after it is
  // locked — HR can still force it, but must give a reason.
  const nextIndex = rounds.findIndex((r) => r.state !== 'COMPLETED');

  return {
    applicationId,
    jobId: application.jobId,
    configured: configured.length > 0,
    allComplete: nextIndex === -1,
    nextSeq: nextIndex === -1 ? null : rounds[nextIndex].seq,
    rounds: rounds.map((r, i) => ({
      ...r,
      isNext: i === nextIndex,
      canSchedule: i === nextIndex || r.state !== 'NOT_STARTED',
      needsOverride: i > nextIndex && r.state === 'NOT_STARTED',
    })),
  };
}

/** GET /recruiting/applications/:id/rounds */
export const getApplicationRounds = async (req: Request, res: Response) => {
  try {
    const applicationId = Number(req.params.id);
    const result = await computeApplicationRounds(applicationId);
    if (!result) return res.status(404).json({ error: 'Application not found' });
    res.json(result);
  } catch (error) {
    console.error('getApplicationRounds error:', error);
    res.status(500).json({ error: 'Failed to fetch the application rounds' });
  }
};

