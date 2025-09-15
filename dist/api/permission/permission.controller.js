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
const PERMISSION_APPLY_TEMPLATE_ID = '';
const PERMISSION_STATUS_TEMPLATE_ID = '';
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
const updatePermissionStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status, userId, declineReason } = req.body;
        if (!['APPROVED', 'Declined'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status value' });
        }
        const data = {
            status: status === 'APPROVED' ? client_1.PermissionStatus.APPROVED : client_1.PermissionStatus.REJECTED,
            approvedBy: null,
            declinedBy: null,
            declineReason: null,
            approvedDate: null,
            declinedDate: null
        };
        if (data.status === 'APPROVED') {
            data.approvedBy = userId;
            data.approvedDate = new Date();
        }
        else if (data.status === 'REJECTED') {
            data.declinedBy = userId;
            data.declinedDate = new Date();
            data.declineReason = declineReason;
        }
        const updated = yield prisma.permissionRequest.update({
            where: { id: Number(id) },
            data,
            include: { employee: true }
        });
        // ---------- WhatsApp to employee ----------
        const emp = updated.employee;
        const employeePhone = formatPhoneNumber((emp === null || emp === void 0 ? void 0 : emp.phone) || "");
        const employeeName = [emp === null || emp === void 0 ? void 0 : emp.firstName, emp === null || emp === void 0 ? void 0 : emp.lastName].filter(Boolean).join(" ");
        const dateLabel = fmtDate(updated.day); // e.g. 15-08-2025 if your fmtDate is en-GB
        // For FULLDAY we can send "-" for times; for HOURLY/HALFDAY send actual times.
        const fromTime = updated.timing === "HOURLY" || updated.timing === "HALFDAY"
            ? fmtTime(updated.startTime)
            : "-";
        const toTime = updated.timing === "HOURLY" || updated.timing === "HALFDAY"
            ? fmtTime(updated.endTime)
            : "-";
        const statusLabel = data.status === client_1.PermissionStatus.APPROVED ? "Approved" : "Declined";
        let notification = {
            status: "skipped",
        };
        // if (employeePhone) {
        //   try {
        //     await sendWhatsAppTemplate({
        //       to: employeePhone,
        //       templateId: PERMISSION_STATUS_TEMPLATE_ID,
        //       placeholders: [employeeName, dateLabel, fromTime || "-", toTime || "-", statusLabel],
        //     });
        //     notification.status = "sent";
        //   } catch (e: any) {
        //     console.error("Permission status WA send failed:", e);
        //     notification.status = "failed";
        //     notification.error = e?.message || "WhatsApp send failed";
        //   }
        // }
        res.json(updated);
    }
    catch (error) {
        console.error("Error updating permission status:", error);
        res.status(500).json({ error: "Failed to update permission status" });
    }
});
exports.updatePermissionStatus = updatePermissionStatus;
