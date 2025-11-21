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
exports.createAnnouncement = createAnnouncement;
exports.ackAnnouncement = ackAnnouncement;
exports.listLiveForEmployee = listLiveForEmployee;
exports.listLiveAnnouncementsWithStats = listLiveAnnouncementsWithStats;
exports.listAllLiveForEmployee = listAllLiveForEmployee;
const client_1 = require("@prisma/client");
const basic_ftp_1 = require("basic-ftp");
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const prisma = new client_1.PrismaClient();
const FTP_CONFIG = {
    host: "srv680.main-hosting.eu",
    user: "u948610439.hrproindia.in",
    password: "Bsrenuk@1993",
    secure: false
};
const upload = (0, multer_1.default)({ dest: 'uploads/' }); // temp folder
function uploadToFTP(localFilePath, remoteFilePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        try {
            yield client.access(FTP_CONFIG);
            yield client.ensureDir('/public_html/circulars');
            yield client.uploadFrom(localFilePath, remoteFilePath);
        }
        finally {
            client.close();
        }
    });
}
// Utility: build an Employee where-filter from stored audience JSON
function buildAudienceWhere(audienceJson) {
    var _a, _b, _c, _d;
    if (!audienceJson)
        return undefined;
    try {
        let f = JSON.parse(audienceJson);
        if (typeof f === "string") {
            f = JSON.parse(f); // handle double-encoded JSON
        }
        const where = { employmentStatus: "ACTIVE" };
        if (f.all) {
            return where; // no extra filters (all active employees)
        }
        if ((_a = f.departmentId) === null || _a === void 0 ? void 0 : _a.length) {
            where.departmentId = { in: f.departmentId.map((d) => Number(d)) };
        }
        if ((_b = f.branchId) === null || _b === void 0 ? void 0 : _b.length) {
            where.branchId = { in: f.branchId.map((b) => Number(b)) };
        }
        if ((_c = f.roleId) === null || _c === void 0 ? void 0 : _c.length) {
            where.roleId = { in: f.roleId.map((r) => Number(r)) };
        }
        if ((_d = f.employeeId) === null || _d === void 0 ? void 0 : _d.length) {
            where.id = { in: f.employeeId.map((e) => Number(e)) };
        }
        return where;
    }
    catch (err) {
        console.error("Invalid audience JSON:", audienceJson);
        return undefined;
    }
}
function generateCircularCode() {
    return __awaiter(this, void 0, void 0, function* () {
        const year = new Date().getFullYear();
        const countThisYear = yield prisma.announcement.count({
            where: {
                createdAt: {
                    gte: new Date(`${year}-01-01T00:00:00Z`),
                    lte: new Date(`${year}-12-31T23:59:59Z`),
                },
            },
        });
        return `CIRC-${year}-${String(countThisYear + 1).padStart(3, "0")}`;
    });
}
function createAnnouncement(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const { title, body, audience, startsAt, endsAt, type, isPinned, requireAck } = req.body;
            if (!title || !body) {
                return res.status(400).json({ error: 'title and body are required' });
            }
            const circularCode = yield generateCircularCode();
            const files = req.files;
            let attachments = [];
            if (files && files.length) {
                for (const f of files) {
                    const remoteFileName = `${Date.now()}-${f.originalname}`;
                    const remotePath = `/public_html/circulars/${remoteFileName}`;
                    yield uploadToFTP(f.path, remotePath);
                    const publicUrl = `https://hrproindia.in/circulars/${remoteFileName}`;
                    attachments.push({ name: f.originalname, url: publicUrl });
                    // cleanup local temp file
                    try {
                        fs_1.default.unlinkSync(f.path);
                    }
                    catch (_c) { }
                }
            }
            const created = yield prisma.announcement.create({
                data: {
                    circularCode,
                    title,
                    body,
                    isPinned: req.body.isPinned === "true",
                    requireAck: req.body.requireAck === "true",
                    type: type || 'GENERAL',
                    audience: audience ? JSON.stringify(audience) : null,
                    startsAt: startsAt ? new Date(startsAt) : undefined,
                    endsAt: endsAt ? new Date(endsAt) : null,
                    attachments: attachments.length ? JSON.stringify(attachments) : null,
                    createdBy: (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) !== null && _b !== void 0 ? _b : 0, // adjust to your auth
                },
            });
            return res.status(201).json(created);
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ error: 'Failed to create announcement' });
        }
    });
}
/** POST /announcements/:id/ack  { employeeId }  */
function ackAnnouncement(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            const announcementId = Number(req.params.id);
            const employeeId = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.employeeId) !== null && _b !== void 0 ? _b : (_c = req.user) === null || _c === void 0 ? void 0 : _c.empId;
            if (!announcementId || !employeeId) {
                return res.status(400).json({ error: 'announcementId and employeeId are required' });
            }
            // Unique per (announcement, employee) is enforced by @@unique([announcementId, employeeId])
            yield prisma.announcementAck.create({
                data: { announcementId, employeeId },
            }).catch(err => {
                // swallow unique constraint errors (already acked)
                if ((err === null || err === void 0 ? void 0 : err.code) !== 'P2002')
                    throw err;
            });
            const ackCount = yield prisma.announcementAck.count({ where: { announcementId } });
            return res.json({ message: 'Acknowledged', ackCount });
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ error: 'Failed to acknowledge' });
        }
    });
}
function listLiveForEmployee(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const user = req.user; // from JWT/session
            const empId = user.empId;
            const deptId = user.deptId;
            const role = user.role;
            const branchId = user.branchId; // if available
            console.log(`Listing announcements for empId=${empId} deptId=${deptId} role=${role} branchId=${branchId}`);
            const now = new Date();
            // fetch live announcements
            const live = yield prisma.announcement.findMany({
                where: {
                    startsAt: { lte: now },
                    OR: [{ endsAt: null }, { endsAt: { gte: now } }],
                },
                orderBy: { startsAt: "desc" },
                include: {
                    acks: {
                        where: { employeeId: empId }, // only check if THIS employee has acked
                        select: { id: true },
                    },
                },
            });
            // filter by audience
            const relevant = live.filter((a) => {
                var _a, _b, _c, _d;
                // already acknowledged → skip
                if (a.acks && a.acks.length > 0)
                    return false;
                if (!a.audience)
                    return true; // no filter = all employees
                let audience;
                try {
                    audience = JSON.parse(a.audience);
                    if (typeof audience === "string") {
                        audience = JSON.parse(audience); // fix double encoding
                    }
                }
                catch (err) {
                    console.error(`Invalid audience JSON for announcement ${a.id}`, a.audience);
                    return false;
                }
                console.log(`Announcement ${a.id} audience filter:`, audience);
                if (audience.all)
                    return true;
                if ((_a = audience.departmentId) === null || _a === void 0 ? void 0 : _a.some((d) => Number(d) === Number(deptId)))
                    return true;
                if ((_b = audience.branchId) === null || _b === void 0 ? void 0 : _b.some((b) => Number(b) === Number(branchId)))
                    return true;
                if ((_c = audience.roleId) === null || _c === void 0 ? void 0 : _c.some((r) => String(r) === String(role)))
                    return true;
                if ((_d = audience.employeeId) === null || _d === void 0 ? void 0 : _d.some((e) => Number(e) === Number(empId)))
                    return true;
                return false;
            });
            console.log(`Found ${relevant.length} relevant announcements (not acked) for empId=${empId}`);
            console.log(relevant.map((a) => ({ id: a.id, title: a.title })));
            return res.json(relevant);
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ error: "Failed to load announcements" });
        }
    });
}
/** GET /announcements/live -> [{ id, title, ackCount, audienceCount, ackRate }] */
function listLiveAnnouncementsWithStats(_req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const now = new Date();
            const live = yield prisma.announcement.findMany({
                where: {
                    startsAt: { lte: now },
                    OR: [{ endsAt: null }, { endsAt: { gte: now } }],
                },
                orderBy: { startsAt: "desc" },
                select: { id: true, title: true, audience: true },
            });
            // Compute stats per announcement
            const stats = yield Promise.all(live.map((a) => __awaiter(this, void 0, void 0, function* () {
                const audienceWhere = buildAudienceWhere(a.audience);
                // count target employees
                const audienceCount = yield prisma.employee.count({
                    where: audienceWhere,
                });
                // count acks
                const ackCount = yield prisma.announcementAck.count({
                    where: { announcementId: a.id },
                });
                const ackRate = audienceCount ? ackCount / audienceCount : 0;
                return {
                    id: a.id,
                    title: a.title,
                    ackCount,
                    audienceCount,
                    ackRate, // raw ratio
                    ackPercent: Math.round(ackRate * 100),
                };
            })));
            return res.json(stats);
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ error: "Failed to load live announcements" });
        }
    });
}
function listAllLiveForEmployee(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const user = req.user; // from JWT/session middleware
            const empId = user.empId;
            const deptId = user.deptId;
            const role = user.role;
            const branchId = user.branchId;
            console.log(`Fetching all live announcements for empId=${empId}`);
            const now = new Date();
            // 1️⃣ Fetch all live announcements (still valid)
            const liveAnnouncements = yield prisma.announcement.findMany({
                where: {
                    startsAt: { lte: now },
                    OR: [{ endsAt: null }, { endsAt: { gte: now } }],
                },
                orderBy: { startsAt: "desc" },
                include: {
                    acks: {
                        where: { employeeId: empId },
                        select: { id: true },
                    },
                },
            });
            // 2️⃣ Filter based on audience (who should see this)
            const relevant = liveAnnouncements.filter((a) => {
                var _a, _b, _c, _d;
                if (!a.audience)
                    return true; // all employees can see
                let audience;
                try {
                    audience = JSON.parse(a.audience);
                    if (typeof audience === "string") {
                        audience = JSON.parse(audience); // handle double JSON encoding
                    }
                }
                catch (err) {
                    console.error(`Invalid audience JSON for announcement ${a.id}`, a.audience);
                    return false;
                }
                if (audience.all)
                    return true;
                if ((_a = audience.departmentId) === null || _a === void 0 ? void 0 : _a.some((d) => Number(d) === Number(deptId)))
                    return true;
                if ((_b = audience.branchId) === null || _b === void 0 ? void 0 : _b.some((b) => Number(b) === Number(branchId)))
                    return true;
                if ((_c = audience.roleId) === null || _c === void 0 ? void 0 : _c.some((r) => String(r) === String(role)))
                    return true;
                if ((_d = audience.employeeId) === null || _d === void 0 ? void 0 : _d.some((e) => Number(e) === Number(empId)))
                    return true;
                return false;
            });
            // 3️⃣ Add acknowledgement status
            const result = relevant.map((a) => ({
                id: a.id,
                title: a.title,
                body: a.body,
                type: a.type,
                startsAt: a.startsAt,
                endsAt: a.endsAt,
                attachments: a.attachments,
                isPinned: a.isPinned,
                requireAck: a.requireAck,
                acknowledged: a.acks && a.acks.length > 0, // 👈 flag
            }));
            console.log(`Found ${result.length} announcements for empId=${empId}`);
            return res.json(result);
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ error: "Failed to load announcements" });
        }
    });
}
