import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

    return res.status(201).json(requisition);
  } catch (error) {
    console.error("Error creating requisition:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
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

      case "SMO":
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
            status: "SMO_APPROVED",
          };
        break;

      case "HR":
        if (reject) {
          updateData = {
            hrRejectedBy: approverName,
            hrRejectedDate: now,
            hrRejectedComments: comments,
            status: "REJECTED",
          };
        } else {
          const requisition = await prisma.manpowerRequisition.findUnique({ where: { id: Number(id) } });
          if (!requisition) return res.status(404).json({ message: "Requisition not found" });

          await prisma.job.create({
            data: {
              title: title || requisition.title || "Untitled",
              departmentId: requisition.departmentId ?? 0, // coerce null to undefined
              location,
              headcount: requisition.vacancies || 0,
              createdBy: 1,
            },
          });
          
          
          

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

    return res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating requisition:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const listRequisitions = async (req: Request, res: Response) => {
  try {
    const requisitions = await prisma.manpowerRequisition.findMany({ include: { job: true }, });
    return res.status(200).json(requisitions);
  } catch (error) {
    console.error("Error fetching requisitions:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};