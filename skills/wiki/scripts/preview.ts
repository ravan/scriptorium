#!/usr/bin/env bun
// Turns a composed artifact into pictures you can look at. Reading a render log
// is not looking at the thing, and a chart that renders is not the same as a
// chart that can be read from a seat.
//
// Usage:
//   bun preview.ts <deck.pptx | doc.pdf | asset.svg | asset.gif> [-o dir] [--pages 1-4] [--frames 4] [--width 1400]
//
// Routes:
//   .pptx  -> PDF through LibreOffice or Keynote, then one PNG per page
//   .pdf   -> one PNG per page
//   .svg   -> one PNG, rasterised by resvg
//   .gif   -> a few sampled frames  (needs ImageMagick)
//   .png/.jpg -> passed through at the requested width
//
// It prints the paths it wrote. Read them back as images; that is the point.
//
// Exit codes: 0 wrote previews, 1 usage or missing-tool error.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { have, run } from "./common";

export type Route = "deck" | "pdf" | "svg" | "animation" | "raster";

const KEYNOTE = "/Applications/Keynote.app";

export function routeFor(path: string): Route | null {
  const ext = extname(path).toLowerCase();
  if (ext === ".pptx") return "deck";
  if (ext === ".pdf") return "pdf";
  if (ext === ".svg") return "svg";
  if ([".gif", ".mp4", ".webm", ".apng"].includes(ext)) return "animation";
  if ([".png", ".jpg", ".jpeg", ".webp", ".avif", ".tiff"].includes(ext)) return "raster";
  return null;
}

/** "5,1-3,2" -> [1,2,3,5]. Empty means every page. */
export function parsePageSpec(spec: string | undefined): number[] {
  if (!spec) return [];
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = +m[1]!;
    const b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

/**
 * LibreOffice first: it is headless, so it neither steals focus nor needs a
 * logged-in desktop session. Keynote is the macOS fallback and does both.
 */
export function chooseDeckConverter(avail: { soffice: boolean; keynote: boolean }): "soffice" | "keynote" | null {
  if (avail.soffice) return "soffice";
  if (avail.keynote) return "keynote";
  return null;
}

export function sofficeArgs(deck: string, outDir: string): string[] {
  return ["--headless", "--convert-to", "pdf", "--outdir", outDir, deck];
}

export function keynoteScript(deck: string, pdf: string): string {
  return [
    `set f to POSIX file "${deck}"`,
    `set o to POSIX file "${pdf}"`,
    `tell application "Keynote"`,
    `  set d to open f`,
    `  delay 3`,
    `  export d to o as PDF`,
    `  close d saving no`,
    `end tell`,
  ].join("\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const outDirArg = flag("-o") ?? flag("--out");
  const pages = parsePageSpec(flag("--pages"));
  const frames = Number(flag("--frames") ?? 4);
  const width = Number(flag("--width") ?? 1400);
  const positional = argv.filter((a, i) => !a.startsWith("-") && !argv[i - 1]?.startsWith("-"));
  const input = positional[0];

  if (!input) {
    console.error("Usage: bun preview.ts <file> [-o dir] [--pages 1-4] [--frames 4] [--width 1400]");
    process.exit(1);
  }
  if (!existsSync(input)) {
    console.error(`preview: no such file: ${input}`);
    process.exit(1);
  }
  const route = routeFor(input);
  if (!route) {
    console.error(`preview: do not know how to preview ${extname(input) || "that"}`);
    process.exit(1);
  }

  const stem = basename(input, extname(input));
  const outDir = resolve(outDirArg ?? join(tmpdir(), `preview-${stem}`));
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];

  function pdfToPngs(pdf: string, prefix: string) {
    if (!have("pdftoppm")) {
      console.error("preview: needs pdftoppm (brew install poppler). Run bun doctor.ts.");
      process.exit(1);
    }
    const args = ["-png", "-r", "100", ...(pages.length ? ["-f", String(pages[0]), "-l", String(pages[pages.length - 1]!)] : [])];
    const r = run(["pdftoppm", ...args, pdf, join(outDir, prefix)]);
    if (!r.ok) {
      console.error(`preview: pdftoppm failed\n${r.stderr}`);
      process.exit(1);
    }
    for (const f of readdirSync(outDir).sort()) {
      if (f.startsWith(prefix) && f.endsWith(".png")) written.push(join(outDir, f));
    }
  }

  if (route === "deck") {
    const which = chooseDeckConverter({ soffice: have("soffice") || have("libreoffice"), keynote: existsSync(KEYNOTE) });
    if (!which) {
      console.error(
        "preview: a .pptx needs a real renderer and none is installed.\n" +
        "  brew install --cask libreoffice   (headless, works anywhere)\n" +
        "  or install Keynote on macOS.\n" +
        "Do not substitute an SVG preview of the source asset: it does not prove the slide.",
      );
      process.exit(1);
    }
    const tmp = mkdtempSync(join(tmpdir(), "preview-deck-"));
    try {
      const pdf = join(tmp, stem + ".pdf");
      if (which === "soffice") {
        const bin = have("soffice") ? "soffice" : "libreoffice";
        const r = run([bin, ...sofficeArgs(resolve(input), tmp)]);
        if (!r.ok || !existsSync(pdf)) {
          console.error(`preview: ${bin} could not convert the deck\n${r.stderr}`);
          process.exit(1);
        }
      } else {
        const r = run(["osascript", "-e", keynoteScript(resolve(input), pdf)]);
        if (!r.ok || !existsSync(pdf)) {
          console.error(`preview: Keynote could not export the deck\n${r.stderr}`);
          process.exit(1);
        }
      }
      pdfToPngs(pdf, "slide");
      console.log(`preview: rendered through ${which}, the same engine that will show the deck.`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else if (route === "pdf") {
    pdfToPngs(resolve(input), "page");
  } else if (route === "svg") {
    const { Resvg } = await import("@resvg/resvg-js");
    const out = join(outDir, stem + ".png");
    const png = new Resvg(readFileSync(input, "utf8"), {
      fitTo: { mode: "width", value: width },
      font: { loadSystemFonts: true },
    }).render().asPng();
    writeFileSync(out, png);
    written.push(out);
    console.log(
      "preview: resvg drew this, and resvg is not the deck renderer.\n" +
      "  It silently drops shapes PowerPoint draws fine, rotated ones especially.\n" +
      "  Blank or missing elements here are not proof. Build the deck and preview that.",
    );
  } else if (route === "animation") {
    if (!have("magick")) {
      console.error("preview: sampling frames needs ImageMagick (brew install imagemagick).");
      process.exit(1);
    }
    // Evenly spaced samples, so a build-up animation shows its start and end.
    const probe = run(["magick", "identify", "-format", "%n\n", resolve(input)]);
    const total = Math.max(1, parseInt(probe.stdout.trim().split("\n")[0] ?? "1", 10) || 1);
    const picks = Array.from({ length: Math.min(frames, total) }, (_, i) =>
      Math.round((i * (total - 1)) / Math.max(1, Math.min(frames, total) - 1)));
    for (const [i, f] of [...new Set(picks)].entries()) {
      const out = join(outDir, `${stem}-frame-${String(i + 1).padStart(2, "0")}.png`);
      // -coalesce first: a GIF frame is a delta against the one before it.
      const r = run(["magick", `${resolve(input)}[${f}]`, "-coalesce", "-background", "white", "-alpha", "remove",
        "-resize", `${width}x`, out]);
      if (r.ok) written.push(out);
    }
    console.log(`preview: ${total} frame(s) in the file, ${written.length} sampled.`);
  } else {
    if (!have("magick")) {
      console.error("preview: resizing needs ImageMagick (brew install imagemagick).");
      process.exit(1);
    }
    const out = join(outDir, stem + ".png");
    run(["magick", resolve(input), "-resize", `${width}x`, "-strip", out]);
    if (existsSync(out)) written.push(out);
  }

  if (!written.length) {
    console.error("preview: nothing was written.");
    process.exit(1);
  }
  for (const f of written) console.log(f);
  console.log(`\n${written.length} image(s). Read them back as images before you ship anything.`);
}
