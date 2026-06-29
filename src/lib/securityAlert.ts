// Security alerting for the API access log.
//
// Two responsibilities:
//   1. classifyRequest() — pure rules that decide whether a single request is
//      suspicious (used by the accessLogger middleware to set the `suspicious`
//      flag + `reason` on every ApiAccessLog row).
//   2. noteSecurityEvent() + flushSecurityAlerts() — aggregate flagged events
//      in memory and email ONE digest per rule/IP every few minutes, so a burst
//      of 500 bad requests becomes a single alert, not 500 emails.
//
// The aggregation is per-process and in-memory by design: it's a debounce
// buffer, not a store of record (the ApiAccessLog table is the store of record).
// Losing the buffer on restart only means an in-flight digest isn't sent.

import { config } from '../config';
import { sendMail } from './mailer';

export type SecurityRule =
  | 'ANON_SENSITIVE'   // anonymous request to a sensitive route
  | 'AUTH_FAILURE'     // 401 / 403 — token missing/invalid/insufficient
  | 'BRUTE_FORCE'      // many auth failures from one IP in the window
  | 'FILE_PROBE';      // request for a backend file path (.env, .git, dumps…)

/**
 * Paths an attacker scans for to grab backend secrets/source. The server
 * already 404s these (nothing serves them), but a request for one is a strong
 * "someone is probing us" signal worth alerting on. Matched against the path
 * of NON-/api requests by the accessLogger middleware.
 */
const FILE_PROBE_PATTERNS: RegExp[] = [
  /\.env(\.|$|\/)/i,                                  // .env, .env.production, …
  /(^|\/)\.git(\/|$)/i,                               // .git/config, .git/HEAD
  /(^|\/)\.(ssh|aws)(\/|$)/i,                         // .ssh/id_rsa, .aws/credentials
  /(^|\/)id_rsa\b/i,
  /\.(sql|bak|backup|dump|tar|gz|tgz|zip|rar|7z)(\?|$)/i,  // db/backup archives
  /\.(pem|key|crt|cer|p12|pfx)(\?|$)/i,              // keys / certs
  /(^|\/)(config|configuration|secret|secrets|credential|credentials)\.(json|ya?ml|xml|ini|php|js|ts)(\?|$)/i,
  /(^|\/)(wp-admin|wp-login|xmlrpc\.php|phpmyadmin|phpinfo)/i,  // common scanners
  /\.(php|asp|aspx|jsp)(\?|$)/i,                     // no server-side PHP/JSP here = scan
];

/** True if `path` looks like a probe for a backend file / known scanner target. */
export function isFileProbe(path: string): boolean {
  return FILE_PROBE_PATTERNS.some((re) => re.test(path));
}

interface ClassifyInput {
  path: string;
  statusCode: number;
  isAnonymous: boolean;
}

/**
 * Decide whether a single request is suspicious. Pure — no side effects.
 * Returns the list of rules it tripped (empty = not suspicious).
 */
export function classifyRequest({ path, statusCode, isAnonymous }: ClassifyInput): SecurityRule[] {
  const rules: SecurityRule[] = [];

  if (isAnonymous && config.security.sensitivePrefixes.some((p) => path.startsWith(p))) {
    rules.push('ANON_SENSITIVE');
  }
  if (statusCode === 401 || statusCode === 403) {
    rules.push('AUTH_FAILURE');
  }
  return rules;
}

/* ── In-memory aggregation ───────────────────────────────────────────── */

interface Bucket {
  rule: SecurityRule;
  ip: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
  samplePaths: Set<string>;
  sampleUserAgents: Set<string>;
}

// key = `${rule}|${ip}`
const buckets = new Map<string, Bucket>();
// auth-failure counts per IP within the current window (for brute-force).
const authFailByIp = new Map<string, number>();

function bump(rule: SecurityRule, ip: string, path: string, userAgent: string | undefined, when: Date) {
  const key = `${rule}|${ip}`;
  let b = buckets.get(key);
  if (!b) {
    b = { rule, ip, count: 0, firstAt: when, lastAt: when, samplePaths: new Set(), sampleUserAgents: new Set() };
    buckets.set(key, b);
  }
  b.count++;
  b.lastAt = when;
  if (b.samplePaths.size < 8) b.samplePaths.add(path);
  if (userAgent && b.sampleUserAgents.size < 4) b.sampleUserAgents.add(userAgent);
}

/**
 * Record a flagged request into the alert buffer. Called by the middleware
 * only when classifyRequest() returned at least one rule. `when` is passed in
 * (the middleware already has the timestamp) to keep this testable.
 */
export function noteSecurityEvent(args: {
  rules: SecurityRule[];
  ip: string;
  path: string;
  userAgent?: string;
  when: Date;
}) {
  const ip = args.ip || 'unknown';

  for (const rule of args.rules) {
    bump(rule, ip, args.path, args.userAgent, args.when);

    if (rule === 'AUTH_FAILURE') {
      const next = (authFailByIp.get(ip) ?? 0) + 1;
      authFailByIp.set(ip, next);
      // Once an IP crosses the threshold, also record a BRUTE_FORCE bucket so
      // the digest calls it out distinctly from scattered one-off failures.
      if (next === config.security.bruteForceThreshold) {
        bump('BRUTE_FORCE', ip, args.path, args.userAgent, args.when);
      } else if (next > config.security.bruteForceThreshold) {
        const bf = buckets.get(`BRUTE_FORCE|${ip}`);
        if (bf) { bf.count++; bf.lastAt = args.when; }
      }
    }
  }
}

const RULE_LABEL: Record<SecurityRule, string> = {
  ANON_SENSITIVE: 'Anonymous access to sensitive endpoint',
  AUTH_FAILURE: 'Authentication/authorization failure (401/403)',
  BRUTE_FORCE: 'Repeated auth failures from one IP (possible brute force)',
  FILE_PROBE: '⚠ Probe for backend file / secret (.env, .git, dump, …)',
};

/**
 * Flush the buffer: if anything accumulated, send ONE aggregated alert email
 * to config.security.alertEmails and clear the buffer. Safe to call on an
 * empty buffer (no-op). Intended to be invoked by a cron every few minutes.
 */
export async function flushSecurityAlerts(): Promise<{ sent: boolean; events: number }> {
  if (buckets.size === 0) {
    authFailByIp.clear();
    return { sent: false, events: 0 };
  }

  const rows = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  const totalEvents = rows.reduce((n, r) => n + r.count, 0);

  // Build the email body before clearing the buffer.
  const lines = rows.map((r) => {
    const paths = Array.from(r.samplePaths).join(', ');
    const uas = Array.from(r.sampleUserAgents).join(' | ') || '—';
    return [
      `• [${RULE_LABEL[r.rule]}]`,
      `    IP:        ${r.ip}`,
      `    Count:     ${r.count}`,
      `    Window:    ${r.firstAt.toISOString()} → ${r.lastAt.toISOString()}`,
      `    Paths:     ${paths}`,
      `    UserAgent: ${uas}`,
    ].join('\n');
  });

  const htmlRows = rows.map((r) => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #ddd">${RULE_LABEL[r.rule]}</td>
      <td style="padding:6px 10px;border:1px solid #ddd"><code>${r.ip}</code></td>
      <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${r.count}</td>
      <td style="padding:6px 10px;border:1px solid #ddd">${Array.from(r.samplePaths).join('<br/>')}</td>
    </tr>`).join('');

  const text =
    `Security alert — ${config.clientId}\n` +
    `${totalEvents} flagged API request(s) across ${rows.length} IP/rule group(s).\n\n` +
    lines.join('\n\n') +
    `\n\nThese are aggregated; see the ApiAccessLog table for full detail.`;

  const html = `
    <div style="font-family:Arial,sans-serif">
      <h2 style="color:#b00020">🔒 API Security Alert — ${config.clientId}</h2>
      <p><b>${totalEvents}</b> flagged request(s) across <b>${rows.length}</b> IP/rule group(s) in the last window.</p>
      <table style="border-collapse:collapse;font-size:13px">
        <tr style="background:#f3f3f3">
          <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Rule</th>
          <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">IP</th>
          <th style="padding:6px 10px;border:1px solid #ddd;text-align:right">Count</th>
          <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Sample paths</th>
        </tr>
        ${htmlRows}
      </table>
      <p style="color:#666;font-size:12px">Aggregated alert. Full detail is in the <code>ApiAccessLog</code> table.</p>
    </div>`;

  // Clear the buffer now — even if the email fails, we don't want the next
  // window to re-send the same accumulated events forever.
  buckets.clear();
  authFailByIp.clear();

  if (config.security.alertEmails.length === 0) {
    console.warn(`[security] ${totalEvents} flagged request(s) but SECURITY_ALERT_EMAILS is empty — not emailing.`);
    return { sent: false, events: totalEvents };
  }

  try {
    await sendMail({
      to: config.security.alertEmails,
      subject: `🔒 [${config.clientId}] API security alert — ${totalEvents} flagged request(s)`,
      text,
      html,
    });
    return { sent: true, events: totalEvents };
  } catch (e) {
    console.error('[security] failed to send alert email:', e);
    return { sent: false, events: totalEvents };
  }
}
