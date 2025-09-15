"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const evaluation_controller_1 = require("./evaluation.controller");
const router = (0, express_1.Router)();
router.post('/', evaluation_controller_1.createTest);
router.get('/', evaluation_controller_1.getAllTests);
router.put('/:id', evaluation_controller_1.updateTest);
exports.default = router;
