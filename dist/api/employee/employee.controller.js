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
exports.queryAuditLog = exports.getEmployeeAuditLog = exports.getProbationHistory = exports.terminateProbation = exports.confirmProbation = exports.extendProbation = exports.bulkUploadLeaveBalance = exports.bulkUpdateEmployeeExtras = exports.getEmployeesByManager = exports.initSabbaticalReminderScheduler = exports.terminateFromSabbatical = exports.endSabbatical = exports.extendSabbatical = exports.startSabbatical = exports.getEmployeeProfile = exports.updateEmployeeProfile = exports.deleteEmployeeDocument = exports.getInchargeEmployees = exports.bulkUpdateReportingManager = exports.getBulkUploadProgress = exports.bulkUploadEmployees = exports.downloadEmployeeTemplate = exports.getUnreportedAbsentees = exports.sendHealthCheckReminders = exports.getEmployeesByDepartments = exports.uploadVaccineProof = exports.getEmployeeRequests = exports.getActiveEmployees = exports.getEmployeesByRole = exports.getSpecificRoles = exports.uploadEmployeeDisabilityProof = exports.uploadEmployeePhoto = exports.uploadEmployeeDocuments = exports.deleteEmployee = exports.updateEmployee = exports.getEmployeeById = exports.getEmployees = exports.createEmployee = void 0;
exports.getAccruals = getAccruals;
exports.getEmployeeAccrualsController = getEmployeeAccrualsController;
exports.getTodayCelebrants = getTodayCelebrants;
exports.listMentors = listMentors;
exports.mapExcelRowToEmployee = mapExcelRowToEmployee;
exports.deleteFromFTP = deleteFromFTP;
const client_1 = require("@prisma/client");
const employeeAccess_1 = require("../../lib/employeeAccess");
const employeeAudit_1 = require("../../lib/employeeAudit");
const prisma = new client_1.PrismaClient();
const formidable_1 = __importDefault(require("formidable"));
const fs_1 = __importDefault(require("fs"));
const basic_ftp_1 = require("basic-ftp");
const path_1 = __importDefault(require("path"));
const client_2 = require("@prisma/client");
const notifications_controller_1 = require("../notifications/notifications.controller");
const xlsx_1 = __importDefault(require("xlsx"));
const node_cron_1 = __importDefault(require("node-cron"));
const directory_1 = require("../../lib/directory");
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
// async function generateEmployeeCode() {
//   const prefix = process.env.EMPLOYEE_CODE_PREFIX || 'EMP';
//   const startNumber = process.env.EMPLOYEE_CODE_START || '001';
//   const lastEmployee = await prisma.employee.findFirst({
//     orderBy: { employeeCode: 'desc' },
//     select: { employeeCode: true }
//   });
//   console.log(lastEmployee)
//   let newCode = `${prefix}${startNumber}`;
//   if (lastEmployee?.employeeCode) {
//     const lastNumber = parseInt(lastEmployee.employeeCode.replace(/\D/g, ''), 10);
//     console.log(lastNumber)
//     newCode = `${prefix}${String(lastNumber + 1).padStart(3, '0')}`;
//   }
//   return newCode;
// }
const EMPLOYEE_PREFIX_MAP = {
    PERMANENT: '',
    CONTRACT: '',
    INTERN: 'TR',
    TRAINEE: 'TR',
    PROBATION: '',
    DOCTOR: 'DR'
};
// async function generateEmployeeCode(employmentType: string) {
//   const prefix =
//     EMPLOYEE_PREFIX_MAP[employmentType?.toUpperCase()] || 'EMP';
//   const startNumber = process.env.EMPLOYEE_CODE_START || '001';
//   // Get last employee with same prefix
//   const lastEmployee = await prisma.employee.findFirst({
//     where: {
//       employeeCode: {
//         startsWith: prefix
//       }
//     },
//     orderBy: {
//       employeeCode: 'desc'
//     },
//     select: {
//       employeeCode: true
//     }
//   });
//   let newCode = `${prefix}${startNumber}`;
//   if (lastEmployee?.employeeCode) {
//     const lastNumber = parseInt(
//       lastEmployee.employeeCode.replace(/\D/g, ''),
//       10
//     );
//     newCode = `${prefix}${String(lastNumber + 1).padStart(3, '0')}`;
//   }
//   return newCode;
// }
function generateEmployeeCode(employmentType) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const basePrefix = process.env.EMPLOYEE_CODE_PREFIX || 'EMP';
        const suffix = (_a = EMPLOYEE_PREFIX_MAP[employmentType === null || employmentType === void 0 ? void 0 : employmentType.toUpperCase()]) !== null && _a !== void 0 ? _a : '';
        const prefix = `${basePrefix}${suffix}`;
        const startNumber = process.env.EMPLOYEE_CODE_START || '001';
        const lastEmployee = yield prisma.employee.findFirst({
            where: {
                employeeCode: {
                    startsWith: prefix
                }
            },
            orderBy: {
                employeeCode: 'desc'
            },
            select: {
                employeeCode: true
            }
        });
        console.log(lastEmployee);
        let newCode = `${prefix}${startNumber}`;
        if (lastEmployee === null || lastEmployee === void 0 ? void 0 : lastEmployee.employeeCode) {
            const lastNumber = parseInt(lastEmployee.employeeCode.replace(/\D/g, ''), 10);
            newCode = `${prefix}${String(lastNumber + 1).padStart(3, '0')}`;
        }
        return newCode;
    });
}
// CREATE Employee (with emergency contacts & qualifications)
const createEmployee = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { employeeCode, referenceCode, firstName, lastName, gender, dob, photoUrl, phone, email, designation, designationId, departmentId, branchId, dateOfJoining, employmentType, probationStartDate, probationEndDate, probationStatus, probationConfirmedOn, probationConfirmedBy, probationRemarks, employmentStatus, emergencyContacts, qualifications, addresses, roleId, bloodGroup, reportingManager, age, shiftMode, // 'FIXED' | 'ROTATIONAL' (optional)
        fixedShiftId, // optional
        rotationPatternId, // optional
        rotationStartDate, // optional
        employeeType, sameAsPermanent, inchargeId, fatherName, marital, totalYearsOfExperience, experience, licenseRegDate, licenseExpiryDate, motherName, alternatePhone, uanNumber, panNumber, aadharNumber, licenseNumber, geoTrackingEnabled, overtimeEnabled, experienceType } = req.body;
        const data = req.body;
        if (reportingManager && inchargeId &&
            Number(reportingManager) === Number(inchargeId)) {
            return res.status(400).json({
                error: "Reporting Manager and Incharge cannot be the same person",
            });
        }
        let finalCode = employeeCode;
        console.log(finalCode);
        if (!finalCode) {
            finalCode = yield generateEmployeeCode(employmentType);
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
                    // designation,
                    // designationId: designationId ?? null, // ✅ THIS IS THE FIX
                    dateOfJoining: new Date(dateOfJoining),
                    employmentType,
                    probationStartDate: probationStartDate ? new Date(probationStartDate) : null,
                    probationEndDate: probationEndDate ? new Date(probationEndDate) : null,
                    probationStatus: probationStatus !== null && probationStatus !== void 0 ? probationStatus : null,
                    probationConfirmedOn: probationConfirmedOn ? new Date(probationConfirmedOn) : null,
                    probationConfirmedBy: probationConfirmedBy !== null && probationConfirmedBy !== void 0 ? probationConfirmedBy : null,
                    probationRemarks: probationRemarks !== null && probationRemarks !== void 0 ? probationRemarks : null,
                    employmentStatus,
                    bloodGroup,
                    age,
                    reportingManager,
                    fatherName,
                    marital,
                    totalYearsOfExperience,
                    experience,
                    employeeType,
                    sameAsPermanent,
                    experienceType,
                    geoTrackingEnabled: geoTrackingEnabled !== null && geoTrackingEnabled !== void 0 ? geoTrackingEnabled : false,
                    overtimeEnabled: overtimeEnabled !== null && overtimeEnabled !== void 0 ? overtimeEnabled : false,
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
                    motherName,
                    alternatePhone,
                    uanNumber,
                    panNumber,
                    aadharNumber,
                    licenseNumber,
                    licenseRegDate: licenseRegDate ? new Date(licenseRegDate) : null,
                    licenseExpiryDate: licenseExpiryDate ? new Date(licenseExpiryDate) : null,
                    healthIssues: data.healthIssues ? JSON.stringify(data.healthIssues) : undefined,
                    vaccinations: data.vaccinations ? JSON.stringify(data.vaccinations) : undefined,
                    // Connect relations
                    Department: { connect: { id: departmentId } },
                    Branch: { connect: { id: branchId } },
                    role: { connect: { id: roleId } },
                    // designation: { connect: { id: designationId } },
                    designation: designationId
                        ? { connect: { id: Number(designationId) } }
                        : undefined,
                    incharge: inchargeId
                        ? { connect: { id: Number(inchargeId) } }
                        : undefined,
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
                    designation: true,
                }
            });
        }
        catch (err) {
            if (err.code === 'P2002' && ((_b = (_a = err.meta) === null || _a === void 0 ? void 0 : _a.target) === null || _b === void 0 ? void 0 : _b.includes('employeeCode'))) {
                // Regenerate a fresh code and retry
                finalCode = yield generateEmployeeCode(employmentType);
                console.log(finalCode);
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
                        experienceType,
                        // designation,
                        // designationId: designationId ?? null, // ✅ THIS IS THE FIX
                        dateOfJoining: new Date(dateOfJoining),
                        employmentType,
                        probationStartDate: probationStartDate ? new Date(probationStartDate) : null,
                        probationEndDate: probationEndDate ? new Date(probationEndDate) : null,
                        probationStatus: probationStatus !== null && probationStatus !== void 0 ? probationStatus : null,
                        probationConfirmedOn: probationConfirmedOn ? new Date(probationConfirmedOn) : null,
                        probationConfirmedBy: probationConfirmedBy !== null && probationConfirmedBy !== void 0 ? probationConfirmedBy : null,
                        probationRemarks: probationRemarks !== null && probationRemarks !== void 0 ? probationRemarks : null,
                        employmentStatus,
                        bloodGroup,
                        age,
                        reportingManager,
                        employeeType,
                        sameAsPermanent,
                        fatherName,
                        marital,
                        totalYearsOfExperience,
                        experience,
                        geoTrackingEnabled,
                        overtimeEnabled,
                        motherName,
                        alternatePhone,
                        uanNumber,
                        panNumber,
                        aadharNumber,
                        licenseNumber,
                        licenseRegDate: data.licenseRegDate ? new Date(data.licenseRegDate) : null,
                        licenseExpiryDate: data.licenseExpiryDate ? new Date(data.licenseExpiryDate) : null,
                        // Connect relations
                        Department: { connect: { id: departmentId } },
                        Branch: { connect: { id: branchId } },
                        role: { connect: { id: roleId } },
                        designation: designationId
                            ? { connect: { id: Number(designationId) } }
                            : undefined,
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
                        designation: true
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
        // Seed first probation record when starting on probation with start+end dates
        if (employmentType === 'PROBATION' &&
            newEmployee.probationStartDate &&
            newEmployee.probationEndDate) {
            yield prisma.probationRecord.create({
                data: {
                    employeeId: newEmployee.id,
                    startDate: newEmployee.probationStartDate,
                    endDate: newEmployee.probationEndDate,
                    status: probationStatus !== null && probationStatus !== void 0 ? probationStatus : 'IN_PROGRESS',
                    remarks: probationRemarks !== null && probationRemarks !== void 0 ? probationRemarks : null,
                },
            });
            if (!probationStatus) {
                yield prisma.employee.update({
                    where: { id: newEmployee.id },
                    data: { probationStatus: 'IN_PROGRESS' },
                });
            }
        }
        // Push to central directory so the unified mobile app can resolve this phone
        (0, directory_1.syncEmployeeToDirectory)(newEmployee).catch(() => { });
        return res.status(201).json(newEmployee);
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to create employee" });
    }
});
exports.createEmployee = createEmployee;
// GET all employees
// export const getEmployees = async (req: Request, res: Response) => {
//   try {
//     const employees = await prisma.employee.findMany({
//       include: {
//         Address: true,
//         emergencyContacts: true,
//         qualifications: true,
//         documents: true,
//         Department: true,
//         EmployeeShiftSetting: true,
//         shifts: {
//           orderBy: { date: 'desc' }, // Most recent first
//           take: 1,                   // Only 1 record
//           include: {
//             shift: true              // Include shift template details (name, timings)
//           }
//         }
//       }
//     });
//     const formatted = employees.map(emp => ({
//       ...emp,
//       latestShiftAssignment: emp.shifts[0] || null,
//       departmentName: emp.Department?.name || null, // ✅ extract department name
//     }));
//     res.json(formatted);
//   } catch (error) {
//     res.status(500).json({ error: "Failed to fetch employees" });
//   }
// };
const getEmployees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const page = Number((_a = req.query.page) !== null && _a !== void 0 ? _a : 1);
        const pageSize = Math.min(Number((_b = req.query.pageSize) !== null && _b !== void 0 ? _b : 10), 50); // max = 50
        const skip = (page - 1) * pageSize;
        const where = {};
        const filter = req.query.filter;
        const search = req.query.search;
        // Generic search — when `search` is given WITHOUT a specific `filter`,
        // match across name, employee code and email. (Used by the autocomplete
        // pickers in HR Corrections, leave-apply, etc. — which only send `search`.)
        if (search && !filter) {
            where.OR = [
                { firstName: { contains: search } },
                { lastName: { contains: search } },
                { employeeCode: { contains: search } },
                { email: { contains: search } },
            ];
        }
        if (search && filter) {
            switch (filter) {
                case "name":
                    where.OR = [
                        { firstName: { contains: search } },
                        { lastName: { contains: search } }
                    ];
                    break;
                case "employeeCode":
                    where.employeeCode = { contains: search };
                    break;
                case "branch":
                    where.Branch = {
                        name: { contains: search }
                    };
                    break;
                case "department":
                    where.Department = {
                        name: { contains: search }
                    };
                    break;
                case "employmentStatus": {
                    const statuses = [
                        "ACTIVE",
                        "TERMINATED",
                        "SUSPENDED",
                        "NOTICE_PERIOD",
                        "RESIGNED"
                    ];
                    const match = statuses.filter(s => s.toLowerCase().includes(search.toLowerCase()));
                    if (match.length > 0) {
                        where.employmentStatus = { in: match };
                    }
                    else {
                        where.employmentStatus = { in: [] }; // return empty
                    }
                    break;
                }
                case "employmentType":
                    where.employmentType = { contains: search };
                    break;
                case "shift":
                    where.shifts = {
                        some: {
                            shift: {
                                name: { contains: search }
                            }
                        }
                    };
                    break;
                case 'employeeType':
                    where.employeeType = { contains: search };
                    break;
            }
        }
        // // optional filters
        // if (req.query.search) {
        //   const search = String(req.query.search);
        //   where.OR = [
        //     { firstName: { contains: search, mode: "insensitive" } },
        //     { lastName: { contains: search, mode: "insensitive" } },
        //     { employeeCode: { contains: search, mode: "insensitive" } },
        //     { email: { contains: search, mode: "insensitive" } },
        //   ];
        // }
        // if (req.query.departmentId) {
        //   where.departmentId = Number(req.query.departmentId);
        // }
        // if (req.query.branchId) {
        //   where.branchId = Number(req.query.branchId);
        // }
        const [employees, total] = yield Promise.all([
            prisma.employee.findMany({
                skip,
                take: pageSize,
                where,
                select: {
                    id: true,
                    employeeCode: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phone: true,
                    designation: true,
                    employmentType: true,
                    employmentStatus: true,
                    branchId: true,
                    departmentId: true,
                    roleId: true,
                    photoUrl: true,
                    gender: true,
                    Department: { select: { id: true, name: true } },
                    Branch: { select: { id: true, name: true } },
                    shifts: {
                        orderBy: { date: "desc" },
                        take: 1,
                        include: { shift: true },
                    },
                },
            }),
            prisma.employee.count({ where }),
        ]);
        res.json({
            data: employees,
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
        });
    }
    catch (error) {
        console.log(error);
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
                designation: true,
                sabbaticals: true,
                shifts: {
                    orderBy: { date: 'desc' }, // Most recent first
                    take: 1, // Only 1 record
                    include: {
                        shift: true // Include shift template details
                    }
                },
                probationRecords: {
                    orderBy: { createdAt: 'asc' }
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        const { id } = req.params;
        const data = req.body;
        const { addresses, emergencyContacts, qualifications, departmentId, designationId, branchId, roleId, shiftMode, // 'FIXED' | 'ROTATIONAL' | undefined
        fixedShiftId, // number | undefined
        rotationPatternId, // number | undefined
        rotationStartDate, // ISO string | undefined
        dob, dateOfJoining, probationStartDate, probationEndDate, probationConfirmedOn, inchargeId, preEmploymentCheckDate, fatherName, marital, totalYearsOfExperience, experience, experienceType } = data, employeeFields = __rest(data, ["addresses", "emergencyContacts", "qualifications", "departmentId", "designationId", "branchId", "roleId", "shiftMode", "fixedShiftId", "rotationPatternId", "rotationStartDate", "dob", "dateOfJoining", "probationStartDate", "probationEndDate", "probationConfirmedOn", "inchargeId", "preEmploymentCheckDate", "fatherName", "marital", "totalYearsOfExperience", "experience", "experienceType"]);
        if (data.reportingManager && inchargeId &&
            Number(data.reportingManager) === Number(inchargeId)) {
            return res.status(400).json({
                error: "Reporting Manager and Incharge cannot be the same person",
            });
        }
        const toDate = (v) => (v ? new Date(v) : null);
        employeeFields.dob = (_a = toDate(dob)) !== null && _a !== void 0 ? _a : undefined;
        employeeFields.dateOfJoining = (_b = toDate(dateOfJoining)) !== null && _b !== void 0 ? _b : undefined;
        employeeFields.probationStartDate = toDate(probationStartDate);
        employeeFields.probationEndDate = toDate(probationEndDate);
        employeeFields.probationConfirmedOn = toDate(probationConfirmedOn);
        // ── Capture the BEFORE state. We need the full row (scalars +
        // user-editable relations) so the audit log can record every field
        // that changed, including address / emergency contact / qualification
        // edits which live in separate tables.
        const beforeRow = yield prisma.employee.findUnique({
            where: { id: Number(id) },
            include: {
                Address: true,
                emergencyContacts: true,
                qualifications: true,
            },
        });
        const beforeStatus = beforeRow === null || beforeRow === void 0 ? void 0 : beforeRow.employmentStatus;
        const updatedEmployee = yield prisma.employee.update({
            where: { id: Number(id) },
            data: Object.assign(Object.assign({}, employeeFields), { experienceType: data.experienceType, 
                // Health & Wellness fields
                preEmploymentCheckDate: preEmploymentCheckDate ? new Date(preEmploymentCheckDate) : null, height: data.height ? parseFloat(data.height) : null, weight: data.weight ? parseFloat(data.weight) : null, bmi: data.bmi ? parseFloat(data.bmi) : null, bloodPressure: data.bloodPressure, bloodSugar: data.bloodSugar, cholesterol: data.cholesterol, sameAsPermanent: data.sameAsPermanent, fatherName: data.fatherName, marital: data.marital, totalYearsOfExperience: data.totalYearsOfExperience, experience: data.experience, allergies: data.allergies, chronicConditions: data.chronicConditions, 
                // designationId: designationId ?? null, // ✅ THIS IS THE FIX
                smoking: data.smoking, alcohol: data.alcohol, visionType: data.visionType, usesGlasses: data.usesGlasses, visionRemarks: data.visionRemarks, hasDisability: data.hasDisability, disabilityType: data.disabilityType, disabilityDescription: data.disabilityDescription, disabilityProofFile: data.disabilityProofFile, disabilityProofFileName: data.disabilityProofFileName, disabilityProofUrl: data.disabilityProofUrl, preferredHospital: data.preferredHospital, primaryPhysician: data.primaryPhysician, emergencyNotes: data.emergencyNotes, geoTrackingEnabled: data.geoTrackingEnabled, overtimeEnabled: data.overtimeEnabled, motherName: data.motherName, alternatePhone: data.alternatePhone, uanNumber: data.uanNumber, panNumber: data.panNumber, aadharNumber: data.aadharNumber, licenseNumber: data.licenseNumber, licenseRegDate: toDate(data.licenseRegDate), licenseExpiryDate: toDate(data.licenseExpiryDate), pastSurgeries: data.pastSurgeries, exerciseFrequency: data.exerciseFrequency, healthIssues: data.healthIssues ? JSON.stringify(data.healthIssues) : undefined, vaccinations: data.vaccinations ? JSON.stringify(data.vaccinations) : undefined, Department: { connect: { id: departmentId } }, Branch: { connect: { id: branchId } }, role: { connect: { id: roleId } }, designation: { connect: { id: designationId } }, incharge: inchargeId
                    ? { connect: { id: Number(inchargeId) } }
                    : { disconnect: true }, Address: {
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
                designation: true
            }
        });
        // ── Audit log: record the diff between before and after.
        // Two layers of comparison:
        //   (1) Scalar fields on the Employee row (designation, dept, role,
        //       personal info, etc.) via the shared buildEmployeeDiff helper.
        //   (2) User-editable relations (Address, emergencyContacts,
        //       qualifications) — compared as normalised JSON arrays so we
        //       can capture "Added 1 address" or "Removed an emergency contact"
        //       even though the underlying rows are deleted-and-recreated.
        try {
            const afterRow = yield prisma.employee.findUnique({
                where: { id: Number(id) },
                include: {
                    Address: true,
                    emergencyContacts: true,
                    qualifications: true,
                },
            });
            if (beforeRow && afterRow) {
                // (1) Scalar diff — strip the relation arrays first so they don't
                //     pollute the scalar comparison.
                const stripRelations = (r) => {
                    const { Address, emergencyContacts, qualifications } = r, rest = __rest(r, ["Address", "emergencyContacts", "qualifications"]);
                    return rest;
                };
                const diff = (_c = (0, employeeAudit_1.buildEmployeeDiff)(stripRelations(beforeRow), stripRelations(afterRow))) !== null && _c !== void 0 ? _c : {
                    changes: {},
                    changedFields: [],
                };
                // (2) Relation diffs — normalise (drop ids/timestamps) and JSON-compare.
                const normaliseRel = (rows, fields) => (rows !== null && rows !== void 0 ? rows : [])
                    .map((r) => {
                    var _a;
                    const out = {};
                    for (const f of fields)
                        out[f] = (_a = r[f]) !== null && _a !== void 0 ? _a : null;
                    return out;
                })
                    // Sort so the comparison is order-independent
                    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
                const compareRel = (key, fields) => {
                    const before = normaliseRel(beforeRow[key], fields);
                    const after = normaliseRel(afterRow[key], fields);
                    if (JSON.stringify(before) !== JSON.stringify(after)) {
                        diff.changes[key] = { from: before, to: after };
                        diff.changedFields.push(key);
                    }
                };
                compareRel('Address', ['type', 'line1', 'line2', 'city', 'state', 'zipCode', 'country']);
                compareRel('emergencyContacts', ['name', 'phone', 'relationship']);
                compareRel('qualifications', ['degree', 'institution', 'year']);
                if (diff.changedFields.length > 0) {
                    const ctx = (0, employeeAudit_1.auditCtxFromReq)(req, { source: 'WEB' });
                    yield prisma.employeeAuditLog.create({
                        data: {
                            employeeId: Number(id),
                            action: 'UPDATE',
                            changes: diff.changes,
                            changedFields: diff.changedFields,
                            changedBy: (_d = ctx.changedBy) !== null && _d !== void 0 ? _d : null,
                            source: (_e = ctx.source) !== null && _e !== void 0 ? _e : 'WEB',
                            ipAddress: (_f = ctx.ip) !== null && _f !== void 0 ? _f : null,
                            userAgent: (_g = ctx.userAgent) !== null && _g !== void 0 ? _g : null,
                        },
                    });
                }
            }
        }
        catch (auditErr) {
            // Audit failures must NEVER break the user flow. Log and move on.
            console.error("[updateEmployee audit] failed:", auditErr);
        }
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
        // Sync ProbationRecord whenever start+end dates are present.
        // This covers:
        //   - Legacy backfill: HR edits a PERMANENT employee and records their past probation (e.g. CONFIRMED)
        //   - First-time setup: PROBATION employee gets dates for the first time
        //   - Data-entry correction: HR fixes a date on the current IN_PROGRESS record
        // Transitions like extend / confirm / terminate still go through the dedicated action endpoints
        // so the full audit trail is produced cleanly.
        if (updatedEmployee.probationStartDate &&
            updatedEmployee.probationEndDate) {
            const allRecords = yield prisma.probationRecord.findMany({
                where: { employeeId: updatedEmployee.id },
                orderBy: { createdAt: 'desc' },
            });
            const inProgress = allRecords.find((r) => r.status === 'IN_PROGRESS');
            if (inProgress) {
                // Correction: keep the current active record in sync with the form
                yield prisma.probationRecord.update({
                    where: { id: inProgress.id },
                    data: {
                        startDate: updatedEmployee.probationStartDate,
                        endDate: updatedEmployee.probationEndDate,
                        remarks: (_h = updatedEmployee.probationRemarks) !== null && _h !== void 0 ? _h : null,
                    },
                });
            }
            else if (allRecords.length === 0) {
                // Backfill: no records yet → create the first record using the form status.
                // If status is a terminal one (CONFIRMED/TERMINATED/WAIVED/EXTENDED) we stamp decidedOn
                // so the history panel shows when the decision was taken.
                const formStatus = updatedEmployee.probationStatus || 'IN_PROGRESS';
                const isTerminal = formStatus !== 'IN_PROGRESS';
                yield prisma.probationRecord.create({
                    data: {
                        employeeId: updatedEmployee.id,
                        startDate: updatedEmployee.probationStartDate,
                        endDate: updatedEmployee.probationEndDate,
                        status: formStatus,
                        remarks: (_j = updatedEmployee.probationRemarks) !== null && _j !== void 0 ? _j : null,
                        decidedOn: isTerminal
                            ? ((_k = updatedEmployee.probationConfirmedOn) !== null && _k !== void 0 ? _k : new Date())
                            : null,
                    },
                });
                if (!updatedEmployee.probationStatus) {
                    yield prisma.employee.update({
                        where: { id: updatedEmployee.id },
                        data: { probationStatus: 'IN_PROGRESS' },
                    });
                }
            }
            // else: records exist but none are IN_PROGRESS (e.g. already CONFIRMED) →
            // form is read-only from a history standpoint. Use Extend/Confirm/Terminate buttons
            // to change state going forward.
        }
        // Push to central directory in case phone/name/code/active changed
        (0, directory_1.syncEmployeeToDirectory)(updatedEmployee).catch(() => { });
        // ── Status-transition revoke ──────────────────────────────
        // If this update flipped the employee from an active state
        // (ACTIVE / NOTICE_PERIOD) to a non-active state (TERMINATED /
        // RESIGNED / SUSPENDED / SABBATICAL), wipe their device tokens,
        // mobile sessions and stamp accessRevokedAt. Catches the gap where
        // HR uses the generic PUT /employees/:id instead of the dedicated
        // terminate / sabbatical endpoints.
        const ACTIVE = new Set(['ACTIVE', 'NOTICE_PERIOD']);
        const wasActive = ACTIVE.has(String(beforeStatus));
        const isActive = ACTIVE.has(String(updatedEmployee.employmentStatus));
        if (wasActive && !isActive) {
            try {
                yield (0, employeeAccess_1.revokeEmployeeAccess)(Number(id), `Status changed via updateEmployee: ${beforeStatus} → ${updatedEmployee.employmentStatus}`);
            }
            catch (e) {
                console.error('[updateEmployee] revokeEmployeeAccess failed:', e);
            }
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
        // Capture phone first so we can deactivate the directory entry after delete
        const employee = yield prisma.employee.findUnique({
            where: { id: Number(id) },
            select: { phone: true },
        });
        yield prisma.employee.delete({
            where: { id: Number(id) }
        });
        if (employee === null || employee === void 0 ? void 0 : employee.phone) {
            (0, directory_1.deactivateEmployeeInDirectory)(employee.phone).catch(() => { });
        }
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
// export const uploadEmployeeDocuments = async (req: Request, res: Response) => {
//   try {
//     const { employeeId } = req.params;
//     const form = formidable({
//       uploadDir: TEMP_FOLDER,
//       keepExtensions: true,
//       multiples: true,
//     });
//     console.log(form)
//     form.parse(req, async (err, fields, files) => {
//       if (err) {
//         console.error("Formidable Parse Error:", err);
//         return res.status(500).json({ error: err.message });
//       }
//       const metadata = JSON.parse(fields.metadata?.[0] || "[]"); // metadata array
//       if (!files.file) {
//         return res.status(400).json({ error: "No files uploaded" });
//       }
//       const uploadedFiles = Array.isArray(files.file) ? files.file : [files.file];
//       console.log(uploadedFiles)
//       const uploadedDocs = [];
//       for (let i = 0; i < uploadedFiles.length; i++) {
//         const file = uploadedFiles[i];
//         const tempFilePath = file.filepath;
//         const fileName = sanitizeFileName(file.originalFilename || `file_${Date.now()}.png`);
//         const remoteFilePath = `/public_html/documents/${fileName}`;
//         await uploadToFTP(tempFilePath, remoteFilePath);
//         const fileUrl = `https://hrproindia.in/documents/${fileName}`
//         console.log(fileUrl);
//         fs.unlinkSync(tempFilePath); // cleanup temp file
//         // // Save in DB
//         // const savedDoc = await prisma.document.create({
//         //   data: {
//         //     employeeId: Number(employeeId),
//         //     title: metadata[i].title || metadata[i].type,
//         //     type: metadata[i].type,
//         //     category: metadata[i].category,
//         //     issueDate: metadata[i].issueDate ? new Date(metadata[i].issueDate) : null,
//         //     expiryDate: metadata[i].expiryDate ? new Date(metadata[i].expiryDate) : null,
//         //     fileUrl: fileUrl
//         //   }
//         // });
//         // const savedDoc = await prisma.document.upsert({
//         //   where: {
//         //     employeeId_type: {
//         //       employeeId: Number(employeeId),
//         //       type: metadata[i].type,
//         //     },
//         //   },
//         //   create: {
//         //     employeeId: Number(employeeId),
//         //     title: metadata[i].title || metadata[i].type,
//         //     type: metadata[i].type,
//         //     category: metadata[i].category,
//         //     issueDate: metadata[i].issueDate ? new Date(metadata[i].issueDate) : null,
//         //     expiryDate: metadata[i].expiryDate ? new Date(metadata[i].expiryDate) : null,
//         //     fileUrl,
//         //   },
//         //   update: {
//         //     title: metadata[i].title || metadata[i].type,
//         //     category: metadata[i].category,
//         //     issueDate: metadata[i].issueDate ? new Date(metadata[i].issueDate) : null,
//         //     expiryDate: metadata[i].expiryDate ? new Date(metadata[i].expiryDate) : null,
//         //     fileUrl,
//         //   },
//         // });
//         const existingDoc = await prisma.document.findFirst({
//           where: {
//             employeeId: Number(employeeId),
//             type: metadata[i].type,
//           },
//         });
//         let savedDoc;
//         if (existingDoc) {
//           savedDoc = await prisma.document.update({
//             where: { id: existingDoc.id },
//             data: {
//               title: metadata[i].title || metadata[i].type,
//               category: metadata[i].category,
//               issueDate: metadata[i].issueDate ? new Date(metadata[i].issueDate) : null,
//               expiryDate: metadata[i].expiryDate ? new Date(metadata[i].expiryDate) : null,
//               fileUrl,
//             },
//           });
//         } else {
//           savedDoc = await prisma.document.create({
//             data: {
//               employeeId: Number(employeeId),
//               title: metadata[i].title || metadata[i].type,
//               type: metadata[i].type,
//               category: metadata[i].category,
//               issueDate: metadata[i].issueDate ? new Date(metadata[i].issueDate) : null,
//               expiryDate: metadata[i].expiryDate ? new Date(metadata[i].expiryDate) : null,
//               fileUrl,
//             },
//           });
//         }
//         uploadedDocs.push(savedDoc);
//       }
//       res.status(201).json({ message: "Documents uploaded successfully", documents: uploadedDocs });
//     });
//   } catch (error) {
//     console.error("Upload Error:", error);
//     res.status(500).json({ error: (error as Error).message });
//   }
// };
// export const uploadEmployeeDocuments = async (req: Request, res: Response) => {
//   try {
//     const employeeId = Number(req.params.employeeId);
//     if (Number.isNaN(employeeId)) {
//       return res.status(400).json({ error: "Invalid employeeId" });
//     }
//     const form = formidable({
//       uploadDir: TEMP_FOLDER,
//       keepExtensions: true,
//       multiples: true,
//     });
//     form.parse(req, async (err, fields, files) => {
//       try {
//         if (err) {
//           console.error("Formidable error:", err);
//           return res.status(500).json({ error: err.message });
//         }
//         /* ----------------------------------
//            1️⃣ Parse metadata
//         ---------------------------------- */
//         const metadata: any[] = JSON.parse(
//           (fields.metadata?.[0] as string) || "[]"
//         );
//         /* ----------------------------------
//            2️⃣ Parse fileIndex (FormArray index)
//         ---------------------------------- */
//         const fileIndexRaw = fields.fileIndex;
//         const fileIndexes: number[] = Array.isArray(fileIndexRaw)
//           ? fileIndexRaw.map((x) => Number(x))
//           : fileIndexRaw
//           ? [Number(fileIndexRaw)]
//           : [];
//         /* ----------------------------------
//            3️⃣ Normalize uploaded files
//         ---------------------------------- */
//         const uploaded = files.file;
//         const uploadedFiles = Array.isArray(uploaded)
//           ? uploaded
//           : uploaded
//           ? [uploaded]
//           : [];
//         /* ----------------------------------
//            4️⃣ Map: formIndex → file
//         ---------------------------------- */
//         const fileMap = new Map<number, any>();
//         for (let i = 0; i < uploadedFiles.length; i++) {
//           const idx = fileIndexes[i];
//           if (Number.isFinite(idx)) {
//             fileMap.set(idx, uploadedFiles[i]);
//           }
//         }
//         const savedDocuments: any[] = [];
//         /* ----------------------------------
//            5️⃣ Process each metadata row
//         ---------------------------------- */
//         for (let i = 0; i < metadata.length; i++) {
//           const meta = metadata[i];
//           if (!meta?.type) continue;
//           const issueDate = meta.issueDate ? new Date(meta.issueDate) : null;
//           const expiryDate = meta.expiryDate ? new Date(meta.expiryDate) : null;
//           let newFileUrl: string | null = null;
//           /* ---------- Upload only if new file exists ---------- */
//           const f = fileMap.get(i);
//           if (f?.filepath) {
//             const tempFilePath = f.filepath;
//             const originalName =
//               f.originalFilename || `doc_${employeeId}_${Date.now()}`;
//             const fileName = sanitizeFileName(originalName);
//             const remotePath = `/public_html/documents/${fileName}`;
//             await uploadToFTP(tempFilePath, remotePath);
//             try {
//               fs.unlinkSync(tempFilePath);
//             } catch {}
//             newFileUrl = `https://hrproindia.in/documents/${fileName}`;
//           }
//           /* ---------- UPDATE ---------- */
//           if (meta.id) {
//             const existing = await prisma.document.findUnique({
//               where: { id: Number(meta.id) },
//               select: { fileUrl: true },
//             });
//             const updatedDoc = await prisma.document.update({
//               where: { id: Number(meta.id) },
//               data: {
//                 employeeId,
//                 title: meta.title || meta.type || "",
//                 category: meta.category ?? undefined,
//                 type: meta.type,
//                 issueDate,
//                 expiryDate,
//                 // ✅ keep old if no new upload
//                 fileUrl: newFileUrl ?? existing?.fileUrl ?? undefined,
//               },
//             });
//             savedDocuments.push(updatedDoc);
//             continue;
//           }
//           /* ---------- CREATE (only if file uploaded) ---------- */
//           if (!newFileUrl) continue;
//           const createdDoc = await prisma.document.create({
//             data: {
//               employeeId,
//               title: meta.title || meta.type || "",
//               category: meta.category ?? undefined,
//               type: meta.type,
//               issueDate,
//               expiryDate,
//               fileUrl: newFileUrl,
//             },
//           });
//           savedDocuments.push(createdDoc);
//         }
//         return res.status(201).json({
//           message: "Documents uploaded successfully",
//           documents: savedDocuments,
//         });
//       } catch (e: any) {
//         console.error("uploadEmployeeDocuments inner error:", e);
//         return res.status(500).json({ error: e?.message || "Upload failed" });
//       }
//     });
//   } catch (error: any) {
//     console.error("uploadEmployeeDocuments error:", error);
//     return res.status(500).json({ error: error?.message || "Upload failed" });
//   }
// };
// export const uploadEmployeeDocuments = async (req: Request, res: Response) => {
//   try {
//     const employeeId = Number(req.params.employeeId);
//     if (Number.isNaN(employeeId)) {
//       return res.status(400).json({ error: "Invalid employeeId" });
//     }
//     const form = formidable({
//       uploadDir: TEMP_FOLDER,
//       keepExtensions: true,
//       multiples: true
//     });
//     form.parse(req, async (err, fields, files) => {
//       try {
//         if (err) {
//           console.error("Formidable error:", err);
//           return res.status(500).json({ error: err.message });
//         }
//         /* -------------------- 1️⃣ Metadata -------------------- */
//         const metadata: any[] = JSON.parse(
//           (fields.metadata?.[0] as string) || "[]"
//         );
//         /* -------------------- 2️⃣ File indexes -------------------- */
//         const rawIndex = fields.fileIndex;
//         const fileIndexes: number[] = Array.isArray(rawIndex)
//           ? rawIndex.map(Number)
//           : rawIndex
//             ? [Number(rawIndex)]
//             : [];
//         /* -------------------- 3️⃣ Uploaded files -------------------- */
//         const uploaded = files.file;
//         const uploadedFiles = Array.isArray(uploaded)
//           ? uploaded
//           : uploaded
//             ? [uploaded]
//             : [];
//         /* -------------------- 4️⃣ SAFETY CHECK -------------------- */
//         if (fileIndexes.length !== uploadedFiles.length) {
//           return res.status(400).json({
//             error: "File index mismatch",
//             fileIndexes,
//             uploadedFiles: uploadedFiles.length
//           });
//         }
//         /* -------------------- 5️⃣ Map index → file -------------------- */
//         const fileMap = new Map<number, any>();
//         uploadedFiles.forEach((file, i) => {
//           fileMap.set(fileIndexes[i], file);
//         });
//         console.log("METADATA:", metadata.length);
//         console.log("FILE MAP:", [...fileMap.keys()]);
//         const savedDocuments: any[] = [];
//         /* -------------------- 6️⃣ Process rows -------------------- */
//         metadata.forEach(async (meta, index) => {
//           if (!meta?.type) return;
//           const issueDate = meta.issueDate ? new Date(meta.issueDate) : null;
//           const expiryDate = meta.expiryDate ? new Date(meta.expiryDate) : null;
//           let newFileUrl: string | null = null;
//           const f = fileMap.get(index);
//           if (f?.filepath) {
//             const safeName = sanitizeFileName(
//               f.originalFilename || `doc_${employeeId}_${Date.now()}`
//             );
//             const remotePath = `/public_html/documents/${safeName}`;
//             await uploadToFTP(f.filepath, remotePath);
//             try {
//               fs.unlinkSync(f.filepath);
//             } catch { }
//             newFileUrl = `https://hrproindia.in/documents/${safeName}`;
//           }
//           /* ---------- UPDATE ---------- */
//           if (meta.id) {
//             const updated = await prisma.document.update({
//               where: { id: Number(meta.id) },
//               data: {
//                 employeeId,
//                 title: meta.title || meta.type,
//                 category: meta.category ?? undefined,
//                 type: meta.type,
//                 issueDate,
//                 expiryDate,
//                 ...(newFileUrl ? { fileUrl: newFileUrl } : {})
//               }
//             });
//             savedDocuments.push(updated);
//             return;
//           }
//           /* ---------- CREATE ---------- */
//           if (!newFileUrl) return;
//           const created = await prisma.document.create({
//             data: {
//               employeeId,
//               title: meta.title || meta.type,
//               category: meta.category ?? undefined,
//               type: meta.type,
//               issueDate,
//               expiryDate,
//               fileUrl: newFileUrl
//             }
//           });
//           savedDocuments.push(created);
//         });
//         return res.status(201).json({
//           message: "Documents uploaded successfully",
//           documents: savedDocuments
//         });
//       } catch (e: any) {
//         console.error("Upload inner error:", e);
//         return res.status(500).json({ error: e.message });
//       }
//     });
//   } catch (error: any) {
//     console.error("Upload error:", error);
//     return res.status(500).json({ error: error.message });
//   }
// };
const uploadEmployeeDocuments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        if (Number.isNaN(employeeId)) {
            return res.status(400).json({ error: "Invalid employeeId" });
        }
        const form = (0, formidable_1.default)({
            uploadDir: TEMP_FOLDER,
            keepExtensions: true,
            multiples: true
        });
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            try {
                if (err) {
                    console.error("Formidable error:", err);
                    return res.status(500).json({ error: err.message });
                }
                /* -------------------- 1️⃣ Metadata -------------------- */
                const metadata = JSON.parse(((_a = fields.metadata) === null || _a === void 0 ? void 0 : _a[0]) || "[]");
                /* -------------------- 2️⃣ File Keys -------------------- */
                const rawKeys = fields.fileKey;
                const fileKeys = Array.isArray(rawKeys)
                    ? rawKeys
                    : rawKeys
                        ? [rawKeys]
                        : [];
                /* -------------------- 3️⃣ Uploaded Files -------------------- */
                const uploaded = files.file;
                const uploadedFiles = Array.isArray(uploaded)
                    ? uploaded
                    : uploaded
                        ? [uploaded]
                        : [];
                if (fileKeys.length !== uploadedFiles.length) {
                    return res.status(400).json({
                        error: "fileKey and file count mismatch"
                    });
                }
                /* -------------------- 4️⃣ Build fileMap -------------------- */
                const fileMap = new Map();
                uploadedFiles.forEach((file, i) => {
                    fileMap.set(fileKeys[i], file);
                });
                const savedDocuments = [];
                /* -------------------- 5️⃣ Process Documents (SAFE LOOP) -------------------- */
                for (const meta of metadata) {
                    if (!(meta === null || meta === void 0 ? void 0 : meta.type))
                        continue;
                    const issueDate = meta.issueDate ? new Date(meta.issueDate) : null;
                    const expiryDate = meta.expiryDate ? new Date(meta.expiryDate) : null;
                    let newFileUrl = null;
                    const file = meta.fileKey ? fileMap.get(meta.fileKey) : null;
                    if (file === null || file === void 0 ? void 0 : file.filepath) {
                        const safeName = sanitizeFileName(file.originalFilename || `doc_${employeeId}_${Date.now()}`);
                        const remotePath = `/public_html/documents/${safeName}`;
                        yield uploadToFTP(file.filepath, remotePath);
                        try {
                            fs_1.default.unlinkSync(file.filepath);
                        }
                        catch (_b) { }
                        newFileUrl = `https://hrproindia.in/documents/${safeName}`;
                    }
                    /* ---------- UPDATE EXISTING DOCUMENT ---------- */
                    if (meta.id) {
                        const updated = yield prisma.document.update({
                            where: { id: Number(meta.id) },
                            data: Object.assign({ employeeId, title: meta.title || meta.type, category: meta.category, type: meta.type, issueDate,
                                expiryDate }, (newFileUrl ? { fileUrl: newFileUrl } : {}))
                        });
                        savedDocuments.push(updated);
                    }
                    /* ---------- CREATE NEW DOCUMENT ---------- */
                    else if (newFileUrl) {
                        const created = yield prisma.document.create({
                            data: {
                                employeeId,
                                title: meta.title || meta.type,
                                category: meta.category,
                                type: meta.type,
                                issueDate,
                                expiryDate,
                                fileUrl: newFileUrl
                            }
                        });
                        savedDocuments.push(created);
                    }
                }
                return res.status(201).json({
                    message: "Documents uploaded successfully",
                    documents: savedDocuments
                });
            }
            catch (e) {
                console.error("Upload inner error:", e);
                return res.status(500).json({ error: e.message });
            }
        }));
    }
    catch (error) {
        console.error("Upload error:", error);
        return res.status(500).json({ error: error.message });
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
const getEmployeesByRole = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const roleId = Number(req.query.roleId);
        if (!roleId) {
            return res.status(400).json({ error: "roleId is required" });
        }
        const employees = yield prisma.employee.findMany({
            where: {
                roleId: roleId
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                roleId: true
            }
        });
        return res.status(200).json(employees);
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to fetch employees" });
    }
});
exports.getEmployeesByRole = getEmployeesByRole;
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
        // const wfhAccrued = round(policy.wfhEntitlement / 12 * monthsProrated, 2);
        const permissionAccrued = round(policy.permissionEntitlement / 12 * monthsProrated, 2); // hours
        // 4) usage (only APPROVED within year)
        const [leaves, perms] = yield Promise.all([
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
        const permissionHoursUsed = perms.reduce((sum, r) => sum + permissionHours(r.startTime, r.endTime, r.timing), 0);
        // 5) rows
        const rows = [
            row('Leave', policy.leaveEntitlement, leaveAccrued, leaveDaysUsed),
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
const sendHealthCheckReminders = () => __awaiter(void 0, void 0, void 0, function* () {
    const today = new Date();
    const currentYear = today.getFullYear();
    const employees = yield prisma.employee.findMany({
        where: {
            preEmploymentCheckDate: { not: null },
            OR: [
                { healthCheckReminderYear: null },
                { healthCheckReminderYear: { not: currentYear } }
            ]
        }
    });
    for (const emp of employees) {
        const nextCheckDate = new Date(emp.preEmploymentCheckDate);
        nextCheckDate.setFullYear(nextCheckDate.getFullYear() + 1);
        // Not yet time → skip
        if (today < nextCheckDate)
            continue;
        // ✔ Ready to send reminder
        const message = `
Hello ${emp.firstName} - ${emp.employeeCode},

Your annual Health Check is due.

Please schedule your medical check-up at the earliest.

- HR Team
`;
        // Send WhatsApp
        // try {
        //   const formattedPhone = formatPhoneNumber(emp.phone);
        //   await sendWhatsAppTemplate({
        //     to: formattedPhone,
        //     templateId: HEALTH_CHECK_REMINDER_TEMPLATE_ID,
        //     placeholders: [emp.firstName]
        //   });
        // } catch (err) {
        //   console.error("WhatsApp sending failed:", err);
        // }
        // Create notification
        yield (0, notifications_controller_1.createNotification)(emp.id, message);
        // Update the year reminder sent
        yield prisma.employee.update({
            where: { id: emp.id },
            data: {
                healthCheckReminderYear: currentYear,
                healthCheckReminderSent: true
            }
        });
        console.log(`Health check reminder sent to ${emp.firstName}`);
    }
});
exports.sendHealthCheckReminders = sendHealthCheckReminders;
function startOfDayIST(d = new Date()) {
    const x = new Date(d.toLocaleString('en-US', { timeZone: IST }));
    x.setHours(0, 0, 0, 0);
    return x;
}
function endOfDayIST(d = new Date()) {
    const x = new Date(d.toLocaleString('en-US', { timeZone: IST }));
    x.setHours(23, 59, 59, 999);
    return x;
}
const IST = 'Asia/Kolkata';
// export const getUnreportedAbsentees = async (req: Request, res: Response) => {
//   try {
//     const { date } = req.query;
//     if (!date) {
//       return res.status(400).json({ message: "Date is required ?date=YYYY-MM-DD" });
//     }
//     const targetDate = new Date(date as string);
//     const start = new Date(targetDate);
//     start.setHours(0, 0, 0, 0);
//     const end = new Date(targetDate);
//     end.setHours(23, 59, 59, 999);
//     // STEP 1: Get all active employees
//     const allEmployees = await prisma.employee.findMany({
//       where: { employmentStatus: "ACTIVE" },
//       select: {
//         id: true,
//         employeeCode: true,
//         firstName: true,
//         lastName: true,
//         designation: true,
//         Department: { select: { name: true, id: true } },
//       }
//     });
//     const employeeIds = allEmployees.map(e => e.id);
//     // STEP 2: Get attendance, shift assignment, shift settings
//     const [attendance, shiftAssignments, shiftSettings, leaves] = await Promise.all([
//       prisma.attendance.findMany({
//         where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end } },
//         select: { employeeId: true, checkIn: true }
//       }),
//       prisma.shiftAssignment.findMany({
//         where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end } },
//         select: {
//           employeeId: true,
//           shift: { select: { id: true, startTime: true, endTime: true } }
//         }
//       }),
//       prisma.employeeShiftSetting.findMany({
//         where: { employeeId: { in: employeeIds } },
//         select: {
//           employeeId: true,
//           mode: true,
//           startDate: true,
//           fixedShift: { select: { id: true, startTime: true, endTime: true } },
//           rotationPattern: {
//             select: {
//               cycleDays: true,
//               items: {
//                 select: {
//                   dayIndex: true,
//                   shift: { select: { id: true, startTime: true, endTime: true } }
//                 }
//               }
//             }
//           }
//         }
//       }),
//       prisma.leaveRequest.findMany({
//         where: {
//           status: { in: ["PENDING", "APPROVED"] },
//           startDate: { lte: end },
//           endDate: { gte: start }
//         },
//         select: { employeeId: true }
//       })
//     ]);
//     // Extract present and leave IDs
//     const checkedInIds = attendance.filter(a => a.checkIn).map(a => a.employeeId);
//     const leaveIds = leaves.map(l => l.employeeId);
//     // Helper: compute shift
//     function computeShift(empId: number) {
//       // 1. Direct shift assignment for the date
//       const assigned = shiftAssignments.find(a => a.employeeId === empId);
//       if (assigned?.shift) return assigned.shift;
//       const setting = shiftSettings.find(s => s.employeeId === empId);
//       if (!setting) return null;
//       // 2. Fixed shift
//       if (setting.mode === "FIXED" && setting.fixedShift)
//         return setting.fixedShift;
//       // 3. Rotation mode
//       if (setting.mode === "ROTATIONAL" && setting.rotationPattern) {
//         const cycleDays = setting.rotationPattern.cycleDays;
//         const startDate = new Date(setting.startDate);
//         const diff = Math.floor(
//           (targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
//         );
//         const cycleIndex = diff % cycleDays;
//         const shiftItem = setting.rotationPattern.items.find(
//           i => i.dayIndex === cycleIndex
//         );
//         if (shiftItem?.shift) return shiftItem.shift;
//       }
//       return null;
//     }
//     // Filter absentees without leave
//     const absentees = allEmployees
//       .filter(emp =>
//         !checkedInIds.includes(emp.id) &&
//         !leaveIds.includes(emp.id)
//       )
//       .map(emp => {
//         const shift = computeShift(emp.id);
//         return {
//           ...emp,
//           shiftStartTime: shift?.startTime ?? null,
//           shiftEndTime: shift?.endTime ?? null
//         };
//       });
//     return res.json(absentees);
//   } catch (error) {
//     console.error(error);
//     return res.status(500).json({ message: "Internal error" });
//   }
// };
// Convert Excel serial number → JS Date
const getUnreportedAbsentees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({
                message: "Date is required ?date=YYYY-MM-DD",
            });
        }
        // IST-safe day range
        const target = new Date(date);
        const start = startOfDayIST(target);
        const end = endOfDayIST(target);
        // 1️⃣ Shift assignments define expected employees
        const assignments = yield prisma.shiftAssignment.findMany({
            where: { date: { gte: start, lte: end } },
            select: {
                employeeId: true,
                shift: { select: { startTime: true, endTime: true, name: true } },
                employee: {
                    select: {
                        employeeCode: true,
                        firstName: true,
                        lastName: true,
                        designation: true,
                        Department: true,
                        gender: true,
                        photoUrl: true,
                    },
                },
            },
        });
        if (!assignments.length) {
            return res.json([]); // nobody was scheduled
        }
        const employeeIds = assignments.map(a => a.employeeId);
        // 2️⃣ Attendance for the day
        const attendance = yield prisma.attendance.findMany({
            where: {
                employeeId: { in: employeeIds },
                date: { gte: start, lte: end },
            },
            select: { employeeId: true, checkIn: true },
        });
        // 3️⃣ Approved / pending leave, WFH, permission
        const [leaves, wfh, perms] = yield Promise.all([
            prisma.leaveRequest.findMany({
                where: {
                    employeeId: { in: employeeIds },
                    status: { in: ["PENDING", "APPROVED"] },
                    startDate: { lte: end },
                    endDate: { gte: start },
                },
                select: { employeeId: true },
            }),
            prisma.wFHRequest.findMany({
                where: {
                    employeeId: { in: employeeIds },
                    status: { in: ["PENDING", "APPROVED"] },
                    startDate: { lte: end },
                    endDate: { gte: start },
                },
                select: { employeeId: true },
            }),
            prisma.permissionRequest.findMany({
                where: {
                    employeeId: { in: employeeIds },
                    status: { in: ["PENDING", "APPROVED"] },
                    OR: [
                        { day: { gte: start, lte: end } },
                        { startTime: { lte: end }, endTime: { gte: start } },
                    ],
                },
                select: { employeeId: true },
            }),
        ]);
        // 4️⃣ Fast lookup sets
        const checkedInSet = new Set(attendance.filter(a => a.checkIn).map(a => a.employeeId));
        const excusedSet = new Set([
            ...leaves.map(x => x.employeeId),
            ...wfh.map(x => x.employeeId),
            ...perms.map(x => x.employeeId),
        ]);
        // 5️⃣ Final unreported absentees
        const absentees = assignments
            .filter(a => !checkedInSet.has(a.employeeId) &&
            !excusedSet.has(a.employeeId))
            .map(a => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
            return ({
                employeeId: a.employeeId,
                employeeCode: a.employee.employeeCode,
                name: `${a.employee.firstName} ${a.employee.lastName}`,
                department: (_b = (_a = a.employee.Department) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
                departmentId: (_d = (_c = a.employee.Department) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : null,
                designation: (_e = a.employee.designation) !== null && _e !== void 0 ? _e : null,
                shiftName: (_g = (_f = a.shift) === null || _f === void 0 ? void 0 : _f.name) !== null && _g !== void 0 ? _g : null,
                shiftStartTime: (_j = (_h = a.shift) === null || _h === void 0 ? void 0 : _h.startTime) !== null && _j !== void 0 ? _j : null,
                shiftEndTime: (_l = (_k = a.shift) === null || _k === void 0 ? void 0 : _k.endTime) !== null && _l !== void 0 ? _l : null,
            });
        });
        return res.json(absentees);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Internal error" });
    }
});
exports.getUnreportedAbsentees = getUnreportedAbsentees;
function excelDateToJSDate(serial) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const days = Math.floor(serial);
    const ms = days * 86400000;
    return new Date(excelEpoch.getTime() + ms);
}
function parseDate(value) {
    if (!value)
        return null;
    if (typeof value === "number") {
        return excelDateToJSDate(value);
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}
const uploadProgress = new Map();
function findOrCreateByName(model_1, name_1) {
    return __awaiter(this, arguments, void 0, function* (model, name, extraData = {}) {
        const trimmed = name === null || name === void 0 ? void 0 : name.trim();
        if (!trimmed) {
            throw new Error("Name is required");
        }
        // Case-insensitive lookup
        const existing = yield model.findFirst({
            where: {
                name: {
                    equals: trimmed,
                    mode: "insensitive",
                },
            },
        });
        if (existing)
            return existing;
        return model.create({
            data: Object.assign({ name: trimmed }, extraData),
        });
    });
}
// export async function mapExcelRowToEmployee(
//   row: Record<string, any>
// ): Promise<Prisma.EmployeeCreateInput> {
//   // Required lookups
//   const dept = await prisma.department.findUnique({
//     where: { name: row.departmentName?.trim() },
//   });
//   const branch = await prisma.branch.findUnique({
//     where: { name: row.branchName?.trim() },
//   });
//   const role = await prisma.role.findUnique({
//     where: { name: row.roleName?.trim() },
//   });
//   const manager =
//     row.reportingManagerCode
//       ? await prisma.employee.findUnique({
//         where: { employeeCode: row.reportingManagerCode },
//       })
//       : null;
//   if (!dept) throw new Error(`Invalid Department: ${row.departmentName}`);
//   if (!branch) throw new Error(`Invalid Branch: ${row.branchName}`);
//   if (!role) throw new Error(`Invalid Role: ${row.roleName}`);
//   const dob = parseDate(row.dob);
//   if (!dob) throw new Error("Invalid DOB");
//   const doj = parseDate(row.dateOfJoining);
//   if (!doj) throw new Error("Invalid Date of Joining");
//   const probationEnd = parseDate(row.probationEndDate);
//   return {
//     employeeCode: row.employeeCode,
//     referenceCode: row.referenceCode || null,
//     firstName: row.firstName,
//     lastName: row.lastName,
//     gender: row.gender,
//     dob,
//     dateOfJoining: doj,
//     probationEndDate: probationEnd,
//     phone: row.phone?.toString() || "",
//     email: row.email?.toString() || "",
//     designation: row.designation,
//     employmentType: row.employmentType,
//     employmentStatus: row.employmentStatus,
//     employeeType: row.employeeType || "Full-Time",
//     bloodGroup: row.bloodGroup || null,
//     reportingManager: manager ? manager.id : null,
//     // Required Relations
//     Department: { connect: { id: dept.id } },
//     Branch: { connect: { id: branch.id } },
//     role: { connect: { id: role.id } },
//   };
// }
function ensureDirExists(dirPath) {
    if (!fs_1.default.existsSync(dirPath)) {
        fs_1.default.mkdirSync(dirPath, { recursive: true });
    }
}
function mapExcelRowToEmployee(row) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const departmentName = (_a = row.departmentName) === null || _a === void 0 ? void 0 : _a.trim();
        const branchName = (_b = row.branchName) === null || _b === void 0 ? void 0 : _b.trim();
        const roleName = (_c = row.roleName) === null || _c === void 0 ? void 0 : _c.trim();
        const designationName = (_d = row.designationName) === null || _d === void 0 ? void 0 : _d.trim();
        if (!departmentName || !branchName || !roleName || !designationName) {
            throw new Error("Department, Branch, Role and Designation are required");
        }
        const [dept, branch, role, designation] = yield Promise.all([
            prisma.department.upsert({
                where: { name: departmentName },
                update: {},
                create: { name: departmentName },
            }),
            prisma.branch.upsert({
                where: { name: branchName },
                update: {},
                create: { name: branchName },
            }),
            prisma.role.upsert({
                where: { name: roleName },
                update: {},
                create: { name: roleName },
            }),
            prisma.designation.upsert({
                where: { name: designationName },
                update: {},
                create: { name: designationName },
            }),
        ]);
        // const manager = row.reportingManagerCode
        //   ? await prisma.employee.findUnique({
        //       where: { employeeCode: normalizeCode(row.reportingManagerCode) },
        //     })
        //   : null;
        const managerCode = normalizeManagerCode(row.reportingManagerCode);
        const manager = managerCode
            ? yield prisma.employee.findUnique({
                where: { employeeCode: managerCode },
            })
            : null;
        const dob = parseDate(row.dob);
        const doj = parseDate(row.dateOfJoining);
        if (!dob || !doj)
            throw new Error("Invalid DOB or Date of Joining");
        console.log("Mapped Employee:", {
            gender: normalizeGender(row.gender),
            employmentType: normalizeEmploymentType(row.employmentType),
            employmentStatus: normalizeEmploymentStatus(row.employmentStatus),
        });
        return {
            employeeCode: normalizeCode(row.employeeCode),
            referenceCode: row.referenceCode || null,
            firstName: row.firstName,
            lastName: row.lastName,
            gender: normalizeGender(row.gender),
            dob,
            dateOfJoining: doj,
            phone: String(row.phone),
            email: String(row.email),
            employmentType: normalizeEmploymentType(row.employmentType),
            employmentStatus: normalizeEmploymentStatus(row.employmentStatus),
            employeeType: row.employeeType || "CLINICAL",
            reportingManager: manager ? manager.id : null,
            Department: { connect: { id: dept.id } },
            Branch: { connect: { id: branch.id } },
            role: { connect: { id: role.id } },
            designation: { connect: { id: designation.id } },
            bloodGroup: 'O+',
        };
    });
}
function toDate(value) {
    if (!value)
        throw new Error(`Missing required date field`);
    const d = new Date(value);
    if (isNaN(d.getTime()))
        throw new Error(`Invalid date: ${value}`);
    return d;
}
// export const bulkUploadEmployees = async (req: Request, res: Response) => {
//   try {
//     const form = formidable({ multiples: false, keepExtensions: true });
//     form.parse(req, async (err, fields, files) => {
//       if (err) return res.status(500).json({ error: "File parsing error" });
//       const fileObj = Array.isArray(files.file) ? files.file[0] : files.file;
//       if (!fileObj) {
//         return res.status(400).json({ error: "No file uploaded" });
//       }
//       // Read Excel file
//       const workbook = XLSX.readFile(fileObj.filepath);
//       const sheet = workbook.Sheets[workbook.SheetNames[0]];
//       const rawRows = XLSX.utils.sheet_to_json(sheet);
//       const errorRows: ErrorRow[] = [];
//       const logs: string[] = [];
//       const createOps: Prisma.PrismaPromise<any>[] = [];
//       let successCount = 0;
//       for (let i = 0; i < rawRows.length; i++) {
//         const raw = rawRows[i] as Record<string, any>;
//         try {
//           const mapped = await mapExcelRowToEmployee(raw);
//           // Push create operation (no long transaction)
//           createOps.push(prisma.employee.create({ data: mapped }));
//           successCount++;
//           logs.push(`Row ${i + 1}: SUCCESS (${mapped.employeeCode})`);
//         } catch (error: any) {
//           const message = error?.message || "Unknown error";
//           errorRows.push({
//             rowNumber: i + 1,
//             error: message,
//             ...raw,
//           });
//           logs.push(`Row ${i + 1}: FAILED → ${message}`);
//         }
//       }
//       // If more than 20% rows failed → rollback (don't insert anything)
//       if (errorRows.length > rawRows.length * 0.2) {
//         return res.status(400).json({
//           successCount: 0,
//           failedCount: rawRows.length,
//           logs,
//           error: `Rollback triggered: ${errorRows.length} of ${rawRows.length} rows failed`,
//         });
//       }
//       // Execute all successful row inserts
//       if (createOps.length > 0) {
//         await prisma.$transaction(createOps);
//       }
//       // Generate error report Excel
//       let errorReportUrl: string | null = null;
//       if (errorRows.length > 0) {
//         const errorSheet = XLSX.utils.json_to_sheet(errorRows);
//         const errorWB = XLSX.utils.book_new();
//         XLSX.utils.book_append_sheet(errorWB, errorSheet, "Errors");
//         const fileName = `employee-error-report-${Date.now()}.xlsx`;
//         const filePath = path.join(__dirname, "../../reports", fileName);
//         XLSX.writeFile(errorWB, filePath);
//         errorReportUrl = `/reports/${fileName}`;
//       }
//       return res.json({
//         successCount,
//         failedCount: errorRows.length,
//         logs,
//         errors: errorReportUrl,
//       });
//     });
//   } catch (error: any) {
//     return res.status(500).json({ error: error.message || "Server error" });
//   }
// };
const downloadEmployeeTemplate = (_req, res) => {
    const headers = [{
            employeeCode: "",
            referenceCode: "",
            firstName: "",
            lastName: "",
            gender: "MALE | FEMALE | OTHER",
            dob: "YYYY-MM-DD",
            dateOfJoining: "YYYY-MM-DD",
            departmentName: "",
            branchName: "",
            roleName: "",
            designationName: "",
            reportingManagerCode: "",
            employmentType: "PERMANENT | CONTRACT | PROBATION",
            employmentStatus: "ACTIVE | TERMINATED | SUSPENDED",
            phone: "",
            email: "",
        }];
    const sheet = xlsx_1.default.utils.json_to_sheet(headers);
    const wb = xlsx_1.default.utils.book_new();
    xlsx_1.default.utils.book_append_sheet(wb, sheet, "Employees");
    res.setHeader("Content-Disposition", "attachment; filename=employee-upload-template.xlsx");
    res.end(xlsx_1.default.write(wb, { type: "buffer", bookType: "xlsx" }));
};
exports.downloadEmployeeTemplate = downloadEmployeeTemplate;
function normalizeCode(code) {
    return String(code || "").trim().toUpperCase();
}
const bulkUploadEmployees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const form = (0, formidable_1.default)({ multiples: false, keepExtensions: true });
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            if (err) {
                return res.status(500).json({ error: "File parsing error" });
            }
            const fileObj = Array.isArray(files.file) ? files.file[0] : files.file;
            if (!fileObj) {
                return res.status(400).json({ error: "No file uploaded" });
            }
            const workbook = xlsx_1.default.readFile(fileObj.filepath);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rawRows = xlsx_1.default.utils.sheet_to_json(sheet);
            if (!rawRows.length) {
                return res.status(400).json({ error: "Empty Excel file" });
            }
            const errorRows = [];
            const logs = [];
            const createOps = [];
            /** ---------------------------
             * 1️⃣ Collect employeeCodes
             ----------------------------*/
            const excelCodes = rawRows.map((r) => normalizeCode(r.employeeCode));
            /** ---------------------------
             * 2️⃣ Find existing codes in DB
             ----------------------------*/
            const existingEmployees = yield prisma.employee.findMany({
                where: { employeeCode: { in: excelCodes } },
                select: { employeeCode: true },
            });
            const existingCodeSet = new Set(existingEmployees.map(e => e.employeeCode.toUpperCase()));
            /** ---------------------------
             * 3️⃣ Detect duplicates in Excel
             ----------------------------*/
            const seenExcelCodes = new Set();
            for (let i = 0; i < rawRows.length; i++) {
                const row = rawRows[i];
                const employeeCode = normalizeCode(row.employeeCode);
                try {
                    if (!employeeCode) {
                        throw new Error("EmployeeCode is required");
                    }
                    // Duplicate inside Excel
                    if (seenExcelCodes.has(employeeCode)) {
                        throw new Error(`Duplicate employeeCode in Excel: ${employeeCode}`);
                    }
                    seenExcelCodes.add(employeeCode);
                    // Duplicate in DB
                    if (existingCodeSet.has(employeeCode)) {
                        throw new Error(`EmployeeCode already exists: ${employeeCode}`);
                    }
                    // Map & create
                    const mapped = yield mapExcelRowToEmployee(row);
                    // createOps.push(prisma.employee.create({ data: mapped }));
                    createOps.push(prisma.employee.create({
                        data: Object.assign({}, mapped)
                    }));
                    logs.push(`Row ${i + 1}: SUCCESS (${employeeCode})`);
                }
                catch (error) {
                    errorRows.push(Object.assign({ rowNumber: i + 1, employeeCode, error: error.message }, row));
                    logs.push(`Row ${i + 1}: FAILED → ${error.message}`);
                }
            }
            /** ---------------------------
             * 4️⃣ Execute inserts
             ----------------------------*/
            if (createOps.length > 0) {
                yield prisma.$transaction(createOps);
            }
            /** ---------------------------
             * 5️⃣ Error Excel
             ----------------------------*/
            let errorReportUrl = null;
            if (errorRows.length > 0) {
                const errorSheet = xlsx_1.default.utils.json_to_sheet(errorRows);
                const errorWB = xlsx_1.default.utils.book_new();
                xlsx_1.default.utils.book_append_sheet(errorWB, errorSheet, "Errors");
                const reportsDir = path_1.default.join(__dirname, "../../reports");
                if (!fs_1.default.existsSync(reportsDir)) {
                    fs_1.default.mkdirSync(reportsDir, { recursive: true });
                }
                const fileName = `employee-upload-errors-${Date.now()}.xlsx`;
                const filePath = path_1.default.join(reportsDir, fileName);
                xlsx_1.default.writeFile(errorWB, filePath);
                errorReportUrl = `/reports/${fileName}`;
            }
            return res.json({
                totalRows: rawRows.length,
                successCount: createOps.length,
                failedCount: errorRows.length,
                errorReport: errorReportUrl,
                logs,
            });
        }));
    }
    catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Bulk upload failed" });
    }
});
exports.bulkUploadEmployees = bulkUploadEmployees;
function normalizeManagerCode(code) {
    if (!code)
        return null;
    const c = String(code).trim().toUpperCase();
    if (c === "0")
        return null;
    return c;
}
/* ============================================================
   PROGRESS API
============================================================ */
const getBulkUploadProgress = (req, res) => {
    const progress = uploadProgress.get(req.params.uploadId);
    if (!progress)
        return res.status(404).json({ error: "Invalid uploadId" });
    res.json(progress);
};
exports.getBulkUploadProgress = getBulkUploadProgress;
function normalizeGender(value) {
    if (!value)
        throw new Error("Gender is required");
    const v = String(value)
        .replace(/\u00A0/g, " ") // remove non-breaking spaces
        .trim()
        .toUpperCase();
    switch (v) {
        case "MALE":
        case "M":
            return "MALE";
        case "FEMALE":
        case "F":
            return "FEMALE";
        case "OTHER":
        case "O":
            return "OTHER";
        default:
            throw new Error(`Invalid gender value: "${value}"`);
    }
}
function normalizeEmploymentType(value) {
    const v = String(value).trim().toUpperCase();
    if (!["PERMANENT", "CONTRACT", "PROBATION"].includes(v)) {
        throw new Error(`Invalid employmentType: "${value}"`);
    }
    return v;
}
function normalizeEmploymentStatus(value) {
    const v = String(value).trim().toUpperCase();
    if (!["ACTIVE", "TERMINATED", "SUSPENDED", "NOTICE_PERIOD", "RESIGNED"].includes(v)) {
        throw new Error(`Invalid employmentStatus: "${value}"`);
    }
    return v;
}
// export const bulkUpdateReportingManager = async (req: Request, res: Response) => {
//   const form = formidable({ multiples: false });
//   form.parse(req, async (err, fields, files) => {
//     if (err) return res.status(500).json({ error: "File parse error" });
//     const file = Array.isArray(files.file) ? files.file[0] : files.file;
//     if (!file) return res.status(400).json({ error: "No file uploaded" });
//     const workbook = XLSX.readFile(file.filepath);
//     const sheet = workbook.Sheets[workbook.SheetNames[0]];
//     const rows = XLSX.utils.sheet_to_json(sheet) as any[];
//     const errors: any[] = [];
//     let updated = 0;
//     for (let i = 0; i < rows.length; i++) {
//       const empCode = normalizeCode(rows[i].employeeCode);
//       const mgrCode = normalizeCode(rows[i].reportingManagerCode);
//       try {
//         if (!empCode || !mgrCode) {
//           throw new Error("employeeCode and reportingManagerCode required");
//         }
//         const manager = await prisma.employee.findUnique({
//           where: { employeeCode: mgrCode },
//         });
//         if (!manager) {
//           throw new Error(`Manager not found: ${mgrCode}`);
//         }
//         await prisma.employee.update({
//           where: { employeeCode: empCode },
//           data: { reportingManager: manager.id },
//         });
//         updated++;
//       } catch (e: any) {
//         errors.push({
//           row: i + 1,
//           employeeCode: empCode,
//           reportingManagerCode: mgrCode,
//           error: e.message,
//         });
//       }
//     }
//     res.json({
//       total: rows.length,
//       updated,
//       failed: errors.length,
//       errors,
//     });
//   });
// };
const bulkUpdateReportingManager = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const form = (0, formidable_1.default)({ multiples: false });
    form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
        if (err)
            return res.status(500).json({ error: "File parse error" });
        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        if (!file)
            return res.status(400).json({ error: "No file uploaded" });
        const workbook = xlsx_1.default.readFile(file.filepath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx_1.default.utils.sheet_to_json(sheet);
        const errors = [];
        let updated = 0;
        let skipped = 0;
        for (let i = 0; i < rows.length; i++) {
            const empCode = normalizeCode(rows[i].employeeCode);
            const mgrCodeRaw = rows[i].reportingManagerCode;
            const mgrCode = normalizeCode(mgrCodeRaw);
            try {
                if (!empCode) {
                    throw new Error("employeeCode is required");
                }
                // ✅ Skip if manager code is empty
                if (!mgrCodeRaw || !mgrCode) {
                    skipped++;
                    continue;
                }
                if (empCode === mgrCode) {
                    throw new Error("Employee cannot be own manager");
                }
                const manager = yield prisma.employee.findUnique({
                    where: { employeeCode: mgrCode },
                });
                if (!manager) {
                    throw new Error(`Manager not found: ${mgrCode}`);
                }
                yield prisma.employee.update({
                    where: { employeeCode: empCode },
                    data: { reportingManager: manager.id },
                });
                updated++;
            }
            catch (e) {
                errors.push({
                    row: i + 1,
                    employeeCode: empCode,
                    reportingManagerCode: mgrCodeRaw,
                    error: e.message,
                });
            }
        }
        res.json({
            totalRows: rows.length,
            updated,
            skipped, // 👈 important
            failed: errors.length,
            errors,
        });
    }));
});
exports.bulkUpdateReportingManager = bulkUpdateReportingManager;
// controllers/employee.controller.ts
const getInchargeEmployees = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('calling incharge employees');
    try {
        const incharges = yield prisma.employee.findMany({
            where: {
                roleId: 5, // ✅ INCHARGE
                employmentStatus: 'ACTIVE'
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true
            }
        });
        res.json(incharges.map(e => ({
            label: `${e.firstName} ${e.lastName} (${e.employeeCode})`,
            value: e.id
        })));
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch incharge employees' });
    }
});
exports.getInchargeEmployees = getInchargeEmployees;
const deleteEmployeeDocument = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const docId = Number(req.params.documentId);
        const doc = yield prisma.document.findUnique({
            where: { id: docId }
        });
        if (!doc) {
            return res.status(404).json({ error: 'Document not found' });
        }
        // 🔥 DELETE FILE FROM FTP
        if (doc.fileUrl) {
            const fileName = doc.fileUrl.split('/').pop();
            if (fileName) {
                const ftpPath = `/public_html/documents/${fileName}`;
                try {
                    yield deleteFromFTP(ftpPath);
                }
                catch (ftpErr) {
                    console.warn('FTP delete failed:', ftpErr);
                    // ❗ Do NOT fail DB deletion if FTP fails
                }
            }
        }
        // 🗑️ DELETE DB ROW
        yield prisma.document.delete({
            where: { id: docId }
        });
        res.json({ message: 'Document deleted successfully' });
    }
    catch (error) {
        console.error('Delete document error:', error);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});
exports.deleteEmployeeDocument = deleteEmployeeDocument;
function deleteFromFTP(remotePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new basic_ftp_1.Client();
        client.ftp.verbose = false;
        try {
            yield client.access({
                host: FTP_CONFIG.host,
                user: FTP_CONFIG.user,
                password: FTP_CONFIG.password,
                secure: false,
            });
            yield client.remove(remotePath);
        }
        finally {
            client.close();
        }
    });
}
// controllers/employee.controller.ts
const updateEmployeeProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.id);
        if (!employeeId) {
            return res.status(400).json({ error: 'Invalid employee id' });
        }
        const { firstName, lastName, bloodGroup, phone, email } = req.body;
        // ✅ OPTIONAL VALIDATION
        if (!firstName || !lastName) {
            return res.status(400).json({
                error: 'First name and last name are required'
            });
        }
        const updatedEmployee = yield prisma.employee.update({
            where: { id: employeeId },
            data: {
                firstName,
                lastName,
                bloodGroup,
                phone,
                email
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                bloodGroup: true,
                phone: true,
                email: true,
                photoUrl: true
            }
        });
        return res.json({
            message: 'Profile updated successfully',
            employee: updatedEmployee
        });
    }
    catch (error) {
        console.error('updateEmployeeProfile error:', error);
        return res.status(500).json({
            error: 'Failed to update profile'
        });
    }
});
exports.updateEmployeeProfile = updateEmployeeProfile;
// controllers/employee.controller.ts
const getEmployeeProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.id);
        if (!employeeId) {
            return res.status(400).json({ error: 'Invalid employee id' });
        }
        const employee = yield prisma.employee.findUnique({
            where: { id: employeeId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                bloodGroup: true,
                phone: true,
                email: true,
                photoUrl: true
            }
        });
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        return res.json(employee);
    }
    catch (error) {
        console.error('getEmployeeProfile error:', error);
        return res.status(500).json({
            error: 'Failed to fetch profile'
        });
    }
});
exports.getEmployeeProfile = getEmployeeProfile;
// export const initSabbaticalReminderScheduler = () => {
//   cron.schedule("0 9 * * *", async () => {
//     console.log("Running sabbatical reminder cron...");
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);
//     const reminderDate = new Date(today);
//     reminderDate.setDate(today.getDate() + 3); // 3 days before end
//     const employees = await prisma.employee.findMany({
//       where: {
//         employmentStatus: 'SABBATICAL',
//         sabbaticalEndDate: {
//           gte: today,
//           lte: reminderDate
//         }
//       },
//       select: {
//         id: true,
//         firstName: true,
//         sabbaticalEndDate: true
//       }
//     });
//     for (const emp of employees) {
//       const message = `Your sabbatical period will end on ${fmtDate(emp.sabbaticalEndDate)}. Please contact HR regarding your next steps.`;
//       // Employee notification
//       await createNotification(emp.id, message);
//       // HR notification (assuming HR role = 1)
//       const hrUsers = await prisma.employee.findMany({
//         where: { roleId: 1, employmentStatus: 'ACTIVE' },
//         select: { id: true }
//       });
//       for (const hr of hrUsers) {
//         await createNotification(
//           hr.id,
//           `${emp.firstName}'s sabbatical ends on ${fmtDate(emp.sabbaticalEndDate)}. Please take action.`
//         );
//       }
//     }
//     // On exact end date
// if (isSameDate(today, emp.sabbaticalEndDate)) {
//   const hrUsers = await prisma.employee.findMany({
//     where: { roleId: 1, employmentStatus: 'ACTIVE' },
//     select: { id: true }
//   });
//   for (const hr of hrUsers) {
//     await createNotification(
//       hr.id,
//       `${emp.firstName}'s sabbatical ends today. Please mark as Active, Extend, or Terminate.`
//     );
//   }
// }
//   });
// };
// 1) Reactivate employee
// employmentStatus: 'ACTIVE',
// sabbaticalStartDate: null,
// sabbaticalEndDate: null
// 2) Extend sabbatical
// employmentStatus: 'SABBATICAL',
// sabbaticalEndDate: newDate
// 3) Terminate
// employmentStatus: 'TERMINATED'
const startSabbatical = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.employeeId);
        const { startDate, endDate, reason } = req.body;
        if (!employeeId || !startDate || !endDate) {
            return res.status(400).json({
                error: "employeeId, startDate, and endDate are required"
            });
        }
        const result = yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // check if already on sabbatical
            const active = yield tx.sabbatical.findFirst({
                where: {
                    employeeId,
                    status: "ACTIVE"
                }
            });
            if (active) {
                throw new Error("Employee already on sabbatical");
            }
            // create sabbatical
            const sabbatical = yield tx.sabbatical.create({
                data: {
                    employeeId,
                    startDate: new Date(startDate),
                    endDate: new Date(endDate),
                    reason,
                    status: "ACTIVE"
                }
            });
            // update employee status
            yield tx.employee.update({
                where: { id: employeeId },
                data: { employmentStatus: "SABBATICAL" }
            });
            return sabbatical;
        }));
        // Revoke session/access — sabbatical employees should not retain
        // active logins (they're not working while on sabbatical).
        try {
            yield (0, employeeAccess_1.revokeEmployeeAccess)(Number(employeeId), 'Sabbatical started');
        }
        catch (e) {
            console.error('[sabbatical] revokeEmployeeAccess failed:', e);
        }
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
    }
});
exports.startSabbatical = startSabbatical;
const extendSabbatical = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const sabbaticalId = Number(req.params.id);
        const { endDate } = req.body;
        const result = yield prisma.sabbatical.update({
            where: { id: sabbaticalId },
            data: {
                endDate: new Date(endDate)
            }
        });
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
    }
});
exports.extendSabbatical = extendSabbatical;
const endSabbatical = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const sabbaticalId = Number(req.params.id);
        const result = yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const sabbatical = yield tx.sabbatical.update({
                where: { id: sabbaticalId },
                data: { status: "COMPLETED" }
            });
            yield tx.employee.update({
                where: { id: sabbatical.employeeId },
                data: { employmentStatus: "ACTIVE" }
            });
            return sabbatical;
        }));
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
    }
});
exports.endSabbatical = endSabbatical;
const terminateFromSabbatical = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const sabbaticalId = Number(req.params.id);
        const result = yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const sabbatical = yield tx.sabbatical.update({
                where: { id: sabbaticalId },
                data: { status: "COMPLETED" }
            });
            yield tx.employee.update({
                where: { id: sabbatical.employeeId },
                data: { employmentStatus: "TERMINATED" }
            });
            // Revoke session/access on TERMINATED.
            try {
                yield (0, employeeAccess_1.revokeEmployeeAccess)(sabbatical.employeeId, 'Sabbatical completed → terminated');
            }
            catch (e) {
                console.error('[sabbatical-complete] revokeEmployeeAccess failed:', e);
            }
            return sabbatical;
        }));
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
    }
});
exports.terminateFromSabbatical = terminateFromSabbatical;
const initSabbaticalReminderScheduler = () => {
    node_cron_1.default.schedule("0 9 * * *", () => __awaiter(void 0, void 0, void 0, function* () {
        console.log("Running sabbatical reminder cron...");
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const reminderDate = new Date(today);
        reminderDate.setDate(today.getDate() + 3);
        const sabbaticals = yield prisma.sabbatical.findMany({
            where: {
                status: "ACTIVE",
                endDate: {
                    gte: today,
                    lte: reminderDate
                }
            },
            include: {
                employee: true
            }
        });
        for (const sab of sabbaticals) {
            const emp = sab.employee;
            const message = `Your sabbatical ends on ${sab.endDate.toDateString()}. Please contact HR.`;
            yield (0, notifications_controller_1.createNotification)(emp.id, message);
            const hrUsers = yield prisma.employee.findMany({
                where: { roleId: 1, employmentStatus: "ACTIVE" },
                select: { id: true }
            });
            for (const hr of hrUsers) {
                yield (0, notifications_controller_1.createNotification)(hr.id, `${emp.firstName}'s sabbatical ends on ${sab.endDate.toDateString()}`);
            }
        }
    }));
};
exports.initSabbaticalReminderScheduler = initSabbaticalReminderScheduler;
// GET /employees/by-manager/:managerId
const getEmployeesByManager = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const managerId = Number(req.params.managerId);
        const employees = yield prisma.employee.findMany({
            where: {
                reportingManager: managerId,
                employmentStatus: "ACTIVE"
            },
            orderBy: { firstName: "asc" }
        });
        res.json(employees);
    }
    catch (err) {
        console.error("❌ Failed to fetch employees by manager:", err);
        res.status(500).json({ error: "Failed to fetch employees" });
    }
});
exports.getEmployeesByManager = getEmployeesByManager;
const bulkUpdateEmployeeExtras = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const form = (0, formidable_1.default)({ multiples: false, keepExtensions: true });
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            if (err) {
                return res.status(500).json({ error: "File parsing error" });
            }
            const fileObj = Array.isArray(files.file) ? files.file[0] : files.file;
            if (!fileObj) {
                return res.status(400).json({ error: "No file uploaded" });
            }
            const workbook = xlsx_1.default.readFile(fileObj.filepath);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = xlsx_1.default.utils.sheet_to_json(sheet);
            const logs = [];
            const errorRows = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const code = normalizeCode(row.employeeCode);
                try {
                    if (!code)
                        throw new Error("employeeCode missing");
                    const employee = yield prisma.employee.findUnique({
                        where: { employeeCode: code },
                    });
                    if (!employee) {
                        throw new Error(`Employee not found: ${code}`);
                    }
                    /** Helper date parser */
                    const parseOptionalDate = (value) => {
                        if (!value)
                            return null;
                        const d = new Date(value);
                        return isNaN(d.getTime()) ? null : d;
                    };
                    /** 1️⃣ Update employee fields */
                    yield prisma.employee.update({
                        where: { employeeCode: code },
                        data: {
                            marital: row.maritalStatus || null,
                            fatherName: row.fatherName || null,
                            motherName: row.motherName || null,
                            alternatePhone: row.alternatePhone
                                ? String(row.alternatePhone)
                                : null,
                            bloodGroup: row.bloodGroup || null,
                            uanNumber: row.uanNumber
                                ? String(row.uanNumber)
                                : null,
                            panNumber: row.panNumber
                                ? String(row.panNumber)
                                : null,
                            aadharNumber: row.aadharNumber
                                ? String(row.aadharNumber)
                                : null,
                            licenseNumber: row.licenseNumber
                                ? String(row.licenseNumber)
                                : null,
                            licenseRegDate: parseOptionalDate(row.licenseRegDate),
                            licenseExpiryDate: parseOptionalDate(row.licenseExpiryDate),
                            probationEndDate: parseOptionalDate(row.probationEndDate),
                        },
                    });
                    /** 2️⃣ Permanent Address */
                    if (row.permanentLine1) {
                        const existingPermanent = yield prisma.address.findFirst({
                            where: {
                                employeeId: employee.id,
                                type: "PERMANENT",
                            },
                        });
                        if (existingPermanent) {
                            yield prisma.address.update({
                                where: { id: existingPermanent.id },
                                data: {
                                    line1: row.permanentLine1,
                                    line2: row.permanentLine2 || null,
                                    city: row.permanentCity || "",
                                    state: row.permanentState || "",
                                    zipCode: row.permanentZip
                                        ? String(row.permanentZip)
                                        : "",
                                    country: row.permanentCountry || "",
                                },
                            });
                        }
                        else {
                            yield prisma.address.create({
                                data: {
                                    employeeId: employee.id,
                                    type: "PERMANENT",
                                    line1: row.permanentLine1,
                                    line2: row.permanentLine2 || null,
                                    city: row.permanentCity || "",
                                    state: row.permanentState || "",
                                    zipCode: row.permanentZip
                                        ? String(row.permanentZip)
                                        : "",
                                    country: row.permanentCountry || "",
                                },
                            });
                        }
                    }
                    /** 3️⃣ Temporary Address */
                    if (row.temporaryLine1) {
                        const existingTemporary = yield prisma.address.findFirst({
                            where: {
                                employeeId: employee.id,
                                type: "TEMPORARY",
                            },
                        });
                        if (existingTemporary) {
                            yield prisma.address.update({
                                where: { id: existingTemporary.id },
                                data: {
                                    line1: row.temporaryLine1,
                                    line2: row.temporaryLine2 || null,
                                    city: row.temporaryCity || "",
                                    state: row.temporaryState || "",
                                    zipCode: row.temporaryZip
                                        ? String(row.temporaryZip)
                                        : "",
                                    country: row.temporaryCountry || "",
                                },
                            });
                        }
                        else {
                            yield prisma.address.create({
                                data: {
                                    employeeId: employee.id,
                                    type: "TEMPORARY",
                                    line1: row.temporaryLine1,
                                    line2: row.temporaryLine2 || null,
                                    city: row.temporaryCity || "",
                                    state: row.temporaryState || "",
                                    zipCode: row.temporaryZip
                                        ? String(row.temporaryZip)
                                        : "",
                                    country: row.temporaryCountry || "",
                                },
                            });
                        }
                    }
                    logs.push(`Row ${i + 1}: SUCCESS (${code})`);
                }
                catch (error) {
                    errorRows.push(Object.assign({ rowNumber: i + 1, employeeCode: code, error: error.message }, row));
                    logs.push(`Row ${i + 1}: FAILED → ${error.message}`);
                }
            }
            return res.json({
                totalRows: rows.length,
                successCount: rows.length - errorRows.length,
                failedCount: errorRows.length,
                logs,
            });
        }));
    }
    catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Bulk update failed" });
    }
});
exports.bulkUpdateEmployeeExtras = bulkUpdateEmployeeExtras;
const bulkUploadLeaveBalance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const form = (0, formidable_1.default)({ multiples: false, keepExtensions: true });
        form.parse(req, (err, fields, files) => __awaiter(void 0, void 0, void 0, function* () {
            if (err) {
                return res.status(500).json({ error: "File parsing error" });
            }
            const fileObj = Array.isArray(files.file) ? files.file[0] : files.file;
            if (!fileObj) {
                return res.status(400).json({ error: "No file uploaded" });
            }
            const workbook = xlsx_1.default.readFile(fileObj.filepath);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = xlsx_1.default.utils.sheet_to_json(sheet);
            const logs = [];
            const errorRows = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                try {
                    const code = String(row.employeeCode).trim();
                    if (!code)
                        throw new Error("employeeCode missing");
                    const employee = yield prisma.employee.findUnique({
                        where: { employeeCode: code },
                    });
                    if (!employee)
                        throw new Error("Employee not found");
                    const year = Number(row.year);
                    const category = row.category;
                    let leaveTypeId = null;
                    let permissionType = null;
                    if (category === "LEAVE") {
                        if (!row.leaveType) {
                            throw new Error("leaveType required for LEAVE");
                        }
                        const leaveType = yield prisma.leaveType.findUnique({
                            where: { name: row.leaveType },
                        });
                        if (!leaveType) {
                            throw new Error(`Invalid leaveType: ${row.leaveType}`);
                        }
                        leaveTypeId = leaveType.id;
                        if (!leaveTypeId) {
                            throw new Error("leaveTypeId missing for LEAVE");
                        }
                    }
                    if (category === "PERMISSION") {
                        if (!row.permissionType) {
                            throw new Error("permissionType required for PERMISSION");
                        }
                        permissionType = row.permissionType;
                    }
                    const totalAllowed = Number(row.totalAllowed || 0);
                    const used = Number(row.used || 0);
                    const halfDayUsed = Number(row.halfDayUsed || 0);
                    // Upsert logic
                    // await prisma.employeeLeaveBalance.upsert({
                    //   where:
                    //     category === "LEAVE"
                    //       ? {
                    //         employeeId_leaveTypeId_year: {
                    //           employeeId: employee.id,
                    //           leaveTypeId: leaveTypeId,
                    //           year,
                    //         },
                    //       }
                    //       : {
                    //         employeeId_permissionType_year: {
                    //           employeeId: employee.id,
                    //           permissionType,
                    //           year,
                    //         },
                    //       },
                    //   update: {
                    //     totalAllowed,
                    //     used,
                    //     halfDayUsed,
                    //   },
                    //   create: {
                    //     employeeId: employee.id,
                    //     leaveTypeId: leaveTypeId,
                    //     permissionType,
                    //     category,
                    //     year,
                    //     totalAllowed,
                    //     used,
                    //     halfDayUsed,
                    //   },
                    // });
                    if (category === "LEAVE") {
                        if (!leaveTypeId) {
                            throw new Error("leaveTypeId missing for LEAVE");
                        }
                        yield prisma.employeeLeaveBalance.upsert({
                            where: {
                                employeeId_leaveTypeId_year: {
                                    employeeId: employee.id,
                                    leaveTypeId: leaveTypeId, // must be number
                                    year,
                                },
                            },
                            update: {
                                totalAllowed,
                                used,
                                halfDayUsed,
                            },
                            create: {
                                employeeId: employee.id,
                                leaveTypeId: leaveTypeId,
                                permissionType: null,
                                category,
                                year,
                                totalAllowed,
                                used,
                                halfDayUsed,
                            },
                        });
                    }
                    else if (category === "PERMISSION") {
                        if (!permissionType) {
                            throw new Error("permissionType missing for PERMISSION");
                        }
                        yield prisma.employeeLeaveBalance.upsert({
                            where: {
                                employeeId_permissionType_year: {
                                    employeeId: employee.id,
                                    permissionType: permissionType,
                                    year,
                                },
                            },
                            update: {
                                totalAllowed,
                                used,
                                halfDayUsed,
                            },
                            create: {
                                employeeId: employee.id,
                                leaveTypeId: null,
                                permissionType: permissionType,
                                category,
                                year,
                                totalAllowed,
                                used,
                                halfDayUsed,
                            },
                        });
                    }
                    logs.push(`Row ${i + 1}: SUCCESS (${code})`);
                }
                catch (e) {
                    logs.push(`Row ${i + 1}: FAILED → ${e.message}`);
                    errorRows.push(Object.assign({ row: i + 1, error: e.message }, row));
                }
            }
            return res.json({
                totalRows: rows.length,
                failed: errorRows.length,
                logs,
            });
        }));
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Upload failed" });
    }
});
exports.bulkUploadLeaveBalance = bulkUploadLeaveBalance;
// ── Probation Actions ──────────────────────────────────────────────────────
const extendProbation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const employeeId = Number(req.params.id);
        const { newEndDate, remarks } = req.body;
        const decidedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        if (!newEndDate)
            return res.status(400).json({ error: 'newEndDate is required' });
        const result = yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const emp = yield tx.employee.findUnique({ where: { id: employeeId } });
            if (!emp)
                throw new Error('Employee not found');
            if (!emp.probationStartDate || !emp.probationEndDate) {
                throw new Error('Employee has no active probation to extend');
            }
            // Close the current in-progress record as EXTENDED
            yield tx.probationRecord.updateMany({
                where: { employeeId, status: 'IN_PROGRESS' },
                data: {
                    status: 'EXTENDED',
                    decidedBy,
                    decidedOn: new Date(),
                    remarks: remarks !== null && remarks !== void 0 ? remarks : null,
                },
            });
            // Create a new IN_PROGRESS record for the extension
            const newRecord = yield tx.probationRecord.create({
                data: {
                    employeeId,
                    startDate: emp.probationEndDate,
                    endDate: new Date(newEndDate),
                    status: 'IN_PROGRESS',
                    remarks: remarks !== null && remarks !== void 0 ? remarks : null,
                },
            });
            // Update employee snapshot
            const updated = yield tx.employee.update({
                where: { id: employeeId },
                data: {
                    probationEndDate: new Date(newEndDate),
                    probationStatus: 'IN_PROGRESS',
                    probationRemarks: remarks !== null && remarks !== void 0 ? remarks : null,
                },
            });
            return { employee: updated, record: newRecord };
        }));
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
    }
});
exports.extendProbation = extendProbation;
const confirmProbation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const employeeId = Number(req.params.id);
        const { confirmedOn, remarks } = req.body;
        const decidedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        const when = confirmedOn ? new Date(confirmedOn) : new Date();
        const result = yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Close the current IN_PROGRESS record as CONFIRMED
            yield tx.probationRecord.updateMany({
                where: { employeeId, status: 'IN_PROGRESS' },
                data: {
                    status: 'CONFIRMED',
                    decidedBy,
                    decidedOn: when,
                    remarks: remarks !== null && remarks !== void 0 ? remarks : null,
                },
            });
            const updated = yield tx.employee.update({
                where: { id: employeeId },
                data: {
                    probationStatus: 'CONFIRMED',
                    probationConfirmedOn: when,
                    probationConfirmedBy: decidedBy,
                    probationRemarks: remarks !== null && remarks !== void 0 ? remarks : null,
                    employmentType: 'PERMANENT',
                },
            });
            return updated;
        }));
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
    }
});
exports.confirmProbation = confirmProbation;
const terminateProbation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const employeeId = Number(req.params.id);
        const { remarks } = req.body;
        const decidedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a.empId) !== null && _b !== void 0 ? _b : null;
        const result = yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            yield tx.probationRecord.updateMany({
                where: { employeeId, status: 'IN_PROGRESS' },
                data: {
                    status: 'TERMINATED',
                    decidedBy,
                    decidedOn: new Date(),
                    remarks: remarks !== null && remarks !== void 0 ? remarks : null,
                },
            });
            const updated = yield tx.employee.update({
                where: { id: employeeId },
                data: {
                    probationStatus: 'TERMINATED',
                    probationRemarks: remarks !== null && remarks !== void 0 ? remarks : null,
                    employmentStatus: 'TERMINATED',
                },
            });
            return updated;
        }));
        // Probation termination → kill the employee's access.
        try {
            yield (0, employeeAccess_1.revokeEmployeeAccess)(employeeId, 'Probation terminated');
        }
        catch (e) {
            console.error('[probation-terminate] revokeEmployeeAccess failed:', e);
        }
        res.json(result);
    }
    catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
    }
});
exports.terminateProbation = terminateProbation;
const getProbationHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.id);
        const records = yield prisma.probationRecord.findMany({
            where: { employeeId },
            orderBy: { createdAt: 'asc' },
        });
        res.json(records);
    }
    catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
    }
});
exports.getProbationHistory = getProbationHistory;
/* ════════════════════════════════════════════════════════════════════
   EMPLOYEE AUDIT LOG
   GET /api/employees/:id/audit-log
   Filters: field, source, changedBy, from, to, page, pageSize
   ════════════════════════════════════════════════════════════════════ */
const getEmployeeAuditLog = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const employeeId = Number(req.params.id);
        if (!employeeId)
            return res.status(400).json({ error: "employeeId required" });
        const { field, source, changedBy, from, to, page = '1', pageSize = '50' } = req.query;
        const where = { employeeId };
        if (source)
            where.source = String(source);
        if (changedBy)
            where.changedBy = Number(changedBy);
        if (from || to) {
            where.changedAt = {};
            if (from)
                where.changedAt.gte = new Date(String(from));
            if (to)
                where.changedAt.lte = new Date(String(to));
        }
        const take = Math.min(200, Number(pageSize) || 50);
        const skip = (Math.max(1, Number(page) || 1) - 1) * take;
        const [rows, total] = yield Promise.all([
            prisma.employeeAuditLog.findMany({
                where,
                orderBy: { changedAt: 'desc' },
                take, skip,
                include: {
                    changedByEmployee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
                },
            }),
            prisma.employeeAuditLog.count({ where }),
        ]);
        let filtered = rows;
        if (field) {
            const f = String(field);
            // changedFields is JSON; client-side filter is safer than brittle JSON path queries.
            filtered = rows.filter((r) => Array.isArray(r.changedFields) && r.changedFields.includes(f));
        }
        return res.json({ total: field ? filtered.length : total, rows: filtered });
    }
    catch (err) {
        console.error("getEmployeeAuditLog error:", err);
        return res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to load audit log" });
    }
});
exports.getEmployeeAuditLog = getEmployeeAuditLog;
/** Bulk audit-log query — for HR's "everyone whose salary changed last month" view. */
const queryAuditLog = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { field, source, changedBy, from, to, page = '1', pageSize = '50' } = req.query;
        const where = {};
        if (source)
            where.source = String(source);
        if (changedBy)
            where.changedBy = Number(changedBy);
        if (from || to) {
            where.changedAt = {};
            if (from)
                where.changedAt.gte = new Date(String(from));
            if (to)
                where.changedAt.lte = new Date(String(to));
        }
        const take = Math.min(200, Number(pageSize) || 50);
        const skip = (Math.max(1, Number(page) || 1) - 1) * take;
        const [rows, total] = yield Promise.all([
            prisma.employeeAuditLog.findMany({
                where,
                orderBy: { changedAt: 'desc' },
                take, skip,
                include: {
                    employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
                    changedByEmployee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
                },
            }),
            prisma.employeeAuditLog.count({ where }),
        ]);
        let filtered = rows;
        if (field) {
            const f = String(field);
            filtered = rows.filter((r) => Array.isArray(r.changedFields) && r.changedFields.includes(f));
        }
        return res.json({ total: field ? filtered.length : total, rows: filtered });
    }
    catch (err) {
        console.error("queryAuditLog error:", err);
        return res.status(500).json({ error: (err === null || err === void 0 ? void 0 : err.message) || "Failed to load audit log" });
    }
});
exports.queryAuditLog = queryAuditLog;
