/**
 * Permission catalog + resolver
 * ─────────────────────────────
 * Single source of truth for "what can this user see". Every navigable screen
 * has a stable key (`admin.payroll.view`); the frontend asks
 * `GET /api/me/permissions` once at startup and gates the navbar and routes on
 * the returned list instead of re-deriving role rules in the browser.
 *
 * PHASE 1 — the rules below are a deliberate 1:1 port of the `*ngIf`
 * expressions that used to live in navbar.html + navbar.ts. Nothing about who
 * sees what has changed. The point of this file is that the rules are now in
 * ONE place, expressed as "what you get" instead of "who is blocked".
 *
 * PHASE 2 will replace `computePermissions()` with a lookup against the
 * Role/Permission tables (which already exist in schema.prisma but are unused),
 * so access becomes editable from a screen instead of a redeploy. The key names
 * below are the contract that survives that swap — the frontend never changes.
 *
 * Parent-menu keys (`*.section.view`) mirror the top-level nav headings. A
 * child key is always ANDed with its section, because a child was only ever
 * reachable by opening its parent menu.
 */

// ── Catalog ─────────────────────────────────────────────────────────────────
// The key, plus the label and grouping the Role Permissions matrix renders from
// — so adding a permission never means editing the admin screen.
// Grouped the way they appear in the UI, so this list reads like the navbar.

export const PERMISSION_CATALOG = [
  // Top-level dashboards
  { name: 'dashboard.hr.view', label: 'HR Dashboard', module: 'Dashboards' },
  { name: 'dashboard.management.view', label: 'Management Overview', module: 'Dashboards' },
  { name: 'dashboard.hrAnalytics.view', label: 'HR Analytics', module: 'Dashboards' },
  { name: 'admin.moduleUtilization.view', label: 'Module Utilization', module: 'Dashboards' },

  // Menu sections (the headings themselves)
  { name: 'admin.section.view', label: 'Administration menu', module: 'Menu sections' },
  { name: 'hrManual.section.view', label: 'HR Manual Entries menu', module: 'Menu sections' },
  { name: 'recruitment.section.view', label: 'Recruitment menu', module: 'Menu sections' },
  { name: 'masters.section.view', label: 'Masters menu', module: 'Menu sections' },

  // Administration › Workforce
  { name: 'admin.employee.view', label: 'Employee', module: 'Administration · Workforce' },
  { name: 'admin.attendance.view', label: 'Attendance', module: 'Administration · Workforce' },
  { name: 'admin.leave.view', label: 'Leaves', module: 'Administration · Workforce' },

  // Administration › Performance
  { name: 'admin.weeklyTracker.view', label: 'Weekly Tracker', module: 'Administration · Performance' },
  { name: 'admin.appraisal.view', label: 'Appraisal', module: 'Administration · Performance' },
  { name: 'admin.training.view', label: 'Training', module: 'Administration · Performance' },
  { name: 'admin.pip.view', label: 'PIP', module: 'Administration · Performance' },

  // Administration › Compliance
  { name: 'admin.resignation.view', label: 'Resignation', module: 'Administration · Compliance' },
  { name: 'admin.incidents.view', label: 'Incidents', module: 'Administration · Compliance' },
  { name: 'admin.complaints.view', label: 'Complaints', module: 'Administration · Compliance' },
  { name: 'admin.committees.view', label: 'Committees', module: 'Administration · Compliance' },

  // Administration › HR Ops
  { name: 'admin.incentiveRequests.view', label: 'Incentive Requests', module: 'Administration · HR Ops' },
  { name: 'admin.shifts.view', label: 'Shifts', module: 'Administration · HR Ops' },
  { name: 'admin.otApprovals.view', label: 'OT Approvals', module: 'Administration · HR Ops' },
  { name: 'admin.reports.view', label: 'Data Export', module: 'Administration · HR Ops' },
  { name: 'admin.payroll.view', label: 'Payroll', module: 'Administration · HR Ops' },
  { name: 'admin.taxDeclarations.view', label: 'Tax Declarations', module: 'Administration · HR Ops' },
  { name: 'admin.companies.view', label: 'Companies & Statutory', module: 'Administration · HR Ops' },
  { name: 'admin.letters.view', label: 'Letters', module: 'Administration · HR Ops' },
  { name: 'admin.assets.view', label: 'Asset Register', module: 'Administration · HR Ops' },

  // HR Manual Entries
  { name: 'admin.forcePresent.view', label: 'Force Present', module: 'HR Manual Entries' },
  { name: 'admin.hrCorrections.view', label: 'HR Force Entry', module: 'HR Manual Entries' },
  { name: 'admin.encashment.view', label: 'Encashment', module: 'HR Manual Entries' },
  { name: 'admin.compOff.view', label: 'Comp Off', module: 'HR Manual Entries' },
  // Separate from .view: seeing the comp-off register is not the same act as
  // issuing the credit that lands in someone's leave balance.
  { name: 'admin.compOff.approve', label: 'Comp Off Approval', module: 'HR Manual Entries' },
  { name: 'admin.incentives.view', label: 'Incentives', module: 'HR Manual Entries' },
  { name: 'admin.loans.view', label: 'Loans', module: 'HR Manual Entries' },

  // Recruitment
  { name: 'recruitment.jobs.view', label: 'Recruitment board', module: 'Recruitment' },
  { name: 'recruitment.internships.view', label: 'Internship', module: 'Recruitment' },
  { name: 'recruitment.interviews.view', label: 'Interview', module: 'Recruitment' },
  { name: 'recruitment.requisition.view', label: 'Man Power Requisition', module: 'Recruitment' },

  // Masters
  { name: 'masters.departments.view', label: 'Departments', module: 'Masters' },
  { name: 'masters.designations.view', label: 'Designations', module: 'Masters' },
  { name: 'masters.roles.view', label: 'Roles', module: 'Masters' },
  { name: 'masters.leaveTypes.view', label: 'Leave Types', module: 'Masters' },
  { name: 'masters.shiftTemplates.view', label: 'Shift Templates', module: 'Masters' },
  { name: 'masters.holidays.view', label: 'Holidays', module: 'Masters' },
  { name: 'masters.incidentCategories.view', label: 'Incident Categories', module: 'Masters' },
  // The matrix screen itself. Whoever holds this can grant anything, so it is
  // deliberately the narrowest grant in the catalog.
  { name: 'masters.permissions.manage', label: 'Role Permissions', module: 'Masters' },
  // Assigns which branches/departments a person's data is limited to. Separate
  // from the key above so "who may narrow an HR to a branch" can be delegated
  // without also handing over the ability to grant every permission.
  { name: 'masters.dataScope.manage', label: 'Data Scope (Branch Access)', module: 'Masters' },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['name'];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_CATALOG.map((p) => p.name);

/** Everything the resolver needs about the signed-in employee. */
export type PermissionContext = {
  roleId: number;
  deptId: number;
  /** `Role.name` exactly as stored — the old navbar compared this raw. */
  roleName: string;
  designation: string;
  departmentName: string;
  empId: number;
};

// ── Legacy allowlist ────────────────────────────────────────────────────────
// Ported from hr-frontend/src/app/shared/access-rules.ts. Employees who get the
// Management Dashboard despite roleId !== 4. In phase 2 this becomes a
// per-employee permission row and this constant goes away.
export const MGMT_DASHBOARD_EMPID_ALLOWLIST: number[] = [4];

/**
 * Port of `Navbar.normalizeRole`. Only EXECUTIVE actually matters to the rules
 * below, but the whole mapping is kept so behaviour is identical for any role
 * name that shows up.
 */
function normalizeRole(raw: string): string {
  const s = (raw || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  const map: Record<string, string> = {
    executive: 'EXECUTIVE',
    executives: 'EXECUTIVE',
    'junior executive': 'JUNIOR_EXECUTIVE',
    'jr executive': 'JUNIOR_EXECUTIVE',
    'jr. executive': 'JUNIOR_EXECUTIVE',
    intern: 'INTERN',
    interns: 'INTERN',
  };
  return map[s] ?? s.toUpperCase().replace(/ /g, '_');
}

/**
 * Resolve the permission keys for one employee.
 *
 * Read the flag block as the legend for the rules underneath — every one of
 * them is a named boolean lifted verbatim from navbar.ts ngOnInit.
 */
export function computePermissions(ctx: PermissionContext): PermissionKey[] {
  const { roleId, deptId, roleName, empId } = ctx;

  const norm = normalizeRole(roleName);
  const departmentName = (ctx.departmentName || '').trim().toLowerCase();
  const designation = (ctx.designation || '').trim().toLowerCase();

  // Executives outside HR (dept 1) are the "restricted" tier.
  const isRestricted = norm === 'EXECUTIVE' && deptId !== 1;
  // NOTE: the old code compared the RAW role string here, not the normalised
  // one, so the exact `Role.name` spelling is load-bearing. Kept as-is.
  const isReportingManager = roleName === 'Reporting Manager';
  const isIncharge = roleId === 5;
  const isHRManager = roleId === 1;
  const isManagement = roleId === 4 || (empId > 0 && MGMT_DASHBOARD_EMPID_ALLOWLIST.includes(empId));

  const inNursing = departmentName === 'nursing';
  const isNurseEducator = inNursing && ['nurse educator', 'nursing educator'].includes(designation);
  const canManageTraining =
    isHRManager || isReportingManager || (isIncharge && inNursing) || isNurseEducator;

  // Section gates. Children below are ANDed with these because a child item was
  // only ever reachable by opening its parent menu.
  const adminSection = !isRestricted && !isNurseEducator;
  const hrManualSection = !isReportingManager && !isIncharge && roleId === 1;
  const recruitSection = !isRestricted;
  const mastersSection = !isRestricted && !isIncharge && !isReportingManager;

  const rules: Record<PermissionKey, boolean> = {
    // Dashboards
    'dashboard.hr.view': !isRestricted && !isReportingManager && !isIncharge,
    'dashboard.management.view': isManagement,
    'dashboard.hrAnalytics.view': isHRManager,

    // Sections
    'admin.section.view': adminSection,
    'hrManual.section.view': hrManualSection,
    'recruitment.section.view': recruitSection,
    'masters.section.view': mastersSection,

    // Administration › Workforce
    'admin.employee.view': adminSection && !isReportingManager && !isIncharge,
    'admin.attendance.view': adminSection && !isRestricted && !isReportingManager && !isIncharge,
    'admin.leave.view': adminSection,

    // Administration › Performance
    // The `weeklyTrackerEnabled` / `payrollEnabled` environment flags are a
    // SEPARATE axis (per-client licensing) and stay in the frontend — the
    // navbar ANDs them with these keys.
    'admin.weeklyTracker.view': adminSection,
    'admin.appraisal.view': adminSection,
    // Nurse Educators have no admin sub-nav at all; Training is their one admin
    // screen and they reach it from a dedicated top-level link. So it must be
    // granted OUTSIDE the section gate.
    'admin.training.view': isNurseEducator || (adminSection && canManageTraining),
    'admin.pip.view': adminSection && !isRestricted && !isIncharge && !isReportingManager,

    // Administration › Compliance
    'admin.resignation.view': adminSection && !isIncharge,
    'admin.incidents.view':
      adminSection && !isIncharge && !(deptId === 1 && roleId === 2) && roleId !== 4,
    'admin.complaints.view': adminSection && !isReportingManager && !isIncharge && roleId !== 4,
    'admin.committees.view': adminSection && isHRManager,

    // Administration › HR Ops
    'admin.incentiveRequests.view': adminSection && !isRestricted && !isIncharge,
    'admin.shifts.view': adminSection && roleId !== 4,
    'admin.otApprovals.view': adminSection && (isReportingManager || isHRManager),
    'admin.reports.view': adminSection && !isRestricted && !isIncharge && !isReportingManager,
    'admin.payroll.view': adminSection && deptId === 1,
    // Tax review and statutory setup are payroll-adjacent: same HR-department
    // gate, so nobody's menu changes for people who already had payroll.
    'admin.taxDeclarations.view': adminSection && deptId === 1,
    'admin.companies.view': adminSection && deptId === 1,
    // Letters and the asset register are HR-ops tools, gated like the rest of
    // the section rather than the narrower payroll/HR-department rule.
    'admin.letters.view': adminSection && !isRestricted && !isIncharge,
    'admin.assets.view': adminSection && !isRestricted && !isIncharge,
    // Sits under /admin/* but is linked from the top-level nav, so no section gate.
    'admin.moduleUtilization.view': isManagement || isHRManager,

    // HR Manual Entries — every item shares the section's rule.
    'admin.forcePresent.view': hrManualSection,
    'admin.hrCorrections.view': hrManualSection,
    'admin.encashment.view': hrManualSection,
    'admin.compOff.view': hrManualSection,
    'admin.compOff.approve': hrManualSection,
    'admin.incentives.view': hrManualSection,
    'admin.loans.view': hrManualSection,

    // Recruitment
    'recruitment.jobs.view': recruitSection && !isReportingManager && !isIncharge,
    'recruitment.internships.view':
      recruitSection && !isReportingManager && !isIncharge && roleId !== 4,
    'recruitment.interviews.view': recruitSection && !isIncharge,
    'recruitment.requisition.view': recruitSection,

    // Masters — every item shares the section's rule.
    'masters.departments.view': mastersSection,
    'masters.designations.view': mastersSection,
    'masters.roles.view': mastersSection,
    'masters.leaveTypes.view': mastersSection,
    'masters.shiftTemplates.view': mastersSection,
    'masters.holidays.view': mastersSection,
    'masters.incidentCategories.view': mastersSection,
    // New in phase 2 — nobody had it before, so seed it to HR Manager only.
    'masters.permissions.manage': mastersSection && isHRManager,
    // Same reasoning: granting a branch scope is an access-control act, so it
    // starts with HR Manager and is widened from the Role Permissions screen.
    'masters.dataScope.manage': mastersSection && isHRManager,
  };

  return PERMISSION_KEYS.filter((k) => rules[k]);
}
