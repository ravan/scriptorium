#!/usr/bin/env bun
// Renders a document spec (JSON) into .md, .docx or .pdf - chosen by the output extension.
// The agent writes the JSON; this script does the deterministic rendering.
// Usage: bun compose-doc.ts <spec.json> -o out.(md|docx|pdf)
//
// Spec shape:
// {
//   "title": "...", "subtitle": "...", "author": "Name", "date": "2026-08-27",
//   "template": "whitepaper",                 // folder under templates/docs/, or a path
//   "sections": [
//     { "heading": "...", "level": 1,          // level 1-3, default 1
//       "blocks": [
//         { "type": "p",        "text": "..." },
//         { "type": "bullets",  "items": ["..."] },
//         { "type": "numbered", "items": ["..."] },
//         { "type": "callout",  "text": "..." },
//         { "type": "quote",    "text": "...", "attribution": "..." },
//         { "type": "image",    "path": "x.svg|x.png", "caption": "..." },
//         { "type": "pagebreak" }
//       ] }
//   ]
// }
// Legacy per-section keys (paragraphs/bullets/callout/image) still work and are
// converted to blocks in that order. Images: .png or .svg (svg auto-converted;
// template fonts are used so SVG text renders in the brand face).
//
// Templates live in templates/docs/<name>/ - template.json (fonts, colors, page,
// cover, rules) + structure.md (the document skeleton the agent must follow).
// PDF needs a Chrome/Chromium binary (checked by doctor.ts); md and docx do not.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

interface DocTemplate {
  name: string;
  font: { heading: string; body: string };
  colors: Record<string, string>;
  assets: Record<string, string>;
  page: { size: string; marginCm: number };
  cover: boolean;
  h1PageBreak: boolean;
  rules: { bulletsAllowed: boolean; maxWords: number; minWords: number; figureEveryWords: number };
  dir: string;
}

const FALLBACK: Omit<DocTemplate, "dir"> = {
  name: "builtin-neutral",
  font: { heading: "Calibri", body: "Calibri" },
  colors: {
    heading: "222222", text: "333333", accent: "555555", muted: "777777", hairline: "DDDDDD",
    calloutBg: "F2F2F2", coverBg: "FFFFFF", coverText: "222222", coverMuted: "777777",
  },
  assets: {},
  page: { size: "A4", marginCm: 2.2 },
  cover: false,
  h1PageBreak: false,
  rules: { bulletsAllowed: true, maxWords: 100000, minWords: 0, figureEveryWords: 0 },
};

const specPath = process.argv[2];
const oIdx = process.argv.indexOf("-o");
if (!specPath || oIdx === -1) {
  console.error("Usage: bun compose-doc.ts <spec.json> -o out.(md|docx|pdf)");
  process.exit(1);
}
const spec = JSON.parse(await Bun.file(specPath).text());
const specDir = dirname(resolve(specPath));
const outPath = resolve(process.argv[oIdx + 1]);
const format = outPath.split(".").pop()!.toLowerCase();
if (!["md", "docx", "pdf", "html"].includes(format)) {
  console.error(`Unsupported output format ".${format}" - use .md, .docx or .pdf`);
  process.exit(1);
}

// --- Template ----------------------------------------------------------------
function findTemplate(ref: string | undefined): string | null {
  if (!ref) return null;
  const c: string[] = [];
  if (ref.includes("/") || ref.endsWith(".json")) {
    const p = isAbsolute(ref) ? ref : resolve(specDir, ref);
    c.push(p.endsWith(".json") ? p : join(p, "template.json"));
  } else {
    c.push(join(process.cwd(), "templates", "docs", ref, "template.json"));
    c.push(join(import.meta.dir, "..", "templates", "docs", ref, "template.json"));
  }
  return c.find(existsSync) ?? null;
}
let tpl: DocTemplate;
const tplFile = findTemplate(spec.template);
if (spec.template && !tplFile) console.error(`lint: doc template "${spec.template}" not found; using built-in neutral.`);
if (tplFile) {
  const t = JSON.parse(await Bun.file(tplFile).text());
  tpl = {
    ...FALLBACK,
    ...t,
    font: { ...FALLBACK.font, ...(t.font ?? {}) },
    colors: { ...FALLBACK.colors, ...(t.colors ?? {}) },
    page: { ...FALLBACK.page, ...(t.page ?? {}) },
    rules: { ...FALLBACK.rules, ...(t.rules ?? {}) },
    assets: t.assets ?? {},
    dir: dirname(tplFile),
  };
} else {
  tpl = { ...FALLBACK, dir: specDir };
}
if (spec.theme) { // legacy per-doc overrides
  const { font, ...colors } = spec.theme;
  tpl.colors = { ...tpl.colors, ...colors };
  if (font) tpl.font = { heading: font, body: font };
}
const C = tpl.colors;

// --- Blocks (normalize legacy shape) ------------------------------------------
type Block = { type: string; text?: string; items?: string[]; path?: string; caption?: string; attribution?: string };
interface Section { heading?: string; level: number; blocks: Block[] }
const sections: Section[] = (spec.sections ?? []).map((s: any) => {
  const blocks: Block[] = s.blocks ? [...s.blocks] : [];
  if (!s.blocks) {
    for (const t of s.paragraphs ?? []) blocks.push({ type: "p", text: t });
    if (s.bullets?.length) blocks.push({ type: "bullets", items: s.bullets });
    if (s.callout) blocks.push({ type: "callout", text: s.callout });
    if (s.image?.path) blocks.push({ type: "image", path: s.image.path, caption: s.image.caption });
  }
  return { heading: s.heading, level: s.level ?? 1, blocks };
});

// --- Assets & images -----------------------------------------------------------
function fontFiles(): string[] {
  const rel = tpl.assets.fontsDir;
  if (!rel) return [];
  const dir = resolve(tpl.dir, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => join(dir, f));
}
async function rasterize(abs: string, widthPx = 1400): Promise<string> {
  if (!abs.toLowerCase().endsWith(".svg")) return abs;
  const png = abs.replace(/\.svg$/i, ".render.png");
  const { Resvg } = await import("@resvg/resvg-js");
  const out = new Resvg(await Bun.file(abs).text(), {
    fitTo: { mode: "width", value: widthPx },
    font: { loadSystemFonts: true, fontFiles: fontFiles() },
  }).render().asPng();
  writeFileSync(png, out);
  return png;
}
async function specImage(rel: string): Promise<string> {
  const abs = isAbsolute(rel) ? rel : resolve(specDir, rel);
  if (!existsSync(abs)) throw new Error("image not found: " + abs);
  return rasterize(abs);
}
// The docx library wants to be told the image type; labelling a JPEG "png"
// is not something every Word build forgives.
function docxImageType(path: string): "png" | "jpg" | "gif" | "bmp" {
  const ext = path.toLowerCase().replace(/^.*\./, "");
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "gif") return "gif";
  if (ext === "bmp") return "bmp";
  return "png"; // png, and every rasterized svg
}
async function templateAsset(key: string, widthPx = 800): Promise<string | null> {
  const rel = tpl.assets[key];
  if (!rel) return null;
  const abs = resolve(tpl.dir, rel);
  if (!existsSync(abs)) { console.error(`lint: template asset missing: ${abs}`); return null; }
  return rasterize(abs, widthPx);
}

// --- Lint ----------------------------------------------------------------------
const lint: string[] = [];
{
  const words = (s: string) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;
  let total = 0, images = 0, bullets = 0;
  for (const s of sections) {
    total += words(s.heading ?? "");
    for (const b of s.blocks) {
      total += words(b.text ?? "") + (b.items ?? []).reduce((a, i) => a + words(i), 0);
      if (b.type === "image") images++;
      if (b.type === "bullets" || b.type === "numbered") bullets++;
    }
  }
  const r = tpl.rules;
  if (total > r.maxWords) lint.push(`${total} words; the ${tpl.name} form caps at ${r.maxWords}. Cut or split.`);
  if (total < r.minWords) lint.push(`${total} words; the ${tpl.name} form starts at ${r.minWords}. This is a different document type.`);
  if (!r.bulletsAllowed && bullets > 0) lint.push(`${bullets} bullet/numbered list(s), but the ${tpl.name} form is prose-only - rewrite them as sentences.`);
  if (r.figureEveryWords > 0 && total / Math.max(images, 1) > r.figureEveryWords * 1.5)
    lint.push(`${total} words with ${images} figure(s); this form wants a figure roughly every ${r.figureEveryWords} words - generate SVGs for structural ideas.`);
}

// --- Renderer: markdown ----------------------------------------------------------
function renderMd(): string {
  const out: string[] = [`# ${spec.title ?? "Untitled"}`, ""];
  if (spec.subtitle) out.push(`*${spec.subtitle}*`, "");
  const by = [spec.author, spec.date].filter(Boolean).join(" · ");
  if (by) out.push(by, "");
  for (const s of sections) {
    if (s.heading) out.push(`${"#".repeat(s.level + 1)} ${s.heading}`, "");
    for (const b of s.blocks) {
      if (b.type === "p") out.push(b.text!, "");
      else if (b.type === "bullets") out.push(...b.items!.map((i) => `- ${i}`), "");
      else if (b.type === "numbered") out.push(...b.items!.map((i, n) => `${n + 1}. ${i}`), "");
      else if (b.type === "callout") out.push(`> **${b.text}**`, "");
      else if (b.type === "quote") out.push(`> ${b.text}${b.attribution ? `\n>\n> — ${b.attribution}` : ""}`, "");
      else if (b.type === "image") {
        // Path relative to the output file so the markdown renders where it lands.
        const abs = isAbsolute(b.path!) ? b.path! : resolve(specDir, b.path!);
        out.push(`![${b.caption ?? ""}](${relTo(dirname(outPath), abs)})`, "");
        if (b.caption) out.push(`*${b.caption}*`, "");
      }
    }
  }
  return out.join("\n");
}
function relTo(fromDir: string, absTarget: string): string {
  const from = fromDir.split("/").filter(Boolean), to = absTarget.split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill(".."), ...to.slice(i)].join("/") || ".";
}

// --- Renderer: docx ---------------------------------------------------------------
async function renderDocx(): Promise<Uint8Array> {
  const {
    AlignmentType, Document, Footer, HeadingLevel, ImageRun, PageBreak, PageNumber, Packer, Paragraph, TextRun,
  } = await import("docx");
  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
  const HSIZE = [32, 26, 23];
  const children: any[] = [];
  const para = (text: string, o: Partial<{ size: number; bold: boolean; color: string; italic: boolean; align: any }> = {}) =>
    new Paragraph({
      spacing: { after: 160, line: 300 },
      alignment: o.align,
      children: [new TextRun({ text, font: tpl.font.body, size: o.size ?? 22, bold: o.bold, italics: o.italic, color: o.color ?? C.text })],
    });

  if (tpl.cover) {
    const logo = await templateAsset("logo");
    if (logo) {
      const bytes = await Bun.file(logo).bytes();
      const m = await new (Bun as any).Image(bytes).metadata();
      const w = 170;
      children.push(new Paragraph({ spacing: { before: 1200, after: 2400 }, children: [new ImageRun({ type: docxImageType(logo), data: bytes, transformation: { width: w, height: Math.round((w * m.height) / m.width) } })] }));
    }
    children.push(para(spec.title ?? "Untitled", { size: 56, bold: true, color: C.heading }));
    if (spec.subtitle) children.push(para(spec.subtitle, { size: 28, color: C.text }));
    children.push(para([spec.author, spec.date].filter(Boolean).join("  ·  "), { size: 22, color: C.muted }));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  } else {
    children.push(para(spec.title ?? "Untitled", { size: 44, bold: true, color: C.heading }));
    if (spec.subtitle) children.push(para(spec.subtitle, { size: 26, color: C.text }));
    const by = [spec.author, spec.date].filter(Boolean).join("  ·  ");
    if (by) children.push(para(by, { size: 20, italic: true, color: C.muted }));
  }

  let numInstance = 0;
  let firstH1 = true;
  for (const s of sections) {
    // Break before a new top-level section only when the template asks for it,
    // and never before the first one (the cover already ends with a break).
    const breakHere = s.level === 1 && tpl.h1PageBreak && !firstH1;
    if (s.heading && s.level === 1) firstH1 = false;
    if (s.heading)
      children.push(new Paragraph({
        heading: HEADINGS[Math.min(s.level, 3) - 1],
        pageBreakBefore: breakHere,
        spacing: { before: 320, after: 160 },
        children: [new TextRun({ text: s.heading, font: tpl.font.heading, size: HSIZE[Math.min(s.level, 3) - 1], bold: true, color: C.heading })],
      }));
    for (const b of s.blocks) {
      if (b.type === "p") children.push(para(b.text!));
      else if (b.type === "bullets")
        for (const i of b.items!) children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: i, font: tpl.font.body, size: 22, color: C.text })] }));
      else if (b.type === "numbered") {
        numInstance++;
        for (const i of b.items!) children.push(new Paragraph({ numbering: { reference: "wiki-num", level: 0, instance: numInstance }, spacing: { after: 80 }, children: [new TextRun({ text: i, font: tpl.font.body, size: 22, color: C.text })] }));
      } else if (b.type === "callout")
        children.push(new Paragraph({ shading: { fill: C.calloutBg }, spacing: { before: 160, after: 160 }, indent: { left: 240, right: 240 }, children: [new TextRun({ text: b.text!, font: tpl.font.body, size: 22, bold: true, color: C.heading })] }));
      else if (b.type === "quote") {
        children.push(new Paragraph({ indent: { left: 480 }, spacing: { before: 160, after: b.attribution ? 40 : 160 }, children: [new TextRun({ text: b.text!, font: tpl.font.body, size: 24, italics: true, color: C.heading })] }));
        if (b.attribution) children.push(new Paragraph({ indent: { left: 480 }, spacing: { after: 160 }, children: [new TextRun({ text: "— " + b.attribution, font: tpl.font.body, size: 20, color: C.muted })] }));
      } else if (b.type === "image") {
        const p = await specImage(b.path!);
        const bytes = await Bun.file(p).bytes();
        const m = await new (Bun as any).Image(bytes).metadata();
        const w = Math.min(600, m.width);
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 160, after: 80 }, children: [new ImageRun({ type: docxImageType(p), data: bytes, transformation: { width: w, height: Math.round((w * m.height) / m.width) } })] }));
        if (b.caption) children.push(para(b.caption, { size: 18, italic: true, color: C.muted, align: AlignmentType.CENTER }));
      } else if (b.type === "pagebreak") children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  }

  const doc = new Document({
    creator: spec.author ?? "wiki",
    title: spec.title ?? "",
    // The explicit indent matters: without it some Word builds apply broken
    // defaults and render list text in a squashed column at the right margin.
    numbering: { config: [{ reference: "wiki-num", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    sections: [{
      children,
      footers: {
        default: new Footer({
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ font: tpl.font.body, size: 18, color: C.muted, children: [PageNumber.CURRENT] })] })],
        }),
      },
    }],
  });
  return Packer.toBuffer(doc);
}

// --- Renderer: pdf (branded HTML -> headless Chrome) --------------------------------
function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function renderHtml(): Promise<string> {
  const faces = fontFiles().map((f) => {
    const base = basename(f).toLowerCase();
    const weight = base.includes("bold") ? 700 : base.includes("medium") ? 500 : 400;
    return `@font-face { font-family: '${tpl.font.body}'; src: url('file://${f}'); font-weight: ${weight}; }`;
  }).join("\n");
  const logo = await templateAsset("logo");
  const logoDark = await templateAsset("logoDark");
  const parts: string[] = [];
  if (tpl.cover) {
    parts.push(`<div class="cover">
      ${logoDark ? `<img class="cover-logo" src="file://${logoDark}">` : ""}
      <div class="cover-spacer"></div>
      <div class="cover-bar"></div>
      <h1 class="cover-title">${esc(spec.title ?? "Untitled")}</h1>
      ${spec.subtitle ? `<p class="cover-subtitle">${esc(spec.subtitle)}</p>` : ""}
      <p class="cover-byline">${esc([spec.author, spec.date].filter(Boolean).join("  ·  "))}</p>
    </div>`);
  } else {
    parts.push(`<header class="titleblock">
      ${logo ? `<img class="tb-logo" src="file://${logo}">` : ""}
      <h1 class="tb-title">${esc(spec.title ?? "Untitled")}</h1>
      ${spec.subtitle ? `<p class="tb-subtitle">${esc(spec.subtitle)}</p>` : ""}
      <p class="tb-byline">${esc([spec.author, spec.date].filter(Boolean).join("  ·  "))}</p>
    </header>`);
  }
  let firstH1 = true;
  for (const s of sections) {
    if (s.heading) {
      const cls = s.level === 1 && tpl.h1PageBreak && !firstH1 ? ' class="break"' : "";
      parts.push(`<h${s.level + 1}${cls}>${esc(s.heading)}</h${s.level + 1}>`);
      if (s.level === 1) firstH1 = false;
    }
    for (const b of s.blocks) {
      if (b.type === "p") parts.push(`<p>${esc(b.text!)}</p>`);
      else if (b.type === "bullets") parts.push(`<ul>${b.items!.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`);
      else if (b.type === "numbered") parts.push(`<ol>${b.items!.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>`);
      else if (b.type === "callout") parts.push(`<div class="callout">${esc(b.text!)}</div>`);
      else if (b.type === "quote") parts.push(`<blockquote><p>${esc(b.text!)}</p>${b.attribution ? `<footer>— ${esc(b.attribution)}</footer>` : ""}</blockquote>`);
      else if (b.type === "image") {
        const p = await specImage(b.path!);
        parts.push(`<figure><img src="file://${p}">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`);
      } else if (b.type === "pagebreak") parts.push(`<div class="break"></div>`);
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${faces}
@page { size: ${tpl.page.size}; margin: ${tpl.page.marginCm}cm; }
${tpl.cover ? `@page :first { margin: 0; }` : ""}
* { box-sizing: border-box; }
body { font-family: '${tpl.font.body}', Verdana, sans-serif; color: #${C.text}; font-size: 10.5pt; line-height: 1.55; margin: 0; }
.cover { width: 210mm; height: 296mm; background: #${C.coverBg}; color: #${C.coverText}; padding: 28mm; page-break-after: always; display: flex; flex-direction: column; }
.cover-logo { width: 42mm; }
.cover-spacer { flex: 1; }
.cover-bar { width: 24mm; height: 2.2mm; background: #${C.accent}; margin-bottom: 8mm; }
.cover-title { font-size: 30pt; font-weight: 700; color: #${C.coverText}; margin: 0 0 6mm; line-height: 1.15; }
.cover-subtitle { font-size: 14pt; color: #${C.coverMuted}; margin: 0 0 18mm; }
.cover-byline { font-size: 10pt; color: #${C.coverMuted}; margin: 0; }
.titleblock { margin-bottom: 12mm; }
.tb-logo { width: 34mm; display: block; margin-bottom: 10mm; }
.tb-title { font-size: 22pt; color: #${C.heading}; margin: 0 0 3mm; line-height: 1.2; }
.tb-subtitle { font-size: 12.5pt; color: #${C.muted}; margin: 0 0 2mm; }
.tb-byline { font-size: 9.5pt; color: #${C.muted}; margin: 0; padding-bottom: 4mm; border-bottom: 0.4mm solid #${C.hairline}; }
h2, h3, h4 { color: #${C.heading}; line-height: 1.25; page-break-after: avoid; }
h2 { font-size: 16pt; margin: 10mm 0 3mm; }
h2::after { content: ""; display: block; width: 12mm; height: 1.4mm; background: #${C.accent}; margin-top: 2mm; }
h3 { font-size: 12.5pt; margin: 7mm 0 2mm; }
h4 { font-size: 11pt; margin: 5mm 0 2mm; }
p { margin: 0 0 3.2mm; }
ul, ol { margin: 0 0 3.2mm; padding-left: 6mm; }
li { margin-bottom: 1.4mm; }
.callout { background: #${C.calloutBg}; border-radius: 2mm; padding: 4mm 5mm; margin: 4mm 0; font-weight: 700; color: #${C.heading}; page-break-inside: avoid; }
blockquote { margin: 5mm 0 5mm 6mm; font-style: italic; color: #${C.heading}; font-size: 12pt; }
blockquote footer { font-style: normal; font-size: 9.5pt; color: #${C.muted}; margin-top: 1.5mm; }
figure { margin: 5mm 0; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; max-height: 160mm; }
figcaption { font-size: 9pt; color: #${C.muted}; font-style: italic; margin-top: 2mm; }
.break { page-break-before: always; }
</style></head><body>${parts.join("\n")}</body></html>`;
}

function findChrome(): string | null {
  const cands = [
    process.env.WIKI_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean) as string[];
  for (const c of cands) if (existsSync(c)) return c;
  // Playwright's cached chromium as a last resort.
  const pw = join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright");
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((d) => d.startsWith("chromium")).sort().reverse()) {
      for (const rel of ["chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-mac/headless_shell", "chrome-linux/chrome", "chrome-linux/headless_shell"]) {
        const p = join(pw, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

// --- Emit -----------------------------------------------------------------------
mkdirSync(dirname(outPath), { recursive: true });
if (format === "md") {
  writeFileSync(outPath, renderMd());
} else if (format === "docx") {
  writeFileSync(outPath, await renderDocx());
} else {
  const html = await renderHtml();
  if (format === "html") {
    writeFileSync(outPath, html);
  } else {
    const chrome = findChrome();
    if (!chrome) {
      console.error("PDF needs Chrome or Chromium and none was found. Install Google Chrome, or set WIKI_CHROME to a binary. (.docx and .md need nothing.)");
      process.exit(1);
    }
    const htmlPath = outPath.replace(/\.pdf$/i, ".render.html");
    writeFileSync(htmlPath, html);
    const r = Bun.spawnSync([chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${outPath}`, `file://${htmlPath}`], { stderr: "pipe" });
    if (!existsSync(outPath)) {
      console.error("Chrome failed to produce the PDF:\n" + new TextDecoder().decode(r.stderr));
      process.exit(1);
    }
  }
}
for (const l of lint) console.error("lint: " + l);
console.log(
  `Wrote ${outPath} (${sections.length} sections, template: ${tpl.name}).` +
    (lint.length ? ` ${lint.length} lint warning(s) above - fix the spec and re-run.` : ""),
);
