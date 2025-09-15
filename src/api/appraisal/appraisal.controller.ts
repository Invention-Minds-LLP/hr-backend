import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import cron from 'node-cron';
const prisma = new PrismaClient();
import { sendWhatsAppTemplate } from "../leave/leave.controller";

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
      const mgrPhone = formatPhoneNumber(mgr?.phone || "");
      if (!mgrPhone) return;

      const employeeName = [emp.firstName, emp.lastName].filter(Boolean).join(" ");

      try {
        await sendWhatsAppTemplate({
          to: mgrPhone,
          templateId: APPRAISAL_CREATED_TEMPLATE_ID,
          placeholders: [employeeName] // add cycle if your template expects it
        });
      } catch (e) {
        console.error("Appraisal create WA (manager) failed:", e);
      }
    })
  );

  return created;
};

cron.schedule('0 0 1 */3 *', async () => {
  console.log('Running quarterly appraisal creation job...');
  const activeEmployees = await prisma.employee.findMany({
    where: { employmentStatus: 'ACTIVE' },
    select: { id: true }
  });

  if (!activeEmployees.length) return;

  const ids = activeEmployees.map(e => e.id);
  const cycle = `Quarter ${Math.floor((new Date().getMonth() / 3) + 1)} ${new Date().getFullYear()}`;

  await createAppraisalsForEmployees(ids, cycle, 'Draft');
  console.log(`Appraisals created for ${ids.length} active employees`);
});
export const getAllAppraisalsWithManagerReview = async (req: Request, res: Response) => {
  try {
    const appraisals = await prisma.appraisalForm.findMany({
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
          }
        },
        managerReview: true // include ONLY ManagerAppraisal
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

    const formatted = appraisals.map((appraisal) => ({
      ...appraisal,
      managerName: appraisal.managerId
        ? managerMap.get(appraisal.managerId) || null
        : null,
    }));

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
