// ─────────────────────────────────────────────────────────────────────────────
//  Letter template tokens.
//
//  A template body carries {{employee.fullName}}-style placeholders that are
//  resolved against the employee, their company and their salary at issue time.
//
//  Two rules that matter:
//    1. An UNKNOWN token is left verbatim rather than blanked. A letter reading
//       "Dear {{employee.nickname}}" is obviously broken and gets fixed; one
//       reading "Dear ," looks deliberate and goes out the door.
//    2. Values are HTML-escaped. A template is authored HTML, but the DATA
//       substituted into it is not — an employee named "A & B" must not break
//       the markup, and a malicious value must not inject tags.
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenDef {
  token: string;
  label: string;
  group: string;
  example: string;
}

/** Catalog surfaced to the template editor so HR can insert tokens by name. */
export const LETTER_TOKENS: TokenDef[] = [
  // Employee
  { token: 'employee.fullName', label: 'Full name', group: 'Employee', example: 'Priya Sharma' },
  { token: 'employee.firstName', label: 'First name', group: 'Employee', example: 'Priya' },
  { token: 'employee.lastName', label: 'Last name', group: 'Employee', example: 'Sharma' },
  { token: 'employee.code', label: 'Employee code', group: 'Employee', example: 'EMP001' },
  { token: 'employee.designation', label: 'Designation', group: 'Employee', example: 'Staff Nurse' },
  { token: 'employee.department', label: 'Department', group: 'Employee', example: 'Nursing' },
  { token: 'employee.branch', label: 'Branch / location', group: 'Employee', example: 'Bangalore' },
  { token: 'employee.email', label: 'Email', group: 'Employee', example: 'priya@example.com' },
  { token: 'employee.phone', label: 'Phone', group: 'Employee', example: '9876543210' },
  { token: 'employee.dateOfJoining', label: 'Date of joining', group: 'Employee', example: '01 Apr 2024' },
  { token: 'employee.pan', label: 'PAN', group: 'Employee', example: 'ABCDE1234F' },
  { token: 'employee.uan', label: 'UAN', group: 'Employee', example: '100000000137' },
  { token: 'employee.dob', label: 'Date of birth', group: 'Employee', example: '15 May 1990' },
  { token: 'employee.fatherName', label: "Father's name", group: 'Employee', example: 'Ramesh Sharma' },
  { token: 'employee.manager', label: 'Reporting manager', group: 'Employee', example: 'Anil Kumar' },
  { token: 'employee.confirmationDate', label: 'Probation end date', group: 'Employee', example: '30 Sep 2024' },

  // Salary
  { token: 'salary.monthlyGross', label: 'Monthly gross', group: 'Salary', example: '₹45,000' },
  { token: 'salary.annualGross', label: 'Annual gross', group: 'Salary', example: '₹5,40,000' },
  { token: 'salary.monthlyCtc', label: 'Monthly CTC', group: 'Salary', example: '₹52,000' },
  { token: 'salary.annualCtc', label: 'Annual CTC', group: 'Salary', example: '₹6,24,000' },
  { token: 'salary.basic', label: 'Basic', group: 'Salary', example: '₹22,500' },
  { token: 'salary.hra', label: 'HRA', group: 'Salary', example: '₹9,000' },
  { token: 'salary.annualCtcWords', label: 'Annual CTC in words', group: 'Salary', example: 'Six Lakh Twenty Four Thousand Rupees Only' },

  // Company
  { token: 'company.name', label: 'Company name', group: 'Company', example: 'Cura Hospitals' },
  { token: 'company.legalName', label: 'Legal name', group: 'Company', example: 'Cura Hospitals Pvt Ltd' },
  { token: 'company.address', label: 'Registered address', group: 'Company', example: 'MG Road, Bangalore' },
  { token: 'company.city', label: 'City', group: 'Company', example: 'Bangalore' },
  { token: 'company.pan', label: 'Company PAN', group: 'Company', example: 'AABCH1234K' },
  { token: 'signatory.name', label: 'Signatory name', group: 'Company', example: 'Sindhuja Reddy' },
  { token: 'signatory.designation', label: 'Signatory designation', group: 'Company', example: 'Head - HR' },

  // Dates
  { token: 'date.today', label: "Today's date", group: 'Date', example: '29 Jul 2026' },
  { token: 'date.todayLong', label: 'Today (long form)', group: 'Date', example: '29 July 2026' },
  { token: 'date.year', label: 'Current year', group: 'Date', example: '2026' },
];

const fmtDate = (d?: Date | null, long = false): string =>
  d
    ? new Date(d).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: long ? 'long' : 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : '';

const fmtINR = (n?: number | null): string =>
  typeof n === 'number' && Number.isFinite(n)
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
    : '';

/** Escape values before substitution — the template is HTML, the data is not. */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface TokenSources {
  employee: any;
  company?: any;
  salary?: any;
  /** Amount-in-words helper, injected to avoid a circular import. */
  amountInWords?: (n: number) => string;
  /** Extra one-off values a caller wants available, e.g. custom.reason. */
  extra?: Record<string, string | number | null | undefined>;
}

/** Build the flat token → value map for one employee. */
export function buildTokenMap(src: TokenSources): Record<string, string> {
  const e = src.employee || {};
  const c = src.company || {};
  const s = src.salary || {};

  const monthlyGross =
    (s.basic || 0) + (s.hra || 0) + (s.medicalAllowance || 0) + (s.travelAllowance || 0) +
    (s.specialAllowance || 0) + (s.otherAllowances || 0);

  // Matches the working-sheet definition: gross + employer PF + the fixed
  // components that are paid in full regardless of LOP.
  const monthlyCtc =
    monthlyGross + (s.pfApplicable ? (s.basic || 0) * 0.12 : 0) +
    (s.lta || 0) + (s.mobileInternet || 0) + (s.mealFuel || 0);

  const now = new Date();

  const map: Record<string, string> = {
    'employee.fullName': `${e.firstName || ''} ${e.lastName || ''}`.trim(),
    'employee.firstName': e.firstName || '',
    'employee.lastName': e.lastName || '',
    'employee.code': e.employeeCode || '',
    'employee.designation': e.designation?.name || '',
    'employee.department': e.Department?.name || '',
    'employee.branch': e.Branch?.name || '',
    'employee.email': e.email || '',
    'employee.phone': e.phone || '',
    'employee.dateOfJoining': fmtDate(e.dateOfJoining),
    'employee.pan': e.panNumber || '',
    'employee.uan': e.uanNumber || '',
    'employee.dob': fmtDate(e.dob),
    'employee.fatherName': e.fatherName || '',
    'employee.manager': e.managerName || '',
    'employee.confirmationDate': fmtDate(e.probationEndDate),

    'salary.monthlyGross': fmtINR(monthlyGross),
    'salary.annualGross': fmtINR(monthlyGross * 12),
    'salary.monthlyCtc': fmtINR(monthlyCtc),
    'salary.annualCtc': fmtINR(monthlyCtc * 12),
    'salary.basic': fmtINR(s.basic),
    'salary.hra': fmtINR(s.hra),
    'salary.annualCtcWords': src.amountInWords ? src.amountInWords(monthlyCtc * 12) : '',

    'company.name': c.name || '',
    'company.legalName': c.legalName || c.name || '',
    'company.address': [c.addressLine1, c.addressLine2, c.city, c.state, c.pincode]
      .filter(Boolean).join(', '),
    'company.city': c.city || '',
    'company.pan': c.pan || '',
    'signatory.name': c.signatoryName || '',
    'signatory.designation': c.signatoryDesignation || '',

    'date.today': fmtDate(now),
    'date.todayLong': fmtDate(now, true),
    'date.year': String(now.getFullYear()),
  };

  for (const [key, value] of Object.entries(src.extra || {})) {
    map[`custom.${key}`] = value == null ? '' : String(value);
  }

  return map;
}

/**
 * Substitute {{token}} placeholders. Whitespace inside the braces is tolerated
 * because editors love to insert it. Unknown tokens are left untouched.
 */
export function renderTokens(template: string, tokens: Record<string, string>): string {
  return String(template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => {
    const value = tokens[key];
    return value === undefined ? whole : escapeHtml(value);
  });
}

/** Tokens present in a template that the catalog does not know about. */
export function findUnknownTokens(template: string, tokens: Record<string, string>): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(template || '')))) {
    if (tokens[m[1]] === undefined && !m[1].startsWith('custom.')) found.add(m[1]);
  }
  return [...found];
}
