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
