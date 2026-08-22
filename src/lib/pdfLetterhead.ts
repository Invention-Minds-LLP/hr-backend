/**
 * Optional full-page letterhead behind generated PDFs.
 *
 * Per-deployment, not per-codebase: HRMinds runs for several clients, so the
 * artwork comes from PDF_LETTERHEAD_PATH rather than being baked in. No env var,
 * a missing file, or an unreadable one — the helper is a no-op and the PDF
 * renders plain. A letterhead must never be the reason a payslip fails to
 * generate.
 *
 * The artwork is expected to match the page aspect ratio (A4 is 1:1.4142); it is
 * stretched to the full page, so a mismatched image will distort.
 *
 * Callers are responsible for margins large enough to clear the artwork's header
 * and footer bands — see LETTERHEAD_SAFE_MARGINS.
 */

import fs from "fs";
import path from "path";

/**
 * Measured from assets/letterhead-jmrh.png: the header band ends 8.12% down
 * (68pt on A4) and the footer strip starts at 99% (8pt from the bottom). Rounded
 * up for breathing room.
 */
export const LETTERHEAD_SAFE_MARGINS = { top: 80, bottom: 40, left: 36, right: 36 };

let cachedPath: string | null | undefined;

/**
 * Resolve the configured letterhead once. Relative paths resolve from the
 * backend root, so `assets/letterhead-jmrh.png` works in dev (ts-node from src)
 * and in production (node from dist) alike.
 */
export function letterheadPath(): string | null {
  if (cachedPath !== undefined) return cachedPath;

  const configured = process.env.PDF_LETTERHEAD_PATH?.trim();
  if (!configured) {
    cachedPath = null;
    return cachedPath;
  }

  const resolved = path.isAbsolute(configured)
    ? configured
    // __dirname is <root>/dist/lib in production and <root>/src/lib in dev.
    : path.resolve(__dirname, "..", "..", configured);

  try {
    cachedPath = fs.existsSync(resolved) ? resolved : null;
    if (!cachedPath) {
      console.warn(`[pdfLetterhead] PDF_LETTERHEAD_PATH set but not found: ${resolved}`);
    }
  } catch {
    cachedPath = null;
  }
  return cachedPath;
}

/** True when a usable letterhead is configured. */
export function hasLetterhead(): boolean {
  return letterheadPath() !== null;
}

/**
 * Draw the letterhead on the current page and on every page added afterwards.
 * Call immediately after creating the document, before writing any content.
 *
 * pdfkit does not fire `pageAdded` for the first page, so that one is drawn
 * directly. Each draw is wrapped in save/restore and the cursor is returned to
 * the top margin, so callers can lay out as if the background were not there.
 */
export function applyLetterhead(doc: PDFKit.PDFDocument): void {
  const file = letterheadPath();
  if (!file) return;

  const draw = () => {
    try {
      doc.save();
      doc.image(file, 0, 0, { width: doc.page.width, height: doc.page.height });
      doc.restore();
    } catch (err: any) {
      // A corrupt image must not abort the document.
      console.warn(`[pdfLetterhead] could not draw letterhead: ${err?.message}`);
    }
    doc.x = doc.page.margins.left;
    doc.y = doc.page.margins.top;
  };

  draw();
  doc.on("pageAdded", draw);
}
