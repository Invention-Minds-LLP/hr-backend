import { Request, Response } from "express";
import { PrismaClient, PermissionStatus } from "@prisma/client";
const prisma = new PrismaClient();


export const createIncident = async (req: any, res: Response) => {
  try {
    const { employeeId, title, description, attachment } = req.body;
    const reportedBy = req.user?.userId; // Authenticated user

    if (!employeeId || !title || !description) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const incident = await prisma.incident.create({
      data: {
        employeeId: Number(employeeId),
        reportedBy: Number(reportedBy),
        title,
        description,
        status: "OPEN",
        attachment: attachment || null,
      },
    });

    res.json({ message: "Incident created successfully", data: incident });
  } catch (err) {
    console.error("Error creating incident:", err);
    res.status(500).json({ error: "Failed to create incident" });
  }
};


// 📌 List all incidents reported BY this manager
export const listIncidentsByReporter = async (req: any, res: Response) => {
  try {
    const reporterId = Number(req.params.reporterId);

    const list = await prisma.incident.findMany({
      where: { reportedBy: reporterId },
      include: {
        employee: true,
        reporter: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(list);
  } catch (err) {
    console.error("Error fetching incidents:", err);
    res.status(500).json({ error: "Failed to load incidents" });
  }
};


// 📌 List all incidents filed AGAINST an employee
export const listIncidentsByEmployee = async (req: any, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);

    const list = await prisma.incident.findMany({
      where: { employeeId },
      include: {
        employee: true,
        reporter: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(list);
  } catch (err) {
    console.error("Error fetching incidents:", err);
    res.status(500).json({ error: "Failed to load incidents" });
  }
};
