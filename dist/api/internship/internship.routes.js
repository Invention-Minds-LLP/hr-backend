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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ctrl = __importStar(require("./internship.controller"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
router.post('/', authMiddleware_1.authenticateToken, ctrl.createInternship);
router.get('/', authMiddleware_1.authenticateToken, ctrl.listInternships);
router.get('/:id', authMiddleware_1.authenticateToken, ctrl.getInternship);
router.patch('/:id', authMiddleware_1.authenticateToken, ctrl.updateInternship);
// Workflow actions
router.post('/:id/offer', authMiddleware_1.authenticateToken, ctrl.offerInternship);
router.post('/:id/activate', authMiddleware_1.authenticateToken, ctrl.activateInternship);
router.post('/:id/extend', authMiddleware_1.authenticateToken, ctrl.extendInternship);
router.post('/:id/complete', authMiddleware_1.authenticateToken, ctrl.completeInternship);
router.post('/:id/drop', authMiddleware_1.authenticateToken, ctrl.dropInternship);
router.post('/:id/convert', authMiddleware_1.authenticateToken, ctrl.convertInternship);
exports.default = router;
