// Tests for text-only page-render detection.
//
// Why this exists: ingesting six EU regulations produced 326 `pages/` renders,
// and media.ts listed every one as "worth viewing" with the instruction to write
// a description for each. All 326 were plain typeset legal text whose content was
// already in text.txt. Viewing them is pure waste, and an agent that dutifully
// obeys burns its context on pictures of paragraphs it has already read.
//
// The gate has to be CONSERVATIVE in one direction: wrongly hiding a page that
// contains a figure loses knowledge permanently. Wrongly showing a text page
// costs one view. So every uncertain case must resolve to "show it".
import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { pageIsTextOnly } from "./image";

// ── a real, decodable PNG encoder ───────────────────────────────────────────

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode RGB pixels as a real 8-bit truecolour PNG (filter 0 on every row). */
function encodePng(w: number, h: number, rgb: (x: number, y: number) => [number, number, number]): Buffer {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const base = y * (stride + 1);
    raw[base] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb(x, y);
      raw[base + 1 + x * 3] = r;
      raw[base + 2 + x * 3] = g;
      raw[base + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [20, 20, 20];

/**
 * A page of typeset text: regular bands of glyphs, with margins.
 *
 * Densities are matched to real PDF page renders measured during development:
 * ink coverage 4-8%, zero colour, band height ~11 px, 20-55 bands per page.
 * An earlier version of this fixture ran at 19% coverage and was not text-like
 * at all, which made the detector look broken when it was the fixture that lied.
 */
function textPage(w = 660, h = 930, opts: { lineHeight?: number; margin?: number } = {}) {
  const { lineHeight = 22, margin = 70 } = opts;
  const glyphRows = Math.min(11, Math.max(4, Math.round(lineHeight * 0.5)));
  return encodePng(w, h, (x, y) => {
    if (x < margin || x > w - margin) return WHITE;
    if (y < margin || y > h - margin) return WHITE;
    if (y % lineHeight >= glyphRows) return WHITE; // inter-line whitespace
    return x % 7 < 2 ? BLACK : WHITE; // sparse glyph ink, as real text is
  });
}

describe("pageIsTextOnly", () => {
  test("a typeset text page is detected", () => {
    expect(pageIsTextOnly(textPage())).toBe(true);
  });

  test("text pages at other line pitches are still detected", () => {
    expect(pageIsTextOnly(textPage(660, 930, { lineHeight: 16 }))).toBe(true);
    expect(pageIsTextOnly(textPage(660, 930, { lineHeight: 30 }))).toBe(true);
  });

  test("SAFETY: a page with a coloured chart is NOT hidden", () => {
    const base = textPage();
    void base;
    const png = encodePng(660, 930, (x, y) => {
      // a saturated bar chart occupying the lower third
      if (y > 600 && y < 880 && x > 100 && x < 560) return [200, 60, 60];
      if (x < 70 || x > 590 || y < 70) return WHITE;
      const phase = y % 22;
      if (phase > 11) return WHITE;
      return x % 7 < 4 ? BLACK : WHITE;
    });
    expect(pageIsTextOnly(png)).toBe(false);
  });

  test("SAFETY: a greyscale line diagram is NOT hidden", () => {
    // No colour, but a big solid block - the shape a filled figure makes.
    const png = encodePng(660, 930, (x, y) => {
      if (y > 300 && y < 700 && x > 120 && x < 540) return BLACK;
      return WHITE;
    });
    expect(pageIsTextOnly(png)).toBe(false);
  });

  test("SAFETY: a PALE GREY figure panel is NOT hidden", () => {
    // The case real data caught. The most important diagram in the CSF source is
    // drawn in fills lighter than the ink threshold, so an ink-only profile saw
    // an ordinary text page and would have hidden it. Tint catches it instead.
    const PALE: [number, number, number] = [242, 242, 242];
    const png = encodePng(660, 930, (x, y) => {
      if (y > 250 && y < 500 && x > 80 && x < 580) return PALE; // figure panel
      if (x < 70 || x > 590 || y < 70 || y > 860) return WHITE;
      if (y % 22 >= 11) return WHITE;
      return x % 7 < 2 ? BLACK : WHITE;
    });
    expect(pageIsTextOnly(png)).toBe(false);
  });

  test("SAFETY: a photograph is NOT hidden", () => {
    const png = encodePng(660, 930, (x, y) => [(x * 7) % 256, (y * 5) % 256, (x * y) % 256]);
    expect(pageIsTextOnly(png)).toBe(false);
  });

  test("SAFETY: a blank page is NOT claimed as text", () => {
    // Blankness is already handled by the existing blank gate; this must not
    // double-claim it, or the skipped.json reason would be wrong.
    expect(pageIsTextOnly(encodePng(660, 930, () => WHITE))).toBe(false);
  });

  test("SAFETY: a page that is mostly figure with a caption is NOT hidden", () => {
    const png = encodePng(660, 930, (x, y) => {
      if (y > 100 && y < 700 && x > 100 && x < 560) return [90, 140, 210];
      if (y > 740 && y < 760 && x > 100 && x < 400) return BLACK; // caption
      return WHITE;
    });
    expect(pageIsTextOnly(png)).toBe(false);
  });

  test("SAFETY: unreadable input resolves to 'show it'", () => {
    expect(pageIsTextOnly(Buffer.from("not a png"))).toBe(false);
    expect(pageIsTextOnly(Buffer.alloc(0))).toBe(false);
  });

  test("SAFETY: a tiny image is not classified", () => {
    // Too small for a projection profile to mean anything.
    expect(pageIsTextOnly(encodePng(40, 40, () => BLACK))).toBe(false);
  });
});
