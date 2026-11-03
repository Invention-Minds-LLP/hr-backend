import { Response } from 'express';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Footer stamp for server-generated downloads (DPDP traceability).
 *
 * Rather than touching every PDF / Excel generator, requireDownloadGrant calls
 * stampResponse(): the handler's output is buffered, the "Download ID …" line
 * is added, and the result is sent.
 *   • PDF  — a small grey line at the bottom of every page
 *   • XLSX — a row under the data on every sheet, plus the printed footer
 *   • anything else (e.g. statutory upload files, whose format a government
 *     portal validates) is left byte-for-byte as is; the ID still goes out in
 *     the X-Download-Id header and is on the DownloadLog row.
 */

async function stampPdf(body: Buffer, text: string): Promise<Buffer> {
  // Password-protected PDFs throw here and are sent unstamped (see caller).
  const doc = await PDFDocument.load(body);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 7;
  const textWidth = font.widthOfTextAtSize(text, size);
  for (const page of doc.getPages()) {
    const { width } = page.getSize();
    page.drawText(text, {
      x: Math.max(12, (width - textWidth) / 2),
      y: 18, // above most printers' ~5 mm unprintable bottom margin
      size,
      font,
      color: rgb(0.42, 0.42, 0.42),
    });
  }
  return Buffer.from(await doc.save());
}

async function stampXlsx(body: Buffer, text: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as any);
  const printFooter = `&L&8${text.replace(/&/g, '&&')}`;
  wb.eachSheet((ws) => {
    const row = ws.getRow(ws.rowCount + 2);
    const cell = row.getCell(1);
    cell.value = text;
    cell.font = { italic: true, size: 8, color: { argb: 'FF666666' } };
    row.commit();
    ws.headerFooter = { ...ws.headerFooter, oddFooter: printFooter, evenFooter: printFooter };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function stampDownload(body: Buffer, contentType: string, text: string): Promise<Buffer | null> {
  const ct = contentType.toLowerCase();
  if (ct.includes('application/pdf')) return stampPdf(body, text);
  if (ct.includes('spreadsheetml')) return stampXlsx(body, text);
  return null; // other formats are not altered
}

/**
 * Buffers everything the route handler writes (res.write / res.end / res.send,
 * including exceljs streaming into res) and stamps it on the way out.
 */
export function stampResponse(res: Response, code: string, text: string): void {
  const chunks: Buffer[] = [];
  const origEnd = res.end.bind(res) as (...args: any[]) => Response;
  let finished = false;

  const toBuffer = (chunk: any, enc?: any): Buffer =>
    Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? (enc as BufferEncoding) : undefined);

  (res as any).write = (chunk: any, enc?: any, cb?: any) => {
    if (chunk != null && !finished) chunks.push(toBuffer(chunk, enc));
    const done = typeof enc === 'function' ? enc : cb;
    if (typeof done === 'function') process.nextTick(done);
    return true;
  };

  (res as any).end = (chunk?: any, enc?: any, cb?: any) => {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
    else if (typeof enc === 'function') { cb = enc; enc = undefined; }
    if (finished) { // e.g. a piped stream ended res and the handler calls end() again
      if (typeof cb === 'function') process.nextTick(cb);
      return res;
    }
    finished = true;
    if (chunk != null) chunks.push(toBuffer(chunk, enc));
    const body = Buffer.concat(chunks);

    const send = (out: Buffer) => {
      if (!res.headersSent) {
        res.removeHeader('ETag');
        res.setHeader('Content-Length', out.length);
        res.setHeader('X-Download-Id', code);
      }
      origEnd(out, cb);
    };

    const contentType = String(res.getHeader('Content-Type') || '');
    if (res.statusCode !== 200 || !body.length) { send(body); return res; }
    stampDownload(body, contentType, text)
      .then((out) => send(out ?? body))
      .catch((err) => {
        console.warn(`[downloadStamp] could not stamp ${code} (${contentType}); sending unstamped:`, err?.message || err);
        send(body);
      });
    return res;
  };
}
