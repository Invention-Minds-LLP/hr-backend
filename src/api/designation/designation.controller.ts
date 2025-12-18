import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/* ==========================
   DESIGNATION CONTROLLERS
   ========================== */

// Create Designation
export const createDesignation = async (req: Request, res: Response) => {
  try {
    const { name, isActive = true } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Designation name is required" });
    }

    const designation = await prisma.designation.create({
      data: {
        name,
        isActive
      }
    });

    res.status(201).json(designation);
  } catch (error: any) {
    console.error("Error creating designation:", error);

    if (error.code === "P2002") {
      return res.status(409).json({ error: "Designation already exists" });
    }

    res.status(500).json({ error: "Failed to create designation" });
  }
};

// Get All Designations
export const getDesignations = async (_req: Request, res: Response) => {
  try {
    const designations = await prisma.designation.findMany({
      orderBy: { name: "asc" }
    });

    res.json(designations);
  } catch (error) {
    console.error("Error fetching designations:", error);
    res.status(500).json({ error: "Failed to fetch designations" });
  }
};

// Get Single Designation by ID
export const getDesignationById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const designation = await prisma.designation.findUnique({
      where: { id: Number(id) }
    });

    if (!designation) {
      return res.status(404).json({ error: "Designation not found" });
    }

    res.json(designation);
  } catch (error) {
    console.error("Error fetching designation:", error);
    res.status(500).json({ error: "Failed to fetch designation" });
  }
};
