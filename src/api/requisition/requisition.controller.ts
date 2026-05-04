import { Request, Response } from "express";
// import { PrismaClient } from "@prisma/client";

// const prisma = new PrismaClient();
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.controller";

export const createRequisition = async (req: Request, res: Response) => {
  try {
    console.log("Request Body:", req.body); // Debugging line
    const {
      title,
      departmentId,
      location,
      createdBy,
      designation,
      reasonBreakdown,
      skills,
      education,
      training,
      eduSSC,
      eduDiploma,
      eduBachelor,
      eduMaster,
      eduOther,
      eduOtherDetail,
      urgent,
      duration,
      reportingTo,
      reasonType, // ✅ add this
      reasonDetails,

      eduBachelorDetail,
      eduMasterDetail,
      eduDiplomaDetail,
      eduSSCDetail,


      // Approvals
      raisedBy, raisedBySign, raisedByDate, raisedByComments,
      approvedByHoD, hodSign, approvedByHoDDate, approvedByHoDComments,
      approvedBySMO, smoSign, approvedBySMODate, approvedBySMOComments,
      receivedByHR, hrSign, receivedByHRDate, receivedByHRComments,

      hrReferenceNo,
      salaryRange,
      source,
      actionTaken,
      closedOn
    } = req.body;

    // ── Look up the raiser's role BEFORE creating ───────────────
    // The raiser's seniority decides:
    //   1. Initial status (RAISED / HOD_APPROVED / COO_APPROVED)
    //   2. Which approval fields to auto-fill (so the workflow doesn't
    //      get stuck waiting on a self-approval that nobody will do)
    //   3. Who the next-level notification goes to (block below)
    const raiserId = Number(createdBy ?? raisedBy);
    const raiser = Number.isFinite(raiserId)
      ? await prisma.employee.findUnique({
          where: { id: raiserId },
          select: { id: true, roleId: true, firstName: true, lastName: true },
        })
      : null;
    const raiserRoleId = raiser?.roleId ?? null;
    const now = new Date();

    // Auto-approval block — only populated when the raiser is HOD (3) or
    // Management (4), in which case the steps they OUTRANK are pre-stamped
    // as approved by them. Fields not in this object fall back to whatever
    // the request body sent (so HR / a frontend that already pre-fills them
    // still wins).
    let initialStatus: string = 'RAISED';
    const autoApproval: Record<string, any> = {};

    // Display name derived from the looked-up Employee row — never trust the
    // request body's `raisedBy` field alone, since it can be missing or empty
    // string. Empty string isn't caught by `??` (only null/undefined are), so
    // we use a `firstNonEmpty` helper to skip blank values too.
    const raiserDisplayName = raiser ? `${raiser.firstName} ${raiser.lastName}`.trim() : null;
    const firstNonEmpty = (...vals: (string | null | undefined)[]): string | null => {
      for (const v of vals) {
        if (v !== null && v !== undefined && String(v).trim() !== '') return String(v);
      }
      return null;
    };
    const autoNote = `Auto-approved on creation (raised by ${raiserDisplayName ?? 'sender'} at this level)`;

    if (raiserRoleId === 3) {
      // HOD raising → skip the HOD step.
      initialStatus = 'HOD_APPROVED';
      autoApproval.approvedByHoD        = firstNonEmpty(approvedByHoD, raiserDisplayName, raisedBy);
      autoApproval.hodSign              = firstNonEmpty(hodSign, raisedBySign);
      autoApproval.approvedByHoDDate    = approvedByHoDDate    ? new Date(approvedByHoDDate) : now;
      autoApproval.approvedByHoDComments = firstNonEmpty(approvedByHoDComments, autoNote);
      autoApproval.approvedByHoDEmpId   = raiser?.id ?? null;
    } else if (raiserRoleId === 4) {
      // Management raising → skip both HOD AND COO steps.
      initialStatus = 'COO_APPROVED';
      autoApproval.approvedByHoD        = firstNonEmpty(approvedByHoD, raiserDisplayName, raisedBy);
      autoApproval.hodSign              = firstNonEmpty(hodSign, raisedBySign);
      autoApproval.approvedByHoDDate    = approvedByHoDDate    ? new Date(approvedByHoDDate) : now;
      autoApproval.approvedByHoDComments = firstNonEmpty(approvedByHoDComments, autoNote);
      autoApproval.approvedByHoDEmpId   = raiser?.id ?? null;
      autoApproval.approvedBySMO        = firstNonEmpty(approvedBySMO, raiserDisplayName, raisedBy);
      autoApproval.smoSign              = firstNonEmpty(smoSign, raisedBySign);
      autoApproval.approvedBySMODate    = approvedBySMODate    ? new Date(approvedBySMODate) : now;
      autoApproval.approvedBySMOComments = firstNonEmpty(approvedBySMOComments, autoNote);
      autoApproval.approvedBySMOEmpId   = raiser?.id ?? null;
    }

    // Step 2: Create Requisition
    const requisition = await prisma.manpowerRequisition.create({
      data: {
        requestDate: new Date(),
        designation,
        departmentId,
        reasonBreakdown,
        reasonType, // ✅ add this
        reasonDetails,
        skills,
        education,
        training,
        eduSSC,
        eduDiploma,
        eduBachelor,
        eduMaster,
        eduOther,
        eduOtherDetail,
        urgent,
        duration,
        reportingTo,
        title,
        eduBachelorDetail,
        eduMasterDetail,
        eduDiplomaDetail,
        eduSSCDetail,

        raisedBy, raisedBySign, raisedByDate: raisedByDate ? new Date(raisedByDate) : null, raisedByComments,
        // Strong FK to the raising employee — see schema comment.
        raisedByEmployeeId:    raiser?.id ?? null,
        // HOD/COO/HR fields — sent values win, otherwise auto-filled when
        // the raiser is senior enough to skip those steps.
        approvedByHoD:         autoApproval.approvedByHoD         ?? approvedByHoD,
        hodSign:               autoApproval.hodSign               ?? hodSign,
        approvedByHoDDate:     autoApproval.approvedByHoDDate     ?? (approvedByHoDDate ? new Date(approvedByHoDDate) : null),
        approvedByHoDComments: autoApproval.approvedByHoDComments ?? approvedByHoDComments,
        approvedByHoDEmpId:    autoApproval.approvedByHoDEmpId    ?? null,
        approvedBySMO:         autoApproval.approvedBySMO         ?? approvedBySMO,
        smoSign:               autoApproval.smoSign               ?? smoSign,
        approvedBySMODate:     autoApproval.approvedBySMODate     ?? (approvedBySMODate ? new Date(approvedBySMODate) : null),
        approvedBySMOComments: autoApproval.approvedBySMOComments ?? approvedBySMOComments,
        approvedBySMOEmpId:    autoApproval.approvedBySMOEmpId    ?? null,
        receivedByHR, hrSign, receivedByHRDate: receivedByHRDate ? new Date(receivedByHRDate) : null, receivedByHRComments,

        hrReferenceNo,
        salaryRange,
        source,
        actionTaken,
        closedOn: closedOn ? new Date(closedOn) : null,

        // Initial status reflects the auto-approvals above
        status: initialStatus,
      },
      include: { job: true },
    });
    console.log(
      `[manpower] requisition #${requisition.id} created by role=${raiserRoleId ?? '?'} → status=${initialStatus}`,
    );
    // ── Notify the NEXT approver ─────────────────────────────────
    // Approval ladder (low → high):
    //   Incharge (role 5) → HOD (role 3) → Management/COO (role 4) → HR (role 1)
    // Reuse the `raiser` lookup performed above. Decision matrix matches
    // the auto-approval block — whichever steps were pre-stamped, the
    // notification jumps to the FIRST step that still needs human action.
    try {
      const reqLabel = title || designation || 'a position';
      const raiserName = raiser ? `${raiser.firstName} ${raiser.lastName}`.trim() : 'an employee';

      let nextLevelEmployees: { id: number }[] = [];

      if (raiserRoleId === 3) {
        // HOD raised → HOD step auto-approved → next is Management.
        nextLevelEmployees = await prisma.employee.findMany({
          where: { roleId: 4, employmentStatus: 'ACTIVE' },
          select: { id: true },
        });
      } else if (raiserRoleId === 4) {
        // Management raised → HOD + COO auto-approved → next is HR.
        nextLevelEmployees = await prisma.employee.findMany({
          where: { roleId: 1, employmentStatus: 'ACTIVE' },
          select: { id: true },
        });
      } else {
        // Default — Incharge or any other role: ping the department's HOD.
        const deptHod = await prisma.employee.findFirst({
          where: {
            departmentId: departmentId,
            roleId: 3,
            employmentStatus: 'ACTIVE',
          },
          select: { id: true },
        });
        if (deptHod) nextLevelEmployees = [deptHod];
      }

      // De-dup — never notify the raiser themselves.
      const targets = nextLevelEmployees.filter((e) => e.id !== raiser?.id);
      const message = `New manpower requisition raised by ${raiserName} for ${reqLabel}. Kindly review and take appropriate action.`;
      for (const t of targets) {
        await createNotification(t.id, message);
      }

      console.log(
        `[manpower] requisition #${requisition.id} → notified ${targets.length} next-level approver(s)`,
      );
    } catch (notifyErr) {
      // Notification failures must NEVER block requisition creation.
      console.error('[manpower] notification on create failed:', notifyErr);
    }

    return res.status(201).json(requisition);
  } catch (error) {
    console.error("Error creating requisition:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
function buildJobTitle(item: any, fallbackTitle?: string) {
  const designation = item.designation || fallbackTitle || "Untitled";

  let expPart = "";

  // 🔹 Fresher case
  if (item.minExperience === 0 && item.maxExperience === 0) {
    expPart = " (Fresher)";
  }
  // 🔹 Range case
  else if (item.minExperience && item.maxExperience) {
    expPart = ` (${item.minExperience}-${item.maxExperience} yrs)`;
  }
  // 🔹 Only minimum provided
  else if (item.minExperience) {
    expPart = ` (${item.minExperience}+ yrs)`;
  }

  const typeMap: Record<string, string> = {
    NEW_OPENING: "New Opening",
    REPLACEMENT: "Replacement",
    PLANNED_ADDITION: "Planned Addition"
  };

  const typeLabel = typeMap[item.type] || item.type || "";

  return `${designation}${expPart}${typeLabel ? " – " + typeLabel : ""}`;
}

export const updateRequisitionStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      step, approverName, signature, comments, reject,
      createdBy, location, title,
      // approverEmpId is the employee ID of whoever clicked the approve button.
      // Frontend should send `auth.user.id` here. Optional for backward compat
      // (legacy clients that don't send it just skip the FK stamp).
      approverEmpId,
    } = req.body;

    const approverIdNum = Number(approverEmpId);
    const approverEmpIdSafe = Number.isFinite(approverIdNum) && approverIdNum > 0 ? approverIdNum : null;

    const now = new Date();
    let updateData: any = {};

    switch (step) {
      case "RAISED":
        updateData = {
          raisedBy: approverName,
          raisedBySign: signature,
          raisedByDate: now,
          raisedByComments: comments,
          status: "RAISED",
          ...(approverEmpIdSafe ? { raisedByEmployeeId: approverEmpIdSafe } : {}),
        };
        break;

      case "HOD":
        updateData = reject
          ? {
            hodRejectedBy: approverName,
            hodRejectedDate: now,
            hodRejectedComments: comments,
            status: "REJECTED",
          }
          : {
            approvedByHoD: approverName,
            hodSign: signature,
            approvedByHoDDate: now,
            approvedByHoDComments: comments,
            status: "HOD_APPROVED",
            ...(approverEmpIdSafe ? { approvedByHoDEmpId: approverEmpIdSafe } : {}),
          };
        break;

      case "COO":
        updateData = reject
          ? {
            smoRejectedBy: approverName,
            smoRejectedDate: now,
            smoRejectedComments: comments,
            status: "REJECTED",
          }
          : {
            approvedBySMO: approverName,
            smoSign: signature,
            approvedBySMODate: now,
            approvedBySMOComments: comments,
            status: "COO_APPROVED",
            ...(approverEmpIdSafe ? { approvedBySMOEmpId: approverEmpIdSafe } : {}),
          };
        break;

      // case "HR":
      //   if (reject) {
      //     updateData = {
      //       hrRejectedBy: approverName,
      //       hrRejectedDate: now,
      //       hrRejectedComments: comments,
      //       status: "REJECTED",
      //     };
      //   } else {
      //     const requisition = await prisma.manpowerRequisition.findUnique({ where: { id: Number(id) } });
      //     if (!requisition) return res.status(404).json({ message: "Requisition not found" });

      //     await prisma.job.create({
      //       data: {
      //         title: title || requisition.title || "Untitled",
      //         departmentId: requisition.departmentId ?? 0, // coerce null to undefined
      //         location,
      //         headcount: requisition.vacancies || 0,
      //         createdBy: 1,
      //       },
      //     });




      //     updateData = {
      //       receivedByHR: approverName,
      //       hrSign: signature,
      //       receivedByHRDate: now,
      //       receivedByHRComments: comments,
      //       status: "HR_RECEIVED",
      //     };
      //   }
      //   break;
      case "HR":
        if (reject) {
          updateData = {
            hrRejectedBy: approverName,
            hrRejectedDate: now,
            hrRejectedComments: comments,
            status: "REJECTED",
          };
        } else {
          const requisition = await prisma.manpowerRequisition.findUnique({
            where: { id: Number(id) },
          });

          if (!requisition) {
            return res.status(404).json({ message: "Requisition not found" });
          }

          // ✅ Parse reasonBreakdown JSON safely
          let breakdown: any[] = [];
          try {
            breakdown = requisition.reasonBreakdown
              ? typeof requisition.reasonBreakdown === "string"
                ? JSON.parse(requisition.reasonBreakdown)
                : requisition.reasonBreakdown
              : [];
          } catch (err) {
            console.error("Invalid reasonBreakdown JSON:", err);
            breakdown = [];
          }

          // ✅ If no breakdown, still create one job (fallback to old logic)
          if (!breakdown.length) {
            await prisma.job.create({
              data: {
                title: title || requisition.title || "Untitled",
                departmentId: requisition.departmentId ?? 0,
                location,
                headcount: requisition.vacancies || 1,
                createdBy: createdBy || 1,
              },
            });
          } else {
            // ✅ Create multiple jobs from breakdown
            for (const item of breakdown) {
              const jobTitle = buildJobTitle(item, requisition.title ?? undefined);
              await prisma.job.create({
                data: {
                  title: jobTitle,
                  departmentId: requisition.departmentId ?? 0,
                  location: location || "Not Specified",
                  headcount: item.count || 1,
                  createdBy: createdBy || 1,
                  backfillForEmployeeId: null, // optional if you have that field
                },
              });
            }
          }

          // ✅ Update requisition status
          updateData = {
            receivedByHR: approverName,
            hrSign: signature,
            receivedByHRDate: now,
            receivedByHRComments: comments,
            status: "HR_RECEIVED",
            ...(approverEmpIdSafe ? { receivedByHREmpId: approverEmpIdSafe } : {}),
          };
        }
        break;

      case "HR_USE_ONLY": // 👈 new step for final closure
        updateData = {
          hrReferenceNo: req.body.hrReferenceNo,
          salaryRange: req.body.salaryRange,
          source: req.body.source,
          actionTaken: req.body.actionTaken,
          closedOn: req.body.closedOn ? new Date(req.body.closedOn) : now, // 👈 Closed On set here
        };
        break;

      default:
        return res.status(400).json({ message: "Invalid approval step" });
    }

    const updated = await prisma.manpowerRequisition.update({
      where: { id: Number(id) },
      data: updateData,
    });

    // ----------------- NOTIFICATIONS -----------------
    try {
      // fetch requisition creator if not passed
      const requisition = await prisma.manpowerRequisition.findUnique({
        where: { id: Number(id) },
        select: {
          departmentId: true,
          raisedBy: true
        }
      });

      // HOD approved → notify COO
      if (step === "HOD" && !reject) {
        const coo = await prisma.employee.findFirst({
          where: { role: { id: 4 } },
          select: { id: true }
        });
        if (coo) {
          await createNotification(coo.id, "A manpower requisition has been approved by HOD and needs your approval.");
        }
      }

      // COO approved → notify HR
      if (step === "COO" && !reject) {
        const hrs = await prisma.employee.findMany({
          where: { role: { id: 1 } },
          select: { id: true }
        });
        for (const hr of hrs) {
          await createNotification(hr.id, "A manpower requisition has been approved by COO and is ready for HR processing.");
        }
      }

      // Rejected at any step → notify creator
      if (reject && createdBy) {
        await createNotification(Number(createdBy), "Your manpower requisition has been rejected.");
      }

      // HR processed → notify creator
      if (step === "HR" && !reject && createdBy) {
        await createNotification(Number(createdBy), "Your manpower requisition has been processed by HR and a job opening has been created.");
      }

    } catch (notifyErr) {
      console.error("Notification error:", notifyErr);
    }

    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating requisition:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const listRequisitions = async (req: Request, res: Response) => {
  try {
       const roleId = Number(req.query.roleId);
    const empId = Number(req.query.empId);

    let whereCondition: any = {};

    // Role 5 → Incharge → only their own requisitions
    // Filter on the strong FK column. Old rows that haven't been backfilled
    // yet fall back to a name match — the backfill script (prisma/
    // backfillRequisitionRaisers.ts) populates the FK retroactively.
    if (roleId === 5) {
      const me = await prisma.employee.findUnique({
        where: { id: empId },
        select: { firstName: true, lastName: true },
      });
      const myName = me ? `${me.firstName} ${me.lastName}`.trim() : '';
      whereCondition = {
        OR: [
          { raisedByEmployeeId: empId },
          // Fallback for legacy rows where raisedByEmployeeId is still null.
          ...(myName ? [{ AND: [{ raisedByEmployeeId: null }, { raisedBy: myName }] }] : []),
        ],
      };
    }

    // Role 3 → HOD / Reporting Manager → department requisitions
    if (roleId === 3) {
      const manager = await prisma.employee.findUnique({
        where: { id: empId },
        select: { departmentId: true }
      });

      if (manager?.departmentId) {
        whereCondition = {
          departmentId: manager.departmentId
        };
      }
    }

    // HR / Management → no filter (see all)
    if (roleId === 1 || roleId === 4) {
      whereCondition = {};
    }
    // const requisitions = await prisma.manpowerRequisition.findMany({
    //   where: whereCondition,
    //   include: { job: true },
    //   orderBy: { requestDate: "desc" }
    // });
    const requisitions = await prisma.manpowerRequisition.findMany({
      where: whereCondition,
      include: { job: true },
      orderBy: { requestDate: 'desc' }
    });

    // get all unique departmentIds
    const deptIds = [...new Set(
      requisitions
        .map(r => r.departmentId)
        .filter((id): id is number => id !== null)  // type guard: only numbers
    )];


    // fetch departments
    const departments = await prisma.department.findMany({
      where: { id: { in: deptIds } },
      select: { id: true, name: true },
    });

    // map deptId → deptName
    const deptMap = Object.fromEntries(departments.map(d => [d.id, d.name]));

    // attach dept name to requisitions
    const withDept = requisitions.map(r => ({
      ...r,
      departmentName: deptMap[r.departmentId!] || null,
    }));

    return res.status(200).json(withDept);
  } catch (error) {
    console.error("Error fetching requisitions:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
