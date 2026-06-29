import { Request, Response } from 'express';
import { InternshipRecommendation } from '@prisma/client';
import { prisma } from '../../lib/prisma';

const RECOMMENDATIONS: InternshipRecommendation[] = ['RETAIN', 'EXTEND', 'COMPLETE', 'TERMINATE'];

// Resolve evaluator (employee) names without a hard FK — mirrors how the
// internship module resolves mentorId.
async function buildNameMap(ids: (number | null | undefined)[]) {
    const uniq = Array.from(new Set(ids.filter((x): x is number => typeof x === 'number')));
    if (!uniq.length) return new Map<number, string>();
    const people = await prisma.employee.findMany({
        where: { id: { in: uniq } },
        select: { id: true, firstName: true, lastName: true },
    });
    return new Map(people.map(p => [p.id, `${p.firstName} ${p.lastName}`]));
}

const evalSelect = {
    id: true,
    internshipId: true,
    evaluatorId: true,
    periodLabel: true,
    evaluationDate: true,
    rating: true,
    strengths: true,
    areasToImprove: true,
    comments: true,
    recommendation: true,
    createdAt: true,
    updatedAt: true,
} as const;

// rating must be an integer 1-5 when provided. Returns an error string or null.
function validateRating(rating: unknown): string | null {
    if (rating === undefined || rating === null) return null;
    const n = Number(rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) return 'rating must be an integer between 1 and 5';
    return null;
}

function validateRecommendation(rec: unknown): string | null {
    if (rec === undefined || rec === null) return null;
    if (!RECOMMENDATIONS.includes(rec as InternshipRecommendation)) {
        return `recommendation must be one of ${RECOMMENDATIONS.join(', ')}`;
    }
    return null;
}

/** GET /api/internships/:id/evaluations */
export async function listEvaluations(req: Request, res: Response) {
    try {
        const internshipId = Number(req.params.id);
        const items = await prisma.internshipEvaluation.findMany({
            where: { internshipId },
            orderBy: { evaluationDate: 'desc' },
            select: evalSelect,
        });
        const nameMap = await buildNameMap(items.map(i => i.evaluatorId));
        const enriched = items.map(i => ({
            ...i,
            evaluatorName: i.evaluatorId ? nameMap.get(i.evaluatorId) || null : null,
        }));
        return res.json({ items: enriched });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Failed to list evaluations' });
    }
}

/** POST /api/internships/:id/evaluations */
export async function createEvaluation(req: Request, res: Response) {
    try {
        const internshipId = Number(req.params.id);
        const {
            evaluatorId, periodLabel, evaluationDate,
            rating, strengths, areasToImprove, comments, recommendation,
        } = req.body || {};

        const ratingErr = validateRating(rating);
        if (ratingErr) return res.status(400).json({ error: ratingErr });
        const recErr = validateRecommendation(recommendation);
        if (recErr) return res.status(400).json({ error: recErr });

        // Ensure the parent internship exists (FK would also catch this, but a
        // clean 404 is friendlier than a 500).
        const parent = await prisma.internship.findUnique({ where: { id: internshipId }, select: { id: true } });
        if (!parent) return res.status(404).json({ error: 'Internship not found' });

        const created = await prisma.internshipEvaluation.create({
            data: {
                internshipId,
                evaluatorId: evaluatorId == null ? null : Number(evaluatorId),
                periodLabel: periodLabel ?? null,
                evaluationDate: evaluationDate ? new Date(evaluationDate) : new Date(),
                rating: rating == null ? null : Number(rating),
                strengths: strengths ?? null,
                areasToImprove: areasToImprove ?? null,
                comments: comments ?? null,
                recommendation: (recommendation as InternshipRecommendation) ?? null,
            },
            select: evalSelect,
        });

        const nameMap = await buildNameMap([created.evaluatorId]);
        return res.status(201).json({
            ...created,
            evaluatorName: created.evaluatorId ? nameMap.get(created.evaluatorId) || null : null,
        });
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2003') return res.status(400).json({ error: 'Invalid foreign key (internshipId/evaluatorId)' });
        return res.status(500).json({ error: 'Failed to create evaluation' });
    }
}

/** PATCH /api/internships/:id/evaluations/:evalId */
export async function updateEvaluation(req: Request, res: Response) {
    try {
        const internshipId = Number(req.params.id);
        const evalId = Number(req.params.evalId);
        const {
            evaluatorId, periodLabel, evaluationDate,
            rating, strengths, areasToImprove, comments, recommendation,
        } = req.body || {};

        const ratingErr = validateRating(rating);
        if (ratingErr) return res.status(400).json({ error: ratingErr });
        const recErr = validateRecommendation(recommendation);
        if (recErr) return res.status(400).json({ error: recErr });

        // Scope the update to the internship in the path so an eval can't be
        // edited through the wrong parent.
        const existing = await prisma.internshipEvaluation.findFirst({
            where: { id: evalId, internshipId },
            select: { id: true },
        });
        if (!existing) return res.status(404).json({ error: 'Not found' });

        const updated = await prisma.internshipEvaluation.update({
            where: { id: evalId },
            data: {
                ...(evaluatorId !== undefined ? { evaluatorId: evaluatorId == null ? null : Number(evaluatorId) } : {}),
                ...(periodLabel !== undefined ? { periodLabel } : {}),
                ...(evaluationDate !== undefined ? { evaluationDate: evaluationDate == null ? undefined : new Date(evaluationDate) } : {}),
                ...(rating !== undefined ? { rating: rating == null ? null : Number(rating) } : {}),
                ...(strengths !== undefined ? { strengths } : {}),
                ...(areasToImprove !== undefined ? { areasToImprove } : {}),
                ...(comments !== undefined ? { comments } : {}),
                ...(recommendation !== undefined ? { recommendation: recommendation as InternshipRecommendation } : {}),
            },
            select: evalSelect,
        });

        const nameMap = await buildNameMap([updated.evaluatorId]);
        return res.json({
            ...updated,
            evaluatorName: updated.evaluatorId ? nameMap.get(updated.evaluatorId) || null : null,
        });
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
        if (e?.code === 'P2003') return res.status(400).json({ error: 'Invalid foreign key (evaluatorId)' });
        return res.status(500).json({ error: 'Failed to update evaluation' });
    }
}

/** DELETE /api/internships/:id/evaluations/:evalId */
export async function deleteEvaluation(req: Request, res: Response) {
    try {
        const internshipId = Number(req.params.id);
        const evalId = Number(req.params.evalId);

        const existing = await prisma.internshipEvaluation.findFirst({
            where: { id: evalId, internshipId },
            select: { id: true },
        });
        if (!existing) return res.status(404).json({ error: 'Not found' });

        await prisma.internshipEvaluation.delete({ where: { id: evalId } });
        return res.json({ ok: true });
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
        return res.status(500).json({ error: 'Failed to delete evaluation' });
    }
}
