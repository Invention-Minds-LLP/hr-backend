export interface AppraisalUser { role: string; empId: number; deptId: number; }

export function getAppraisalAccess(user: AppraisalUser, appraisal: {
  employeeId: number; managerId: number | null; inchargeId: number | null;
  employee: { reportingManager: number | null; inchargeId: number | null; departmentId: number | null };
}) {
  const { role, empId, deptId } = user;
  const isHRManager = role === "HR Manager" || role === "HR";
  const isManagement = role === "Management";
  const isReportingManager = role === "Reporting Manager";
  const isHRExecutive = deptId === 1 && !isHRManager && !isManagement && !isReportingManager;
  const isOwn = appraisal.employeeId === empId;

  const involved =
    isOwn ||
    appraisal.managerId === empId ||
    appraisal.inchargeId === empId ||
    appraisal.employee.inchargeId === empId;

  let canAccess: boolean;
  if (isHRManager || isManagement) canAccess = true;
  else if (isHRExecutive) canAccess = appraisal.employee.departmentId !== 1 || isOwn;
  else if (isReportingManager) canAccess = involved || appraisal.employee.reportingManager === empId;
  else canAccess = involved;

  const canViewScores =
    isHRManager || isManagement ||
    (isHRExecutive && !isOwn) ||
    (isReportingManager && !isOwn);

  return { canAccess, canViewScores };
}