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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveEmployees = exports.getSpecificRoles = exports.uploadEmployeeDocuments = exports.deleteEmployee = exports.updateEmployee = exports.getEmployeeById = exports.getEmployees = exports.createEmployee = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const formidable_1 = __importDefault(require("formidable"));
const fs_1 = __importDefault(require("fs"));
const basic_ftp_1 = require("basic-ftp");
const path_1 = __importDefault(require("path"));
const FTP_CONFIG = {
    host: "srv680.main-hosting.eu", // Your FTP hostname
    user: "u948610439.hrproindia.in", // Your FTP username
    password: "Bsrenuk@1993", // Your FTP password
    secure: false // Set to true if using FTPS
};
const TEMP_FOLDER = path_1.default.join(__dirname, '../temp'); // absolute path
if (!fs_1.default.existsSync(TEMP_FOLDER)) {
    fs_1.default.mkdirSync(TEMP_FOLDER, { recursive: true });
}
// CREATE Employee (with emergency contacts & qualifications)
const createEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeCode, referenceCode, firstName, lastName, gender, dob, photoUrl, phone, email, designation, departmentId, branchId, dateOfJoining, employmentType, probationEndDate, employmentStatus, emergencyContacts, qualifications, addresses, roleId, bloodGroup, reportingManager, } = req.body;
        const newEmployee = yield prisma.employee.create({
            data: {
                employeeCode,
                referenceCode,
                firstName,
                lastName,
                gender,
                dob: new Date(dob),
                photoUrl,
                phone,
                email,
                designation,
                dateOfJoining: new Date(dateOfJoining),
                employmentType,
                probationEndDate: probationEndDate ? new Date(probationEndDate) : null,
                employmentStatus,
                bloodGroup,
                reportingManager,
                // Connect relations
                Department: { connect: { id: departmentId } },
                Branch: { connect: { id: branchId } },
                role: { connect: { id: roleId } },
                Address: {
                    create: addresses === null || addresses === void 0 ? void 0 : addresses.map((a) => ({
                        type: a.type,
                        line1: a.line1,
                        line2: a.line2,
                        city: a.city,
                        state: a.state,
                        zipCode: a.zipCode,
                        country: a.country
                    }))
                },
                // Nested creates
                emergencyContacts: {
                    create: emergencyContacts === null || emergencyContacts === void 0 ? void 0 : emergencyContacts.map((ec) => ({
                        name: ec.name,
                        phone: ec.phone,
                        relationship: ec.relationship
                    }))
                },
                qualifications: {
                    create: qualifications === null || qualifications === void 0 ? void 0 : qualifications.map((q) => ({
                        degree: q.degree,
                        institution: q.institution,
                        year: q.year
                    }))
                },
            },
            include: {
                emergencyContacts: true,
                qualifications: true,
                Department: true,
                Branch: true,
                role: true,
                Address: true,
            }
        });
        return res.status(201).json(newEmployee);
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to create employee" });
    }
});
exports.createEmployee = createEmployee;
// GET all employees
const getEmployees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employees = yield prisma.employee.findMany({
            include: {
                Address: true,
                emergencyContacts: true,
                qualifications: true,
                documents: true,
                shifts: {
                    orderBy: { date: 'desc' }, // Most recent first
                    take: 1, // Only 1 record
                    include: {
                        shift: true // Include shift template details (name, timings)
                    }
                }
            }
        });
        const formatted = employees.map(emp => (Object.assign(Object.assign({}, emp), { latestShiftAssignment: emp.shifts[0] || null })));
        res.json(formatted);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch employees" });
    }
});
exports.getEmployees = getEmployees;
// GET single employee by ID
const getEmployeeById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const employee = yield prisma.employee.findUnique({
            where: { id: Number(id) },
            include: {
                emergencyContacts: true,
                qualifications: true
            }
        });
        if (!employee)
            return res.status(404).json({ error: "Employee not found" });
        res.json(employee);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch employee" });
    }
});
exports.getEmployeeById = getEmployeeById;
const updateEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const data = req.body;
        const { addresses, emergencyContacts, qualifications, departmentId, branchId, roleId } = data, employeeFields = __rest(data, ["addresses", "emergencyContacts", "qualifications", "departmentId", "branchId", "roleId"]);
        const updatedEmployee = yield prisma.employee.update({
            where: { id: Number(id) },
            data: Object.assign(Object.assign({}, employeeFields), { Department: { connect: { id: departmentId } }, Branch: { connect: { id: branchId } }, role: { connect: { id: roleId } }, Address: {
                    deleteMany: {},
                    create: addresses === null || addresses === void 0 ? void 0 : addresses.map((a) => ({
                        type: a.type,
                        line1: a.line1,
                        line2: a.line2,
                        city: a.city,
                        state: a.state,
                        zipCode: a.zipCode,
                        country: a.country
                    }))
                }, emergencyContacts: {
                    deleteMany: {},
                    create: emergencyContacts === null || emergencyContacts === void 0 ? void 0 : emergencyContacts.map((c) => ({
                        name: c.name,
                        phone: c.phone,
                        relationship: c.relationship
                    }))
                }, qualifications: {
                    deleteMany: {},
                    create: qualifications === null || qualifications === void 0 ? void 0 : qualifications.map((q) => ({
                        degree: q.degree,
                        institution: q.institution,
                        year: q.year
                    }))
                } }),
            include: {
                Address: true,
                emergencyContacts: true,
                qualifications: true
            }
        });
        res.json(updatedEmployee);
    }
    catch (error) {
        console.error(error); // <-- log actual error
        res.status(500).json({ error: "Failed to update employee" });
    }
});
exports.updateEmployee = updateEmployee;
// DELETE employee
const deleteEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield prisma.employee.delete({
            where: { id: Number(id) }
        });
        res.json({ message: "Employee deleted successfully" });
    }
    catch (error) {
        res.status(500).json({ error: "Failed to delete employee" });
    }
});
exports.deleteEmployee = deleteEmployee;
function sanitizeFileName(fileName) {
    return fileName.replace(/\s+/g, '_'); // replace spaces with underscore
}
function uploadToFTP(localFilePath, remoteFileName) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = false;
        try {
            yield client.access(FTP_CONFIG);
            yield client.ensureDir("/documents"); // Change folder for HR docs
            console.log(remoteFileName);
            yield client.uploadFrom(localFilePath, remoteFileName);
            yield client.close();
            // return `https://hrproindia.in/documents/${remoteFileName}`; // public URL
        }
        catch (error) {
            console.error("FTP Upload Error:", error);
            throw new Error("FTP upload failed");
        }
    });
}
// API Handler
const uploadEmployeeDocuments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId } = req.params;
        const form = (0, formidable_1.default)({
            uploadDir: TEMP_FOLDER,
            keepExtensions: true,
            multiples: true,
        });
        console.log(form);
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            if (err) {
                console.error("Formidable Parse Error:", err);
                return res.status(500).json({ error: err.message });
            }
            const metadata = JSON.parse(((_a = fields.metadata) === null || _a === void 0 ? void 0 : _a[0]) || "[]"); // metadata array
            if (!files.file) {
                return res.status(400).json({ error: "No files uploaded" });
            }
            const uploadedFiles = Array.isArray(files.file) ? files.file : [files.file];
            console.log(uploadedFiles);
            const uploadedDocs = [];
            for (let i = 0; i < uploadedFiles.length; i++) {
                const file = uploadedFiles[i];
                const tempFilePath = file.filepath;
                const fileName = sanitizeFileName(file.originalFilename || `file_${Date.now()}.png`);
                const remoteFilePath = `/public_html/documents/${fileName}`;
                yield uploadToFTP(tempFilePath, remoteFilePath);
                const fileUrl = `https://hrproindia.in/documents/${fileName}`;
                console.log(fileUrl);
                fs_1.default.unlinkSync(tempFilePath); // cleanup temp file
                // Save in DB
                const savedDoc = yield prisma.document.create({
                    data: {
                        employeeId: Number(employeeId),
                        title: metadata[i].title || metadata[i].type,
                        type: metadata[i].type,
                        category: metadata[i].category,
                        issueDate: metadata[i].issueDate ? new Date(metadata[i].issueDate) : null,
                        expiryDate: metadata[i].expiryDate ? new Date(metadata[i].expiryDate) : null,
                        fileUrl: fileUrl
                    }
                });
                uploadedDocs.push(savedDoc);
            }
            res.status(201).json({ message: "Documents uploaded successfully", documents: uploadedDocs });
        }));
    }
    catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ error: error.message });
    }
});
exports.uploadEmployeeDocuments = uploadEmployeeDocuments;
const getSpecificRoles = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const roleIds = [1, 3, 4]; // roles to filter
        const employees = yield prisma.employee.findMany({
            where: {
                roleId: {
                    in: roleIds
                }
            },
            select: {
                id: true,
                firstName: true,
                lastName: true
            }
        });
        if (!employees.length) {
            return res.status(404).json({ message: "No employees found with specified roles" });
        }
        return res.status(200).json(employees);
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to fetch employees" });
    }
});
exports.getSpecificRoles = getSpecificRoles;
const getActiveEmployees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employees = yield prisma.employee.findMany({
            where: {
                employmentStatus: 'ACTIVE'
            },
            select: { id: true, firstName: true, lastName: true, branchId: true, departmentId: true }
        });
        res.json(employees);
    }
    catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Failed to fetch employees' });
    }
});
exports.getActiveEmployees = getActiveEmployees;
