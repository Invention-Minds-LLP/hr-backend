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
exports.getManagerTeamSessions = exports.updateSessionName = exports.getSessionPhotos = exports.uploadSessionPhotos = exports.endLocationSession = exports.startLocationSession = exports.getMySessions = exports.createLocationSession = exports.getSessionPoints = exports.getEmployeeSessions = exports.addLocationPoint = exports.updateGeoConsent = exports.getGeoTrackingStatus = void 0;
exports.calculateDistance = calculateDistance;
const prisma_1 = require("../../lib/prisma");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const formidable_1 = __importDefault(require("formidable"));
const basic_ftp_1 = require("basic-ftp");
const config_1 = require("../../config");
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // meters
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
/**
 * Get tracking status
 */
const getGeoTrackingStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const empId = req.user.empId;
    const employee = yield prisma_1.prisma.employee.findUnique({
        where: { id: empId },
        select: {
            geoTrackingEnabled: true,
            geoTrackingConsent: true
        }
    });
    res.json(employee);
});
exports.getGeoTrackingStatus = getGeoTrackingStatus;
/**
 * Update consent
 */
const updateGeoConsent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const empId = req.user.empId;
    const { consent } = req.body;
    yield prisma_1.prisma.employee.update({
        where: { id: empId },
        data: {
            geoTrackingConsent: consent,
            geoTrackingConsentAt: consent ? new Date() : null
        }
    });
    res.json({ message: "Consent updated" });
});
exports.updateGeoConsent = updateGeoConsent;
/**
 * Add location point
 */
const addLocationPoint = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { sessionId, latitude, longitude, accuracy, speed } = req.body;
    const session = yield prisma_1.prisma.locationSession.findUnique({
        where: { id: sessionId }
    });
    if (!session || session.status !== "ACTIVE") {
        return res.status(400).json({ message: "Invalid session" });
    }
    const lastPoint = yield prisma_1.prisma.locationPoint.findFirst({
        where: { sessionId },
        orderBy: { recordedAt: "desc" }
    });
    let distance = 0;
    if (lastPoint) {
        distance = calculateDistance(lastPoint.latitude, lastPoint.longitude, latitude, longitude);
        const timeDiff = Date.now() - new Date(lastPoint.recordedAt).getTime();
        // skip noisy point
        if (timeDiff < 300000) {
            return res.json({ skipped: true });
        }
    }
    yield prisma_1.prisma.locationPoint.create({
        data: {
            sessionId,
            latitude,
            longitude,
            accuracy,
            speed
        }
    });
    yield prisma_1.prisma.locationSession.update({
        where: { id: sessionId },
        data: {
            totalDistance: {
                increment: distance
            },
            totalPoints: {
                increment: 1
            }
        }
    });
    res.json({ success: true });
});
exports.addLocationPoint = addLocationPoint;
const getEmployeeSessions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const employeeId = Number(req.params.employeeId);
    const date = new Date(req.query.date);
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    const sessions = yield prisma_1.prisma.locationSession.findMany({
        where: {
            employeeId,
            startedAt: {
                gte: start,
                lte: end
            }
        },
        orderBy: { startedAt: "asc" }
    });
    res.json(sessions);
});
exports.getEmployeeSessions = getEmployeeSessions;
const getSessionPoints = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const sessionId = Number(req.params.sessionId);
    const points = yield prisma_1.prisma.locationPoint.findMany({
        where: { sessionId },
        orderBy: { recordedAt: "asc" }
    });
    res.json(points);
});
exports.getSessionPoints = getSessionPoints;
const createLocationSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(req.user);
    const empId = req.user.empId;
    const { name } = req.body;
    const session = yield prisma_1.prisma.locationSession.create({
        data: {
            employeeId: empId,
            name,
            status: "CREATED"
        }
    });
    res.json(session);
});
exports.createLocationSession = createLocationSession;
const getMySessions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const empId = req.user.empId;
    const sessions = yield prisma_1.prisma.locationSession.findMany({
        where: { employeeId: empId },
        orderBy: { createdAt: "desc" },
        include: {
            _count: {
                select: {
                    photos: true
                }
            }
        }
    });
    res.json(sessions);
});
exports.getMySessions = getMySessions;
const startLocationSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const empId = req.user.empId;
    const { sessionId } = req.body;
    const session = yield prisma_1.prisma.locationSession.findFirst({
        where: {
            id: sessionId,
            employeeId: empId
        }
    });
    if (!session) {
        return res.status(404).json({ message: "Session not found" });
    }
    if (session.status === "ACTIVE") {
        return res.json({ sessionId: session.id });
    }
    const updated = yield prisma_1.prisma.locationSession.update({
        where: { id: sessionId },
        data: {
            status: "ACTIVE",
            startedAt: new Date()
        }
    });
    res.json({ sessionId: updated.id });
});
exports.startLocationSession = startLocationSession;
const endLocationSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const empId = req.user.empId;
    const { sessionId } = req.body;
    const session = yield prisma_1.prisma.locationSession.findFirst({
        where: {
            id: sessionId,
            employeeId: empId
        }
    });
    if (!session) {
        return res.status(404).json({ message: "Session not found" });
    }
    yield prisma_1.prisma.locationSession.update({
        where: { id: sessionId },
        data: {
            status: "COMPLETED",
            endedAt: new Date()
        }
    });
    res.json({ message: "Session ended" });
});
exports.endLocationSession = endLocationSession;
const FTP_CONFIG = {
    host: config_1.config.ftp.host,
    user: config_1.config.ftp.user,
    password: config_1.config.ftp.pass,
    secure: config_1.config.ftp.secure,
};
function uploadToFTP(localFilePath, remotePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = false;
        try {
            yield client.access(FTP_CONFIG);
            yield client.ensureDir("/public_html/session-photos");
            yield client.uploadFrom(localFilePath, remotePath);
        }
        finally {
            yield client.close();
        }
    });
}
const uploadSessionPhotos = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const empId = req.user.empId;
    const sessionId = Number(req.params.sessionId);
    // Ensure session belongs to employee
    const session = yield prisma_1.prisma.locationSession.findFirst({
        where: { id: sessionId, employeeId: empId },
        select: { id: true, status: true }
    });
    if (!session)
        return res.status(404).json({ message: "Session not found" });
    const form = (0, formidable_1.default)({
        multiples: true,
        keepExtensions: true,
        maxFileSize: 15 * 1024 * 1024, // 15MB each
        filter: (part) => {
            var _a, _b;
            // accept only images
            return (_b = (_a = part.mimetype) === null || _a === void 0 ? void 0 : _a.startsWith("image/")) !== null && _b !== void 0 ? _b : false;
        },
    });
    form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        if (err)
            return res.status(400).json({ message: "Upload failed", error: String(err) });
        const fileField = ((_a = files.photos) !== null && _a !== void 0 ? _a : files.photo);
        if (!fileField)
            return res.status(400).json({ message: "No photos uploaded (field: photos)" });
        const photoFiles = Array.isArray(fileField) ? fileField : [fileField];
        const created = [];
        const latitude = fields.latitude
            ? Number(Array.isArray(fields.latitude) ? fields.latitude[0] : fields.latitude)
            : null;
        const longitude = fields.longitude
            ? Number(Array.isArray(fields.longitude) ? fields.longitude[0] : fields.longitude)
            : null;
        for (const f of photoFiles) {
            const localPath = f.filepath;
            const ext = path_1.default.extname(f.originalFilename || "").toLowerCase() || ".jpg";
            const safeName = `${sessionId}_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
            const remotePath = `/public_html/session-photos/${safeName}`;
            const publicUrl = `https://hrproindia.in/session-photos/${safeName}`;
            try {
                yield uploadToFTP(localPath, remotePath);
                const row = yield prisma_1.prisma.locationSessionPhoto.create({
                    data: {
                        sessionId,
                        url: publicUrl,
                        fileName: safeName,
                        capturedBy: empId,
                        capturedAt: new Date(),
                        longitude,
                        latitude
                    },
                    select: { id: true, url: true }
                });
                created.push(row);
            }
            finally {
                // cleanup temp file
                try {
                    fs_1.default.unlinkSync(localPath);
                }
                catch (_b) { }
            }
        }
        return res.json({ success: true, photos: created });
    }));
});
exports.uploadSessionPhotos = uploadSessionPhotos;
const getSessionPhotos = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const empId = req.user.empId;
    const sessionId = Number(req.params.sessionId);
    const session = yield prisma_1.prisma.locationSession.findFirst({
        where: { id: sessionId, employeeId: empId },
        select: { id: true }
    });
    if (!session)
        return res.status(404).json({ message: "Session not found" });
    const photos = yield prisma_1.prisma.locationSessionPhoto.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        select: { id: true, url: true, createdAt: true }
    });
    res.json(photos);
});
exports.getSessionPhotos = getSessionPhotos;
const updateSessionName = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const empId = req.user.empId;
    const { sessionId, name } = req.body;
    const session = yield prisma_1.prisma.locationSession.findFirst({
        where: {
            id: sessionId,
            employeeId: empId
        }
    });
    if (!session) {
        return res.status(404).json({ message: "Session not found" });
    }
    // allow edit only within 1 day
    const oneDay = 24 * 60 * 60 * 1000;
    const createdTime = new Date(session.createdAt).getTime();
    if (Date.now() - createdTime > oneDay) {
        return res.status(400).json({
            message: "Session name can only be edited within 1 day"
        });
    }
    const updated = yield prisma_1.prisma.locationSession.update({
        where: { id: sessionId },
        data: { name }
    });
    res.json(updated);
});
exports.updateSessionName = updateSessionName;
const getManagerTeamSessions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const managerId = req.user.empId;
    const employees = yield prisma_1.prisma.employee.findMany({
        where: {
            reportingManager: managerId
        },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            photoUrl: true,
            locationSessions: {
                orderBy: { createdAt: "desc" },
                include: {
                    locations: true,
                    photos: true
                }
            }
        }
    });
    res.json(employees);
});
exports.getManagerTeamSessions = getManagerTeamSessions;
