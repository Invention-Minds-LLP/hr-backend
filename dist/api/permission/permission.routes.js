"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const permission_controller_1 = require("./permission.controller");
const router = express_1.default.Router();
router.post("/", permission_controller_1.createPermissionRequest);
router.get("/", permission_controller_1.getPermissionRequests);
router.patch("/:id/status", permission_controller_1.updatePermissionStatus);
exports.default = router;
