/**
 * HRMinds Directory client
 * ==========================
 * Pushes phone-number → tenant entries to the central directory service so the
 * unified mobile app can route users to the correct backend after a phone lookup.
 *
 * The directory is a separate service. Failures here MUST NOT break employee
 * operations — they're logged and reconciled by the nightly cron in
 * `src/schedulers/scheduler.ts`.
 *
 * Required environment variables:
 *   DIRECTORY_URL      e.g. https://hrmindsdirectory.imapps.in
 *   DIRECTORY_API_KEY  the tenant API key issued when this tenant was created
 */

import axios, { AxiosInstance } from 'axios';

const DIRECTORY_URL = process.env.DIRECTORY_URL?.replace(/\/$/, '');
const DIRECTORY_API_KEY = process.env.DIRECTORY_API_KEY;

let client: AxiosInstance | null = null;

function getClient(): AxiosInstance | null {
  if (!DIRECTORY_URL || !DIRECTORY_API_KEY) return null;
  if (!client) {
    client = axios.create({
      baseURL: `${DIRECTORY_URL}/api/directory/sync`,
      headers: { 'x-tenant-key': DIRECTORY_API_KEY },
      timeout: 5000,
    });
  }
  return client;
}

export interface EmployeeForSync {
  phone?: string | null;
  employeeCode?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  isActive?: boolean | null;
}

/**
 * Push a single employee to the directory. Safe to call after create OR update.
 * Silently no-ops if the employee has no phone or directory env vars are missing.
 */
export async function syncEmployeeToDirectory(employee: EmployeeForSync): Promise<void> {
  const c = getClient();
  if (!c) return;
  if (!employee?.phone) return;

  const fullName =
    [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim() || null;

  try {
    await c.post('/upsert', {
      phone: employee.phone,
      employeeCode: employee.employeeCode ?? null,
      fullName,
      isActive: employee.isActive ?? true,
    });
  } catch (err: any) {
    console.error('[directory-sync] upsert failed:', err?.message);
  }
}

/** Bulk push (recommended for nightly cron). */
export async function syncBulkToDirectory(employees: EmployeeForSync[]): Promise<{
  ok: boolean;
  result?: any;
  error?: string;
}> {
  const c = getClient();
  if (!c) return { ok: false, error: 'directory not configured' };

  const entries = employees
    .filter((e) => e.phone)
    .map((e) => ({
      phone: e.phone,
      employeeCode: e.employeeCode ?? null,
      fullName: [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || null,
      isActive: e.isActive ?? true,
    }));

  try {
    const res = await c.post('/bulk', { entries });
    return { ok: true, result: res.data };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'unknown' };
  }
}

/** Mark an employee as inactive in the directory (use when they leave). */
export async function deactivateEmployeeInDirectory(phone: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  if (!phone) return;

  try {
    await c.delete('/entry', { data: { phone } });
  } catch (err: any) {
    console.error('[directory-sync] deactivate failed:', err?.message);
  }
}

/** Self-test: verify the API key works. Useful for /health checks. */
export async function pingDirectory(): Promise<{ ok: boolean; data?: any; error?: string }> {
  const c = getClient();
  if (!c) return { ok: false, error: 'directory not configured' };

  try {
    const res = await c.get('/me');
    return { ok: true, data: res.data };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'unknown' };
  }
}
