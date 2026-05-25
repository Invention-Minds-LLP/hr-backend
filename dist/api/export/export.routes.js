"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const export_controller_1 = require("./export.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
router.get('/:table', authMiddleware_1.authenticateToken, export_controller_1.exportTable);
exports.default = router;
