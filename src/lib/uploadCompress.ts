// ─────────────────────────────────────────────────────────────────────────────
//  Upload compression dispatcher.
//
//  fileStorage.saveLocal() calls this for every upload in the system, so this
//  is the one place that decides what a given file gets. Routing is by content
//  signature rather than by the client-supplied extension, except for OOXML,
//  which is indistinguishable from any other ZIP without it.
//
//    jpeg / png / webp   re-encoded under IMAGE_MAX_BYTES   (imageCompress)
//    pdf                 Ghostscript, kept if smaller       (pdfCompress)
//    docx / xlsx / pptx  embedded media re-encoded          (officeCompress)
//    everything else     stored byte-for-byte
//
//  Every path fails open: an upload is never rejected because compression
//  could not run.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { compressImageFile } from "./imageCompress";
import { compressOfficeFile } from "./officeCompress";
import { compressPdfFile } from "./pdfCompress";

// Enough to tell %PDF- and PK.. apart. Images are sniffed by sharp itself.
async function magic(srcPath: string, bytes = 8): Promise<Buffer> {
  const fh = await fs.promises.open(srcPath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Compress the upload at `srcPath` and return the bytes to store.
 * `destName` is the filename it will be stored under — used only to tell an
 * OOXML document from an ordinary ZIP.
 */
export async function compressUpload(srcPath: string, destName: string): Promise<Buffer> {
  let head: Buffer;
  try {
    head = await magic(srcPath);
  } catch {
    return fs.promises.readFile(srcPath);
  }

  if (head.subarray(0, 5).toString("latin1") === "%PDF-") {
    return compressPdfFile(srcPath);
  }

  if (head[0] === 0x50 && head[1] === 0x4b) {
    return compressOfficeFile(srcPath, path.basename(destName));
  }

  return compressImageFile(srcPath);
}
