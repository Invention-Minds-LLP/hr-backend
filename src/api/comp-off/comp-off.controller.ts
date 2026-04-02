import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";

export const getCompOffCredits = async (req: Request, res: Response) => {
  try {
    const { employeeId, status } = req.query;
    const where: any = {};
    if (employeeId) where.employeeId = Number(employeeId);
    if (status === 'used') where.used = true;
    if (status === 'unused') where.used = false;

    const credits = await prisma.compOffCredit.findMany({
      where,
      include: {
        employee: { select: { employeeCode: true, firstName: true, lastName: true, Department: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(credits);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const createCompOff = async (req: Request, res: Response) => {
  try {
    const { employeeId, workDate, expiryDate, grantedBy, grantReason } = req.body;

    if (!employeeId || !workDate) {
      return res.status(400).json({ error: "employeeId and workDate are required" });
    }

    const credit = await prisma.compOffCredit.create({
      data: {
        employeeId: Number(employeeId),
        workDate: new Date(workDate),
        expiryDate: expiryDate ? new Date(expiryDate) : new Date(new Date(workDate).setMonth(new Date(workDate).getMonth() + 3)),
        isManualGrant: true,
        grantedBy: grantedBy ? Number(grantedBy) : null,
        grantReason: grantReason || null,
      },
      include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
    });

    return res.status(201).json(credit);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

export const deleteCompOff = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const credit = await prisma.compOffCredit.findUnique({ where: { id } });
    if (!credit) return res.status(404).json({ error: "Comp off not found" });
    if (credit.used) return res.status(400).json({ error: "Cannot delete a used comp off" });

    await prisma.compOffCredit.delete({ where: { id } });
    return res.json({ message: "Comp off deleted" });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
