"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const permission_controller_1 = require("./permission.controller");
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = express_1.default.Router();
router.post("/", authMiddleware_1.authenticateToken, permission_controller_1.createPermissionRequest);
router.get("/", authMiddleware_1.authenticateToken, permission_controller_1.getPermissionRequests);
router.patch("/:id/status", authMiddleware_1.authenticateToken, permission_controller_1.updatePermissionStatus);
router.get('/balance/:employeeId', authMiddleware_1.authenticateToken, permission_controller_1.getPermissionBalance);
router.get('/monthly-usage/:employeeId', authMiddleware_1.authenticateToken, permission_controller_1.getMonthlyPermissionUsage);
exports.default = router;
