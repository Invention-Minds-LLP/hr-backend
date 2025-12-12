import { Request, Response } from 'express';
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";

export const createTest = async (req: Request, res: Response) => {
  try {
    const { name, questionBankId, duration, passingPercent, maxAttempts, role,
      level,
      purpose,        // 'HIRING' | 'TRAINING' | 'ASSESSMENT' | 'OTHER'
      randomization,  // 'NONE' | 'SHUFFLE_QUESTIONS' | 'SHUFFLE_OPTIONS' | 'BOTH'
      instructions,
      isPublished,
      activeFrom,
      activeTo } = req.body;

    const test = await prisma.evaluationTest.create({
      data: {
        name,
        questionBankId,
        duration,
        passingPercent,
        maxAttempts,
        role: role ?? null,
        level: level ?? null,
        purpose: purpose ?? null,
        randomization: randomization ?? 'NONE',
        instructions: instructions ?? null,
        isPublished: isPublished ?? true,
        activeFrom: activeFrom ? new Date(activeFrom) : null,
        activeTo: activeTo ? new Date(activeTo) : null
      }
    });

    res.status(201).json(test);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create evaluation test' });
  }
};

export const getAllTests = async (req: Request, res: Response) => {
  try {
    const tests = await prisma.evaluationTest.findMany({
      include: { questions: true }
    });

    const bankIds = [...new Set(tests.map(t => t.questionBankId))];
    const banks = await prisma.questionBank.findMany({
      where: { id: { in: bankIds } },
      select: { id: true, name: true }
    });

    const bankMap = Object.fromEntries(banks.map(b => [b.id, b.name]));

    const shaped = tests.map(t => ({
      ...t,
      questionBankName: bankMap[t.questionBankId] ?? null
    }));

    res.json(shaped);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
};


export const updateTest = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const {
      name, questionBankId, duration, passingPercent, maxAttempts,
      role, level, purpose, randomization, instructions, isPublished, activeFrom, activeTo
    } = req.body;

    const updated = await prisma.evaluationTest.update({
      where: { id },
      data: {
        name,
        questionBankId,
        duration,
        passingPercent,
        maxAttempts,
        role: role ?? null,
        level: level ?? null,
        purpose: purpose ?? null,
        randomization: randomization ?? 'NONE',
        instructions: instructions ?? null,
        isPublished: isPublished ?? false,
        activeFrom: activeFrom ? new Date(activeFrom) : null,
        activeTo: activeTo ? new Date(activeTo) : null,
      }
    });

    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update evaluation test' });
  }
};
