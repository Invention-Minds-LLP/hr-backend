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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listRequisitions = exports.updateRequisitionStatus = exports.createRequisition = void 0;
// import { PrismaClient } from "@prisma/client";
// const prisma = new PrismaClient();
const prisma_1 = require("../../lib/prisma");
const createRequisition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("Request Body:", req.body); // Debugging line
        const { title, departmentId, location, createdBy, designation, reasonBreakdown, skills, education, training, eduSSC, eduDiploma, eduBachelor, eduMaster, eduOther, eduOtherDetail, urgent, duration, reportingTo, reasonType, // ✅ add this
        reasonDetails, eduBachelorDetail, eduMasterDetail, eduDiplomaDetail, eduSSCDetail, 
        // Approvals
        raisedBy, raisedBySign, raisedByDate, raisedByComments, approvedByHoD, hodSign, approvedByHoDDate, approvedByHoDComments, approvedBySMO, smoSign, approvedBySMODate, approvedBySMOComments, receivedByHR, hrSign, receivedByHRDate, receivedByHRComments, hrReferenceNo, salaryRange, source, actionTaken, closedOn } = req.body;
        // Step 2: Create Requisition
        const requisition = yield prisma_1.prisma.manpowerRequisition.create({
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
    }
    catch (error) {
        console.error("Error creating requisition:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});
exports.createRequisition = createRequisition;
const updateRequisitionStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { id } = req.params;
        const { step, approverName, signature, comments, reject, departmentId, createdBy, location, title } = req.body;
        const now = new Date();
        let updateData = {};
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
                }
                else {
                    const requisition = yield prisma_1.prisma.manpowerRequisition.findUnique({
                        where: { id: Number(id) },
                    });
                    if (!requisition) {
                        return res.status(404).json({ message: "Requisition not found" });
                    }
                    // ✅ Parse reasonBreakdown JSON safely
                    let breakdown = [];
                    try {
                        breakdown = requisition.reasonBreakdown
                            ? typeof requisition.reasonBreakdown === "string"
                                ? JSON.parse(requisition.reasonBreakdown)
                                : requisition.reasonBreakdown
                            : [];
                    }
                    catch (err) {
                        console.error("Invalid reasonBreakdown JSON:", err);
                        breakdown = [];
                    }
                    // ✅ If no breakdown, still create one job (fallback to old logic)
                    if (!breakdown.length) {
                        yield prisma_1.prisma.job.create({
                            data: {
                                title: title || requisition.title || "Untitled",
                                departmentId: (_a = requisition.departmentId) !== null && _a !== void 0 ? _a : 0,
                                location,
                                headcount: requisition.vacancies || 1,
                                createdBy: createdBy || 1,
                            },
                        });
                    }
                    else {
                        // ✅ Create multiple jobs from breakdown
                        for (const item of breakdown) {
                            yield prisma_1.prisma.job.create({
                                data: {
                                    title: item.designation || requisition.title || "Untitled",
                                    departmentId: (_b = requisition.departmentId) !== null && _b !== void 0 ? _b : 0,
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
        const updated = yield prisma_1.prisma.manpowerRequisition.update({
            where: { id: Number(id) },
            data: updateData,
        });
        return res.status(200).json(updated);
    }
    catch (error) {
        console.error("Error updating requisition:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});
exports.updateRequisitionStatus = updateRequisitionStatus;
const listRequisitions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const requisitions = yield prisma_1.prisma.manpowerRequisition.findMany({
            include: { job: true },
            orderBy: { requestDate: 'desc' }
        });
        // get all unique departmentIds
        const deptIds = [...new Set(requisitions
                .map(r => r.departmentId)
                .filter((id) => id !== null) // type guard: only numbers
            )];
        // fetch departments
        const departments = yield prisma_1.prisma.department.findMany({
            where: { id: { in: deptIds } },
            select: { id: true, name: true },
        });
        // map deptId → deptName
        const deptMap = Object.fromEntries(departments.map(d => [d.id, d.name]));
        // attach dept name to requisitions
        const withDept = requisitions.map(r => (Object.assign(Object.assign({}, r), { departmentName: deptMap[r.departmentId] || null })));
        return res.status(200).json(withDept);
    }
    catch (error) {
        console.error("Error fetching requisitions:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});
exports.listRequisitions = listRequisitions;
