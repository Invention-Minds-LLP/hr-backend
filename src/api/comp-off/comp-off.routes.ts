import { Router } from "express";
import { getCompOffCredits, createCompOff, deleteCompOff } from "./comp-off.controller";
import {
  listMyCompOffRequests,
  listPendingForManager,
  listPendingForHr,
  listAllCompOffRequests,
  createCompOffRequest,
  managerDecideCompOff,
  hrDecideCompOff,
  withdrawCompOffRequest,
} from "./comp-off-request.controller";
import { authenticateToken, requirePermission } from "../../middleware/authMiddleware";

const router = Router();

// Issuing a credit is gated by its own key — seeing the register is not the
// same act as putting a day into someone's balance. Stage one is gated by the
// reporting-manager relationship instead, inside the handler.
const canApprove = requirePermission("admin.compOff.approve");

// Requests (approval flow). Literal paths before '/:id' so they match first.
router.get("/requests/my", authenticateToken, listMyCompOffRequests);
router.get("/requests/pending", authenticateToken, listPendingForManager);
router.get("/requests/hr-pending", authenticateToken, canApprove, listPendingForHr);
router.get("/requests", authenticateToken, canApprove, listAllCompOffRequests);
router.post("/requests", authenticateToken, canApprove, createCompOffRequest);
router.patch("/requests/:id/manager-decide", authenticateToken, managerDecideCompOff);
router.patch("/requests/:id/hr-decide", authenticateToken, canApprove, hrDecideCompOff);
router.delete("/requests/:id", authenticateToken, withdrawCompOffRequest);

// Credits
router.get("/", authenticateToken, getCompOffCredits);
router.post("/", authenticateToken, createCompOff);
router.delete("/:id", authenticateToken, deleteCompOff);

export default router;
