import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import formidable from "formidable";
import fs from "fs";
import { Client } from "basic-ftp";
import path from "path";
import { $Enums } from '@prisma/client';
import { createNotification } from "../notifications/notifications.controller";

const FTP_CONFIG = {
  host: "srv680.main-hosting.eu",  // Your FTP hostname
  user: "u948610439.hrproindia.in",       // Your FTP username
  password: "Bsrenuk@1993",   // Your FTP password
  secure: false                    // Set to true if using FTPS
}
const TEMP_FOLDER = path.join(__dirname, '../temp'); // absolute path

if (!fs.existsSync(TEMP_FOLDER)) {
  fs.mkdirSync(TEMP_FOLDER, { recursive: true });
}


async function generateEmployeeCode() {
  const lastEmployee = await prisma.employee.findFirst({
    orderBy: { employeeCode: 'desc' },
    select: { employeeCode: true }
  });

  let newCode = 'EMP001';
  if (lastEmployee?.employeeCode) {
    const lastNumber = parseInt(lastEmployee.employeeCode.replace(/\D/g, ''), 10);
    newCode = `EMP${String(lastNumber + 1).padStart(3, '0')}`;
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
      departmentId,
      branchId,
      dateOfJoining,
      employmentType,
      probationEndDate,
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
      sameAsPermanent
    } = req.body;
    const data = req.body;
    let finalCode = employeeCode;
    console.log(finalCode)

    if (!finalCode) {
      finalCode = await generateEmployeeCode();
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

          healthIssues: data.healthIssues ? JSON.stringify(data.healthIssues) : undefined,
          vaccinations: data.vaccinations ? JSON.stringify(data.vaccinations) : undefined,
          // Connect relations
          Department: { connect: { id: departmentId } },
          Branch: { connect: { id: branchId } },
          role: { connect: { id: roleId } },
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
        }
      });
    }
    catch (err: any) {
      if (err.code === 'P2002' && err.meta?.target?.includes('employeeCode')) {
        // Regenerate a fresh code and retry

        finalCode = await generateEmployeeCode();
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

    return res.status(201).json(newEmployee);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to create employee" });
  }
};

// GET all employees
export const getEmployees = async (req: Request, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      include: {
        Address: true,
        emergencyContacts: true,
        qualifications: true,
        documents: true,
        Department: true,
        EmployeeShiftSetting: true,
        shifts: {
          orderBy: { date: 'desc' }, // Most recent first
          take: 1,                   // Only 1 record
          include: {
            shift: true              // Include shift template details (name, timings)
          }
        }
      }
    });
    const formatted = employees.map(emp => ({
      ...emp,
      latestShiftAssignment: emp.shifts[0] || null,
      departmentName: emp.Department?.name || null, // ✅ extract department name
    }));
    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch employees" });
  }
};

// GET single employee by ID
export const getEmployeeById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const employee = await prisma.employee.findUnique({
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
          take: 1,                   // Only 1 record
          include: {
            shift: true              // Include shift template details
          }
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


export const updateEmployee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const {
      addresses,
      emergencyContacts,
      qualifications,
      departmentId,
      branchId,
      roleId,
      shiftMode,             // 'FIXED' | 'ROTATIONAL' | undefined
      fixedShiftId,          // number | undefined
      rotationPatternId,     // number | undefined
      rotationStartDate,     // ISO string | undefined
      dob,
      dateOfJoining,
      probationEndDate,
      ...employeeFields
    } = data;

    const toDate = (v: any) => (v ? new Date(v) : null);

    employeeFields.dob = toDate(dob) ?? undefined;
    employeeFields.dateOfJoining = toDate(dateOfJoining) ?? undefined;
    employeeFields.probationEndDate = toDate(probationEndDate);


    const updatedEmployee = await prisma.employee.update({
      where: { id: Number(id) },
      data: {
        ...employeeFields,
        // Health & Wellness fields
        preEmploymentCheckDate: data.preEmploymentCheckDate ? new Date(data.preEmploymentCheckDate) : null,
        height: data.height ? parseFloat(data.height) : null,
        weight: data.weight ? parseFloat(data.weight) : null,
        bmi: data.bmi ? parseFloat(data.bmi) : null,
        bloodPressure: data.bloodPressure,
        bloodSugar: data.bloodSugar,
        cholesterol: data.cholesterol,
        sameAsPermanent: data.sameAsPermanent,

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
        disabilityProofUrl: data.disabilityProofUrl,

        preferredHospital: data.preferredHospital,
        primaryPhysician: data.primaryPhysician,
        emergencyNotes: data.emergencyNotes,

        healthIssues: data.healthIssues ? JSON.stringify(data.healthIssues) : undefined,
        vaccinations: data.vaccinations ? JSON.stringify(data.vaccinations) : undefined,
        Department: { connect: { id: departmentId } },
        Branch: { connect: { id: branchId } },
        role: { connect: { id: roleId } },
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
      }
    });
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



    res.json(updatedEmployee);
  } catch (error) {
    console.error(error); // <-- log actual error
    res.status(500).json({ error: "Failed to update employee" });
  }
};

// DELETE employee
export const deleteEmployee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.employee.delete({
      where: { id: Number(id) }
    });

    res.json({ message: "Employee deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete employee" });
  }
};
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/\s+/g, '_'); // replace spaces with underscore
}

async function uploadToFTP(localFilePath: string, remoteFileName: string): Promise<any> {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(FTP_CONFIG);
    const folder = path.dirname(remoteFileName);
    await client.ensureDir(folder);
    console.log(remoteFileName)
    await client.uploadFrom(localFilePath, remoteFileName);
    await client.close();

    // return `https://hrproindia.in/documents/${remoteFileName}`; // public URL
  } catch (error) {
    console.error("FTP Upload Error:", error);
    throw new Error("FTP upload failed");
  }
}

// API Handler
export const uploadEmployeeDocuments = async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.params;

    const form = formidable({
      uploadDir: TEMP_FOLDER,
      keepExtensions: true,
      multiples: true,
    });

    console.log(form)

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error("Formidable Parse Error:", err);
        return res.status(500).json({ error: err.message });
      }

      const metadata = JSON.parse(fields.metadata?.[0] || "[]"); // metadata array

      if (!files.file) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const uploadedFiles = Array.isArray(files.file) ? files.file : [files.file];

      console.log(uploadedFiles)

      const uploadedDocs = [];

      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const tempFilePath = file.filepath;
        const fileName = sanitizeFileName(file.originalFilename || `file_${Date.now()}.png`);

        const remoteFilePath = `/public_html/documents/${fileName}`;
        await uploadToFTP(tempFilePath, remoteFilePath);
        const fileUrl = `https://hrproindia.in/documents/${fileName}`

        console.log(fileUrl);
        fs.unlinkSync(tempFilePath); // cleanup temp file

        // Save in DB
        const savedDoc = await prisma.document.create({
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
    });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ error: (error as Error).message });
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
      const fileUrl = `https://hrproindia.in/photos/${fileName}`;

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
      const fileUrl = `https://hrproindia.in/disability/${fileName}`;

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


export const getActiveEmployees = async (req: Request, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      where: {
        employmentStatus: 'ACTIVE'
      },
      select: { id: true, firstName: true, lastName: true, branchId: true, departmentId: true, employeeCode: true }
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
  const wfhAccrued = round(policy.wfhEntitlement / 12 * monthsProrated, 2);
  const permissionAccrued = round(policy.permissionEntitlement / 12 * monthsProrated, 2); // hours

  // 4) usage (only APPROVED within year)
  const [leaves, wfhs, perms] = await Promise.all([
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

  const leaveDaysUsed = leaves.reduce((sum, r) =>
    sum + daysInclusive(clampRangeToYear(r.startDate, r.endDate, yearStart, yearEnd)), 0);

  const wfhDaysUsed = wfhs.reduce((sum, r) =>
    sum + daysInclusive(clampRangeToYear(r.startDate, r.endDate, yearStart, yearEnd)), 0);

  const permissionHoursUsed = perms.reduce((sum, r) =>
    sum + permissionHours(r.startTime, r.endTime, r.timing as any), 0);

  // 5) rows
  const rows: AccrualRow[] = [
    row('Leave', policy.leaveEntitlement, leaveAccrued, leaveDaysUsed),
    row('WFH', policy.wfhEntitlement, wfhAccrued, wfhDaysUsed),
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
    const departmentId = Number(req.query.departmentId);
    const q = (req.query.q as string) || '';

    if (!departmentId) {
      return res.status(400).json({ error: 'departmentId is required' });
    }

    const rows = await prisma.employee.findMany({
      where: {
        employmentStatus: 'ACTIVE',
        departmentId,
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
      const fileUrl = `https://hrproindia.in/vaccine-proofs/${fileName}`;

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
