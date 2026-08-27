#!/usr/bin/env bun
// Renders a slide-deck spec (JSON) into a real .pptx file.
// The agent writes the JSON; this script does the deterministic rendering.
// Usage: bun compose-pptx.ts <spec.json> [-o out.pptx]
//
// Spec shape:
// {
//   "title": "Deck title", "author": "Name",
//   "theme": { "bg": "FFFFFF", "text": "1D1D1D", "heading": "0C322C",
//              "accent": "30BA78", "sectionBg": "0C322C", "sectionText": "FFFFFF",
//              "font": "Calibri" },
//   "slides": [
//     { "layout": "title",   "title": "...", "subtitle": "..." },
//     { "layout": "section", "title": "..." },
//     { "layout": "content", "title": "...", "bullets": ["...", "..."], "notes": "..." },
//     { "layout": "two-col", "title": "...", "left": ["..."], "right": ["..."] },
//     { "layout": "image",   "title": "...", "image": { "path": "x.svg|x.png", "caption": "..." } }
//   ]
// }
// Image paths may be .svg (converted to PNG automatically), .png or .jpg.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pptxgen from "pptxgenjs";

interface Theme {
  bg: string; text: string; heading: string; accent: string;
  sectionBg: string; sectionText: string; font: string;
}
const defaultTheme: Theme = {
  bg: "FFFFFF", text: "1D1D1D", heading: "222222", accent: "555555",
  sectionBg: "222222", sectionText: "FFFFFF", font: "Calibri",
};

const specPath = process.argv[2];
if (!specPath) {
  console.error("Usage: bun compose-pptx.ts <spec.json> [-o out.pptx]");
  process.exit(1);
}
const oIdx = process.argv.indexOf("-o");
const spec = JSON.parse(await Bun.file(specPath).text());
const theme: Theme = { ...defaultTheme, ...(spec.theme ?? {}) };
const outPath = resolve(oIdx > -1 ? process.argv[oIdx + 1] : specPath.replace(/\.json$/, "") + ".pptx");

// SVG images: convert to PNG next to the output file, since pptx viewers
// handle raster reliably.
async function asRaster(imgPath: string): Promise<string> {
  const abs = resolve(dirname(resolve(specPath)), imgPath);
  if (!existsSync(abs)) throw new Error("image not found: " + abs);
  if (!abs.toLowerCase().endsWith(".svg")) return abs;
  const { Resvg } = await import("@resvg/resvg-js");
  const svg = await Bun.file(abs).text();
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1600 } }).render().asPng();
  const pngPath = abs.replace(/\.svg$/i, ".render.png");
  writeFileSync(pngPath, png);
  return pngPath;
}

const pptx = new pptxgen();
pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
pptx.layout = "WIDE";
if (spec.title) pptx.title = spec.title;
if (spec.author) pptx.author = spec.author;

for (const s of spec.slides ?? []) {
  const slide = pptx.addSlide();
  slide.background = { color: s.layout === "section" ? theme.sectionBg : theme.bg };
  const layout = s.layout ?? "content";

  if (layout === "title") {
    slide.addText(s.title ?? "", {
      x: 0.8, y: 2.4, w: 11.7, h: 1.6, fontFace: theme.font, fontSize: 44, bold: true, color: theme.heading,
    });
    if (s.subtitle)
      slide.addText(s.subtitle, { x: 0.8, y: 4.0, w: 11.7, h: 0.9, fontFace: theme.font, fontSize: 20, color: theme.text });
    slide.addShape("rect", { x: 0.8, y: 2.2, w: 1.6, h: 0.12, fill: { color: theme.accent } });
  } else if (layout === "section") {
    slide.addText(s.title ?? "", {
      x: 0.8, y: 3.0, w: 11.7, h: 1.4, fontFace: theme.font, fontSize: 36, bold: true, color: theme.sectionText,
    });
    slide.addShape("rect", { x: 0.8, y: 2.8, w: 1.6, h: 0.12, fill: { color: theme.accent } });
  } else if (layout === "two-col") {
    slide.addText(s.title ?? "", { x: 0.8, y: 0.5, w: 11.7, h: 0.9, fontFace: theme.font, fontSize: 28, bold: true, color: theme.heading });
    const col = (items: string[], x: number) =>
      slide.addText(items.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })), {
        x, y: 1.6, w: 5.7, h: 5.3, fontFace: theme.font, fontSize: 16, color: theme.text, valign: "top",
      });
    col(s.left ?? [], 0.8);
    col(s.right ?? [], 6.8);
  } else if (layout === "image") {
    slide.addText(s.title ?? "", { x: 0.8, y: 0.5, w: 11.7, h: 0.9, fontFace: theme.font, fontSize: 28, bold: true, color: theme.heading });
    if (s.image?.path) {
      const p = await asRaster(s.image.path);
      slide.addImage({ path: p, x: 1.6, y: 1.6, w: 10.1, h: 4.8, sizing: { type: "contain", w: 10.1, h: 4.8 } });
    }
    if (s.image?.caption)
      slide.addText(s.image.caption, { x: 0.8, y: 6.6, w: 11.7, h: 0.5, fontFace: theme.font, fontSize: 12, italic: true, color: theme.text, align: "center" });
  } else {
    // content
    slide.addText(s.title ?? "", { x: 0.8, y: 0.5, w: 11.7, h: 0.9, fontFace: theme.font, fontSize: 28, bold: true, color: theme.heading });
    slide.addShape("rect", { x: 0.8, y: 1.45, w: 1.2, h: 0.08, fill: { color: theme.accent } });
    if (s.bullets?.length)
      slide.addText(s.bullets.map((t: string) => ({ text: t, options: { bullet: true, breakLine: true } })), {
        x: 0.8, y: 1.8, w: 11.7, h: 5.1, fontFace: theme.font, fontSize: 18, color: theme.text, valign: "top",
      });
  }
  if (s.notes) slide.addNotes(s.notes);
}

mkdirSync(dirname(outPath), { recursive: true });
await pptx.writeFile({ fileName: outPath });
console.log(`Wrote ${outPath} (${(spec.slides ?? []).length} slides). Imports into Google Slides via File > Import.`);
