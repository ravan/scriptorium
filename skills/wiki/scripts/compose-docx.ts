#!/usr/bin/env bun
// Renders a document spec (JSON) into a real .docx file.
// Usage: bun compose-docx.ts <spec.json> [-o out.docx]
//
// Spec shape:
// {
//   "title": "Doc title", "subtitle": "...", "author": "Name", "date": "2026-08-27",
//   "theme": { "heading": "0C322C", "text": "333333", "accent": "30BA78",
//              "calloutBg": "F5F7F9", "font": "Calibri" },
//   "sections": [
//     { "heading": "...",
//       "paragraphs": ["...", "..."],
//       "bullets": ["...", "..."],
//       "callout": "highlighted text",
//       "image": { "path": "x.svg|x.png", "caption": "...", "widthPx": 600, "heightPx": 400 } }
//   ]
// }
// Images: .png or .svg (svg is converted to PNG automatically).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun,
} from "docx";

interface Theme { heading: string; text: string; accent: string; calloutBg: string; font: string }
const defaultTheme: Theme = { heading: "222222", text: "333333", accent: "555555", calloutBg: "F5F5F5", font: "Calibri" };

const specPath = process.argv[2];
if (!specPath) {
  console.error("Usage: bun compose-docx.ts <spec.json> [-o out.docx]");
  process.exit(1);
}
const oIdx = process.argv.indexOf("-o");
const spec = JSON.parse(await Bun.file(specPath).text());
const theme: Theme = { ...defaultTheme, ...(spec.theme ?? {}) };
const outPath = resolve(oIdx > -1 ? process.argv[oIdx + 1] : specPath.replace(/\.json$/, "") + ".docx");

function pngSize(buf: Uint8Array): { w: number; h: number } {
  const dv = new DataView(buf.buffer, buf.byteOffset);
  return { w: dv.getUint32(16), h: dv.getUint32(20) }; // PNG IHDR
}

async function loadImage(imgPath: string): Promise<{ data: Uint8Array; w: number; h: number }> {
  const abs = resolve(dirname(resolve(specPath)), imgPath);
  if (!existsSync(abs)) throw new Error("image not found: " + abs);
  let data: Uint8Array;
  if (abs.toLowerCase().endsWith(".svg")) {
    const { Resvg } = await import("@resvg/resvg-js");
    data = new Uint8Array(new Resvg(await Bun.file(abs).text(), { fitTo: { mode: "width", value: 1200 } }).render().asPng());
  } else if (abs.toLowerCase().endsWith(".png")) {
    data = new Uint8Array(await Bun.file(abs).arrayBuffer());
  } else {
    throw new Error("docx images must be .png or .svg: " + abs);
  }
  const { w, h } = pngSize(data);
  return { data, w, h };
}

const body: Paragraph[] = [];
const p = (text: string, opts: Partial<{ size: number; bold: boolean; color: string; italic: boolean }> = {}) =>
  new Paragraph({
    spacing: { after: 160, line: 300 },
    children: [new TextRun({ text, font: theme.font, size: opts.size ?? 22, bold: opts.bold, italics: opts.italic, color: opts.color ?? theme.text })],
  });

body.push(p(spec.title ?? "Untitled", { size: 44, bold: true, color: theme.heading }));
if (spec.subtitle) body.push(p(spec.subtitle, { size: 26, color: theme.text }));
if (spec.author || spec.date) body.push(p([spec.author, spec.date].filter(Boolean).join("  |  "), { size: 20, italic: true }));

for (const s of spec.sections ?? []) {
  if (s.heading)
    body.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 160 },
        children: [new TextRun({ text: s.heading, font: theme.font, size: 30, bold: true, color: theme.heading })],
      }),
    );
  for (const t of s.paragraphs ?? []) body.push(p(t));
  for (const b of s.bullets ?? [])
    body.push(
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 80 },
        children: [new TextRun({ text: b, font: theme.font, size: 22, color: theme.text })],
      }),
    );
  if (s.callout)
    body.push(
      new Paragraph({
        shading: { fill: theme.calloutBg },
        border: { left: { style: BorderStyle.SINGLE, size: 24, color: theme.accent } },
        spacing: { before: 160, after: 160 },
        indent: { left: 240 },
        children: [new TextRun({ text: s.callout, font: theme.font, size: 22, color: theme.heading })],
      }),
    );
  if (s.image?.path) {
    const img = await loadImage(s.image.path);
    const maxW = 600;
    const scale = Math.min(1, maxW / img.w);
    body.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 160, after: 80 },
        children: [
          new ImageRun({
            type: "png",
            data: img.data,
            transformation: { width: Math.round(img.w * scale), height: Math.round(img.h * scale) },
          }),
        ],
      }),
    );
    if (s.image.caption) body.push(p(s.image.caption, { size: 18, italic: true }));
  }
}

const doc = new Document({
  creator: spec.author ?? "wiki",
  title: spec.title ?? "",
  sections: [{ children: body }],
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, await Packer.toBuffer(doc));
console.log(`Wrote ${outPath} (${(spec.sections ?? []).length} sections).`);
