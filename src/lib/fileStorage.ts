// ─────────────────────────────────────────────────────────────────────────────
//  Local file storage (replaces the old FTP-to-Hostinger upload path)
//
//  Files used to be pushed over FTP to srv680.main-hosting.eu and served from
//  https://hrproindia.in/<folder>/<file>. We now store uploads on the server's
//  own disk (the Oracle instance) under UPLOADS_DIR and serve them at
//  <PUBLIC_BASE_URL>/uploads/<folder>/<file> (express.static + nginx).
//
//  The legacy controllers build remote paths like "/public_html/documents/x.pdf"
//  and public URLs like "https://hrproindia.in/documents/x.pdf". To keep those
//  call sites almost unchanged, the helpers here accept the SAME remote-path
//  strings, strip the historical "/public_html/" prefix, and map them onto
//  UPLOADS_DIR. The FTP code is left in place (commented) as a fallback.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { config } from "../config";

// Root directory where uploaded files live. In Docker this is a mounted volume
// (UPLOADS_DIR=/usr/src/app/uploads); locally it defaults to <cwd>/uploads.
export const UPLOADS_DIR =
  (config.uploadsDir && config.uploadsDir.trim()) ||
  path.join(process.cwd(), "uploads");

// Normalise a legacy "/public_html/documents/x.pdf" (or a plain
// "documents/x.pdf") to the relative sub-path "documents/x.pdf".
export function toSubPath(remoteOrSubPath: string): string {
  let p = remoteOrSubPath.replace(/\\/g, "/").trim();
  p = p.replace(/^\/?public_html\//i, ""); // drop "/public_html/" or "public_html/"
  p = p.replace(/^\/+/, "");               // drop any remaining leading slashes
  return p;
}

// Copy a freshly-uploaded temp file (from multer/formidable) into permanent
// storage. `remoteOrSubPath` may be a legacy "/public_html/<folder>/<file>" or a
// plain "<folder>/<file>" — both resolve to UPLOADS_DIR/<folder>/<file>.
// Returns the stored sub-path.
export async function saveLocal(
  localTempPath: string,
  remoteOrSubPath: string
): Promise<string> {
  const sub = toSubPath(remoteOrSubPath);
  const dest = path.join(UPLOADS_DIR, sub);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.copyFile(localTempPath, dest);
  return sub;
}

// Public URL for a stored file. Pass the same remote/sub path used to save it.
export function publicUrl(remoteOrSubPath: string): string {
  const sub = toSubPath(remoteOrSubPath);
  const base = (config.publicBaseUrl || "").replace(/\/+$/, "");
  return `${base}/uploads/${sub}`;
}

// Delete a stored file. A missing file is not treated as an error.
export async function deleteLocal(remoteOrSubPath: string): Promise<void> {
  const sub = toSubPath(remoteOrSubPath);
  const dest = path.join(UPLOADS_DIR, sub);
  try {
    await fs.promises.unlink(dest);
  } catch (err: any) {
    if (err && err.code !== "ENOENT") throw err;
  }
}
