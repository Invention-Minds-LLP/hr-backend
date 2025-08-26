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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveManagerReview = exports.getAllAppraisalsWithManagerReview = exports.createAppraisalsForEmployees = exports.bulkCreateAppraisals = void 0;
const client_1 = require("@prisma/client");
const node_cron_1 = __importDefault(require("node-cron"));
const prisma = new client_1.PrismaClient();
const bulkCreateAppraisals = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { cycle, employeeIds } = req.body;
        if (!cycle || !employeeIds || employeeIds.length === 0) {
            return res.status(400).json({ error: 'Cycle and employeeIds required' });
        }
        const result = yield (0, exports.createAppraisalsForEmployees)(employeeIds, cycle, 'Draft');
        return res.status(201).json({ message: 'Appraisals created', count: result.count });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create appraisals' });
    }
});
exports.bulkCreateAppraisals = bulkCreateAppraisals;
const generateUniqueAppraisalId = (employeeId) => {
    const date = new Date();
    return `${date.getFullYear()}${(date.getMonth() + 1)
        .toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}-${employeeId}`;
};
// Create appraisals for given employees
const createAppraisalsForEmployees = (employeeIds_1, cycle_1, ...args_1) => __awaiter(void 0, [employeeIds_1, cycle_1, ...args_1], void 0, function* (employeeIds, cycle, status = 'Draft') {
    const employees = yield prisma.employee.findMany({
        where: {
            id: { in: employeeIds },
            employmentStatus: 'ACTIVE'
        },
        select: { id: true, reportingManager: true }
    });
    const data = employees.map(emp => ({
        employeeId: emp.id,
        managerId: emp.reportingManager, // store reporting manager
        cycle,
        status,
        finalDecision: null,
        finalComments: null
    }));
    return prisma.appraisalForm.createMany({ data });
});
exports.createAppraisalsForEmployees = createAppraisalsForEmployees;
node_cron_1.default.schedule('0 0 1 */3 *', () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Running quarterly appraisal creation job...');
    const activeEmployees = yield prisma.employee.findMany({
        where: { employmentStatus: 'ACTIVE' },
        select: { id: true }
    });
    if (!activeEmployees.length)
        return;
    const ids = activeEmployees.map(e => e.id);
    const cycle = `Quarter ${Math.floor((new Date().getMonth() / 3) + 1)} ${new Date().getFullYear()}`;
    yield (0, exports.createAppraisalsForEmployees)(ids, cycle, 'Draft');
    console.log(`Appraisals created for ${ids.length} active employees`);
}));
const getAllAppraisalsWithManagerReview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const appraisals = yield prisma.appraisalForm.findMany({
            include: {
                employee: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        employeeCode: true,
                        designation: true,
                        departmentId: true,
                        email: true,
                        dateOfJoining: true,
                    }
                },
                managerReview: true // include ONLY ManagerAppraisal
            },
            orderBy: { createdAt: "desc" }
        });
        const managerIds = appraisals
            .map((a) => a.managerId)
            .filter((id) => !!id);
        const managers = yield prisma.employee.findMany({
            where: { id: { in: managerIds } },
            select: { id: true, firstName: true, lastName: true },
        });
        const managerMap = new Map(managers.map((m) => [m.id, `${m.firstName} ${m.lastName}`]));
        const formatted = appraisals.map((appraisal) => (Object.assign(Object.assign({}, appraisal), { managerName: appraisal.managerId
                ? managerMap.get(appraisal.managerId) || null
                : null })));
        res.json(formatted);
    }
    catch (error) {
        console.error("Error fetching appraisals:", error);
        res.status(500).json({ error: "Failed to fetch appraisals" });
    }
});
exports.getAllAppraisalsWithManagerReview = getAllAppraisalsWithManagerReview;
const saveManagerReview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { appraisalId, communication, teamwork, problemSolving, initiative, reliability, comments, recommendations, overallScore, finalDecision, finalComments } = req.body;
        const review = yield prisma.managerAppraisal.upsert({
            where: { appraisalFormId: appraisalId },
            update: {
                communication,
                teamwork,
                problemSolving,
                initiative,
                reliability,
                comments,
                recommendations,
                overallScore
            },
            create: {
                appraisalFormId: appraisalId,
                communication,
                teamwork,
                problemSolving,
                initiative,
                reliability,
                comments,
                recommendations,
                overallScore
            }
        });
        // Update final decision in AppraisalForm
        yield prisma.appraisalForm.update({
            where: { id: appraisalId },
            data: {
                finalDecision,
                finalComments,
                overallScore,
                status: 'Reviewed'
            }
        });
        res.json({ message: 'Manager review saved successfully', review });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to save manager review' });
    }
});
exports.saveManagerReview = saveManagerReview;
