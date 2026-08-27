#!/usr/bin/env bun
// Renders a slide-deck spec (JSON) into a real .pptx file, styled by a slide template.
// The agent writes the JSON; this script does the deterministic rendering.
// Usage: bun compose-pptx.ts <spec.json> [-o out.pptx]
//
// Spec shape:
// {
//   "title": "Deck title", "author": "Name",
//   "template": "suse-sovereign",            // folder name under templates/slides/, or a path
//   "theme": { ... },                        // optional per-deck color/font overrides (same keys as template colors + "font")
//   "slides": [
//     { "layout": "title",      "title": "...", "subtitle": "...", "date": "..." },
//     { "layout": "section",    "title": "...", "kicker": "...", "subtitle": "..." },
//     { "layout": "content",    "title": "...", "bullets": ["..."],
//                               "image": { "path": "x.svg|x.png", "caption": "..." } },  // image is optional: text left, visual right
//     { "layout": "two-col",    "title": "...",
//                               "left":  { "heading": "...", "bullets": ["..."] },       // or a plain array (first item = heading if UPPERCASE)
//                               "right": { "heading": "...", "bullets": ["..."] } },
//     { "layout": "image",      "title": "...", "image": { "path": "...", "caption": "..." } },
//     { "layout": "big-number", "number": "48", "label": "criteria in the framework", "body": "why it matters ..." },
//     { "layout": "quote",      "text": "...", "attribution": "..." },
//     { "layout": "closing",    "title": "...", "subtitle": "..." }
//   ]
// }
// Every slide accepts "notes": the spoken narrative lives there, not on the slide.
// Image paths may be .svg (converted to PNG automatically), .png or .jpg.
//
// Templates live in templates/slides/<name>/template.json (wiki copy first, skill copy as
// fallback). A template defines fonts, a color system and branded master slides (logo,
// footer, page numbers, section background, title-slide cover photo).
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import pptxgen from "pptxgenjs";

interface Template {
  name: string;
  font: { heading: string; body: string };
  colors: Record<string, string>;
  assets: { logoLight?: string; logoDark?: string; cover?: string };
  footerText?: string;
  dir: string;
}

const FALLBACK: Omit<Template, "dir"> = {
  name: "builtin-neutral",
  font: { heading: "Calibri", body: "Calibri" },
  colors: {
    bg: "FFFFFF", text: "1D1D1D", heading: "222222", accent: "555555", accent2: "888888",
    muted: "777777", hairline: "DDDDDD", tint: "F2F2F2",
    sectionBg: "222222", sectionText: "FFFFFF", sectionMuted: "BBBBBB", number: "222222",
  },
  assets: {},
  footerText: "",
};

const specPath = process.argv[2];
if (!specPath) {
  console.error("Usage: bun compose-pptx.ts <spec.json> [-o out.pptx]");
  process.exit(1);
}
const oIdx = process.argv.indexOf("-o");
const spec = JSON.parse(await Bun.file(specPath).text());
const specDir = dirname(resolve(specPath));
const outPath = resolve(oIdx > -1 ? process.argv[oIdx + 1] : specPath.replace(/\.json$/, "") + ".pptx");

// --- Template loading -------------------------------------------------------
function findTemplate(ref: string | undefined): { file: string; dir: string } | null {
  if (!ref) return null;
  const candidates: string[] = [];
  if (ref.includes("/") || ref.endsWith(".json")) {
    const p = isAbsolute(ref) ? ref : resolve(specDir, ref);
    candidates.push(p.endsWith(".json") ? p : join(p, "template.json"));
  } else {
    candidates.push(join(process.cwd(), "templates", "slides", ref, "template.json"));
    candidates.push(join(import.meta.dir, "..", "templates", "slides", ref, "template.json"));
  }
  for (const c of candidates) if (existsSync(c)) return { file: c, dir: dirname(c) };
  return null;
}

let tpl: Template;
const found = findTemplate(spec.template) ?? findTemplate("neutral");
if (spec.template && !found) console.error(`lint: template "${spec.template}" not found; using built-in neutral.`);
if (found) {
  const t = JSON.parse(await Bun.file(found.file).text());
  tpl = {
    name: t.name ?? "unnamed",
    font: { ...FALLBACK.font, ...(t.font ?? {}) },
    colors: { ...FALLBACK.colors, ...(t.colors ?? {}) },
    assets: t.assets ?? {},
    footerText: t.footerText ?? "",
    dir: found.dir,
  };
} else {
  tpl = { ...FALLBACK, dir: specDir };
}
// Legacy per-deck overrides: spec.theme keys land on top of the template.
if (spec.theme) {
  const { font, ...colors } = spec.theme;
  tpl.colors = { ...tpl.colors, ...colors };
  if (font) tpl.font = { heading: font, body: font };
}
const C = tpl.colors;
const HEAD = tpl.font.heading;
const BODY = tpl.font.body;

// --- Assets: any SVG becomes a cached PNG next to itself --------------------
// Templates may ship .ttf/.otf files in assets/fonts/ so SVG text renders in the
// brand face even when the font is not installed on this machine.
function templateFontFiles(): string[] {
  const dir = join(tpl.dir, "assets", "fonts");
  if (!existsSync(dir)) return [];
  return [...new Bun.Glob("*.{ttf,otf}").scanSync(dir)].map((f) => join(dir, f));
}
async function rasterize(abs: string): Promise<string> {
  if (!abs.toLowerCase().endsWith(".svg")) return abs;
  const pngPath = abs.replace(/\.svg$/i, ".render.png");
  const stale = !existsSync(pngPath) || statSync(pngPath).mtimeMs < statSync(abs).mtimeMs;
  if (stale) {
    const { Resvg } = await import("@resvg/resvg-js");
    const svg = await Bun.file(abs).text();
    const png = new Resvg(svg, {
      fitTo: { mode: "width", value: 1600 },
      font: { loadSystemFonts: true, fontFiles: templateFontFiles() },
    }).render().asPng();
    writeFileSync(pngPath, png);
  }
  return pngPath;
}
async function asset(rel: string | undefined): Promise<string | null> {
  if (!rel) return null;
  const abs = isAbsolute(rel) ? rel : resolve(tpl.dir, rel);
  if (!existsSync(abs)) { console.error(`lint: template asset missing: ${abs}`); return null; }
  return rasterize(abs);
}
async function slideImage(rel: string): Promise<string> {
  const abs = isAbsolute(rel) ? rel : resolve(specDir, rel);
  if (!existsSync(abs)) throw new Error("image not found: " + abs);
  return rasterize(abs);
}

// Fit an image inside a box preserving its aspect ratio, centered. Computed here
// from the real pixel size because pptx viewers do not honor pptxgenjs "contain"
// reliably (images arrive stretched to the frame).
async function fitContain(path: string, box: { x: number; y: number; w: number; h: number }) {
  let dims: { width: number; height: number };
  try {
    dims = await new (Bun as any).Image(await Bun.file(path).bytes()).metadata();
  } catch {
    return box; // unknown format: fall back to the frame
  }
  const s = Math.min(box.w / dims.width, box.h / dims.height);
  const w = dims.width * s, h = dims.height * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

const logoLight = await asset(tpl.assets.logoLight);
const logoDark = await asset(tpl.assets.logoDark);
const cover = await asset(tpl.assets.cover);
// SUSE lockup aspect ratio; harmless for other roughly-horizontal logos.
const LOGO_AR = 5.5;

// --- Deck setup --------------------------------------------------------------
const pptx = new pptxgen();
pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
pptx.layout = "WIDE";
pptx.theme = { headFontFace: HEAD, bodyFontFace: BODY };
if (spec.title) pptx.title = spec.title;
if (spec.author) pptx.author = spec.author;

const footerObjects = (logo: string | null, lineColor: string, numColor: string) => {
  const objs: any[] = [
    { rect: { x: 0.8, y: 7.02, w: 11.73, h: 0.011, fill: { color: lineColor } } },
  ];
  if (logo) objs.push({ image: { x: 0.8, y: 7.14, w: 0.72, h: 0.72 / LOGO_AR, path: logo } });
  if (tpl.footerText)
    objs.push({ text: { text: tpl.footerText, options: { x: 1.7, y: 7.08, w: 6, h: 0.3, fontFace: BODY, fontSize: 9, color: numColor } } });
  return objs;
};

pptx.defineSlideMaster({
  title: "MAIN",
  background: { color: C.bg },
  objects: footerObjects(logoLight, C.hairline, C.muted),
  slideNumber: { x: 12.55, y: 7.08, w: 0.6, h: 0.3, fontFace: BODY, fontSize: 10, color: C.muted },
});
pptx.defineSlideMaster({
  title: "SECTION",
  background: { color: C.sectionBg },
  objects: logoDark ? [{ image: { x: 0.8, y: 7.14, w: 0.72, h: 0.72 / LOGO_AR, path: logoDark } }] : [],
  slideNumber: { x: 12.55, y: 7.08, w: 0.6, h: 0.3, fontFace: BODY, fontSize: 10, color: C.sectionMuted },
});
pptx.defineSlideMaster({ title: "PLAIN", background: { color: C.bg }, objects: [] });

// --- Shared helpers ----------------------------------------------------------
type Bullet = string | { text: string; indent?: number };
const btext = (b: Bullet) => (typeof b === "string" ? b : b.text);
const bindent = (b: Bullet) => (typeof b === "string" ? 0 : (b.indent ?? 0));

function addBullets(slide: any, items: Bullet[], box: { x: number; y: number; w: number; h: number }, size?: number) {
  const fs = size ?? (items.length > 4 ? 15 : 17);
  slide.addText(
    items.map((b) => ({
      text: btext(b),
      options: { bullet: { indent: 12 }, breakLine: true, indentLevel: bindent(b), paraSpaceAfter: fs * 0.55 },
    })),
    { ...box, fontFace: BODY, fontSize: fs, color: C.text, valign: "top" },
  );
}
function contentTitle(slide: any, title: string) {
  slide.addText(title ?? "", { x: 0.8, y: 0.45, w: 11.7, h: 0.95, fontFace: HEAD, fontSize: 26, bold: true, color: C.heading, valign: "top" });
  slide.addShape("rect", { x: 0.8, y: 1.42, w: 1.2, h: 0.08, fill: { color: C.accent } });
}
function normCol(col: any): { heading?: string; bullets: Bullet[] } {
  if (Array.isArray(col)) {
    // Legacy: a plain array; an ALL-CAPS first item was the de-facto heading.
    if (col.length && typeof col[0] === "string" && col[0] === col[0].toUpperCase() && /[A-Z]/.test(col[0])) {
      const [h, ...rest] = col;
      return { heading: h.charAt(0) + h.slice(1).toLowerCase(), bullets: rest };
    }
    return { bullets: col };
  }
  return { heading: col?.heading, bullets: col?.bullets ?? [] };
}

// --- Lint --------------------------------------------------------------------
const lint: string[] = [];
const words = (s: string) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;
{
  const slides = spec.slides ?? [];
  if (slides.length > 25) lint.push(`deck has ${slides.length} slides; decks land best at 10-20.`);
  const sections = slides.filter((s: any) => s.layout === "section").length;
  const contentish = slides.filter((s: any) => !["title", "section", "closing"].includes(s.layout ?? "content")).length;
  if (sections > 0 && contentish < 8)
    lint.push(`${sections} section divider(s) but only ${contentish} content slides; dividers pad short decks - cut them and compress (one visual can replace several slides).`);
  let textRun = 0;
  let hasVisual = false;
  slides.forEach((s: any, i: number) => {
    const n = i + 1;
    const layout = s.layout ?? "content";
    if (["image", "big-number", "quote"].includes(layout) || s.image) hasVisual = true;
    if (layout === "content" && !s.image) {
      textRun++;
      if (textRun >= 4) { lint.push(`slides ${n - 3}-${n} are four text-only content slides in a row; break the run with a visual, big-number or two-col slide.`); textRun = 0; }
    } else textRun = 0;
    if (s.title && words(s.title) > 14) lint.push(`slide ${n}: title is ${words(s.title)} words; an assertion fits in <=14.`);
    const bl: Bullet[] = s.bullets ?? [];
    if (bl.length > 5) lint.push(`slide ${n}: ${bl.length} bullets; max 5 - split the slide or move detail to notes.`);
    for (const b of bl) if (words(btext(b)) > 16) lint.push(`slide ${n}: bullet "${btext(b).slice(0, 40)}..." is ${words(btext(b))} words; tighten to <=16 and speak the rest (notes).`);
    if (["content", "big-number", "two-col"].includes(layout) && !s.notes) lint.push(`slide ${n}: no speaker notes; the narrative belongs in notes, not on the slide.`);
  });
  if (!hasVisual && slides.length > 4) lint.push("deck has no images, big numbers or quotes at all; audiences retain visuals, not bullet walls.");
}

// --- Render ------------------------------------------------------------------
for (const s of spec.slides ?? []) {
  const layout = s.layout ?? "content";

  if (layout === "title") {
    const slide = pptx.addSlide({ masterName: "PLAIN" });
    const textW = cover ? 6.9 : 11.7;
    // Cover asset must be pre-cropped to the panel ratio (4.93:7.5); it is placed 1:1.
    if (cover) slide.addImage({ path: cover, x: 8.4, y: 0, w: 4.93, h: 7.5 });
    if (logoLight) slide.addImage({ path: logoLight, x: 0.8, y: 0.55, w: 1.66, h: 1.66 / LOGO_AR });
    slide.addShape("rect", { x: 0.8, y: 2.95, w: 1.6, h: 0.12, fill: { color: C.accent } });
    slide.addText(s.title ?? "", { x: 0.8, y: 3.15, w: textW, h: 1.9, fontFace: HEAD, fontSize: 40, bold: true, color: C.heading, valign: "top" });
    if (s.subtitle) slide.addText(s.subtitle, { x: 0.8, y: 5.05, w: textW, h: 0.9, fontFace: BODY, fontSize: 18, color: C.text, valign: "top" });
    const byline = [s.author ?? spec.author, s.date].filter(Boolean).join("  ·  ");
    if (byline) slide.addText(byline, { x: 0.8, y: 6.7, w: textW, h: 0.4, fontFace: BODY, fontSize: 12, color: C.muted });
    if (s.notes) slide.addNotes(s.notes);
    continue;
  }

  if (layout === "section") {
    const slide = pptx.addSlide({ masterName: "SECTION" });
    if (s.kicker) slide.addText(s.kicker, { x: 0.8, y: 2.35, w: 11.7, h: 0.4, fontFace: BODY, fontSize: 14, color: C.sectionMuted });
    slide.addShape("rect", { x: 0.8, y: 2.9, w: 1.6, h: 0.12, fill: { color: C.accent } });
    slide.addText(s.title ?? "", { x: 0.8, y: 3.1, w: 11.7, h: 1.7, fontFace: HEAD, fontSize: 34, bold: true, color: C.sectionText, valign: "top" });
    if (s.subtitle) slide.addText(s.subtitle, { x: 0.8, y: 4.8, w: 11.0, h: 0.8, fontFace: BODY, fontSize: 16, color: C.sectionMuted, valign: "top" });
    if (s.notes) slide.addNotes(s.notes);
    continue;
  }

  if (layout === "closing") {
    const slide = pptx.addSlide({ masterName: "SECTION" });
    if (logoDark) slide.addImage({ path: logoDark, x: 5.47, y: 2.35, w: 2.4, h: 2.4 / LOGO_AR });
    slide.addText(s.title ?? "Thank you", { x: 0.8, y: 3.6, w: 11.7, h: 1.0, align: "center", fontFace: HEAD, fontSize: 30, bold: true, color: C.sectionText });
    if (s.subtitle) slide.addText(s.subtitle, { x: 0.8, y: 4.6, w: 11.7, h: 0.6, align: "center", fontFace: BODY, fontSize: 15, color: C.sectionMuted });
    if (s.notes) slide.addNotes(s.notes);
    continue;
  }

  const slide = pptx.addSlide({ masterName: "MAIN" });

  if (layout === "two-col") {
    contentTitle(slide, s.title);
    const L = normCol(s.left), R = normCol(s.right);
    const col = (c: { heading?: string; bullets: Bullet[] }, x: number) => {
      let y = 1.75;
      if (c.heading) {
        slide.addShape("rect", { x, y, w: 5.73, h: 0.5, fill: { color: C.tint } });
        slide.addText(c.heading, { x: x + 0.15, y, w: 5.45, h: 0.5, fontFace: HEAD, fontSize: 15, bold: true, color: C.heading, valign: "middle" });
        y += 0.68;
      }
      addBullets(slide, c.bullets, { x, y, w: 5.73, h: 6.85 - y }, 15);
    };
    col(L, 0.8);
    col(R, 6.8);
  } else if (layout === "image") {
    contentTitle(slide, s.title);
    if (s.image?.path) {
      const p = await slideImage(s.image.path);
      slide.addImage({ path: p, ...(await fitContain(p, { x: 1.6, y: 1.75, w: 10.1, h: 4.55 })) });
    }
    if (s.image?.caption)
      slide.addText(s.image.caption, { x: 0.8, y: 6.4, w: 11.7, h: 0.45, fontFace: BODY, fontSize: 12, italic: true, color: C.muted, align: "center" });
  } else if (layout === "big-number") {
    slide.addText(String(s.number ?? ""), { x: 0.8, y: 1.5, w: 5.6, h: 2.9, fontFace: HEAD, fontSize: 110, bold: true, color: C.number, valign: "top" });
    slide.addText(s.label ?? "", { x: 0.8, y: 4.5, w: 5.6, h: 1.4, fontFace: HEAD, fontSize: 22, bold: true, color: C.heading, valign: "top" });
    if (s.body) {
      slide.addShape("rect", { x: 6.9, y: 2.0, w: 0.05, h: 3.4, fill: { color: C.accent } });
      slide.addText(s.body, { x: 7.25, y: 2.0, w: 5.25, h: 4.4, fontFace: BODY, fontSize: 15, color: C.text, valign: "top" });
    }
  } else if (layout === "quote") {
    slide.addText("“", { x: 0.7, y: 0.9, w: 1.6, h: 1.6, fontFace: HEAD, fontSize: 120, bold: true, color: C.accent });
    slide.addText(s.text ?? "", { x: 1.7, y: 2.3, w: 10.3, h: 2.9, fontFace: HEAD, fontSize: 26, italic: true, color: C.heading, valign: "top" });
    if (s.attribution) slide.addText("— " + s.attribution, { x: 1.7, y: 5.4, w: 10.3, h: 0.5, fontFace: BODY, fontSize: 14, color: C.muted });
  } else {
    // content, optionally with a supporting visual on the right
    contentTitle(slide, s.title);
    if (s.image?.path) {
      const p = await slideImage(s.image.path);
      addBullets(slide, s.bullets ?? [], { x: 0.8, y: 1.75, w: 6.1, h: 5.1 });
      slide.addImage({ path: p, ...(await fitContain(p, { x: 7.3, y: 1.75, w: 5.23, h: 4.55 })) });
      if (s.image.caption)
        slide.addText(s.image.caption, { x: 7.3, y: 6.35, w: 5.23, h: 0.45, fontFace: BODY, fontSize: 11, italic: true, color: C.muted, align: "center" });
    } else if (s.bullets?.length) {
      addBullets(slide, s.bullets, { x: 0.8, y: 1.75, w: 11.7, h: 5.1 });
    }
  }
  if (s.notes) slide.addNotes(s.notes);
}

mkdirSync(dirname(outPath), { recursive: true });
await pptx.writeFile({ fileName: outPath });
for (const l of lint) console.error("lint: " + l);
console.log(
  `Wrote ${outPath} (${(spec.slides ?? []).length} slides, template: ${tpl.name}).` +
    (lint.length ? ` ${lint.length} lint warning(s) above - fix the spec and re-run.` : "") +
    ` Imports into Google Slides via File > Import.`,
);
