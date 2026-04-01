import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

// Create Designation
export const createDesignation = async (req: Request, res: Response) => {
  try {
    const { name, isActive = true } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Designation name is required" });
    }

    const designation = await prisma.designation.create({
      data: { name, isActive },
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
      orderBy: { name: "asc" },
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
      where: { id: Number(id) },
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

// Update Designation
export const updateDesignation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;

    const designation = await prisma.designation.update({
      where: { id: Number(id) },
      data: {
        ...(name !== undefined && { name }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json(designation);
  } catch (error: any) {
    console.error("Error updating designation:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Designation not found" });
    }
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Designation name already exists" });
    }
    res.status(500).json({ error: "Failed to update designation" });
  }
};

// Delete Designation
export const deleteDesignation = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.designation.delete({ where: { id: Number(id) } });
    res.json({ message: "Designation deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting designation:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Designation not found" });
    }
    res.status(500).json({ error: "Failed to delete designation" });
  }
};
