import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { PrismaClient, PermissionStatus } from "@prisma/client";
const prisma = new PrismaClient();

// --- Create grievance
export const createGrievance = asyncHandler(async (req: Request, res: Response) => {
  const {  title, description, category } = req.body;
  let employeeId = Number(req.body.employeeId);
  const grievance = await prisma.grievance.create({
    data: { employeeId, title, description, category }
  });
  res.json(grievance);
});

// --- List grievances
export const listGrievances = asyncHandler(async (_req: Request, res: Response) => {
  const grievances = await prisma.grievance.findMany({
    include: { employee: true, comments: { include: { employee: true } } }
  });
  res.json(grievances);
});

// --- Add comment
export const addGrievanceComment = asyncHandler(async (req: Request, res: Response) => {
  const grievanceId = Number(req.params.id);
  const {  comment } = req.body;
  let employeeId = Number(req.body.employeeId);
  const c = await prisma.grievanceComment.create({
    data: { grievanceId, employeeId, comment }
  });
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
  res.json(g);
});
