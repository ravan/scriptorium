#!/usr/bin/env bun
// Scans raw/, updates the manifest, and extracts text + images from new or
// changed sources into derived/. The agent then reads derived/ and writes wiki
// pages. This script never touches wiki/.
//
// Junk images (blank, tiny, duplicate, unviewable - see image.ts) are gated
// out at extraction: moved to media/skipped/ with a skipped.json note, so the
// agent never sees a path it should not view.
//
// Usage: bun ingest.ts [wiki-folder] [--dry-run] [--re-extract <raw-rel-path>]
//   --re-extract forces one unchanged file through extraction again (e.g. to
//   regenerate derived/ after clean.ts, or to apply a newer junk gate). The
//   file keeps its manifest status.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import {
  type Manifest,
  decodeXmlEntities,
  have,
  loadManifest,
  run,
  saveManifest,
  sha256,
  slugFor,
  wikiRootOrDie,
} from "./common";
import { type SkippedEntry, gateMediaDir, writeSkippedJson } from "./image";

const dryRun = process.argv.includes("--dry-run");
const reExtractIdx = process.argv.indexOf("--re-extract");
const reExtract = reExtractIdx > -1 ? process.argv[reExtractIdx + 1] : undefined;
if (reExtractIdx > -1 && !reExtract) {
  console.error("--re-extract needs a raw-relative path, e.g. --re-extract deck.pptx");
  process.exit(1);
}
const rootArg = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;
const root = wikiRootOrDie(rootArg);
const rawDir = join(root, "raw");

const PAGE_RENDER_CAP = 60; // max PDF pages rendered as images

// ---------- scan raw/ ----------
function listRawFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listRawFiles(p));
    else out.push(p);
  }
  return out;
}

function typeFor(ext: string): string {
  switch (ext) {
    case ".pptx": return "pptx";
    case ".docx": return "docx";
    case ".pdf": return "pdf";
    case ".md": case ".markdown": return "markdown";
    case ".txt": return "text";
    case ".png": case ".jpg": case ".jpeg": case ".gif": case ".webp": case ".svg": return "image";
    default: return "unsupported";
  }
}

// ---------- office-file extraction (pptx/docx are zip files of XML) ----------
function paragraphsFrom(xml: string, paraClose: RegExp, runRe: RegExp): string[] {
  const out: string[] = [];
  for (const chunk of xml.split(paraClose)) {
    const runs = [...chunk.matchAll(runRe)].map((m) => decodeXmlEntities(m[1]));
    const text = runs.join("").trim();
    if (text) out.push(text);
  }
  return out;
}

// Word paragraphs, with heading styles turned into markdown headings so the
// outline has a map to slice by. Without this a 300-paragraph report is one
// flat span and outline.ts can only cut it evenly.
function docxParagraphs(xml: string): string[] {
  const out: string[] = [];
  for (const chunk of xml.split(/<\/w:p>/)) {
    const text = [...chunk.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => decodeXmlEntities(m[1])).join("").trim();
    if (!text) continue;
    const style = chunk.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    // "Heading1", "Heading 2", "heading3"; "Title" sits above them.
    const level = /^title$/i.test(style) ? 1 : /^heading\s?([1-6])$/i.exec(style)?.[1];
    if (level) out.push(`${"#".repeat(Number(level) + 1)} ${text}`);
    else out.push(text);
  }
  return out;
}

function unzipTo(src: string, dest: string): boolean {
  mkdirSync(dest, { recursive: true });
  return run(["unzip", "-o", "-q", src, "-d", dest]).ok;
}

function copyMedia(fromDir: string, toDir: string): string[] {
  if (!existsSync(fromDir)) return [];
  mkdirSync(toDir, { recursive: true });
  const copied: string[] = [];
  for (const f of readdirSync(fromDir)) {
    cpSync(join(fromDir, f), join(toDir, f));
    copied.push(f);
  }
  return copied;
}

async function extractPptx(src: string, outDir: string): Promise<string> {
  const tmp = join(outDir, ".unzip-tmp");
  if (!unzipTo(src, tmp)) throw new Error("unzip failed for " + src);
  const slidesDir = join(tmp, "ppt", "slides");
  const notesDir = join(tmp, "ppt", "notesSlides");
  const nums = existsSync(slidesDir)
    ? readdirSync(slidesDir)
        .map((f) => f.match(/^slide(\d+)\.xml$/)?.[1])
        .filter((n): n is string => !!n)
        .map(Number)
        .sort((a, b) => a - b)
    : [];
  const lines: string[] = [`# ${basename(src)} - extracted slide text`, ""];
  for (const n of nums) {
    const xml = await Bun.file(join(slidesDir, `slide${n}.xml`)).text();
    lines.push(`## Slide ${n}`, "");
    const paras = paragraphsFrom(xml, /<\/a:p>/, /<a:t>([^<]*)<\/a:t>/g);
    lines.push(paras.length ? paras.map((p) => `- ${p}`).join("\n") : "(no text on this slide)", "");
    const notesFile = join(notesDir, `notesSlide${n}.xml`);
    if (existsSync(notesFile)) {
      const notes = paragraphsFrom(await Bun.file(notesFile).text(), /<\/a:p>/, /<a:t>([^<]*)<\/a:t>/g)
        .filter((p) => p !== String(n)); // drop the slide-number placeholder
      if (notes.length) lines.push("### Speaker notes", "", notes.join("\n\n"), "");
    }
  }
  copyMedia(join(tmp, "ppt", "media"), join(outDir, "media"));
  rmSync(tmp, { recursive: true, force: true });
  const gate = await gateMediaDir(join(outDir, "media"), "media/", new Map());
  writeSkippedJson(outDir, gate.skipped);
  if (gate.kept.length)
    lines.push(`## Embedded media`, "", gate.kept.map((m) => `- media/${m}`).join("\n"), "");
  if (gate.skipped.length)
    lines.push(`(${gate.skipped.length} junk image(s) auto-skipped at extraction - see skipped.json)`, "");
  writeFileSync(join(outDir, "text.md"), lines.join("\n"));
  return `${nums.length} slides, ${gate.kept.length} media files${junkNote(gate.skipped)}`;
}

function junkNote(skipped: SkippedEntry[]): string {
  if (!skipped.length) return "";
  const byReason = new Map<string, number>();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  const parts = [...byReason.entries()].map(([r, n]) => `${n} ${r}`);
  return `, ${skipped.length} junk skipped (${parts.join(", ")})`;
}

async function extractDocx(src: string, outDir: string): Promise<string> {
  const tmp = join(outDir, ".unzip-tmp");
  if (!unzipTo(src, tmp)) throw new Error("unzip failed for " + src);
  const xml = await Bun.file(join(tmp, "word", "document.xml")).text();
  const paras = docxParagraphs(xml);
  copyMedia(join(tmp, "word", "media"), join(outDir, "media"));
  rmSync(tmp, { recursive: true, force: true });
  const gate = await gateMediaDir(join(outDir, "media"), "media/", new Map());
  writeSkippedJson(outDir, gate.skipped);
  const lines = [`# ${basename(src)} - extracted text`, "", ...paras.map((p) => p + "\n")];
  if (gate.kept.length) lines.push(`## Embedded media`, "", gate.kept.map((m) => `- media/${m}`).join("\n"));
  if (gate.skipped.length)
    lines.push(`(${gate.skipped.length} junk image(s) auto-skipped at extraction - see skipped.json)`);
  writeFileSync(join(outDir, "text.md"), lines.join("\n"));
  return `${paras.length} paragraphs, ${gate.kept.length} media files${junkNote(gate.skipped)}`;
}

async function extractPdf(src: string, outDir: string): Promise<string> {
  for (const tool of ["pdftotext", "pdfimages", "pdftoppm", "pdfinfo"]) {
    if (!have(tool)) throw new Error(`${tool} is missing. Install with: brew install poppler`);
  }
  mkdirSync(outDir, { recursive: true });
  const textPath = join(outDir, "text.txt");
  const text = run(["pdftotext", "-layout", src, textPath]);
  if (!text.ok) throw new Error(`pdftotext failed (locked or damaged PDF?): ${text.stderr.trim().split("\n")[0] ?? ""}`);
  // A scanned PDF has no text layer. pdftotext then succeeds and writes form
  // feeds and whitespace, which reads as "empty" only if someone looks.
  const textChars = existsSync(textPath) ? (await Bun.file(textPath).text()).replace(/\s|\f/g, "").length : 0;
  const mediaDir = join(outDir, "media");
  mkdirSync(mediaDir, { recursive: true });
  run(["pdfimages", "-png", src, join(mediaDir, "img")]);
  const pages = Number(run(["pdfinfo", src]).stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
  const pagesDir = join(outDir, "pages");
  mkdirSync(pagesDir, { recursive: true });
  const renderTo = Math.min(pages, PAGE_RENDER_CAP);
  if (renderTo > 0) run(["pdftoppm", "-png", "-r", "80", "-l", String(renderTo), src, join(pagesDir, "page")]);
  const capNote = pages > PAGE_RENDER_CAP ? ` (page images capped at ${PAGE_RENDER_CAP} of ${pages})` : "";
  // One seen-map across media/ and pages/ so a duplicate is caught wherever it sits.
  const seen = new Map<string, string>();
  const mediaGate = await gateMediaDir(mediaDir, "media/", seen);
  const pagesGate = await gateMediaDir(pagesDir, "pages/", seen);
  const skipped = [...mediaGate.skipped, ...pagesGate.skipped];
  writeSkippedJson(outDir, skipped);
  const scanNote = textChars < 40 * Math.max(1, pages)
    ? ` - NO TEXT LAYER (scanned?): text.txt is empty, read the pages/ renders instead`
    : "";
  return `${pages} pages, ${mediaGate.kept.length} embedded images${capNote}${junkNote(skipped)}${scanNote}`;
}

// ---------- main ----------
const manifest: Manifest = loadManifest(root);
const seen = new Set<string>();
const summary = { new: [] as string[], changed: [] as string[], removed: [] as string[], unchanged: 0, unsupported: [] as string[] };

for (const abs of listRawFiles(rawDir)) {
  const rel = relative(rawDir, abs);
  seen.add(rel);
  const st = statSync(abs);
  const hash = await sha256(abs);
  const prev = manifest.files[rel];
  const type = typeFor(extname(abs).toLowerCase());

  const forced = reExtract === rel;
  if (prev && prev.sha256 === hash && prev.status !== "removed" && !forced) {
    summary.unchanged++;
    continue;
  }
  const isChange = !!prev;
  if (dryRun) {
    (isChange ? summary.changed : summary.new).push(rel);
    continue;
  }

  let derivedRel: string | null = null;
  let note = "";
  let status = "extracted";
  try {
    if (type === "pptx" || type === "docx" || type === "pdf") {
      derivedRel = join("derived", slugFor(rel));
      const outDir = join(root, derivedRel);
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
      note =
        type === "pptx" ? await extractPptx(abs, outDir)
        : type === "docx" ? await extractDocx(abs, outDir)
        : await extractPdf(abs, outDir);
    } else if (type === "markdown" || type === "text" || type === "image") {
      note = "read the raw file directly; no extraction needed";
    } else {
      status = "unsupported";
      note = "no extractor for this file type; the agent must handle it manually";
      summary.unsupported.push(rel);
    }
  } catch (e) {
    status = "error";
    note = String(e);
  }

  // A forced re-extract of an unchanged file regenerates derived/ only; the
  // wiki already reflects it, so it must not drop back to "extracted".
  if (forced && prev && prev.sha256 === hash && status === "extracted") status = prev.status;

  manifest.files[rel] = {
    sha256: hash,
    size: st.size,
    mtime: st.mtime.toISOString(),
    type,
    status,
    extractedAt: new Date().toISOString(),
    ingestedAt: forced ? prev?.ingestedAt : undefined,
    derived: derivedRel,
    pagesTouched: prev?.pagesTouched ?? [],
    note,
  };
  (isChange ? summary.changed : summary.new).push(rel);
}

// Files that vanished from raw/
for (const rel of Object.keys(manifest.files)) {
  if (!seen.has(rel) && manifest.files[rel].status !== "removed") {
    if (!dryRun) manifest.files[rel].status = "removed";
    summary.removed.push(rel);
  }
}

if (reExtract && !seen.has(reExtract))
  console.warn(`warning: --re-extract ${reExtract} matched nothing in raw/ (path is relative to raw/).`);

if (!dryRun) saveManifest(root, manifest);

const show = (label: string, items: string[]) =>
  items.length ? `${label} (${items.length}):\n  ` + items.map((r) => `${r}  [${manifest.files[r]?.note ?? ""}]`).join("\n  ") : `${label}: none`;
console.log(dryRun ? "DRY RUN - nothing written.\n" : "");
console.log(show("New, extracted", summary.new));
console.log(show("Changed, re-extracted", summary.changed));
console.log(show("Removed from raw/", summary.removed));
if (summary.unsupported.length) console.log(show("Unsupported", summary.unsupported));
console.log(`Unchanged: ${summary.unchanged}`);
console.log(
  "\nAgent next steps: read each extracted item (derived/<slug>/text.* and media), look at the images, write or update wiki pages, then run:\n  bun scripts/manifest.ts mark-ingested <file> --pages <wiki pages touched>",
);
