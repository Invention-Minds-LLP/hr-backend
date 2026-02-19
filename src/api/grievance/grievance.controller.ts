import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
// import { PrismaClient, PermissionStatus } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";

// --- Create grievance
export const createGrievance = asyncHandler(async (req: Request, res: Response) => {
  const {  title, description, category } = req.body;
  let employeeId = Number(req.body.employeeId);
  const grievance = await prisma.grievance.create({
    data: { employeeId, title, description, category }
  });
    // 🔔 Notify HR
    const hrEmployees = await prisma.employee.findMany({
      where: {
        departmentId: 1   // ✅ HR department
      },
      select: { id: true }
    });
    
  
    // for (const hr of hrEmployees) {
    //   await createNotification(
    //     hr.id,
    //     'New grievance submitted — requires acknowledgment'
    //   );
    // }
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