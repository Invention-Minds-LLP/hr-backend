import { Request, Response } from "express";
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import test from "node:test";

/* ======================================================
   TRAINING CRUD + ASSIGNMENT
   ====================================================== */

/**
 * Create new training with optional linked tests
 */
export const createTraining = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const {
      title,
      description,
      objectives,
      mode,
      location,
      startDate,
      endDate,
      departmentId,
      testIds,
      trainers, // 👈 array of trainers (internal/external)
      trainingTests, // 👈 array of { testId, isMandatory, orderNo
    } = req.body;

    const training = await prisma.training.create({
      data: {
        title,
        description,
        objectives,
        mode,
        location,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        departmentId,
        createdBy: Number(userId),
        status: "ACTIVE",

        // 👇 store JSON trainers directly
        trainers,

        trainingTests: {
          create: trainingTests?.map((t: any, index: number) => ({
            testId: t.testId,
            isMandatory: t.isMandatory ?? true,
            orderNo: t.orderNo ?? index + 1,
            testDate: t.testDate ? new Date(t.testDate) : null,
            deadlineDate: t.deadlineDate ? new Date(t.deadlineDate) : null,
          })),
        },

      },
      include: {
        trainingTests: { include: { test: true } },
      },
    });

    res.status(201).json(training);
  } catch (error) {
    console.error("❌ Failed to create training:", error);
    res.status(500).json({ error: "Failed to create training" });
  }
};


/**
 * Assign employees to training + auto-assign mandatory tests
 */
// export const assignTraining = async (req: Request, res: Response) => {
//   try {
//     const { trainingId, employeeIds, assignedBy } = req.body;

//     const training = await prisma.training.findUnique({
//       where: { id: trainingId },
//       include: { trainingTests: true },
//     });

//     if (!training) return res.status(404).json({ error: "Training not found" });

//     const mandatoryTests = training.trainingTests.filter((t) => t.isMandatory);

//     const assignments = [];

//     for (const empId of employeeIds) {
//       const assignment = await prisma.trainingAssignment.create({
//         data: {
//           trainingId,
//           employeeId: empId,
//           assignedBy,
//           status: "NotStarted",
//         },
//       });

//       for (const test of mandatoryTests) {
//         await prisma.assignedTest.create({
//           data: {
//             testId: test.testId,
//             employeeId: empId,
//             assignedBy,
//             status: "NotStarted",
//             trainingAssignmentId: assignment.id,
//             testDate: test.testDate ? new Date(test.testDate) : null,
//             deadlineDate: test.deadlineDate ? new Date(test.deadlineDate) : null,

//           },
//         });
//       }

//       await createNotification(
//         empId,
//         `You have been assigned to the training: ${training.title}`
//       );

//       assignments.push(assignment);
//     }

//     res.status(201).json({
//       message: "Training assigned successfully",
//       assignments,
//     });
//   } catch (error) {
//     console.error("❌ Failed to assign training:", error);
//     res.status(500).json({ error: "Failed to assign training" });
//   }
// };
export const assignTraining = async (req: Request, res: Response) => {
  try {
    const { trainingId, employeeIds, assignedBy } = req.body;

    const training = await prisma.training.findUnique({
      where: { id: trainingId },
      include: { trainingTests: true },
    });

    if (!training) {
      return res.status(404).json({ error: "Training not found" });
    }

    const mandatoryTests = training.trainingTests.filter((t) => t.isMandatory);

    const assignedEmployees: number[] = [];
    const alreadyAssignedEmployees: number[] = [];

    for (const empId of employeeIds) {
      // 🔍 Check existing assignment
      const existing = await prisma.trainingAssignment.findFirst({
        where: {
          trainingId,
          employeeId: empId,
        },
      });

      if (existing) {
        alreadyAssignedEmployees.push(empId);
        continue; // skip this employee
      }

      // ✅ Create assignment
      const assignment = await prisma.trainingAssignment.create({
        data: {
          trainingId,
          employeeId: empId,
          assignedBy,
          status: "NotStarted",
        },
      });

      // Assign mandatory tests
      for (const test of mandatoryTests) {
        await prisma.assignedTest.create({
          data: {
            testId: test.testId,
            employeeId: empId,
            assignedBy,
            status: "NotStarted",
            trainingAssignmentId: assignment.id,
            testDate: test.testDate ? new Date(test.testDate) : null,
            deadlineDate: test.deadlineDate ? new Date(test.deadlineDate) : null,
          },
        });
      }

      // await createNotification(
      //   empId,
      //   `You have been assigned to the training: ${training.title}`
      // );

      assignedEmployees.push(empId);
    }

    return res.status(201).json({
      message: "Training assignment completed",
      assignedEmployees,
      alreadyAssignedEmployees,
    });

  } catch (error) {
    console.error("❌ Failed to assign training:", error);
    res.status(500).json({ error: "Failed to assign training" });
  }
};

/**
 * Get all trainings or filter by employeeId
 */
export const getTrainings = async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.query;
    const whereClause: any = {};

    // If employeeId provided → show only trainings assigned to that employee
    if (employeeId) {
      whereClause.assignedEmployees = {
        some: { employeeId: Number(employeeId) },
      };
    }

    const trainings = await prisma.training.findMany({
      where: whereClause,
      include: {
        trainingTests: { include: { test: true } },
        feedbacks: true,
        assignedEmployees: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                Department: {
                  select: { name: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(trainings);
  } catch (error) {
    console.error("❌ Failed to fetch trainings:", error);
    res.status(500).json({ error: "Failed to fetch trainings" });
  }
};


/**
 * Mark a training as completed by an employee
 */
export const markTrainingCompleted = async (req: Request, res: Response) => {
  try {
    const { trainingId, employeeId } = req.body;

    const assignment = await prisma.trainingAssignment.update({
      where: {
        trainingId_employeeId: {
          trainingId,
          employeeId,
        },
      },
      data: {
        status: "Completed",
        completedAt: new Date(),
        progress: 100,
      },
    });

    // await createNotification(
    //   employeeId,
    //   `🎉 You have successfully completed the training!`
    // );

    res.json(assignment);
  } catch (error) {
    console.error("❌ Failed to mark training completed:", error);
    res.status(500).json({ error: "Failed to mark training completed" });
  }
};

/* ======================================================
   FEEDBACK MODULE
   ====================================================== */

/**
 * Submit feedback after training completion
 */
export const submitTrainingFeedback = async (req: Request, res: Response) => {
  try {
    const {
      trainingId,
      employeeId,
      rating,
      feedback,
      trainerRating,
      contentQuality,
      relevance,
      suggestions,
    } = req.body;

    const assignment = await prisma.trainingAssignment.findUnique({
      where: {
        trainingId_employeeId: {
          trainingId,
          employeeId,
        },
      },
    });

    if (!assignment)
      return res.status(404).json({ error: "Training assignment not found" });

    const existingFeedback = await prisma.trainingFeedback.findUnique({
      where: {
        trainingId_employeeId: {
          trainingId,
          employeeId,
        },
      },
    });

    if (existingFeedback)
      return res
        .status(400)
        .json({ error: "Feedback already submitted for this training" });

    const feedbackRecord = await prisma.trainingFeedback.create({
      data: {
        trainingId,
        employeeId,
        rating,
        feedback,
        trainerRating,
        contentQuality,
        relevance,
        suggestions,
      },
    });

    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true }
    });

    const training = await prisma.training.findUnique({
      where: { id: trainingId },
      select: { title: true }
    });

    const employeeName = `${emp?.firstName || ""} ${emp?.lastName || ""}`.trim();

    // await createNotification(
    //   assignment.assignedBy,
    //   `📋 ${employeeName} has submitted feedback for the training: ${training?.title || "Training"}.`
    // );

    res.status(201).json(feedbackRecord);
  } catch (error) {
    console.error("❌ Failed to submit training feedback:", error);
    res.status(500).json({ error: "Failed to submit training feedback" });
  }
};

/**
 * Get summarized feedback for a training
 */
export const getTrainingFeedbackSummary = async (req: Request, res: Response) => {
  try {
    const { trainingId } = req.params;

    const feedbacks = await prisma.trainingFeedback.findMany({
      where: { trainingId: Number(trainingId) },
      include: { employee: true },
    });

    if (feedbacks.length === 0)
      return res.json({ message: "No feedback received yet" });

    // Helper: safely calculate average of numeric fields
    const getAverage = (field: keyof typeof feedbacks[0]) => {
      const nums = feedbacks
        .map((f) => Number(f[field]))
        .filter((v) => !isNaN(v)); // keep only valid numbers
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    };

    const summary = {
      totalFeedbacks: feedbacks.length,
      averageRating: getAverage("rating").toFixed(2),
      averageTrainerRating: getAverage("trainerRating").toFixed(2),
      averageContentQuality: getAverage("contentQuality").toFixed(2),
      averageRelevance: getAverage("relevance").toFixed(2),
      feedbacks,
    };

    res.json(summary);
  } catch (error) {
    console.error("❌ Failed to fetch training feedback summary:", error);
    res.status(500).json({ error: "Failed to fetch feedback summary" });
  }
};

export const updateTraining = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      objectives,
      mode,
      location,
      startDate,
      endDate,
      departmentId,
      trainers,
      trainingTests, // array of { testId, isMandatory, orderNo }
    } = req.body;

    const existing = await prisma.training.findUnique({
      where: { id: Number(id) },
      include: { trainingTests: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Training not found" });
    }

    // 🧩 Step 1: Update main training fields
    const updatedTraining = await prisma.training.update({
      where: { id: Number(id) },
      data: {
        title,
        description,
        objectives,
        mode,
        location,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        departmentId,
        trainers, // store updated JSON
        updatedAt: new Date(),
      },
    });

    // 🧩 Step 2: Replace linked tests
    // First, delete old trainingTests
    await prisma.trainingTest.deleteMany({
      where: { trainingId: Number(id) },
    });

    // Then recreate based on new list
    if (Array.isArray(trainingTests) && trainingTests.length > 0) {
      await prisma.trainingTest.createMany({
        data: trainingTests.map((t: any, index: number) => ({
          trainingId: Number(id),
          testId: t.testId,
          isMandatory: t.isMandatory ?? true,
          orderNo: t.orderNo ?? index + 1,
        })),
      });
    }

    // 🧩 Step 3: Return the updated training with its tests
    const result = await prisma.training.findUnique({
      where: { id: Number(id) },
      include: { trainingTests: { include: { test: true } } },
    });

    res.json({ message: "Training updated successfully", training: result });
  } catch (error) {
    console.error("❌ Failed to update training:", error);
    res.status(500).json({ error: "Failed to update training" });
  }
};
export const markTrainingAttendance = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { trainingId } = req.params;
    const { employeeId, status } = req.body;
    const markedBy = req.user.userId;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1️⃣ Check if an attendance already exists
    const existing = await prisma.trainingAttendance.findFirst({
      where: {
        trainingId: Number(trainingId),
        employeeId: Number(employeeId),
        date: today,
      }
    });

    let record;

    if (existing) {
      // 2️⃣ Update it
      record = await prisma.trainingAttendance.update({
        where: { id: existing.id },
        data: {
          status,
          markedAt: new Date(),
          markedBy,
        }
      });
    } else {
      // 3️⃣ Create new attendance
      record = await prisma.trainingAttendance.create({
        data: {
          trainingId: Number(trainingId),
          employeeId: Number(employeeId),
          date: today,
          status,
          markedAt: new Date(),
          markedBy,
        }
      });
    }
    const training = await prisma.training.findUnique({
      where: { id: Number(trainingId) },
      select: { title: true }
    });

    // await createNotification(
    //   employeeId,
    //   `Your attendance for the training "${training?.title || 'Training'}" has been marked as: ${status}.`
    // );
    res.json({
      message: "Attendance marked successfully",
      data: record,
    });

  } catch (err) {
    console.error("Error marking attendance:", err);
    res.status(500).json({ error: "Failed to mark attendance" });
  }
};
export const getTrainingAttendance = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { trainingId } = req.params;

    const attendance = await prisma.trainingAttendance.findMany({
      where: { trainingId: Number(trainingId) },
      include: {
        employee: true,
      }
    });

    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch attendance" });
  }
};
export const bulkMarkTrainingAttendance = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { trainingId } = req.params;
    const { attendanceList } = req.body; // [{employeeId, status}, ...]

    const markedBy = req.user.userId;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const entry of attendanceList) {
      await prisma.trainingAttendance.upsert({
        where: {
          trainingId_employeeId_date: {
            trainingId: Number(trainingId),
            employeeId: entry.employeeId,
            date: today,
          }
        },
        update: {
          status: entry.status,
          markedAt: new Date(),
          markedBy,
        },
        create: {
          trainingId: Number(trainingId),
          employeeId: entry.employeeId,
          date: today,
          status: entry.status,
          markedAt: new Date(),
          markedBy,
        }
      });
      const training = await prisma.training.findUnique({
        where: { id: Number(trainingId) },
        select: { title: true }
      });

      // await createNotification(
      //   entry.employeeId,
      //   `Your attendance for the training "${training?.title || 'Training'}" has been marked as: ${entry.status}.`
      // );

    }

    res.json({ message: "Bulk attendance updated" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update bulk attendance" });
  }
};
