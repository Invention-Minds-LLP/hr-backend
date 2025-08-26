import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// CREATE Branch
export const createBranch = async (req: Request, res: Response) => {
  try {
    const { name, location } = req.body;

    const branch = await prisma.branch.create({
      data: { name, location }
    });

    res.status(201).json(branch);
  } catch (error) {
    res.status(500).json({ error: "Failed to create branch" });
  }
};

// GET all Branches
export const getBranches = async (req: Request, res: Response) => {
  try {
    const branches = await prisma.branch.findMany();
    res.json(branches);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch branches" });
  }
};

// GET Branch by ID
export const getBranchById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const branch = await prisma.branch.findUnique({
      where: { id: Number(id) }
    });

    if (!branch) return res.status(404).json({ error: "Branch not found" });
    res.json(branch);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch branch" });
  }
};

// UPDATE Branch
export const updateBranch = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, location } = req.body;

    const updatedBranch = await prisma.branch.update({
      where: { id: Number(id) },
      data: { name, location }
    });

    res.json(updatedBranch);
  } catch (error) {
    res.status(500).json({ error: "Failed to update branch" });
  }
};

// DELETE Branch
export const deleteBranch = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.branch.delete({
      where: { id: Number(id) }
    });

    res.json({ message: "Branch deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete branch" });
  }
};
