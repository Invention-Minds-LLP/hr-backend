import { Router } from "express";
import {
  createDesignation,
  getDesignations,
  getDesignationById
} from "./designation.controller";

const router = Router();

/* ==========================
   DESIGNATION ROUTES
   ========================== */

router.post("/", createDesignation);        // Create designation
router.get("/", getDesignations);            // Get all designations
router.get("/:id", getDesignationById);      // Get designation by id

export default router;
