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
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const createRequisition = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { title, departmentId, location, createdBy, designation, reasonBreakdown, minExperience, maxExperience, skills, education, training, eduSSC, eduDiploma, eduBachelor, eduMaster, eduOther, urgent, duration, reportingTo, reasonType, // ✅ add this
        reasonDetails, 
        // Approvals
        raisedBy, raisedBySign, raisedByDate, raisedByComments, approvedByHoD, hodSign, approvedByHoDDate, approvedByHoDComments, approvedBySMO, smoSign, approvedBySMODate, approvedBySMOComments, receivedByHR, hrSign, receivedByHRDate, receivedByHRComments, hrReferenceNo, salaryRange, source, actionTaken, closedOn } = req.body;
        // Step 2: Create Requisition
        const requisition = yield prisma.manpowerRequisition.create({
            data: {
                requestDate: new Date(),
                designation,
                departmentId,
                reasonBreakdown,
                minExperience,
                maxExperience,
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
                urgent,
                duration,
                reportingTo,
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
                status: "PENDING"
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
    try {
        const { id } = req.params;
        const { step, approverName, signature, comments, departmentId, createdBy, location, title } = req.body;
        let updateData = {};
        const now = new Date();
        switch (step) {
            case "RAISED":
                updateData = {
                    raisedBy: approverName,
                    raisedBySign: signature,
                    raisedByDate: now,
                    raisedByComments: comments,
                    status: "RAISED"
                };
                break;
            case "HOD":
                updateData = {
                    approvedByHoD: approverName,
                    hodSign: signature,
                    approvedByHoDDate: now,
                    approvedByHoDComments: comments,
                    status: "HOD_APPROVED"
                };
                break;
            case "SMO":
                updateData = {
                    approvedBySMO: approverName,
                    smoSign: signature,
                    approvedBySMODate: now,
                    approvedBySMOComments: comments,
                    status: "SMO_APPROVED"
                };
                break;
            case "HR":
                const requisition = yield prisma.manpowerRequisition.findUnique({ where: { id: Number(id) } });
                if (!requisition)
                    return res.status(404).json({ message: "Requisition not found" });
                // create Job only now
                const job = yield prisma.job.create({
                    data: {
                        title: title || requisition.designation || "Untitled",
                        departmentId,
                        location,
                        headcount: requisition.vacancies || 0,
                        createdBy,
                    },
                });
                updateData = {
                    receivedByHR: approverName,
                    hrSign: signature,
                    receivedByHRDate: now,
                    receivedByHRComments: comments,
                    status: "HR_RECEIVED"
                };
                break;
            default:
                return res.status(400).json({ message: "Invalid approval step" });
        }
        const updated = yield prisma.manpowerRequisition.update({
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
        const requisitions = yield prisma.manpowerRequisition.findMany({ include: { job: true }, });
        return res.status(200).json(requisitions);
    }
    catch (error) {
        console.error("Error fetching requisitions:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});
exports.listRequisitions = listRequisitions;
