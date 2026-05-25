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
exports.updateTrainingStatus = exports.getAssignableEmployees = exports.bulkMarkTrainingAttendance = exports.getTrainingAttendance = exports.markTrainingAttendance = exports.updateTraining = exports.getTrainingFeedbackSummary = exports.submitTrainingFeedback = exports.markTrainingCompleted = exports.getTrainings = exports.assignTraining = exports.createTraining = void 0;
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const notifications_controller_1 = require("../notifications/notifications.controller");
const NURSING_DEPT_NAME = 'Nursing';
// Accept the two common spellings — confirm with HR which one your DB uses.
const NURSING_EDUCATOR_DESIGNATIONS = ['nurse educator', 'nursing educator'];
/**
 * Resolves what the logged-in user is allowed to do in the training module.
 *  - HR Manager (roleId 1)                                     → manage everyone
 *  - Reporting Manager (roleId 3)                              → only their direct reports
 *  - Incharge (roleId 5) of the Nursing department             → all Nursing dept employees
 *  - Executive whose designation is "Nursing Educator"         → all Nursing dept employees
 *  - Anyone else                                               → not allowed
 */
function getTrainingScope(req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const user = req.user;
        if (!user)
            return { allowed: false, reason: 'Unauthorized' };
        const roleId = Number(user.roleId);
        const empId = Number(user.empId);
        const deptId = Number(user.deptId);
        // 1. HR Manager — full scope
        if (roleId === 1)
            return { allowed: true, mode: 'ALL' };
        // 2. Reporting Manager — only their reports
        if (roleId === 3)
            return { allowed: true, mode: 'OWN_REPORTS', managerEmpId: empId };
        // 3. Look up Nursing dept once (required for the next two checks)
        const nursingDept = yield prisma_1.prisma.department.findFirst({
            where: { name: NURSING_DEPT_NAME },
            select: { id: true },
        });
        // 4. Nursing Incharge
        if (nursingDept && roleId === 5 && deptId === nursingDept.id) {
            return { allowed: true, mode: 'DEPT', departmentId: nursingDept.id };
        }
        // 5. Nursing Educator (designation-based) — fetch the employee's designation since it isn't in JWT
        if (nursingDept && empId) {
            const me = yield prisma_1.prisma.employee.findUnique({
                where: { id: empId },
                select: { departmentId: true, designation: { select: { name: true } } },
            });
            const designationName = (_b = (_a = me === null || me === void 0 ? void 0 : me.designation) === null || _a === void 0 ? void 0 : _a.name) === null || _b === void 0 ? void 0 : _b.trim().toLowerCase();
            if ((me === null || me === void 0 ? void 0 : me.departmentId) === nursingDept.id &&
                designationName &&
                NURSING_EDUCATOR_DESIGNATIONS.includes(designationName)) {
                return { allowed: true, mode: 'DEPT', departmentId: nursingDept.id };
            }
        }
        return { allowed: false, reason: 'You do not have permission to manage trainings' };
    });
}
/* ======================================================
   TRAINING CRUD + ASSIGNMENT
   ====================================================== */
/**
 * Create new training with optional linked tests
 */
const createTraining = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const scope = yield getTrainingScope(req);
        if (!scope.allowed) {
            return res.status(400).json({ error: scope.reason });
        }
        // Use empId (Employee.id) so it lines up with how the rest of the module
        // identifies "who created/owns this" — both the visibility filter in
        // getTrainings and the status-change check use empId.
        const empId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
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
                createdBy: Number(empId),
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
const assignTraining = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const scope = yield getTrainingScope(req);
        if (!scope.allowed) {
            return res.status(400).json({ error: scope.reason });
        }
        const { trainingId, employeeIds, assignedBy } = req.body;
        if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
            return res.status(400).json({ error: 'employeeIds is required' });
        }
        // Validate that every requested employee falls inside the caller's scope.
        if (scope.mode === 'OWN_REPORTS') {
            const allowed = yield prisma_1.prisma.employee.findMany({
                where: { id: { in: employeeIds }, reportingManager: scope.managerEmpId },
                select: { id: true },
            });
            const allowedIds = new Set(allowed.map((e) => e.id));
            const outside = employeeIds.filter((id) => !allowedIds.has(Number(id)));
            if (outside.length) {
                return res.status(400).json({
                    error: 'Some of the selected employees are not in your team. Please review your selection.',
                    outsideScope: outside,
                });
            }
        }
        else if (scope.mode === 'DEPT') {
            const allowed = yield prisma_1.prisma.employee.findMany({
                where: { id: { in: employeeIds }, departmentId: scope.departmentId },
                select: { id: true },
            });
            const allowedIds = new Set(allowed.map((e) => e.id));
            const outside = employeeIds.filter((id) => !allowedIds.has(Number(id)));
            if (outside.length) {
                return res.status(400).json({
                    error: 'Some of the selected employees are not in the Nursing department. Please review your selection.',
                    outsideScope: outside,
                });
            }
        }
        // mode === 'ALL' (HR) → no extra check, all employees are in scope
        const training = yield prisma_1.prisma.training.findUnique({
            where: { id: trainingId },
            include: { trainingTests: true },
        });
        if (!training) {
            return res.status(404).json({ error: "Training not found" });
        }
        const mandatoryTests = training.trainingTests.filter((t) => t.isMandatory);
        const assignedEmployees = [];
        const alreadyAssignedEmployees = [];
        for (const empId of employeeIds) {
            // 🔍 Check existing assignment
            const existing = yield prisma_1.prisma.trainingAssignment.findFirst({
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
            const assignment = yield prisma_1.prisma.trainingAssignment.create({
                data: {
                    trainingId,
                    employeeId: empId,
                    assignedBy,
                    status: "NotStarted",
                },
            });
            // Assign mandatory tests
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
            assignedEmployees.push(empId);
        }
        return res.status(201).json({
            message: "Training assignment completed",
            assignedEmployees,
            alreadyAssignedEmployees,
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
    var _a, _b;
    try {
        const { employeeId } = req.query;
        const whereClause = {};
        // If employeeId provided → show only trainings assigned to that employee
        if (employeeId) {
            whereClause.assignedEmployees = {
                some: { employeeId: Number(employeeId) },
            };
        }
        else {
            // Option B visibility: HR Manager sees every training; everyone else
            // (Reporting Manager / Nursing Incharge / Nursing Educator) sees only the
            // trainings they themselves created. Note: a non-allowed user reaching
            // here will simply get an empty list since they can't have created any.
            const roleId = Number((_a = req.user) === null || _a === void 0 ? void 0 : _a.roleId);
            const empId = Number((_b = req.user) === null || _b === void 0 ? void 0 : _b.userId);
            if (roleId !== 1 && empId) {
                whereClause.createdBy = empId;
            }
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
        // await createNotification(
        //   employeeId,
        //   `🎉 You have successfully completed the training!`
        // );
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
        const emp = yield prisma_1.prisma.employee.findUnique({
            where: { id: employeeId },
            select: { firstName: true, lastName: true }
        });
        const training = yield prisma_1.prisma.training.findUnique({
            where: { id: trainingId },
            select: { title: true }
        });
        const employeeName = `${(emp === null || emp === void 0 ? void 0 : emp.firstName) || ""} ${(emp === null || emp === void 0 ? void 0 : emp.lastName) || ""}`.trim();
        yield (0, notifications_controller_1.createNotification)(assignment.assignedBy, `${employeeName} has submitted feedback for the training: ${(training === null || training === void 0 ? void 0 : training.title) || 'Training'}.`);
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
        const training = yield prisma_1.prisma.training.findUnique({
            where: { id: Number(trainingId) },
            select: { title: true }
        });
        yield (0, notifications_controller_1.createNotification)(employeeId, `Your attendance for the training "${(training === null || training === void 0 ? void 0 : training.title) || 'Training'}" has been marked as: ${status}.`);
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
            const training = yield prisma_1.prisma.training.findUnique({
                where: { id: Number(trainingId) },
                select: { title: true }
            });
            yield (0, notifications_controller_1.createNotification)(entry.employeeId, `Your attendance for the training "${(training === null || training === void 0 ? void 0 : training.title) || 'Training'}" has been marked as: ${entry.status}.`);
        }
        res.json({ message: "Bulk attendance updated" });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update bulk attendance" });
    }
});
exports.bulkMarkTrainingAttendance = bulkMarkTrainingAttendance;
/**
 * Returns the list of employees the logged-in user is allowed to assign training to.
 *  - HR Manager      → all active employees
 *  - Reporting Mgr   → only their direct reports
 *  - Nursing Incharge / Nursing Educator → all Nursing dept employees
 *  - others          → 403
 */
const getAssignableEmployees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const scope = yield getTrainingScope(req);
        if (!scope.allowed) {
            // Don't error out — just return an empty list. The UI guards prevent
            // unauthorized users from reaching this endpoint normally; if they do,
            // the assign dialog simply has no one to pick.
            return res.json([]);
        }
        const where = { employmentStatus: 'ACTIVE' };
        if (scope.mode === 'OWN_REPORTS') {
            where.reportingManager = scope.managerEmpId;
        }
        else if (scope.mode === 'DEPT') {
            where.departmentId = scope.departmentId;
        }
        // mode === 'ALL' → no extra filter
        const employees = yield prisma_1.prisma.employee.findMany({
            where,
            select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                departmentId: true,
                Department: { select: { name: true } },
                designation: { select: { name: true } },
            },
            orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        });
        res.json(employees);
    }
    catch (err) {
        console.error('Failed to fetch assignable employees:', err);
        res.status(500).json({ error: 'Failed to fetch assignable employees' });
    }
});
exports.getAssignableEmployees = getAssignableEmployees;
/**
 * Manually change a training's status.
 * Body: { status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' }
 *
 * Only HR Manager can change any training; other allowed roles (RM /
 * Nursing Incharge / Nursing Educator) can only change trainings they created.
 */
const updateTrainingStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const scope = yield getTrainingScope(req);
        if (!scope.allowed) {
            return res.status(400).json({ error: scope.reason });
        }
        const id = Number(req.params.id);
        const { status } = req.body;
        const allowed = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ error: `Status must be one of ${allowed.join(', ')}` });
        }
        const training = yield prisma_1.prisma.training.findUnique({ where: { id } });
        if (!training)
            return res.status(404).json({ error: 'Training not found' });
        const empId = Number((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId);
        console.log(scope);
        console.log(training.createdBy, empId);
        if (scope.mode !== 'ALL' && training.createdBy !== empId) {
            return res.status(400).json({
                error: 'You can only change the status of trainings you created.',
            });
        }
        const updated = yield prisma_1.prisma.training.update({
            where: { id },
            data: { status: status },
        });
        res.json(updated);
    }
    catch (err) {
        console.error('Failed to update training status:', err);
        res.status(500).json({ error: 'Failed to update training status' });
    }
});
exports.updateTrainingStatus = updateTrainingStatus;
