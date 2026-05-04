import { Request, Response } from 'express';
import { PrismaClient, $Enums } from '@prisma/client';
import { format } from 'date-fns';
import * as fsp from 'fs/promises';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import QRCode from 'qrcode';
import { Client } from 'basic-ftp';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
// import { ClearanceType } from '@prisma/client';
const prisma = new PrismaClient();
import cron from 'node-cron';
import { sendHealthCheckReminders } from '../employee/employee.controller';
import { createNotification } from '../notifications/notifications.controller';
import { revokeEmployeeAccess } from '../../lib/employeeAccess';
import { Prisma } from '@prisma/client';

type ClearanceItemRow = {
  label: string;
  status: string;
  verifierName?: string;
  verifierCode?: string;
};

type ClearanceRow = {
  type: string;                    // IT / Finance / HR / Admin / Security / Other
  decision: 'PENDING' | 'APPROVED' | 'REJECTED';
  decidedAt?: Date | null;
  note?: string | null;
  items?: ClearanceItemRow[];
};

export type ClearanceCertInput = {
  code: string;                    // e.g., CLR-EMP001-20250819-1234
  issuedAt: Date;
  verifyUrl: string;               // for QR
  employeeName: string;
  employeeCode: string;
  departmentName?: string | null;
  branchName?: string | null;
  dateOfJoining?: Date | null;
  lastWorkingDay?: Date | null;
  clearances: ClearanceRow[];      // table rows
  companyName: string;
  companyLogoUrl?: string;
  companyTagline?: string;
};

type ClearanceItemStatus = "PENDING" | "CLEARED" | "DUE" | "NA";

function computeClearanceDecision(items: { status: ClearanceItemStatus }[]): $Enums.ApprovalDecision {
  // If any DUE -> REJECTED
  if (items.some(i => i.status === "DUE")) return "REJECTED";

  // If all are CLEARED or NA -> APPROVED
  if (items.length > 0 && items.every(i => i.status === "CLEARED" || i.status === "NA")) return "APPROVED";

  // Else pending
  return "PENDING";
}

/** Utils */
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);

/** Create resignation (Employee) */
export async function createResignation(req: Request, res: Response) {
  try {
    const { employeeId, reason, additionalNotes, noticePeriodDays } = req.body;

    // capture manager at the time of submission
    const emp = await prisma.employee.findUnique({
      where: { id: Number(employeeId) },
      select: { reportingManager: true, employeeCode: true, firstName: true, lastName: true }
    });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const npd = Number(noticePeriodDays || 30);
    const proposedLWD = addDays(new Date(), npd);

    const rec = await prisma.resignationRequest.create({
      data: {
        employeeId: Number(employeeId),
        managerId: emp.reportingManager ?? null,
        reason,
        additionalNotes,
        noticePeriodDays: npd,
        proposedLastWorkingDay: proposedLWD,
        status: 'SUBMITTED'
      }
    });

    // 🔔 Notify manager + HR
    try {
      const hrIds = await getHRIds();
      const notifyIds = new Set<number>();

      if (emp.reportingManager) notifyIds.add(emp.reportingManager);
      hrIds.forEach(id => notifyIds.add(id));

      const message = `New resignation submitted by Employee ${emp.firstName} ${emp.lastName} (${emp.employeeCode}).`;

      for (const id of notifyIds) {
        await createNotification(id, message);
      }
    } catch (err) {
      console.error("Resignation notification failed:", err);
    }


    res.status(201).json(rec);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create resignation' });
  }
}

/** List resignations with scope:
 *  - scope=mine&employeeId=#
 *  - scope=manager&managerId=#
 *  - scope=all (HR / HR Manager)
 *  Optional status filter: ?status=UNDER_REVIEW
 */
export async function listResignations(req: Request, res: Response) {
  try {
    const { scope, employeeId, managerId, status } = req.query as Record<string, string | undefined>;

    const where: any = {};
    if (status) where.status = status as $Enums.ResignationStatus;

    if (scope === 'mine' && employeeId) where.employeeId = Number(employeeId);
    else if (scope === 'manager' && managerId) where.managerId = Number(managerId);
    // scope=all -> no additional filter

    const rows = await prisma.resignationRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, departmentId: true, designation: true, reportingManager: true, gender: true, photoUrl: true

          }
        },
        handoverTasks: true,
        clearances: true,
        exitInterview: true,
        finalSettlement: true
      }
    });

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch resignations' });
  }
}

export async function getResignationById(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const row = await prisma.resignationRequest.findUnique({
      where: { id },
      select: {
        id: true,

        // Only the minimal employee info you use
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },

        // Tasks
        handoverTasks: {
          select: {
            id: true,
            title: true,
            description: true,
            assigneeId: true,
            dueDate: true,
            status: true,
            completedAt: true
          }
        },

        // Clearances
        // clearances: {
        //   select: {
        //     id: true,
        //     type: true,
        //     decision: true,
        //     note: true,
        //     verifierId: true,
        //     departmentId:true,
        //     department: {
        //       select: { name: true }
        //     },
        //     verifier: {
        //       select: {
        //         firstName: true,
        //         lastName: true
        //       }
        //     }
        //   }
        // },
        clearances: {
          select: {
            id: true,
            type: true,
            decision: true,
            note: true,
            verifierId: true,
            departmentId: true,

            department: {
              select: { name: true }
            },

            verifier: {
              select: {
                firstName: true,
                lastName: true
              }
            },

            items: {                         // ← ADD THIS
              select: {
                id: true,
                label: true,
                status: true,
                note: true,
                verifier: {
                  select: {
                    firstName: true,
                    lastName: true
                  }
                }
              },
              orderBy: { id: 'asc' }
            }
          }
        },


        // Exit Interview
        exitInterview: {
          select: {
            scheduledAt: true,
            interviewerId: true,
            notes: true
          }
        },

        // Final Settlement
        finalSettlement: {
          select: {
            status: true,
            note: true
          }
        },

        documents: true
      }
    });

    if (!row) return res.status(404).json({ error: 'Resignation not found' });
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch resignation' });
  }
}

/** Employee can withdraw before final HR decision */
export async function withdrawResignation(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const row = await prisma.resignationRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.hrDecision !== 'PENDING') {
      return res.status(400).json({ error: 'Cannot withdraw after HR decision' });
    }
    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: { status: 'WITHDRAWN' }
    });
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to withdraw' });
  }
}

/** Manager approve/reject */
export async function managerApprove(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { note, overrideLastWorkingDay } = req.body; // optional LWD adjust
    const data: any = {
      managerDecision: 'APPROVED',
      managerDecidedAt: new Date(),
      managerNote: note,
      status: 'UNDER_REVIEW'
    };
    if (overrideLastWorkingDay) data.proposedLastWorkingDay = new Date(overrideLastWorkingDay);

    const upd = await prisma.resignationRequest.update({
      where: { id },
      data,
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true
          }
        }
      }
    });
    // 🔔 Notify HR after manager decision
    try {
      const hrIds = await getHRIds();
      const message = `Manager has approved the resignation of employee ${upd.employee.firstName} ${upd.employee.lastName} (${upd.employee.employeeCode}).`;

      for (const hrId of hrIds) {
        await createNotification(hrId, message);
      }
    } catch (err) {
      console.error("Manager action notification failed:", err);
    }

    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Manager approval failed' });
  }
}

export async function managerReject(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { note } = req.body;
    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: {
        managerDecision: 'REJECTED',
        managerDecidedAt: new Date(),
        managerNote: note,
        status: 'REJECTED'
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true
          }
        }
      }
    });
    // 🔔 Notify HR after manager decision
    try {
      const hrIds = await getHRIds();
      const message = `Manager has rejected the resignation of employee ${upd.employee.firstName} ${upd.employee.lastName} (${upd.employee.employeeCode}).`;

      for (const hrId of hrIds) {
        await createNotification(hrId, message);
      }
      await createNotification(upd.employeeId, `Your resignation has been rejected by your manager.`);
    } catch (err) {
      console.error("Manager action notification failed:", err);
    }

    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Manager rejection failed' });
  }
}

/** HR approve/reject */
export async function hrApprove(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { note, actualLastWorkingDay } = req.body;

    // Step 1: Approve the resignation and include employee info
    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: {
        hrDecision: 'APPROVED',
        hrDecidedAt: new Date(),
        hrNote: note,
        actualLastWorkingDay: actualLastWorkingDay ? new Date(actualLastWorkingDay) : undefined,
        status: 'APPROVED',
      },
      include: {
        employee: {
          include: {
            Department: true,
            Branch: true,
            designation: true
          },
        },
      },
    });

    // Step 2: Update employee status → NOTICE_PERIOD
    await prisma.employee.update({
      where: { id: upd.employeeId },
      data: { employmentStatus: 'NOTICE_PERIOD' }
    });

    // Step 3: Auto-create backfill job (if none exists)
    const existingJob = await prisma.job.findFirst({
      where: {
        backfillForEmployeeId: upd.employeeId,
        status: { in: ['OPEN', 'ON_HOLD'] },
      },
    });

    if (!existingJob && upd.employee) {
      const designationName = upd.employee.designation?.name ?? 'Default';
      const newJob = await prisma.job.create({
        data: {
          title: `${designationName} - Replacement`,
          departmentId: upd.employee.departmentId,
          location: upd.employee.Branch?.location || 'Unknown',
          headcount: 1,
          status: 'OPEN',
          createdBy: 0, // Fallback HR/system user ID
          backfillForEmployeeId: upd.employeeId,
        },
      });


      console.log(`✅ Created new job for replacement: Job ID ${newJob.id}`);
    }

    // 🔔 Notify employee about HR approval
    try {
      await createNotification(upd.employeeId, `Your resignation has been approved by HR. Please complete exit formalities.`);
    } catch (err) {
      console.error("HR approval notification failed:", err);
    }
    const defaultDepts = await prisma.department.findMany({
      where: { isDefaultClearance: true },
      select: { id: true },
    });

    const defaultDeptIds = defaultDepts.map(d => d.id);

    // create HOD + default departments
    await initOffboardingClearances(upd.id, defaultDeptIds);

    // ✅ IMPORTANT: at HR approval, create HOD clearance only (department manager)
    // Department clearances will be created after HR selects departments in post-HR screen
    // await initOffboardingClearances(upd.id, []); // only HOD

    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'HR approval failed' });
  }
}


export async function hrReject(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { note } = req.body;
    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: {
        hrDecision: 'REJECTED',
        hrDecidedAt: new Date(),
        hrNote: note,
        status: 'REJECTED'
      }
    });
    try {
      await createNotification(upd.employeeId, `Your resignation has been rejected by HR.`);
    } catch (err) {
      console.error("HR rejection notification failed:", err);
    }
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'HR rejection failed' });
  }
}

export async function hrCancel(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });
    try {
      await createNotification(upd.employeeId, `Your resignation has been cancelled by HR.`);
    } catch (err) {
      console.error("HR cancel notification failed:", err);
    }
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Cancel failed' });
  }
}

/** Handover tasks */
export async function addHandoverTasks(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { tasks } = req.body as { tasks: Array<{ title: string; description?: string; assigneeId?: number; dueDate?: string }> };
    const created = await prisma.$transaction(tasks.map(t =>
      prisma.resignationHandoverTask.create({
        data: {
          resignationId: id,
          title: t.title,
          description: t.description,
          assigneeId: t.assigneeId ?? null,
          dueDate: t.dueDate ? new Date(t.dueDate) : null
        }
      })
    ));
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Add tasks failed' });
  }
}

export async function updateTask(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const taskId = Number(req.params.taskId);
    const { status } = req.body as { status: $Enums.TaskStatus };
    const upd = await prisma.resignationHandoverTask.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: status === 'DONE' ? new Date() : null
      }
    });
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Update task failed' });
  }
}

/** Clearances (upsert per type) */
// export async function upsertClearance(req: Request, res: Response) {
//   try {
//     const id = Number(req.params.id);
//     const { type, decision, note, verifierId } = req.body as {
//       type: $Enums.ClearanceType;
//       decision: $Enums.ApprovalDecision;
//       note?: string;
//       verifierId?: number;
//     };

//     const existing = await prisma.resignationClearance.findUnique({
//       where: { resignationId_type: { resignationId: id, type } }
//     });

//     const row = existing
//       ? await prisma.resignationClearance.update({
//         where: { id: existing.id },
//         data: { decision, note, verifierId: verifierId ?? null, decidedAt: new Date() }
//       })
//       : await prisma.resignationClearance.create({
//         data: { resignationId: id, type, decision, note, verifierId: verifierId ?? null, decidedAt: new Date() }
//       });

//     res.json(row);
//   } catch (e) {
//     console.error(e);
//     res.status(500).json({ error: 'Clearance update failed' });
//   }
// }
export async function upsertClearance(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { departmentId, decision, note, verifierId } = req.body as {
      departmentId: number;
      decision: $Enums.ApprovalDecision;
      note?: string;
      verifierId?: number;
    };

    // get department name
    const dept = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { name: true }
    });

    if (!dept) {
      return res.status(404).json({ error: 'Department not found' });
    }

    const type = dept.name;

    const existing = await prisma.resignationClearance.findFirst({
      where: { resignationId: id, departmentId }
    });

    const row = existing
      ? await prisma.resignationClearance.update({
        where: { id: existing.id },
        data: { decision, note, verifierId: verifierId ?? null, decidedAt: new Date() }
      })
      : await prisma.resignationClearance.create({
        data: {
          resignationId: id,
          departmentId,
          type,
          decision,
          note,
          verifierId: verifierId ?? null,
          decidedAt: new Date()
        }
      });

    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Clearance update failed' });
  }
}


/** Exit interview scheduling */
export async function scheduleExitInterview(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { scheduledAt, interviewerId, notes } = req.body;
    const resignation = await prisma.resignationRequest.findUnique({
      where: { id: id },
      select: { employeeId: true },
    });

    if (!resignation) {
      return res.status(404).json({ error: 'Resignation request not found' });
    }
    const row = await prisma.exitInterview.upsert({
      where: { resignationId: id },
      create: {
        resignationId: id,
        employeeId: resignation.employeeId,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        interviewerId: interviewerId ?? null,
        notes
      },
      update: {
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        interviewerId: interviewerId ?? null,
        employeeId: resignation.employeeId,
        notes
      }
    });
    // 🔔 Notify employee about exit interview
    // try {
    //   const message = `Your exit interview has been scheduled. Please check details.`;
    //   await createNotification(resignation.employeeId, message);
    // } catch (err) {
    //   console.error("Exit interview notification failed:", err);
    // }

    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Exit interview scheduling failed' });
  }
}
export async function createExitInterview(req: Request, res: Response) {
  try {
    const d = req.body;
    const interview = await prisma.exitInterview.update({
      where: { resignationId: d.resignationId },
      data: {
        employeeId: Number(d.employeeId),
        interviewerId: d.interviewerId,
        outcome: d.outcome,
        completedAt: new Date(),

        nextOrgName: d.nextOrgName,
        nextOrgPosition: d.nextOrgPosition,
        nextOrgCategory: d.nextOrgCategory,
        nextOrgLocation: d.nextOrgLocation,
        nextOrgIndustry: d.nextOrgIndustry,

        academicQualification: JSON.stringify(d.academicQualification || {}),
        vacancySource: JSON.stringify(d.vacancySource || {}),
        recruitmentMode: JSON.stringify(d.recruitmentMode || {}),

        reasonForLeaving: d.reasonForLeaving,
        triggerReason: d.triggerReason,
        mostSatisfying: d.mostSatisfying,
        leastSatisfying: d.leastSatisfying,
        supportReceived: d.supportReceived,
        newJobOffers: d.newJobOffers,

        expectationsMet: d.expectationsMet,
        skillUtilization: d.skillUtilization,

        influencedFactors: JSON.stringify(d.influencedFactors || {}),
        dissatisfaction: JSON.stringify(d.dissatisfaction || {}),
        jobOpinion: JSON.stringify(d.jobOpinion || {}),
        attitudeSuperiors: JSON.stringify(d.attitudeSuperiors || {}),
        companyOpinion: JSON.stringify(d.companyOpinion || {}),

        newJobSalaryComparison: d.newJobSalaryComparison,
        discrimination: d.discrimination,
        likedMost: d.likedMost,
        stayEncouragement: d.stayEncouragement,
        recommendCompany: d.recommendCompany,
        recommendReason: d.recommendReason,
        demotivating: JSON.stringify(d.demotivating || {}),
      },
    });
    return res.json(interview);
  } catch (e: any) {
    console.error("createExitInterview error:", e);
    return res.status(500).json({ error: e?.message || "Failed to save exit interview" });
  }
}


// GET one Exit Interview
export async function getExitInterview(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const interview = await prisma.exitInterview.findUnique({
      where: { id },
      include: { employee: true },
    });
    if (!interview) return res.status(404).json({ error: "Not found" });

    const parsed = {
      ...interview,
      academicQualification: interview.academicQualification ? JSON.parse(interview.academicQualification) : {},
      vacancySource: interview.vacancySource ? JSON.parse(interview.vacancySource) : {},
      recruitmentMode: interview.recruitmentMode ? JSON.parse(interview.recruitmentMode) : {},
      influencedFactors: interview.influencedFactors ? JSON.parse(interview.influencedFactors) : {},
      dissatisfaction: interview.dissatisfaction ? JSON.parse(interview.dissatisfaction) : {},
      jobOpinion: interview.jobOpinion ? JSON.parse(interview.jobOpinion) : {},
      attitudeSuperiors: interview.attitudeSuperiors ? JSON.parse(interview.attitudeSuperiors) : {},
      companyOpinion: interview.companyOpinion ? JSON.parse(interview.companyOpinion) : {},
      demotivating: interview.demotivating ? JSON.parse(interview.demotivating) : {},
    };

    return res.json(parsed);
  } catch (e: any) {
    console.error("getExitInterview error:", e);
    return res.status(500).json({ error: e?.message || "Failed to fetch exit interview" });
  }
}

// LIST all Exit Interviews
export async function listExitInterviews(_req: Request, res: Response) {
  try {
    const all = await prisma.exitInterview.findMany({
      include: { employee: true }, // get employee
      orderBy: { createdAt: "desc" },
    });

    // Map through interviews and fetch interviewer name
    const withInterviewer = await Promise.all(
      all.map(async (interview) => {
        let interviewerName = null;
        if (interview.interviewerId) {
          const interviewer = await prisma.employee.findUnique({
            where: { id: interview.interviewerId },
            select: { firstName: true, lastName: true, gender: true, photoUrl: true },
          });
          if (interviewer) {
            interviewerName = `${interviewer.firstName} ${interviewer.lastName}`;
          }
        }

        return {
          ...interview,
          interviewerName, // add computed field
        };
      })
    );

    return res.json(withInterviewer);
  } catch (e: any) {
    console.error("listExitInterviews error:", e);
    return res.status(500).json({ error: e?.message || "Failed to fetch exit interviews" });
  }
}


/** Final settlement status */
export async function setFinalSettlement(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { status, note } = req.body as { status: $Enums.SettlementStatus; note?: string };
    const row = await prisma.finalSettlement.upsert({
      where: { resignationId: id },
      create: { resignationId: id, status, note },
      update: { status, note }
    });
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Final settlement update failed' });
  }
}

/** Mark completed (HR) */
export async function markCompleted(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: { status: 'COMPLETED' }
    });
    // try {
    //   await createNotification(
    //     upd.employeeId,
    //     "Your exit process has been completed. We wish you all the best."
    //   );
    // } catch (err) {
    //   console.error("Completion notification failed:", err);
    // }
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Mark completed failed' });
  }
}
// PUT /resignations/:id/hr-hold  { note? }
export async function hrHold(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { note } = req.body as { note?: string };

    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: {
        status: 'ON_HOLD',
        hrNote: note ?? undefined,
        // keep hrDecision as PENDING (not decided yet)
        // hrDecidedAt: null  // optional: clear decidedAt if it was set
      }
    });
    // try {
    //   await createNotification(
    //     upd.employeeId,
    //     "Your resignation has been placed on hold by HR. Please contact HR for details."
    //   );
    // } catch (err) {
    //   console.error("HR hold notification failed:", err);
    // }
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'HR hold failed' });
  }
}
// POST /resignations/:id/request-withdraw
export async function requestWithdraw(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body;

    const row = await prisma.resignationRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Not found" });

    // Cannot request if already approved/rejected/withdrawn
    if (["APPROVED", "REJECTED", "WITHDRAWN"].includes(row.status)) {
      return res.status(400).json({ error: "Cannot request withdraw at this stage" });
    }

    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: {
        status: "WITHDRAW_REQUESTED",
        withdrawRequestedAt: new Date(),
        withdrawnReason: reason,
        withdrawDecision: null,
        withdrawDecidedAt: null,
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true
          }
        }
      }
    });
    // 🔔 Notify HR about withdraw request
    // try {
    //   const hrIds = await getHRIds();
    //   const message = `Withdraw request submitted for resignation of employee ${upd.employee.firstName} ${upd.employee.lastName} (${upd.employee.employeeCode}).`;

    //   for (const hrId of hrIds) {
    //     await createNotification(hrId, message);
    //   }
    // } catch (err) {
    //   console.error("Withdraw notification failed:", err);
    // }

    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Request withdraw failed" });
  }
}
// POST /resignations/:id/hr-withdraw-approve
export async function hrApproveWithdraw(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { note, approvedBy } = req.body;

    const row = await prisma.resignationRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.status !== "WITHDRAW_REQUESTED") {
      return res.status(400).json({ error: "No withdraw request pending" });
    }

    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: {
        status: "WITHDRAWN",
        withdrawDecision: "APPROVED",
        withdrawDecidedAt: new Date(),
        withdrawnAt: new Date(),
        withdrawStatusChangedBy: approvedBy,
      },
    });
    // 🔔 Notify employee withdraw approved
    // try {
    //   const message = `Your resignation withdrawal has been approved.`;
    //   await createNotification(row.employeeId, message);
    // } catch (err) {
    //   console.error("Employee withdraw notification failed:", err);
    // }

    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "HR withdraw approval failed" });
  }
}
// POST /resignations/:id/hr-withdraw-reject
export async function hrRejectWithdraw(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { note, rejectedBy } = req.body;

    const row = await prisma.resignationRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.status !== "WITHDRAW_REQUESTED") {
      return res.status(400).json({ error: "No withdraw request pending" });
    }

    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: {
        withdrawDecision: "REJECTED",
        withdrawDecidedAt: new Date(),
        withdrawStatusChangedBy: rejectedBy,
        status: "SUBMITTED", // go back to normal resignation workflow
      },
    });
    // 🔔 Notify employee withdraw approved
    // try {
    //   const message = `Your resignation withdrawal has been rejected.`;
    //   await createNotification(row.employeeId, message);
    // } catch (err) {
    //   console.error("Employee withdraw notification failed:", err);
    // }

    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "HR withdraw rejection failed" });
  }
}



const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL ?? 'https://example.com';
const COMPANY_NAME = process.env.COMPANY_NAME ?? 'HR MINDS';
const COMPANY_LOGO_URL = process.env.COMPANY_LOGO_URL ?? ''; // optional
const COMPANY_TAGLINE = process.env.COMPANY_TAGLINE ?? '';   // optional
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'https://hrproindia.in';
const FTP_PUBLIC_DIR = process.env.FTP_PUBLIC_DIR ?? '/public_html/certificate'; // remote dir

export const generateClearanceCertificate = async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  // 1) Load resignation with related data
  const r = await prisma.resignationRequest.findUnique({
    where: { id },
    include: {
      employee: { include: { Department: true, Branch: true } },
      clearances: {
        include: {
          department: { select: { name: true } },
          items: {
            include: {
              verifier: {
                select: {
                  firstName: true,
                  lastName: true,
                  employeeCode: true
                }
              }
            }
          }
        }
      },
      handoverTasks: true,
      finalSettlement: true,
    },
  });
  if (!r) return res.status(404).json({ message: 'Resignation not found' });


  // 2) Eligibility checks
  // const allClearancesApproved = r.clearances.length > 0 && r.clearances.every(c => c.decision === 'APPROVED');
  const requiredClearances = r.clearances;
  // const allClearancesApproved =
  //   requiredClearances.length > 0 &&
  //   requiredClearances.every(c => c.decision === 'APPROVED');
  const allClearancesApproved =
    r.clearances.length > 0 &&
    r.clearances.every(c => c.decision === "APPROVED");


  const allTasksDone = r.handoverTasks.every(t => t.status === 'DONE');
  const settlementPaid = r.finalSettlement?.status === 'PAID';
  const statusOk = ['APPROVED', 'COMPLETED'].includes(r.status);

  if (!statusOk || !allClearancesApproved || !allTasksDone || !settlementPaid) {
    return res.status(400).json({
      message: 'Not eligible for clearance',
      details: { statusOk, allClearancesApproved, allTasksDone, settlementPaid },
    });
  }

  // 3) Build code + verification link
  const code = `CLR-${r.employee.employeeCode}-${format(new Date(), 'yyyyMMdd-HHmm')}`;
  const verifyUrl = `${APP_PUBLIC_URL}/verify/clearance/${code}`;

  // 4) Generate PDF (temp file)
  const { filePath, fileName } = await generateClearancePdf({
    code,
    issuedAt: new Date(),
    verifyUrl,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
    employeeCode: r.employee.employeeCode,
    departmentName: r.employee.Department?.name ?? null,
    branchName: r.employee.Branch?.name ?? null,
    dateOfJoining: r.employee.dateOfJoining,
    lastWorkingDay: r.actualLastWorkingDay ?? r.proposedLastWorkingDay,
    // clearances: r.clearances.map(c => ({
    //   type: c.department?.name || c.type,

    //   decision: c.decision as any, // 'PENDING' | 'APPROVED' | 'REJECTED'
    //   decidedAt: c.decidedAt,
    //   note: c.note,
    //   // ✅ NEW: include checklist summary
    //   items: (c.items || []).map(it => ({
    //     label: it.label,
    //     status: it.status,
    //     verifierName: it.verifier ? `${it.verifier.firstName} ${it.verifier.lastName}` : ""
    //   })),
    // })),
    clearances: r.clearances.map(c => ({
      // type: c.department?.name || c.type,
      type:
        c.type === 'HOD'
          ? 'HOD'
          : c.department?.name || c.type,
      decision: c.decision as any,
      decidedAt: c.decidedAt,
      note: c.note,
      items: (c.items || []).map(it => ({
        label: it.label,
        status: it.status,
        verifierName: it.verifier
          ? `${it.verifier.firstName} ${it.verifier.lastName}`
          : "",
        verifierCode: it.verifier?.employeeCode || ""
      })),
    })),
    companyName: COMPANY_NAME,
    companyLogoUrl: COMPANY_LOGO_URL,
    companyTagline: COMPANY_TAGLINE,
  });

  // 5) Upload to FTP
  const remotePath = `${FTP_PUBLIC_DIR}/${fileName}`; // e.g. /public_html/certificate/CLR-EMP001-20250819-1234.pdf
  await uploadToFTP(filePath, remotePath);

  // 6) Public URL to return & persist
  // If your Hostinger public dir maps to https://hrproindia.in/certificate/
  // ensure your FTP_PUBLIC_DIR is /public_html/certificate
  const filePublicPath = remotePath.replace('/public_html', ''); // -> /certificate/xxx.pdf
  const publicUrl = `${PUBLIC_BASE_URL}${filePublicPath}`;

  // 7) Persist URL + code
  await prisma.resignationDocument.upsert({
    where: { resignationId: r.id },
    create: { resignationId: r.id, clearanceCertificateUrl: publicUrl, clearanceCertificateCode: code, clearanceIssuedAt: new Date(), },
    update: { clearanceCertificateUrl: publicUrl, clearanceCertificateCode: code, clearanceIssuedAt: new Date() },
  });


  // 8) Cleanup temp
  try { await fsp.unlink(filePath); } catch { }

  return res.json({ url: publicUrl, code });
};
async function generateClearancePdf(input: ClearanceCertInput): Promise<{ filePath: string; fileName: string; }> {
  const fileName = `${input.code}.pdf`;
  const filePath = path.join(os.tmpdir(), fileName);

  const doc = new PDFDocument({ size: 'A4', margin: 36 }); // 595 x 842 pt
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const w = doc.page.width, h = doc.page.height;
  const M = 36;

  const fmtDate = (d?: Date | null) =>
    d ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d) : '—';

  async function fetchBuffer(url?: string) {
    if (!url) return null;
    try {
      const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
      return Buffer.from(res.data);
    } catch {
      return null;
    }
  }
  function dataURLtoBuffer(dataUrl: string) {
    const base64 = dataUrl.split(',')[1];
    return Buffer.from(base64, 'base64');
  }

  // Borders
  doc.save().roundedRect(18, 18, w - 36, h - 36, 12).lineWidth(3).stroke('#1f2937').restore();
  doc.save().roundedRect(28, 28, w - 56, h - 56, 10).lineWidth(1).stroke('#9ca3af').restore();

  // Header
  let cursorY = 54;
  const logo = await fetchBuffer(input.companyLogoUrl);
  if (logo) {
    const logoW = 72;
    doc.image(logo, (w - logoW) / 2, cursorY, { width: logoW });
    cursorY += 84;
  }

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827')
    .text(input.companyName, M, cursorY, { width: w - 2 * M, align: 'center' });
  cursorY = doc.y;

  if (input.companyTagline) {
    doc.font('Helvetica').fontSize(10).fillColor('#6b7280')
      .text(input.companyTagline, M, cursorY + 2, { width: w - 2 * M, align: 'center' });
    cursorY = doc.y;
  }

  // Meta
  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(10).fillColor('#374151');
  doc.text(`Issued on: ${fmtDate(input.issuedAt)}`, M, doc.y, { width: (w - 2 * M) / 2, align: 'left' });
  doc.text(`Certificate ID: ${input.code}`, M + (w - 2 * M) / 2, doc.y - 12, { width: (w - 2 * M) / 2, align: 'right' });
  cursorY = doc.y + 6;

  // Title
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#1f2937')
    .text('CLEARANCE CERTIFICATE', M, cursorY, { width: w - 2 * M, align: 'center' });
  cursorY = doc.y + 8;

  // Employee Panel
  const panelX = M;
  const panelW = w - 2 * M;
  let panelY = cursorY;
  const panelPad = 10;
  const summaryStartY = panelY + panelPad;
  const leftW = panelW / 2 - 8;
  const rightW = panelW / 2 - 8;

  doc.font('Helvetica').fontSize(12).fillColor('#111827');
  let yL = summaryStartY;
  doc.text(`Employee Name: ${input.employeeName}`, panelX + panelPad, yL, { width: leftW }); yL = doc.y + 4;
  doc.text(`Employee Code: ${input.employeeCode}`, panelX + panelPad, yL, { width: leftW }); yL = doc.y + 4;
  doc.text(`Date of Joining: ${fmtDate(input.dateOfJoining ?? null)}`, panelX + panelPad, yL, { width: leftW });

  let yR = summaryStartY;
  doc.text(`Department: ${input.departmentName ?? '—'}`, panelX + panelPad + leftW + 16, yR, { width: rightW }); yR = doc.y + 4;
  doc.text(`Branch: ${input.branchName ?? '—'}`, panelX + panelPad + leftW + 16, yR, { width: rightW }); yR = doc.y + 4;
  doc.text(`Last Working Day: ${fmtDate(input.lastWorkingDay ?? null)}`, panelX + panelPad + leftW + 16, yR, { width: rightW });

  const panelH = Math.max(yL, yR) - summaryStartY + panelPad + 10;
  doc.save().roundedRect(panelX, panelY, panelW, panelH, 8).lineWidth(1).stroke('#e5e7eb').restore();
  cursorY = panelY + panelH + 10;

  // Statement
  doc.font('Helvetica').fontSize(12).fillColor('#374151')
    .text('This is to certify that the above employee has completed the exit formalities and has no dues pending with the company as on the date of issue.',
      M, cursorY, { width: w - 2 * M, align: 'left' });
  cursorY = doc.y + 10;

  // Table
  const tableX = M;
  const pageBottom = h - 140; // leave room for QR/signatures
  const colWidths = [120, 90, 100, (w - 2 * M) - (120 + 90 + 100)];
  const headerH = 22;
  let y = cursorY;

  const drawHeader = () => {
    drawRow({ doc, x: tableX, y, heights: headerH, widths: colWidths, cells: ['Clearance Area', 'Decision', 'Approved On', 'Notes'], header: true });
    y += headerH;
  };
  drawHeader();

  // for (const c of input.clearances) {
  //   const cells = [c.type, c.decision, fmtDate(c.decidedAt ?? null), c.note ?? ''];
  //   const neededH = measureRowHeight({ doc, widths: colWidths, cells });
  //   if (y + neededH > pageBottom) {
  //     doc.addPage();
  //     y = M;
  //     // repeat header on new page
  //     drawHeader();
  //   }
  //   y += drawRow({ doc, x: tableX, y, heights: 22, widths: colWidths, cells });
  // }

  // QR + signatures
  // const qrDataUrl = await QRCode.toDataURL(input.verifyUrl);
  // const qrBuf = dataURLtoBuffer(qrDataUrl);
  // const qrSize = 96;
  // const qrX = w - M - qrSize;
  // const qrY = Math.min(h - 180, y + 12);
  // doc.image(qrBuf, qrX, qrY, { width: qrSize });
  // doc.font('Helvetica').fontSize(10).fillColor('#6b7280')
  //    .text('Scan to verify', qrX, qrY + qrSize + 4, { width: qrSize, align: 'center' });
  for (const c of input.clearances) {
    // Department row (bold)
    const deptCells = [
      c.type,
      c.decision,
      fmtDate(c.decidedAt ?? null),
      c.note ?? ''
    ];

    const deptH = measureRowHeight({ doc, widths: colWidths, cells: deptCells });
    if (y + deptH > pageBottom) {
      doc.addPage();
      y = M;
      drawHeader();
    }

    doc.font('Helvetica-Bold');
    y += drawRow({ doc, x: tableX, y, heights: 22, widths: colWidths, cells: deptCells });
    doc.font('Helvetica');

    // Checklist items
    for (const it of c.items || []) {
      const itemCells = [
        `   • ${it.label}`,
        it.status,
        '',
        it.verifierName
          ? `${it.verifierName} (${it.verifierCode})`
          : ''
      ];

      const itemH = measureRowHeight({ doc, widths: colWidths, cells: itemCells });
      if (y + itemH > pageBottom) {
        doc.addPage();
        y = M;
        drawHeader();
      }

      y += drawRow({ doc, x: tableX, y, heights: 20, widths: colWidths, cells: itemCells });
    }
  }

  const sigY = Math.min(h - 180, y + 12) + 20;
  doc.moveTo(M + 30, sigY).lineTo(M + 180, sigY).stroke('#9ca3af');
  doc.moveTo(M + 230, sigY).lineTo(M + 380, sigY).stroke('#9ca3af');
  doc.font('Helvetica').fontSize(10).fillColor('#374151')
    .text('HR Representative', M + 30, sigY + 6, { width: 150, align: 'center' })
    .text('Department Head', M + 230, sigY + 6, { width: 150, align: 'center' });

  doc.font('Helvetica').fontSize(10).fillColor('#6b7280');
  doc.text('This is a system-generated document and does not require a physical signature.', M, h - 70, {
    width: w - 2 * M, align: 'center'
  });

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return { filePath, fileName };

  // ------- helpers -------
  function measureRowHeight(opts: { doc: PDFKit.PDFDocument; widths: number[]; cells: string[] }) {
    const padX = 6, padY = 6;
    let maxH = 22;
    const originalY = (doc as any).y;
    for (let i = 0; i < opts.cells.length; i++) {
      const width = opts.widths[i] - padX * 2;
      const height = (doc as any).heightOfString(opts.cells[i] ?? '', { width, align: 'left' });
      maxH = Math.max(maxH, height + padY * 2);
    }
    (doc as any).y = originalY;
    return maxH;
  }

  function drawRow(opts: {
    doc: PDFKit.PDFDocument;
    x: number; y: number;
    widths: number[]; heights: number;
    cells: string[]; header?: boolean;
  }): number {
    const padX = 6, padY = 6;
    const baseY = opts.y;
    const totalW = opts.widths.reduce((a, b) => a + b, 0);

    if (opts.header) {
      doc.save().rect(opts.x, baseY, totalW, opts.heights).fill('#f3f4f6').restore();
      doc.lineWidth(1).strokeColor('#e5e7eb').rect(opts.x, baseY, totalW, opts.heights).stroke();
      doc.font('Helvetica-Bold').fillColor('#111827').fontSize(11);
    } else {
      doc.lineWidth(1).strokeColor('#e5e7eb').rect(opts.x, baseY, totalW, opts.heights).stroke();
      doc.font('Helvetica').fillColor('#111827').fontSize(11);
    }

    let cx = opts.x;
    let maxY = baseY + opts.heights;
    for (let i = 0; i < opts.cells.length; i++) {
      const cellW = opts.widths[i];
      const tx = cx + padX;
      const ty = baseY + padY;
      const options = { width: cellW - padX * 2, align: 'left' } as PDFKit.Mixins.TextOptions;
      const startY = (doc as any).y;
      doc.text(opts.cells[i] ?? '', tx, ty, options);
      maxY = Math.max(maxY, (doc as any).y + padY);
      (doc as any).y = startY;
      cx += cellW;
    }

    const finalH = Math.max(opts.heights, maxY - baseY);
    if (finalH > opts.heights) {
      doc.lineWidth(1).strokeColor('#e5e7eb').rect(opts.x, baseY, totalW, finalH).stroke();
    }

    // vertical separators
    let vx = opts.x;
    for (let i = 0; i < opts.widths.length - 1; i++) {
      vx += opts.widths[i];
      doc.moveTo(vx, baseY).lineTo(vx, baseY + finalH).stroke('#e5e7eb');
    }

    return finalH;
  }
}


const FTP_CONFIG = {
  host: "srv680.main-hosting.eu",  // Your FTP hostname
  user: "u948610439.hrproindia.in",       // Your FTP username
  password: "Bsrenuk@1993",   // Your FTP password
  secure: false                    // Set to true if using FTPS
}
export async function uploadToFTP(localFilePath: string, remoteFilePath: string) {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(FTP_CONFIG);
    // Ensure parent dir exists (e.g., /public_html/certificate)
    const lastSlash = remoteFilePath.lastIndexOf('/');
    const remoteDir = remoteFilePath.substring(0, lastSlash);
    if (remoteDir) await client.ensureDir(remoteDir);
    await client.uploadFrom(localFilePath, remoteFilePath);
  } finally {
    client.close();
  }
}
// export async function listResignationsWithClearances(req: AuthenticatedRequest, res: Response) {
//   try {
//     const userId = req.user?.userId;

//     if (!userId) {
//       res.status(401).json({ error: 'Unauthorized' });
//       return;
//     }

//     const user = await prisma.user.findUnique({
//       where: { id: userId },
//       include: {
//         employee: {
//           include: { role: true, Department: true }
//         }
//       }
//     });

//     if (!user) {
//       res.status(404).json({ error: 'User not found' });
//       return;
//     }

//     const emp = user.employee;
//     const isReportingManager = emp.roleId === 3;
//     const isHRManager = emp.roleId === 1;

//     // ✅ Determine which clearance type this user manages
//     const deptName = emp.Department?.name?.toUpperCase() ?? '';
//     // const allowedClearanceType =
//     //   ['HR', 'FINANCE', 'IT', 'ADMIN', 'SECURITY'].includes(deptName)
//     //     ? deptName
//     //     : null;
//     const allowedDepartmentId = emp.departmentId;


//     const whereCondition = isHRManager
//       ? {} // HR sees all
//       : { managerId: emp.id }; // Reporting managers see only their reports

//     if (!isReportingManager) {
//       // If not reporting manager → optional logic
//       // either block access or show all (if HR/Admin)
//       // return res.status(403).json({ error: 'Access denied. Only reporting managers can view clearances.' });
//     }

//     // Fetch resignations under this reporting manager
//     const resignations = await prisma.resignationRequest.findMany({
//       where: whereCondition, // 👈 show only employees reporting to this manager
//       include: {
//         employee: {
//           select: {
//             id: true,
//             firstName: true,
//             lastName: true,
//             departmentId: true,
//             employeeCode: true,
//             gender:true,
//             photoUrl: true,
//             Department: { select: { name: true } }
//           }
//         },
//         // clearances: allowedClearanceType
//         //   ? { where: { type: allowedClearanceType as ClearanceType } } // ✅ Cast it to the enum
//         //   : false,
//         clearances: allowedDepartmentId
//           ? { where: { departmentId: allowedDepartmentId } }
//           : false,

//       },
//       orderBy: { createdAt: 'desc' }
//     });

//     res.json(resignations);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Failed to load resignation clearances' });
//   }
// }
// export async function listResignationsWithClearances(req: AuthenticatedRequest, res: Response) {
//   try {
//     const userId = req.user?.userId;
//     if (!userId) return res.status(401).json({ error: "Unauthorized" });

//     const user = await prisma.user.findUnique({
//       where: { id: userId },
//       include: { employee: { include: { role: true, Department: true } } },
//     });
//     if (!user?.employee) return res.status(404).json({ error: "User not found" });

//     const emp = user.employee;
//     const isHRManager = emp.roleId === 1; // adjust to your role mapping
//     const isReportingManager = emp.roleId === 3; // adjust

//     console.log(emp, isReportingManager)

//     const whereCondition = isHRManager ? {} : isReportingManager ? { managerId: emp.id } : {};

//     console.log(whereCondition)

//     const resignations = await prisma.resignationRequest.findMany({
//       where: whereCondition,
//       orderBy: { createdAt: "desc" },
//       include: {
//         employee: {
//           select: {
//             id: true,
//             firstName: true,
//             lastName: true,
//             employeeCode: true,
//             gender: true,
//             photoUrl: true,
//             Department: { select: { name: true } },
//           }
//         },
//         // clearances: isHRManager
//         //   ? {
//         //     include: {
//         //       department: { select: { name: true } },
//         //       items: { orderBy: [{ id: "asc" }] },
//         //     }
//         //   }
//         //   : {
//         //     where: { departmentId: emp.departmentId },
//         //     include: {
//         //       department: { select: { name: true } },
//         //       items: { orderBy: [{ id: "asc" }] },
//         //     }
//         //   },
//         clearances: isHRManager
//           ? {
//             include: {
//               department: { select: { name: true } },
//               items: { orderBy: [{ id: "asc" }] },
//             }
//           }
//           : {
//             where: {
//               OR: [
//                 { departmentId: emp.departmentId }, // department clearance
//                 { type: "HOD", verifierId: emp.id } // HOD clearance
//               ]
//             },
//             include: {
//               department: { select: { name: true } },
//               items: { orderBy: [{ id: "asc" }] },
//             }
//           },

//       }
//     });

//     return res.json(resignations);
//   } catch (e) {
//     console.error(e);
//     return res.status(500).json({ error: "Failed to load resignation clearances" });
//   }
// }
export async function listResignationsWithClearances(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { employee: { include: { role: true, Department: true } } },
    });

    if (!user?.employee)
      return res.status(404).json({ error: "User not found" });

    const emp = user.employee;
    const isHRManager = emp.roleId === 1;

    const whereCondition = isHRManager
      ? {}
      : {
        clearances: {
          some: {
            departmentId: emp.departmentId,
          },
        },
      };

    const resignations = await prisma.resignationRequest.findMany({
      where: whereCondition,
      orderBy: { createdAt: "desc" },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            gender: true,
            photoUrl: true,
            Department: { select: { name: true } },
          },
        },
        clearances: {
          include: {
            department: { select: { name: true } },
            items: { orderBy: [{ id: "asc" }] },
          },
        },
      },
    });

    return res.json(resignations);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to load resignation clearances" });
  }
}


async function getHRIds(): Promise<number[]> {
  const hrs = await prisma.employee.findMany({
    where: {
      departmentId: 1,
      employmentStatus: 'ACTIVE'
    },
    select: { id: true }
  });

  return hrs.map(h => h.id);
}
export const initNoticePeriodSchedular = () => {
  cron.schedule('0 2 * * *', async () => {
    console.log('⏰ [Cron] Checking employees whose notice period has ended...');

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // 1️⃣ Find all resignation requests that are approved and whose actual LWD < today
      const dueResignations = await prisma.resignationRequest.findMany({
        where: {
          status: 'APPROVED',
          actualLastWorkingDay: { lt: today },
          employee: {
            employmentStatus: 'NOTICE_PERIOD',
          },
        },
        include: {
          employee: true,
        },
      });

      console.log(`📋 Found ${dueResignations.length} employees with ended notice period.`);

      // 2️⃣ Update each employee to 'RESIGNED' AND revoke their access
      //    (delete device tokens, mobile sessions, stamp accessRevokedAt
      //    so existing JWTs can no longer authenticate).
      for (const resignation of dueResignations) {
        await prisma.employee.update({
          where: { id: resignation.employeeId },
          data: { employmentStatus: 'RESIGNED' },
        });

        try {
          await revokeEmployeeAccess(resignation.employeeId, 'Notice period ended (cron)');
        } catch (e) {
          console.error(`[resignation cron] revoke failed for emp ${resignation.employeeId}:`, e);
        }

        console.log(`✅ Employee ID ${resignation.employeeId} marked as RESIGNED.`);

        // // Optional: also update the resignation request status → COMPLETED
        // await prisma.resignationRequest.update({
        //   where: { id: resignation.id },
        //   data: { status: 'COMPLETED' },
        // });
      }

      console.log('🎉 [Cron] Notice period check completed.');
      console.log("⏰ Running Health Check Reminder...");
      await sendHealthCheckReminders();
      console.log("🎉 Health Check Reminder Completed.");
    } catch (error) {
      console.error('❌ [Cron] Error in notice period check:', error);
    }
  });


}

// export async function setApplicableDepartments(req: Request, res: Response) {
//   const id = Number(req.params.id);
//   const { departmentIds } = req.body;

//   await prisma.$transaction(async (tx) => {
//     // remove old
//     await tx.resignationClearance.deleteMany({
//       where: { resignationId: id }
//     });

//     // create new clearance rows
//     for (const deptId of departmentIds) {
//       const dept = await tx.department.findUnique({
//         where: { id: deptId },
//         select: { name: true }
//       });

//       if (dept) {
//         await tx.resignationClearance.create({
//           data: {
//             resignationId: id,
//             departmentId: deptId,
//             type: dept.name,
//             decision: 'PENDING'
//           }
//         });
//       }
//     }
//   });

//   res.json({ success: true });
// }
async function rebuildClearanceItemsFromTemplate(tx: Prisma.TransactionClient, clearanceId: number, departmentId: number) {
  // load template items
  const templates = await tx.clearanceTemplateItem.findMany({
    where: { departmentId },
    orderBy: [{ orderNo: "asc" }, { id: "asc" }],
  });

  // create items (copy label)
  if (templates.length) {
    await tx.resignationClearanceItem.createMany({
      data: templates.map(t => ({
        clearanceId,
        templateItemId: t.id,
        label: t.label,
        status: "PENDING",
      })),
    });
  } else {
    // fallback: if no template exists, create one generic line
    await tx.resignationClearanceItem.create({
      data: {
        clearanceId,
        templateItemId: null,
        label: "Clearance checklist not configured",
        status: "PENDING",
      }
    });
  }
}

/**
 * HR sets applicable departments:
 * - Deletes existing clearances + items
 * - Creates new ResignationClearance per department
 * - Creates ResignationClearanceItem from ClearanceTemplateItem
 */
// export async function setApplicableDepartments(req: Request, res: Response) {
//   const resignationId = Number(req.params.id);
//   const { departmentIds } = req.body as { departmentIds: number[] };

//   if (!Array.isArray(departmentIds) || departmentIds.length === 0) {
//     return res.status(400).json({ error: "departmentIds is required" });
//   }

//   try {
//     await prisma.$transaction(async (tx) => {
//       // find existing clearances
//       const existing = await tx.resignationClearance.findMany({
//         where: { resignationId },
//         select: { id: true },
//       });
//       const clearanceIds = existing.map(c => c.id);

//       // delete items then clearances
//       if (clearanceIds.length) {
//         await tx.resignationClearanceItem.deleteMany({
//           where: { clearanceId: { in: clearanceIds } },
//         });
//         await tx.resignationClearance.deleteMany({
//           where: { id: { in: clearanceIds } },
//         });
//       }

//       // create new clearances + items
//       for (const deptId of departmentIds) {
//         const dept = await tx.department.findUnique({
//           where: { id: deptId },
//           select: { id: true, name: true },
//         });
//         if (!dept) continue;

//         const clearance = await tx.resignationClearance.create({
//           data: {
//             resignationId,
//             departmentId: dept.id,
//             type: dept.name,         // keep for display (optional)
//             decision: "PENDING",
//           },
//           select: { id: true },
//         });

//         await rebuildClearanceItemsFromTemplate(tx as any, clearance.id, dept.id);
//       }
//     });

//     return res.json({ success: true });
//   } catch (e) {
//     console.error("setApplicableDepartments error:", e);
//     return res.status(500).json({ error: "Failed to set applicable departments" });
//   }
// }

// export async function setApplicableDepartments(req: Request, res: Response) {
//   const resignationId = Number(req.params.id);
//   const { departmentIds } = req.body as { departmentIds: number[] };

//   if (!Array.isArray(departmentIds) || departmentIds.length === 0) {
//     return res.status(400).json({ error: "departmentIds is required" });
//   }

//   try {
//     await prisma.$transaction(async (tx) => {
//       // get existing clearances
//       const existing = await tx.resignationClearance.findMany({
//         where: { resignationId },
//         select: { id: true, departmentId: true }
//       });

//       // const existingDeptIds = existing.map(c => c.departmentId);
//       // const toAdd = departmentIds.filter(id => !existingDeptIds.includes(id));
//       // const toRemove = existing.filter(c => !departmentIds.includes(c.departmentId));
//       const existingDeptIds = existing
//         .map(c => c.departmentId)
//         .filter((id): id is number => id !== null);

//       const toAdd = departmentIds.filter(id => !existingDeptIds.includes(id));

//       const toRemove = existing.filter(
//         c => c.departmentId !== null && !departmentIds.includes(c.departmentId)
//       );


//       // 1) Remove deselected departments
//       for (const c of toRemove) {
//         await tx.resignationClearanceItem.deleteMany({
//           where: { clearanceId: c.id }
//         });

//         await tx.resignationClearance.delete({
//           where: { id: c.id }
//         });
//       }

//       // 2) Add new departments
//       for (const deptId of toAdd) {
//         const dept = await tx.department.findUnique({
//           where: { id: deptId },
//           select: { id: true, name: true }
//         });

//         if (!dept || typeof dept.name !== "string") {
//           console.warn(`Invalid department data for id ${deptId}`);
//           continue;
//         }


//         const clearance = await tx.resignationClearance.create({
//           data: {
//             resignationId,
//             departmentId: dept.id,
//             type: dept.name,
//             decision: "PENDING"
//           },
//           select: { id: true }
//         });

//         await rebuildClearanceItemsFromTemplate(tx as any, clearance.id, dept.id);
//       }
//     });

//     return res.json({ success: true });
//   } catch (e) {
//     console.error("setApplicableDepartments error:", e);
//     return res.status(500).json({ error: "Failed to set applicable departments" });
//   }
// }


export async function setApplicableDepartments(req: Request, res: Response) {
  const resignationId = Number(req.params.id);
  const { departmentIds } = req.body as { departmentIds: number[] };

  if (!Array.isArray(departmentIds)) {
    return res.status(400).json({ error: "departmentIds must be array" });
  }

  try {
    // ✅ Create/ensure clearances + items for these departments
    await initOffboardingClearances(resignationId, departmentIds);

    return res.json({ success: true });
  } catch (e) {
    console.error("setApplicableDepartments error:", e);
    return res.status(500).json({ error: "Failed to set applicable departments" });
  }
}


/**
 * Bulk update items for one department clearance:
 * PATCH /resignations/:id/clearances/:clearanceId/items
 * body: { items: [{ id, status, note? }] }
 *
 * - verifies items belong to clearance
 * - updates items
 * - re-computes ResignationClearance.decision
 */
// export async function bulkUpdateClearanceItems(req: AuthenticatedRequest, res: Response) {
//   try {
//     const resignationId = Number(req.params.id);
//     const clearanceId = Number(req.params.clearanceId);
//     const { items } = req.body as { items: Array<{ id: number; status: ClearanceItemStatus; note?: string }> };

//     const userId = req.user?.userId;
//     if (!userId) {
//       res.status(401).json({ error: "Unauthorized" });
//       return;
//     }

//     if (!Array.isArray(items) || items.length === 0) {
//       res.status(400).json({ error: "items is required" });
//       return;
//     }

//     const user = await prisma.user.findUnique({
//       where: { id: userId },
//       include: { employee: true },
//     });
//     if (!user?.employee) {
//       res.status(404).json({ error: "User not found" });
//       return;
//     }

//     // load clearance (and verify resignation)
//     const clearance = await prisma.resignationClearance.findFirst({
//       where: { id: clearanceId, resignationId },
//       select: { id: true, departmentId: true },
//     });
//     if (!clearance) {
//       res.status(404).json({ error: "Clearance not found" });
//       return;
//     }

//     // Security: only allow department owner (or HR) to update
//     const isHR = user.employee.roleId === 1; // adjust
//     const isSameDept = clearance.departmentId && user.employee.departmentId === clearance.departmentId;
//     if (!isHR && !isSameDept) {
//       res.status(403).json({ error: "Forbidden" });
//       return;
//     }

//     await prisma.$transaction(async (tx) => {
//       // update each item (only if belongs to clearance)
//       for (const it of items) {
//         await tx.resignationClearanceItem.updateMany({
//           where: { id: it.id, clearanceId: clearance.id },
//           data: {
//             status: it.status,
//             note: it.note ?? undefined,
//             verifierId: user.employee.id,
//             decidedAt: new Date(),
//           }
//         });
//       }

//       // reload items and compute clearance decision
//       const allItems = await tx.resignationClearanceItem.findMany({
//         where: { clearanceId: clearance.id },
//         select: { status: true },
//       });

//       const decision = computeClearanceDecision(allItems as any);

//       await tx.resignationClearance.update({
//         where: { id: clearance.id },
//         data: {
//           decision,
//           verifierId: user.employee.id,
//           decidedAt: decision === "PENDING" ? null : new Date(),
//         }
//       });
//     });

//     res.json({ success: true });
//     return;
//   } catch (e) {
//     console.error("bulkUpdateClearanceItems error:", e);
//     res.status(500).json({ error: "Failed to update clearance items" });
//     return;
//   }
// }

// async function initOffboardingClearances(resignationId: number, selectedDeptIds: number[]) {
//   await prisma.$transaction(async (tx) => {
//     const resign = await tx.resignationRequest.findUnique({
//       where: { id: resignationId },
//       include: { employee: { select: { departmentId: true, reportingManager: true } } }
//     });
//     if (!resign?.employee) throw new Error("Resignation/Employee not found");

//     const empDeptId = resign.employee.departmentId;
//     const hodVerifierId = resign.employee.reportingManager;

//     // 1) HOD clearance (type = "HOD", departmentId = employee.departmentId, verifier = reportingManager)
//     if (empDeptId && hodVerifierId) {
//       const existingHod = await tx.resignationClearance.findFirst({
//         where: { resignationId, type: "HOD" }
//       });

//       const hod = existingHod
//         ? existingHod
//         : await tx.resignationClearance.create({
//           data: {
//             resignationId,
//             type: "HOD",
//             departmentId: empDeptId,
//             verifierId: hodVerifierId,
//             decision: "PENDING",
//           }
//         });

//       // ensure items exist (create only if none)
//       const hodItemsCount = await tx.resignationClearanceItem.count({ where: { clearanceId: hod.id } });
//       if (hodItemsCount === 0) {
//         await rebuildClearanceItemsFromTemplate(tx, hod.id, empDeptId);
//       }
//     }

//     // 2) Department clearances for selected depts
//     for (const deptId of selectedDeptIds) {
//       const dept = await tx.department.findUnique({
//         where: { id: deptId },
//         select: { id: true, name: true }
//       });
//       if (!dept) continue;

//       const existing = await tx.resignationClearance.findFirst({
//         where: { resignationId, departmentId: dept.id }
//       });

//       const cl = existing
//         ? existing
//         : await tx.resignationClearance.create({
//           data: {
//             resignationId,
//             departmentId: dept.id,
//             type: dept.name, // for display
//             decision: "PENDING",
//           },
//         });

//       const count = await tx.resignationClearanceItem.count({ where: { clearanceId: cl.id } });
//       if (count === 0) {
//         await rebuildClearanceItemsFromTemplate(tx, cl.id, dept.id);
//       }
//     }
//   });
// }
// export async function bulkUpdateClearanceItems(req: AuthenticatedRequest, res: Response) {
//   try {
//     const resignationId = Number(req.params.id);
//     const { items } = req.body as {
//       items: Array<{ id: number; status: ClearanceItemStatus; note?: string }>;
//     };

//     const userId = req.user?.userId;
//     if (!userId) {
//       res.status(401).json({ error: "Unauthorized" });
//       return;
//     }

//     if (!Array.isArray(items) || items.length === 0) {
//       res.status(400).json({ error: "items is required" });
//       return;
//     }

//     const user = await prisma.user.findUnique({
//       where: { id: userId },
//       include: { employee: true },
//     });
//     if (!user?.employee) {
//       res.status(404).json({ error: "User not found" });
//       return;
//     }

//     // await prisma.$transaction(async (tx) => {
//     //   // 1. Update all items
//     //   for (const it of items) {
//     //     await tx.resignationClearanceItem.update({
//     //       where: { id: it.id },
//     //       data: {
//     //         status: it.status,
//     //         note: it.note ?? undefined,
//     //         verifierId: user.employee.id,
//     //         decidedAt: new Date(),
//     //       }
//     //     });
//     //   }

//     //   // 2. Get all affected clearances
//     //   const affectedClearances = await tx.resignationClearanceItem.findMany({
//     //     where: {
//     //       id: { in: items.map(i => i.id) }
//     //     },
//     //     select: { clearanceId: true },
//     //     distinct: ['clearanceId']
//     //   });

//     //   // 3. Recompute decision for each clearance
//     //   for (const cl of affectedClearances) {
//     //     const allItems = await tx.resignationClearanceItem.findMany({
//     //       where: { clearanceId: cl.clearanceId },
//     //       select: { status: true },
//     //     });

//     //     const decision = computeClearanceDecision(allItems as any);

//     //     await tx.resignationClearance.update({
//     //       where: { id: cl.clearanceId },
//     //       data: {
//     //         decision,
//     //         verifierId: user.employee.id,
//     //         decidedAt: decision === "PENDING" ? null : new Date(),
//     //       }
//     //     });
//     //   }
//     // });
//     await prisma.$transaction(async (tx) => {
//       const now = new Date();

//       // 1. Update all items in parallel
//       await Promise.all(
//         items.map((it) =>
//           tx.resignationClearanceItem.update({
//             where: { id: it.id },
//             data: {
//               status: it.status,
//               note: it.note ?? undefined,
//               verifierId: user.employee.id,
//               decidedAt: now,
//             },
//           })
//         )
//       );

//       // 2. Get affected clearanceIds in one query
//       const affected = await tx.resignationClearanceItem.findMany({
//         where: { id: { in: items.map((i) => i.id) } },
//         select: { clearanceId: true },
//         distinct: ["clearanceId"],
//       });

//       const clearanceIds = affected.map((a) => a.clearanceId);

//       // 3. Load all items for those clearances at once
//       const allItems = await tx.resignationClearanceItem.findMany({
//         where: { clearanceId: { in: clearanceIds } },
//         select: { clearanceId: true, status: true },
//       });

//       // 4. Group items by clearanceId
//       const grouped: Record<number, { status: string }[]> = {};
//       for (const it of allItems) {
//         if (!grouped[it.clearanceId]) grouped[it.clearanceId] = [];
//         grouped[it.clearanceId].push(it);
//       }

//       // 5. Update each clearance decision
//       await Promise.all(
//         clearanceIds.map((id) => {
//           const decision = computeClearanceDecision(grouped[id] as any);

//           return tx.resignationClearance.update({
//             where: { id },
//             data: {
//               decision,
//               verifierId: user.employee.id,
//               decidedAt: decision === "PENDING" ? null : now,
//             },
//           });
//         })
//       );
//     });

//     res.json({ success: true });
//     return;
//   } catch (e) {
//     console.error("bulkUpdateClearanceItems error:", e);
//     res.status(500).json({ error: "Failed to update clearance items" });
//     return;
//   }
// }
export async function bulkUpdateClearanceItems(req: AuthenticatedRequest, res: Response) {
  try {
    const resignationId = Number(req.params.id);
    const { items } = req.body as {
      items: Array<{ id: number; status: ClearanceItemStatus; note?: string }>;
    };

    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "items is required" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { employee: true },
    });
    if (!user?.employee) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const now = new Date();

    // 1. Update all items using batch transaction
    await prisma.$transaction(
      items.map((it) =>
        prisma.resignationClearanceItem.update({
          where: { id: it.id },
          data: {
            status: it.status,
            note: it.note ?? undefined,
            verifierId: user.employee.id,
            decidedAt: now,
          },
        })
      )
    );

    // 2. Get affected clearances
    const affected = await prisma.resignationClearanceItem.findMany({
      where: { id: { in: items.map((i) => i.id) } },
      select: { clearanceId: true },
      distinct: ["clearanceId"],
    });

    const clearanceIds = affected.map((a) => a.clearanceId);

    // 3. Recompute decisions
    for (const clearanceId of clearanceIds) {
      const allItems = await prisma.resignationClearanceItem.findMany({
        where: { clearanceId },
        select: { status: true },
      });

      const decision = computeClearanceDecision(allItems as any);

      await prisma.resignationClearance.update({
        where: { id: clearanceId },
        data: {
          decision,
          verifierId: user.employee.id,
          decidedAt: decision === "PENDING" ? null : now,
        },
      });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("bulkUpdateClearanceItems error:", e);
    res.status(500).json({ error: "Failed to update clearance items" });
  }
}

async function initOffboardingClearances(
  resignationId: number,
  selectedDeptIds: number[]
) {
  // Load outside transaction
  const resign = await prisma.resignationRequest.findUnique({
    where: { id: resignationId },
    include: { employee: { select: { departmentId: true, reportingManager: true } } }
  });
  if (!resign?.employee) throw new Error("Resignation/Employee not found");

  const empDeptId = resign.employee.departmentId;
  const hodVerifierId = resign.employee.reportingManager;

  await prisma.$transaction(
    async (tx) => {

      // HOD clearance
      // if (empDeptId && hodVerifierId) {
      //   const existingHod = await tx.resignationClearance.findFirst({
      //     where: { resignationId, type: "HOD" }
      //   });

      //   const hod = existingHod
      //     ? existingHod
      //     : await tx.resignationClearance.create({
      //       data: {
      //         resignationId,
      //         type: "HOD",
      //         departmentId: empDeptId,
      //         verifierId: hodVerifierId,
      //         decision: "PENDING",
      //       }
      //     });

      //   const count = await tx.resignationClearanceItem.count({
      //     where: { clearanceId: hod.id }
      //   });

      //   if (count === 0) {
      //     await rebuildClearanceItemsFromTemplate(tx, hod.id, empDeptId);
      //   }
      // }
      // HOD clearance
      if (empDeptId && hodVerifierId) {
        const existingHod = await tx.resignationClearance.findFirst({
          where: { resignationId, type: "HOD" }
        });

        const hod = existingHod
          ? existingHod
          : await tx.resignationClearance.create({
            data: {
              resignationId,
              type: "HOD",
              departmentId: empDeptId,
              verifierId: hodVerifierId,
              decision: "PENDING",
            }
          });

        const count = await tx.resignationClearanceItem.count({
          where: { clearanceId: hod.id }
        });

        if (count === 0) {
          await tx.resignationClearanceItem.createMany({
            data: [
              {
                clearanceId: hod.id,
                templateItemId: null,
                label: "Handing over files / correspondence / documents / keys",
                status: "PENDING",
              },
              {
                clearanceId: hod.id,
                templateItemId: null,
                label: "Loss of items / breakage / others",
                status: "PENDING",
              }
            ]
          });
        }
      }


      // Department clearances
      // for (const deptId of selectedDeptIds) {
      //   const existing = await tx.resignationClearance.findFirst({
      //     where: { resignationId, departmentId: deptId }
      //   });

      //   const cl = existing
      //     ? existing
      //     : await tx.resignationClearance.create({
      //         data: {
      //           resignationId,
      //           departmentId: deptId,
      //           type: "DEPARTMENT",
      //           decision: "PENDING",
      //         }
      //       });

      //   const count = await tx.resignationClearanceItem.count({
      //     where: { clearanceId: cl.id }
      //   });

      //   if (count === 0) {
      //     await rebuildClearanceItemsFromTemplate(tx, cl.id, deptId);
      //   }
      // }
      for (const deptId of selectedDeptIds) {
        const dept = await tx.department.findUnique({
          where: { id: deptId },
          select: { id: true, name: true }
        });
        if (!dept) continue;

        const typeKey = `DEPT_${dept.name}`;

        const existing = await tx.resignationClearance.findFirst({
          where: { resignationId, type: typeKey }
        });

        const cl = existing
          ? existing
          : await tx.resignationClearance.create({
            data: {
              resignationId,
              departmentId: dept.id,
              type: typeKey,
              decision: "PENDING",
            },
          });

        const count = await tx.resignationClearanceItem.count({
          where: { clearanceId: cl.id }
        });

        if (count === 0) {
          await rebuildClearanceItemsFromTemplate(tx, cl.id, dept.id);
        }
      }

    },
    { timeout: 20000 } // increase timeout
  );
}
