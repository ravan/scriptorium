#!/usr/bin/env bun
// Scans raw/, updates the manifest, and extracts text + images from new or
// changed sources into derived/. The agent then reads derived/ and writes wiki
// pages. This script never touches wiki/.
// Usage: bun ingest.ts [wiki-folder] [--dry-run]
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

const dryRun = process.argv.includes("--dry-run");
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
  const media = copyMedia(join(tmp, "ppt", "media"), join(outDir, "media"));
  if (media.length) lines.push(`## Embedded media`, "", media.map((m) => `- media/${m}`).join("\n"), "");
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(join(outDir, "text.md"), lines.join("\n"));
  return `${nums.length} slides, ${media.length} media files`;
}

async function extractDocx(src: string, outDir: string): Promise<string> {
  const tmp = join(outDir, ".unzip-tmp");
  if (!unzipTo(src, tmp)) throw new Error("unzip failed for " + src);
  const xml = await Bun.file(join(tmp, "word", "document.xml")).text();
  const paras = paragraphsFrom(xml, /<\/w:p>/, /<w:t[^>]*>([^<]*)<\/w:t>/g);
  const media = copyMedia(join(tmp, "word", "media"), join(outDir, "media"));
  rmSync(tmp, { recursive: true, force: true });
  const lines = [`# ${basename(src)} - extracted text`, "", ...paras.map((p) => p + "\n")];
  if (media.length) lines.push(`## Embedded media`, "", media.map((m) => `- media/${m}`).join("\n"));
  writeFileSync(join(outDir, "text.md"), lines.join("\n"));
  return `${paras.length} paragraphs, ${media.length} media files`;
}

function extractPdf(src: string, outDir: string): string {
  for (const tool of ["pdftotext", "pdfimages", "pdftoppm", "pdfinfo"]) {
    if (!have(tool)) throw new Error(`${tool} is missing. Install with: brew install poppler`);
  }
  mkdirSync(outDir, { recursive: true });
  run(["pdftotext", "-layout", src, join(outDir, "text.txt")]);
  const mediaDir = join(outDir, "media");
  mkdirSync(mediaDir, { recursive: true });
  run(["pdfimages", "-png", src, join(mediaDir, "img")]);
  const pages = Number(run(["pdfinfo", src]).stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
  const pagesDir = join(outDir, "pages");
  mkdirSync(pagesDir, { recursive: true });
  const renderTo = Math.min(pages, PAGE_RENDER_CAP);
  if (renderTo > 0) run(["pdftoppm", "-png", "-r", "80", "-l", String(renderTo), src, join(pagesDir, "page")]);
  const capNote = pages > PAGE_RENDER_CAP ? ` (page images capped at ${PAGE_RENDER_CAP} of ${pages})` : "";
  const imgs = readdirSync(mediaDir).length;
  return `${pages} pages, ${imgs} embedded images${capNote}`;
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

  if (prev && prev.sha256 === hash && prev.status !== "removed") {
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
        : extractPdf(abs, outDir);
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

  manifest.files[rel] = {
    sha256: hash,
    size: st.size,
    mtime: st.mtime.toISOString(),
    type,
    status,
    extractedAt: new Date().toISOString(),
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
