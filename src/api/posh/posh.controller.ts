import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { PrismaClient, PermissionStatus } from "@prisma/client";
const prisma = new PrismaClient();

// --- File POSH case
export const createPoshCase = asyncHandler(async (req: Request, res: Response) => {
  const {  accusedId, description } = req.body;
  let complainantId = req.body.complainantId;
  complainantId = Number(complainantId);
  const posh = await prisma.poshCase.create({
    data: { complainantId, accusedId, description }
  });
  res.json(posh);
});

// --- List POSH cases
export const listPoshCases = asyncHandler(async (_req: Request, res: Response) => {
  const cases = await prisma.poshCase.findMany({
    include: { complainant: true, accused: true, hearings: true }
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
  res.json(posh);
});

// --- Get hearings by Case ID
export const getHearings = asyncHandler(async (req: Request, res: Response) => {
    const poshId = Number(req.params.id);
    const hearings = await prisma.poshHearing.findMany({
      where: { poshId },
      orderBy: { date: 'asc' },
    });
    res.json(hearings);
  });
  