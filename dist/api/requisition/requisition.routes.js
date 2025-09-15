"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requisition_controller_1 = require("./requisition.controller");
const router = (0, express_1.Router)();
router.post("/", requisition_controller_1.createRequisition);
router.get("/", requisition_controller_1.listRequisitions);
router.patch("/:id/status", requisition_controller_1.updateRequisitionStatus);
exports.default = router;
