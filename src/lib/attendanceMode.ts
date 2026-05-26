import { AttendanceMode } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Resolve an employee's EFFECTIVE attendance mode.
 *
 * Precedence: employee.attendanceMode (per-employee override) ?? the employee's
 * Branch.attendanceMode ?? 'MOBILE'. A null employee value means "inherit branch".
 */
export function resolveAttendanceMode(input: {
  attendanceMode?: AttendanceMode | null;
  Branch?: { attendanceMode?: AttendanceMode | null } | null;
}): AttendanceMode {
  return input.attendanceMode ?? input.Branch?.attendanceMode ?? AttendanceMode.MOBILE;
}

/** Fetch an employee + branch mode and return the effective attendance mode. */
export async function getEffectiveAttendanceMode(employeeId: number): Promise<AttendanceMode> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { attendanceMode: true, Branch: { select: { attendanceMode: true } } },
  });
  if (!employee) return AttendanceMode.MOBILE;
  return resolveAttendanceMode(employee);
}
