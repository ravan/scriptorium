#!/usr/bin/env bun
// Inventories extracted images so you can view them efficiently and describe each one once.
//
// Usage:
//   bun media.ts                 # every source still pending ingest
//   bun media.ts <slug|path...>  # named sources
//   bun media.ts --all           # every source in the manifest
//
// ingest.ts already gates junk (blank, tiny, duplicate, unviewable) into
// media/skipped/ at extraction, so normally everything listed here deserves a
// view. On derived/ folders older than the gate, the same checks run here and
// junk is reported as counts and relative paths only - never as a viewable
// absolute path. Detection logic lives in image.ts, shared with ingest.ts.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadManifest, slugFor, wikiRootOrDie } from "./common";
import { type ImageInfo, type SkippedEntry, inspectImage, junkReason, pageIsTextOnly } from "./image";

interface Info extends ImageInfo {
  abs: string;
  rel: string;
  source: string;
  skip?: string; // junk reason, when the file predates the extraction gate
  textPage?: boolean; // a pages/ render that is only typeset text
}

// ---- gather ------------------------------------------------------------------

const args = process.argv.slice(2).filter((a) => a !== "--all");
const wantAll = process.argv.includes("--all");
const root = wikiRootOrDie();
const m = loadManifest(root);

const dirs: Array<{ source: string; dir: string }> = [];
const skippedJsons: Array<{ source: string; entries: SkippedEntry[] }> = [];

function addSource(rel: string, derived: string | null | undefined) {
  if (!derived) return;
  for (const sub of ["media", "pages"]) {
    const d = join(root, derived, sub);
    if (existsSync(d)) dirs.push({ source: `${rel} · ${sub}`, dir: d });
  }
  const sj = join(root, derived, "skipped.json");
  if (existsSync(sj)) {
    try {
      skippedJsons.push({ source: rel, entries: JSON.parse(readFileSync(sj, "utf8")) });
    } catch {
      /* unreadable skipped.json is not this script's problem */
    }
  }
}

if (args.length) {
  for (const a of args) {
    const direct = resolve(a);
    if (existsSync(direct) && statSync(direct).isDirectory()) {
      dirs.push({ source: relative(root, direct), dir: direct });
      continue;
    }
    const entry = m.files[a];
    if (entry) addSource(a, entry.derived);
    else addSource(a, join("derived", slugFor(a)));
  }
} else {
  for (const [rel, e] of Object.entries(m.files)) {
    if (!wantAll && e.status !== "extracted") continue;
    addSource(rel, e.derived);
  }
}

if (!dirs.length) {
  console.log(
    wantAll || args.length ? "No media found." : "Nothing pending. Use --all, or name a source.",
  );
  process.exit(0);
}

const all: Info[] = [];
const noSeen = new Map<string, string>(); // stays empty: duplicate grouping happens below instead
for (const { source, dir } of dirs) {
  const files = readdirSync(dir)
    .filter((f) => !f.startsWith(".") && f !== "skipped")
    .sort();
  for (const f of files) {
    const abs = join(dir, f);
    if (!statSync(abs).isFile()) continue;
    const info = await inspectImage(abs);
    const junk = junkReason(info, noSeen); // catches blank/tiny/unviewable on pre-gate folders
    // Only `pages/` renders are eligible: an embedded media/ image is a figure by
    // construction, and running it through a text-page test could only lose one.
    let textPage = false;
    if (!junk && source.endsWith("· pages") && info.format === "png") {
      textPage = pageIsTextOnly(Buffer.from(await Bun.file(abs).arrayBuffer()));
    }
    all.push({
      ...info,
      textPage,
      abs,
      rel: relative(root, abs),
      source,
      skip: junk && junk.reason !== "duplicate" ? junk.reason : undefined,
    });
  }
}

// ---- classify ------------------------------------------------------------------

// Exact duplicates across every surveyed folder: view the first, reuse the words.
const byHash = new Map<string, Info[]>();
for (const i of all) {
  if (i.skip) continue;
  const g = byHash.get(i.hash) ?? [];
  g.push(i);
  byHash.set(i.hash, g);
}
const dupGroups = [...byHash.values()].filter((g) => g.length > 1);
const dupFollowers = new Set(dupGroups.flatMap((g) => g.slice(1).map((i) => i.abs)));

const junked = all.filter((i) => i.skip);
const textPages = all.filter((i) => !i.skip && i.textPage);
const toView = all.filter((i) => !i.skip && !i.textPage && !dupFollowers.has(i.abs));
const preGated = skippedJsons.reduce((n, s) => n + s.entries.length, 0);

// ---- report ------------------------------------------------------------------

const parts = [`${toView.length} to view`];
if (dupFollowers.size) parts.push(`${dupFollowers.size} duplicate`);
if (textPages.length) parts.push(`${textPages.length} text-only page render`);
if (junked.length) parts.push(`${junked.length} junk (pre-gate folder)`);
if (preGated) parts.push(`${preGated} already filtered at extraction`);
console.log(`${all.length} image(s) across ${dirs.length} folder(s): ${parts.join(", ")}.`);

let lastSource = "";
for (const i of toView) {
  if (i.source !== lastSource) {
    console.log(`\n## ${i.source}`);
    lastSource = i.source;
  }
  const dim = i.width ? `${i.width}x${i.height}` : "?";
  // Say when a file moves. Viewing it shows one frame, so without this an
  // animation reads as an ordinary still and gets described as one.
  const motion = i.animated
    ? ` · ANIMATED${i.frames ? ` (${i.frames} frames)` : ""} - a view shows frame 1 only`
    : "";
  console.log(`  ${i.abs}`);
  console.log(`      ${i.format} · ${dim} · ${i.bytes.toLocaleString()} B${motion}`);
}

if (dupGroups.length) {
  console.log(`\nIdentical files (same sha256). View the first, reuse its description for the rest:`);
  for (const g of dupGroups) {
    console.log(`  ${g[0]!.rel}`);
    for (const d of g.slice(1)) console.log(`    = ${d.rel}`);
  }
}

// Same size and format is only a hint; never auto-skipped.
const byShape = new Map<string, Info[]>();
for (const i of toView) {
  if (!i.width || dupFollowers.has(i.abs)) continue;
  const k = `${i.format} ${i.width}x${i.height}`;
  const g = byShape.get(k) ?? [];
  g.push(i);
  byShape.set(k, g);
}
const nearDup = [...byShape.entries()].filter(([, g]) => g.length > 1);
if (nearDup.length) {
  console.log(`\nPossible near-duplicates (same format and pixel size - check while viewing):`);
  for (const [k, g] of nearDup) console.log(`  ${k}: ${g.map((i) => i.rel).join(", ")}`);
}

if (junked.length) {
  console.log(
    `\nJunk found in pre-gate folders (account for these in the source page in one line; no need to view):`,
  );
  for (const i of junked) console.log(`  [${i.skip}] ${i.rel}`);
}

if (preGated) {
  console.log(`\nAlready filtered at extraction (recorded in each source's skipped.json):`);
  for (const s of skippedJsons) {
    const byReason = new Map<string, number>();
    for (const e of s.entries) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
    const sum = [...byReason.entries()].map(([r, n]) => `${n} ${r}`).join(", ");
    console.log(`  ${s.source}: ${s.entries.length} (${sum})`);
  }
}

if (textPages.length) {
  const bySource = new Map<string, number>();
  for (const i of textPages) bySource.set(i.source, (bySource.get(i.source) ?? 0) + 1);
  console.log(
    `\nText-only page renders (pictures of text already in text.*). Not worth viewing;` +
      ` account for them in one line on the source page:`,
  );
  for (const [src, n] of bySource) console.log(`  ${src}: ${n}`);
  console.log(`  Need one anyway? Read the file directly, e.g. when the text extraction looks garbled.`);
}

console.log(
  `\nView the ${toView.length} image(s) above and write one line each: what it shows and why it matters.`,
);
