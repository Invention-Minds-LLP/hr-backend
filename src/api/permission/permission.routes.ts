import express from "express";
import {
  createPermissionRequest,
  getPermissionRequests,
  updatePermissionStatus
} from "./permission.controller";

const router = express.Router();

router.post("/", createPermissionRequest);
router.get("/", getPermissionRequests);
router.patch("/:id/status", updatePermissionStatus);

export default router;
