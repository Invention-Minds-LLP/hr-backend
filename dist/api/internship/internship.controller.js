"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInternship = createInternship;
exports.listInternships = listInternships;
exports.getInternship = getInternship;
exports.updateInternship = updateInternship;
exports.offerInternship = offerInternship;
exports.activateInternship = activateInternship;
exports.extendInternship = extendInternship;
exports.completeInternship = completeInternship;
exports.dropInternship = dropInternship;
exports.convertInternship = convertInternship;
exports.generateCertificatePdf = generateCertificatePdf;
exports.uploadToFTP = uploadToFTP;
const client_1 = require("@prisma/client");
const pdfkit_1 = __importDefault(require("pdfkit"));
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const basic_ftp_1 = require("basic-ftp");
const COMPANY_NAME = 'RASHTROTTHANA HOSPITAL'; // <- put your real company name
const COMPANY_LOGO_URL = 'https://hrproindia.in/documents/Rashtrotthana-logo.jpeg'; // <- put your real logo URL
const COMPANY_TAGLINE = 'People • Process • Performance';
const FTP_CONFIG = {
    host: (_a = process.env.FTP_HOST) !== null && _a !== void 0 ? _a : "",
    user: (_b = process.env.FTP_USER) !== null && _b !== void 0 ? _b : "",
    password: (_c = process.env.FTP_PASS) !== null && _c !== void 0 ? _c : "",
    secure: process.env.FTP_SECURE === "true"
};
const prisma = new client_1.PrismaClient();
const toDate = (v) => (v ? new Date(v) : undefined);
const parseStatuses = (csv) => csv ? csv.split(',').map(s => s.trim().toUpperCase()) : undefined;
// Small helper to resolve mentor names without schema changes
function buildNameMap(ids) {
    return __awaiter(this, void 0, void 0, function* () {
        const uniq = Array.from(new Set(ids.filter((x) => typeof x === 'number')));
        if (!uniq.length)
            return new Map();
        const people = yield prisma.employee.findMany({
            where: { id: { in: uniq } },
            select: { id: true, firstName: true, lastName: true },
        });
        return new Map(people.map(p => [p.id, `${p.firstName} ${p.lastName}`]));
    });
}
// Reusable select (type-safe enough when used inline)
const internshipSelect = {
    id: true,
    employeeId: true,
    mentorId: true,
    startDate: true,
    endDate: true,
    departmentId: true,
    status: true,
    notes: true,
    candidateName: true,
    email: true,
    phone: true,
    title: true,
    stipend: true,
    createdAt: true,
    updatedAt: true,
    employee: { select: { id: true, firstName: true, lastName: true } }, // optional relation
    Department: { select: { id: true, name: true } },
};
/** POST /api/internships */
function createInternship(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            const { candidateName, email, phone, title, stipend, notes, employeeId, mentorId, startDate, endDate, departmentId, status, } = req.body || {};
            if (!candidateName)
                return res.status(400).json({ error: 'candidateName is required' });
            if (!startDate)
                return res.status(400).json({ error: 'startDate is required' }); // startDate is non-null in your schema
            const created = yield prisma.internship.create({
                data: {
                    candidateName,
                    email: email !== null && email !== void 0 ? email : null,
                    phone: phone !== null && phone !== void 0 ? phone : null,
                    title: title !== null && title !== void 0 ? title : null,
                    stipend: stipend !== null && stipend !== void 0 ? stipend : null,
                    notes: notes !== null && notes !== void 0 ? notes : null,
                    employeeId: employeeId == null ? null : Number(employeeId),
                    mentorId: mentorId == null ? null : Number(mentorId),
                    departmentId: departmentId == null ? null : Number(departmentId),
                    startDate: new Date(startDate),
                    endDate: endDate == null ? null : new Date(endDate),
                    status: (_a = status) !== null && _a !== void 0 ? _a : 'DRAFT', // override schema default if not provided
                },
                select: internshipSelect,
            });
            const mentorMap = yield buildNameMap([created.mentorId]);
            const message = `A intern ${created.candidateName} has been assigned to you. Please check the details and provide necessary guidance.`;
            //    if(created.mentorId){
            //     await createNotification(created.mentorId, message);
            //    }
            // await createNotification(created.mentorId, message);
            return res.status(201).json(Object.assign(Object.assign({}, created), { employeeName: created.employee ? `${created.employee.firstName} ${created.employee.lastName}` : null, departmentName: (_c = (_b = created.Department) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : null, mentorName: created.mentorId ? mentorMap.get(created.mentorId) || null : null }));
        }
        catch (e) {
            console.error(e);
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2003')
                return res.status(400).json({ error: 'Invalid foreign key (employeeId/mentorId)' });
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2002')
                return res.status(409).json({ error: 'Unique constraint violation' });
            return res.status(500).json({ error: 'Failed to create internship' });
        }
    });
}
/** GET /api/internships */
function listInternships(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { q, status, employeeId, mentorId, departmentId, departments, startFrom, startTo, endFrom, endTo, activeFrom, // NEW
            activeTo, // NEW
            page = '1', pageSize = '20', order = 'desc', } = (req.query || {});
            // Build OR for keyword search (no mode)
            const keywordOr = q
                ? [
                    { candidateName: { contains: q } },
                    { email: { contains: q } },
                    { phone: { contains: q } },
                    { title: { contains: q } },
                    { Department: { is: { name: { contains: q } } } },
                    {
                        employee: {
                            is: {
                                OR: [
                                    { firstName: { contains: q } },
                                    { lastName: { contains: q } },
                                ]
                            }
                        }
                    },
                ]
                : undefined;
            // NEW: build overlap filter for "active between" range
            const af = activeFrom ? new Date(activeFrom) : undefined;
            const at = activeTo ? new Date(activeTo) : undefined;
            const activeAND = [];
            if (at)
                activeAND.push({ startDate: { lte: at } });
            if (af)
                activeAND.push({ OR: [{ endDate: { gte: af } }, { endDate: null }] });
            const where = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (keywordOr ? { OR: keywordOr } : {})), (status ? { status: { in: status.split(',').map(s => s.trim().toUpperCase()) } } : {})), (employeeId ? { employeeId: Number(employeeId) } : {})), (mentorId ? { mentorId: Number(mentorId) } : {})), (departmentId ? { departmentId: Number(departmentId) } : {})), (departments ? { departmentId: { in: departments.split(',').map(n => Number(n)).filter(Boolean) } } : {})), (startFrom || startTo
                ? {
                    startDate: {
                        gte: startFrom ? new Date(startFrom) : undefined,
                        lte: startTo ? new Date(startTo) : undefined,
                    },
                }
                : {})), (endFrom || endTo
                ? {
                    endDate: {
                        gte: endFrom ? new Date(endFrom) : undefined,
                        lte: endTo ? new Date(endTo) : undefined,
                    },
                }
                : {})), (activeAND.length ? { AND: activeAND } : {}));
            const skip = (Math.max(1, +page) - 1) * Math.max(1, +pageSize);
            const take = Math.max(1, Math.min(200, +pageSize));
            const select = {
                id: true,
                employeeId: true,
                mentorId: true,
                departmentId: true,
                startDate: true,
                endDate: true,
                status: true,
                notes: true,
                candidateName: true,
                email: true,
                phone: true,
                title: true,
                stipend: true,
                createdAt: true,
                updatedAt: true,
                employee: { select: { id: true, firstName: true, lastName: true } },
                Department: { select: { id: true, name: true } },
            };
            const [items, total] = yield Promise.all([
                prisma.internship.findMany({
                    where,
                    orderBy: { createdAt: order === 'asc' ? 'asc' : 'desc' },
                    skip,
                    take,
                    select,
                }),
                prisma.internship.count({ where }),
            ]);
            // mentor name enrichment (unchanged)
            const mentorIds = Array.from(new Set(items.map(i => i.mentorId).filter(Boolean)));
            const mentors = mentorIds.length
                ? yield prisma.employee.findMany({ where: { id: { in: mentorIds } }, select: { id: true, firstName: true, lastName: true } })
                : [];
            const mentorMap = new Map(mentors.map(m => [m.id, `${m.firstName} ${m.lastName}`]));
            const enriched = items.map(i => {
                var _a, _b;
                return (Object.assign(Object.assign({}, i), { employeeName: i.employee ? `${i.employee.firstName} ${i.employee.lastName}` : null, mentorName: i.mentorId ? mentorMap.get(i.mentorId) || null : null, departmentName: (_b = (_a = i.Department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null }));
            });
            return res.json({ items: enriched, total, page: +page, pageSize: take });
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ error: 'Failed to list internships' });
        }
    });
}
/** GET /api/internships/:id */
function getInternship(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const id = Number(req.params.id);
            const item = yield prisma.internship.findUnique({
                where: { id },
                select: internshipSelect,
            });
            if (!item)
                return res.status(404).json({ error: 'Not found' });
            const mentorMap = yield buildNameMap([item.mentorId]);
            return res.json(Object.assign(Object.assign({}, item), { employeeName: item.employee ? `${item.employee.firstName} ${item.employee.lastName}` : null, mentorName: item.mentorId ? mentorMap.get(item.mentorId) || null : null, departmentName: (_b = (_a = item.Department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null }));
        }
        catch (e) {
            console.error(e);
            return res.status(500).json({ error: 'Failed to load internship' });
        }
    });
}
/** PATCH /api/internships/:id */
function updateInternship(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const id = Number(req.params.id);
            const { candidateName, email, phone, title, stipend, notes, employeeId, mentorId, startDate, endDate, departmentId, status, } = req.body || {};
            const updated = yield prisma.internship.update({
                where: { id },
                data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (candidateName !== undefined ? { candidateName } : {})), (email !== undefined ? { email } : {})), (phone !== undefined ? { phone } : {})), (title !== undefined ? { title } : {})), (stipend !== undefined ? { stipend } : {})), (notes !== undefined ? { notes } : {})), (employeeId !== undefined ? { employeeId: employeeId == null ? null : Number(employeeId) } : {})), (mentorId !== undefined ? { mentorId: mentorId == null ? null : Number(mentorId) } : {})), (departmentId !== undefined ? { departmentId: departmentId == null ? null : Number(departmentId) } : {})), (startDate !== undefined ? { startDate: new Date(startDate) } : {})), (endDate !== undefined ? { endDate: endDate == null ? null : new Date(endDate) } : {})), (status !== undefined ? { status: status } : {})),
                select: internshipSelect,
            });
            const mentorMap = yield buildNameMap([updated.mentorId]);
            return res.json(Object.assign(Object.assign({}, updated), { employeeName: updated.employee ? `${updated.employee.firstName} ${updated.employee.lastName}` : null, departmentName: (_b = (_a = updated.Department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null, mentorName: updated.mentorId ? mentorMap.get(updated.mentorId) || null : null }));
        }
        catch (e) {
            console.error(e);
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2025')
                return res.status(404).json({ error: 'Not found' });
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2003')
                return res.status(400).json({ error: 'Invalid foreign key (employeeId/mentorId)' });
            return res.status(500).json({ error: 'Failed to update internship' });
        }
    });
}
/** POST /api/internships/:id/offer -> status=OFFERED (optional startDate) */
function offerInternship(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { startDate } = req.body || {};
            const updated = yield prisma.internship.update({
                where: { id },
                data: Object.assign({ status: 'OFFERED' }, (startDate ? { startDate: new Date(startDate) } : {})),
                select: internshipSelect,
            });
            return res.json(updated);
        }
        catch (e) {
            console.error(e);
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2025')
                return res.status(404).json({ error: 'Not found' });
            return res.status(500).json({ error: 'Failed to offer internship' });
        }
    });
}
/** POST /api/internships/:id/activate -> status=ACTIVE (must have startDate) */
function activateInternship(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { startDate, employeeId } = req.body || {};
            const updated = yield prisma.internship.update({
                where: { id },
                data: Object.assign(Object.assign({ status: 'ACTIVE' }, (startDate ? { startDate: new Date(startDate) } : {})), (employeeId !== undefined ? { employeeId: employeeId == null ? null : Number(employeeId) } : {})),
                select: internshipSelect,
            });
            return res.json(updated);
        }
        catch (e) {
            console.error(e);
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2025')
                return res.status(404).json({ error: 'Not found' });
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2003')
                return res.status(400).json({ error: 'Invalid foreign key (employeeId)' });
            return res.status(500).json({ error: 'Failed to activate internship' });
        }
    });
}
/** POST /api/internships/:id/extend -> sets endDate */
function extendInternship(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { endDate } = req.body || {};
            if (!endDate)
                return res.status(400).json({ error: 'endDate is required' });
            const updated = yield prisma.internship.update({
                where: { id },
                data: { endDate: new Date(endDate) },
                select: internshipSelect,
            });
            return res.json(updated);
        }
        catch (e) {
            console.error(e);
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2025')
                return res.status(404).json({ error: 'Not found' });
            return res.status(500).json({ error: 'Failed to extend internship' });
        }
    });
}
/** POST /api/internships/:id/complete -> status=COMPLETED (optional endDate) */
function completeInternship(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        try {
            const id = Number(req.params.id);
            const { endDate } = (req.body || {});
            // 1) complete
            yield prisma.internship.update({
                where: { id },
                data: Object.assign({ status: 'COMPLETED' }, (endDate ? { endDate: new Date(endDate) } : {})),
            });
            // 2) load
            const existing = yield prisma.internship.findUnique({
                where: { id },
                select: {
                    id: true, status: true, startDate: true, endDate: true,
                    candidateName: true, title: true,
                    Department: { select: { name: true } },
                    certificateCode: true, certificateIssuedAt: true,
                },
            });
            if (!existing)
                return res.status(404).json({ error: 'Not found' });
            // 3) ensure code (idempotent)
            let code = existing.certificateCode;
            let issuedAt = (_a = existing.certificateIssuedAt) !== null && _a !== void 0 ? _a : undefined;
            if (!code) {
                for (let attempts = 0; attempts < 4; attempts++) {
                    const tryCode = genCertCode();
                    const claimed = yield prisma.internship.updateMany({
                        where: { id, certificateCode: null },
                        data: { certificateCode: tryCode, certificateIssuedAt: new Date() },
                    });
                    if (claimed.count === 1) {
                        code = tryCode;
                        break;
                    }
                    const row = yield prisma.internship.findUnique({ where: { id }, select: { certificateCode: true, certificateIssuedAt: true } });
                    if (row === null || row === void 0 ? void 0 : row.certificateCode) {
                        code = row.certificateCode;
                        issuedAt = (_b = row.certificateIssuedAt) !== null && _b !== void 0 ? _b : undefined;
                        break;
                    }
                }
                if (!code)
                    return res.status(500).json({ error: 'Could not issue certificate' });
            }
            // refresh issuedAt if missing
            if (!issuedAt) {
                const row = yield prisma.internship.findUnique({ where: { id }, select: { certificateIssuedAt: true } });
                issuedAt = (_c = row === null || row === void 0 ? void 0 : row.certificateIssuedAt) !== null && _c !== void 0 ? _c : new Date();
            }
            // 4) generate PDF
            const { filePath, fileName } = yield generateCertificatePdf({
                code,
                issuedAt,
                candidateName: existing.candidateName,
                title: existing.title,
                startDate: existing.startDate,
                endDate: existing.endDate,
                departmentName: (_e = (_d = existing.Department) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : null,
                companyName: COMPANY_NAME,
                companyLogoUrl: COMPANY_LOGO_URL,
                companyTagline: COMPANY_TAGLINE,
            });
            // 5) upload to Hostinger
            const remotePath = `/public_html/certificate/${fileName}`;
            yield uploadToFTP(filePath, remotePath, FTP_CONFIG);
            const publicUrl = `https://hrproindia.in/certificate/${fileName}`;
            // cleanup
            try {
                fs.unlinkSync(filePath);
            }
            catch (_h) { }
            // 6) return
            return res.json({
                id: existing.id,
                status: 'COMPLETED',
                candidateName: existing.candidateName,
                title: existing.title,
                startDate: existing.startDate,
                endDate: existing.endDate,
                departmentName: (_g = (_f = existing.Department) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : null,
                certificate: {
                    code,
                    issuedAt,
                    url: publicUrl,
                    format: 'pdf',
                },
            });
        }
        catch (e) {
            console.error(e);
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2025')
                return res.status(404).json({ error: 'Not found' });
            return res.status(500).json({ error: 'Failed to complete internship' });
        }
    });
}
/** POST /api/internships/:id/drop -> status=DROPPED (optional reason -> notes append) */
function dropInternship(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const { reason } = req.body || {};
            // Keep previous notes and append reason if present
            const existing = yield prisma.internship.findUnique({ where: { id }, select: { notes: true } });
            if (!existing)
                return res.status(404).json({ error: 'Not found' });
            const updated = yield prisma.internship.update({
                where: { id },
                data: {
                    status: 'DROPPED',
                    notes: reason ? [existing.notes, reason].filter(Boolean).join('\n') : existing.notes,
                },
                select: internshipSelect,
            });
            return res.json(updated);
        }
        catch (e) {
            console.error(e);
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2025')
                return res.status(404).json({ error: 'Not found' });
            return res.status(500).json({ error: 'Failed to drop internship' });
        }
    });
}
/** POST /api/internships/:id/convert -> status=CONVERTED, optionally create/attach employee */
function convertInternship(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        try {
            const id = Number(req.params.id);
            const { employeeId, createEmployee, // { firstName,lastName,email?,departmentId?,branchId?,dateOfJoining? }
             } = req.body || {};
            let newEmpId = employeeId;
            if (!newEmpId && createEmployee) {
                const emp = yield prisma.employee.create({
                    data: {
                        firstName: createEmployee.firstName,
                        lastName: createEmployee.lastName,
                        email: (_a = createEmployee.email) !== null && _a !== void 0 ? _a : null,
                        departmentId: (_b = createEmployee.departmentId) !== null && _b !== void 0 ? _b : null,
                        branchId: (_c = createEmployee.branchId) !== null && _c !== void 0 ? _c : null,
                        dateOfJoining: createEmployee.dateOfJoining ? new Date(createEmployee.dateOfJoining) : new Date(),
                        employmentStatus: 'ACTIVE',
                    },
                    select: { id: true },
                });
                newEmpId = emp.id;
                yield prisma.internship.update({
                    where: { id },
                    data: { departmentId: (_d = createEmployee.departmentId) !== null && _d !== void 0 ? _d : null },
                });
            }
            const updated = yield prisma.internship.update({
                where: { id },
                data: Object.assign(Object.assign({ status: 'CONVERTED' }, (newEmpId ? { employeeId: newEmpId } : {})), (employeeId && (yield prisma.employee.findUnique({ where: { id: employeeId }, select: { departmentId: true } }))
                    ? { departmentId: (_e = (yield prisma.employee.findUnique({ where: { id: employeeId }, select: { departmentId: true } })).departmentId) !== null && _e !== void 0 ? _e : null }
                    : {})),
                select: internshipSelect,
            });
            return res.json(updated);
        }
        catch (e) {
            console.error(e);
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2025')
                return res.status(404).json({ error: 'Not found' });
            if ((e === null || e === void 0 ? void 0 : e.code) === 'P2003')
                return res.status(400).json({ error: 'Invalid foreign key (employeeId)' });
            return res.status(500).json({ error: 'Failed to convert internship' });
        }
    });
}
const crypto_1 = require("crypto");
function genCertCode() {
    return `CERT-${(0, crypto_1.randomBytes)(4).toString('hex').toUpperCase()}`; // e.g. CERT-9F3A2C1B
}
function renderCertificateHtml(args) {
    const fmt = (d) => (d ? d.toDateString() : '—');
    return `
  <html><head><title>Certificate ${args.code}</title>
  <meta charset="utf-8">
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:40px;background:#fafafa}
    .card{border:2px solid #222;padding:40px;border-radius:12px;background:#fff;max-width:800px;margin:0 auto}
    h1{margin:0 0 12px}
    .muted{color:#666}
  </style></head><body>
    <div class="card">
      <h1>Internship Completion Certificate</h1>
      <p>This certifies that <strong>${args.candidateName}</strong>${args.title ? ` completed an internship in <strong>${args.title}</strong>` : ' completed an internship'}${args.departmentName ? ` with the <strong>${args.departmentName}</strong> department` : ''}.</p>
      <p class="muted">Period: ${fmt(args.startDate)} — ${fmt(args.endDate)}</p>
      <p class="muted">Issued on: ${fmt(args.issuedAt)}</p>
      <p class="muted">Certificate ID: <strong>${args.code}</strong></p>
    </div>
  </body></html>`;
}
function fmtDate(d) {
    return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
function fetchBuffer(url) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!url)
            return null;
        try {
            const res = yield axios_1.default.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(res.data);
        }
        catch (_a) {
            return null;
        }
    });
}
/** Returns { filePath, fileName } */
function generateCertificatePdf(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const fileName = `${input.code}.pdf`;
        const filePath = path.join(os.tmpdir(), fileName);
        const doc = new pdfkit_1.default({ size: 'A4', margin: 36 }); // 595 x 842 pt
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);
        const w = doc.page.width, h = doc.page.height;
        // Border
        doc.save()
            .roundedRect(18, 18, w - 36, h - 36, 12)
            .lineWidth(3)
            .stroke('#1f2937') // slate-800
            .restore();
        // Inner border accent
        doc.save()
            .roundedRect(28, 28, w - 56, h - 56, 10)
            .lineWidth(1)
            .stroke('#9ca3af') // gray-400
            .restore();
        // Logo
        const logo = yield fetchBuffer(input.companyLogoUrl);
        if (logo) {
            const logoWidth = 72;
            doc.image(logo, (w - logoWidth) / 2, 54, { width: logoWidth });
        }
        // Company name
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827')
            .text(input.companyName, 36, logo ? 138 : 70, { align: 'center' });
        if (input.companyTagline) {
            doc.font('Helvetica').fontSize(10).fillColor('#6b7280')
                .text(input.companyTagline, 36, doc.y + 2, { align: 'center' });
        }
        // Title
        doc.moveDown(1.2);
        doc.font('Helvetica-Bold').fontSize(28).fillColor('#1f2937')
            .text('CERTIFICATE OF COMPLETION', { align: 'center', characterSpacing: 0.5 });
        // Candidate name
        doc.moveDown(1.6);
        doc.font('Helvetica').fontSize(12).fillColor('#374151')
            .text('This is to certify that', { align: 'center' });
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(30).fillColor('#111827')
            .text(input.candidateName, { align: 'center' });
        // Body
        const rolePart = input.title ? ` in ${input.title}` : '';
        const deptPart = input.departmentName ? ` with the ${input.departmentName} department` : '';
        const body = `has successfully completed the internship${rolePart}${deptPart}.`;
        doc.moveDown(0.6);
        doc.font('Helvetica').fontSize(12).fillColor('#374151')
            .text(body, 72, doc.y, { align: 'center' });
        // Period
        doc.moveDown(0.8);
        doc.font('Helvetica').fontSize(12).fillColor('#111827')
            .text(`Period: ${fmtDate(input.startDate)} — ${fmtDate(input.endDate)}`, { align: 'center' });
        // Issued & Code box
        doc.moveDown(2);
        const boxW = w - 160, boxX = (w - boxW) / 2;
        doc.roundedRect(boxX, doc.y, boxW, 70, 8).fillOpacity(0.06).fill('#111827').fillOpacity(1).stroke('#e5e7eb');
        const yBase = doc.y + 10;
        doc.font('Helvetica').fontSize(10).fillColor('#374151')
            .text(`Issued on: ${fmtDate(input.issuedAt)}`, boxX + 16, yBase, { width: boxW - 32, align: 'left' });
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827')
            .text(`Certificate ID: ${input.code}`, boxX + 16, yBase + 22, { width: boxW - 32, align: 'left' });
        // Footer lines for signatures (optional)
        const sigY = h - 140;
        doc.moveTo(90, sigY).lineTo(240, sigY).stroke('#9ca3af');
        doc.moveTo(w - 240, sigY).lineTo(w - 90, sigY).stroke('#9ca3af');
        doc.font('Helvetica').fontSize(10).fillColor('#374151')
            .text('HR Manager', 90, sigY + 6, { width: 150, align: 'center' })
            .text('Department Head', w - 240, sigY + 6, { width: 150, align: 'center' });
        doc.end();
        yield new Promise((resolve, reject) => {
            stream.on('finish', () => resolve());
            stream.on('error', reject);
        });
        return { filePath, fileName };
    });
}
function uploadToFTP(localFilePath, remoteFilePath, FTP_CONFIG) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = false;
        try {
            yield client.access(FTP_CONFIG);
            // ensure /public_html/certificate exists
            yield client.ensureDir('/public_html/certificate');
            yield client.uploadFrom(localFilePath, remoteFilePath); // absolute remote path
        }
        finally {
            client.close();
        }
    });
}
