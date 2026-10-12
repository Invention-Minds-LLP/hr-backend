import { Request, Response } from 'express';
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";

export const getQuestionsByBank = async (req: Request, res: Response) => {
  try {
    const bankId = Number(req.params.bankId);
    const questions = await prisma.question.findMany({
      where: { questionBankId: bankId },
      include: { options: true }
    });
    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
};

export const createQuestion = async (req: Request, res: Response) => {
  try {
    const { questionBankId, text, type, weight, options, modelAnswer } = req.body;

    const question = await prisma.question.create({
      data: {
        questionBankId,
        text,
        type,
        weight,
        // Reference answer, only meaningful for a Descriptive question — it is
        // shown to the evaluator, never matched against the answer given.
        modelAnswer: type === 'Descriptive' ? (modelAnswer?.trim() || null) : null,
        options: {
          create: options ?? [] // Only for MCQs
        }
      },
      include: { options: true }
    });

    res.status(201).json(question);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create question' });
  }
};

export const deleteQuestion = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await prisma.questionOption.deleteMany({ where: { questionId: id } });
    await prisma.question.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete question' });
  }
};
// controllers/questions.ts
export const updateQuestion = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { text, type, weight, answerType, options, modelAnswer } = req.body;

    await prisma.$transaction(async (tx) => {
      // Update question fields
      await tx.question.update({
        where: { id },
        data: {
          text,
          type,
          weight,
          // Cleared when a question stops being descriptive, so a stale
          // reference answer can't show up under an MCQ.
          modelAnswer: type === 'Descriptive' ? (modelAnswer?.trim() || null) : null,
        }
        // (store answerType too if you add a DB column for it)
      });

      // Clear options if not descriptive; else remove any existing
      await tx.questionOption.deleteMany({ where: { questionId: id } });

      if (type !== 'Descriptive' && Array.isArray(options) && options.length) {
        await tx.questionOption.createMany({
          data: options.map((o: any) => ({
            questionId: id,
            text: o.text,
            isCorrect: !!o.isCorrect
          }))
        });
      }
    });

    const updated = await prisma.question.findUnique({
      where: { id },
      include: { options: true }
    });
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update question' });
  }
};
