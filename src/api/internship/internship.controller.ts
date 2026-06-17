import { Request, Response } from 'express';
import { PrismaClient, Prisma, InternshipStatus } from '@prisma/client';
import PDFDocument from 'pdfkit';
import axios from 'axios';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from 'basic-ftp';
import { config } from '../../config';

const COMPANY_NAME = config.branding.companyName || 'RASHTROTTHANA HOSPITAL';
const COMPANY_LOGO_URL = config.branding.companyLogoUrl || '';
const COMPANY_TAGLINE = config.branding.companyTagline || '';
const FTP_CONFIG = {
    host: config.ftp.host,
    user: config.ftp.user,
    password: config.ftp.pass,
    secure: config.ftp.secure,
  }


const prisma = new PrismaClient();

const toDate = (v?: string | Date | null) => (v ? new Date(v) : undefined);
const parseStatuses = (csv?: string): InternshipStatus[] | undefined =>
    csv ? (csv.split(',').map(s => s.trim().toUpperCase()) as InternshipStatus[]) : undefined;

// Small helper to resolve mentor names without schema changes
async function buildNameMap(ids: (number | null | undefined)[]) {
    const uniq = Array.from(new Set(ids.filter((x): x is number => typeof x === 'number')));
    if (!uniq.length) return new Map<number, string>();
    const people = await prisma.employee.findMany({
        where: { id: { in: uniq } },
        select: { id: true, firstName: true, lastName: true },
    });
    return new Map(people.map(p => [p.id, `${p.firstName} ${p.lastName}`]));
}

// Reusable select (type-safe enough when used inline)
const internshipSelect = {
    id: true,
    employeeId: true,
    mentorId: true,
    startDate: true,
    endDate: true,
    departmentId: true,
    status: true,
    notes: true,
    candidateName: true,
    email: true,
    phone: true,
    title: true,
    stipend: true,
    createdAt: true,
    updatedAt: true,
    employee: { select: { id: true, firstName: true, lastName: true } }, // optional relation
    Department: { select: { id: true, name: true } },
} as const;

/** POST /api/internships */
export async function createInternship(req: Request, res: Response) {
    try {
        const {
            candidateName,
            email,
            phone,
            title,
            stipend,
            notes,
            employeeId,
            mentorId,
            startDate,
            endDate,
            departmentId,
            status,
        } = req.body || {};

        if (!candidateName) return res.status(400).json({ error: 'candidateName is required' });
        if (!startDate) return res.status(400).json({ error: 'startDate is required' }); // startDate is non-null in your schema

        const created = await prisma.internship.create({
            data: {
                candidateName,
                email: email ?? null,
                phone: phone ?? null,
                title: title ?? null,
                stipend: stipend ?? null,
                notes: notes ?? null,
                employeeId: employeeId == null ? null : Number(employeeId),
                mentorId: mentorId == null ? null : Number(mentorId),
                departmentId: departmentId == null ? null : Number(departmentId),
                startDate: new Date(startDate),
                endDate: endDate == null ? null : new Date(endDate),
                status: (status as InternshipStatus) ?? 'DRAFT', // override schema default if not provided
            },
            select: internshipSelect,
        });

        const mentorMap = await buildNameMap([created.mentorId]);
               const message = `A intern ${created.candidateName} has been assigned to you. Please check the details and provide necessary guidance.`;
            //    if(created.mentorId){
            //     await createNotification(created.mentorId, message);
            //    }
        // await createNotification(created.mentorId, message);
        return res.status(201).json({
            ...created,
            employeeName: created.employee ? `${created.employee.firstName} ${created.employee.lastName}` : null,
            departmentName: created.Department?.name ?? null,
            mentorName: created.mentorId ? mentorMap.get(created.mentorId) || null : null,
        });
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2003') return res.status(400).json({ error: 'Invalid foreign key (employeeId/mentorId)' });
        if (e?.code === 'P2002') return res.status(409).json({ error: 'Unique constraint violation' });
        return res.status(500).json({ error: 'Failed to create internship' });
    }
}

/** GET /api/internships */
export async function listInternships(req: Request, res: Response) {
    try {
        const {
            q, status, employeeId, mentorId, departmentId, departments,
            startFrom,
            startTo,
            endFrom,
            endTo,
            activeFrom,              // NEW
            activeTo,                // NEW
            page = '1',
            pageSize = '20',
            order = 'desc',
        } = (req.query || {}) as Record<string, string>;

        // Build OR for keyword search (no mode)
        const keywordOr: Prisma.InternshipWhereInput[] | undefined = q
            ? [
                { candidateName: { contains: q } },
                { email: { contains: q } },
                { phone: { contains: q } },
                { title: { contains: q } },
                { Department: { is: { name: { contains: q } } } },
                {
                    employee: {
                        is: {
                            OR: [
                                { firstName: { contains: q } },
                                { lastName: { contains: q } },
                            ]
                        }
                    }
                },
            ]
            : undefined;

        // NEW: build overlap filter for "active between" range
        const af = activeFrom ? new Date(activeFrom) : undefined;
        const at = activeTo ? new Date(activeTo) : undefined;
        const activeAND: Prisma.InternshipWhereInput[] = [];
        if (at) activeAND.push({ startDate: { lte: at } });
        if (af) activeAND.push({ OR: [{ endDate: { gte: af } }, { endDate: null }] });

        const where: Prisma.InternshipWhereInput = {
            ...(keywordOr ? { OR: keywordOr } : {}),
            ...(status ? { status: { in: status.split(',').map(s => s.trim().toUpperCase() as InternshipStatus) } } : {}),
            ...(employeeId ? { employeeId: Number(employeeId) } : {}),
            ...(mentorId ? { mentorId: Number(mentorId) } : {}),
            ...(departmentId ? { departmentId: Number(departmentId) } : {}),
            ...(departments ? { departmentId: { in: departments.split(',').map(n => Number(n)).filter(Boolean) } } : {}),

            // keep your existing “start date range” filter
            ...(startFrom || startTo
                ? {
                    startDate: {
                        gte: startFrom ? new Date(startFrom) : undefined,
                        lte: startTo ? new Date(startTo) : undefined,
                    },
                }
                : {}),

            // keep your existing “end date range” filter
            ...(endFrom || endTo
                ? {
                    endDate: {
                        gte: endFrom ? new Date(endFrom) : undefined,
                        lte: endTo ? new Date(endTo) : undefined,
                    },
                }
                : {}),

            // NEW: add overlap filter if provided
            ...(activeAND.length ? { AND: activeAND } : {}),
        };

        const skip = (Math.max(1, +page) - 1) * Math.max(1, +pageSize);
        const take = Math.max(1, Math.min(200, +pageSize));

        const select: Prisma.InternshipSelect = {
            id: true,
            employeeId: true,
            mentorId: true,
            departmentId: true,    
            startDate: true,
            endDate: true,
            status: true,
            notes: true,
            candidateName: true,
            email: true,
            phone: true,
            title: true,
            stipend: true,
            createdAt: true,
            updatedAt: true,
            employee: { select: { id: true, firstName: true, lastName: true } },
            Department: { select: { id: true, name: true } }, 
        };

        const [items, total] = await Promise.all([
            prisma.internship.findMany({
                where,
                orderBy: { createdAt: order === 'asc' ? 'asc' : 'desc' },
                skip,
                take,
                select,
            }),
            prisma.internship.count({ where }),
        ]);

        // mentor name enrichment (unchanged)
        const mentorIds = Array.from(new Set(items.map(i => i.mentorId).filter(Boolean) as number[]));
        const mentors = mentorIds.length
            ? await prisma.employee.findMany({ where: { id: { in: mentorIds } }, select: { id: true, firstName: true, lastName: true } })
            : [];
        const mentorMap = new Map(mentors.map(m => [m.id, `${m.firstName} ${m.lastName}`]));

        const enriched = items.map(i => ({
            ...i,
            employeeName: i.employee ? `${i.employee.firstName} ${i.employee.lastName}` : null,
            mentorName: i.mentorId ? mentorMap.get(i.mentorId) || null : null,
            departmentName: i.Department?.name ?? null,
        }));

        return res.json({ items: enriched, total, page: +page, pageSize: take });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Failed to list internships' });
    }
}


/** GET /api/internships/:id */
export async function getInternship(req: Request, res: Response) {
    try {
        const id = Number(req.params.id);
        const item = await prisma.internship.findUnique({
            where: { id },
            select: internshipSelect,
        });
        if (!item) return res.status(404).json({ error: 'Not found' });

        const mentorMap = await buildNameMap([item.mentorId]);
        return res.json({
            ...item,
            employeeName: item.employee ? `${item.employee.firstName} ${item.employee.lastName}` : null,
            mentorName: item.mentorId ? mentorMap.get(item.mentorId) || null : null,
            departmentName: item.Department?.name ?? null,
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Failed to load internship' });
    }
}

/** PATCH /api/internships/:id */
export async function updateInternship(req: Request, res: Response) {
    try {
        const id = Number(req.params.id);
        const {
            candidateName,
            email,
            phone,
            title,
            stipend,
            notes,
            employeeId,
            mentorId,
            startDate,
            endDate,
            departmentId,
            status,
        } = req.body || {};

        const updated = await prisma.internship.update({
            where: { id },
            data: {
                ...(candidateName !== undefined ? { candidateName } : {}),
                ...(email !== undefined ? { email } : {}),
                ...(phone !== undefined ? { phone } : {}),
                ...(title !== undefined ? { title } : {}),
                ...(stipend !== undefined ? { stipend } : {}),
                ...(notes !== undefined ? { notes } : {}),
                ...(employeeId !== undefined ? { employeeId: employeeId == null ? null : Number(employeeId) } : {}),
                ...(mentorId !== undefined ? { mentorId: mentorId == null ? null : Number(mentorId) } : {}),
                ...(departmentId !== undefined ? { departmentId: departmentId == null ? null : Number(departmentId) } : {}),
                ...(startDate !== undefined ? { startDate: new Date(startDate) } : {}),
                ...(endDate !== undefined ? { endDate: endDate == null ? null : new Date(endDate) } : {}),
                ...(status !== undefined ? { status: status as InternshipStatus } : {}),
            },
            select: internshipSelect,
        });

        const mentorMap = await buildNameMap([updated.mentorId]);
        return res.json({
            ...updated,
            employeeName: updated.employee ? `${updated.employee.firstName} ${updated.employee.lastName}` : null,
            departmentName: updated.Department?.name ?? null,
            mentorName: updated.mentorId ? mentorMap.get(updated.mentorId) || null : null,
        });
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
        if (e?.code === 'P2003') return res.status(400).json({ error: 'Invalid foreign key (employeeId/mentorId)' });
        return res.status(500).json({ error: 'Failed to update internship' });
    }
}

/** POST /api/internships/:id/offer -> status=OFFERED (optional startDate) */
export async function offerInternship(req: Request, res: Response) {
    try {
        const id = Number(req.params.id);
        const { startDate } = req.body || {};
        const updated = await prisma.internship.update({
            where: { id },
            data: {
                status: 'OFFERED',
                ...(startDate ? { startDate: new Date(startDate) } : {}),
            },
            select: internshipSelect,
        });
        return res.json(updated);
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
        return res.status(500).json({ error: 'Failed to offer internship' });
    }
}

/** POST /api/internships/:id/activate -> status=ACTIVE (must have startDate) */
export async function activateInternship(req: Request, res: Response) {
    try {
        const id = Number(req.params.id);
        const { startDate, employeeId } = req.body || {};
        const updated = await prisma.internship.update({
            where: { id },
            data: {
                status: 'ACTIVE',
                ...(startDate ? { startDate: new Date(startDate) } : {}),
                ...(employeeId !== undefined ? { employeeId: employeeId == null ? null : Number(employeeId) } : {}),
            },
            select: internshipSelect,
        });
        return res.json(updated);
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
        if (e?.code === 'P2003') return res.status(400).json({ error: 'Invalid foreign key (employeeId)' });
        return res.status(500).json({ error: 'Failed to activate internship' });
    }
}

/** POST /api/internships/:id/extend -> sets endDate */
export async function extendInternship(req: Request, res: Response) {
    try {
        const id = Number(req.params.id);
        const { endDate } = req.body || {};
        if (!endDate) return res.status(400).json({ error: 'endDate is required' });
        const updated = await prisma.internship.update({
            where: { id },
            data: { endDate: new Date(endDate) },
            select: internshipSelect,
        });
        return res.json(updated);
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
        return res.status(500).json({ error: 'Failed to extend internship' });
    }
}

/** POST /api/internships/:id/complete -> status=COMPLETED (optional endDate) */
export async function completeInternship(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const { endDate } = (req.body || {}) as { endDate?: string };
  
      // 1) complete
      await prisma.internship.update({
        where: { id },
        data: { status: 'COMPLETED', ...(endDate ? { endDate: new Date(endDate) } : {}) },
      });
  
      // 2) load
      const existing = await prisma.internship.findUnique({
        where: { id },
        select: {
          id: true, status: true, startDate: true, endDate: true,
          candidateName: true, title: true,
          Department: { select: { name: true } },
          certificateCode: true, certificateIssuedAt: true,
        },
      });
      if (!existing) return res.status(404).json({ error: 'Not found' });
  
      // 3) ensure code (idempotent)
      let code = existing.certificateCode;
      let issuedAt = existing.certificateIssuedAt ?? undefined;
  
      if (!code) {
        for (let attempts = 0; attempts < 4; attempts++) {
          const tryCode = genCertCode();
          const claimed = await prisma.internship.updateMany({
            where: { id, certificateCode: null },
            data: { certificateCode: tryCode, certificateIssuedAt: new Date() },
          });
          if (claimed.count === 1) {
            code = tryCode;
            break;
          }
          const row = await prisma.internship.findUnique({ where: { id }, select: { certificateCode: true, certificateIssuedAt: true } });
          if (row?.certificateCode) { code = row.certificateCode; issuedAt = row.certificateIssuedAt ?? undefined; break; }
        }
        if (!code) return res.status(500).json({ error: 'Could not issue certificate' });
      }
  
      // refresh issuedAt if missing
      if (!issuedAt) {
        const row = await prisma.internship.findUnique({ where: { id }, select: { certificateIssuedAt: true } });
        issuedAt = row?.certificateIssuedAt ?? new Date();
      }
  
      // 4) generate PDF
      const { filePath, fileName } = await generateCertificatePdf({
        code,
        issuedAt,
        candidateName: existing.candidateName,
        title: existing.title,
        startDate: existing.startDate,
        endDate: existing.endDate,
        departmentName: existing.Department?.name ?? null,
        companyName: COMPANY_NAME,
        companyLogoUrl: COMPANY_LOGO_URL,
        companyTagline: COMPANY_TAGLINE,
      });
  
      // 5) upload to Hostinger
      const remotePath = `/public_html/certificate/${fileName}`;
      await uploadToFTP(filePath, remotePath, FTP_CONFIG);
      const publicUrl = `https://hrproindia.in/certificate/${fileName}`;
  
      // cleanup
      try { fs.unlinkSync(filePath); } catch {}
  
      // 6) return
      return res.json({
        id: existing.id,
        status: 'COMPLETED',
        candidateName: existing.candidateName,
        title: existing.title,
        startDate: existing.startDate,
        endDate: existing.endDate,
        departmentName: existing.Department?.name ?? null,
        certificate: {
          code,
          issuedAt,
          url: publicUrl,
          format: 'pdf',
        },
      });
    } catch (e: any) {
      console.error(e);
      if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
      return res.status(500).json({ error: 'Failed to complete internship' });
    }
  }
  


/** POST /api/internships/:id/drop -> status=DROPPED (optional reason -> notes append) */
export async function dropInternship(req: Request, res: Response) {
    try {
        const id = Number(req.params.id);
        const { reason } = req.body || {};
        // Keep previous notes and append reason if present
        const existing = await prisma.internship.findUnique({ where: { id }, select: { notes: true } });
        if (!existing) return res.status(404).json({ error: 'Not found' });

        const updated = await prisma.internship.update({
            where: { id },
            data: {
                status: 'DROPPED',
                notes: reason ? [existing.notes, reason].filter(Boolean).join('\n') : existing.notes,
            },
            select: internshipSelect,
        });
        return res.json(updated);
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
        return res.status(500).json({ error: 'Failed to drop internship' });
    }
}

/** POST /api/internships/:id/convert -> status=CONVERTED, optionally create/attach employee */
export async function convertInternship(req: Request, res: Response) {
    try {
        const id = Number(req.params.id);
        const {
            employeeId,
            createEmployee, // { firstName,lastName,email?,departmentId?,branchId?,dateOfJoining? }
        }: {
            employeeId?: number;
            createEmployee?: {
                firstName: string;
                lastName: string;
                email?: string;
                departmentId?: number;
                branchId?: number;
                dateOfJoining?: string | Date;
            };
        } = req.body || {};

        let newEmpId = employeeId;

        if (!newEmpId && createEmployee) {
            const emp = await prisma.employee.create({
                data: {
                    firstName: createEmployee.firstName,
                    lastName: createEmployee.lastName,
                    email: createEmployee.email ?? null,
                    departmentId: createEmployee.departmentId ?? null,
                    branchId: createEmployee.branchId ?? null,
                    dateOfJoining: createEmployee.dateOfJoining ? new Date(createEmployee.dateOfJoining) : new Date(),
                    employmentStatus: 'ACTIVE',
                } as any,
                select: { id: true },
            });
            newEmpId = emp.id;
            await prisma.internship.update({
                where: { id },
                data: { departmentId: createEmployee.departmentId ?? null },
            });
        }

        const updated = await prisma.internship.update({
            where: { id },
            data: {
                status: 'CONVERTED',
                ...(newEmpId ? { employeeId: newEmpId } : {}),
                // if you attached an existing employee and internship has no department, inherit it
                ...(employeeId && (await prisma.employee.findUnique({ where: { id: employeeId }, select: { departmentId: true } }))
                    ? { departmentId: (await prisma.employee.findUnique({ where: { id: employeeId }, select: { departmentId: true } }))!.departmentId ?? null }
                    : {}),
            },
            select: internshipSelect,
        });

        return res.json(updated);
    } catch (e: any) {
        console.error(e);
        if (e?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
        if (e?.code === 'P2003') return res.status(400).json({ error: 'Invalid foreign key (employeeId)' });
        return res.status(500).json({ error: 'Failed to convert internship' });
    }
}

import { randomBytes } from 'crypto';
import { createNotification } from '../notifications/notifications.controller';


function genCertCode() {
  return `CERT-${randomBytes(4).toString('hex').toUpperCase()}`; // e.g. CERT-9F3A2C1B
}

function renderCertificateHtml(args: {
  code: string;
  issuedAt: Date;
  candidateName: string;
  title?: string | null;
  startDate: Date;
  endDate?: Date | null;
  departmentName?: string | null;
}) {
  const fmt = (d?: Date | null) => (d ? d.toDateString() : '—');
  return `
  <html><head><title>Certificate ${args.code}</title>
  <meta charset="utf-8">
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:40px;background:#fafafa}
    .card{border:2px solid #222;padding:40px;border-radius:12px;background:#fff;max-width:800px;margin:0 auto}
    h1{margin:0 0 12px}
    .muted{color:#666}
  </style></head><body>
    <div class="card">
      <h1>Internship Completion Certificate</h1>
      <p>This certifies that <strong>${args.candidateName}</strong>${
        args.title ? ` completed an internship in <strong>${args.title}</strong>` : ' completed an internship'
      }${args.departmentName ? ` with the <strong>${args.departmentName}</strong> department` : ''}.</p>
      <p class="muted">Period: ${fmt(args.startDate)} — ${fmt(args.endDate)}</p>
      <p class="muted">Issued on: ${fmt(args.issuedAt)}</p>
      <p class="muted">Certificate ID: <strong>${args.code}</strong></p>
    </div>
  </body></html>`;
}



export type CertInput = {
  code: string;               // CERT-XXXX
  issuedAt: Date;
  candidateName: string;
  title?: string | null;      // role
  startDate: Date;
  endDate?: Date | null;
  departmentName?: string | null;

  companyName: string;        // e.g. HR Pro India
  companyLogoUrl?: string;    // public URL to PNG/SVG
  companyTagline?: string;    // optional
};

function fmtDate(d?: Date | null) {
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

async function fetchBuffer(url?: string): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  } catch {
    return null;
  }
}

/** Returns { filePath, fileName } */
export async function generateCertificatePdf(input: CertInput): Promise<{ filePath: string; fileName: string; }> {
  const fileName = `${input.code}.pdf`;
  const filePath = path.join(os.tmpdir(), fileName);

  const doc = new PDFDocument({ size: 'A4', margin: 36 }); // 595 x 842 pt
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const w = doc.page.width, h = doc.page.height;

  // Border
  doc.save()
     .roundedRect(18, 18, w - 36, h - 36, 12)
     .lineWidth(3)
     .stroke('#1f2937') // slate-800
     .restore();

  // Inner border accent
  doc.save()
     .roundedRect(28, 28, w - 56, h - 56, 10)
     .lineWidth(1)
     .stroke('#9ca3af') // gray-400
     .restore();

  // Logo
  const logo = await fetchBuffer(input.companyLogoUrl);
  if (logo) {
    const logoWidth = 72;
    doc.image(logo, (w - logoWidth)/2, 54, { width: logoWidth });
  }

  // Company name
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827')
     .text(input.companyName, 36, logo ? 138 : 70, { align: 'center' });

  if (input.companyTagline) {
    doc.font('Helvetica').fontSize(10).fillColor('#6b7280')
       .text(input.companyTagline, 36, doc.y + 2, { align: 'center' });
  }

  // Title
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(28).fillColor('#1f2937')
     .text('CERTIFICATE OF COMPLETION', { align: 'center', characterSpacing: 0.5 });

  // Candidate name
  doc.moveDown(1.6);
  doc.font('Helvetica').fontSize(12).fillColor('#374151')
     .text('This is to certify that', { align: 'center' });

  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(30).fillColor('#111827')
     .text(input.candidateName, { align: 'center' });

  // Body
  const rolePart = input.title ? ` in ${input.title}` : '';
  const deptPart = input.departmentName ? ` with the ${input.departmentName} department` : '';
  const body = `has successfully completed the internship${rolePart}${deptPart}.`;
  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(12).fillColor('#374151')
     .text(body, 72, doc.y, { align: 'center' });

  // Period
  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(12).fillColor('#111827')
     .text(`Period: ${fmtDate(input.startDate)} — ${fmtDate(input.endDate)}`, { align: 'center' });

  // Issued & Code box
  doc.moveDown(2);
  const boxW = w - 160, boxX = (w - boxW)/2;
  doc.roundedRect(boxX, doc.y, boxW, 70, 8).fillOpacity(0.06).fill('#111827').fillOpacity(1).stroke('#e5e7eb');
  const yBase = doc.y + 10;
  doc.font('Helvetica').fontSize(10).fillColor('#374151')
     .text(`Issued on: ${fmtDate(input.issuedAt)}`, boxX + 16, yBase, { width: boxW - 32, align: 'left' });
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827')
     .text(`Certificate ID: ${input.code}`, boxX + 16, yBase + 22, { width: boxW - 32, align: 'left' });

  // Footer lines for signatures (optional)
  const sigY = h - 140;
  doc.moveTo(90, sigY).lineTo(240, sigY).stroke('#9ca3af');
  doc.moveTo(w - 240, sigY).lineTo(w - 90, sigY).stroke('#9ca3af');
  doc.font('Helvetica').fontSize(10).fillColor('#374151')
     .text('HR Manager', 90, sigY + 6, { width: 150, align: 'center' })
     .text('Department Head', w - 240, sigY + 6, { width: 150, align: 'center' });

  doc.end();

  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });

  return { filePath, fileName };
}
export async function uploadToFTP(localFilePath: string, remoteFilePath: string, FTP_CONFIG: any) {
    const client = new Client();
    client.ftp.verbose = false;
    try {
      await client.access(FTP_CONFIG);
      // ensure /public_html/certificate exists
      await client.ensureDir('/public_html/certificate');
      await client.uploadFrom(localFilePath, remoteFilePath); // absolute remote path
    } finally {
      client.close();
    }
  }