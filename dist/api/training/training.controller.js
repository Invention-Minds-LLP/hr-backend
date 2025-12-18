"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bulkMarkTrainingAttendance = exports.getTrainingAttendance = exports.markTrainingAttendance = exports.updateTraining = exports.getTrainingFeedbackSummary = exports.submitTrainingFeedback = exports.markTrainingCompleted = exports.getTrainings = exports.assignTraining = exports.createTraining = void 0;
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
/* ======================================================
   TRAINING CRUD + ASSIGNMENT
   ====================================================== */
/**
 * Create new training with optional linked tests
 */
const createTraining = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
        const { title, description, objectives, mode, location, startDate, endDate, departmentId, testIds, trainers, // 👈 array of trainers (internal/external)
        trainingTests, // 👈 array of { testId, isMandatory, orderNo
         } = req.body;
        const training = yield prisma_1.prisma.training.create({
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
                    create: trainingTests === null || trainingTests === void 0 ? void 0 : trainingTests.map((t, index) => {
                        var _a, _b;
                        return ({
                            testId: t.testId,
                            isMandatory: (_a = t.isMandatory) !== null && _a !== void 0 ? _a : true,
                            orderNo: (_b = t.orderNo) !== null && _b !== void 0 ? _b : index + 1,
                            testDate: t.testDate ? new Date(t.testDate) : null,
                            deadlineDate: t.deadlineDate ? new Date(t.deadlineDate) : null,
                        });
                    }),
                },
            },
            include: {
                trainingTests: { include: { test: true } },
            },
        });
        res.status(201).json(training);
    }
    catch (error) {
        console.error("❌ Failed to create training:", error);
        res.status(500).json({ error: "Failed to create training" });
    }
});
exports.createTraining = createTraining;
/**
 * Assign employees to training + auto-assign mandatory tests
 */
const assignTraining = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { trainingId, employeeIds, assignedBy } = req.body;
        const training = yield prisma_1.prisma.training.findUnique({
            where: { id: trainingId },
            include: { trainingTests: true },
        });
        if (!training)
            return res.status(404).json({ error: "Training not found" });
        const mandatoryTests = training.trainingTests.filter((t) => t.isMandatory);
        const assignments = [];
        for (const empId of employeeIds) {
            const assignment = yield prisma_1.prisma.trainingAssignment.create({
                data: {
                    trainingId,
                    employeeId: empId,
                    assignedBy,
                    status: "NotStarted",
                },
            });
            for (const test of mandatoryTests) {
                yield prisma_1.prisma.assignedTest.create({
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
            yield (0, notifications_controller_1.createNotification)(empId, `You have been assigned to the training: ${training.title}`);
            assignments.push(assignment);
        }
        res.status(201).json({
            message: "Training assigned successfully",
            assignments,
        });
    }
    catch (error) {
        console.error("❌ Failed to assign training:", error);
        res.status(500).json({ error: "Failed to assign training" });
    }
});
exports.assignTraining = assignTraining;
/**
 * Get all trainings or filter by employeeId
 */
const getTrainings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId } = req.query;
        const whereClause = {};
        // If employeeId provided → show only trainings assigned to that employee
        if (employeeId) {
            whereClause.assignedEmployees = {
                some: { employeeId: Number(employeeId) },
            };
        }
        const trainings = yield prisma_1.prisma.training.findMany({
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
    }
    catch (error) {
        console.error("❌ Failed to fetch trainings:", error);
        res.status(500).json({ error: "Failed to fetch trainings" });
    }
});
exports.getTrainings = getTrainings;
/**
 * Mark a training as completed by an employee
 */
const markTrainingCompleted = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { trainingId, employeeId } = req.body;
        const assignment = yield prisma_1.prisma.trainingAssignment.update({
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
        yield (0, notifications_controller_1.createNotification)(employeeId, `🎉 You have successfully completed the training!`);
        res.json(assignment);
    }
    catch (error) {
        console.error("❌ Failed to mark training completed:", error);
        res.status(500).json({ error: "Failed to mark training completed" });
    }
});
exports.markTrainingCompleted = markTrainingCompleted;
/* ======================================================
   FEEDBACK MODULE
   ====================================================== */
/**
 * Submit feedback after training completion
 */
const submitTrainingFeedback = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { trainingId, employeeId, rating, feedback, trainerRating, contentQuality, relevance, suggestions, } = req.body;
        const assignment = yield prisma_1.prisma.trainingAssignment.findUnique({
            where: {
                trainingId_employeeId: {
                    trainingId,
                    employeeId,
                },
            },
        });
        if (!assignment)
            return res.status(404).json({ error: "Training assignment not found" });
        const existingFeedback = yield prisma_1.prisma.trainingFeedback.findUnique({
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
        const feedbackRecord = yield prisma_1.prisma.trainingFeedback.create({
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
        yield (0, notifications_controller_1.createNotification)(assignment.assignedBy, `📋 New feedback received for training ID ${trainingId} from employee ${employeeId}`);
        res.status(201).json(feedbackRecord);
    }
    catch (error) {
        console.error("❌ Failed to submit training feedback:", error);
        res.status(500).json({ error: "Failed to submit training feedback" });
    }
});
exports.submitTrainingFeedback = submitTrainingFeedback;
/**
 * Get summarized feedback for a training
 */
const getTrainingFeedbackSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { trainingId } = req.params;
        const feedbacks = yield prisma_1.prisma.trainingFeedback.findMany({
            where: { trainingId: Number(trainingId) },
            include: { employee: true },
        });
        if (feedbacks.length === 0)
            return res.json({ message: "No feedback received yet" });
        // Helper: safely calculate average of numeric fields
        const getAverage = (field) => {
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
    }
    catch (error) {
        console.error("❌ Failed to fetch training feedback summary:", error);
        res.status(500).json({ error: "Failed to fetch feedback summary" });
    }
});
exports.getTrainingFeedbackSummary = getTrainingFeedbackSummary;
const updateTraining = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { title, description, objectives, mode, location, startDate, endDate, departmentId, trainers, trainingTests, // array of { testId, isMandatory, orderNo }
         } = req.body;
        const existing = yield prisma_1.prisma.training.findUnique({
            where: { id: Number(id) },
            include: { trainingTests: true },
        });
        if (!existing) {
            return res.status(404).json({ error: "Training not found" });
        }
        // 🧩 Step 1: Update main training fields
        const updatedTraining = yield prisma_1.prisma.training.update({
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
        yield prisma_1.prisma.trainingTest.deleteMany({
            where: { trainingId: Number(id) },
        });
        // Then recreate based on new list
        if (Array.isArray(trainingTests) && trainingTests.length > 0) {
            yield prisma_1.prisma.trainingTest.createMany({
                data: trainingTests.map((t, index) => {
                    var _a, _b;
                    return ({
                        trainingId: Number(id),
                        testId: t.testId,
                        isMandatory: (_a = t.isMandatory) !== null && _a !== void 0 ? _a : true,
                        orderNo: (_b = t.orderNo) !== null && _b !== void 0 ? _b : index + 1,
                    });
                }),
            });
        }
        // 🧩 Step 3: Return the updated training with its tests
        const result = yield prisma_1.prisma.training.findUnique({
            where: { id: Number(id) },
            include: { trainingTests: { include: { test: true } } },
        });
        res.json({ message: "Training updated successfully", training: result });
    }
    catch (error) {
        console.error("❌ Failed to update training:", error);
        res.status(500).json({ error: "Failed to update training" });
    }
});
exports.updateTraining = updateTraining;
const markTrainingAttendance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { trainingId } = req.params;
        const { employeeId, status } = req.body;
        const markedBy = req.user.userId;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // 1️⃣ Check if an attendance already exists
        const existing = yield prisma_1.prisma.trainingAttendance.findFirst({
            where: {
                trainingId: Number(trainingId),
                employeeId: Number(employeeId),
                date: today,
            }
        });
        let record;
        if (existing) {
            // 2️⃣ Update it
            record = yield prisma_1.prisma.trainingAttendance.update({
                where: { id: existing.id },
                data: {
                    status,
                    markedAt: new Date(),
                    markedBy,
                }
            });
        }
        else {
            // 3️⃣ Create new attendance
            record = yield prisma_1.prisma.trainingAttendance.create({
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
        res.json({
            message: "Attendance marked successfully",
            data: record,
        });
    }
    catch (err) {
        console.error("Error marking attendance:", err);
        res.status(500).json({ error: "Failed to mark attendance" });
    }
});
exports.markTrainingAttendance = markTrainingAttendance;
const getTrainingAttendance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { trainingId } = req.params;
        const attendance = yield prisma_1.prisma.trainingAttendance.findMany({
            where: { trainingId: Number(trainingId) },
            include: {
                employee: true,
            }
        });
        res.json(attendance);
    }
    catch (err) {
        res.status(500).json({ error: "Failed to fetch attendance" });
    }
});
exports.getTrainingAttendance = getTrainingAttendance;
const bulkMarkTrainingAttendance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { trainingId } = req.params;
        const { attendanceList } = req.body; // [{employeeId, status}, ...]
        const markedBy = req.user.userId;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (const entry of attendanceList) {
            yield prisma_1.prisma.trainingAttendance.upsert({
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
        }
        res.json({ message: "Bulk attendance updated" });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update bulk attendance" });
    }
});
exports.bulkMarkTrainingAttendance = bulkMarkTrainingAttendance;
