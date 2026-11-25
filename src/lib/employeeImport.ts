/**
 * Employee bulk import — pure row validation (no DB access).
 *
 * The controller loads the master lists (departments, branches, roles,
 * designations, existing employee codes) once, then runs every sheet row
 * through `validateEmployeeImportRow`. Keeping this free of Prisma calls lets
 * `scripts/verify-employee-import.ts` exercise it without a database.
 */
import { $Enums } from "@prisma/client";

/** Header row of the import sheet, in template order. Names are case-sensitive. */
export const EMPLOYEE_IMPORT_COLUMNS = [
  "employeeCode",
  "referenceCode",
  "firstName",
  "lastName",
  "gender",
  "dob",
  "dateOfJoining",
  "departmentName",
  "branchName",
  "roleName",
  "designationName",
  "reportingManagerCode",
  "employmentType",
  "employmentStatus",
  "employeeType",
  "bloodGroup",
  "phone",
  "email",
] as const;

const GENDERS = Object.values($Enums.Gender) as string[];
const EMPLOYMENT_TYPES = Object.values($Enums.EmploymentType) as string[];
const EMPLOYMENT_STATUSES = Object.values($Enums.EmploymentStatus) as string[];
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

/** Master data keyed by lower-cased, trimmed name → id. */
export interface ImportLookups {
  departments: Map<string, number>;
  branches: Map<string, number>;
  roles: Map<string, number>;
  designations: Map<string, number>;
  /** Upper-cased employee codes already in the DB. */
  existingCodes: Set<string>;
}

export interface ValidatedImportRow {
  data: {
    employeeCode: string;
    referenceCode: string | null;
    firstName: string;
    lastName: string;
    gender: $Enums.Gender;
    dob: Date;
    dateOfJoining: Date;
    phone: string;
    email: string;
    employmentType: $Enums.EmploymentType;
    employmentStatus: $Enums.EmploymentStatus;
    employeeType: string;
    bloodGroup: string | null;
    departmentId: number;
    branchId: number;
    roleId: number;
    designationId: number;
  };
  /** Resolved after all rows are saved, so a manager in the same file is found. */
  managerCode: string | null;
}

/** Trim, drop non-breaking spaces; returns "" for null/undefined. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/ /g, " ").trim();
}

export function normalizeCode(value: unknown): string {
  return cellText(value).toUpperCase();
}

/** Blank or "0" means no manager. */
export function normalizeManagerCode(value: unknown): string | null {
  const c = normalizeCode(value);
  return !c || c === "0" ? null : c;
}

function utcDate(y: number, m: number, d: number): Date | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Reject roll-overs such as 31-02-2026.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

/**
 * Accepts an Excel date serial, YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY.
 * Anything else returns null rather than guessing month/day order.
 */
export function parseImportDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + Math.floor(value) * 86400000);
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  const s = cellText(value);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return utcDate(+m[1], +m[2], +m[3]);

  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (m) return utcDate(+m[3], +m[2], +m[1]);

  return null;
}

function normalizeGender(value: unknown): $Enums.Gender {
  const v = cellText(value).toUpperCase();
  const short: Record<string, string> = { M: "MALE", F: "FEMALE", O: "OTHER" };
  const g = short[v] ?? v;
  if (!GENDERS.includes(g)) throw new Error(`Invalid gender "${cellText(value)}" (use ${GENDERS.join(" / ")})`);
  return g as $Enums.Gender;
}

function normalizeEnum<T extends string>(value: unknown, allowed: string[], label: string): T {
  const v = cellText(value).toUpperCase().replace(/\s+/g, "_");
  if (!v) throw new Error(`${label} is required`);
  if (!allowed.includes(v)) throw new Error(`Invalid ${label} "${cellText(value)}" (use ${allowed.join(" / ")})`);
  return v as T;
}

function lookupId(map: Map<string, number>, value: unknown, label: string): number {
  const name = cellText(value);
  if (!name) throw new Error(`${label} is required`);
  const id = map.get(name.toLowerCase());
  if (id === undefined) {
    throw new Error(`${label} "${name}" does not exist — add it in Masters first or fix the spelling`);
  }
  return id;
}

function required(row: Record<string, unknown>, key: string, label: string): string {
  const v = cellText(row[key]);
  if (!v) throw new Error(`${label} is required`);
  return v;
}

/**
 * Validates one sheet row. Throws an Error whose message lists every problem
 * found in the row, so HR can fix them in one pass.
 */
export function validateEmployeeImportRow(
  row: Record<string, unknown>,
  lookups: ImportLookups
): ValidatedImportRow {
  const problems: string[] = [];
  const attempt = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (e: any) {
      problems.push(e.message);
      return undefined;
    }
  };

  const employeeCode = normalizeCode(row.employeeCode);
  if (!employeeCode) problems.push("employeeCode is required");
  else if (lookups.existingCodes.has(employeeCode)) problems.push(`employeeCode ${employeeCode} already exists`);

  const firstName = attempt(() => required(row, "firstName", "firstName"));
  const lastName = attempt(() => required(row, "lastName", "lastName"));
  const gender = attempt(() => normalizeGender(row.gender));

  const dob = parseImportDate(row.dob);
  if (!dob) problems.push(`Invalid dob "${cellText(row.dob)}" (use YYYY-MM-DD)`);
  const dateOfJoining = parseImportDate(row.dateOfJoining);
  if (!dateOfJoining) problems.push(`Invalid dateOfJoining "${cellText(row.dateOfJoining)}" (use YYYY-MM-DD)`);

  const departmentId = attempt(() => lookupId(lookups.departments, row.departmentName, "Department"));
  const branchId = attempt(() => lookupId(lookups.branches, row.branchName, "Branch"));
  const roleId = attempt(() => lookupId(lookups.roles, row.roleName, "Role"));
  const designationId = attempt(() => lookupId(lookups.designations, row.designationName, "Designation"));

  const employmentType = attempt(() =>
    normalizeEnum<$Enums.EmploymentType>(row.employmentType, EMPLOYMENT_TYPES, "employmentType")
  );
  const employmentStatus = attempt(() =>
    normalizeEnum<$Enums.EmploymentStatus>(row.employmentStatus, EMPLOYMENT_STATUSES, "employmentStatus")
  );

  const phone = attempt(() => required(row, "phone", "phone"));
  const email = attempt(() => required(row, "email", "email"));
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`Invalid email "${email}"`);

  let bloodGroup: string | null = null;
  const bg = cellText(row.bloodGroup).toUpperCase().replace(/\s+/g, "");
  if (bg) {
    if (BLOOD_GROUPS.includes(bg)) bloodGroup = bg;
    else problems.push(`Invalid bloodGroup "${cellText(row.bloodGroup)}" (use ${BLOOD_GROUPS.join(" / ")})`);
  }

  const managerCode = normalizeManagerCode(row.reportingManagerCode);
  if (managerCode && managerCode === employeeCode) problems.push("reportingManagerCode cannot be the employee's own code");

  if (problems.length) throw new Error(problems.join("; "));

  return {
    data: {
      employeeCode,
      referenceCode: cellText(row.referenceCode) || null,
      firstName: firstName!,
      lastName: lastName!,
      gender: gender!,
      dob: dob!,
      dateOfJoining: dateOfJoining!,
      phone: phone!,
      email: email!,
      employmentType: employmentType!,
      employmentStatus: employmentStatus!,
      employeeType: cellText(row.employeeType) || "CLINICAL",
      bloodGroup,
      departmentId: departmentId!,
      branchId: branchId!,
      roleId: roleId!,
      designationId: designationId!,
    },
    managerCode,
  };
}
