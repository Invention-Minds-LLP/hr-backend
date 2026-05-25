/* eslint-disable */
// Seed realistic data for the HR Operations dashboard graphs.
// Idempotent-ish: attendance/OT/weekly use skipDuplicates; the rest are
// guarded by a count check so re-running won't pile up duplicates.
//   Run:  node prisma/seed-dashboard.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// deterministic RNG so re-seeds are reproducible
let _s = 987654321;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const atTime = (date, h, m) => { const d = new Date(date); d.setHours(h, m, 0, 0); return d; };
const mondayOf = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0,0,0,0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

async function main() {
  const today = new Date();
  const start = addDays(today, -182); // ~6 months

  const employees = await prisma.employee.findMany({
    where: { employmentStatus: 'ACTIVE' },
    select: { id: true, departmentId: true, dateOfJoining: true },
  });
  const departments = await prisma.department.findMany({ select: { id: true, name: true } });
  if (!employees.length) { console.log('No active employees — aborting.'); return; }
  const managerId = employees[0].id;
  console.log(`Seeding for ${employees.length} employees, ${departments.length} departments`);

  // ── Leave types ───────────────────────────────────────────
  let leaveTypes = await prisma.leaveType.findMany();
  if (leaveTypes.length === 0) {
    for (const n of ['Casual Leave', 'Earned Leave', 'Sick Leave', 'Comp Off']) {
      await prisma.leaveType.create({ data: { name: n } });
    }
    leaveTypes = await prisma.leaveType.findMany();
  }

  // ── Shift template + fixed assignment (enables punctuality/worked-hours) ──
  let shifts = await prisma.shiftTemplate.findMany();
  if (shifts.length === 0) {
    const b = new Date(2020, 0, 1);
    await prisma.shiftTemplate.create({ data: { name: 'General (9-6)', shiftType: 'MORNING', startTime: atTime(b, 9, 0), endTime: atTime(b, 18, 0) } });
    shifts = await prisma.shiftTemplate.findMany();
  }
  const shift = shifts[0];
  for (const e of employees) {
    await prisma.employeeShiftSetting.upsert({
      where: { employeeId: e.id },
      create: { employeeId: e.id, mode: 'FIXED', fixedShiftId: shift.id },
      update: {},
    });
  }

  // ── Attendance (working days Mon–Sat) ─────────────────────
  const attRows = [];
  const otRows = [];
  for (const e of employees) {
    let weekOtCount = 0; let weekKey = '';
    for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
      const dow = d.getDay();
      if (dow === 0) continue; // Sunday off
      const wk = mondayOf(d).toISOString().slice(0, 10);
      if (wk !== weekKey) { weekKey = wk; weekOtCount = 0; }
      const day = new Date(d); day.setHours(0, 0, 0, 0);
      const roll = rnd();
      if (roll < 0.06) { attRows.push({ employeeId: e.id, date: day, status: 'ABSENT' }); continue; }
      if (roll < 0.12) { attRows.push({ employeeId: e.id, date: day, status: 'LEAVE' }); continue; }
      if (roll < 0.15) { attRows.push({ employeeId: e.id, date: day, status: 'PERMISSION' }); continue; }
      // present (some late, some early-out)
      const late = chance(0.18);
      const earlyOut = chance(0.12);
      const checkIn = late ? atTime(day, 9, ri(25, 80)) : atTime(day, 9, ri(0, 12));
      const checkOut = earlyOut ? atTime(day, 16, ri(0, 55)) : atTime(day, 18, ri(0, 25));
      attRows.push({ employeeId: e.id, date: day, status: 'PRESENT', checkIn, checkOut });
      // overtime on ~12% of present days; create some weekly breaches
      if (chance(0.12) && weekOtCount < 4) {
        weekOtCount++;
        const mins = chance(0.3) ? ri(125, 210) : ri(45, 115); // some > 120 (breach)
        otRows.push({ employeeId: e.id, date: day, minutes: mins, status: 'APPROVE', managerStatus: 'APPROVED', approvedAt: day });
      }
    }
  }
  // chunk inserts
  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  for (const c of chunk(attRows, 500)) await prisma.attendance.createMany({ data: c, skipDuplicates: true });
  for (const c of chunk(otRows, 500)) await prisma.overtimeApproval.createMany({ data: c, skipDuplicates: true });
  console.log(`Attendance: ${attRows.length} candidate rows · OT: ${otRows.length}`);

  // ── Leave requests (varied types, mostly approved) ────────
  if ((await prisma.leaveRequest.count()) < 60) {
    const lr = [];
    for (const e of employees) {
      const n = ri(0, 3);
      for (let i = 0; i < n; i++) {
        const s = addDays(start, ri(0, 175));
        const len = chance(0.3) ? ri(2, 6) : 1;
        lr.push({
          employeeId: e.id, leaveTypeId: pick(leaveTypes).id,
          startDate: s, endDate: addDays(s, len - 1),
          reason: pick(['Personal', 'Medical', 'Family function', 'Travel', 'Rest']),
          status: chance(0.85) ? 'APPROVED' : 'PENDING',
          isHalfDay: chance(0.15),
        });
      }
    }
    for (const c of chunk(lr, 500)) await prisma.leaveRequest.createMany({ data: c, skipDuplicates: true });
    console.log(`Leave requests: +${lr.length}`);
  }

  // ── Weekly performance ratings (8 weeks; ~80% submitted) ──
  if ((await prisma.weeklyPerformanceRating.count()) < 60) {
    const wr = [];
    for (let w = 0; w < 8; w++) {
      const ws = mondayOf(addDays(today, -7 * w));
      const we = addDays(ws, 6);
      for (const e of employees) {
        if (!chance(0.8)) continue; // ~20% pending
        wr.push({
          employeeId: e.id, ratedBy: managerId, raterType: 'MANAGER',
          weekStartDate: ws, weekEndDate: we, weekLabel: ws.toISOString().slice(0, 10),
          overallScore: ri(45, 96), status: 'SUBMITTED',
        });
      }
    }
    for (const c of chunk(wr, 500)) await prisma.weeklyPerformanceRating.createMany({ data: c, skipDuplicates: true });
    console.log(`Weekly ratings: +${wr.length}`);
  }

  // ── Incidents (varied severity/status/outcome) ────────────
  if ((await prisma.incident.count()) < 15) {
    const sev = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const sts = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED', 'ESCALATED'];
    const out = [null, 'SUBSTANTIATED', 'UNSUBSTANTIATED', 'FALSE_REPORT', null];
    for (let i = 0; i < 22; i++) {
      const e = pick(employees);
      await prisma.incident.create({
        data: {
          title: pick(['Safety lapse', 'Misconduct report', 'Policy breach', 'Harassment complaint', 'Equipment damage', 'Attendance fraud']),
          description: 'Seeded incident for dashboard analytics.',
          severity: pick(sev), status: pick(sts), outcome: pick(out),
          incidentDate: addDays(start, ri(0, 178)),
          employeeId: e.id, departmentId: e.departmentId ?? null,
        },
      });
    }
    console.log('Incidents: +22');
  }

  // ── Salary revisions (#22) for employees with a structure ─
  if ((await prisma.salaryRevision.count()) === 0) {
    const structs = await prisma.salaryStructure.findMany({
      select: { employeeId: true, basic: true, hra: true, medicalAllowance: true, travelAllowance: true, specialAllowance: true, otherAllowances: true },
    });
    const revs = [];
    for (const s of structs) {
      const cur = s.basic + s.hra + s.medicalAllowance + s.travelAllowance + s.specialAllowance + s.otherAllowances;
      if (cur <= 0) continue;
      const pct = ri(5, 18);
      const prev = Math.round(cur / (1 + pct / 100));
      revs.push({ employeeId: s.employeeId, previousCtc: prev, newCtc: Math.round(cur), percentage: pct, effectiveFrom: addDays(today, -ri(20, 300)) });
    }
    if (revs.length) await prisma.salaryRevision.createMany({ data: revs });
    console.log(`Salary revisions: +${revs.length}`);
  }

  // ── Probation statuses + records ──────────────────────────
  if ((await prisma.probationRecord.count()) < 5) {
    const statuses = ['IN_PROGRESS', 'IN_PROGRESS', 'EXTENDED', 'EXTENDED', 'CONFIRMED', 'WAIVED'];
    const sample = employees.slice(0, Math.min(10, employees.length));
    for (let i = 0; i < sample.length; i++) {
      const e = sample[i];
      const st = statuses[i % statuses.length];
      const ps = addDays(today, -ri(40, 150));
      const pe = addDays(ps, 90);
      await prisma.employee.update({
        where: { id: e.id },
        data: { probationStatus: st, probationStartDate: ps, probationEndDate: pe },
      });
      await prisma.probationRecord.create({ data: { employeeId: e.id, startDate: ps, endDate: pe, status: st } });
    }
    console.log(`Probation: +${sample.length}`);
  }

  // ── PIP weekly reviews + responses for existing PIPs ──────
  const pips = await prisma.employeePIP.findMany({ select: { id: true } });
  for (const p of pips) {
    if ((await prisma.pIPWeeklyReview.count({ where: { pipId: p.id } })) === 0) {
      for (let w = 1; w <= 4; w++) {
        await prisma.pIPWeeklyReview.create({
          data: { pipId: p.id, weekNumber: w, reviewDate: addDays(today, -7 * (5 - w)), weeklyScore: ri(40, 80), status: 'COMPLETED', reviewedBy: managerId },
        });
      }
    }
  }
  if (pips.length) console.log(`PIP weekly reviews ensured for ${pips.length} PIPs`);

  // ── Department planning + appraisal config ────────────────
  for (let i = 0; i < departments.length; i++) {
    const d = departments[i];
    const hc = await prisma.employee.count({ where: { departmentId: d.id, employmentStatus: 'ACTIVE' } });
    const calendar = i % 3 === 0; // ~1/3 use calendar-month appraisal
    await prisma.department.update({
      where: { id: d.id },
      data: {
        otBudgetHoursPerMonth: Math.max(10, hc * 6),
        minDailyStrength: Math.max(1, Math.ceil(hc * 0.6)),
        appraisalCycleBasis: calendar ? 'CALENDAR' : 'DOJ',
        appraisalPeriodMonths: 12,
        appraisalCalendarMonth: calendar ? (today.getMonth() + 1) : null,
      },
    });
  }
  console.log(`Department planning set for ${departments.length} departments`);

  // ── Recruitment "today" activity (#7) ─────────────────────
  const apps = await prisma.application.findMany({ select: { id: true, offer: { select: { id: true } } }, take: 20 });
  const tStart = atTime(today, 0, 0);
  let interviewsToday = 0, offersToday = 0, joinedToday = 0;
  for (const a of apps.slice(0, 3)) {
    await prisma.interview.create({ data: { applicationId: a.id, stage: 'HR Round', startTime: atTime(today, ri(10, 16), 0), endTime: atTime(today, ri(16, 18), 0) } });
    interviewsToday++;
  }
  for (const a of apps) {
    if (a.offer || offersToday >= 2) continue;
    await prisma.offer.create({ data: { applicationId: a.id, status: 'SENT', sentAt: atTime(today, ri(9, 15), 0), ctc: ri(300000, 900000) } });
    offersToday++;
  }
  // one joiner today
  const joinApp = apps.find((a) => !a.offer);
  if (joinApp && offersToday < 2) {
    await prisma.offer.create({ data: { applicationId: joinApp.id, status: 'SIGNED', signedAt: today, proposedJoinAt: today, joinOutcome: 'JOINED', ctc: ri(300000, 900000) } });
    joinedToday++;
  }
  console.log(`Recruitment today: +${interviewsToday} interviews, +${offersToday} offers, +${joinedToday} joiner`);

  console.log('✅ Seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
