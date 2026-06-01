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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const ann = __importStar(require("./announcement.controller"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
// Allowed attachment types for announcements.
const ALLOWED_MIME = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const upload = (0, multer_1.default)({
    dest: 'uploads/',
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB per file
        files: 10, // max 10 attachments
    },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.has(file.mimetype))
            return cb(null, true);
        cb(new Error(`Unsupported file type: ${file.mimetype}`));
    },
});
// Create an announcement. Authenticate BEFORE parsing the upload so anonymous
// requests can't write files to disk.
router.post('/', authMiddleware_1.authenticateToken, upload.array('attachments', 10), ann.createAnnouncement);
// Acknowledge the latest/live announcement (or pass :id explicitly)
router.post('/:id/ack', authMiddleware_1.authenticateToken, ann.ackAnnouncement);
// List live + ack stats (rate, counts)
router.get('/live', authMiddleware_1.authenticateToken, ann.listLiveAnnouncementsWithStats);
// List all announcements (employee)
router.get('/live-employee', authMiddleware_1.authenticateToken, ann.listLiveForEmployee);
router.get('/live/all', authMiddleware_1.authenticateToken, ann.listAllLiveForEmployee);
exports.default = router;
