"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const appraisal_controller_1 = require("./appraisal.controller");
const router = (0, express_1.Router)();
router.post('/bulk-create', appraisal_controller_1.bulkCreateAppraisals);
router.get("/", appraisal_controller_1.getAllAppraisalsWithManagerReview);
router.post('/manager-review', appraisal_controller_1.saveManagerReview);
exports.default = router;
