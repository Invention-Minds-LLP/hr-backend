import { NextFunction, Response } from 'express';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { AuthenticatedRequest } from './authMiddleware';
import { isValidDownloadGrant, readDownloadTicket } from '../lib/accountSecurity';

/**
 * Gate for server file routes (PDF / Excel / CSV). Use AFTER authenticateToken.
 * Needs the 60-minute email-OTP grant AND a one-time ticket from
 * /api/download-otp/authorize (captcha + reason). Consuming the ticket stamps
 * the DownloadLog row with servedAt + the route that served it.
 *
 * Candidate-portal tokens (their own offer letter) pass through: they are not
 * employee sessions and the route's own checks scope them to their own file.
 */
export const requireDownloadGrant = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!config.security.downloadGateEnabled) return next();
  if (req.user?.role === 'candidate' && req.user?.candidateId && !req.user?.empId) return next();

  const userId = Number(req.user?.userId ?? 0);
  if (!userId || !isValidDownloadGrant(req.headers['x-download-grant'], userId)) {
    res.status(428).json({ error: 'Email OTP verification is required to download.', code: 'DOWNLOAD_OTP_REQUIRED' });
    return;
  }
  try {
    const logId = readDownloadTicket(req.headers['x-download-ticket'], userId);
    const consumed = logId
      ? await prisma.downloadLog.updateMany({
          where: { id: logId, userId, servedAt: null },
          data: { servedAt: new Date(), serverRoute: req.originalUrl.slice(0, 1000) },
        })
      : { count: 0 };
    if (consumed.count !== 1) {
      res.status(428).json({ error: 'Please complete the captcha and reason for this download.', code: 'DOWNLOAD_REASON_REQUIRED' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};
