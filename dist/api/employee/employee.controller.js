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
exports.getEmployeesByDepartments = exports.uploadVaccineProof = exports.getEmployeeRequests = exports.getActiveEmployees = exports.getSpecificRoles = exports.uploadEmployeeDisabilityProof = exports.uploadEmployeePhoto = exports.uploadEmployeeDocuments = exports.deleteEmployee = exports.updateEmployee = exports.getEmployeeById = exports.getEmployees = exports.createEmployee = void 0;
exports.getAccruals = getAccruals;
exports.getEmployeeAccrualsController = getEmployeeAccrualsController;
exports.getTodayCelebrants = getTodayCelebrants;
exports.listMentors = listMentors;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const formidable_1 = __importDefault(require("formidable"));
const fs_1 = __importDefault(require("fs"));
const basic_ftp_1 = require("basic-ftp");
const path_1 = __importDefault(require("path"));
const client_2 = require("@prisma/client");
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
function generateEmployeeCode() {
    return __awaiter(this, void 0, void 0, function* () {
        const lastEmployee = yield prisma.employee.findFirst({
            orderBy: { employeeCode: 'desc' },
            select: { employeeCode: true }
        });
        let newCode = 'EMP001';
        if (lastEmployee === null || lastEmployee === void 0 ? void 0 : lastEmployee.employeeCode) {
            const lastNumber = parseInt(lastEmployee.employeeCode.replace(/\D/g, ''), 10);
            newCode = `EMP${String(lastNumber + 1).padStart(3, '0')}`;
        }
        return newCode;
    });
}
// CREATE Employee (with emergency contacts & qualifications)
const createEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { employeeCode, referenceCode, firstName, lastName, gender, dob, photoUrl, phone, email, designation, departmentId, branchId, dateOfJoining, employmentType, probationEndDate, employmentStatus, emergencyContacts, qualifications, addresses, roleId, bloodGroup, reportingManager, age, shiftMode, // 'FIXED' | 'ROTATIONAL' (optional)
        fixedShiftId, // optional
        rotationPatternId, // optional
        rotationStartDate, // optional
        employeeType, sameAsPermanent } = req.body;
        const data = req.body;
        let finalCode = employeeCode;
        console.log(finalCode);
        if (!finalCode) {
            finalCode = yield generateEmployeeCode();
            console.log("Generated employeeCode:", finalCode);
        }
        let newEmployee;
        try {
            newEmployee = yield prisma.employee.create({
                data: {
                    employeeCode: finalCode,
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
                    age,
                    reportingManager,
                    employeeType,
                    sameAsPermanent,
                    // Health & Wellness fields
                    preEmploymentCheckDate: data.preEmploymentCheckDate ? new Date(data.preEmploymentCheckDate) : null,
                    height: data.height ? parseFloat(data.height) : null,
                    weight: data.weight ? parseFloat(data.weight) : null,
                    bmi: data.bmi ? parseFloat(data.bmi) : null,
                    bloodPressure: data.bloodPressure,
                    bloodSugar: data.bloodSugar,
                    cholesterol: data.cholesterol,
                    allergies: data.allergies,
                    chronicConditions: data.chronicConditions,
                    smoking: data.smoking,
                    alcohol: data.alcohol,
                    visionType: data.visionType, // e.g., 'NEAR', 'DISTANT', 'COLOR_BLIND'
                    usesGlasses: data.usesGlasses,
                    visionRemarks: data.visionRemarks,
                    hasDisability: data.hasDisability,
                    disabilityType: data.disabilityType, // e.g., 'PHYSICAL', 'HEARING', 'MENTAL', etc.
                    disabilityDescription: data.disabilityDescription,
                    disabilityProofFile: data.disabilityProofFile, // original file name
                    disabilityProofFileName: data.disabilityProofFileName, // sanitized file name on server
                    disabilityProofUrl: data.disabilityProofUrl, // URL to access the file
                    preferredHospital: data.preferredHospital,
                    primaryPhysician: data.primaryPhysician,
                    emergencyNotes: data.emergencyNotes,
                    healthIssues: data.healthIssues ? JSON.stringify(data.healthIssues) : undefined,
                    vaccinations: data.vaccinations ? JSON.stringify(data.vaccinations) : undefined,
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
                            year: q.year,
                            grade: q.grade,
                            degreeName: q.degreeName,
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
        }
        catch (err) {
            if (err.code === 'P2002' && ((_b = (_a = err.meta) === null || _a === void 0 ? void 0 : _a.target) === null || _b === void 0 ? void 0 : _b.includes('employeeCode'))) {
                // Regenerate a fresh code and retry
                finalCode = yield generateEmployeeCode();
                newEmployee = yield prisma.employee.create({
                    data: {
                        employeeCode: finalCode,
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
                        age,
                        reportingManager,
                        employeeType,
                        sameAsPermanent,
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
            }
            else {
                throw err;
            }
        }
        // NEW: persist shift assignment mode
        if (shiftMode === 'FIXED' && fixedShiftId) {
            yield prisma.employeeShiftSetting.create({
                data: {
                    employeeId: newEmployee.id,
                    mode: 'FIXED',
                    fixedShiftId,
                    startDate: new Date()
                }
            });
        }
        else if (shiftMode === 'ROTATIONAL' && rotationPatternId) {
            yield prisma.employeeShiftSetting.create({
                data: {
                    employeeId: newEmployee.id,
                    mode: 'ROTATIONAL',
                    rotationPatternId,
                    startDate: rotationStartDate ? new Date(rotationStartDate) : new Date()
                }
            });
            // (Optional) generate daily ShiftAssignment rows for the next N days here.
        }
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
                Department: true,
                EmployeeShiftSetting: true,
                shifts: {
                    orderBy: { date: 'desc' }, // Most recent first
                    take: 1, // Only 1 record
                    include: {
                        shift: true // Include shift template details (name, timings)
                    }
                }
            }
        });
        const formatted = employees.map(emp => {
            var _a;
            return (Object.assign(Object.assign({}, emp), { latestShiftAssignment: emp.shifts[0] || null, departmentName: ((_a = emp.Department) === null || _a === void 0 ? void 0 : _a.name) || null }));
        });
        res.json(formatted);
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch employees" });
    }
});
exports.getEmployees = getEmployees;
// GET single employee by ID
const getEmployeeById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const employee = yield prisma.employee.findUnique({
            where: { id: Number(id) },
            include: {
                emergencyContacts: true,
                qualifications: true,
                documents: true,
                Address: true,
                EmployeeShiftSetting: true,
                Department: true,
                shifts: {
                    orderBy: { date: 'desc' }, // Most recent first
                    take: 1, // Only 1 record
                    include: {
                        shift: true // Include shift template details
                    }
                }
            }
        });
        if (!employee) {
            return res.status(404).json({ error: "Employee not found" });
        }
        // Attach the latest shift assignment
        const formatted = Object.assign(Object.assign({}, employee), { latestShiftAssignment: employee.shifts[0] || null, departmentName: ((_a = employee.Department) === null || _a === void 0 ? void 0 : _a.name) || null });
        res.json(formatted);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch employee" });
    }
});
exports.getEmployeeById = getEmployeeById;
const updateEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { id } = req.params;
        const data = req.body;
        const { addresses, emergencyContacts, qualifications, departmentId, branchId, roleId, shiftMode, // 'FIXED' | 'ROTATIONAL' | undefined
        fixedShiftId, // number | undefined
        rotationPatternId, // number | undefined
        rotationStartDate, // ISO string | undefined
        dob, dateOfJoining, probationEndDate } = data, employeeFields = __rest(data, ["addresses", "emergencyContacts", "qualifications", "departmentId", "branchId", "roleId", "shiftMode", "fixedShiftId", "rotationPatternId", "rotationStartDate", "dob", "dateOfJoining", "probationEndDate"]);
        const toDate = (v) => (v ? new Date(v) : null);
        employeeFields.dob = (_a = toDate(dob)) !== null && _a !== void 0 ? _a : undefined;
        employeeFields.dateOfJoining = (_b = toDate(dateOfJoining)) !== null && _b !== void 0 ? _b : undefined;
        employeeFields.probationEndDate = toDate(probationEndDate);
        const updatedEmployee = yield prisma.employee.update({
            where: { id: Number(id) },
            data: Object.assign(Object.assign({}, employeeFields), { 
                // Health & Wellness fields
                preEmploymentCheckDate: data.preEmploymentCheckDate ? new Date(data.preEmploymentCheckDate) : null, height: data.height ? parseFloat(data.height) : null, weight: data.weight ? parseFloat(data.weight) : null, bmi: data.bmi ? parseFloat(data.bmi) : null, bloodPressure: data.bloodPressure, bloodSugar: data.bloodSugar, cholesterol: data.cholesterol, sameAsPermanent: data.sameAsPermanent, allergies: data.allergies, chronicConditions: data.chronicConditions, smoking: data.smoking, alcohol: data.alcohol, visionType: data.visionType, usesGlasses: data.usesGlasses, visionRemarks: data.visionRemarks, hasDisability: data.hasDisability, disabilityType: data.disabilityType, disabilityDescription: data.disabilityDescription, disabilityProofFile: data.disabilityProofFile, disabilityProofFileName: data.disabilityProofFileName, disabilityProofUrl: data.disabilityProofUrl, preferredHospital: data.preferredHospital, primaryPhysician: data.primaryPhysician, emergencyNotes: data.emergencyNotes, healthIssues: data.healthIssues ? JSON.stringify(data.healthIssues) : undefined, vaccinations: data.vaccinations ? JSON.stringify(data.vaccinations) : undefined, Department: { connect: { id: departmentId } }, Branch: { connect: { id: branchId } }, role: { connect: { id: roleId } }, Address: {
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
                qualifications: true,
                EmployeeShiftSetting: true,
            }
        });
        // 2) upsert EmployeeShiftSetting (simple & type-safe)
        // map 'FIXED' | 'ROTATIONAL' -> Prisma enum
        const mode = shiftMode === 'FIXED'
            ? client_2.$Enums.ShiftAssignMode.FIXED
            : shiftMode === 'ROTATIONAL'
                ? client_2.$Enums.ShiftAssignMode.ROTATIONAL
                : undefined;
        if (mode) {
            const fixedId = fixedShiftId !== undefined && fixedShiftId !== null && fixedShiftId !== ''
                ? Number(fixedShiftId)
                : null;
            const rotId = rotationPatternId !== undefined && rotationPatternId !== null && rotationPatternId !== ''
                ? Number(rotationPatternId)
                : null;
            const start = rotationStartDate ? new Date(rotationStartDate) : new Date();
            yield prisma.employeeShiftSetting.upsert({
                where: { employeeId: updatedEmployee.id }, // unique on employeeId
                create: {
                    employeeId: updatedEmployee.id,
                    mode,
                    fixedShiftId: mode === client_2.$Enums.ShiftAssignMode.FIXED ? fixedId : null,
                    rotationPatternId: mode === client_2.$Enums.ShiftAssignMode.ROTATIONAL ? rotId : null,
                    startDate: start,
                },
                update: {
                    mode,
                    fixedShiftId: mode === client_2.$Enums.ShiftAssignMode.FIXED ? fixedId : null,
                    rotationPatternId: mode === client_2.$Enums.ShiftAssignMode.ROTATIONAL ? rotId : null,
                    startDate: start,
                },
            });
        }
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
            const folder = path_1.default.dirname(remoteFileName);
            yield client.ensureDir(folder);
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
const uploadEmployeePhoto = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId } = req.params;
        const form = (0, formidable_1.default)({
            uploadDir: TEMP_FOLDER,
            keepExtensions: true,
            multiples: false, // only one file
        });
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            if (err) {
                console.error("Formidable Parse Error:", err);
                return res.status(500).json({ error: err.message });
            }
            if (!files.file) {
                return res.status(400).json({ error: "No photo uploaded" });
            }
            const file = Array.isArray(files.file) ? files.file[0] : files.file;
            const tempFilePath = file.filepath;
            const fileName = sanitizeFileName(file.originalFilename || `photo_${employeeId}_${Date.now()}.png`);
            const remoteFilePath = `/public_html/photos/${fileName}`;
            yield uploadToFTP(tempFilePath, remoteFilePath);
            const fileUrl = `https://hrproindia.in/photos/${fileName}`;
            fs_1.default.unlinkSync(tempFilePath); // cleanup temp file
            // Update employee record with new photoUrl
            const updatedEmployee = yield prisma.employee.update({
                where: { id: Number(employeeId) },
                data: { photoUrl: fileUrl },
            });
            return res.status(200).json({ photoUrl: fileUrl, employee: updatedEmployee });
        }));
    }
    catch (error) {
        console.error("Upload Photo Error:", error);
        return res.status(500).json({ error: "Failed to upload profile photo" });
    }
});
exports.uploadEmployeePhoto = uploadEmployeePhoto;
const uploadEmployeeDisabilityProof = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId } = req.params;
        if (!employeeId) {
            return res.status(400).json({ error: "Employee code is required" });
        }
        const form = (0, formidable_1.default)({
            uploadDir: TEMP_FOLDER,
            keepExtensions: true,
            multiples: false, // only one disability certificate
        });
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            if (err) {
                console.error("Formidable Parse Error:", err);
                return res.status(500).json({ error: err.message });
            }
            if (!files.file) {
                return res.status(400).json({ error: "No disability proof file uploaded" });
            }
            const file = Array.isArray(files.file) ? files.file[0] : files.file;
            const tempFilePath = file.filepath;
            const fileName = sanitizeFileName(file.originalFilename || `disability_${employeeId}_${Date.now()}${path_1.default.extname(file.filepath)}`);
            const remoteFilePath = `/public_html/disability/${fileName}`;
            yield uploadToFTP(tempFilePath, remoteFilePath);
            const fileUrl = `https://hrproindia.in/disability/${fileName}`;
            // cleanup local temp file
            fs_1.default.unlinkSync(tempFilePath);
            // Update employee record
            const updatedEmployee = yield prisma.employee.update({
                where: { id: Number(employeeId) },
                data: { disabilityProofUrl: fileUrl },
            });
            return res.status(200).json({
                success: true,
                message: "Disability certificate uploaded successfully",
                fileUrl,
                employee: updatedEmployee,
            });
        }));
    }
    catch (error) {
        console.error("Upload Disability Proof Error:", error);
        return res.status(500).json({ error: "Failed to upload disability certificate" });
    }
});
exports.uploadEmployeeDisabilityProof = uploadEmployeeDisabilityProof;
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
                lastName: true,
                employeeCode: true,
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
            select: { id: true, firstName: true, lastName: true, branchId: true, departmentId: true, employeeCode: true }
        });
        res.json(employees);
    }
    catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Failed to fetch employees' });
    }
});
exports.getActiveEmployees = getActiveEmployees;
function getAccruals(employeeId_1) {
    return __awaiter(this, arguments, void 0, function* (employeeId, asOf = new Date()) {
        // 1) employee & policy
        const employee = yield prisma.employee.findUnique({
            where: { id: employeeId },
            select: { dateOfJoining: true },
        });
        if (!employee)
            throw new Error('Employee not found');
        const year = asOf.getFullYear();
        const policy = yield prisma.entitlementPolicy.findFirst({
            where: { year },
            select: { leaveEntitlement: true, wfhEntitlement: true, permissionEntitlement: true },
        });
        if (!policy)
            throw new Error(`EntitlementPolicy not found for ${year}`);
        // 2) date window (local-friendly, clamp to year)
        const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
        const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
        const startAccrual = new Date(Math.max(yearStart.getTime(), new Date(employee.dateOfJoining).setUTCHours(0, 0, 0, 0)));
        const endAccrual = new Date(Math.min(asOf.getTime(), yearEnd.getTime()));
        // 3) prorate months (to mid-month precision)
        const monthsProrated = proratedMonths(startAccrual, endAccrual); // e.g., 6.45
        const leaveAccrued = round(policy.leaveEntitlement / 12 * monthsProrated, 2);
        const wfhAccrued = round(policy.wfhEntitlement / 12 * monthsProrated, 2);
        const permissionAccrued = round(policy.permissionEntitlement / 12 * monthsProrated, 2); // hours
        // 4) usage (only APPROVED within year)
        const [leaves, wfhs, perms] = yield Promise.all([
            prisma.leaveRequest.findMany({
                where: {
                    employeeId,
                    status: 'APPROVED',
                    // overlap with year
                    AND: [
                        { endDate: { gte: yearStart } },
                        { startDate: { lte: yearEnd } },
                    ],
                },
                select: { startDate: true, endDate: true },
            }),
            prisma.wFHRequest.findMany({
                where: {
                    employeeId,
                    status: 'APPROVED',
                    AND: [
                        { endDate: { gte: yearStart } },
                        { startDate: { lte: yearEnd } },
                    ],
                },
                select: { startDate: true, endDate: true },
            }),
            prisma.permissionRequest.findMany({
                where: {
                    employeeId,
                    status: 'APPROVED',
                    AND: [
                        { day: { gte: yearStart, lte: yearEnd } },
                    ],
                },
                select: { startTime: true, endTime: true, timing: true },
            }),
        ]);
        const leaveDaysUsed = leaves.reduce((sum, r) => sum + daysInclusive(clampRangeToYear(r.startDate, r.endDate, yearStart, yearEnd)), 0);
        const wfhDaysUsed = wfhs.reduce((sum, r) => sum + daysInclusive(clampRangeToYear(r.startDate, r.endDate, yearStart, yearEnd)), 0);
        const permissionHoursUsed = perms.reduce((sum, r) => sum + permissionHours(r.startTime, r.endTime, r.timing), 0);
        // 5) rows
        const rows = [
            row('Leave', policy.leaveEntitlement, leaveAccrued, leaveDaysUsed),
            row('WFH', policy.wfhEntitlement, wfhAccrued, wfhDaysUsed),
            row('Permission', policy.permissionEntitlement, permissionAccrued, permissionHoursUsed),
        ];
        return rows;
    });
}
/* ---------- helpers ---------- */
function proratedMonths(from, to) {
    if (to < from)
        return 0;
    const yf = from.getUTCFullYear(), yt = to.getUTCFullYear();
    const mf = from.getUTCMonth(), mt = to.getUTCMonth();
    const df = from.getUTCDate(), dt = to.getUTCDate();
    let months = (yt - yf) * 12 + (mt - mf);
    if (dt >= df) {
        // add fractional month
        const daysInMonth = new Date(to.getUTCFullYear(), to.getUTCMonth() + 1, 0).getUTCDate();
        months += (dt - df + 1) / daysInMonth;
    }
    else {
        // go back one month and add fraction
        months -= 1;
        const anchor = new Date(to.getUTCFullYear(), to.getUTCMonth(), 0).getUTCDate(); // prev month length
        months += (anchor - df + 1 + dt) / anchor;
    }
    return Math.max(0, months);
}
function clampRangeToYear(start, end, yearStart, yearEnd) {
    const s = new Date(Math.max(start.getTime(), yearStart.getTime()));
    const e = new Date(Math.min(end.getTime(), yearEnd.getTime()));
    if (e < s)
        return { s, e: s }; // zero
    return { s, e };
}
function daysInclusive(range) {
    const s = new Date(range.s);
    s.setUTCHours(0, 0, 0, 0);
    const e = new Date(range.e);
    e.setUTCHours(0, 0, 0, 0);
    return Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
}
function permissionHours(start, end, timing) {
    if (start && end) {
        const ms = new Date(end).getTime() - new Date(start).getTime();
        return Math.max(0, ms / 36e5);
    }
    if (!timing)
        return 0;
    switch (timing) {
        case 'FULLDAY': return 8;
        case 'HALFDAY': return 4;
        case 'HOURLY': return 1;
        default: return 0;
    }
}
function row(category, entitlement, accruedToDate, used) {
    const balance = round(Math.max(0, Math.min(accruedToDate, entitlement) - used), 2);
    return { category, entitlement, accruedToDate: round(Math.min(accruedToDate, entitlement), 2), used: round(used, 2), balance };
}
function round(n, p = 2) { return Math.round(n * 10 ** p) / 10 ** p; }
function getEmployeeAccrualsController(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            if (Number.isNaN(id)) {
                return res.status(400).json({ error: 'Invalid employee id' });
            }
            const data = yield getAccruals(id);
            return res.json(data);
        }
        catch (e) {
            console.error('getEmployeeAccrualsController error:', e);
            return res.status(500).json({ error: (e === null || e === void 0 ? void 0 : e.message) || 'Internal Server Error' });
        }
    });
}
const getEmployeeRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        if (!employeeId)
            return res.status(400).json({ error: "employeeId must be a number" });
        const [leaves, permissions, wfh] = yield Promise.all([
            prisma.leaveRequest.findMany({
                where: { employeeId }, orderBy: { createdAt: "desc" }, include: {
                    leaveType: {
                        select: { name: true }
                    }
                }
            }),
            prisma.permissionRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } }),
            prisma.wFHRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } })
        ]);
        res.json({ leaves, permissions, wfh });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch requests" });
    }
});
exports.getEmployeeRequests = getEmployeeRequests;
function todayInIST() {
    // Make a Date that represents "now" in IST (Asia/Kolkata)
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}
function getTodayCelebrants(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const nowIST = todayInIST();
            const mm = nowIST.getMonth(); // 0..11
            const dd = nowIST.getDate(); // 1..31
            // Pull only what we need
            const employees = yield prisma.employee.findMany({
                where: { employmentStatus: "ACTIVE" },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    dob: true,
                    dateOfJoining: true,
                    Department: { select: { name: true } },
                },
            });
            const birthdays = [];
            const anniversaries = [];
            for (const e of employees) {
                const name = [e.firstName, e.lastName].filter(Boolean).join(" ");
                const dept = (_b = (_a = e.Department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "";
                // Birthday (month/day match in IST)
                if (e.dob) {
                    const dob = new Date(e.dob);
                    if (dob.getMonth() === mm && dob.getDate() === dd) {
                        birthdays.push({ employeeId: e.id, employeeName: name, departmentName: dept });
                    }
                }
                // Work anniversary (join date month/day match in IST)
                // Work anniversary (join date month/day match in IST)
                if (e.dateOfJoining) {
                    const doj = new Date(e.dateOfJoining);
                    if (doj.getMonth() === mm && doj.getDate() === dd) {
                        const years = nowIST.getFullYear() - doj.getFullYear();
                        if (years >= 1) { // ✅ only after completing 1 year
                            anniversaries.push({
                                employeeId: e.id,
                                employeeName: name,
                                departmentName: dept,
                                years
                            });
                        }
                    }
                }
            }
            return res.json({ birthdays, anniversaries });
        }
        catch (err) {
            console.error("celebrants/today failed:", err);
            return res.status(500).json({ error: "Failed to fetch today's celebrants" });
        }
    });
}
function listMentors(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const departmentId = Number(req.query.departmentId);
            const q = req.query.q || '';
            if (!departmentId) {
                return res.status(400).json({ error: 'departmentId is required' });
            }
            const rows = yield prisma.employee.findMany({
                where: Object.assign({ employmentStatus: 'ACTIVE', departmentId }, (q ? {
                    OR: [
                        { firstName: { contains: q } },
                        { lastName: { contains: q } },
                        { employeeCode: { contains: q } },
                    ],
                } : {})),
                select: { id: true, firstName: true, lastName: true, employeeCode: true },
                orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
                take: 200,
            });
            res.json(rows);
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Failed to load mentors' });
        }
    });
}
const uploadVaccineProof = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { employeeId, vaccineIndex } = req.params;
        const form = (0, formidable_1.default)({
            uploadDir: TEMP_FOLDER,
            keepExtensions: true,
            multiples: false,
        });
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            console.log("FILES:", files);
            // Dynamically pick first key
            const fileKey = Object.keys(files)[0];
            if (!fileKey) {
                return res.status(400).json({ error: "No file uploaded" });
            }
            const uploaded = files[fileKey];
            if (!uploaded) {
                return res.status(400).json({ error: "File not found in request" });
            }
            const file = Array.isArray(uploaded) ? uploaded[0] : uploaded;
            if (!file) {
                return res.status(400).json({ error: "Invalid file upload" });
            }
            // Now TS knows "file" is defined ✅
            const tempFilePath = file.filepath;
            const fileName = sanitizeFileName(file.originalFilename || `vaccine_${employeeId}_${Date.now()}.pdf`);
            const remoteFilePath = `/public_html/vaccine-proofs/${fileName}`;
            yield uploadToFTP(tempFilePath, remoteFilePath);
            const fileUrl = `https://hrproindia.in/vaccine-proofs/${fileName}`;
            fs_1.default.unlinkSync(tempFilePath);
            // update vaccinations JSON
            const employee = yield prisma.employee.findUnique({ where: { id: Number(employeeId) } });
            let vaccinations = (employee === null || employee === void 0 ? void 0 : employee.vaccinations) ? JSON.parse(employee.vaccinations) : [];
            if (vaccinations[vaccineIndex]) {
                vaccinations[vaccineIndex].proofUrl = fileUrl;
            }
            const updated = yield prisma.employee.update({
                where: { id: Number(employeeId) },
                data: { vaccinations: JSON.stringify(vaccinations) },
            });
            console.log(updated);
            return res.status(200).json({ fileUrl, employee: updated });
        }));
    }
    catch (error) {
        console.error("Upload Vaccine Proof Error:", error);
        return res.status(500).json({ error: "Failed to upload vaccine proof" });
    }
});
exports.uploadVaccineProof = uploadVaccineProof;
/**
 * Get employees by multiple department IDs
 * Example: GET /api/employees/by-departments?ids=1,2,3
 */
const getEmployeesByDepartments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { ids } = req.query;
        if (!ids) {
            return res.status(400).json({ error: "Department IDs are required (use ?ids=1,2,3)" });
        }
        const idsArray = ids
            .split(",")
            .map((id) => Number(id.trim()))
            .filter((id) => !isNaN(id));
        if (!idsArray.length) {
            return res.status(400).json({ error: "Invalid department IDs" });
        }
        const employees = yield prisma.employee.findMany({
            where: {
                departmentId: { in: idsArray },
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                departmentId: true,
                Department: { select: { name: true } },
            },
            orderBy: { firstName: "asc" },
        });
        res.json(employees);
    }
    catch (error) {
        console.error("❌ Failed to fetch employees by departments:", error);
        res.status(500).json({ error: "Failed to fetch employees by departments" });
    }
});
exports.getEmployeesByDepartments = getEmployeesByDepartments;
