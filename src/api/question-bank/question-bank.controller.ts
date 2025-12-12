import { Request, Response } from 'express';
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";

export const getAllQuestionBanks = async (req: Request, res: Response) => {
  try {
    const banks = await prisma.questionBank.findMany({
      include: { questions: true },
    });
    res.json(banks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch question banks' });
  }
};

export const createQuestionBank = async (req: Request, res: Response) => {
  try {
    const { name, role, departmentId, difficulty, createdBy } = req.body;
    const bank = await prisma.questionBank.create({
      data: {
        name,
        role,
        departmentId,
        difficulty,
        createdBy,
      },
    });
    res.status(201).json(bank);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create question bank' });
  }
};

export const updateQuestionBank = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, role, departmentId, difficulty } = req.body;
    const updated = await prisma.questionBank.update({
      where: { id: Number(id) },
      data: { name, role, departmentId, difficulty },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update question bank' });
  }
};

export const deleteQuestionBank = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.questionBank.delete({ where: { id: Number(id) } });
    res.json({ message: 'Deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete question bank' });
  }
};

export const getQuestionBankById = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const bank = await prisma.questionBank.findUnique({
      where: { id },
      include: {
        questions: {
          include: {
            options: true, // include MCQ options if you use them
          },
        },
      },
    });

    if (!bank) {
      return res.status(404).json({ error: 'Question bank not found' });
    }

    res.json(bank);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch question bank' });
  }
};
