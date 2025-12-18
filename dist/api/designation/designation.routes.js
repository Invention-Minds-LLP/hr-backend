"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const designation_controller_1 = require("./designation.controller");
const router = (0, express_1.Router)();
/* ==========================
   DESIGNATION ROUTES
   ========================== */
router.post("/", designation_controller_1.createDesignation); // Create designation
router.get("/", designation_controller_1.getDesignations); // Get all designations
router.get("/:id", designation_controller_1.getDesignationById); // Get designation by id
exports.default = router;
