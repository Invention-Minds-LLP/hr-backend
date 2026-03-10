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
exports.sendAppraisalCountReminders = exports.saveManagerReview = exports.getAllAppraisalsWithManagerReview = exports.initQuarterlyAppraisalScheduler = exports.createAppraisalsForEmployees = exports.bulkCreateAppraisals = void 0;
// import { PrismaClient } from "@prisma/client";
const node_cron_1 = __importDefault(require("node-cron"));
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
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
    const employees = yield prisma_1.prisma.employee.findMany({
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
    const created = yield prisma_1.prisma.appraisalForm.createMany({ data });
    const managerIds = Array.from(new Set(employees.map(e => e.reportingManager).filter((id) => !!id)));
    const managers = yield prisma_1.prisma.employee.findMany({
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
        // try {
        //   await sendWhatsAppTemplate({
        //     to: mgrPhone,
        //     templateId: APPRAISAL_CREATED_TEMPLATE_ID,
        //     placeholders: [employeeName] // add cycle if your template expects it
        //   });
        // } catch (e) {
        //   console.error("Appraisal create WA (manager) failed:", e);
        // }
        const message = `A new appraisal has been created for ${employeeName} and assigned to you for review.\nKindly acknowledge and take appropriate action.`;
        // try {
        //   await createNotification(mgr.id, message); // ✅ send SSE + DB notification
        // } catch (e) {
        //   console.error("Appraisal in-app notification failed:", e);
        // }
    })));
    return created;
});
exports.createAppraisalsForEmployees = createAppraisalsForEmployees;
// function getEmployeeCycle(doj: Date, now: Date) {
//   const diffMonths = monthsDiff(doj, now);
//   if (diffMonths < 3) return null; // not eligible yet
//   const cycleIndex = Math.floor(diffMonths / 3) + 1; // 1,2,3,4...
//   const year = now.getFullYear();
//   return {
//     cycleIndex,
//     cycleName: `Cycle ${cycleIndex} ${year}`
//   };
// }
function getEmployeeCycle(doj, now) {
    const diffMonths = monthsDiff(doj, now);
    if (diffMonths < 3)
        return null;
    const yearIndex = Math.floor(diffMonths / 12) + 1;
    const cycleInYear = Math.floor((diffMonths % 12) / 3) + 1;
    return {
        yearIndex,
        cycleIndex: cycleInYear,
        cycleName: `Year ${yearIndex} - Cycle ${cycleInYear}`
    };
}
function monthsDiff(from, to) {
    return (to.getFullYear() * 12 + to.getMonth()
        - (from.getFullYear() * 12 + from.getMonth()));
}
// export const initQuarterlyAppraisalScheduler = () => {
//   cron.schedule("* * * * *", async () => {
//     console.log("📅 Running quarterly appraisal creation job...");
//     try {
//       const activeEmployees = await prisma.employee.findMany({
//         where: { employmentStatus: "ACTIVE" },
//         select: { id: true }
//       });
//       if (!activeEmployees.length) {
//         console.log("⚠️ No active employees. Skipping appraisal creation.");
//         return;
//       }
//       const ids = activeEmployees.map(e => e.id);
//       // Determine quarter name
//       const now = new Date();
//       const quarter = Math.floor(now.getMonth() / 3) + 1;
//       const cycle = `Quarter ${quarter} ${now.getFullYear()}`;
//       await createAppraisalsForEmployees(ids, cycle, "Draft");
//       console.log(`✅ Appraisals created for ${ids.length} employees`);
//     } catch (error) {
//       console.error("❌ Error during quarterly appraisal scheduler:", error);
//     }
//   });
// };
const initQuarterlyAppraisalScheduler = () => {
    node_cron_1.default.schedule('0 2 * * *', () => __awaiter(void 0, void 0, void 0, function* () {
        console.log('📅 [Cron] Running appraisal scheduler...');
        const now = new Date();
        try {
            const employees = yield prisma_1.prisma.employee.findMany({
                where: { employmentStatus: 'ACTIVE' },
                select: {
                    id: true,
                    dateOfJoining: true,
                    reportingManager: true,
                    firstName: true,
                    lastName: true
                }
            });
            for (const emp of employees) {
                if (!emp.dateOfJoining)
                    continue;
                const cycleInfo = getEmployeeCycle(emp.dateOfJoining, now);
                if (!cycleInfo)
                    continue;
                const { cycleIndex, cycleName } = cycleInfo;
                // ❌ Only 4 cycles per year
                // if (cycleIndex > 4) continue;
                // ❌ Skip if already exists
                const exists = yield prisma_1.prisma.appraisalForm.findFirst({
                    where: {
                        employeeId: emp.id,
                        cycle: cycleName
                    }
                });
                if (exists)
                    continue;
                // ✅ Create appraisal
                yield (0, exports.createAppraisalsForEmployees)([emp.id], cycleName, 'Draft');
                console.log(`✅ Created appraisal for ${emp.firstName} (${cycleName})`);
            }
        }
        catch (error) {
            console.error('❌ Appraisal scheduler failed:', error);
        }
    }));
};
exports.initQuarterlyAppraisalScheduler = initQuarterlyAppraisalScheduler;
const getAllAppraisalsWithManagerReview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const appraisals = yield prisma_1.prisma.appraisalForm.findMany({
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
                        gender: true,
                        photoUrl: true
                    }
                },
                managerReview: true // include ONLY ManagerAppraisal
            },
            orderBy: { createdAt: "desc" }
        });
        const managerIds = appraisals
            .map((a) => a.managerId)
            .filter((id) => !!id);
        const managers = yield prisma_1.prisma.employee.findMany({
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
    var _a;
    try {
        const { appraisalId, qualityOfWorkRating, qualityOfWorkComments, knowledgeOfJobRating, knowledgeOfJobComments, teamworkRating, teamworkComments, independenceRating, independenceComments, recordsRating, recordsComments, guestServiceRating, guestServiceComments, safetyRating, safetyComments, attendanceRating, attendanceComments, leadershipRating, leadershipComments, overallScore, comments, recommendations, finalDecision, finalComments } = req.body;
        yield prisma_1.prisma.managerAppraisal.upsert({
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
        yield prisma_1.prisma.appraisalForm.update({
            where: { id: appraisalId },
            data: {
                finalDecision,
                finalComments,
                overallScore,
                status: 'Reviewed'
            }
        });
        // 3️⃣ Fetch employee + manager details
        const appraisal = yield prisma_1.prisma.appraisalForm.findUnique({
            where: { id: appraisalId },
            include: {
                employee: {
                    select: {
                        firstName: true,
                        lastName: true,
                        employeeCode: true,
                        reportingManager: true
                    }
                }
            }
        });
        if ((_a = appraisal === null || appraisal === void 0 ? void 0 : appraisal.employee) === null || _a === void 0 ? void 0 : _a.reportingManager) {
            const manager = yield prisma_1.prisma.employee.findUnique({
                where: { id: appraisal.employee.reportingManager },
                select: { firstName: true, lastName: true }
            });
            const empName = `${appraisal.employee.firstName} ${appraisal.employee.lastName}`;
            const empCode = appraisal.employee.employeeCode;
            const managerName = manager
                ? `${manager.firstName} ${manager.lastName}`
                : 'Manager';
            const message = `${managerName} submitted appraisal for ${empName} (${empCode}).`;
            // 4️⃣ Send notification to all HRs
            const hrEmployees = yield prisma_1.prisma.employee.findMany({
                where: { departmentId: 1 },
                select: { id: true },
            });
            // for (const hr of hrEmployees) {
            //   await createNotification(hr.id, message);
            // }
        }
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
    const forms = yield prisma_1.prisma.appraisalForm.findMany({
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
    const managers = yield prisma_1.prisma.employee.findMany({
        where: { id: { in: Array.from(managerIds) } },
        select: { id: true, phone: true }
    });
    const phoneById = new Map(managers.map(m => [m.id, formatPhoneNumber(m.phone || "")]));
    // 4) Send one WA per manager-cycle
    let sent = 0;
    yield Promise.all(Array.from(buckets.values()).map((b) => __awaiter(void 0, void 0, void 0, function* () {
        const phone = phoneById.get(b.managerId);
        const message = `You have ${b.count} pending appraisal(s) for the ${b.cycle} cycle. Please review them.`;
        console.log("Appraisal reminder:", message, managerIds);
        yield (0, notifications_controller_1.createNotification)(b.managerId, message);
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
