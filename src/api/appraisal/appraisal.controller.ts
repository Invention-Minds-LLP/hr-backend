import { Request, Response } from "express";
// import { PrismaClient } from "@prisma/client";
import cron from 'node-cron';
// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { sendWhatsAppTemplate } from "../leave/leave.controller";
import { createNotification } from "../notifications/notifications.controller";

const APPRAISAL_REMINDER_COUNT_TEMPLATE_ID = '';
const APPRAISAL_CREATED_TEMPLATE_ID = "888277";


function formatPhoneNumber(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("91")) return `+${digits}`;
  if (digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("+")) return digits;
  return `+${digits}`;
}


export const bulkCreateAppraisals = async (req: Request, res: Response) => {
  try {
    const { cycle, employeeIds } = req.body;
    if (!cycle || !employeeIds || employeeIds.length === 0) {
      return res.status(400).json({ error: 'Cycle and employeeIds required' });
    }

    const result = await createAppraisalsForEmployees(employeeIds, cycle, 'Draft');
    return res.status(201).json({ message: 'Appraisals created', count: result.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create appraisals' });
  }
};

const generateUniqueAppraisalId = (employeeId: number) => {
  const date = new Date();
  return `${date.getFullYear()}${(date.getMonth() + 1)
    .toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}-${employeeId}`;
};

// Create appraisals for given employees
export const createAppraisalsForEmployees = async (
  employeeIds: number[],
  cycle: string,
  status = 'Draft'
) => {
  const employees = await prisma.employee.findMany({
    where: {
      id: { in: employeeIds },
      employmentStatus: 'ACTIVE'
    },
    select: { id: true, reportingManager: true, firstName: true, lastName: true }
  });

  const data = employees.map(emp => ({
    employeeId: emp.id,
    managerId: emp.reportingManager, // store reporting manager
    cycle,
    status,
    finalDecision: null,
    finalComments: null
  }));

  const created = await prisma.appraisalForm.createMany({ data });
  const managerIds = Array.from(
    new Set(employees.map(e => e.reportingManager).filter((id): id is number => !!id))
  );

  const managers = await prisma.employee.findMany({
    where: { id: { in: managerIds } },
    select: { id: true, phone: true, firstName: true, lastName: true }
  });

  const mgrById = new Map(managers.map(m => [m.id, m]));

  // Fire-and-forget WhatsApp notifications; don't block/throw the API
  await Promise.all(
    employees.map(async (emp) => {
      const mgr = emp.reportingManager ? mgrById.get(emp.reportingManager) : undefined;
      if (!mgr) return;
      const mgrPhone = formatPhoneNumber(mgr?.phone || "");
      if (!mgrPhone) return;

      const employeeName = [emp.firstName, emp.lastName].filter(Boolean).join(" ");

      // try {
      //   await sendWhatsAppTemplate({
      //     to: mgrPhone,
      //     templateId: APPRAISAL_CREATED_TEMPLATE_ID,
      //     placeholders: [employeeName] // add cycle if your template expects it
      //   });
      // } catch (e) {
      //   console.error("Appraisal create WA (manager) failed:", e);
      // }
      const message = `A new appraisal has been created for ${employeeName} and assigned to you for review. Kindly acknowledge and take appropriate action.`;

      try {
        await createNotification(mgr.id, message);
      } catch (e) {
        console.error("Appraisal in-app notification failed:", e);
      }
    })
  );

  return created;
};

// function getEmployeeCycle(doj: Date, now: Date) {
//   const diffMonths = monthsDiff(doj, now);

//   if (diffMonths < 3) return null; // not eligible yet

//   const cycleIndex = Math.floor(diffMonths / 3) + 1; // 1,2,3,4...
//   const year = now.getFullYear();

//   return {
//     cycleIndex,
//     cycleName: `Cycle ${cycleIndex} ${year}`
//   };
// }

function getEmployeeCycle(doj: Date, now: Date) {
  const diffMonths = monthsDiff(doj, now);

  if (diffMonths < 3) return null;

  const yearIndex = Math.floor(diffMonths / 12) + 1;
  const cycleInYear = Math.floor((diffMonths % 12) / 3) + 1;

  return {
    yearIndex,
    cycleIndex: cycleInYear,
    cycleName: `Year ${yearIndex} - Cycle ${cycleInYear}`
  };
}

function monthsDiff(from: Date, to: Date) {
  return (
    to.getFullYear() * 12 + to.getMonth()
    - (from.getFullYear() * 12 + from.getMonth())
  );
}


// export const initQuarterlyAppraisalScheduler = () => {
//   cron.schedule("* * * * *", async () => {
//     console.log("📅 Running quarterly appraisal creation job...");

//     try {
//       const activeEmployees = await prisma.employee.findMany({
//         where: { employmentStatus: "ACTIVE" },
//         select: { id: true }
//       });

//       if (!activeEmployees.length) {
//         console.log("⚠️ No active employees. Skipping appraisal creation.");
//         return;
//       }

//       const ids = activeEmployees.map(e => e.id);

//       // Determine quarter name
//       const now = new Date();
//       const quarter = Math.floor(now.getMonth() / 3) + 1;
//       const cycle = `Quarter ${quarter} ${now.getFullYear()}`;

//       await createAppraisalsForEmployees(ids, cycle, "Draft");

//       console.log(`✅ Appraisals created for ${ids.length} employees`);
//     } catch (error) {
//       console.error("❌ Error during quarterly appraisal scheduler:", error);
//     }
//   });
// };
export const initQuarterlyAppraisalScheduler = () => {
  cron.schedule('0 2 * * *', async () => {
    console.log('📅 [Cron] Running appraisal scheduler...');

    const now = new Date();

    try {
      const employees = await prisma.employee.findMany({
        where: { employmentStatus: 'ACTIVE' },
        select: {
          id: true,
          dateOfJoining: true,
          reportingManager: true,
          firstName: true,
          lastName: true
        }
      });

      for (const emp of employees) {
        if (!emp.dateOfJoining) continue;

        const cycleInfo = getEmployeeCycle(emp.dateOfJoining, now);
        if (!cycleInfo) continue;

        const { cycleIndex, cycleName } = cycleInfo;

        // ❌ Only 4 cycles per year
        // if (cycleIndex > 4) continue;

        // ❌ Skip if already exists
        const exists = await prisma.appraisalForm.findFirst({
          where: {
            employeeId: emp.id,
            cycle: cycleName
          }
        });

        if (exists) continue;

        // ✅ Create appraisal
        await createAppraisalsForEmployees(
          [emp.id],
          cycleName,
          'Draft'
        );

        console.log(`✅ Created appraisal for ${emp.firstName} (${cycleName})`);
      }

    } catch (error) {
      console.error('❌ Appraisal scheduler failed:', error);
    }
  });
};

export const getAllAppraisalsWithManagerReview = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const userRole: string = user?.role || '';
    const empId: number = Number(user?.empId);
    const deptId: number = Number(user?.deptId);

    const isHRManager = userRole === 'HR Manager' || userRole === 'HR';
    const isManagement = userRole === 'Management';
    const isReportingManager = userRole === 'Reporting Manager';
    // HR dept (dept 1), role 2 — handles appraisals for all other departments
    const isHRExecutive = deptId === 1 && !isHRManager && !isManagement && !isReportingManager;

    // Build where clause based on role/dept
    let whereClause: any = {};
    if (isHRManager || isManagement) {
      whereClause = {}; // see all
    } else if (isHRExecutive) {
      // HR executives see other-dept appraisals + their own appraisal (for self-appraisal module)
      whereClause = {
        OR: [
          { employee: { departmentId: { not: 1 } } },
          { employeeId: empId },
        ],
      };
    } else if (isReportingManager) {
      whereClause = {
        OR: [
          { employee: { reportingManager: empId } },
          { employeeId: empId },
        ],
      };
    } else {
      whereClause = { employeeId: empId }; // own appraisal only
    }

    const appraisals = await prisma.appraisalForm.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            designation: true,
            departmentId: true,
            email: true,
            dateOfJoining: true,
            reportingManager: true,
            gender: true,
            photoUrl: true
          }
        },
        managerReview: true,
        editRequests: { where: { status: "PENDING" }, select: { id: true, requestType: true, status: true } },
      },
      orderBy: { createdAt: "desc" }
    });
    const managerIds = appraisals
      .map((a) => a.managerId)
      .filter((id): id is number => !!id);

    const managers = await prisma.employee.findMany({
      where: { id: { in: managerIds } },
      select: { id: true, firstName: true, lastName: true },
    });

    const managerMap = new Map(
      managers.map((m) => [m.id, `${m.firstName} ${m.lastName}`])
    );

    const formatted = appraisals.map((appraisal) => {
      const result: any = {
        ...appraisal,
        managerName: appraisal.managerId
          ? managerMap.get(appraisal.managerId) || null
          : null,
      };
      // Determine per-appraisal score visibility:
      // HR Manager and Management always see scores.
      // Reporting Manager sees scores for appraisals they manage.
      // HR Executive sees scores for other-dept appraisals but NOT their own.
      // Everyone else never sees scores.
      const isOwnAppraisal = appraisal.employeeId === empId;
      const canViewThisScore =
        isHRManager ||
        isManagement ||
        (isHRExecutive && !isOwnAppraisal) ||
        (isReportingManager && !isOwnAppraisal);

      if (!canViewThisScore) {
        result.managerReview = null;
        result.finalDecision = null;
        result.finalComments = null;
      }
      return result;
    });

    res.json(formatted);
  } catch (error) {
    console.error("Error fetching appraisals:", error);
    res.status(500).json({ error: "Failed to fetch appraisals" });
  }
};

export const saveManagerReview = async (req: Request, res: Response) => {
  try {

    const {
      appraisalId,
      qualityOfWorkRating, qualityOfWorkComments,
      knowledgeOfJobRating, knowledgeOfJobComments,
      teamworkRating, teamworkComments,
      independenceRating, independenceComments,
      recordsRating, recordsComments,
      guestServiceRating, guestServiceComments,
      safetyRating, safetyComments,
      attendanceRating, attendanceComments,
      leadershipRating, leadershipComments,
      overallScore,
      comments,
      recommendations,
      finalDecision,
      finalComments
    } = req.body;

    await prisma.managerAppraisal.upsert({
      where: { appraisalFormId: appraisalId },
      update: {
        qualityOfWorkRating, qualityOfWorkComments,
        knowledgeOfJobRating, knowledgeOfJobComments,
        teamworkRating, teamworkComments,
        independenceRating, independenceComments,
        recordsRating, recordsComments,
        guestServiceRating, guestServiceComments,
        safetyRating, safetyComments,
        attendanceRating, attendanceComments,
        leadershipRating, leadershipComments,
        overallScore, comments, recommendations
      },
      create: {
        appraisalFormId: appraisalId,
        qualityOfWorkRating, qualityOfWorkComments,
        knowledgeOfJobRating, knowledgeOfJobComments,
        teamworkRating, teamworkComments,
        independenceRating, independenceComments,
        recordsRating, recordsComments,
        guestServiceRating, guestServiceComments,
        safetyRating, safetyComments,
        attendanceRating, attendanceComments,
        leadershipRating, leadershipComments,
        overallScore, comments, recommendations
      }
    });


    // Update final decision in AppraisalForm
    await prisma.appraisalForm.update({
      where: { id: appraisalId },
      data: {
        finalDecision,
        finalComments,
        overallScore,
        status: 'Reviewed'
      }
    });

    // 3️⃣ Fetch employee + manager details
    const appraisal = await prisma.appraisalForm.findUnique({
      where: { id: appraisalId },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
            reportingManager: true
          }
        }
      }
    });

    if (appraisal?.employee?.reportingManager) {
      const manager = await prisma.employee.findUnique({
        where: { id: appraisal.employee.reportingManager },
        select: { firstName: true, lastName: true }
      });

      const empName = `${appraisal.employee.firstName} ${appraisal.employee.lastName}`;
      const empCode = appraisal.employee.employeeCode;
      const managerName = manager
        ? `${manager.firstName} ${manager.lastName}`
        : 'Manager';

      const message = `${managerName} submitted appraisal for ${empName} (${empCode}).`;

      // 4️⃣ Send notification to all HRs
      const hrEmployees = await prisma.employee.findMany({
        where: { departmentId: 1 },
        select: { id: true },
      });

      for (const hr of hrEmployees) {
        await createNotification(hr.id, message);
      }
    }

    res.json({ message: 'Manager review saved successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save manager review' });
  }
};

export const sendAppraisalCountReminders = async (cycles?: string[]) => {
  // 1) Get pending forms with managerId + cycle
  const forms = await prisma.appraisalForm.findMany({
    where: {
      managerId: { not: null },
      ...(cycles ? { cycle: { in: cycles } } : {}),
      status: { in: ["Draft", "InReview", "PendingManager"] } // adjust to your statuses
    },
    select: { managerId: true, cycle: true }
  });

  // 2) Group by (managerId, cycle)
  type Bucket = { managerId: number; cycle: string; count: number };
  const buckets = new Map<string, Bucket>();
  const managerIds = new Set<number>();

  for (const f of forms) {
    if (!f.managerId) continue;
    const key = `${f.managerId}::${f.cycle}`;
    const b = buckets.get(key);
    if (b) b.count += 1;
    else {
      buckets.set(key, { managerId: f.managerId, cycle: f.cycle, count: 1 });
      managerIds.add(f.managerId);
    }
  }

  if (managerIds.size === 0) return { messagesSent: 0, managerCyclesCovered: 0 };

  // 3) Fetch manager phones from Employee
  const managers = await prisma.employee.findMany({
    where: { id: { in: Array.from(managerIds) } },
    select: { id: true, phone: true }
  });
  const phoneById = new Map<number, string>(
    managers.map(m => [m.id, formatPhoneNumber(m.phone || "")])
  );

  // 4) Send one WA per manager-cycle
  let sent = 0;
  await Promise.all(
    Array.from(buckets.values()).map(async b => {
      const phone = phoneById.get(b.managerId);
      const message = `You have ${b.count} pending appraisal(s) for the ${b.cycle} cycle. Please review them.`;
      console.log("Appraisal reminder:", message, managerIds);
      await createNotification(b.managerId, message);
      if (!phone) return;
      try {
        await sendWhatsAppTemplate({
          to: phone,
          templateId: APPRAISAL_REMINDER_COUNT_TEMPLATE_ID,
          placeholders: [String(b.count), b.cycle] // {{1}}=count, {{2}}=cycle
        });
        sent++;
      } catch (e) {
        console.error("Appraisal count reminder WA failed:", e);
      }
    })
  );

  return { messagesSent: sent, managerCyclesCovered: buckets.size };
};
