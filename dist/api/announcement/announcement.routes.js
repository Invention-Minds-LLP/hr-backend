"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const ann = __importStar(require("./announcement.controller"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ dest: 'uploads/' });
// Create an announcement
router.post('/', upload.array('attachments', 10), authMiddleware_1.authenticateToken, ann.createAnnouncement);
// Acknowledge the latest/live announcement (or pass :id explicitly)
router.post('/:id/ack', authMiddleware_1.authenticateToken, ann.ackAnnouncement);
// List live + ack stats (rate, counts)
router.get('/live', authMiddleware_1.authenticateToken, ann.listLiveAnnouncementsWithStats);
// List all announcements (employee)
router.get('/live-employee', authMiddleware_1.authenticateToken, ann.listLiveForEmployee);
router.get('/live/all', authMiddleware_1.authenticateToken, ann.listAllLiveForEmployee);
exports.default = router;
