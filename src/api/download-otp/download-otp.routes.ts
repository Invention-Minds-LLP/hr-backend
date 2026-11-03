import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { authenticateToken, AuthenticatedRequest } from '../../middleware/authMiddleware';
import {
  MAX_REASON,
  MIN_REASON,
  SecurityError,
  buildDownloadCode,
  createCaptcha,
  downloadStampText,
  isValidDownloadGrant,
  maskEmail,
  sendEmailOtp,
  signDownloadGrant,
  signDownloadTicket,
  verifyCaptcha,
  verifyEmailOtp,
} from '../../lib/accountSecurity';

/**
 * DPDP download gate. Flow, per browser session:
 *   POST /request   → 6-digit OTP to the employee's email
 *   POST /verify    → OTP for a 60-minute download grant (X-Download-Grant)
 * then for EVERY download:
 *   GET  /captcha   → picture captcha
 *   POST /authorize → captcha + reason → DownloadLog row + one-time ticket
 *                     (X-Download-Ticket) consumed by requireDownloadGrant.
 */
const router = Router();
router.use(authenticateToken);

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<void>;
const handle = (fn: Handler) => async (req: AuthenticatedRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof SecurityError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    console.error('[download-otp]', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

/** Employee-backed web sessions only (candidate tokens carry no userId). */
function sessionUserId(req: AuthenticatedRequest): number {
  const userId = Number(req.user?.userId ?? 0);
  if (!userId) throw new SecurityError(403, 'Downloads need an employee login.');
  return userId;
}

router.post('/request', handle(async (req, res) => {
  const userId = sessionUserId(req);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, employee: { select: { email: true } } },
  });
  const email = user?.employee?.email?.trim();
  if (!user || !email) {
    throw new SecurityError(409, 'No email address on your employee record. Please ask HR to add one before downloading.');
  }
  const { expiresAt } = await sendEmailOtp(user.id, 'download', email);
  res.status(200).json({ sentTo: maskEmail(email), expiresAt });
}));

router.post('/verify', handle(async (req, res) => {
  const userId = sessionUserId(req);
  await verifyEmailOtp(userId, 'download', req.body?.otp);
  res.status(200).json(signDownloadGrant(userId));
}));

router.get('/captcha', handle(async (req, res) => {
  res.status(200).json(await createCaptcha(sessionUserId(req)));
}));

router.post('/authorize', handle(async (req, res) => {
  const userId = sessionUserId(req);
  if (!isValidDownloadGrant(req.headers['x-download-grant'], userId)) {
    throw new SecurityError(428, 'Email OTP verification is required to download.');
  }
  verifyCaptcha(req.body?.captchaId, req.body?.captchaAnswer, userId);

  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < MIN_REASON) throw new SecurityError(400, `Please enter a reason (at least ${MIN_REASON} characters).`);
  const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 191) : '';
  const page = typeof req.body?.page === 'string' ? req.body.page.slice(0, 191) : null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      employeeCode: true,
      role: true,
      employee: { select: { role: { select: { name: true } }, Department: { select: { name: true } } } },
    },
  });
  if (!user) throw new SecurityError(401, 'Your session has expired. Please log in again.');

  const xfwd = (req.headers['x-forwarded-for'] as string) || '';
  const ip = (xfwd.split(',')[0] || req.ip || req.socket?.remoteAddress || '').trim();

  // Download ID for the file footer: employee + IST date-time + this
  // employee's running download count. Two downloads by the same person in the
  // same second race for one count; the unique index catches that and we
  // recount once.
  let log: { id: string; downloadCode: string | null; createdAt: Date } | null = null;
  for (let attempt = 0; attempt < 3 && !log; attempt++) {
    const now = new Date();
    const count = (await prisma.downloadLog.count({ where: { userId } })) + 1 + attempt;
    try {
      log = await prisma.downloadLog.create({
        data: {
          downloadCode: buildDownloadCode(user.employeeCode, now, count),
          userId,
          employeeCode: user.employeeCode,
          username: user.username,
          role: user.employee?.role?.name ?? user.role,
          departmentName: user.employee?.Department?.name ?? null,
          label: label || 'Unlabelled download',
          page,
          reason: reason.slice(0, MAX_REASON),
          ip: ip.slice(0, 64) || null,
          userAgent: String(req.headers['user-agent'] || '').slice(0, 1000) || null,
          createdAt: now,
        },
        select: { id: true, downloadCode: true, createdAt: true },
      });
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e; // only retry the unique-code collision
    }
  }
  if (!log?.downloadCode) throw new SecurityError(409, 'Could not record this download. Please try again.');

  res.status(200).json({
    logId: log.id,
    ticket: signDownloadTicket(userId, log.id),
    downloadCode: log.downloadCode,
    // Browser-built exports (Excel / CSV / print) put this line in their footer.
    stamp: downloadStampText({ downloadCode: log.downloadCode, username: user.username, employeeCode: user.employeeCode, createdAt: log.createdAt }),
  });
}));

// Audit trail viewer — HR department and Management only.
router.get('/logs', handle(async (req, res) => {
  const deptId = Number(req.user?.deptId ?? 0);
  const roleId = Number(req.user?.roleId ?? 0);
  if (deptId !== config.recruiting.hrDepartmentId && !config.security.mfaRoleIds.includes(roleId)) {
    throw new SecurityError(403, 'Forbidden');
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const from = typeof req.query.from === 'string' && req.query.from ? new Date(`${req.query.from}T00:00:00`) : null;
  const to = typeof req.query.to === 'string' && req.query.to ? new Date(`${req.query.to}T23:59:59.999`) : null;

  const where: any = {};
  if (search) {
    where.OR = [
      { downloadCode: { contains: search } },
      { username: { contains: search } },
      { employeeCode: { contains: search } },
      { label: { contains: search } },
      { reason: { contains: search } },
    ];
  }
  if ((from && !isNaN(from.getTime())) || (to && !isNaN(to.getTime()))) {
    where.createdAt = {};
    if (from && !isNaN(from.getTime())) where.createdAt.gte = from;
    if (to && !isNaN(to.getTime())) where.createdAt.lte = to;
  }

  const [data, total] = await Promise.all([
    prisma.downloadLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, downloadCode: true, employeeCode: true, username: true, role: true, departmentName: true, label: true,
        page: true, reason: true, ip: true, serverRoute: true, servedAt: true, createdAt: true,
      },
    }),
    prisma.downloadLog.count({ where }),
  ]);
  res.status(200).json({ data, total, page, pageSize });
}));

export default router;
