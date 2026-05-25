/**
 * Payroll Module Seed
 * ───────────────────
 * Populates demo data so the management-dashboard payroll cards
 * (Payroll Summary, Loan Exposure, Incentives, Payroll Readiness) have
 * meaningful numbers instead of empty states.
 *
 * What gets created (for the existing ACTIVE employees):
 *   • SalaryStructure for most active employees — salary bands spanning
 *     every CTC bucket. A few employees are left WITHOUT a structure on
 *     purpose (feeds "missing structure" readiness card). 2 carry a future
 *     effectiveFrom (feeds "upcoming revisions").
 *   • PayrollRun + Payslip for the last 6 months (incl. current) using the
 *     same earnings/deduction formula as the real payroll engine. Feeds the
 *     Payroll Summary + 6-month cost trend.
 *   • Loans (varied type/status) + LoanRepayments (varied mode).
 *   • Incentives (varied type/status/source), several PAID this month/year.
 *
 * Idempotent:
 *   Demo rows are tagged via `notes`/`remarks` = "[SEED-DEMO]". Re-running
 *   first deletes prior demo payslips → demo runs, demo repayments → demo
 *   loans, and demo incentives, then reinserts. Salary structures are only
 *   created where MISSING, so real rows are never clobbered.
 *
 * Run:
 *   npx ts-node prisma/seedPayrollData.ts
 *   (or: npm run seed:payroll)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MARKER = "[SEED-DEMO]";

// ── small helpers ─────────────────────────────────────────────
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const round2 = (n: number) => Math.round(n * 100) / 100;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
function calendarWorkingDays(year: number, month: number): number {
  const total = daysInMonth(year, month);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    if (new Date(year, month - 1, d).getDay() !== 0) count++; // skip Sundays
  }
  return count;
}
function professionalTax(gross: number): number {
  if (gross < 15000) return 0;
  if (gross < 20000) return 150;
  return 200;
}

// Monthly salary bands chosen to land across all CTC buckets used by the
// readiness card (<20k, 20-40k, 40-60k, 60-1L, >1L).
const SALARY_BANDS = [
  { basic: 9000,  hra: 3600,  medicalAllowance: 1250, travelAllowance: 1600, specialAllowance: 1500, otherAllowances: 500,  tdsMonthly: 0 },     // ~17k
  { basic: 14000, hra: 5600,  medicalAllowance: 1250, travelAllowance: 1600, specialAllowance: 4000, otherAllowances: 1000, tdsMonthly: 0 },     // ~27k
  { basic: 22000, hra: 8800,  medicalAllowance: 1250, travelAllowance: 1600, specialAllowance: 7000, otherAllowances: 2000, tdsMonthly: 1500 },  // ~42k
  { basic: 30000, hra: 12000, medicalAllowance: 1250, travelAllowance: 1600, specialAllowance: 9000, otherAllowances: 3000, tdsMonthly: 3000 },  // ~57k
  { basic: 45000, hra: 18000, medicalAllowance: 1250, travelAllowance: 1600, specialAllowance: 12000, otherAllowances: 5000, tdsMonthly: 6000 }, // ~83k
  { basic: 70000, hra: 28000, medicalAllowance: 1250, travelAllowance: 1600, specialAllowance: 20000, otherAllowances: 8000, tdsMonthly: 12000 },// ~129k
];

const LOAN_TYPES = ["SALARY_ADVANCE", "PERSONAL", "EMERGENCY", "OTHER"];
const REPAY_MODES = ["SALARY_DEDUCTION", "CASH", "BANK_TRANSFER"];
const INCENTIVE_TYPES = ["BONUS", "PERFORMANCE", "FESTIVAL", "REFERRAL", "OTHER"];

async function main() {
  const employees = await prisma.employee.findMany({
    where: { employmentStatus: "ACTIVE" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (employees.length === 0) {
    console.log("No active employees — nothing to seed.");
    return;
  }
  const empIds = employees.map((e) => e.id);
  const processedBy = empIds[0];
  console.log(`Active employees: ${empIds.length}`);

  // ── 1. CLEANUP prior demo data ──────────────────────────────
  const delPayslips = await prisma.payslip.deleteMany({ where: { remarks: MARKER } });
  const demoRuns = await prisma.payrollRun.findMany({
    where: { notes: MARKER },
    select: { id: true },
  });
  const delRuns = await prisma.payrollRun.deleteMany({ where: { notes: MARKER } });
  const demoLoans = await prisma.loan.findMany({ where: { remarks: MARKER }, select: { id: true } });
  if (demoLoans.length) {
    await prisma.loanRepayment.deleteMany({ where: { loanId: { in: demoLoans.map((l) => l.id) } } });
  }
  const delLoans = await prisma.loan.deleteMany({ where: { remarks: MARKER } });
  const delIncentives = await prisma.incentive.deleteMany({ where: { remarks: MARKER } });
  const delOt = await prisma.overtimeApproval.deleteMany({ where: { manualEntryReason: MARKER } });
  console.log(
    `Cleanup: ${delPayslips.count} payslips, ${delRuns.count} runs, ${delLoans.count} loans, ${delIncentives.count} incentives, ${delOt.count} OT removed.`
  );

  // ── 2. SALARY STRUCTURES (only where missing) ───────────────
  // Leave the last 4 employees without a structure → "missing structure" card.
  const withoutStructureCount = Math.min(4, Math.max(0, empIds.length - 6));
  const structureTargets = empIds.slice(0, empIds.length - withoutStructureCount);
  const now = new Date();
  let createdStructures = 0;
  for (let i = 0; i < structureTargets.length; i++) {
    const empId = structureTargets[i];
    const exists = await prisma.salaryStructure.findUnique({ where: { employeeId: empId } });
    if (exists) continue; // never clobber a real/existing structure
    const band = SALARY_BANDS[i % SALARY_BANDS.length];
    const gross =
      band.basic + band.hra + band.medicalAllowance + band.travelAllowance +
      band.specialAllowance + band.otherAllowances;
    // 2 future-dated structures → "upcoming revisions"
    const effectiveFrom = i < 2 ? new Date(now.getFullYear(), now.getMonth() + 1, 5) : now;
    await prisma.salaryStructure.create({
      data: {
        employeeId: empId,
        basic: band.basic,
        hra: band.hra,
        medicalAllowance: band.medicalAllowance,
        travelAllowance: band.travelAllowance,
        specialAllowance: band.specialAllowance,
        otherAllowances: band.otherAllowances,
        pfApplicable: true,
        esiApplicable: gross <= 21000,
        ptApplicable: true,
        tdsMonthly: band.tdsMonthly,
        effectiveFrom,
      },
    });
    createdStructures++;
  }
  console.log(`Salary structures created: ${createdStructures} (left ${withoutStructureCount} employees without).`);

  // Employees that now have a structure → eligible for payslips
  const structured = await prisma.salaryStructure.findMany({
    select: {
      employeeId: true, basic: true, hra: true, medicalAllowance: true,
      travelAllowance: true, specialAllowance: true, otherAllowances: true,
      pfApplicable: true, esiApplicable: true, ptApplicable: true, tdsMonthly: true,
    },
  });

  // ── 3. PAYROLL RUNS + PAYSLIPS (last 6 months) ──────────────
  let runCount = 0;
  let payslipCount = 0;
  for (let back = 5; back >= 0; back--) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();

    // Reuse a run if one already exists for this month/year; else create a demo run.
    let run = await prisma.payrollRun.findUnique({ where: { month_year: { month, year } } });
    if (!run) {
      run = await prisma.payrollRun.create({
        data: { month, year, status: "PUBLISHED", notes: MARKER, processedBy },
      });
      runCount++;
    }

    const workingDays = calendarWorkingDays(year, month);
    const payslips: any[] = [];
    for (const sal of structured) {
      const gross =
        sal.basic + sal.hra + sal.medicalAllowance + sal.travelAllowance +
        sal.specialAllowance + sal.otherAllowances;
      // synthetic attendance: 0–3 LOP days
      const lopDays = rand(0, 3);
      const presentDays = workingDays - lopDays;
      const perDay = workingDays > 0 ? gross / workingDays : 0;
      const earnedGross = round2(gross - lopDays * perDay);

      const overtimeHours = Math.random() < 0.4 ? rand(2, 16) : 0;
      const hourlyOtRate = workingDays > 0 ? (sal.basic / (workingDays * 8)) * 2 : 0;
      const overtimePay = round2(overtimeHours * hourlyOtRate);

      const pfEmployee = sal.pfApplicable ? round2(sal.basic * 0.12) : 0;
      const pfEmployer = sal.pfApplicable ? round2(sal.basic * 0.12) : 0;
      const esiEmployee = sal.esiApplicable && gross <= 21000 ? round2(gross * 0.0075) : 0;
      const esiEmployer = sal.esiApplicable && gross <= 21000 ? round2(gross * 0.0325) : 0;
      const pt = sal.ptApplicable ? professionalTax(earnedGross) : 0;
      const tds = sal.tdsMonthly ?? 0;
      const totalDeductions = round2(pfEmployee + esiEmployee + pt + tds);
      const netPay = round2(earnedGross + overtimePay - totalDeductions);

      payslips.push({
        employeeId: sal.employeeId, payrollRunId: run.id, month, year,
        workingDays, presentDays, leaveDays: 0, lopDays,
        overtimeHours, overtimePay,
        basic: sal.basic, hra: sal.hra, medicalAllowance: sal.medicalAllowance,
        travelAllowance: sal.travelAllowance, specialAllowance: sal.specialAllowance,
        otherAllowances: sal.otherAllowances, grossEarnings: earnedGross,
        pfEmployee, pfEmployer, esiEmployee, esiEmployer,
        professionalTax: pt, tds, totalDeductions, netPay, remarks: MARKER,
      });
    }
    if (payslips.length) {
      const r = await prisma.payslip.createMany({ data: payslips });
      payslipCount += r.count;
    }
  }
  console.log(`Payroll runs created: ${runCount}; payslips created: ${payslipCount}.`);

  // ── 4. LOANS + REPAYMENTS ───────────────────────────────────
  // status spread: PENDING, APPROVED, ACTIVE x5, CLOSED x2, REJECTED
  const loanStatuses = ["PENDING", "APPROVED", "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "CLOSED", "CLOSED", "REJECTED", "PENDING", "ACTIVE"];
  let loanCount = 0;
  let repayCount = 0;
  for (let i = 0; i < loanStatuses.length && i < empIds.length; i++) {
    const status = loanStatuses[i];
    const empId = empIds[i];
    const principal = rand(2, 20) * 10000; // 20k–200k
    const tenure = pick([6, 9, 12, 18, 24, 36]);
    const interestRate = pick([0, 0, 6, 9, 12]);
    const emiAmount = round2((principal * (1 + interestRate / 100)) / tenure);

    let totalRepaid = 0;
    let outstanding = principal;
    let disbursedOn: Date | null = null;
    let approvedAt: Date | null = null;
    const appliedOn = new Date(now.getFullYear(), now.getMonth() - rand(0, 5), rand(1, 28));

    if (status === "ACTIVE") {
      const paidEmis = rand(1, Math.max(1, tenure - 2));
      totalRepaid = round2(Math.min(principal, emiAmount * paidEmis));
      outstanding = round2(Math.max(0, principal - totalRepaid));
      disbursedOn = appliedOn;
      approvedAt = appliedOn;
    } else if (status === "CLOSED") {
      totalRepaid = principal;
      outstanding = 0;
      disbursedOn = appliedOn;
      approvedAt = appliedOn;
    } else if (status === "APPROVED") {
      approvedAt = appliedOn;
      disbursedOn = appliedOn;
    }

    const loan = await prisma.loan.create({
      data: {
        employeeId: empId, loanType: pick(LOAN_TYPES), principalAmount: principal,
        interestRate, tenure, emiAmount, totalRepaid, outstandingBalance: outstanding,
        status, appliedOn,
        approvedBy: approvedAt ? processedBy : null, approvedAt, disbursedOn,
        reason: "Demo loan", remarks: MARKER,
      },
    });
    loanCount++;

    // Repayments for ACTIVE/CLOSED loans
    if (totalRepaid > 0) {
      const nEmis = Math.max(1, Math.round(totalRepaid / emiAmount));
      let remaining = totalRepaid;
      for (let k = 0; k < nEmis; k++) {
        const amt = k === nEmis - 1 ? round2(remaining) : round2(emiAmount);
        remaining = round2(remaining - amt);
        if (amt <= 0) break;
        await prisma.loanRepayment.create({
          data: {
            loanId: loan.id, employeeId: empId, amount: amt,
            paidOn: new Date(now.getFullYear(), now.getMonth() - (nEmis - k), rand(1, 28)),
            mode: pick(REPAY_MODES), remarks: MARKER,
          },
        });
        repayCount++;
      }
    }
  }
  console.log(`Loans created: ${loanCount}; repayments created: ${repayCount}.`);

  // ── 5. INCENTIVES ───────────────────────────────────────────
  const incentiveStatuses = ["PENDING", "PENDING", "APPROVED", "PAID", "PAID", "PAID", "PAID", "PAID", "CANCELLED", "REJECTED"];
  let incentiveCount = 0;
  for (let i = 0; i < 18; i++) {
    const empId = empIds[i % empIds.length];
    const status = pick(incentiveStatuses);
    const source = pick(["MANUAL", "REQUEST"]);
    const amount = rand(1, 25) * 2000; // 2k–50k
    const effectiveDate = new Date(now.getFullYear(), now.getMonth() - rand(0, 5), rand(1, 28));
    let paidOn: Date | null = null;
    let approvedAt: Date | null = null;
    if (status === "PAID") {
      approvedAt = effectiveDate;
      // ~half paid in the current month, rest earlier this year
      paidOn = i % 2 === 0
        ? new Date(now.getFullYear(), now.getMonth(), rand(1, 28))
        : new Date(now.getFullYear(), rand(0, now.getMonth()), rand(1, 28));
    } else if (status === "APPROVED") {
      approvedAt = effectiveDate;
    }
    await prisma.incentive.create({
      data: {
        employeeId: empId, type: pick(INCENTIVE_TYPES), amount,
        description: "Demo incentive", effectiveDate, paidOn, status,
        requestedBy: source === "REQUEST" ? processedBy : null,
        approvedBy: approvedAt ? processedBy : null, approvedAt,
        source, remarks: MARKER,
      },
    });
    incentiveCount++;
  }
  console.log(`Incentives created: ${incentiveCount}.`);

  // ── 6. OVERTIME APPROVALS (feeds the OT Analysis section) ───
  // getOtAnalysis filters status:"APPROVE" + managerStatus:"APPROVED" within
  // the selected month. Seed for the current + previous month so the month
  // navigator has data both sides. Unique constraint is [employeeId, date],
  // so each employee gets distinct days.
  let otCount = 0;
  for (let back = 1; back >= 0; back--) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const month = d.getMonth() + 1, year = d.getFullYear();
    const otEmployees = empIds.slice(0, Math.min(16, empIds.length));
    for (const empId of otEmployees) {
      const nDays = rand(1, 3);
      const usedDays = new Set<number>();
      for (let k = 0; k < nDays; k++) {
        let day = rand(1, 26);
        while (usedDays.has(day)) day = rand(1, 26);
        usedDays.add(day);
        const date = new Date(year, month - 1, day);
        const minutes = rand(1, 4) * 30 + 60; // 90–240 min
        await prisma.overtimeApproval.create({
          data: {
            employeeId: empId, date, minutes,
            status: "APPROVE", managerStatus: "APPROVED",
            approvedAt: date, managerApprovedAt: date, managerId: processedBy,
            manuallyEntered: true, manualEntryBy: processedBy, manualEntryReason: MARKER,
          },
        });
        otCount++;
      }
    }
  }
  console.log(`Overtime approvals created: ${otCount}.`);

  console.log("\n✅ Payroll demo seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
