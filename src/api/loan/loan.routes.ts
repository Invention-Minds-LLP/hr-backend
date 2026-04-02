import { Router } from "express";
import { getLoans, createLoan, updateLoan, addRepayment, deleteLoan } from "./loan.controller";
import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

router.get("/", authenticateToken, getLoans);
router.post("/", authenticateToken, createLoan);
router.put("/:id", authenticateToken, updateLoan);
router.post("/:id/repayment", authenticateToken, addRepayment);
router.delete("/:id", authenticateToken, deleteLoan);

export default router;
