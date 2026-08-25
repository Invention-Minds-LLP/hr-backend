// ─────────────────────────────────────────────────────────────────────────────
//  Image compression for uploads.
//
//  Every upload in the system lands in fileStorage.saveLocal(), which calls
//  compressImageFile() before writing the permanent copy. Images are re-encoded
//  to fit under a hard size ceiling (IMAGE_MAX_BYTES, default 50 KB); everything
//  else — PDFs, xlsx/docx (already zip-compressed), animated GIFs — is passed
//  through untouched.
//
//  Reaching 50 KB on a phone photo means giving something up. We give up quality
//  before resolution: for scanned documents (prescriptions, vaccine
//  certificates, BGV evidence) printed text stays legible at a low JPEG quality
//  far longer than it survives being scaled down, so the widest size that can
//  reach the ceiling at all is chosen first, and only then is quality raised as
//  far as the ceiling allows.
//
//  Cost matters: this runs inline on the upload request. The source is decoded
//  and resized at most a handful of times (both the width and the quality search
//  are binary, and each candidate width is decoded once into a raw buffer that
//  every quality probe re-encodes from), instead of once per probe.
//
//  Nothing here is allowed to fail an upload. Any error, unreadable file, or
//  result bigger than the original falls back to the original bytes.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import sharp from "sharp";
import type { Metadata, OutputInfo } from "sharp";
import { config } from "../config";

// Hard ceiling for a stored image. Env-tunable so document-heavy tenants can
// raise it without a code change.
export const IMAGE_MAX_BYTES = config.imageMaxBytes;

// Formats we re-encode. Anything else (gif, svg, tiff, pdf, office docs) is
// stored as-is: animated GIFs would be flattened to a single frame and SVG is
// already text.
const COMPRESSIBLE = new Set(["jpeg", "png", "webp"]);

// Long-edge caps, widest first. The widest rung that can reach the ceiling wins.
const WIDTH_LADDER = [2000, 1600, 1200, 900, 700, 500];

// Quality search bounds. Below ~35 JPEG blocking makes small print unreadable,
// so we narrow the image rather than push quality lower.
const Q_MIN = 35;
const Q_MAX = 85;

// Palette sizes tried for PNGs that cannot reach the ceiling on quality alone.
// Photographic PNGs (screenshots of photos, phone shots saved as PNG) do not
// quantise well, so this is the difference between hitting 50 KB and missing it.
const PNG_COLOUR_STEPS = [256, 128, 64, 32];

type Raw = { data: Buffer; info: OutputInfo };

// Re-encode an already-resized raw pixel buffer. Keeps the source format so the
// stored filename and its public URL stay correct.
function encode(raw: Raw, format: string, quality: number, colours = 256): Promise<Buffer> {
  const img = sharp(raw.data, {
    raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels },
  });
  switch (format) {
    case "jpeg":
      return img.jpeg({ quality, mozjpeg: true }).toBuffer();
    case "png":
      // sharp's png quality/colours only take effect with palette quantisation
      // on. effort 4 keeps this off the critical path; 7+ costs seconds.
      return img.png({ quality, colours, palette: true, compressionLevel: 9, effort: 4 }).toBuffer();
    case "webp":
      return img.webp({ quality }).toBuffer();
    default:
      return img.toBuffer();
  }
}

// Decode + auto-rotate + resize once, to raw pixels. Every quality probe at this
// width re-encodes from the result instead of re-decoding the source.
//
// rotate() applies the EXIF orientation and then drops the tag, so portrait
// phone photos do not come out sideways once metadata is stripped.
function resizeToRaw(input: Buffer, cap: number): Promise<Raw> {
  return sharp(input, { sequentialRead: true })
    .rotate()
    .resize({ width: cap, height: cap, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true }) as Promise<Raw>;
}

// Highest quality at this width that fits under maxBytes. Assumes Q_MIN already
// fits. ~5 encodes off a raw buffer, no re-decode.
async function bestQuality(
  raw: Raw,
  format: string,
  maxBytes: number,
  colours: number,
  floor: Buffer
): Promise<Buffer> {
  let best = floor;
  let lo = Q_MIN + 1;
  let hi = Q_MAX;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const buf = await encode(raw, format, mid, colours);
    if (buf.length <= maxBytes) {
      best = buf;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Compress `input` to at most `maxBytes`, preserving its format.
 *
 * Returns the original buffer when the file is not a compressible image, is
 * already under the ceiling, cannot be read, or when compression would make it
 * larger. When no width on the ladder can reach the ceiling, returns the
 * smallest result achieved and logs it rather than failing the upload.
 */
export async function compressImageBuffer(
  input: Buffer,
  maxBytes: number = IMAGE_MAX_BYTES
): Promise<Buffer> {
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    return input; // not an image sharp can read
  }

  const format = meta.format || "";
  if (!COMPRESSIBLE.has(format)) return input;
  if (meta.pages && meta.pages > 1) return input; // animated webp / multi-page
  if (input.length <= maxBytes) return input; // already small — no re-encode, no quality loss

  // Only consider widths that would actually shrink the image, but always keep
  // the narrowest rung so a small-but-heavy image still gets a quality pass.
  const longEdge = Math.max(meta.width || 0, meta.height || 0);
  const ladder = WIDTH_LADDER.filter(
    (c, i) => !longEdge || c <= longEdge || i === WIDTH_LADDER.length - 1
  );

  const rawCache = new Map<number, Raw>();
  const raw = async (i: number) => {
    let r = rawCache.get(i);
    if (!r) {
      r = await resizeToRaw(input, ladder[i]);
      rawCache.set(i, r);
    }
    return r;
  };

  // Phase 1 — binary search the ladder for the widest rung (lowest index) whose
  // floor-quality encode fits. File size grows with width, so this is monotonic.
  let lo = 0;
  let hi = ladder.length - 1;
  let chosen = -1;
  let chosenFloor: Buffer | null = null;
  let widest: Buffer | null = null; // best-effort fallback if nothing fits

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const floor = await encode(await raw(mid), format, Q_MIN);
    if (floor.length <= maxBytes) {
      chosen = mid;
      chosenFloor = floor;
      hi = mid - 1;
    } else {
      if (!widest || floor.length < widest.length) widest = floor;
      lo = mid + 1;
    }
  }

  // Phase 2 — at the chosen width, raise quality as far as the ceiling allows.
  if (chosen >= 0 && chosenFloor) {
    const out = await bestQuality(await raw(chosen), format, maxBytes, 256, chosenFloor);
    return out.length < input.length ? out : input;
  }

  // Nothing fit on quality alone. For PNG, quantise the palette down before
  // giving up — this is what gets photographic PNGs under the ceiling.
  if (format === "png") {
    const narrowest = await raw(ladder.length - 1);
    for (const colours of PNG_COLOUR_STEPS.slice(1)) {
      const buf = await encode(narrowest, format, Q_MIN, colours);
      if (!widest || buf.length < widest.length) widest = buf;
      if (buf.length <= maxBytes) {
        return buf.length < input.length ? buf : input;
      }
    }
  }

  console.warn(
    `[imageCompress] could not reach ${maxBytes} bytes for a ${meta.width}x${meta.height} ` +
      `${format}; stored ${widest?.length ?? input.length} bytes`
  );
  if (widest && widest.length < input.length) return widest;
  return input;
}

/**
 * Read `srcPath`, compress it if it is an image, and return the bytes to store.
 * Never throws — a failure returns the untouched file contents.
 */
export async function compressImageFile(
  srcPath: string,
  maxBytes: number = IMAGE_MAX_BYTES
): Promise<Buffer> {
  const original = await fs.promises.readFile(srcPath);
  try {
    return await compressImageBuffer(original, maxBytes);
  } catch (err) {
    console.error("[imageCompress] falling back to original:", err);
    return original;
  }
}
