#!/usr/bin/env bun
// Proves a rendered deck contains what its spec asked for. A clean render log is
// not evidence: pptxgenjs reports success for a slide whose image silently
// resolved to nothing, and an animated GIF can arrive flattened to one frame.
// This opens the file and reads what is actually inside it.
//
// Usage:
//   bun verify-pptx.ts <deck.pptx> [spec.json] [--json]
//
// Without a spec it reports what the file contains. With one it also checks that
// every slide the spec gave an image or a background to really has media, that
// the slide count matches, and that promised speaker notes arrived.
//
// Exit codes: 0 clean, 2 problems found, 1 usage error.
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { run, have } from "./common";
import { inspectImage } from "./image";

// ── types ───────────────────────────────────────────────────────────────────

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ActualSlide {
  media: string[];
  hasNotes: boolean;
  placements: Placement[];
}

export interface ExpectedSlide {
  layout: string;
  images: number;
  paths: string[];
  wantsNotes: boolean;
}

export interface MediaFact {
  name: string;
  bytes: number;
  format: string;
  animated: boolean;
  frames?: number;
}

export type VerifyRule =
  | "slide-count"
  | "missing-media"
  | "tiny-media"
  | "missing-notes"
  | "letterboxed"
  | "animated";

export interface VerifyFinding {
  rule: VerifyRule;
  severity: "problem" | "warn" | "info";
  slide: number;
  message: string;
}

const EMU_PER_INCH = 914400;
const SLIDE_W = 13.33; // the WIDE layout compose-pptx.ts defines
// Below this a chart's own type has shrunk past the point of being read from a
// seat. It is the ratio of placed width to the width the slot offered.
export const WIDTH_USE_WARN = 0.8;
// The visual slots compose-pptx.ts hands each layout, in inches. fitContain
// centres inside these, so the placement alone cannot say what was on offer;
// only the layout can.
export const SLOT_WIDTH: Record<string, number> = { image: 10.1, content: 5.23 };
// A real image is never this small. A few hundred bytes means a placeholder.
export const TINY_MEDIA_BYTES = 2000;

// ── parsing ─────────────────────────────────────────────────────────────────

export function parseRels(xml: string): { media: string[]; hasNotes: boolean } {
  const media = [...xml.matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map((m) => m[1]!);
  return { media, hasNotes: xml.includes("/notesSlide") };
}

/**
 * Picture frames only. Text boxes carry the same a:off/a:ext pair, so matching
 * those too would make every slide look like it held a dozen images.
 */
export function parsePlacements(slideXml: string): Placement[] {
  const out: Placement[] = [];
  for (const pic of slideXml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
    const m = pic[0].match(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/);
    if (!m) continue;
    out.push({
      x: +m[1]! / EMU_PER_INCH,
      y: +m[2]! / EMU_PER_INCH,
      w: +m[3]! / EMU_PER_INCH,
      h: +m[4]! / EMU_PER_INCH,
    });
  }
  return out;
}

export function expectedFromSpec(spec: any): ExpectedSlide[] {
  return (spec?.slides ?? []).map((s: any) => {
    const paths = [s?.background?.path, s?.image?.path].filter(Boolean) as string[];
    return {
      layout: s?.layout ?? "content",
      images: paths.length,
      paths,
      wantsNotes: Boolean(s?.notes),
    };
  });
}

// ── the check ───────────────────────────────────────────────────────────────

export function checkDeck(
  actual: ActualSlide[],
  expected: ExpectedSlide[] | null,
  mediaByName: Record<string, MediaFact>,
): VerifyFinding[] {
  const out: VerifyFinding[] = [];

  if (expected && expected.length !== actual.length) {
    out.push({
      rule: "slide-count",
      severity: "problem",
      slide: 0,
      message: `spec has ${expected.length} slide(s), the file has ${actual.length}`,
    });
  }

  actual.forEach((a, i) => {
    const n = i + 1;
    const want = expected?.[i];

    // The template paints a logo on most masters, so counting raw media would
    // call a text-only slide "illustrated". Compare against what the spec asked.
    if (want && want.images > 0 && a.media.length < want.images) {
      out.push({
        rule: "missing-media",
        severity: "problem",
        slide: n,
        message: `spec asks for ${want.images} image(s) (${want.paths.join(", ")}) but the slide carries ${a.media.length}`,
      });
    }

    if (want?.wantsNotes && !a.hasNotes) {
      out.push({ rule: "missing-notes", severity: "problem", slide: n, message: "spec has notes, the file has none" });
    }

    for (const name of a.media) {
      const f = mediaByName[name];
      if (!f) continue;
      if (f.bytes < TINY_MEDIA_BYTES) {
        out.push({
          rule: "tiny-media",
          severity: "problem",
          slide: n,
          message: `${name} is only ${f.bytes} bytes; that is a placeholder, not a render`,
        });
      }
      // animationOf stops counting once a second frame proves the point, so
      // an undefined count still means the animation survived.
      if (f.animated) {
        const count = f.frames === undefined ? "more than one frame" : `${f.frames} frames`;
        out.push({
          rule: "animated",
          severity: "info",
          slide: n,
          message: `${name} still animates (${count}); it plays in slideshow mode`,
        });
      }
    }

    // A visual that fills far less width than its slot was given has been
    // letterboxed by its own aspect ratio, and its type shrank with it.
    const slot = want ? SLOT_WIDTH[want.layout] : undefined;
    if (slot) {
      for (const p of a.placements) {
        // A full-bleed background fills the slide by design.
        if (p.x <= 0.05 && p.w >= SLIDE_W - 0.1) continue;
        // Only judge visuals big enough to be the slide's point; a footer logo
        // is meant to be small.
        if (p.w < 3) continue;
        const use = p.w / slot;
        if (use >= WIDTH_USE_WARN) continue;
        out.push({
          rule: "letterboxed",
          severity: "warn",
          slide: n,
          message: `a visual fills ${Math.round(use * 100)}% of the ${slot}in slot; check its type is still readable`,
        });
      }
    }
  });

  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const [deck, spec] = argv.filter((a) => !a.startsWith("--"));

  if (!deck) {
    console.error("Usage: bun verify-pptx.ts <deck.pptx> [spec.json] [--json]");
    process.exit(1);
  }
  if (!existsSync(deck)) {
    console.error(`verify: no such file: ${deck}`);
    process.exit(1);
  }
  if (!have("unzip")) {
    console.error("verify: needs unzip. Run bun doctor.ts.");
    process.exit(1);
  }

  const dir = mkdtempSync(join(tmpdir(), "verify-pptx-"));
  try {
    const un = run(["unzip", "-qq", "-o", deck, "-d", dir]);
    if (!un.ok) {
      console.error(`verify: ${basename(deck)} is not a readable .pptx\n${un.stderr}`);
      process.exit(1);
    }

    // Media facts first, so a slide can be told what it is carrying.
    const mediaDir = join(dir, "ppt", "media");
    const mediaByName: Record<string, MediaFact> = {};
    if (existsSync(mediaDir)) {
      for (const name of readdirSync(mediaDir)) {
        const abs = join(mediaDir, name);
        // inspectImage reads the format through Bun.Image, which knows every
        // raster format; the magic-byte fallback only covers office vectors.
        const info = await inspectImage(abs);
        mediaByName[name] = {
          name,
          bytes: info.bytes,
          format: info.format,
          animated: Boolean(info.animated),
          frames: info.frames,
        };
      }
    }

    const slidesDir = join(dir, "ppt", "slides");
    const slideFiles = existsSync(slidesDir)
      ? readdirSync(slidesDir)
          .filter((f) => /^slide\d+\.xml$/.test(f))
          .sort((a, b) => +a.replace(/\D/g, "") - +b.replace(/\D/g, ""))
      : [];

    const actual: ActualSlide[] = slideFiles.map((f) => {
      const relPath = join(slidesDir, "_rels", f + ".rels");
      const { media, hasNotes } = existsSync(relPath)
        ? parseRels(readFileSync(relPath, "utf8"))
        : { media: [], hasNotes: false };
      return { media, hasNotes, placements: parsePlacements(readFileSync(join(slidesDir, f), "utf8")) };
    });

    let expected: ExpectedSlide[] | null = null;
    if (spec) {
      if (!existsSync(spec)) {
        console.error(`verify: no such spec: ${spec}`);
        process.exit(1);
      }
      expected = expectedFromSpec(JSON.parse(readFileSync(spec, "utf8")));
    }

    const findings = checkDeck(actual, expected, mediaByName);
    const problems = findings.filter((f) => f.severity === "problem");

    if (asJson) {
      console.log(JSON.stringify({
        ok: problems.length === 0,
        slides: actual.length,
        media: mediaByName,
        findings,
      }, null, 2));
      process.exit(problems.length ? 2 : 0);
    }

    console.log(`${basename(deck)}: ${actual.length} slide(s), ${Object.keys(mediaByName).length} media file(s)`);
    actual.forEach((a, i) => {
      const det = a.media
        .map((m) => {
          const f = mediaByName[m];
          if (!f) return m;
          const anim = f.animated ? (f.frames === undefined ? " animated" : ` x${f.frames} frames`) : "";
          return `${m} ${f.format}${anim} ${Math.round(f.bytes / 1024)}kB`;
        })
        .join(" | ");
      console.log(`  slide ${String(i + 1).padStart(2)}  notes=${a.hasNotes ? "yes" : "no "}  ${det || "(no media)"}`);
    });

    if (!findings.length) {
      console.log("\nverify: everything the spec asked for is in the file.");
      process.exit(0);
    }
    console.log("");
    for (const f of findings) {
      const tag = f.severity === "problem" ? "verify" : f.severity === "warn" ? "check " : "note  ";
      console.log(`${tag}: slide ${f.slide || "-"}: ${f.message}`);
    }
    console.log(`\n${problems.length} problem(s).`);
    process.exit(problems.length ? 2 : 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
