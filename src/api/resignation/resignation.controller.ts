import { Request, Response } from 'express';
import { PrismaClient, $Enums } from '@prisma/client';
import { format } from 'date-fns';
import * as fsp from 'fs/promises';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import QRCode from 'qrcode';
import { Client } from 'basic-ftp';
const prisma = new PrismaClient();

type ClearanceRow = {
  type: string;                    // IT / Finance / HR / Admin / Security / Other
  decision: 'PENDING' | 'APPROVED' | 'REJECTED';
  decidedAt?: Date | null;
  note?: string | null;
};

export type ClearanceCertInput = {
  code: string;                    // e.g., CLR-EMP001-20250819-1234
  issuedAt: Date;
  verifyUrl: string;               // for QR
  employeeName: string;
  employeeCode: string;
  departmentName?: string | null;
  branchName?: string | null;
  dateOfJoining?: Date | null;
  lastWorkingDay?: Date | null;
  clearances: ClearanceRow[];      // table rows
  companyName: string;
  companyLogoUrl?: string;
  companyTagline?: string;
};

/** Utils */
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);

/** Create resignation (Employee) */
export async function createResignation(req: Request, res: Response) {
  try {
    const { employeeId, reason, additionalNotes, noticePeriodDays } = req.body;

    // capture manager at the time of submission
    const emp = await prisma.employee.findUnique({
      where: { id: Number(employeeId) },
      select: { reportingManager: true }
    });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const npd = Number(noticePeriodDays || 30);
    const proposedLWD = addDays(new Date(), npd);

    const rec = await prisma.resignationRequest.create({
      data: {
        employeeId: Number(employeeId),
        managerId: emp.reportingManager ?? null,
        reason,
        additionalNotes,
        noticePeriodDays: npd,
        proposedLastWorkingDay: proposedLWD,
        status: 'SUBMITTED'
      }
    });

    res.status(201).json(rec);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create resignation' });
  }
}

/** List resignations with scope:
 *  - scope=mine&employeeId=#
 *  - scope=manager&managerId=#
 *  - scope=all (HR / HR Manager)
 *  Optional status filter: ?status=UNDER_REVIEW
 */
export async function listResignations(req: Request, res: Response) {
  try {
    const { scope, employeeId, managerId, status } = req.query as Record<string, string | undefined>;

    const where: any = {};
    if (status) where.status = status as $Enums.ResignationStatus;

    if (scope === 'mine' && employeeId) where.employeeId = Number(employeeId);
    else if (scope === 'manager' && managerId) where.managerId = Number(managerId);
    console.log(where,scope)
    // scope=all -> no additional filter

    const rows = await prisma.resignationRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, departmentId: true, designation: true, reportingManager:true } },
        handoverTasks: true,
        clearances: true,
        exitInterview: true,
        finalSettlement: true
      }
    });

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch resignations' });
  }
}

export async function getResignationById(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const row = await prisma.resignationRequest.findUnique({
      where: { id },
      include: {
        employee: true,
        handoverTasks: true,
        clearances: true,
        exitInterview: true,
        finalSettlement: true,
        documents: true
      }
    });
    if (!row) return res.status(404).json({ error: 'Resignation not found' });
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch resignation' });
  }
}

/** Employee can withdraw before final HR decision */
export async function withdrawResignation(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const row = await prisma.resignationRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.hrDecision !== 'PENDING') {
      return res.status(400).json({ error: 'Cannot withdraw after HR decision' });
    }
    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: { status: 'WITHDRAWN' }
    });
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to withdraw' });
  }
}

/** Manager approve/reject */
export async function managerApprove(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { note, overrideLastWorkingDay } = req.body; // optional LWD adjust
    const data: any = {
      managerDecision: 'APPROVED',
      managerDecidedAt: new Date(),
      managerNote: note,
      status: 'APPROVED'
    };
    if (overrideLastWorkingDay) data.proposedLastWorkingDay = new Date(overrideLastWorkingDay);

    const upd = await prisma.resignationRequest.update({
      where: { id },
      data
    });
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Manager approval failed' });
  }
}

export async function managerReject(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { note } = req.body;
    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: {
        managerDecision: 'REJECTED',
        managerDecidedAt: new Date(),
        managerNote: note,
        status: 'REJECTED'
      }
    });
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Manager rejection failed' });
  }
}

/** HR approve/reject */
export async function hrApprove(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { note, actualLastWorkingDay } = req.body;
    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: {
        hrDecision: 'APPROVED',
        hrDecidedAt: new Date(),
        hrNote: note,
        actualLastWorkingDay: actualLastWorkingDay ? new Date(actualLastWorkingDay) : undefined,
        status: 'UNDER_REVIEW'
      }
    });
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'HR approval failed' });
  }
}

export async function hrReject(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { note } = req.body;
    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: {
        hrDecision: 'REJECTED',
        hrDecidedAt: new Date(),
        hrNote: note,
        status: 'REJECTED'
      }
    });
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'HR rejection failed' });
  }
}

export async function hrCancel(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Cancel failed' });
  }
}

/** Handover tasks */
export async function addHandoverTasks(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { tasks } = req.body as { tasks: Array<{ title: string; description?: string; assigneeId?: number; dueDate?: string }> };
    const created = await prisma.$transaction(tasks.map(t =>
      prisma.resignationHandoverTask.create({
        data: {
          resignationId: id,
          title: t.title,
          description: t.description,
          assigneeId: t.assigneeId ?? null,
          dueDate: t.dueDate ? new Date(t.dueDate) : null
        }
      })
    ));
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Add tasks failed' });
  }
}

export async function updateTask(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const taskId = Number(req.params.taskId);
    const { status } = req.body as { status: $Enums.TaskStatus };
    const upd = await prisma.resignationHandoverTask.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: status === 'DONE' ? new Date() : null
      }
    });
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Update task failed' });
  }
}

/** Clearances (upsert per type) */
export async function upsertClearance(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { type, decision, note, verifierId } = req.body as {
      type: $Enums.ClearanceType;
      decision: $Enums.ApprovalDecision;
      note?: string;
      verifierId?: number;
    };

    const existing = await prisma.resignationClearance.findUnique({
      where: { resignationId_type: { resignationId: id, type } }
    });

    const row = existing
      ? await prisma.resignationClearance.update({
          where: { id: existing.id },
          data: { decision, note, verifierId: verifierId ?? null, decidedAt: new Date() }
        })
      : await prisma.resignationClearance.create({
          data: { resignationId: id, type, decision, note, verifierId: verifierId ?? null, decidedAt: new Date() }
        });

    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Clearance update failed' });
  }
}

/** Exit interview scheduling */
export async function scheduleExitInterview(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { scheduledAt, interviewerId, notes } = req.body;
    const row = await prisma.exitInterview.upsert({
      where: { resignationId: id },
      create: {
        resignationId: id,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        interviewerId: interviewerId ?? null,
        notes
      },
      update: {
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        interviewerId: interviewerId ?? null,
        notes
      }
    });
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Exit interview scheduling failed' });
  }
}

/** Final settlement status */
export async function setFinalSettlement(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { status, note } = req.body as { status: $Enums.SettlementStatus; note?: string };
    const row = await prisma.finalSettlement.upsert({
      where: { resignationId: id },
      create: { resignationId: id, status, note },
      update: { status, note }
    });
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Final settlement update failed' });
  }
}

/** Mark completed (HR) */
export async function markCompleted(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: { status: 'COMPLETED' }
    });
    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Mark completed failed' });
  }
}
// PUT /resignations/:id/hr-hold  { note? }
export async function hrHold(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const { note } = req.body as { note?: string };

    const upd = await prisma.resignationRequest.update({
      where: { id },
      data: {
        status: 'ON_HOLD',
        hrNote: note ?? undefined,
        // keep hrDecision as PENDING (not decided yet)
        // hrDecidedAt: null  // optional: clear decidedAt if it was set
      }
    });

    res.json(upd);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'HR hold failed' });
  }
}



const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL ?? 'https://example.com';
const COMPANY_NAME = process.env.COMPANY_NAME ?? 'HR MINDS';
const COMPANY_LOGO_URL = process.env.COMPANY_LOGO_URL ?? ''; // optional
const COMPANY_TAGLINE = process.env.COMPANY_TAGLINE ?? '';   // optional
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'https://hrproindia.in';
const FTP_PUBLIC_DIR = process.env.FTP_PUBLIC_DIR ?? '/public_html/certificate'; // remote dir

export const generateClearanceCertificate = async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  // 1) Load resignation with related data
  const r = await prisma.resignationRequest.findUnique({
    where: { id },
    include: {
      employee: { include: { Department: true, Branch: true } },
      clearances: true,
      handoverTasks: true,
      finalSettlement: true,
    },
  });
  if (!r) return res.status(404).json({ message: 'Resignation not found' });
  console.log('DBG resignation', {
    id: r.id,
    status: r.status,
    clearances: r.clearances.map(c => ({ type: c.type, decision: c.decision, decidedAt: c.decidedAt })),
    handoverTasks: r.handoverTasks.map(t => ({ id: t.id, status: t.status })),
    finalSettlement: r.finalSettlement?.status ?? null,
  });
  
  // 2) Eligibility checks
  const allClearancesApproved = r.clearances.length > 0 && r.clearances.every(c => c.decision === 'APPROVED');
  const allTasksDone = r.handoverTasks.every(t => t.status === 'DONE');
  const settlementPaid = r.finalSettlement?.status === 'PAID';
  const statusOk = ['APPROVED', 'COMPLETED'].includes(r.status);

  if (!statusOk || !allClearancesApproved || !allTasksDone || !settlementPaid) {
    return res.status(400).json({
      message: 'Not eligible for clearance',
      details: { statusOk, allClearancesApproved, allTasksDone, settlementPaid },
    });
  }

  // 3) Build code + verification link
  const code = `CLR-${r.employee.employeeCode}-${format(new Date(), 'yyyyMMdd-HHmm')}`;
  const verifyUrl = `${APP_PUBLIC_URL}/verify/clearance/${code}`;

  // 4) Generate PDF (temp file)
  const { filePath, fileName } = await generateClearancePdf({
    code,
    issuedAt: new Date(),
    verifyUrl,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
    employeeCode: r.employee.employeeCode,
    departmentName: r.employee.Department?.name ?? null,
    branchName: r.employee.Branch?.name ?? null,
    dateOfJoining: r.employee.dateOfJoining,
    lastWorkingDay: r.actualLastWorkingDay ?? r.proposedLastWorkingDay,
    clearances: r.clearances.map(c => ({
      type: String(c.type),
      decision: c.decision as any, // 'PENDING' | 'APPROVED' | 'REJECTED'
      decidedAt: c.decidedAt,
      note: c.note,
    })),
    companyName: COMPANY_NAME,
    companyLogoUrl: COMPANY_LOGO_URL,
    companyTagline: COMPANY_TAGLINE,
  });

  // 5) Upload to FTP
  const remotePath = `${FTP_PUBLIC_DIR}/${fileName}`; // e.g. /public_html/certificate/CLR-EMP001-20250819-1234.pdf
  await uploadToFTP(filePath, remotePath);

  // 6) Public URL to return & persist
  // If your Hostinger public dir maps to https://hrproindia.in/certificate/
  // ensure your FTP_PUBLIC_DIR is /public_html/certificate
  const filePublicPath = remotePath.replace('/public_html', ''); // -> /certificate/xxx.pdf
  const publicUrl = `${PUBLIC_BASE_URL}${filePublicPath}`;

  // 7) Persist URL + code
  await prisma.resignationDocument.upsert({
    where: { resignationId: r.id },
    create: { resignationId: r.id, clearanceCertificateUrl: publicUrl, clearanceCertificateCode: code, clearanceIssuedAt: new Date(),  },
    update: { clearanceCertificateUrl: publicUrl, clearanceCertificateCode: code, clearanceIssuedAt: new Date() },
  });
  

  // 8) Cleanup temp
  try { await fsp.unlink(filePath); } catch {}

  return res.json({ url: publicUrl, code });
};
async function generateClearancePdf(input: ClearanceCertInput): Promise<{ filePath: string; fileName: string; }> {
  const fileName = `${input.code}.pdf`;
  const filePath = path.join(os.tmpdir(), fileName);

  const doc = new PDFDocument({ size: 'A4', margin: 36 }); // 595 x 842 pt
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const w = doc.page.width, h = doc.page.height;
  const M = 36;

  const fmtDate = (d?: Date | null) =>
    d ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d) : '—';

  async function fetchBuffer(url?: string) {
    if (!url) return null;
    try {
      const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
      return Buffer.from(res.data);
    } catch {
      return null;
    }
  }
  function dataURLtoBuffer(dataUrl: string) {
    const base64 = dataUrl.split(',')[1];
    return Buffer.from(base64, 'base64');
  }

  // Borders
  doc.save().roundedRect(18, 18, w - 36, h - 36, 12).lineWidth(3).stroke('#1f2937').restore();
  doc.save().roundedRect(28, 28, w - 56, h - 56, 10).lineWidth(1).stroke('#9ca3af').restore();

  // Header
  let cursorY = 54;
  const logo = await fetchBuffer(input.companyLogoUrl);
  if (logo) {
    const logoW = 72;
    doc.image(logo, (w - logoW) / 2, cursorY, { width: logoW });
    cursorY += 84;
  }

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827')
     .text(input.companyName, M, cursorY, { width: w - 2 * M, align: 'center' });
  cursorY = doc.y;

  if (input.companyTagline) {
    doc.font('Helvetica').fontSize(10).fillColor('#6b7280')
       .text(input.companyTagline, M, cursorY + 2, { width: w - 2 * M, align: 'center' });
    cursorY = doc.y;
  }

  // Meta
  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(10).fillColor('#374151');
  doc.text(`Issued on: ${fmtDate(input.issuedAt)}`, M, doc.y, { width: (w - 2 * M) / 2, align: 'left' });
  doc.text(`Certificate ID: ${input.code}`, M + (w - 2 * M) / 2, doc.y - 12, { width: (w - 2 * M) / 2, align: 'right' });
  cursorY = doc.y + 6;

  // Title
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#1f2937')
     .text('CLEARANCE CERTIFICATE', M, cursorY, { width: w - 2 * M, align: 'center' });
  cursorY = doc.y + 8;

  // Employee Panel
  const panelX = M;
  const panelW = w - 2 * M;
  let panelY = cursorY;
  const panelPad = 10;
  const summaryStartY = panelY + panelPad;
  const leftW = panelW / 2 - 8;
  const rightW = panelW / 2 - 8;

  doc.font('Helvetica').fontSize(12).fillColor('#111827');
  let yL = summaryStartY;
  doc.text(`Employee Name: ${input.employeeName}`, panelX + panelPad, yL, { width: leftW }); yL = doc.y + 4;
  doc.text(`Employee Code: ${input.employeeCode}`, panelX + panelPad, yL, { width: leftW }); yL = doc.y + 4;
  doc.text(`Date of Joining: ${fmtDate(input.dateOfJoining ?? null)}`, panelX + panelPad, yL, { width: leftW });

  let yR = summaryStartY;
  doc.text(`Department: ${input.departmentName ?? '—'}`, panelX + panelPad + leftW + 16, yR, { width: rightW }); yR = doc.y + 4;
  doc.text(`Branch: ${input.branchName ?? '—'}`, panelX + panelPad + leftW + 16, yR, { width: rightW }); yR = doc.y + 4;
  doc.text(`Last Working Day: ${fmtDate(input.lastWorkingDay ?? null)}`, panelX + panelPad + leftW + 16, yR, { width: rightW });

  const panelH = Math.max(yL, yR) - summaryStartY + panelPad + 10;
  doc.save().roundedRect(panelX, panelY, panelW, panelH, 8).lineWidth(1).stroke('#e5e7eb').restore();
  cursorY = panelY + panelH + 10;

  // Statement
  doc.font('Helvetica').fontSize(12).fillColor('#374151')
     .text('This is to certify that the above employee has completed the exit formalities and has no dues pending with the company as on the date of issue.',
           M, cursorY, { width: w - 2 * M, align: 'left' });
  cursorY = doc.y + 10;

  // Table
  const tableX = M;
  const pageBottom = h - 140; // leave room for QR/signatures
  const colWidths = [120, 90, 100, (w - 2 * M) - (120 + 90 + 100)];
  const headerH = 22;
  let y = cursorY;

  const drawHeader = () => {
    drawRow({ doc, x: tableX, y, heights: headerH, widths: colWidths, cells: ['Clearance Area', 'Decision', 'Approved On', 'Notes'], header: true });
    y += headerH;
  };
  drawHeader();

  for (const c of input.clearances) {
    const cells = [c.type, c.decision, fmtDate(c.decidedAt ?? null), c.note ?? ''];
    const neededH = measureRowHeight({ doc, widths: colWidths, cells });
    if (y + neededH > pageBottom) {
      doc.addPage();
      y = M;
      // repeat header on new page
      drawHeader();
    }
    y += drawRow({ doc, x: tableX, y, heights: 22, widths: colWidths, cells });
  }

  // QR + signatures
  // const qrDataUrl = await QRCode.toDataURL(input.verifyUrl);
  // const qrBuf = dataURLtoBuffer(qrDataUrl);
  // const qrSize = 96;
  // const qrX = w - M - qrSize;
  // const qrY = Math.min(h - 180, y + 12);
  // doc.image(qrBuf, qrX, qrY, { width: qrSize });
  // doc.font('Helvetica').fontSize(10).fillColor('#6b7280')
  //    .text('Scan to verify', qrX, qrY + qrSize + 4, { width: qrSize, align: 'center' });

  const sigY = Math.min(h - 180, y + 12) + 20;
  doc.moveTo(M + 30, sigY).lineTo(M + 180, sigY).stroke('#9ca3af');
  doc.moveTo(M + 230, sigY).lineTo(M + 380, sigY).stroke('#9ca3af');
  doc.font('Helvetica').fontSize(10).fillColor('#374151')
     .text('HR Representative', M + 30, sigY + 6, { width: 150, align: 'center' })
     .text('Department Head', M + 230, sigY + 6, { width: 150, align: 'center' });

  doc.font('Helvetica').fontSize(10).fillColor('#6b7280');
  doc.text('This is a system-generated document and does not require a physical signature.', M, h - 70, {
    width: w - 2 * M, align: 'center'
  });

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return { filePath, fileName };

  // ------- helpers -------
  function measureRowHeight(opts: { doc: PDFKit.PDFDocument; widths: number[]; cells: string[] }) {
    const padX = 6, padY = 6;
    let maxH = 22;
    const originalY = (doc as any).y;
    for (let i = 0; i < opts.cells.length; i++) {
      const width = opts.widths[i] - padX * 2;
      const height = (doc as any).heightOfString(opts.cells[i] ?? '', { width, align: 'left' });
      maxH = Math.max(maxH, height + padY * 2);
    }
    (doc as any).y = originalY;
    return maxH;
  }

  function drawRow(opts: {
    doc: PDFKit.PDFDocument;
    x: number; y: number;
    widths: number[]; heights: number;
    cells: string[]; header?: boolean;
  }): number {
    const padX = 6, padY = 6;
    const baseY = opts.y;
    const totalW = opts.widths.reduce((a, b) => a + b, 0);

    if (opts.header) {
      doc.save().rect(opts.x, baseY, totalW, opts.heights).fill('#f3f4f6').restore();
      doc.lineWidth(1).strokeColor('#e5e7eb').rect(opts.x, baseY, totalW, opts.heights).stroke();
      doc.font('Helvetica-Bold').fillColor('#111827').fontSize(11);
    } else {
      doc.lineWidth(1).strokeColor('#e5e7eb').rect(opts.x, baseY, totalW, opts.heights).stroke();
      doc.font('Helvetica').fillColor('#111827').fontSize(11);
    }

    let cx = opts.x;
    let maxY = baseY + opts.heights;
    for (let i = 0; i < opts.cells.length; i++) {
      const cellW = opts.widths[i];
      const tx = cx + padX;
      const ty = baseY + padY;
      const options = { width: cellW - padX * 2, align: 'left' } as PDFKit.Mixins.TextOptions;
      const startY = (doc as any).y;
      doc.text(opts.cells[i] ?? '', tx, ty, options);
      maxY = Math.max(maxY, (doc as any).y + padY);
      (doc as any).y = startY;
      cx += cellW;
    }

    const finalH = Math.max(opts.heights, maxY - baseY);
    if (finalH > opts.heights) {
      doc.lineWidth(1).strokeColor('#e5e7eb').rect(opts.x, baseY, totalW, finalH).stroke();
    }

    // vertical separators
    let vx = opts.x;
    for (let i = 0; i < opts.widths.length - 1; i++) {
      vx += opts.widths[i];
      doc.moveTo(vx, baseY).lineTo(vx, baseY + finalH).stroke('#e5e7eb');
    }

    return finalH;
  }
}


const FTP_CONFIG = {
  host: "srv680.main-hosting.eu",  // Your FTP hostname
  user: "u948610439.hrproindia.in",       // Your FTP username
  password: "Bsrenuk@1993",   // Your FTP password
  secure: false                    // Set to true if using FTPS
}
export async function uploadToFTP(localFilePath: string, remoteFilePath: string) {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(FTP_CONFIG);
    // Ensure parent dir exists (e.g., /public_html/certificate)
    const lastSlash = remoteFilePath.lastIndexOf('/');
    const remoteDir = remoteFilePath.substring(0, lastSlash);
    if (remoteDir) await client.ensureDir(remoteDir);
    await client.uploadFrom(localFilePath, remoteFilePath);
  } finally {
    client.close();
  }
}