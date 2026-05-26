import { Request, Response } from "express";
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";

// Whitelist the planning/appraisal master fields a Department write may set.
const planningData = (body: any) => {
  const data: any = {};
  if (body.otBudgetHoursPerMonth !== undefined) data.otBudgetHoursPerMonth = Math.max(0, Number(body.otBudgetHoursPerMonth) || 0);
  if (body.minDailyStrength !== undefined) data.minDailyStrength = Math.max(0, Number(body.minDailyStrength) || 0);
  if (body.appraisalCycleBasis !== undefined) data.appraisalCycleBasis = body.appraisalCycleBasis === "CALENDAR" ? "CALENDAR" : "DOJ";
  if (body.appraisalPeriodMonths !== undefined) data.appraisalPeriodMonths = [6, 12].includes(Number(body.appraisalPeriodMonths)) ? Number(body.appraisalPeriodMonths) : 12;
  if (body.appraisalCalendarMonth !== undefined) data.appraisalCalendarMonth = body.appraisalCalendarMonth ? Math.min(12, Math.max(1, Number(body.appraisalCalendarMonth))) : null;
  return data;
};

// CREATE Department
export const createDepartment = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    const department = await prisma.department.create({
      data: { name, ...planningData(req.body) }
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
      data: { ...(name !== undefined ? { name } : {}), ...planningData(req.body) }
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
