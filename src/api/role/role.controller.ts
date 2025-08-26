import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// CREATE Role
export const createRole = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;

    const role = await prisma.role.create({
      data: { name, description }
    });

    res.status(201).json(role);
  } catch (error) {
    res.status(500).json({ error: "Failed to create role" });
  }
};

// GET all Roles
export const getRoles = async (req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany();
    res.json(roles);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch roles" });
  }
};

// GET Role by ID
export const getRoleById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const role = await prisma.role.findUnique({
      where: { id: Number(id) }
    });

    if (!role) return res.status(404).json({ error: "Role not found" });
    res.json(role);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch role" });
  }
};

// UPDATE Role
export const updateRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const updatedRole = await prisma.role.update({
      where: { id: Number(id) },
      data: { name, description }
    });

    res.json(updatedRole);
  } catch (error) {
    res.status(500).json({ error: "Failed to update role" });
  }
};

// DELETE Role
export const deleteRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.role.delete({
      where: { id: Number(id) }
    });

    res.json({ message: "Role deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete role" });
  }
};
