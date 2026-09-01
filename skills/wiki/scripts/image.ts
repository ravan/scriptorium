// Shared image inspection and junk classification, used by ingest.ts (the gate
// that keeps junk out of derived/media) and media.ts (the survey of what is left).
//
// "Junk" is an image that would waste an agent view without adding knowledge:
//   unviewable - vector formats (emf/wmf) an LLM cannot render
//   blank      - decodes to one flat colour when composited over white
//   tiny       - icons/bullets/logos below TINY_LONG_SIDE_PX on the long side
//   duplicate  - byte-identical to an earlier file in the same batch
// Near-duplicates (same picture, different encoding) are NEVER auto-skipped;
// media.ts only hints at them. Wrongly skipping a real diagram costs more than
// one wasted view.
//
// Separately, pageIsTextOnly() recognises a PDF `pages/` render that is only
// typeset text. Those are not junk and are not moved: the file stays put and
// media.ts merely reports it as a count, because its content already sits in
// text.*. Same bias as above - uncertainty means "show it".
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { sha256 } from "./common";

if (typeof Bun.Image !== "function") {
  console.error("These wiki scripts need Bun 1.4 or newer (they use Bun.Image). Update with: bun upgrade");
  process.exit(1);
}

export const TINY_LONG_SIDE_PX = 64; // long side below this = icon/bullet, not knowledge
export const UNVIEWABLE_FORMATS = new Set(["emf", "wmf"]);

export interface ImageInfo {
  bytes: number;
  format: string;
  width?: number;
  height?: number;
  blank: boolean; // proven single flat colour, safe to skip
  hash: string;
  /** True only when the bytes prove more than one frame. */
  animated?: boolean;
  /** Frames counted, when counting was cheap and certain. */
  frames?: number;
}

/** Magic-byte sniffing, only for what Bun.Image (Bun >= 1.4) cannot decode:
 *  office vector formats and stray non-images. Raster formats come from
 *  Bun.Image.metadata() instead. */
export function formatOf(buf: Buffer): string {
  if (buf.length > 4 && buf.toString("ascii", 0, 4) === "%PDF") return "pdf";
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x464d4520) return "emf";
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x9ac6cdd7) return "wmf"; // placeable WMF
  if (buf.length > 4 && buf[0] === 0x01 && buf[1] === 0x00 && buf[2] === 0x09 && buf[3] === 0x00) return "wmf";
  return "unknown";
}

/**
 * Does this file actually move? `Bun.Image` reports a GIF's format and size but
 * says nothing about frames, so a still exported as .gif and a real animation
 * are indistinguishable to every other check here. That matters when a slide is
 * supposed to animate: the file arrives, the render log is clean, and the deck
 * is silently static.
 *
 * Counted from the bytes, so there is no ImageMagick (or any other external
 * tool) to install. Only the three animated formats Lolly exports are handled;
 * anything else returns `{ animated: false }` with no frame count rather than a
 * guess.
 */
export function animationOf(buf: Buffer): { animated: boolean; frames?: number } {
  // GIF: frames are Image Descriptor blocks (0x2C). They cannot be found by a
  // naive byte scan - 0x2C is ordinary pixel data too - so the block chain has
  // to be walked properly from the end of the header.
  if (buf.length > 6 && buf.toString("ascii", 0, 3) === "GIF") {
    let p = 13; // header (6) + logical screen descriptor (7)
    const flags = buf[10];
    if (flags === undefined) return { animated: false };
    if (flags & 0x80) p += 3 * (1 << ((flags & 0x07) + 1)); // global colour table
    let frames = 0;
    while (p < buf.length) {
      const block = buf[p];
      if (block === 0x3b) break; // trailer
      if (block === 0x21) {
        // extension: skip its chain of length-prefixed sub-blocks
        p += 2;
        while (p < buf.length && buf[p] !== 0x00) p += buf[p]! + 1;
        p += 1;
      } else if (block === 0x2c) {
        frames++;
        if (frames > 1) return { animated: true, frames: undefined }; // enough to know
        const local = buf[p + 9];
        if (local === undefined) break;
        p += 10;
        if (local & 0x80) p += 3 * (1 << ((local & 0x07) + 1)); // local colour table
        p += 1; // LZW minimum code size
        while (p < buf.length && buf[p] !== 0x00) p += buf[p]! + 1; // image data sub-blocks
        p += 1;
      } else {
        break; // not a shape we understand; do not guess
      }
    }
    return { animated: frames > 1, frames };
  }

  // APNG: an `acTL` chunk before the first `IDAT` declares the frame count.
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) {
    const acTL = buf.indexOf("acTL", 8, "ascii");
    if (acTL === -1) return { animated: false, frames: 1 };
    const idat = buf.indexOf("IDAT", 8, "ascii");
    if (idat !== -1 && idat < acTL) return { animated: false, frames: 1 };
    const frames = acTL + 8 <= buf.length ? buf.readUInt32BE(acTL + 4) : undefined;
    return { animated: (frames ?? 2) > 1, frames };
  }

  // Animated WebP: an `ANIM` chunk in the RIFF container.
  if (
    buf.length > 16 && buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { animated: buf.indexOf("ANIM", 12, "ascii") !== -1 };
  }

  return { animated: false };
}

/** PNG IHDR: width, height, bit depth, colour type. */
export function pngHeader(buf: Buffer): { w: number; h: number; depth: number; colour: number } | null {
  if (buf.length < 33 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return {
    w: buf.readUInt32BE(16),
    h: buf.readUInt32BE(20),
    depth: buf[24]!,
    colour: buf[25]!,
  };
}

/**
 * Decide whether a PNG *displays* as one flat colour, by decoding it and compositing
 * over a white background. Compositing is the point: a white glyph on a transparent
 * canvas is not a uniform file, but it shows an agent nothing at all. Both cases are
 * worth skipping and both are caught here.
 *
 * Returns false whenever anything is unsupported or uncertain, so the marker is always
 * earned. Interlaced, palette and non-8-bit images are never claimed blank.
 */
export function pngIsBlank(buf: Buffer, hdr: { w: number; h: number; depth: number; colour: number }): boolean {
  if (hdr.depth !== 8) return false;
  if (hdr.colour === 3) return false; // palette: colour lives in PLTE, not the pixels
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[hdr.colour];
  if (!channels) return false;
  if (hdr.w === 0 || hdr.h === 0) return false;
  if (buf[28] !== 0) return false; // interlaced

  // Concatenate IDAT chunks.
  const idat: Buffer[] = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === "IEND") break;
    off += 12 + len;
  }
  if (!idat.length) return false;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return false;
  }

  const bpp = channels;
  const stride = hdr.w * bpp;
  if (raw.length < (stride + 1) * hdr.h) return false;

  // Unfilter into a single reusable scanline and compare every pixel to the first.
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  const composed = Buffer.alloc(4);
  let first: Buffer | null = null;

  for (let y = 0; y < hdr.h; y++) {
    const base = y * (stride + 1);
    const filter = raw[base]!;
    raw.copy(cur, 0, base + 1, base + 1 + stride);

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let v = cur[x]!;
      switch (filter) {
        case 0:
          break;
        case 1:
          v = (v + a) & 0xff;
          break;
        case 2:
          v = (v + b) & 0xff;
          break;
        case 3:
          v = (v + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pred) & 0xff;
          break;
        }
        default:
          return false;
      }
      cur[x] = v;
    }

    cur.copy(prev); // the *filtered-out* row feeds the next row's predictor

    // Composite this row over white, then compare every pixel to the very first one.
    const hasAlpha = hdr.colour === 4 || hdr.colour === 6;
    const colourCh = hasAlpha ? bpp - 1 : bpp;
    for (let px = 0; px < hdr.w; px++) {
      const o = px * bpp;
      const alpha = hasAlpha ? cur[o + colourCh]! : 255;
      for (let c = 0; c < colourCh; c++) {
        // over white: out = src*a + 255*(1-a)
        composed[c] = Math.round((cur[o + c]! * alpha + 255 * (255 - alpha)) / 255);
      }
      if (!first) {
        first = Buffer.from(composed.subarray(0, colourCh));
      } else {
        for (let c = 0; c < colourCh; c++) if (composed[c] !== first[c]!) return false;
      }
    }
  }

  return first !== null;
}

/**
 * Decode a non-interlaced 8-bit PNG into RGB rows composited over white.
 * Returns null for anything unsupported, so callers fail safe.
 */
function decodePngRgbRows(buf: Buffer, hdr: { w: number; h: number; depth: number; colour: number }): Buffer[] | null {
  if (hdr.depth !== 8 || hdr.colour === 3) return null; // palette colour lives in PLTE
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[hdr.colour];
  if (!channels || !hdr.w || !hdr.h) return null;
  if (buf[28] !== 0) return null; // interlaced

  const idat: Buffer[] = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === "IEND") break;
    off += 12 + len;
  }
  if (!idat.length) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }

  const bpp = channels;
  const stride = hdr.w * bpp;
  if (raw.length < (stride + 1) * hdr.h) return null;

  const hasAlpha = hdr.colour === 4 || hdr.colour === 6;
  const colourCh = hasAlpha ? bpp - 1 : bpp;
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  const rows: Buffer[] = [];

  for (let y = 0; y < hdr.h; y++) {
    const base = y * (stride + 1);
    const filter = raw[base]!;
    raw.copy(cur, 0, base + 1, base + 1 + stride);

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let v = cur[x]!;
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: return null;
      }
      cur[x] = v;
    }
    cur.copy(prev);

    const row = Buffer.alloc(hdr.w * 3);
    for (let px = 0; px < hdr.w; px++) {
      const o = px * bpp;
      const alpha = hasAlpha ? cur[o + colourCh]! : 255;
      for (let ch = 0; ch < 3; ch++) {
        const src = cur[o + Math.min(ch, colourCh - 1)]!;
        row[px * 3 + ch] = Math.round((src * alpha + 255 * (255 - alpha)) / 255);
      }
    }
    rows.push(row);
  }
  return rows;
}

const INK_LEVEL = 160; // grey darker than this counts as ink
const SATURATION_LEVEL = 40; // max(RGB)-min(RGB) above this counts as colour
// Anything not essentially paper-white. Pale grey figure panels are invisible to
// an ink threshold, so they are caught by their tint instead: a real diagram was
// hidden in testing because its fills were lighter than INK_LEVEL.
const TINT_LEVEL = 248;

/**
 * Is this page render nothing but typeset text?
 *
 * Ingesting six EU regulations produced 326 `pages/` renders, every one a picture
 * of paragraphs already sitting in text.txt. Viewing them adds nothing and costs
 * an agent view each, so they should be surveyed as a count, not as a worklist.
 *
 * Detection is a projection profile: typeset text makes regular horizontal bands
 * of ink separated by whitespace, at a steady line pitch, with low overall
 * coverage and no colour. A figure breaks at least one of those.
 *
 * **Biased hard towards `false`.** Hiding a page that holds a diagram loses
 * knowledge permanently, while showing a text page costs one view. Anything
 * unsupported, uncertain or unusual therefore returns false.
 *
 * Intended for `pages/` renders only. Embedded `media/` images are figures by
 * construction and must never be run through this.
 */
export function pageIsTextOnly(buf: Buffer): boolean {
  return pageProfile(buf)?.textOnly ?? false;
}

export interface PageProfile {
  w: number;
  h: number;
  colourFraction: number;
  coverage: number; // fraction of pixels that are ink
  maxSolidRunFraction: number; // longest run of near-solid ink rows, over height
  maxTintRunFraction: number; // longest run of near-solid off-white rows, over height
  bands: number; // ink bands (text lines)
  medianBandHeight: number;
  textOnly: boolean;
  reason: string; // why not textOnly, or "text page"
}

/** The measurements behind pageIsTextOnly, exposed so thresholds can be tuned
 *  against real page renders instead of guessed at. Null if undecodable. */
export function pageProfile(buf: Buffer): PageProfile | null {
  const hdr = pngHeader(buf);
  if (!hdr) return null;

  const rows = decodePngRgbRows(buf, hdr);
  if (!rows) return null;

  const inkPerRow = new Float64Array(hdr.h);
  const tintPerRow = new Float64Array(hdr.h);
  let inkTotal = 0;
  let colourPixels = 0;

  for (let y = 0; y < hdr.h; y++) {
    const row = rows[y]!;
    let rowInk = 0;
    let rowTint = 0;
    for (let x = 0; x < hdr.w; x++) {
      const r = row[x * 3]!, g = row[x * 3 + 1]!, b = row[x * 3 + 2]!;
      if (Math.max(r, g, b) - Math.min(r, g, b) > SATURATION_LEVEL) colourPixels++;
      const grey = (r * 299 + g * 587 + b * 114) / 1000;
      if (grey < INK_LEVEL) rowInk++;
      if (grey < TINT_LEVEL) rowTint++;
    }
    inkPerRow[y] = rowInk / hdr.w;
    tintPerRow[y] = rowTint / hdr.w;
    inkTotal += rowInk;
  }

  const pixels = hdr.w * hdr.h;
  const colourFraction = colourPixels / pixels;
  const coverage = inkTotal / pixels;

  // A near-solid run of rows is a filled block: chart, photo or block diagram.
  let solidRun = 0;
  let maxSolidRun = 0;
  // The same test at the tint threshold, which catches pale grey figure panels
  // that carry no "ink" at all. Text rows never fill half a line width with
  // continuous tint; a panel does, for its whole height.
  let tintRun = 0;
  let maxTintRun = 0;
  for (let y = 0; y < hdr.h; y++) {
    if (inkPerRow[y]! > 0.5) maxSolidRun = Math.max(maxSolidRun, ++solidRun);
    else solidRun = 0;
    if (tintPerRow[y]! > 0.5) maxTintRun = Math.max(maxTintRun, ++tintRun);
    else tintRun = 0;
  }

  // Count ink bands (text lines) and measure their heights.
  const bandList: number[] = [];
  let run = 0;
  for (let y = 0; y < hdr.h; y++) {
    if (inkPerRow[y]! > 0.002) run++;
    else if (run) { bandList.push(run); run = 0; }
  }
  if (run) bandList.push(run);
  const sorted = [...bandList].sort((a, b) => a - b);
  const medianBandHeight = sorted.length ? sorted[sorted.length >> 1]! : 0;
  const maxSolidRunFraction = maxSolidRun / hdr.h;
  const maxTintRunFraction = maxTintRun / hdr.h;

  const p: PageProfile = {
    w: hdr.w,
    h: hdr.h,
    colourFraction,
    coverage,
    maxSolidRunFraction,
    maxTintRunFraction,
    bands: bandList.length,
    medianBandHeight,
    textOnly: false,
    reason: "text page",
  };

  // Every rejection below is a bias towards showing the page.
  if (hdr.w < 200 || hdr.h < 200) p.reason = "too small to profile";
  else if (colourFraction > 0.005) p.reason = "carries colour, so a figure";
  else if (coverage < 0.003) p.reason = "no ink, effectively blank";
  else if (coverage > 0.35) p.reason = "too dense for prose";
  else if (maxSolidRunFraction > 0.02) p.reason = "has a solid block, so a figure";
  else if (maxTintRunFraction > 0.015) p.reason = "has a filled panel, so a figure";
  else if (bandList.length < 8) p.reason = "too few ink bands to be prose";
  else if (medianBandHeight > 45) p.reason = "ink bands too tall to be glyph rows";
  else p.textOnly = true;

  return p;
}

export async function inspectImage(abs: string): Promise<ImageInfo> {
  const bytes = statSync(abs).size;
  const buf = Buffer.from(await Bun.file(abs).arrayBuffer());
  const info: ImageInfo = { bytes, format: "unknown", blank: false, hash: await sha256(abs) };

  // Bun.Image (Bun >= 1.4) reads format + dimensions for every raster format
  // (png/jpeg/webp/gif/bmp/tiff/heic/avif). It throws on anything else, and
  // that is exactly the unviewable/unknown bucket.
  let img: InstanceType<typeof Bun.Image>;
  try {
    img = new Bun.Image(buf);
    const meta = await img.metadata();
    info.format = meta.format;
    info.width = meta.width;
    info.height = meta.height;
  } catch {
    info.format = formatOf(buf);
    return info;
  }

  const anim = animationOf(buf);
  if (anim.animated) info.animated = true;
  if (anim.frames !== undefined) info.frames = anim.frames;

  // Blank check. Fast path: the file is already a PNG our decoder reads.
  // Everything else (jpeg/webp/gif/bmp/tiff/..., palette, 16-bit or interlaced
  // PNGs) is normalised to 8-bit RGBA PNG by Bun.Image first, so the flat-colour
  // proof now covers every raster format, not only plain PNGs.
  const hdr = info.format === "png" ? pngHeader(buf) : null;
  if (hdr && hdr.depth === 8 && hdr.colour !== 3 && buf[28] === 0) {
    info.blank = pngIsBlank(buf, hdr);
  } else {
    try {
      const norm = Buffer.from(await img.png().bytes());
      const nh = pngHeader(norm);
      info.blank = nh ? pngIsBlank(norm, nh) : false;
    } catch {
      info.blank = false; // undecodable pixels: never claim blank
    }
  }
  return info;
}

export interface SkippedEntry {
  file: string; // path relative to the source's derived dir, e.g. "media/image3.png"
  reason: "unviewable" | "blank" | "tiny" | "duplicate";
  detail: string;
}

/** Why this image is junk, or null if it must be kept. Order matters: the
 *  cheapest certain reasons win, and only kept files can claim a duplicate. */
export function junkReason(
  info: ImageInfo,
  seen: Map<string, string>, // hash -> kept file (relative), for duplicate detail
): { reason: SkippedEntry["reason"]; detail: string } | null {
  if (UNVIEWABLE_FORMATS.has(info.format))
    return { reason: "unviewable", detail: `${info.format} is a vector format an LLM cannot view` };
  // Blankness is judged on the first frame only, which an animation's opening
  // frame is entitled to be - a build-on chart starts on empty axes. Skipping it
  // would throw away the whole animation on the strength of one frame.
  if (info.blank && !info.animated) return { reason: "blank", detail: "decodes to one flat colour over white" };
  if (info.width && info.height && Math.max(info.width, info.height) < TINY_LONG_SIDE_PX)
    return {
      reason: "tiny",
      detail: `${info.width}x${info.height} px, below the ${TINY_LONG_SIDE_PX} px floor (icon/bullet)`,
    };
  const kept = seen.get(info.hash);
  if (kept) return { reason: "duplicate", detail: `byte-identical to ${kept}` };
  return null;
}

/**
 * The gate: classify every file in dirAbs, move junk into dirAbs/skipped/,
 * and report what was kept. `seen` carries kept-file hashes across the dirs
 * of one source so a duplicate is caught wherever it appears.
 */
export async function gateMediaDir(
  dirAbs: string,
  prefix: string, // e.g. "media/" - prepended to file names in the report
  seen: Map<string, string>,
): Promise<{ kept: string[]; skipped: SkippedEntry[] }> {
  const kept: string[] = [];
  const skipped: SkippedEntry[] = [];
  if (!existsSync(dirAbs)) return { kept, skipped };
  const skipDir = join(dirAbs, "skipped");
  for (const f of readdirSync(dirAbs).sort()) {
    if (f.startsWith(".") || f === "skipped") continue;
    const abs = join(dirAbs, f);
    if (!statSync(abs).isFile()) continue;
    const info = await inspectImage(abs);
    const junk = junkReason(info, seen);
    if (junk) {
      mkdirSync(skipDir, { recursive: true });
      renameSync(abs, join(skipDir, f));
      skipped.push({ file: prefix + f, ...junk });
    } else {
      kept.push(f);
      if (!seen.has(info.hash)) seen.set(info.hash, prefix + f);
    }
  }
  return { kept, skipped };
}

/** Record why files were skipped, next to them, so no agent has to guess. */
export function writeSkippedJson(outDir: string, skipped: SkippedEntry[]): void {
  if (!skipped.length) return;
  writeFileSync(join(outDir, "skipped.json"), JSON.stringify(skipped, null, 2) + "\n");
}
