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
exports.updatePermissionStatus = exports.getPermissionRequests = exports.createPermissionRequest = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const leave_controller_1 = require("../leave/leave.controller");
const notifications_controller_1 = require("../notifications/notifications.controller");
const PERMISSION_APPLY_TEMPLATE_ID = '888273';
const PERMISSION_STATUS_TEMPLATE_ID = '909821';
const TZ = "Asia/Kolkata";
const fmtDate = (d) => new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(d));
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
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
const createPermissionRequest = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { employeeId, permissionType, timing, day, startTime, endTime, reason } = req.body;
        if (!employeeId || !permissionType || !timing || !day || !reason) {
            return res.status(400).json({ error: "All fields are required" });
        }
        const request = yield prisma.permissionRequest.create({
            data: {
                employeeId,
                permissionType,
                timing,
                day: new Date(day),
                startTime: startTime ? new Date(startTime) : undefined,
                endTime: endTime ? new Date(endTime) : undefined,
                reason
            },
            include: { employee: true }
        });
        const employeeName = [request.employee.firstName, request.employee.lastName]
            .filter(Boolean)
            .join(" ");
        const dayLabel = fmtDate(request.day);
        let timeRange = "";
        let startLabel = '';
        let endLabel = '';
        if (timing === "HOURLY" || timing === "HALFDAY") {
            startLabel = request.startTime ? fmtTime(request.startTime) : "";
            endLabel = request.endTime ? fmtTime(request.endTime) : "";
            timeRange = startLabel && endLabel ? `${startLabel} - ${endLabel}` : "";
        }
        // Try to send to the manager
        let notifyStatus = "skipped";
        let notifyError;
        let mgrPhone;
        const mgrId = (_a = request === null || request === void 0 ? void 0 : request.employee) === null || _a === void 0 ? void 0 : _a.reportingManager;
        if (mgrId) {
            const manager = yield prisma.employee.findUnique({
                where: { id: mgrId },
                select: { phone: true }
            });
            mgrPhone = (_b = manager === null || manager === void 0 ? void 0 : manager.phone) !== null && _b !== void 0 ? _b : undefined;
            const message = `Dear Concern,\n${employeeName} has requested ${permissionType} permission on ${dayLabel} from ${startLabel} to ${endLabel}.\nKindly review and take appropriate action.\n\nRegards,\nTeam Rashtrotthana`;
            yield (0, notifications_controller_1.createNotification)(mgrId, message);
        }
        if (mgrPhone) {
            try {
                yield (0, leave_controller_1.sendWhatsAppTemplate)({
                    to: formatPhoneNumber(mgrPhone),
                    templateId: PERMISSION_APPLY_TEMPLATE_ID, // define in constants
                    placeholders: [
                        employeeName,
                        permissionType,
                        timing,
                        dayLabel,
                        startLabel,
                        endLabel
                    ]
                });
                notifyStatus = "sent";
            }
            catch (e) {
                notifyStatus = "failed";
                notifyError = (e === null || e === void 0 ? void 0 : e.message) || "WhatsApp send failed";
                console.error("Permission notify (manager) failed:", e);
            }
        }
        res.status(201).json(request);
    }
    catch (error) {
        console.error("Error creating permission request:", error);
        res.status(500).json({ error: "Failed to create permission request" });
    }
});
exports.createPermissionRequest = createPermissionRequest;
const getPermissionRequests = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const requests = yield prisma.permissionRequest.findMany({
            where: {
                status: "PENDING" // only approved leave requests
            },
            include: { employee: true },
            orderBy: { createdAt: "desc" }
        });
        res.json(requests);
    }
    catch (error) {
        console.error("Error fetching permission requests:", error);
        res.status(500).json({ error: "Failed to fetch permission requests" });
    }
});
exports.getPermissionRequests = getPermissionRequests;
// export const updatePermissionStatus = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const { status, userId, declineReason } = req.body;
//     if (!['APPROVED', 'Declined'].includes(status)) {
//       return res.status(400).json({ error: 'Invalid status value' });
//     }
//     const data: any = {
//       status: status === 'APPROVED' ? PermissionStatus.APPROVED : PermissionStatus.REJECTED,
//       approvedBy: null,
//       declinedBy: null,
//       declineReason: null,
//       approvedDate: null,
//       declinedDate: null
//     };
//     if (data.status === 'APPROVED') {
//       data.approvedBy = userId;
//       data.approvedDate = new Date();
//     } else if (data.status === 'REJECTED') {
//       data.declinedBy = userId;
//       data.declinedDate = new Date();
//       data.declineReason = declineReason;
//     }
//     const updated = await prisma.permissionRequest.update({
//       where: { id: Number(id) },
//       data,
//       include: { employee: true }
//     });
//     // ---------- WhatsApp to employee ----------
//     const emp = updated.employee;
//     const employeePhone = formatPhoneNumber(emp?.phone || "");
//     const employeeName = [emp?.firstName, emp?.lastName].filter(Boolean).join(" ");
//     const dateLabel = fmtDate(updated.day); // e.g. 15-08-2025 if your fmtDate is en-GB
//     // For FULLDAY we can send "-" for times; for HOURLY/HALFDAY send actual times.
//     const fromTime =
//       updated.timing === "HOURLY" || updated.timing === "HALFDAY"
//         ? fmtTime(updated.startTime)
//         : "-";
//     const toTime =
//       updated.timing === "HOURLY" || updated.timing === "HALFDAY"
//         ? fmtTime(updated.endTime)
//         : "-";
//     const statusLabel = data.status === PermissionStatus.APPROVED ? "Approved" : "Declined";
//     let notification: { status: "sent" | "skipped" | "failed"; error?: string } = {
//       status: "skipped",
//     };
//     // if (employeePhone) {
//     //   try {
//     //     await sendWhatsAppTemplate({
//     //       to: employeePhone,
//     //       templateId: PERMISSION_STATUS_TEMPLATE_ID,
//     //       placeholders: [employeeName, dateLabel, fromTime || "-", toTime || "-", statusLabel],
//     //     });
//     //     notification.status = "sent";
//     //   } catch (e: any) {
//     //     console.error("Permission status WA send failed:", e);
//     //     notification.status = "failed";
//     //     notification.error = e?.message || "WhatsApp send failed";
//     //   }
//     // }
//     res.json(updated);
//   } catch (error) {
//     console.error("Error updating permission status:", error);
//     res.status(500).json({ error: "Failed to update permission status" });
//   }
// };
const updatePermissionStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { id } = req.params;
        const { status, userId, role, declineReason } = req.body; // role = MANAGER | HR
        if (!["APPROVED", "REJECTED"].includes(status)) {
            return res.status(400).json({ error: "Invalid status value" });
        }
        if (!["MANAGER", "HR"].includes(role)) {
            return res.status(400).json({ error: "Invalid role" });
        }
        const perm = yield prisma.permissionRequest.findUnique({ where: { id: Number(id) } });
        if (!perm)
            return res.status(404).json({ error: "Permission request not found" });
        const data = {};
        // --- Manager decision ---
        if (role === "MANAGER") {
            if (perm.hodDecision !== "PENDING") {
                return res.status(400).json({ error: "Manager already decided" });
            }
            data.hodDecision = status;
            data.hodDecidedAt = new Date();
            if (status === "REJECTED") {
                data.status = "REJECTED";
                data.declinedBy = userId;
                data.declinedDate = new Date();
                data.declineReason = declineReason !== null && declineReason !== void 0 ? declineReason : null;
            }
            else {
                // manager approved → wait for HR
                data.status = "PENDING";
            }
        }
        // --- HR decision ---
        if (role === "HR") {
            if (perm.hodDecision !== "APPROVED") {
                return res.status(400).json({ error: "Manager approval required first" });
            }
            if (perm.hrDecision !== "PENDING") {
                return res.status(400).json({ error: "HR already decided" });
            }
            data.hrDecision = status;
            data.hrDecidedAt = new Date();
            if (status === "APPROVED") {
                data.status = "APPROVED";
                data.approvedBy = userId;
                data.approvedDate = new Date();
            }
            else {
                data.status = "REJECTED";
                data.declinedBy = userId;
                data.declinedDate = new Date();
                data.declineReason = declineReason !== null && declineReason !== void 0 ? declineReason : null;
            }
        }
        const updated = yield prisma.permissionRequest.update({
            where: { id: Number(id) },
            data,
            include: { employee: true },
        });
        try {
            const employee = updated.employee;
            const employeePhone = formatPhoneNumber((employee === null || employee === void 0 ? void 0 : employee.phone) || "");
            const employeeName = [employee === null || employee === void 0 ? void 0 : employee.firstName, employee === null || employee === void 0 ? void 0 : employee.lastName].filter(Boolean).join(" ");
            const type = (_a = updated.permissionType) !== null && _a !== void 0 ? _a : '';
            const timing = (_b = updated.timing) !== null && _b !== void 0 ? _b : '';
            const day = fmtDate(updated.day);
            const start = updated.startTime ? fmtTime(updated.startTime) : "";
            const end = updated.endTime ? fmtTime(updated.endTime) : "";
            // Send only if final decision reached (HR approved/rejected OR HOD rejected)
            if (updated.status === "APPROVED" ||
                (updated.status === "REJECTED" && (role === "HR" || role === "MANAGER"))) {
                yield (0, leave_controller_1.sendWhatsAppTemplate)({
                    to: employeePhone,
                    templateId: PERMISSION_STATUS_TEMPLATE_ID,
                    placeholders: [
                        employeeName,
                        type,
                        day,
                        start,
                        end,
                        updated.status // "APPROVED" / "REJECTED"
                    ],
                });
                const message = `Hello ${employeeName},\n\nYour ${type} permission request on ${day}, from ${start} to ${end}, has been ${updated.status}.\n\nPlease contact the concerned person for more details.\n\nThank you.`;
                yield (0, notifications_controller_1.createNotification)(updated.employeeId, message);
            }
        }
        catch (e) {
            console.error("Permission status WA send failed:", (e === null || e === void 0 ? void 0 : e.message) || e);
        }
        res.json(updated);
    }
    catch (error) {
        console.error("Error updating permission status:", error);
        res.status(500).json({ error: "Failed to update permission status" });
    }
});
exports.updatePermissionStatus = updatePermissionStatus;
