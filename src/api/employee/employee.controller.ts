import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { revokeEmployeeAccess } from "../../lib/employeeAccess";
import { withEmployeeScope, guardInScope } from "../../lib/dataScope";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { buildEmployeeDiff, auditCtxFromReq } from "../../lib/employeeAudit";
import type { Prisma } from "@prisma/client";
const prisma = new PrismaClient();
import formidable from "formidable";
import fs from "fs";
// Legacy FTP upload (kept for reference / fallback). Files now go to local disk.
// import { Client } from "basic-ftp";
import { saveLocal, publicUrl, deleteLocal } from "../../lib/fileStorage";
import path from "path";
import { $Enums } from '@prisma/client';
import { createNotification } from "../notifications/notifications.controller";
import { ShiftAssignMode } from "@prisma/client";
import XLSX from "xlsx";
import { connect } from "http2";
import { Employee } from "@prisma/client";
import bcrypt from "bcryptjs";
import cron from 'node-cron';
import { syncEmployeeToDirectory, deactivateEmployeeInDirectory } from "../../lib/directory";
import { allocateNewJoineeLeave, getLeaveStartMode } from "../leave/leave.controller";
import { config } from "../../config";


// Legacy FTP credentials — no longer used now that uploads are stored locally.
// const FTP_CONFIG = {
//   host: config.ftp.host,
//   user: config.ftp.user,
//   password: config.ftp.pass,
//   secure: config.ftp.secure,
// }
const TEMP_FOLDER = path.join(__dirname, '../temp'); // absolute path

if (!fs.existsSync(TEMP_FOLDER)) {
  fs.mkdirSync(TEMP_FOLDER, { recursive: true });
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
const EMPLOYEE_PREFIX_MAP: Record<string, string> = {
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




async function generateEmployeeCode(employmentType: string) {
  const basePrefix = config.employeeCode.prefix || 'EMP';

  const suffix =
    EMPLOYEE_PREFIX_MAP[employmentType?.toUpperCase()] ?? '';

  const prefix = `${basePrefix}${suffix}`;

  const startNumber = config.employeeCode.start || '001';

  const lastEmployee = await prisma.employee.findFirst({
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

  console.log(lastEmployee)

  let newCode = `${prefix}${startNumber}`;

  if (lastEmployee?.employeeCode) {
    const lastNumber = parseInt(
      lastEmployee.employeeCode.replace(/\D/g, ''),
      10
    );

    newCode = `${prefix}${String(lastNumber + 1).padStart(3, '0')}`;
  }

  return newCode;
}

// CREATE Employee (with emergency contacts & qualifications)
export const createEmployee = async (req: Request, res: Response) => {
  try {
    const {
      employeeCode,
      referenceCode,
      firstName,
      lastName,
      gender,
      dob,
      photoUrl,
      phone,
      email,
      designation,
      designationId,
      departmentId,
      branchId,
      dateOfJoining,
      employmentType,
      probationStartDate,
      probationEndDate,
      probationStatus,
      probationConfirmedOn,
      probationConfirmedBy,
      probationRemarks,
      employmentStatus,
      emergencyContacts,
      qualifications,
      addresses,
      roleId,
      bloodGroup,
      reportingManager,
      age,
      shiftMode,            // 'FIXED' | 'ROTATIONAL' (optional)
      fixedShiftId,         // optional
      rotationPatternId,    // optional
      rotationStartDate,     // optional
      employeeType,
      sameAsPermanent,
      inchargeId,
      fatherName,
      marital,
      totalYearsOfExperience,
      experience,
      licenseRegDate,
      licenseExpiryDate,
      motherName,
      alternatePhone,
      uanNumber,
      panNumber,
      aadharNumber,
      licenseNumber,
      geoTrackingEnabled,
      overtimeEnabled,
      experienceType
    } = req.body;
    const data = req.body;

    if (
      reportingManager && inchargeId &&
      Number(reportingManager) === Number(inchargeId)
    ) {
      return res.status(400).json({
        error: "Reporting Manager and Incharge cannot be the same person",
      });
    }

    let finalCode = employeeCode;
    console.log(finalCode)

    if (!finalCode) {
      finalCode = await generateEmployeeCode(employmentType);
      console.log("Generated employeeCode:", finalCode);
    }

    let newEmployee;
    try {

      newEmployee = await prisma.employee.create({
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
          probationStatus: probationStatus ?? null,
          probationConfirmedOn: probationConfirmedOn ? new Date(probationConfirmedOn) : null,
          probationConfirmedBy: probationConfirmedBy ?? null,
          probationRemarks: probationRemarks ?? null,
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
          geoTrackingEnabled: geoTrackingEnabled ?? false,
          overtimeEnabled: overtimeEnabled ?? false,
          // Biometric is the default; BOTH adds mobile (set via the form toggle).
          attendanceMode: data.attendanceMode ?? 'BIOMETRIC',
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
          visionType: data.visionType,          // e.g., 'NEAR', 'DISTANT', 'COLOR_BLIND'
          usesGlasses: data.usesGlasses,
          visionRemarks: data.visionRemarks,
          hasDisability: data.hasDisability,
          disabilityType: data.disabilityType,        // e.g., 'PHYSICAL', 'HEARING', 'MENTAL', etc.
          disabilityDescription: data.disabilityDescription,
          disabilityProofFile: data.disabilityProofFile,   // original file name
          disabilityProofFileName: data.disabilityProofFileName, // sanitized file name on server
          disabilityProofUrl: data.disabilityProofUrl,      // URL to access the file

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
            create: addresses?.map((a: any) => ({
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
            create: emergencyContacts?.map((ec: any) => ({
              name: ec.name,
              phone: ec.phone,
              relationship: ec.relationship
            }))
          },
          qualifications: {
            create: qualifications?.map((q: any) => ({
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
    catch (err: any) {
      if (err.code === 'P2002' && err.meta?.target?.includes('employeeCode')) {
        // Regenerate a fresh code and retry

        finalCode = await generateEmployeeCode(employmentType);
        console.log(finalCode)
        newEmployee = await prisma.employee.create({
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
            probationStatus: probationStatus ?? null,
            probationConfirmedOn: probationConfirmedOn ? new Date(probationConfirmedOn) : null,
            probationConfirmedBy: probationConfirmedBy ?? null,
            probationRemarks: probationRemarks ?? null,
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
              create: addresses?.map((a: any) => ({
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
              create: emergencyContacts?.map((ec: any) => ({
                name: ec.name,
                phone: ec.phone,
                relationship: ec.relationship
              }))
            },
            qualifications: {
              create: qualifications?.map((q: any) => ({
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
      } else {
        throw err;
      }
    }
    // NEW: persist shift assignment mode
    if (shiftMode === 'FIXED' && fixedShiftId) {
      await prisma.employeeShiftSetting.create({
        data: {
          employeeId: newEmployee.id,
          mode: 'FIXED',
          fixedShiftId,
          startDate: new Date()
        }
      });
    } else if (shiftMode === 'ROTATIONAL' && rotationPatternId) {
      await prisma.employeeShiftSetting.create({
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
    if (
      employmentType === 'PROBATION' &&
      newEmployee.probationStartDate &&
      newEmployee.probationEndDate
    ) {
      await prisma.probationRecord.create({
        data: {
          employeeId: newEmployee.id,
          startDate: newEmployee.probationStartDate,
          endDate: newEmployee.probationEndDate,
          status: probationStatus ?? 'IN_PROGRESS',
          remarks: probationRemarks ?? null,
        },
      });
      if (!probationStatus) {
        await prisma.employee.update({
          where: { id: newEmployee.id },
          data: { probationStatus: 'IN_PROGRESS' },
        });
      }
    }

    // DOJ-mode leave accrual: credit pro-rata CL & SL from the Date of Joining
    // (probation period is ignored). In PROBATION_END mode the new-joinee cron
    // credits these on the probation end date instead, so we skip it here.
    if (getLeaveStartMode() === "DOJ" && newEmployee.dateOfJoining) {
      try {
        await allocateNewJoineeLeave(
          newEmployee.id,
          new Date(newEmployee.dateOfJoining)
        );
      } catch (err) {
        // Non-fatal: don't fail employee creation if leave seeding fails.
        console.error(
          `DOJ leave allocation failed for emp ${newEmployee.id}:`,
          err
        );
      }
    }

    // Push to central directory so the unified mobile app can resolve this phone
    syncEmployeeToDirectory(newEmployee).catch(() => { /* non-blocking */ });

    return res.status(201).json(newEmployee);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to create employee" });
  }
};

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
export const getEmployees = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const page = Number(req.query.page ?? 1);
    const pageSize = Math.min(Number(req.query.pageSize ?? 10), 50); // max = 50
    const skip = (page - 1) * pageSize;

    const where: any = {};
    const filter = req.query.filter as string;
    const search = req.query.search as string;

    // Generic search — when `search` is given WITHOUT a specific `filter`,
    // match across name, employee code and email. (Used by the autocomplete
    // pickers in HR Corrections, leave-apply, etc. — which only send `search`.)
    if (search && !filter) {
      where.OR = [
        { firstName:    { contains: search } },
        { lastName:     { contains: search } },
        { employeeCode: { contains: search } },
        { email:        { contains: search } },
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

          const match = statuses.filter(s =>
            s.toLowerCase().includes(search.toLowerCase())
          );

          if (match.length > 0) {
            where.employmentStatus = { in: match };
          } else {
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

    // Narrow to the caller's assigned branches/departments. A caller with no
    // scope rows is global and `scopedWhere` comes back identical to `where`,
    // so this is a no-op for everyone who hasn't been explicitly restricted.
    // Merged via withEmployeeScope rather than assigning onto `where` because
    // the search filters above may already have set `where.OR`.
    const scopedWhere = await withEmployeeScope(Number(req.user?.empId ?? 0), where);

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        skip,
        take: pageSize,
        where: scopedWhere,
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
          attendanceMode: true,
          Department: { select: { id: true, name: true } },
          Branch: { select: { id: true, name: true, attendanceMode: true } },
          shifts: {
            orderBy: { date: "desc" },
            take: 1,
            include: { shift: true },
          },
        },
      }),
      // Must use the SAME scoped where — counting with the unscoped filter
      // would report the full headcount and page count to a branch-scoped HR.
      prisma.employee.count({ where: scopedWhere }),
    ]);

    res.json({
      data: employees,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Failed to fetch employees" });
  }
};


// GET single employee by ID
export const getEmployeeById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Scoping the list alone would be cosmetic — the record is still one
    // guessable id away. No-op for a global caller.
    if (!(await guardInScope(req, res, Number(id)))) return;

    const employee = await prisma.employee.findUnique({
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
          take: 1,                   // Only 1 record
          include: {
            shift: true              // Include shift template details
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
    const formatted = {
      ...employee,
      latestShiftAssignment: employee.shifts[0] || null,
      departmentName: employee.Department?.name || null, // ✅ extract department name
    };

    res.json(formatted);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch employee" });
  }
};


export const updateEmployee = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Editing someone outside your branch is the failure that actually costs —
    // guard the write, not just the read.
    if (!(await guardInScope(req, res, Number(id)))) return;

    const data = req.body;

    const {
      addresses,
      emergencyContacts,
      qualifications,
      departmentId,
      designationId,
      branchId,
      roleId,
      shiftMode,             // 'FIXED' | 'ROTATIONAL' | undefined
      fixedShiftId,          // number | undefined
      rotationPatternId,     // number | undefined
      rotationStartDate,     // ISO string | undefined
      dob,
      dateOfJoining,
      probationStartDate,
      probationEndDate,
      probationConfirmedOn,
      inchargeId,
      preEmploymentCheckDate,
      fatherName,
      marital,
      totalYearsOfExperience,
      experience,
      experienceType,
      ...employeeFields
    } = data;

    if (
      data.reportingManager && inchargeId &&
      Number(data.reportingManager) === Number(inchargeId)
    ) {
      return res.status(400).json({
        error: "Reporting Manager and Incharge cannot be the same person",
      });
    }

    const toDate = (v: any) => (v ? new Date(v) : null);

    employeeFields.dob = toDate(dob) ?? undefined;
    employeeFields.dateOfJoining = toDate(dateOfJoining) ?? undefined;
    employeeFields.probationStartDate = toDate(probationStartDate);
    employeeFields.probationEndDate = toDate(probationEndDate);
    employeeFields.probationConfirmedOn = toDate(probationConfirmedOn);

    // ── Capture the BEFORE state. We need the full row (scalars +
    // user-editable relations) so the audit log can record every field
    // that changed, including address / emergency contact / qualification
    // edits which live in separate tables.
    const beforeRow = await prisma.employee.findUnique({
      where: { id: Number(id) },
      include: {
        Address: true,
        emergencyContacts: true,
        qualifications: true,
      },
    });
    const beforeStatus = beforeRow?.employmentStatus;

    const updatedEmployee = await prisma.employee.update({
      where: { id: Number(id) },
      data: {
        ...employeeFields,
        experienceType: data.experienceType,
        // Health & Wellness fields
        preEmploymentCheckDate: preEmploymentCheckDate ? new Date(preEmploymentCheckDate) : null,
        height: data.height ? parseFloat(data.height) : null,
        weight: data.weight ? parseFloat(data.weight) : null,
        bmi: data.bmi ? parseFloat(data.bmi) : null,
        bloodPressure: data.bloodPressure,
        bloodSugar: data.bloodSugar,
        cholesterol: data.cholesterol,
        sameAsPermanent: data.sameAsPermanent,
        fatherName: data.fatherName,
        marital: data.marital,
        totalYearsOfExperience: data.totalYearsOfExperience,
        experience: data.experience,

        allergies: data.allergies,
        chronicConditions: data.chronicConditions,

        // designationId: designationId ?? null, // ✅ THIS IS THE FIX

        smoking: data.smoking,
        alcohol: data.alcohol,

        visionType: data.visionType,          // e.g., 'NEAR', 'DISTANT', 'COLOR_BLIND'
        usesGlasses: data.usesGlasses,
        visionRemarks: data.visionRemarks,
        hasDisability: data.hasDisability,
        disabilityType: data.disabilityType,        // e.g., 'PHYSICAL', 'HEARING', 'MENTAL', etc.
        disabilityDescription: data.disabilityDescription,
        disabilityProofFile: data.disabilityProofFile,   // original file name
        disabilityProofFileName: data.disabilityProofFileName, // sanitized file name on server
        disabilityProofUrl: data.disabilityProofUrl,

        preferredHospital: data.preferredHospital,
        primaryPhysician: data.primaryPhysician,
        emergencyNotes: data.emergencyNotes,

        geoTrackingEnabled: data.geoTrackingEnabled,
        overtimeEnabled: data.overtimeEnabled,
        // Biometric is the default; BOTH adds mobile (set via the form toggle).
        attendanceMode: data.attendanceMode ?? 'BIOMETRIC',


        motherName: data.motherName,
        alternatePhone: data.alternatePhone,
        uanNumber: data.uanNumber,
        panNumber: data.panNumber,
        aadharNumber: data.aadharNumber,
        licenseNumber: data.licenseNumber,
        licenseRegDate: toDate(data.licenseRegDate),
        licenseExpiryDate: toDate(data.licenseExpiryDate),
        pastSurgeries: data.pastSurgeries,
        exerciseFrequency: data.exerciseFrequency,


        healthIssues: data.healthIssues ? JSON.stringify(data.healthIssues) : undefined,
        vaccinations: data.vaccinations ? JSON.stringify(data.vaccinations) : undefined,
        Department: { connect: { id: departmentId } },
        Branch: { connect: { id: branchId } },
        role: { connect: { id: roleId } },
        designation: { connect: { id: designationId } },
        incharge: inchargeId
          ? { connect: { id: Number(inchargeId) } }
          : { disconnect: true },
        Address: {
          deleteMany: {},
          create: addresses?.map((a: any) => ({
            type: a.type,
            line1: a.line1,
            line2: a.line2,
            city: a.city,
            state: a.state,
            zipCode: a.zipCode,
            country: a.country
          }))
        },
        emergencyContacts: {
          deleteMany: {},
          create: emergencyContacts?.map((c: any) => ({
            name: c.name,
            phone: c.phone,
            relationship: c.relationship
          }))
        },
        qualifications: {
          deleteMany: {},
          create: qualifications?.map((q: any) => ({
            degree: q.degree,
            institution: q.institution,
            year: q.year
          }))
        }
      },
      include: {
        Address: true,
        emergencyContacts: true,
        qualifications: true,
        EmployeeShiftSetting: true,
        designation: true
      }
    });

    // ── Geo-tracking request: when HR turns ON tracking for this employee
    // (false/null → true), push a consent request to their phone. Only on the
    // transition, so re-saving the form doesn't re-notify.
    if (!beforeRow?.geoTrackingEnabled && updatedEmployee.geoTrackingEnabled) {
      await createNotification(
        Number(id),
        'Your organization has requested location tracking for work sessions. Open HRMinds → Settings to review and give your consent.',
      );
    }

    // ── Audit log: record the diff between before and after.
    // Two layers of comparison:
    //   (1) Scalar fields on the Employee row (designation, dept, role,
    //       personal info, etc.) via the shared buildEmployeeDiff helper.
    //   (2) User-editable relations (Address, emergencyContacts,
    //       qualifications) — compared as normalised JSON arrays so we
    //       can capture "Added 1 address" or "Removed an emergency contact"
    //       even though the underlying rows are deleted-and-recreated.
    try {
      const afterRow = await prisma.employee.findUnique({
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
        const stripRelations = (r: any) => {
          const { Address, emergencyContacts, qualifications, ...rest } = r;
          return rest;
        };
        const diff = buildEmployeeDiff(stripRelations(beforeRow), stripRelations(afterRow)) ?? {
          changes: {} as Record<string, { from: any; to: any }>,
          changedFields: [] as string[],
        };

        // (2) Relation diffs — normalise (drop ids/timestamps) and JSON-compare.
        const normaliseRel = (rows: any[] | undefined, fields: string[]) =>
          (rows ?? [])
            .map((r) => {
              const out: Record<string, any> = {};
              for (const f of fields) out[f] = r[f] ?? null;
              return out;
            })
            // Sort so the comparison is order-independent
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

        const compareRel = (key: string, fields: string[]) => {
          const before = normaliseRel((beforeRow as any)[key], fields);
          const after  = normaliseRel((afterRow as any)[key], fields);
          if (JSON.stringify(before) !== JSON.stringify(after)) {
            (diff.changes as any)[key] = { from: before, to: after };
            diff.changedFields.push(key);
          }
        };
        compareRel('Address',           ['type', 'line1', 'line2', 'city', 'state', 'zipCode', 'country']);
        compareRel('emergencyContacts', ['name', 'phone', 'relationship']);
        compareRel('qualifications',    ['degree', 'institution', 'year']);

        if (diff.changedFields.length > 0) {
          const ctx = auditCtxFromReq(req, { source: 'WEB' });
          await (prisma as any).employeeAuditLog.create({
            data: {
              employeeId: Number(id),
              action: 'UPDATE',
              changes: diff.changes,
              changedFields: diff.changedFields,
              changedBy: ctx.changedBy ?? null,
              source: ctx.source ?? 'WEB',
              ipAddress: ctx.ip ?? null,
              userAgent: ctx.userAgent ?? null,
            },
          });
        }
      }
    } catch (auditErr) {
      // Audit failures must NEVER break the user flow. Log and move on.
      console.error("[updateEmployee audit] failed:", auditErr);
    }

    // 2) upsert EmployeeShiftSetting (simple & type-safe)
    // map 'FIXED' | 'ROTATIONAL' -> Prisma enum
    const mode: $Enums.ShiftAssignMode | undefined =
      shiftMode === 'FIXED'
        ? $Enums.ShiftAssignMode.FIXED
        : shiftMode === 'ROTATIONAL'
          ? $Enums.ShiftAssignMode.ROTATIONAL
          : undefined;

    if (mode) {
      const fixedId =
        fixedShiftId !== undefined && fixedShiftId !== null && fixedShiftId !== ''
          ? Number(fixedShiftId)
          : null;

      const rotId =
        rotationPatternId !== undefined && rotationPatternId !== null && rotationPatternId !== ''
          ? Number(rotationPatternId)
          : null;

      const start = rotationStartDate ? new Date(rotationStartDate) : new Date();

      await prisma.employeeShiftSetting.upsert({
        where: { employeeId: updatedEmployee.id }, // unique on employeeId
        create: {
          employeeId: updatedEmployee.id,
          mode,
          fixedShiftId: mode === $Enums.ShiftAssignMode.FIXED ? fixedId : null,
          rotationPatternId: mode === $Enums.ShiftAssignMode.ROTATIONAL ? rotId : null,
          startDate: start,
        },
        update: {
          mode,
          fixedShiftId: mode === $Enums.ShiftAssignMode.FIXED ? fixedId : null,
          rotationPatternId: mode === $Enums.ShiftAssignMode.ROTATIONAL ? rotId : null,
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
    if (
      updatedEmployee.probationStartDate &&
      updatedEmployee.probationEndDate
    ) {
      const allRecords = await prisma.probationRecord.findMany({
        where: { employeeId: updatedEmployee.id },
        orderBy: { createdAt: 'desc' },
      });
      const inProgress = allRecords.find((r) => r.status === 'IN_PROGRESS');

      if (inProgress) {
        // Correction: keep the current active record in sync with the form
        await prisma.probationRecord.update({
          where: { id: inProgress.id },
          data: {
            startDate: updatedEmployee.probationStartDate,
            endDate: updatedEmployee.probationEndDate,
            remarks: updatedEmployee.probationRemarks ?? null,
          },
        });
      } else if (allRecords.length === 0) {
        // Backfill: no records yet → create the first record using the form status.
        // If status is a terminal one (CONFIRMED/TERMINATED/WAIVED/EXTENDED) we stamp decidedOn
        // so the history panel shows when the decision was taken.
        const formStatus = (updatedEmployee.probationStatus as any) || 'IN_PROGRESS';
        const isTerminal = formStatus !== 'IN_PROGRESS';
        await prisma.probationRecord.create({
          data: {
            employeeId: updatedEmployee.id,
            startDate: updatedEmployee.probationStartDate,
            endDate: updatedEmployee.probationEndDate,
            status: formStatus,
            remarks: updatedEmployee.probationRemarks ?? null,
            decidedOn: isTerminal
              ? (updatedEmployee.probationConfirmedOn ?? new Date())
              : null,
          },
        });
        if (!updatedEmployee.probationStatus) {
          await prisma.employee.update({
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
    syncEmployeeToDirectory(updatedEmployee).catch(() => { /* non-blocking */ });

    // ── Status-transition revoke ──────────────────────────────
    // If this update flipped the employee from an active state
    // (ACTIVE / NOTICE_PERIOD) to a non-active state (TERMINATED /
    // RESIGNED / SUSPENDED / SABBATICAL), wipe their device tokens,
    // mobile sessions and stamp accessRevokedAt. Catches the gap where
    // HR uses the generic PUT /employees/:id instead of the dedicated
    // terminate / sabbatical endpoints.
    const ACTIVE = new Set(['ACTIVE', 'NOTICE_PERIOD']);
    const wasActive = ACTIVE.has(String(beforeStatus));
    const isActive  = ACTIVE.has(String(updatedEmployee.employmentStatus));
    if (wasActive && !isActive) {
      try {
        await revokeEmployeeAccess(
          Number(id),
          `Status changed via updateEmployee: ${beforeStatus} → ${updatedEmployee.employmentStatus}`,
        );
      } catch (e) {
        console.error('[updateEmployee] revokeEmployeeAccess failed:', e);
      }
    }

    res.json(updatedEmployee);
  } catch (error) {
    console.error(error); // <-- log actual error
    res.status(500).json({ error: "Failed to update employee" });
  }
};

// DELETE employee
export const deleteEmployee = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!(await guardInScope(req, res, Number(id)))) return;

    // Capture phone first so we can deactivate the directory entry after delete
    const employee = await prisma.employee.findUnique({
      where: { id: Number(id) },
      select: { phone: true },
    });

    await prisma.employee.delete({
      where: { id: Number(id) }
    });

    if (employee?.phone) {
      deactivateEmployeeInDirectory(employee.phone).catch(() => { /* non-blocking */ });
    }

    res.json({ message: "Employee deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete employee" });
  }
};
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/\s+/g, '_'); // replace spaces with underscore
}

async function uploadToFTP(localFilePath: string, remoteFileName: string): Promise<any> {
  // ── Local disk storage (current) ──────────────────────────────────────────
  // remoteFileName is a legacy "/public_html/<folder>/<file>" path; saveLocal
  // strips the prefix and stores it under UPLOADS_DIR/<folder>/<file>.
  await saveLocal(localFilePath, remoteFileName);

  // ── Legacy FTP upload (kept for reference / fallback) ─────────────────────
  // const client = new Client();
  // client.ftp.verbose = false;
  // try {
  //   await client.access(FTP_CONFIG);
  //   const folder = path.dirname(remoteFileName);
  //   await client.ensureDir(folder);
  //   console.log(remoteFileName)
  //   await client.uploadFrom(localFilePath, remoteFileName);
  //   await client.close();
  //
  //   // return `https://hrproindia.in/documents/${remoteFileName}`; // public URL
  // } catch (error) {
  //   console.error("FTP Upload Error:", error);
  //   throw new Error("FTP upload failed");
  // }
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
export const uploadEmployeeDocuments = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    if (Number.isNaN(employeeId)) {
      return res.status(400).json({ error: "Invalid employeeId" });
    }

    const form = formidable({
      uploadDir: TEMP_FOLDER,
      keepExtensions: true,
      multiples: true
    });

    form.parse(req, async (err, fields, files) => {
      try {
        if (err) {
          console.error("Formidable error:", err);
          return res.status(500).json({ error: err.message });
        }

        /* -------------------- 1️⃣ Metadata -------------------- */
        const metadata: any[] = JSON.parse(
          (fields.metadata?.[0] as string) || "[]"
        );

        /* -------------------- 2️⃣ File Keys -------------------- */
        const rawKeys = fields.fileKey;
        const fileKeys: string[] = Array.isArray(rawKeys)
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
        const fileMap = new Map<string, any>();
        uploadedFiles.forEach((file, i) => {
          fileMap.set(fileKeys[i], file);
        });

        const savedDocuments: any[] = [];

        /* -------------------- 5️⃣ Process Documents (SAFE LOOP) -------------------- */
        for (const meta of metadata) {
          if (!meta?.type) continue;

          const issueDate = meta.issueDate ? new Date(meta.issueDate) : null;
          const expiryDate = meta.expiryDate ? new Date(meta.expiryDate) : null;

          let newFileUrl: string | null = null;
          const file = meta.fileKey ? fileMap.get(meta.fileKey) : null;

          if (file?.filepath) {
            const safeName = sanitizeFileName(
              file.originalFilename || `doc_${employeeId}_${Date.now()}`
            );

            const remotePath = `/public_html/documents/${safeName}`;
            await uploadToFTP(file.filepath, remotePath); // now stores to local disk

            try {
              fs.unlinkSync(file.filepath);
            } catch { }

            // newFileUrl = `https://hrproindia.in/documents/${safeName}`; // legacy FTP URL
            newFileUrl = publicUrl(remotePath);
          }

          /* ---------- UPDATE EXISTING DOCUMENT ---------- */
          if (meta.id) {
            const updated = await prisma.document.update({
              where: { id: Number(meta.id) },
              data: {
                employeeId,
                title: meta.title || meta.type,
                category: meta.category,
                type: meta.type,
                issueDate,
                expiryDate,
                ...(newFileUrl ? { fileUrl: newFileUrl } : {})
              }
            });

            savedDocuments.push(updated);
          }

          /* ---------- CREATE NEW DOCUMENT ---------- */
          else if (newFileUrl) {
            const created = await prisma.document.create({
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
      } catch (e: any) {
        console.error("Upload inner error:", e);
        return res.status(500).json({ error: e.message });
      }
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    return res.status(500).json({ error: error.message });
  }
};



export const uploadEmployeePhoto = async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.params;

    const form = formidable({
      uploadDir: TEMP_FOLDER,
      keepExtensions: true,
      multiples: false, // only one file
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error("Formidable Parse Error:", err);
        return res.status(500).json({ error: err.message });
      }

      if (!files.file) {
        return res.status(400).json({ error: "No photo uploaded" });
      }

      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      const tempFilePath = file.filepath;
      const fileName = sanitizeFileName(
        file.originalFilename || `photo_${employeeId}_${Date.now()}.png`
      );

      const remoteFilePath = `/public_html/photos/${fileName}`;
      await uploadToFTP(tempFilePath, remoteFilePath);
      // const fileUrl = `https://hrproindia.in/photos/${fileName}`; // legacy FTP URL
      const fileUrl = publicUrl(remoteFilePath);

      fs.unlinkSync(tempFilePath); // cleanup temp file

      // Update employee record with new photoUrl
      const updatedEmployee = await prisma.employee.update({
        where: { id: Number(employeeId) },
        data: { photoUrl: fileUrl },
      });

      return res.status(200).json({ photoUrl: fileUrl, employee: updatedEmployee });
    });
  } catch (error) {
    console.error("Upload Photo Error:", error);
    return res.status(500).json({ error: "Failed to upload profile photo" });
  }
};

export const uploadEmployeeDisabilityProof = async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.params;

    if (!employeeId) {
      return res.status(400).json({ error: "Employee code is required" });
    }

    const form = formidable({
      uploadDir: TEMP_FOLDER,
      keepExtensions: true,
      multiples: false, // only one disability certificate
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error("Formidable Parse Error:", err);
        return res.status(500).json({ error: err.message });
      }

      if (!files.file) {
        return res.status(400).json({ error: "No disability proof file uploaded" });
      }

      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      const tempFilePath = file.filepath;

      const fileName = sanitizeFileName(
        file.originalFilename || `disability_${employeeId}_${Date.now()}${path.extname(file.filepath)}`
      );

      const remoteFilePath = `/public_html/disability/${fileName}`;
      await uploadToFTP(tempFilePath, remoteFilePath);
      // const fileUrl = `https://hrproindia.in/disability/${fileName}`; // legacy FTP URL
      const fileUrl = publicUrl(remoteFilePath);

      // cleanup local temp file
      fs.unlinkSync(tempFilePath);

      // Update employee record
      const updatedEmployee = await prisma.employee.update({
        where: { id: Number(employeeId) },
        data: { disabilityProofUrl: fileUrl },
      });

      return res.status(200).json({
        success: true,
        message: "Disability certificate uploaded successfully",
        fileUrl,
        employee: updatedEmployee,
      });
    });
  } catch (error: any) {
    console.error("Upload Disability Proof Error:", error);
    return res.status(500).json({ error: "Failed to upload disability certificate" });
  }
};


export const getSpecificRoles = async (req: Request, res: Response) => {
  try {
    const roleIds = [1, 3, 4]; // roles to filter

    const employees = await prisma.employee.findMany({
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
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to fetch employees" });
  }
};

export const getEmployeesByRole = async (req: Request, res: Response) => {
  try {
    const roleId = Number(req.query.roleId);

    if (!roleId) {
      return res.status(400).json({ error: "roleId is required" });
    }

    const employees = await prisma.employee.findMany({
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
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to fetch employees" });
  }
};

export const getActiveEmployees = async (req: Request, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      where: {
        employmentStatus: 'ACTIVE'
      },
      select: { id: true, firstName: true, lastName: true, branchId: true, departmentId: true, employeeCode: true, roleId: true, designationId: true}
    });
    res.json(employees);
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
};


type AccrualRow = {
  category: 'Leave' | 'WFH' | 'Permission';
  entitlement: number;       // Leave/WFH in days, Permission in hours
  accruedToDate: number;     // ditto
  used: number;              // ditto
  balance: number;           // ditto
};

export async function getAccruals(employeeId: number, asOf = new Date()): Promise<AccrualRow[]> {
  // 1) employee & policy
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { dateOfJoining: true },
  });
  if (!employee) throw new Error('Employee not found');

  const year = asOf.getFullYear();
  const policy = await prisma.entitlementPolicy.findFirst({
    where: { year },
    select: { leaveEntitlement: true, wfhEntitlement: true, permissionEntitlement: true },
  });
  if (!policy) throw new Error(`EntitlementPolicy not found for ${year}`);

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
  const [leaves, perms] = await Promise.all([
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

  const leaveDaysUsed = leaves.reduce((sum, r) =>
    sum + daysInclusive(clampRangeToYear(r.startDate, r.endDate, yearStart, yearEnd)), 0);


  const permissionHoursUsed = perms.reduce((sum, r) =>
    sum + permissionHours(r.startTime, r.endTime, r.timing as any), 0);

  // 5) rows
  const rows: AccrualRow[] = [
    row('Leave', policy.leaveEntitlement, leaveAccrued, leaveDaysUsed),
    row('Permission', policy.permissionEntitlement, permissionAccrued, permissionHoursUsed),
  ];
  return rows;
}

/* ---------- helpers ---------- */

function proratedMonths(from: Date, to: Date): number {
  if (to < from) return 0;
  const yf = from.getUTCFullYear(), yt = to.getUTCFullYear();
  const mf = from.getUTCMonth(), mt = to.getUTCMonth();
  const df = from.getUTCDate(), dt = to.getUTCDate();

  let months = (yt - yf) * 12 + (mt - mf);
  if (dt >= df) {
    // add fractional month
    const daysInMonth = new Date(to.getUTCFullYear(), to.getUTCMonth() + 1, 0).getUTCDate();
    months += (dt - df + 1) / daysInMonth;
  } else {
    // go back one month and add fraction
    months -= 1;
    const anchor = new Date(to.getUTCFullYear(), to.getUTCMonth(), 0).getUTCDate(); // prev month length
    months += (anchor - df + 1 + dt) / anchor;
  }
  return Math.max(0, months);
}

function clampRangeToYear(start: Date, end: Date, yearStart: Date, yearEnd: Date): { s: Date; e: Date } {
  const s = new Date(Math.max(start.getTime(), yearStart.getTime()));
  const e = new Date(Math.min(end.getTime(), yearEnd.getTime()));
  if (e < s) return { s, e: s }; // zero
  return { s, e };
}

function daysInclusive(range: { s: Date; e: Date }): number {
  const s = new Date(range.s); s.setUTCHours(0, 0, 0, 0);
  const e = new Date(range.e); e.setUTCHours(0, 0, 0, 0);
  return Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
}

function permissionHours(start?: Date | null, end?: Date | null, timing?: 'FULLDAY' | 'HALFDAY' | 'HOURLY' | null): number {
  if (start && end) {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return Math.max(0, ms / 36e5);
  }
  if (!timing) return 0;
  switch (timing) {
    case 'FULLDAY': return 8;
    case 'HALFDAY': return 4;
    case 'HOURLY': return 1;
    default: return 0;
  }
}

function row(category: AccrualRow['category'], entitlement: number, accruedToDate: number, used: number): AccrualRow {
  const balance = round(Math.max(0, Math.min(accruedToDate, entitlement) - used), 2);
  return { category, entitlement, accruedToDate: round(Math.min(accruedToDate, entitlement), 2), used: round(used, 2), balance };
}

function round(n: number, p = 2) { return Math.round(n * 10 ** p) / 10 ** p; }


export async function getEmployeeAccrualsController(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid employee id' });
    }

    const data = await getAccruals(id);
    return res.json(data);
  } catch (e: any) {
    console.error('getEmployeeAccrualsController error:', e);
    return res.status(500).json({ error: e?.message || 'Internal Server Error' });
  }
}
export const getEmployeeRequests = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    if (!employeeId) return res.status(400).json({ error: "employeeId must be a number" });

    const [leaves, permissions, wfh] = await Promise.all([
      prisma.leaveRequest.findMany({
        where: { employeeId }, orderBy: { createdAt: "desc" }, include: {
          leaveType: {    // 👈 assumes you have relation field "leaveType" in Prisma schema
            select: { name: true }
          }
        }
      }),
      prisma.permissionRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } }),
      prisma.wFHRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } })
    ]);

    res.json({ leaves, permissions, wfh });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
};

function todayInIST(): Date {
  // Make a Date that represents "now" in IST (Asia/Kolkata)
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

export async function getTodayCelebrants(req: Request, res: Response) {
  try {
    const nowIST = todayInIST();
    const mm = nowIST.getMonth(); // 0..11
    const dd = nowIST.getDate();  // 1..31

    // Pull only what we need
    const employees = await prisma.employee.findMany({
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

    type BirthdayItem = { employeeId: number; employeeName: string; departmentName: string };
    type AnniversaryItem = { employeeId: number; employeeName: string; departmentName: string; years: number };

    const birthdays: BirthdayItem[] = [];
    const anniversaries: AnniversaryItem[] = [];

    for (const e of employees) {
      const name = [e.firstName, e.lastName].filter(Boolean).join(" ");
      const dept = e.Department?.name ?? "";

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
  } catch (err) {
    console.error("celebrants/today failed:", err);
    return res.status(500).json({ error: "Failed to fetch today's celebrants" });
  }
}
export async function listMentors(req: Request, res: Response) {
  try {
    // departmentId is OPTIONAL. When supplied, results are scoped to that
    // department (mentor picker); when omitted, all active employees are
    // returned (used by the appraisal review-questions target picker). This
    // matches the frontend EmployeesService.list({ departmentId? }) contract.
    const departmentIdRaw = req.query.departmentId;
    const departmentId = Number(departmentIdRaw);
    const hasDept =
      departmentIdRaw !== undefined &&
      departmentIdRaw !== '' &&
      Number.isFinite(departmentId);
    const q = (req.query.q as string) || '';

    const rows = await prisma.employee.findMany({
      where: {
        employmentStatus: 'ACTIVE',
        ...(hasDept ? { departmentId } : {}),
        ...(q ? {
          OR: [
            { firstName: { contains: q } },
            { lastName: { contains: q } },
            { employeeCode: { contains: q } },
          ],
        } : {}),
      },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 200,
    });

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load mentors' });
  }
}
export const uploadVaccineProof = async (req: Request, res: Response) => {
  try {
    const { employeeId, vaccineIndex } = req.params;

    const form = formidable({
      uploadDir: TEMP_FOLDER,
      keepExtensions: true,
      multiples: false,
    });
    form.parse(req, async (err, fields, files) => {
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
      const fileName = sanitizeFileName(
        file.originalFilename || `vaccine_${employeeId}_${Date.now()}.pdf`
      );

      const remoteFilePath = `/public_html/vaccine-proofs/${fileName}`;
      await uploadToFTP(tempFilePath, remoteFilePath);
      // const fileUrl = `https://hrproindia.in/vaccine-proofs/${fileName}`; // legacy FTP URL
      const fileUrl = publicUrl(remoteFilePath);

      fs.unlinkSync(tempFilePath);

      // update vaccinations JSON
      const employee = await prisma.employee.findUnique({ where: { id: Number(employeeId) } });
      let vaccinations = employee?.vaccinations ? JSON.parse(employee.vaccinations as string) : [];
      if (vaccinations[vaccineIndex]) {
        vaccinations[vaccineIndex].proofUrl = fileUrl;
      }

      const updated = await prisma.employee.update({
        where: { id: Number(employeeId) },
        data: { vaccinations: JSON.stringify(vaccinations) },
      });
      console.log(updated)

      return res.status(200).json({ fileUrl, employee: updated });
    });

  } catch (error) {
    console.error("Upload Vaccine Proof Error:", error);
    return res.status(500).json({ error: "Failed to upload vaccine proof" });
  }
};

/**
 * Get employees by multiple department IDs
 * Example: GET /api/employees/by-departments?ids=1,2,3
 */
export const getEmployeesByDepartments = async (req: Request, res: Response) => {
  try {
    const { ids } = req.query;

    if (!ids) {
      return res.status(400).json({ error: "Department IDs are required (use ?ids=1,2,3)" });
    }

    const idsArray = (ids as string)
      .split(",")
      .map((id) => Number(id.trim()))
      .filter((id) => !isNaN(id));

    if (!idsArray.length) {
      return res.status(400).json({ error: "Invalid department IDs" });
    }

    const employees = await prisma.employee.findMany({
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
  } catch (error) {
    console.error("❌ Failed to fetch employees by departments:", error);
    res.status(500).json({ error: "Failed to fetch employees by departments" });
  }
};
export const sendHealthCheckReminders = async () => {
  const today = new Date();
  const currentYear = today.getFullYear();

  const employees = await prisma.employee.findMany({
    where: {
      preEmploymentCheckDate: { not: null },
      OR: [
        { healthCheckReminderYear: null },
        { healthCheckReminderYear: { not: currentYear } }
      ]
    }
  });

  for (const emp of employees) {
    const nextCheckDate = new Date(emp.preEmploymentCheckDate!);
    nextCheckDate.setFullYear(nextCheckDate.getFullYear() + 1);

    // Not yet time → skip
    if (today < nextCheckDate) continue;

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
    await createNotification(emp.id, message);

    // Update the year reminder sent
    await prisma.employee.update({
      where: { id: emp.id },
      data: {
        healthCheckReminderYear: currentYear,
        healthCheckReminderSent: true
      }
    });

    console.log(`Health check reminder sent to ${emp.firstName}`);
  }
};


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
export const getUnreportedAbsentees = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        message: "Date is required ?date=YYYY-MM-DD",
      });
    }

    // IST-safe day range
    const target = new Date(date as string);
    const start = startOfDayIST(target);
    const end = endOfDayIST(target);

    // 1️⃣ Shift assignments define expected employees
    const assignments = await prisma.shiftAssignment.findMany({
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
    const attendance = await prisma.attendance.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { gte: start, lte: end },
      },
      select: { employeeId: true, checkIn: true },
    });

    // 3️⃣ Approved / pending leave, WFH, permission
    const [leaves, wfh, perms] = await Promise.all([
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
    const checkedInSet = new Set(
      attendance.filter(a => a.checkIn).map(a => a.employeeId)
    );

    const excusedSet = new Set<number>([
      ...leaves.map(x => x.employeeId),
      ...wfh.map(x => x.employeeId),
      ...perms.map(x => x.employeeId),
    ]);

    // 5️⃣ Final unreported absentees
    const absentees = assignments
      .filter(a =>
        !checkedInSet.has(a.employeeId) &&
        !excusedSet.has(a.employeeId)
      )
      .map(a => ({
        employeeId: a.employeeId,
        employeeCode: a.employee.employeeCode,
        name: `${a.employee.firstName} ${a.employee.lastName}`,
        department: a.employee.Department?.name ?? null,
        departmentId: a.employee.Department?.id ?? null,
        designation: a.employee.designation ?? null,
        shiftName: a.shift?.name ?? null,
        shiftStartTime: a.shift?.startTime ?? null,
        shiftEndTime: a.shift?.endTime ?? null,
      }));

    return res.json(absentees);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal error" });
  }
};

function excelDateToJSDate(serial: number): Date {
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const days = Math.floor(serial);
  const ms = days * 86400000;
  return new Date(excelEpoch.getTime() + ms);
}

function parseDate(value: any): Date | null {
  if (!value) return null;

  if (typeof value === "number") {
    return excelDateToJSDate(value);
  }

  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}
const uploadProgress = new Map<string, any>();
async function findOrCreateByName<T>(
  model: any,
  name: string,
  extraData: Record<string, any> = {}
): Promise<{ id: number }> {
  const trimmed = name?.trim();
  if (!trimmed) {
    throw new Error("Name is required");
  }

  // Case-insensitive lookup
  const existing = await model.findFirst({
    where: {
      name: {
        equals: trimmed,
        mode: "insensitive",
      },
    },
  });

  if (existing) return existing;

  return model.create({
    data: {
      name: trimmed,
      ...extraData,
    },
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


function ensureDirExists(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export async function mapExcelRowToEmployee(
  row: Record<string, any>
): Promise<Prisma.EmployeeCreateInput> {

  const departmentName = row.departmentName?.trim();
  const branchName = row.branchName?.trim();
  const roleName = row.roleName?.trim();
  const designationName = row.designationName?.trim();

  if (!departmentName || !branchName || !roleName || !designationName) {
    throw new Error("Department, Branch, Role and Designation are required");
  }

  const [dept, branch, role, designation] = await Promise.all([
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
    ? await prisma.employee.findUnique({
      where: { employeeCode: managerCode },
    })
    : null;


  const dob = parseDate(row.dob);
  const doj = parseDate(row.dateOfJoining);

  if (!dob || !doj) throw new Error("Invalid DOB or Date of Joining");

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
}



interface UploadLog {
  row: number;
  message: string;
}

interface ErrorRow {
  rowNumber: number;
  error: string;
  [key: string]: any;
}
function toDate(value: any): Date {
  if (!value) throw new Error(`Missing required date field`);
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
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
export const downloadEmployeeTemplate = (_req: Request, res: Response) => {
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

  const sheet = XLSX.utils.json_to_sheet(headers);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Employees");

  res.setHeader(
    "Content-Disposition",
    "attachment; filename=employee-upload-template.xlsx"
  );
  res.end(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
};
function normalizeCode(code: any): string {
  return String(code || "").trim().toUpperCase();
}

export const bulkUploadEmployees = async (req: Request, res: Response) => {
  try {
    const form = formidable({ multiples: false, keepExtensions: true });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        return res.status(500).json({ error: "File parsing error" });
      }

      const fileObj = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!fileObj) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = XLSX.readFile(fileObj.filepath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(sheet);

      if (!rawRows.length) {
        return res.status(400).json({ error: "Empty Excel file" });
      }

      const errorRows: any[] = [];
      const logs: string[] = [];
      const createOps: Prisma.PrismaPromise<any>[] = [];

      /** ---------------------------
       * 1️⃣ Collect employeeCodes
       ----------------------------*/
      const excelCodes = rawRows.map((r: any) =>
        normalizeCode(r.employeeCode)
      );

      /** ---------------------------
       * 2️⃣ Find existing codes in DB
       ----------------------------*/
      const existingEmployees = await prisma.employee.findMany({
        where: { employeeCode: { in: excelCodes } },
        select: { employeeCode: true },
      });

      const existingCodeSet = new Set(
        existingEmployees.map(e => e.employeeCode.toUpperCase())
      );

      /** ---------------------------
       * 3️⃣ Detect duplicates in Excel
       ----------------------------*/
      const seenExcelCodes = new Set<string>();

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i] as any;
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
          const mapped = await mapExcelRowToEmployee(row);

          // createOps.push(prisma.employee.create({ data: mapped }));
          createOps.push(
            prisma.employee.create({
              data: {
                ...mapped
              }
            })
          );

          logs.push(`Row ${i + 1}: SUCCESS (${employeeCode})`);
        } catch (error: any) {
          errorRows.push({
            rowNumber: i + 1,
            employeeCode,
            error: error.message,
            ...row,
          });

          logs.push(`Row ${i + 1}: FAILED → ${error.message}`);
        }
      }

      /** ---------------------------
       * 4️⃣ Execute inserts
       ----------------------------*/
      if (createOps.length > 0) {
        await prisma.$transaction(createOps);
      }

      /** ---------------------------
       * 5️⃣ Error Excel
       ----------------------------*/
      let errorReportUrl: string | null = null;

      if (errorRows.length > 0) {
        const errorSheet = XLSX.utils.json_to_sheet(errorRows);
        const errorWB = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(errorWB, errorSheet, "Errors");

        const reportsDir = path.join(__dirname, "../../reports");
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }

        const fileName = `employee-upload-errors-${Date.now()}.xlsx`;
        const filePath = path.join(reportsDir, fileName);

        XLSX.writeFile(errorWB, filePath);
        errorReportUrl = `/reports/${fileName}`;
      }

      return res.json({
        totalRows: rawRows.length,
        successCount: createOps.length,
        failedCount: errorRows.length,
        errorReport: errorReportUrl,
        logs,
      });
    });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: "Bulk upload failed" });
  }
};

function normalizeManagerCode(code: any): string | null {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  if (c === "0") return null;
  return c;
}

/* ============================================================
   PROGRESS API
============================================================ */
export const getBulkUploadProgress = (req: Request, res: Response) => {
  const progress = uploadProgress.get(req.params.uploadId);
  if (!progress) return res.status(404).json({ error: "Invalid uploadId" });
  res.json(progress);
};
function normalizeGender(value: any): "MALE" | "FEMALE" | "OTHER" {
  if (!value) throw new Error("Gender is required");

  const v = String(value)
    .replace(/\u00A0/g, " ")   // remove non-breaking spaces
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
function normalizeEmploymentType(value: any) {
  const v = String(value).trim().toUpperCase();
  if (!["PERMANENT", "CONTRACT", "PROBATION"].includes(v)) {
    throw new Error(`Invalid employmentType: "${value}"`);
  }
  return v as any;
}

function normalizeEmploymentStatus(value: any) {
  const v = String(value).trim().toUpperCase();
  if (!["ACTIVE", "TERMINATED", "SUSPENDED", "NOTICE_PERIOD", "RESIGNED"].includes(v)) {
    throw new Error(`Invalid employmentStatus: "${value}"`);
  }
  return v as any;
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
export const bulkUpdateReportingManager = async (req: Request, res: Response) => {
  const form = formidable({ multiples: false });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: "File parse error" });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const workbook = XLSX.readFile(file.filepath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet) as any[];

    const errors: any[] = [];
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

        const manager = await prisma.employee.findUnique({
          where: { employeeCode: mgrCode },
        });

        if (!manager) {
          throw new Error(`Manager not found: ${mgrCode}`);
        }

        await prisma.employee.update({
          where: { employeeCode: empCode },
          data: { reportingManager: manager.id },
        });

        updated++;
      } catch (e: any) {
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
  });
};
// controllers/employee.controller.ts
export const getInchargeEmployees = async (req: Request, res: Response) => {

  console.log('calling incharge employees')
  try {
    const incharges = await prisma.employee.findMany({
      where: {
        roleId: 5,              // ✅ INCHARGE
        employmentStatus: 'ACTIVE'
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true
      }
    });

    res.json(
      incharges.map(e => ({
        label: `${e.firstName} ${e.lastName} (${e.employeeCode})`,
        value: e.id
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch incharge employees' });
  }
};
export const deleteEmployeeDocument = async (req: Request, res: Response) => {
  try {
    const docId = Number(req.params.documentId);

    const doc = await prisma.document.findUnique({
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
          await deleteFromFTP(ftpPath);
        } catch (ftpErr) {
          console.warn('FTP delete failed:', ftpErr);
          // ❗ Do NOT fail DB deletion if FTP fails
        }
      }
    }

    // 🗑️ DELETE DB ROW
    await prisma.document.delete({
      where: { id: docId }
    });

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
};
export async function deleteFromFTP(remotePath: string) {
  // ── Local disk delete (current) ───────────────────────────────────────────
  // remotePath is a legacy "/public_html/<folder>/<file>"; deleteLocal strips
  // the prefix and removes UPLOADS_DIR/<folder>/<file> (missing file is a no-op).
  await deleteLocal(remotePath);

  // ── Legacy FTP delete (kept for reference / fallback) ─────────────────────
  // const client = new Client();
  // client.ftp.verbose = false;
  //
  // try {
  //   await client.access({
  //     host: FTP_CONFIG.host!,
  //     user: FTP_CONFIG.user!,
  //     password: FTP_CONFIG.password!,
  //     secure: FTP_CONFIG.secure,
  //   });
  //
  //   await client.remove(remotePath);
  // } finally {
  //   client.close();
  // }
}
// controllers/employee.controller.ts

export const updateEmployeeProfile = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.id);
    if (!employeeId) {
      return res.status(400).json({ error: 'Invalid employee id' });
    }

    const {
      firstName,
      lastName,
      bloodGroup,
      phone,
      email
    } = req.body;

    // ✅ OPTIONAL VALIDATION
    if (!firstName || !lastName) {
      return res.status(400).json({
        error: 'First name and last name are required'
      });
    }

    const updatedEmployee = await prisma.employee.update({
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

  } catch (error) {
    console.error('updateEmployeeProfile error:', error);
    return res.status(500).json({
      error: 'Failed to update profile'
    });
  }
};
// controllers/employee.controller.ts

export const getEmployeeProfile = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.id);
    if (!employeeId) {
      return res.status(400).json({ error: 'Invalid employee id' });
    }

    const employee = await prisma.employee.findUnique({
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
  } catch (error) {
    console.error('getEmployeeProfile error:', error);
    return res.status(500).json({
      error: 'Failed to fetch profile'
    });
  }
};
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


export const startSabbatical = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const { startDate, endDate, reason } = req.body;

    if (!employeeId || !startDate || !endDate) {
      return res.status(400).json({
        error: "employeeId, startDate, and endDate are required"
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // check if already on sabbatical
      const active = await tx.sabbatical.findFirst({
        where: {
          employeeId,
          status: "ACTIVE"
        }
      });

      if (active) {
        throw new Error("Employee already on sabbatical");
      }

      // create sabbatical
      const sabbatical = await tx.sabbatical.create({
        data: {
          employeeId,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          reason,
          status: "ACTIVE"
        }
      });

      // update employee status
      await tx.employee.update({
        where: { id: employeeId },
        data: { employmentStatus: "SABBATICAL" }
      });

      return sabbatical;
    });

    // Revoke session/access — sabbatical employees should not retain
    // active logins (they're not working while on sabbatical).
    try {
      await revokeEmployeeAccess(Number(employeeId), 'Sabbatical started');
    } catch (e) { console.error('[sabbatical] revokeEmployeeAccess failed:', e); }

    res.json(result);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};
export const extendSabbatical = async (req: Request, res: Response) => {
  try {
    const sabbaticalId = Number(req.params.id);
    const { endDate } = req.body;

    const result = await prisma.sabbatical.update({
      where: { id: sabbaticalId },
      data: {
        endDate: new Date(endDate)
      }
    });

    res.json(result);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};
export const endSabbatical = async (req: Request, res: Response) => {
  try {
    const sabbaticalId = Number(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const sabbatical = await tx.sabbatical.update({
        where: { id: sabbaticalId },
        data: { status: "COMPLETED" }
      });

      await tx.employee.update({
        where: { id: sabbatical.employeeId },
        data: { employmentStatus: "ACTIVE" }
      });

      return sabbatical;
    });

    res.json(result);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};
export const terminateFromSabbatical = async (req: Request, res: Response) => {
  try {
    const sabbaticalId = Number(req.params.id);

    const result = await prisma.$transaction(async (tx) => {
      const sabbatical = await tx.sabbatical.update({
        where: { id: sabbaticalId },
        data: { status: "COMPLETED" }
      });

      await tx.employee.update({
        where: { id: sabbatical.employeeId },
        data: { employmentStatus: "TERMINATED" }
      });

      // Revoke session/access on TERMINATED.
      try {
        await revokeEmployeeAccess(sabbatical.employeeId, 'Sabbatical completed → terminated');
      } catch (e) { console.error('[sabbatical-complete] revokeEmployeeAccess failed:', e); }

      return sabbatical;
    });

    res.json(result);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

export const initSabbaticalReminderScheduler = () => {
  cron.schedule("0 9 * * *", async () => {
    console.log("Running sabbatical reminder cron...");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reminderDate = new Date(today);
    reminderDate.setDate(today.getDate() + 3);

    const sabbaticals = await prisma.sabbatical.findMany({
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

      await createNotification(emp.id, message);

      const hrUsers = await prisma.employee.findMany({
        where: { roleId: 1, employmentStatus: "ACTIVE" },
        select: { id: true }
      });

      for (const hr of hrUsers) {
        await createNotification(
          hr.id,
          `${emp.firstName}'s sabbatical ends on ${sab.endDate.toDateString()}`
        );
      }
    }
  });
};
// GET /employees/by-manager/:managerId
export const getEmployeesByManager = async (req: Request, res: Response) => {
  try {
    const managerId = Number(req.params.managerId);

    const employees = await prisma.employee.findMany({
      where: {
        reportingManager: managerId,
        employmentStatus: "ACTIVE"
      },
      orderBy: { firstName: "asc" }
    });

    res.json(employees);
  } catch (err) {
    console.error("❌ Failed to fetch employees by manager:", err);
    res.status(500).json({ error: "Failed to fetch employees" });
  }
};
export const bulkUpdateEmployeeExtras = async (req: Request, res: Response) => {
  try {
    const form = formidable({ multiples: false, keepExtensions: true });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        return res.status(500).json({ error: "File parsing error" });
      }

      const fileObj = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!fileObj) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = XLSX.readFile(fileObj.filepath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);

      const logs: string[] = [];
      const errorRows: any[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row: any = rows[i];
        const code = normalizeCode(row.employeeCode);

        try {
          if (!code) throw new Error("employeeCode missing");

          const employee = await prisma.employee.findUnique({
            where: { employeeCode: code },
          });

          if (!employee) {
            throw new Error(`Employee not found: ${code}`);
          }

          /** Helper date parser */
          const parseOptionalDate = (value: any): Date | null => {
            if (!value) return null;
            const d = new Date(value);
            return isNaN(d.getTime()) ? null : d;
          };

          /** 1️⃣ Update employee fields */
          await prisma.employee.update({
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
            const existingPermanent = await prisma.address.findFirst({
              where: {
                employeeId: employee.id,
                type: "PERMANENT",
              },
            });

            if (existingPermanent) {
              await prisma.address.update({
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
            } else {
              await prisma.address.create({
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
            const existingTemporary = await prisma.address.findFirst({
              where: {
                employeeId: employee.id,
                type: "TEMPORARY",
              },
            });

            if (existingTemporary) {
              await prisma.address.update({
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
            } else {
              await prisma.address.create({
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
        } catch (error: any) {
          errorRows.push({
            rowNumber: i + 1,
            employeeCode: code,
            error: error.message,
            ...row,
          });

          logs.push(`Row ${i + 1}: FAILED → ${error.message}`);
        }
      }

      return res.json({
        totalRows: rows.length,
        successCount: rows.length - errorRows.length,
        failedCount: errorRows.length,
        logs,
      });
    });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: "Bulk update failed" });
  }
};
export const bulkUploadLeaveBalance = async (req: Request, res: Response) => {
  try {
    const form = formidable({ multiples: false, keepExtensions: true });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        return res.status(500).json({ error: "File parsing error" });
      }

      const fileObj = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!fileObj) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = XLSX.readFile(fileObj.filepath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);

      const logs: string[] = [];
      const errorRows: any[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row: any = rows[i];

        try {
          const code = String(row.employeeCode).trim();
          if (!code) throw new Error("employeeCode missing");

          const employee = await prisma.employee.findUnique({
            where: { employeeCode: code },
          });

          if (!employee) throw new Error("Employee not found");

          const year = Number(row.year);
          const category = row.category;

          let leaveTypeId: number | null = null;
          let permissionType: any = null;

          if (category === "LEAVE") {
            if (!row.leaveType) {
              throw new Error("leaveType required for LEAVE");
            }

            const leaveType = await prisma.leaveType.findUnique({
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

            await prisma.employeeLeaveBalance.upsert({
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

            await prisma.employeeLeaveBalance.upsert({
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
        } catch (e: any) {
          logs.push(`Row ${i + 1}: FAILED → ${e.message}`);
          errorRows.push({ row: i + 1, error: e.message, ...row });
        }
      }

      return res.json({
        totalRows: rows.length,
        failed: errorRows.length,
        logs,
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
};

// ── Probation Actions ──────────────────────────────────────────────────────

export const extendProbation = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.id);
    const { newEndDate, remarks } = req.body;
    const decidedBy = (req as any).user?.empId ?? null;

    if (!newEndDate) return res.status(400).json({ error: 'newEndDate is required' });

    const result = await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.findUnique({ where: { id: employeeId } });
      if (!emp) throw new Error('Employee not found');
      if (!emp.probationStartDate || !emp.probationEndDate) {
        throw new Error('Employee has no active probation to extend');
      }

      // Close the current in-progress record as EXTENDED
      await tx.probationRecord.updateMany({
        where: { employeeId, status: 'IN_PROGRESS' },
        data: {
          status: 'EXTENDED',
          decidedBy,
          decidedOn: new Date(),
          remarks: remarks ?? null,
        },
      });

      // Create a new IN_PROGRESS record for the extension
      const newRecord = await tx.probationRecord.create({
        data: {
          employeeId,
          startDate: emp.probationEndDate,
          endDate: new Date(newEndDate),
          status: 'IN_PROGRESS',
          remarks: remarks ?? null,
        },
      });

      // Update employee snapshot
      const updated = await tx.employee.update({
        where: { id: employeeId },
        data: {
          probationEndDate: new Date(newEndDate),
          probationStatus: 'IN_PROGRESS',
          probationRemarks: remarks ?? null,
        },
      });

      return { employee: updated, record: newRecord };
    });

    res.json(result);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

export const confirmProbation = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.id);
    const { confirmedOn, remarks } = req.body;
    const decidedBy = (req as any).user?.empId ?? null;

    const when = confirmedOn ? new Date(confirmedOn) : new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Close the current IN_PROGRESS record as CONFIRMED
      await tx.probationRecord.updateMany({
        where: { employeeId, status: 'IN_PROGRESS' },
        data: {
          status: 'CONFIRMED',
          decidedBy,
          decidedOn: when,
          remarks: remarks ?? null,
        },
      });

      const updated = await tx.employee.update({
        where: { id: employeeId },
        data: {
          probationStatus: 'CONFIRMED',
          probationConfirmedOn: when,
          probationConfirmedBy: decidedBy,
          probationRemarks: remarks ?? null,
          employmentType: 'PERMANENT',
        },
      });

      return updated;
    });

    res.json(result);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

export const terminateProbation = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.id);
    const { remarks } = req.body;
    const decidedBy = (req as any).user?.empId ?? null;

    const result = await prisma.$transaction(async (tx) => {
      await tx.probationRecord.updateMany({
        where: { employeeId, status: 'IN_PROGRESS' },
        data: {
          status: 'TERMINATED',
          decidedBy,
          decidedOn: new Date(),
          remarks: remarks ?? null,
        },
      });

      const updated = await tx.employee.update({
        where: { id: employeeId },
        data: {
          probationStatus: 'TERMINATED',
          probationRemarks: remarks ?? null,
          employmentStatus: 'TERMINATED',
        },
      });

      return updated;
    });

    // Probation termination → kill the employee's access.
    try {
      await revokeEmployeeAccess(employeeId, 'Probation terminated');
    } catch (e) { console.error('[probation-terminate] revokeEmployeeAccess failed:', e); }

    res.json(result);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

export const getProbationHistory = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.id);
    const records = await prisma.probationRecord.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(records);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

/* ════════════════════════════════════════════════════════════════════
   EMPLOYEE AUDIT LOG
   GET /api/employees/:id/audit-log
   Filters: field, source, changedBy, from, to, page, pageSize
   ════════════════════════════════════════════════════════════════════ */
export const getEmployeeAuditLog = async (req: Request, res: Response) => {
  try {
    const employeeId = Number(req.params.id);
    if (!employeeId) return res.status(400).json({ error: "employeeId required" });

    const { field, source, changedBy, from, to, page = '1', pageSize = '50' } = req.query as any;

    const where: any = { employeeId };
    if (source)    where.source = String(source);
    if (changedBy) where.changedBy = Number(changedBy);
    if (from || to) {
      where.changedAt = {};
      if (from) where.changedAt.gte = new Date(String(from));
      if (to)   where.changedAt.lte = new Date(String(to));
    }

    const take = Math.min(200, Number(pageSize) || 50);
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;

    const [rows, total] = await Promise.all([
      (prisma as any).employeeAuditLog.findMany({
        where,
        orderBy: { changedAt: 'desc' },
        take, skip,
        include: {
          changedByEmployee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        },
      }),
      (prisma as any).employeeAuditLog.count({ where }),
    ]);

    let filtered = rows;
    if (field) {
      const f = String(field);
      // changedFields is JSON; client-side filter is safer than brittle JSON path queries.
      filtered = rows.filter((r: any) => Array.isArray(r.changedFields) && r.changedFields.includes(f));
    }

    return res.json({ total: field ? filtered.length : total, rows: filtered });
  } catch (err: any) {
    console.error("getEmployeeAuditLog error:", err);
    return res.status(500).json({ error: err?.message || "Failed to load audit log" });
  }
};

/** Bulk audit-log query — for HR's "everyone whose salary changed last month" view. */
export const queryAuditLog = async (req: Request, res: Response) => {
  try {
    const { field, source, changedBy, from, to, page = '1', pageSize = '50' } = req.query as any;

    const where: any = {};
    if (source)    where.source = String(source);
    if (changedBy) where.changedBy = Number(changedBy);
    if (from || to) {
      where.changedAt = {};
      if (from) where.changedAt.gte = new Date(String(from));
      if (to)   where.changedAt.lte = new Date(String(to));
    }

    const take = Math.min(200, Number(pageSize) || 50);
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;

    const [rows, total] = await Promise.all([
      (prisma as any).employeeAuditLog.findMany({
        where,
        orderBy: { changedAt: 'desc' },
        take, skip,
        include: {
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
          changedByEmployee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        },
      }),
      (prisma as any).employeeAuditLog.count({ where }),
    ]);

    let filtered = rows;
    if (field) {
      const f = String(field);
      filtered = rows.filter((r: any) => Array.isArray(r.changedFields) && r.changedFields.includes(f));
    }

    return res.json({ total: field ? filtered.length : total, rows: filtered });
  } catch (err: any) {
    console.error("queryAuditLog error:", err);
    return res.status(500).json({ error: err?.message || "Failed to load audit log" });
  }
};
