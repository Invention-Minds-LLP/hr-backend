import { Request, Response } from 'express';
import { StipendStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';

const STATUSES: StipendStatus[] = ['PENDING', 'PAID', 'CANCELLED'];

const stipendSelect = {
    id: true,
    internshipId: true,
    periodMonth: true,
    amount: true,
    status: true,
    paidAt: true,
    notes: true,
    createdAt: true,
    updatedAt: true,
} as const;

// Normalise a period to the first day of its month so the (internshipId, periodMonth)
// unique constraint treats any day in a month as the same period.
function monthStart(input: string | Date): Date {
    const d = new Date(input);
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

function validateAmount(amount: unknown): string | null {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) return 'amount must be a non-negative number';
    return null;
}

function validateStatus(status: unknown): string | null {
    if (status === undefined || status === null) return null;
    if (!STATUSES.includes(status as StipendStatus)) {
        return `status must be one of ${STATUSES.join(', ')}`;
    }
    return null;
}

/** GET /api/internships/:id/stipends */
export async function listStipends(req: Request, res: Response) {
    try {
        const internshipId = Number(req.params.id);
        const items = await prisma.internshipStipend.findMany({
            where: { internshipId },
            orderBy: { periodMonth: 'asc' },
            select: stipendSelect,
        });

        // Lightweight summary (paid vs pending) so the UI doesn't recompute it.
        const summary = items.reduce(
            (acc, s) => {
                if (s.status === 'PAID') { acc.paidAmount += s.amount; acc.paidCount += 1; }
                else if (s.status === 'PENDING') { acc.pendingAmount += s.amount; acc.pendingCount += 1; }
                return acc;
            },
            { paidAmount: 0, pendingAmount: 0, paidCount: 0, pendingCount: 0 },
        );

        return res.json({ items, summary });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Failed to list stipends' });
    }
}

/** POST /api/internships/:id/stipends */
export async function createStipend(req: Request, res: Response) {
    try {
        const internshipId = Number(req.params.id);
        const { periodMonth, amount, status, paidAt, notes } = req.body || {};

        if (!periodMonth) return res.status(400).json({ error: 'periodMonth is required' });
        const amountErr = validateAmount(amount);
        if (amountErr) return res.status(400).json({ error: amountErr });
        const statusErr = validateStatus(status);
        if (statusErr) return res.status(400).json({ error: statusErr });

        const parent = await prisma.internship.findUnique({ where: { id: internshipId }, select: { id: true } });
        if (!parent) return res.status(404).json({ error: 'Internship not found' });

        const finalStatus = (status as StipendStatus) ?? 'PENDING';
        // If created already PAID, default paidAt to now unless supplied.
        const finalPaidAt = finalStatus === 'PAID' ? (paidAt ? new Date(paidAt) : new Date()) : null;

        const created = await prisma.internshipStipend.create({
            data: {
                internshipId,
                periodMonth: monthStart(periodMonth),
                amount: Number(amount),
                status: finalStatus,
                paidAt: finalPaidAt,
                notes: notes ?? null,
            },
            select: stipendSelect,
        });
        return res.status(201).json(created);
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2002') return res.status(409).json({ error: 'A stipend for this month already exists' });
        if (e?.code === 'P2003') return res.status(400).json({ error: 'Invalid internshipId' });
        return res.status(500).json({ error: 'Failed to create stipend' });
    }
}

/** PATCH /api/internships/:id/stipends/:stipendId */
export async function updateStipend(req: Request, res: Response) {
    try {
        const internshipId = Number(req.params.id);
        const stipendId = Number(req.params.stipendId);
        const { periodMonth, amount, status, paidAt, notes } = req.body || {};

        if (amount !== undefined) {
            const amountErr = validateAmount(amount);
            if (amountErr) return res.status(400).json({ error: amountErr });
        }
        const statusErr = validateStatus(status);
        if (statusErr) return res.status(400).json({ error: statusErr });

        const existing = await prisma.internshipStipend.findFirst({
            where: { id: stipendId, internshipId },
            select: { id: true, status: true, paidAt: true },
        });
        if (!existing) return res.status(404).json({ error: 'Not found' });

        // paidAt ergonomics: moving into PAID stamps paidAt (unless explicitly given);
        // moving out of PAID clears it.
        let paidAtData: Date | null | undefined = undefined;
        if (paidAt !== undefined) {
            paidAtData = paidAt == null ? null : new Date(paidAt);
        } else if (status !== undefined) {
            if (status === 'PAID' && !existing.paidAt) paidAtData = new Date();
            else if (status !== 'PAID') paidAtData = null;
        }

        const updated = await prisma.internshipStipend.update({
            where: { id: stipendId },
            data: {
                ...(periodMonth !== undefined ? { periodMonth: monthStart(periodMonth) } : {}),
                ...(amount !== undefined ? { amount: Number(amount) } : {}),
                ...(status !== undefined ? { status: status as StipendStatus } : {}),
                ...(paidAtData !== undefined ? { paidAt: paidAtData } : {}),
                ...(notes !== undefined ? { notes } : {}),
            },
            select: stipendSelect,
        });
        return res.json(updated);
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
        if (e?.code === 'P2002') return res.status(409).json({ error: 'A stipend for this month already exists' });
        return res.status(500).json({ error: 'Failed to update stipend' });
    }
}

/**
 * POST /api/internships/:id/stipends/generate
 * Creates a PENDING stipend row for each month from the internship's startDate to
 * endDate (inclusive), at the internship's stipend amount (or a body-supplied
 * amount). Existing months are skipped, so it's safe to re-run.
 */
export async function generateStipendSchedule(req: Request, res: Response) {
    try {
        const internshipId = Number(req.params.id);
        const { amount: bodyAmount } = req.body || {};

        const intern = await prisma.internship.findUnique({
            where: { id: internshipId },
            select: { startDate: true, endDate: true, stipend: true },
        });
        if (!intern) return res.status(404).json({ error: 'Internship not found' });
        if (!intern.endDate) return res.status(400).json({ error: 'Internship has no end date to build a schedule from' });

        const amount = bodyAmount != null ? Number(bodyAmount) : intern.stipend;
        if (amount == null) return res.status(400).json({ error: 'No stipend amount set on the internship; provide an amount' });
        const amountErr = validateAmount(amount);
        if (amountErr) return res.status(400).json({ error: amountErr });

        const start = monthStart(intern.startDate);
        const end = monthStart(intern.endDate);
        if (end < start) return res.status(400).json({ error: 'endDate is before startDate' });

        const rows: { internshipId: number; periodMonth: Date; amount: number; status: StipendStatus }[] = [];
        const cursor = new Date(start);
        // Guard against runaway loops (e.g. bad dates) — 120 months is 10 years.
        for (let i = 0; i < 120 && cursor <= end; i++) {
            rows.push({ internshipId, periodMonth: new Date(cursor), amount: Number(amount), status: 'PENDING' });
            cursor.setMonth(cursor.getMonth() + 1);
        }

        // skipDuplicates relies on the (internshipId, periodMonth) unique constraint.
        const result = await prisma.internshipStipend.createMany({ data: rows, skipDuplicates: true });
        return res.status(201).json({ created: result.count, monthsInRange: rows.length });
    } catch (e: any) {
        console.error(e);
        return res.status(500).json({ error: 'Failed to generate stipend schedule' });
    }
}

/** DELETE /api/internships/:id/stipends/:stipendId */
export async function deleteStipend(req: Request, res: Response) {
    try {
        const internshipId = Number(req.params.id);
        const stipendId = Number(req.params.stipendId);

        const existing = await prisma.internshipStipend.findFirst({
            where: { id: stipendId, internshipId },
            select: { id: true },
        });
        if (!existing) return res.status(404).json({ error: 'Not found' });

        await prisma.internshipStipend.delete({ where: { id: stipendId } });
        return res.json({ ok: true });
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
        return res.status(500).json({ error: 'Failed to delete stipend' });
    }
}
