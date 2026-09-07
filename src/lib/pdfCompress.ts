// ─────────────────────────────────────────────────────────────────────────────
//  PDF compression for uploads (Ghostscript).
//
//  Savings in a PDF come almost entirely from re-encoding the page images a
//  scan is made of. There is no pure-JS route to that, so this shells out to
//  Ghostscript with the /ebook preset. Measured on a 5-page 300dpi scan:
//  4010 KB → 805 KB with the text still sharp.
//
//  A text/vector PDF has nothing to re-encode — its bulk is embedded font data,
//  already deflated. Ghostscript rewrites and re-subsets those fonts and comes
//  out LARGER (measured: a 56-page WeasyPrint document, 451 KB → 462 KB). So
//  the result is kept only when it is actually smaller, which sorts scans from
//  text PDFs without having to inspect the file.
//
//  Ghostscript is installed in the Docker image. When the binary is missing —
//  a dev box, a host that skipped the rebuild — this degrades to storing the
//  original rather than failing the upload.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { config } from "../config";

// Ghostscript is CPU-bound and runs inline on the upload request. A pathological
// or hostile PDF must not hold the request open indefinitely.
const GS_TIMEOUT_MS = 60_000;

// Ghostscript's own name differs by platform; on Windows dev boxes it is
// gswin64c. First one that answers `--version` wins.
const GS_CANDIDATES =
  process.platform === "win32" ? ["gswin64c", "gswin32c", "gs"] : ["gs"];

// Resolved once per process: the usable binary name, or null when none is
// installed. `undefined` means "not looked up yet".
let gsBinary: string | null | undefined;

// A typo in PDF_PRESET would otherwise reach Ghostscript as a nonsense
// -dPDFSETTINGS and fail every PDF silently.
const PRESETS = new Set(["screen", "ebook", "printer", "prepress"]);
const PRESET = PRESETS.has(config.pdfPreset) ? config.pdfPreset : "ebook";

function run(bin: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, windowsHide: true }, (err) =>
      err ? reject(err) : resolve()
    );
  });
}

/** The Ghostscript binary to use, or null when it is not installed. */
export async function ghostscript(): Promise<string | null> {
  if (gsBinary !== undefined) return gsBinary;

  for (const bin of GS_CANDIDATES) {
    try {
      await run(bin, ["--version"], 10_000);
      gsBinary = bin;
      return gsBinary;
    } catch {
      /* try the next candidate */
    }
  }

  console.warn(
    "[pdfCompress] Ghostscript not found — PDFs will be stored uncompressed. " +
      "Install it in the runtime image (apt-get install ghostscript)."
  );
  gsBinary = null;
  return null;
}

/**
 * Compress the PDF at `srcPath`, returning the bytes to store.
 *
 * Returns the original contents when Ghostscript is unavailable or disabled,
 * when it fails or times out, or when its output is not smaller than the input
 * (the text-PDF case). Never throws.
 */
export async function compressPdfFile(srcPath: string): Promise<Buffer> {
  const original = await fs.promises.readFile(srcPath);
  if (!config.pdfCompress) return original;

  const bin = await ghostscript();
  if (!bin) return original;

  const out = path.join(
    os.tmpdir(),
    `gs-${process.pid}-${crypto.randomBytes(6).toString("hex")}.pdf`
  );

  try {
    await run(
      bin,
      [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        `-dPDFSETTINGS=/${PRESET}`,
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        // Uploads are untrusted input; SAFER blocks the PostScript file
        // operators. Default since gs 9.50, set explicitly for older builds.
        "-dSAFER",
        // Ghostscript would otherwise re-orient pages by guessing at the text
        // direction, which flips some scans on their side.
        "-dAutoRotatePages=/None",
        `-sOutputFile=${out}`,
        srcPath,
      ],
      GS_TIMEOUT_MS
    );

    const compressed = await fs.promises.readFile(out);

    // A PDF that grew is a text/vector PDF — keep the original. Also sanity
    // check the header: a truncated or empty result must never be stored.
    if (compressed.length >= original.length) return original;
    if (compressed.subarray(0, 5).toString("latin1") !== "%PDF-") return original;

    return compressed;
  } catch (err) {
    console.error("[pdfCompress] falling back to original:", err);
    return original;
  } finally {
    fs.promises.unlink(out).catch(() => {});
  }
}
