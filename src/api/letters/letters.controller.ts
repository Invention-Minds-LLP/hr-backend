// ─────────────────────────────────────────────────────────────────────────────
//  Letter generation — templates, preview, issue, email, history.
//
//  Replaces the single hardcoded offer letter with templates HR can author.
//  The important design point is in the issue path: LetterIssued stores the
//  RENDERED html, not a reference to the template. Editing a template next year
//  must not retroactively change a letter already signed and handed over.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';
import { currentEmployeeId } from '../../lib/currentUser';
import { resolveCompanyId, coerceCompanyId } from '../../lib/company';
import { sendMail } from '../../lib/mailer';
import { renderHtmlToPdf, htmlToPlainText } from '../../lib/htmlPdf';
import {
  LETTER_TOKENS, buildTokenMap, renderTokens, findUnknownTokens,
} from '../../lib/letterTokens';
import { amountInWords } from '../payroll/payslipPdf';

const CATEGORIES = [
  'OFFER', 'CONFIRMATION', 'EXPERIENCE', 'RELIEVING', 'APPRECIATION',
  'WARNING', 'INCREMENT', 'TRANSFER', 'CUSTOM',
];

// ─── templates ───────────────────────────────────────────────────────────────

export const listTemplates = async (req: Request, res: Response) => {
  try {
    const { category, includeInactive } = req.query as any;
    const templates = await (prisma as any).letterTemplate.findMany({
      where: {
        ...(category ? { category: String(category).toUpperCase() } : {}),
        ...(includeInactive === 'true' ? {} : { isActive: true }),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { issued: true } } },
    });

    res.json(templates.map((t: any) => ({
      ...t,
      preview: htmlToPlainText(t.bodyHtml).slice(0, 160),
    })));
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getTemplate = async (req: Request, res: Response) => {
  try {
    const template = await (prisma as any).letterTemplate.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!template) return res.status(404).json({ message: 'Template not found' });
    res.json(template);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const upsertTemplate = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id ? Number(req.params.id) : null;
    const {
      name, category, subject, bodyHtml, headerHtml, footerHtml,
      includeSignature, isActive, companyId: rawCompanyId,
    } = req.body;

    if (!name?.trim())    return res.status(400).json({ message: 'Template name is required' });
    if (!subject?.trim()) return res.status(400).json({ message: 'Subject is required' });
    if (!bodyHtml?.trim()) return res.status(400).json({ message: 'Letter body is required' });

    const resolvedCategory = String(category || 'CUSTOM').toUpperCase();
    if (!CATEGORIES.includes(resolvedCategory)) {
      return res.status(400).json({ message: `category must be one of ${CATEGORIES.join(', ')}` });
    }

    const data = {
      name: name.trim(),
      category: resolvedCategory,
      subject: subject.trim(),
      bodyHtml,
      headerHtml: headerHtml || null,
      footerHtml: footerHtml || null,
      includeSignature: includeSignature !== false,
      isActive: isActive !== false,
      companyId: await coerceCompanyId(rawCompanyId),
    };

    const template = id
      ? await (prisma as any).letterTemplate.update({ where: { id }, data })
      : await (prisma as any).letterTemplate.create({
          data: { ...data, createdBy: currentEmployeeId(req) },
        });

    res.status(id ? 200 : 201).json(template);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** Soft delete — a template with issued letters must stay referenceable. */
export const deleteTemplate = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const issuedCount = await (prisma as any).letterIssued.count({ where: { templateId: id } });

    if (issuedCount > 0) {
      const template = await (prisma as any).letterTemplate.update({
        where: { id },
        data: { isActive: false },
      });
      return res.json({
        message: `Template deactivated — ${issuedCount} issued letter(s) still reference it, so it cannot be deleted outright.`,
        template,
      });
    }

    await (prisma as any).letterTemplate.delete({ where: { id } });
    res.json({ message: 'Template deleted' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getTokens = (_req: Request, res: Response) => {
  res.json({
    tokens: LETTER_TOKENS,
    categories: CATEGORIES,
    note:
      'Insert a token as {{group.name}} — for example {{employee.fullName}}. ' +
      'Unknown tokens are left visible in the output rather than blanked, so a typo is obvious.',
  });
};

// ─── rendering ───────────────────────────────────────────────────────────────

/** Gather everything the token map needs for one employee. */
async function loadTokenSources(employeeId: number) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      Department: { select: { name: true } },
      designation: { select: { name: true } },
      Branch: { select: { name: true } },
    },
  });
  if (!employee) return null;

  const companyId = (employee as any).companyId ?? (await resolveCompanyId(employeeId));
  const [company, salary, manager] = await Promise.all([
    (prisma as any).company.findUnique({ where: { id: companyId } }),
    (prisma as any).salaryStructure.findUnique({ where: { employeeId } }),
    (employee as any).reportingManager
      ? prisma.employee.findUnique({
          where: { id: (employee as any).reportingManager },
          select: { firstName: true, lastName: true },
        })
      : Promise.resolve(null),
  ]);

  const employeeWithManager = {
    ...employee,
    managerName: manager ? `${manager.firstName} ${manager.lastName}`.trim() : '',
  };

  return { employee: employeeWithManager, company, salary, companyId };
}

async function renderForEmployee(
  template: { subject: string; bodyHtml: string; headerHtml?: string | null; footerHtml?: string | null },
  employeeId: number,
  extra?: Record<string, any>,
) {
  const sources = await loadTokenSources(employeeId);
  if (!sources) return null;

  const tokens = buildTokenMap({
    employee: sources.employee,
    company: sources.company,
    salary: sources.salary,
    amountInWords,
    extra,
  });

  return {
    subject: renderTokens(template.subject, tokens),
    bodyHtml: renderTokens(template.bodyHtml, tokens),
    headerHtml: template.headerHtml ? renderTokens(template.headerHtml, tokens) : null,
    footerHtml: template.footerHtml ? renderTokens(template.footerHtml, tokens) : null,
    unknownTokens: findUnknownTokens(
      `${template.subject} ${template.bodyHtml} ${template.headerHtml || ''} ${template.footerHtml || ''}`,
      tokens,
    ),
    ...sources,
  };
}

/**
 * POST /api/letters/preview
 * Render without issuing. Accepts either a saved templateId or raw body, so the
 * editor can preview unsaved edits.
 */
export const previewLetter = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = Number(req.body.employeeId) || currentEmployeeId(req);
    if (!employeeId) return res.status(400).json({ message: 'employeeId is required' });

    let template: any;
    if (req.body.templateId) {
      template = await (prisma as any).letterTemplate.findUnique({
        where: { id: Number(req.body.templateId) },
      });
      if (!template) return res.status(404).json({ message: 'Template not found' });
    } else {
      if (!req.body.bodyHtml) {
        return res.status(400).json({ message: 'Provide either templateId or bodyHtml' });
      }
      template = {
        subject: req.body.subject || '',
        bodyHtml: req.body.bodyHtml,
        headerHtml: req.body.headerHtml || null,
        footerHtml: req.body.footerHtml || null,
      };
    }

    const rendered = await renderForEmployee(template, employeeId, req.body.extra);
    if (!rendered) return res.status(404).json({ message: 'Employee not found' });

    res.json({
      subject: rendered.subject,
      bodyHtml: rendered.bodyHtml,
      headerHtml: rendered.headerHtml,
      footerHtml: rendered.footerHtml,
      plainText: htmlToPlainText(rendered.bodyHtml),
      unknownTokens: rendered.unknownTokens,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** Build the PDF for a rendered letter. */
async function buildLetterPdf(
  rendered: any, includeSignature: boolean, password?: string | null,
): Promise<Buffer> {
  return renderHtmlToPdf(rendered.bodyHtml, {
    headerHtml: rendered.headerHtml,
    footerHtml: rendered.footerHtml,
    signature: includeSignature
      ? {
          name: rendered.company?.signatoryName,
          designation: rendered.company?.signatoryDesignation,
          company: rendered.company?.legalName || rendered.company?.name,
          place: rendered.company?.signatoryPlace || rendered.company?.city,
        }
      : null,
    password: password || null,
    pageFooterNote: 'This is a computer-generated letter.',
  });
}

/**
 * POST /api/letters/issue
 * Issue to one or many employees. Records the rendered HTML per employee and
 * optionally emails the PDF.
 */
export const issueLetter = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const templateId = Number(req.body.templateId);
    const employeeIds: number[] = Array.isArray(req.body.employeeIds)
      ? req.body.employeeIds.map(Number).filter(Boolean)
      : [];
    const sendEmail = !!req.body.sendEmail;

    if (!templateId) return res.status(400).json({ message: 'templateId is required' });
    if (!employeeIds.length) return res.status(400).json({ message: 'employeeIds is required' });

    const template = await (prisma as any).letterTemplate.findUnique({ where: { id: templateId } });
    if (!template) return res.status(404).json({ message: 'Template not found' });

    const issuedBy = currentEmployeeId(req);
    const issued: any[] = [];
    const failed: Array<{ employeeId: number; reason: string }> = [];

    for (const employeeId of employeeIds) {
      try {
        const rendered = await renderForEmployee(template, employeeId, req.body.extra);
        if (!rendered) {
          failed.push({ employeeId, reason: 'Employee not found' });
          continue;
        }

        const record = await (prisma as any).letterIssued.create({
          data: {
            templateId,
            templateName: template.name,
            employeeId,
            companyId: rendered.companyId,
            subject: rendered.subject,
            renderedHtml: rendered.bodyHtml,
            issuedBy,
            status: 'ISSUED',
            remarks: req.body.remarks || null,
          },
        });

        if (sendEmail) {
          const email = rendered.employee?.email;
          if (!email) {
            failed.push({ employeeId, reason: 'Issued, but no email address on record' });
          } else {
            const pdf = await buildLetterPdf(rendered, template.includeSignature);
            await sendMail({
              to: email,
              subject: rendered.subject,
              html:
                `<p>Dear ${rendered.employee.firstName},</p>` +
                `<p>Please find your ${template.name} attached.</p>` +
                `<p>Regards,<br>${rendered.company?.name || 'HR Team'}</p>`,
            });
            await (prisma as any).letterIssued.update({
              where: { id: record.id },
              data: { status: 'EMAILED', emailedAt: new Date() },
            });
          }
        }

        issued.push(record);
      } catch (err: any) {
        failed.push({ employeeId, reason: err?.message || 'Unknown error' });
      }
    }

    res.status(201).json({ issued: issued.length, failed, letters: issued });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** GET /api/letters/issued/:id/pdf — download a previously issued letter. */
export const downloadIssuedLetter = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const record = await (prisma as any).letterIssued.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        template: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        company: true,
      },
    });
    if (!record) return res.status(404).json({ message: 'Letter not found' });

    // Re-render the STORED html, never the template — the letter is a snapshot.
    const pdf = await renderHtmlToPdf(record.renderedHtml, {
      headerHtml: record.template?.headerHtml || null,
      footerHtml: record.template?.footerHtml || null,
      signature: record.template?.includeSignature !== false
        ? {
            name: record.company?.signatoryName,
            designation: record.company?.signatoryDesignation,
            company: record.company?.legalName || record.company?.name,
            place: record.company?.signatoryPlace || record.company?.city,
          }
        : null,
      pageFooterNote: 'This is a computer-generated letter.',
    });

    const safeName = String(record.templateName || 'Letter').replace(/[^\w-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName}_${record.employee?.employeeCode || record.employeeId}.pdf"`,
    );
    res.send(pdf);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** GET /api/letters/issued — history, filterable by employee or template. */
export const listIssued = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employeeId, templateId, category, page = '1', limit = '20' } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);

    // Archived letters are kept but stay out of the history list.
    const where: any = {
      archivedAt: null,
      ...(employeeId ? { employeeId: Number(employeeId) } : {}),
      ...(templateId ? { templateId: Number(templateId) } : {}),
      ...(category ? { template: { category: String(category).toUpperCase() } } : {}),
    };

    const [rows, total] = await Promise.all([
      (prisma as any).letterIssued.findMany({
        where, skip, take: Number(limit),
        orderBy: { issuedAt: 'desc' },
        include: {
          employee: {
            select: {
              id: true, firstName: true, lastName: true, employeeCode: true,
              Department: { select: { name: true } },
            },
          },
          template: { select: { id: true, name: true, category: true } },
        },
      }),
      (prisma as any).letterIssued.count({ where }),
    ]);

    res.json({ data: rows, total, page: Number(page), limit: Number(limit) });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** GET /api/letters/my — the employee's own letters. */
export const listMyLetters = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = currentEmployeeId(req);
    if (!employeeId) return res.status(401).json({ message: 'Unauthorized' });

    const rows = await (prisma as any).letterIssued.findMany({
      where: { employeeId, archivedAt: null, status: { not: 'REVOKED' } },
      orderBy: { issuedAt: 'desc' },
      include: { template: { select: { name: true, category: true } } },
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

/** PATCH /api/letters/issued/:id/revoke — withdraw a letter issued in error. */
export const revokeIssued = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = await (prisma as any).letterIssued.update({
      where: { id: Number(req.params.id) },
      data: { status: 'REVOKED', remarks: req.body?.reason || null },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
