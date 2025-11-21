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
exports.sendAppraisalCountReminders = exports.saveManagerReview = exports.getAllAppraisalsWithManagerReview = exports.createAppraisalsForEmployees = exports.bulkCreateAppraisals = void 0;
const client_1 = require("@prisma/client");
const node_cron_1 = __importDefault(require("node-cron"));
const prisma = new client_1.PrismaClient();
const leave_controller_1 = require("../leave/leave.controller");
const notifications_controller_1 = require("../notifications/notifications.controller");
const APPRAISAL_REMINDER_COUNT_TEMPLATE_ID = '';
const APPRAISAL_CREATED_TEMPLATE_ID = "888277";
function formatPhoneNumber(raw) {
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.startsWith("91"))
        return `+${digits}`;
    if (digits.startsWith("0"))
        return `+91${digits.slice(1)}`;
    if (digits.length === 10)
        return `+91${digits}`;
    if (digits.startsWith("+"))
        return digits;
    return `+${digits}`;
}
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
        select: { id: true, reportingManager: true, firstName: true, lastName: true }
    });
    const data = employees.map(emp => ({
        employeeId: emp.id,
        managerId: emp.reportingManager, // store reporting manager
        cycle,
        status,
        finalDecision: null,
        finalComments: null
    }));
    const created = yield prisma.appraisalForm.createMany({ data });
    const managerIds = Array.from(new Set(employees.map(e => e.reportingManager).filter((id) => !!id)));
    const managers = yield prisma.employee.findMany({
        where: { id: { in: managerIds } },
        select: { id: true, phone: true, firstName: true, lastName: true }
    });
    const mgrById = new Map(managers.map(m => [m.id, m]));
    // Fire-and-forget WhatsApp notifications; don't block/throw the API
    yield Promise.all(employees.map((emp) => __awaiter(void 0, void 0, void 0, function* () {
        const mgr = emp.reportingManager ? mgrById.get(emp.reportingManager) : undefined;
        if (!mgr)
            return;
        const mgrPhone = formatPhoneNumber((mgr === null || mgr === void 0 ? void 0 : mgr.phone) || "");
        if (!mgrPhone)
            return;
        const employeeName = [emp.firstName, emp.lastName].filter(Boolean).join(" ");
        try {
            yield (0, leave_controller_1.sendWhatsAppTemplate)({
                to: mgrPhone,
                templateId: APPRAISAL_CREATED_TEMPLATE_ID,
                placeholders: [employeeName] // add cycle if your template expects it
            });
        }
        catch (e) {
            console.error("Appraisal create WA (manager) failed:", e);
        }
        const message = `A new appraisal has been created for ${employeeName} and assigned to you for review.\nKindly acknowledge and take appropriate action.`;
        try {
            yield (0, notifications_controller_1.createNotification)(mgr.id, message); // ✅ send SSE + DB notification
        }
        catch (e) {
            console.error("Appraisal in-app notification failed:", e);
        }
    })));
    return created;
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
                        reportingManager: true,
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
        const { appraisalId, qualityOfWorkRating, qualityOfWorkComments, knowledgeOfJobRating, knowledgeOfJobComments, teamworkRating, teamworkComments, independenceRating, independenceComments, recordsRating, recordsComments, guestServiceRating, guestServiceComments, safetyRating, safetyComments, attendanceRating, attendanceComments, leadershipRating, leadershipComments, overallScore, comments, recommendations, finalDecision, finalComments } = req.body;
        yield prisma.managerAppraisal.upsert({
            where: { appraisalFormId: appraisalId },
            update: {
                qualityOfWorkRating, qualityOfWorkComments,
                knowledgeOfJobRating, knowledgeOfJobComments,
                teamworkRating, teamworkComments,
                independenceRating, independenceComments,
                recordsRating, recordsComments,
                guestServiceRating, guestServiceComments,
                safetyRating, safetyComments,
                attendanceRating, attendanceComments,
                leadershipRating, leadershipComments,
                overallScore, comments, recommendations
            },
            create: {
                appraisalFormId: appraisalId,
                qualityOfWorkRating, qualityOfWorkComments,
                knowledgeOfJobRating, knowledgeOfJobComments,
                teamworkRating, teamworkComments,
                independenceRating, independenceComments,
                recordsRating, recordsComments,
                guestServiceRating, guestServiceComments,
                safetyRating, safetyComments,
                attendanceRating, attendanceComments,
                leadershipRating, leadershipComments,
                overallScore, comments, recommendations
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
        res.json({ message: 'Manager review saved successfully' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to save manager review' });
    }
});
exports.saveManagerReview = saveManagerReview;
const sendAppraisalCountReminders = (cycles) => __awaiter(void 0, void 0, void 0, function* () {
    // 1) Get pending forms with managerId + cycle
    const forms = yield prisma.appraisalForm.findMany({
        where: Object.assign(Object.assign({ managerId: { not: null } }, (cycles ? { cycle: { in: cycles } } : {})), { status: { in: ["Draft", "InReview", "PendingManager"] } // adjust to your statuses
         }),
        select: { managerId: true, cycle: true }
    });
    const buckets = new Map();
    const managerIds = new Set();
    for (const f of forms) {
        if (!f.managerId)
            continue;
        const key = `${f.managerId}::${f.cycle}`;
        const b = buckets.get(key);
        if (b)
            b.count += 1;
        else {
            buckets.set(key, { managerId: f.managerId, cycle: f.cycle, count: 1 });
            managerIds.add(f.managerId);
        }
    }
    if (managerIds.size === 0)
        return { messagesSent: 0, managerCyclesCovered: 0 };
    // 3) Fetch manager phones from Employee
    const managers = yield prisma.employee.findMany({
        where: { id: { in: Array.from(managerIds) } },
        select: { id: true, phone: true }
    });
    const phoneById = new Map(managers.map(m => [m.id, formatPhoneNumber(m.phone || "")]));
    // 4) Send one WA per manager-cycle
    let sent = 0;
    yield Promise.all(Array.from(buckets.values()).map((b) => __awaiter(void 0, void 0, void 0, function* () {
        const phone = phoneById.get(b.managerId);
        if (!phone)
            return;
        try {
            yield (0, leave_controller_1.sendWhatsAppTemplate)({
                to: phone,
                templateId: APPRAISAL_REMINDER_COUNT_TEMPLATE_ID,
                placeholders: [String(b.count), b.cycle] // {{1}}=count, {{2}}=cycle
            });
            sent++;
        }
        catch (e) {
            console.error("Appraisal count reminder WA failed:", e);
        }
    })));
    return { messagesSent: sent, managerCyclesCovered: buckets.size };
});
exports.sendAppraisalCountReminders = sendAppraisalCountReminders;
