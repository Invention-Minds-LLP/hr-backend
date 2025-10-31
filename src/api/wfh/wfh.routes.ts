import express from "express";
import {
  createWFHRequest,
  getWFHRequests,
  getWhoIsOnWFHBuckets,
  updateWFHStatus,
} from "./wfh.controller"
import { authenticateToken } from "../../middleware/authMiddleware";

const router = express.Router();

router.post("/",authenticateToken,createWFHRequest);
router.get("/",authenticateToken, getWFHRequests);
router.get('/wfh-buckets',authenticateToken, getWhoIsOnWFHBuckets);
router.patch("/:id/status", authenticateToken, updateWFHStatus);

export default router;
