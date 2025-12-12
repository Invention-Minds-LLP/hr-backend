import { Request, Response } from "express";
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";

// CREATE Department
export const createDepartment = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    const department = await prisma.department.create({
      data: { name }
    });

    res.status(201).json(department);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create department" });
  }
};

// GET all Departments
export const getDepartments = async (req: Request, res: Response) => {
  try {
    const departments = await prisma.department.findMany();
    res.json(departments);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch departments" });
  }
};

// GET Department by ID
export const getDepartmentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const department = await prisma.department.findUnique({
      where: { id: Number(id) }
    });

    if (!department) return res.status(404).json({ error: "Department not found" });
    res.json(department);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch department" });
  }
};

// UPDATE Department
export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const updatedDepartment = await prisma.department.update({
      where: { id: Number(id) },
      data: { name }
    });

    res.json(updatedDepartment);
  } catch (error) {
    res.status(500).json({ error: "Failed to update department" });
  }
};

// DELETE Department
export const deleteDepartment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.department.delete({
      where: { id: Number(id) }
    });

    res.json({ message: "Department deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete department" });
  }
};
