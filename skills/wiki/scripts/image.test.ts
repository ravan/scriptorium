// Tests for image inspection, focused on the question no other check answers:
// does this file move?
//
// Fully offline and byte-level - no network, no Chrome, no ImageMagick. The
// fixtures are built here rather than committed, so a failure always means our
// parser broke and never that a binary went missing.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { animationOf, inspectImage, junkReason, type ImageInfo } from "./image";

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * A minimal but REAL GIF: header, logical screen descriptor, optional global
 * colour table, then one Image Descriptor block per frame. Frames are found by
 * walking this chain, so the fixture has to be walkable - a blob with 0x2C
 * sprinkled in would prove nothing.
 */
function gif(frames: number, opts: { globalTable?: boolean; withExtension?: boolean } = {}): Buffer {
  const { globalTable = true, withExtension = false } = opts;
  const parts: Buffer[] = [];
  const flags = globalTable ? 0x80 : 0x00; // bits 0-2 = 0 -> a 2-entry table
  parts.push(Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
    0x01, 0x00, 0x01, 0x00, // 1x1 logical screen
    flags, 0x00, 0x00,
  ]));
  if (globalTable) parts.push(Buffer.from([0, 0, 0, 255, 255, 255])); // 2 entries x RGB

  for (let i = 0; i < frames; i++) {
    if (withExtension) {
      // Graphic Control Extension: the block type an animation always carries,
      // and the one a naive parser trips over.
      parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00]));
    }
    parts.push(Buffer.from([
      0x2c, // image descriptor
      0x00, 0x00, 0x00, 0x00, // left, top
      0x01, 0x00, 0x01, 0x00, // 1x1
      0x00, // no local colour table
      0x02, // LZW minimum code size
      0x02, 0x4c, 0x01, // one 2-byte data sub-block
      0x00, // sub-block terminator
    ]));
  }
  parts.push(Buffer.from([0x3b])); // trailer
  return Buffer.concat(parts);
}

/** A PNG-shaped buffer with the chunks named, in the order given. */
function png(chunks: string[]): Buffer {
  const parts: Buffer[] = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  for (const name of chunks) {
    const body = Buffer.alloc(8);
    body.write(name, 0, "ascii");
    if (name === "acTL") body.writeUInt32BE(7, 4); // 7 frames
    parts.push(body);
  }
  return Buffer.concat(parts);
}

/** A RIFF/WEBP container, optionally carrying the ANIM chunk. */
function webp(animated: boolean): Buffer {
  const b = Buffer.alloc(animated ? 32 : 24);
  b.write("RIFF", 0, "ascii");
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  if (animated) b.write("ANIM", 24, "ascii");
  return b;
}

// ── GIF ─────────────────────────────────────────────────────────────────────

describe("animationOf: GIF", () => {
  test("a single-frame gif is not animated", () => {
    expect(animationOf(gif(1))).toEqual({ animated: false, frames: 1 });
  });

  test("a multi-frame gif is animated", () => {
    expect(animationOf(gif(4)).animated).toBe(true);
  });

  test("frames separated by graphic control extensions are still counted", () => {
    // A real animation always has these. Failing to skip an extension block
    // stops the walk at frame 1 and reports a still.
    expect(animationOf(gif(3, { withExtension: true })).animated).toBe(true);
  });

  test("a gif with no global colour table is walked from the right offset", () => {
    expect(animationOf(gif(2, { globalTable: false })).animated).toBe(true);
    expect(animationOf(gif(1, { globalTable: false })).animated).toBe(false);
  });

  test("a 0x2C byte in pixel data is not mistaken for a frame", () => {
    // The whole reason for walking the block chain instead of scanning bytes.
    const one = gif(1);
    expect(one.filter((b) => b === 0x2c).length).toBeGreaterThan(0);
    expect(animationOf(one).animated).toBe(false);
  });

  test("a truncated gif reports not-animated rather than throwing", () => {
    expect(() => animationOf(gif(3).subarray(0, 20))).not.toThrow();
    expect(animationOf(gif(3).subarray(0, 20)).animated).toBe(false);
  });

  test("a header with no body is safe", () => {
    expect(animationOf(Buffer.from("GIF89a", "ascii")).animated).toBe(false);
  });
});

// ── APNG ────────────────────────────────────────────────────────────────────

describe("animationOf: APNG", () => {
  test("an acTL chunk before IDAT means animated, with its frame count", () => {
    expect(animationOf(png(["IHDR", "acTL", "IDAT"]))).toEqual({ animated: true, frames: 7 });
  });

  test("a plain png is one frame", () => {
    expect(animationOf(png(["IHDR", "IDAT"]))).toEqual({ animated: false, frames: 1 });
  });

  test("acTL after IDAT is ignored, as the APNG spec requires", () => {
    expect(animationOf(png(["IHDR", "IDAT", "acTL"]))).toEqual({ animated: false, frames: 1 });
  });
});

// ── WebP ────────────────────────────────────────────────────────────────────

describe("animationOf: WebP", () => {
  test("an ANIM chunk means animated", () => {
    expect(animationOf(webp(true)).animated).toBe(true);
  });

  test("a still webp is not", () => {
    expect(animationOf(webp(false)).animated).toBe(false);
  });
});

// ── anything else ───────────────────────────────────────────────────────────

describe("animationOf: other input", () => {
  test("a format we do not parse is reported as still, with no invented count", () => {
    expect(animationOf(Buffer.from("\xff\xd8\xff\xe0 jpeg", "binary"))).toEqual({ animated: false });
  });

  test("an empty buffer is safe", () => {
    expect(animationOf(Buffer.alloc(0))).toEqual({ animated: false });
  });
});

// ── how the rest of the pipeline uses it ────────────────────────────────────

describe("inspectImage reports motion", () => {
  const write = async (name: string, buf: Buffer) => {
    const p = join(mkdtempSync(join(tmpdir(), "wiki-img-")), name);
    await Bun.write(p, buf);
    return p;
  };

  test("an animated gif is flagged", async () => {
    const info = await inspectImage(await write("a.gif", gif(3, { withExtension: true })));
    expect(info.format).toBe("gif");
    expect(info.animated).toBe(true);
  });

  test("a still gif is not flagged, and carries no animated key", async () => {
    const info = await inspectImage(await write("s.gif", gif(1)));
    expect(info.animated).toBeUndefined();
    expect(info.frames).toBe(1);
  });
});

describe("junkReason and animation", () => {
  const base: ImageInfo = { bytes: 9000, format: "gif", blank: true, hash: "h", width: 800, height: 600 };

  test("an animation is never skipped for a blank first frame", () => {
    // A build-on chart legitimately opens on empty axes. Judging the whole file
    // by frame 1 would throw the animation away.
    expect(junkReason({ ...base, animated: true }, new Map())).toBeNull();
  });

  test("a still that is blank is still skipped", () => {
    expect(junkReason(base, new Map())?.reason).toBe("blank");
  });

  test("an animation below the tiny floor is still junk", () => {
    // Motion does not make a 16px spinner worth a view.
    const tiny = { ...base, blank: false, animated: true, width: 16, height: 16 };
    expect(junkReason(tiny, new Map())?.reason).toBe("tiny");
  });
});
