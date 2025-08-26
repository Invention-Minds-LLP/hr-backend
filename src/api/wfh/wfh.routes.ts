import express from "express";
import {
  createWFHRequest,
  getWFHRequests,
  getWhoIsOnWFHBuckets,
  updateWFHStatus,
} from "./wfh.controller"

const router = express.Router();

router.post("/", createWFHRequest);
router.get("/", getWFHRequests);
router.get('/wfh-buckets', getWhoIsOnWFHBuckets);
router.patch("/:id/status", updateWFHStatus);

export default router;
