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
        approvedByHoD, hodSign, approvedByHoDDate: approvedByHoDDate ? new Date(approvedByHoDDate) : null, approvedByHoDComments,
        approvedBySMO, smoSign, approvedBySMODate: approvedBySMODate ? new Date(approvedBySMODate) : null, approvedBySMOComments,
        receivedByHR, hrSign, receivedByHRDate: receivedByHRDate ? new Date(receivedByHRDate) : null, receivedByHRComments,

        hrReferenceNo,
        salaryRange,
        source,
        actionTaken,
        closedOn: closedOn ? new Date(closedOn) : null,

        // start status as "PENDING"
        status: "RAISED"
      },
      include: { job: true },
    });
    const deptManager = await prisma.employee.findFirst({
      where: {
        departmentId: departmentId,
        role: { id: 3 } // adjust role name if needed
      },
      select: { id: true }
    });

    if (deptManager?.id && deptManager.id !== raisedBy) {
      await createNotification(deptManager.id, `New manpower requisition created for ${title || designation || 'a position'}. Kindly review and take appropriate action.`);
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
    const { step, approverName, signature, comments, reject, departmentId, createdBy, location, title } = req.body;

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
    if (roleId === 5) {
      whereCondition = {
        raisedBy: String(empId) // assuming raisedBy stores employee id as string
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
