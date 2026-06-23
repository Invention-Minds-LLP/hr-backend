// ─────────────────────────────────────────────────────────────────────────────
//  Central application config
//
//  The ONE place that reads process.env. Every other file should import from
//  here (`import { config } from "../config"`) instead of touching process.env
//  directly. This gives us:
//    • a single source of truth for what a client deployment can configure,
//    • startup validation (an incomplete client .env fails fast at boot, not
//      deep inside a request weeks later),
//    • no more silently-undefined values or drifting duplicate keys.
//
//  Per-client behaviour is driven entirely by that client's .env file. The same
//  code ships to every client; only the .env differs. CLIENT_ID labels which
//  client a given deployment is (used in logs and the rare client-specific
//  branch).
//
//  IMPORTANT: this module must be imported AFTER dotenv has populated
//  process.env. index.ts loads "dotenv/config" on its first line, so importing
//  config anywhere downstream of that is safe.
// ─────────────────────────────────────────────────────────────────────────────

// Collects problems found while building the config so we can report them all
// at once at startup, rather than failing on the first missing key.
const missingRequired: string[] = [];
const missingRecommended: string[] = [];

/** Required: app refuses to start if unset. */
function required(key: string): string {
  const val = process.env[key];
  if (!val || !val.trim()) {
    missingRequired.push(key);
    return "";
  }
  return val;
}

/**
 * Recommended: app starts, but logs a warning at boot. Use for values a
 * feature needs (SMTP, FTP, SMS…) — the feature breaks if unset, but unrelated
 * parts of the app should still run.
 */
function recommended(key: string, fallback = ""): string {
  const val = process.env[key];
  if (!val || !val.trim()) {
    missingRecommended.push(key);
    return fallback;
  }
  return val;
}

/** Optional: silent. Returns the value or the given default. */
function optional(key: string, fallback = ""): string {
  const val = process.env[key];
  return val && val.trim() ? val : fallback;
}

/** Reads the first of several keys that holds a value. For duplicate keys we
 *  are collapsing (e.g. FTP_PASS / FTP_PASSWORD) so callers can't drift. */
function firstOf(keys: string[], fallback = ""): string {
  for (const key of keys) {
    const val = process.env[key];
    if (val && val.trim()) return val;
  }
  return fallback;
}

function bool(key: string, fallback = false): boolean {
  const val = process.env[key];
  if (val === undefined || !val.trim()) return fallback;
  return val.trim().toLowerCase() === "true";
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || !raw.trim()) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Comma-separated list. Returns the parsed, trimmed entries, or `fallback`
 *  (the previous hardcoded array) when the key is unset. */
function list(key: string, fallback: string[]): string[] {
  const raw = process.env[key];
  if (raw === undefined || !raw.trim()) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  // ── Identity ──────────────────────────────────────────────────────────────
  // Which client this deployment serves. Set CLIENT_ID=IM, CLIENT_ID=ABC, etc.
  // in each client's .env. Shows up in logs and is the hook for any rare
  // client-specific branch: `if (config.clientId === "IM") { … }`.
  clientId: required("CLIENT_ID"),

  // ── Runtime ───────────────────────────────────────────────────────────────
  nodeEnv: optional("NODE_ENV", "development"),
  // App listens on a fixed 3002 today (see index.ts). Kept here so it can be
  // made env-driven later without hunting for the literal.
  port: int("PORT", 3002),
  appPublicUrl: optional("APP_PUBLIC_URL"),
  publicBaseUrl: optional("PUBLIC_BASE_URL"),
  candidatePortalUrl: optional("CANDIDATE_PORTAL_URL"),
  // Directory on the server's disk where uploaded files are stored. Empty =
  // <cwd>/uploads (see src/lib/fileStorage.ts). In Docker set to the mounted
  // volume path, e.g. /usr/src/app/uploads.
  uploadsDir: optional("UPLOADS_DIR"),

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Allowed browser origins. Default is the previous hardcoded list (dev +
  // both clients' production domains) so behaviour is unchanged. Per client,
  // override with a comma-separated CORS_ALLOWED_ORIGINS in the .env to list
  // only that client's own domains.
  cors: {
    allowedOrigins: list("CORS_ALLOWED_ORIGINS", [
      "http://localhost:4300", // Angular web
      "http://192.168.3.25:4300", // LAN testing
      "https://demo.hrproindia.in",
      "http://localhost", // Capacitor Android
      "https://localhost",
      "capacitor://localhost", // Capacitor iOS
      "http://localhost:8100",
      "http://localhost:8101",
      "https://hrminds.imapps.in",
      "https://hrmindsjmrh.imapps.in",
      "http://localhost:4200",
      "https://rashtrotthanahospital.com",
      "http://192.168.8.189:4300",
      "https://www.rashtrotthanahospital.com",
    ]),
  },

  // ── Auth / DB ─────────────────────────────────────────────────────────────
  jwtSecret: required("JWT_SECRET"),
  databaseUrl: required("DATABASE_URL"),

  // ── SMTP (email / OTP) ────────────────────────────────────────────────────
  // host/port/secure were hardcoded to Gmail in sendEmailOtp.ts. Surfaced here
  // so a client on Hostinger/other SMTP is just a .env change.
  smtp: {
    host: optional("SMTP_HOST", "smtp.gmail.com"),
    port: int("SMTP_PORT", 587),
    secure: bool("SMTP_SECURE", false),
    user: recommended("SMTP_USER"),
    pass: recommended("SMTP_PASS"),
    // Address emails are sent "from". Falls back to SMTP_USER (current behaviour).
    from: optional("SMTP_FROM") || optional("SMTP_USER"),
  },

  // ── FTP (file storage) ────────────────────────────────────────────────────
  // FTP_PASS and FTP_PASSWORD both existed in the wild and had to be "kept in
  // sync" by hand. Collapsed to one value here — set either key, callers read
  // config.ftp.pass.
  ftp: {
    host: recommended("FTP_HOST"),
    user: recommended("FTP_USER"),
    pass: firstOf(["FTP_PASS", "FTP_PASSWORD"]),
    secure: bool("FTP_SECURE", false),
    publicDir: optional("FTP_PUBLIC_DIR"),
  },

  // ── SMS (OTP / notifications) ─────────────────────────────────────────────
  sms: {
    apiKey: recommended("SMS_API_KEY"),
    apiUrl: recommended("SMS_API_URL"),
    sender: optional("SMS_SENDER"),
    dltTeIdForOtp: optional("SMS_DLT_TE_ID_FOR_OTP"),
    dltEntityId: optional("DLT_ENTITY_ID"),
  },

  // ── WhatsApp (leave notifications) ────────────────────────────────────────
  whatsapp: {
    fromPhoneNumber: optional("WHATSAPP_FROM_PHONE_NUMBER"),
    authToken: optional("WHATSAPP_AUTH_TOKEN"),
    apiUrl: optional("WHATSAPP_API_URL"),
    // Registered WhatsApp template id for the mobile-login OTP (IM only).
    otpTemplateId: optional("WHATSAPP_OTP_TEMPLATE_ID"),
  },

  // ── Biometric device (COSEC) ──────────────────────────────────────────────
  // Was hardcoded in biometric.controller.ts. Each client's device has its own
  // LAN IP + credentials, so this MUST be per-client config.
  cosec: {
    baseUrl: optional("COSEC_BASE_URL", "http://192.168.14.114:83/COSEC/api.svc/v2"),
    username: optional("COSEC_USERNAME", "api"),
    password: optional("COSEC_PASSWORD", "Api@123"),
  },

  // ── Directory sync ────────────────────────────────────────────────────────
  directory: {
    url: optional("DIRECTORY_URL"),
    apiKey: optional("DIRECTORY_API_KEY"),
    syncCron: optional("DIRECTORY_SYNC_CRON"),
  },

  // ── Branding (letters, offer/PIP docs, emails) ────────────────────────────
  branding: {
    companyName: optional("COMPANY_NAME"),
    companyAddress: optional("COMPANY_ADDRESS"),
    companyLogoUrl: optional("COMPANY_LOGO_URL"),
    companyTagline: optional("COMPANY_TAGLINE"),
    hospitalName: optional("HOSPITAL_NAME"),
    hospitalAddress: optional("HOSPITAL_ADDRESS"),
    hospitalGoogleMap: optional("HOSPITAL_GOOGLE_MAP"),
    hrSignatoryName: optional("HR_SIGNATORY_NAME"),
    hrSignatoryTitle: optional("HR_SIGNATORY_TITLE"),
    mobileClientName: optional("MOBILE_CLIENT_NAME"),
  },

  // ── Recruiting defaults ───────────────────────────────────────────────────
  recruiting: {
    // Numeric IDs of seed records; defaults match the previous hardcoded fallbacks.
    hrDepartmentId: int("HR_DEPARTMENT_ID", 1),
    defaultBranchId: int("DEFAULT_BRANCH_ID", 1),
    defaultEmployeeRoleId: int("DEFAULT_EMPLOYEE_ROLE_ID", 3),
    defaultHrRoleId: int("DEFAULT_HR_ROLE_ID", 1),
    // Defaults match the previous call-site fallbacks (7 / 80 / 8 / 90).
    staleDays: int("RECRUIT_STALE_DAYS", 7),
    hotTestScore: int("RECRUIT_HOT_TEST_SCORE", 80),
    hotInterviewAvg: int("RECRUIT_HOT_INTERVIEW_AVG", 8),
    referralProbationDays: int("REFERRAL_PROBATION_DAYS", 90),
  },

  // ── Employee code generation ──────────────────────────────────────────────
  // Kept as raw strings: callers apply their own defaults ('EMP' / '001' / '1')
  // and coercion, which differ between the employee and recruiting flows.
  employeeCode: {
    prefix: optional("EMPLOYEE_CODE_PREFIX"),
    start: optional("EMPLOYEE_CODE_START"),
  },

  // ── Leave ─────────────────────────────────────────────────────────────────
  leave: {
    balanceStartMode: optional("LEAVE_BALANCE_START_MODE"),
  },

  // ── Management dashboard "attention" thresholds ───────────────────────────
  // Defaults match the previous call-site fallbacks in management.controller.
  attn: {
    attendanceRed: int("ATTN_ATTENDANCE_RED", 80),
    attendanceYellow: int("ATTN_ATTENDANCE_YELLOW", 90),
    pendingLeaves: int("ATTN_PENDING_LEAVES", 20),
    pendingPerms: int("ATTN_PENDING_PERMS", 20),
    pipRed: int("ATTN_PIP_RED", 5),
    pipYellow: int("ATTN_PIP_YELLOW", 2),
    attritionRed: int("ATTN_ATTRITION_RED", 5),
    attritionYellow: int("ATTN_ATTRITION_YELLOW", 2),
    otPending: int("ATTN_OT_PENDING", 30),
    openJobs: int("ATTN_OPEN_JOBS", 10),
    trainingRed: int("ATTN_TRAINING_RED", 50),
    trainingYellow: int("ATTN_TRAINING_YELLOW", 70),
  },

  // ── Google Play review bypass (mobile auth) ───────────────────────────────
  playReview: {
    mode: bool("PLAY_REVIEW_MODE", false),
    phone: optional("PLAY_REVIEW_PHONE"),
  },

  // ── Feature flags ─────────────────────────────────────────────────────────
  // Per-client on/off switches for *the same* feature (vs. config values above).
  // Add booleans here as features start to differ between clients, e.g.
  //   useWhatsappOtp: bool("FLAG_USE_WHATSAPP_OTP", false),
  flags: {
    // Mobile-login OTP delivery channel, per client by which provider they own:
    // "whatsapp" (IM — uses config.whatsapp.* + otpTemplateId) or
    // "sms" (JMRH — uses config.sms.*). Default "sms".
    otpChannel: optional("OTP_CHANNEL", "sms"),
    // Skip the phone-OTP step in mobile login. When true (IM), the flow goes
    // phone → identity confirmation → email OTP, with no phone OTP sent.
    // Default false (JMRH keeps phone OTP).
    skipPhoneOtp: bool("MOBILE_SKIP_PHONE_OTP", false),
  },
} as const;

/**
 * Validate config at startup. Call once, early in index.ts (after dotenv).
 * Throws if any REQUIRED key is missing — the process should not start a
 * deployment whose .env is missing JWT_SECRET / DATABASE_URL / CLIENT_ID.
 * Logs a warning (does not throw) for recommended-but-missing keys.
 */
export function validateConfig(): void {
  if (missingRecommended.length) {
    console.warn(
      `⚠️  [config] Recommended env vars not set (related features will fail): ${missingRecommended.join(", ")}`
    );
  }
  if (missingRequired.length) {
    throw new Error(
      `[config] Missing REQUIRED env vars: ${missingRequired.join(", ")}. ` +
        `Set them in this client's .env (see .env.example) before starting.`
    );
  }
  console.log(`✅ [config] Loaded for client "${config.clientId}" (env: ${config.nodeEnv})`);
}
