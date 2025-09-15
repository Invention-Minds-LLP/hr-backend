"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const wfh_controller_1 = require("./wfh.controller");
const router = express_1.default.Router();
router.post("/", wfh_controller_1.createWFHRequest);
router.get("/", wfh_controller_1.getWFHRequests);
router.get('/wfh-buckets', wfh_controller_1.getWhoIsOnWFHBuckets);
router.patch("/:id/status", wfh_controller_1.updateWFHStatus);
exports.default = router;
