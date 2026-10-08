import PDFDocument from "pdfkit";
import { resolve } from "path";

export const FONT = "Helvetica";
export const FONT_BOLD = "Helvetica-Bold";

export interface Cell { text: string; bold?: boolean; align?: "left" | "center"; }

const letterheadPath = resolve(process.cwd(), "assets", "JMRH-letterhead.png");

export function createLetterheadDoc() {
  const margins = { top: 120, bottom: 75, left: 36, right: 36 };
  const doc = new PDFDocument({ size: "A4", margins, layout: "portrait" });

  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const drawLetterhead = () => {
    doc.save();
    doc.image(letterheadPath, 0, 0, { width: doc.page.width, height: doc.page.height });
    doc.restore();
  };
  doc.on("pageAdded", drawLetterhead);
  drawLetterhead();

  const state = { y: margins.top };
  const bottom = doc.page.height - margins.bottom;
  const usable = doc.page.width - margins.left - margins.right;

  const ensure = (need: number) => {
    if (state.y + need > bottom) {
      doc.addPage();
      state.y = margins.top;
    }
  };

  return { doc, done, margins, state, bottom, usable, ensure };
}

export function drawRow(
  doc: PDFKit.PDFDocument, cells: Cell[], widths: number[],
  x: number, y: number, minHeight = 18,
): number {
  const pad = 4;
  const heights = cells.map((c, i) => {
    doc.font(c.bold ? FONT_BOLD : FONT).fontSize(8);
    return doc.heightOfString(c.text || "", { width: widths[i] - pad * 2 }) + pad * 2;
  });
  const h = Math.max(minHeight, ...heights);

  let cx = x;
  cells.forEach((c, i) => {
    doc.rect(cx, y, widths[i], h).strokeColor("#000").lineWidth(0.5).stroke();
    doc.font(c.bold ? FONT_BOLD : FONT).fontSize(8).fillColor("#000");
    doc.text(c.text || "", cx + pad, y + pad, { width: widths[i] - pad * 2, align: c.align || "left" });
    cx += widths[i];
  });
  return h;
}