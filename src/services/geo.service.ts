import { prisma } from "../lib/prisma";

export const closeIdleSessions = async () => {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);

  const sessions = await prisma.locationSession.findMany({
    where: {
      status: "ACTIVE"
    }
  });

  for (const session of sessions) {
    const lastPoint = await prisma.locationPoint.findFirst({
      where: { sessionId: session.id },
      orderBy: { recordedAt: "desc" }
    });

    if (!lastPoint || lastPoint.recordedAt < cutoff) {
      await prisma.locationSession.update({
        where: { id: session.id },
        data: {
          status: "COMPLETED",
          endedAt: new Date()
        }
      });
    }
  }
};
