// ─────────────────────────────────────────────────────────────────────────────
//  Office document compression for uploads (docx / xlsx / pptx).
//
//  An OOXML file is a ZIP. Its XML parts are already deflated, so re-zipping
//  buys nothing (measured: 1408 KB → 1408 KB at deflate level 9). Effectively
//  all the weight of a large document is the images under word|xl|ppt/media/,
//  stored at whatever resolution someone pasted them in at. Running those
//  through the same image pipeline used for direct uploads and rebuilding the
//  archive: 1408 KB → 93 KB, measured on a document holding two 783 KB scans.
//
//  Rewriting somebody's document is riskier than rewriting a JPEG, so the
//  rebuild is verified before it is accepted: it must re-open as a ZIP and
//  still contain exactly the same entry names. Anything unexpected and the
//  original is stored untouched.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import JSZip from "jszip";
import { compressImageBuffer, IMAGE_MAX_BYTES } from "./imageCompress";

// Media parts of the three OOXML families. Anything else in the archive (XML,
// relationships, embedded fonts, OLE objects) is copied through untouched.
const MEDIA_PATH = /^(word|xl|ppt)\/media\//i;

// Only these are re-encoded; the image pipeline passes everything else through
// anyway, but checking here avoids unzipping metafiles for no reason.
const MEDIA_EXT = /\.(jpe?g|png|webp)$/i;

// A document this large is more likely a mistake than something worth loading
// into memory whole on the request path.
const MAX_ARCHIVE_BYTES = 60 * 1024 * 1024;

// OOXML magic. Every one of these is a ZIP, so the extension is what separates
// them from a plain .zip upload we should not touch.
const OOXML_EXT = /\.(docx|xlsx|pptx|docm|xlsm|pptm)$/i;

/** True when `name` looks like an OOXML file and `buf` really is a ZIP. */
export function isOfficeDocument(name: string, buf: Buffer): boolean {
  return (
    OOXML_EXT.test(name) &&
    buf.length >= 4 &&
    buf[0] === 0x50 && // P
    buf[1] === 0x4b && // K
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)
  );
}

/**
 * Re-encode the images inside an OOXML archive and return the rebuilt file.
 *
 * Returns the original buffer when the document holds no compressible media,
 * when nothing actually got smaller, or when the rebuilt archive fails
 * verification. Never throws.
 */
export async function compressOfficeBuffer(
  input: Buffer,
  maxBytes: number = IMAGE_MAX_BYTES
): Promise<Buffer> {
  if (input.length > MAX_ARCHIVE_BYTES) return input;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    return input; // not a readable zip
  }

  // Object.keys includes directory entries, which have no content to read.
  const names = Object.keys(zip.files);
  const media = names.filter(
    (n) => !zip.files[n].dir && MEDIA_PATH.test(n) && MEDIA_EXT.test(n)
  );
  if (!media.length) return input;

  let shrank = false;
  for (const name of media) {
    const before = await zip.files[name].async("nodebuffer");
    const after = await compressImageBuffer(before, maxBytes);
    if (after.length < before.length) {
      zip.file(name, after);
      shrank = true;
    }
  }
  if (!shrank) return input;

  const rebuilt = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  if (rebuilt.length >= input.length) return input;

  // Verify before handing back something that replaces a user's document: it
  // must re-open, and no part may have gone missing in the rebuild.
  try {
    const check = await JSZip.loadAsync(rebuilt);
    const got = new Set(Object.keys(check.files));
    if (names.some((n) => !got.has(n))) {
      console.warn("[officeCompress] rebuilt archive lost entries — keeping original");
      return input;
    }
  } catch {
    console.warn("[officeCompress] rebuilt archive did not re-open — keeping original");
    return input;
  }

  return rebuilt;
}

/**
 * Read `srcPath` and compress it if it is an OOXML document. Never throws — a
 * failure returns the untouched file contents.
 */
export async function compressOfficeFile(
  srcPath: string,
  fileName: string,
  maxBytes: number = IMAGE_MAX_BYTES
): Promise<Buffer> {
  const original = await fs.promises.readFile(srcPath);
  if (!isOfficeDocument(fileName, original)) return original;
  try {
    return await compressOfficeBuffer(original, maxBytes);
  } catch (err) {
    console.error("[officeCompress] falling back to original:", err);
    return original;
  }
}
