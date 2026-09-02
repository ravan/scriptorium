#!/usr/bin/env bun
// Reclaims disk space: deletes derived/ artefacts that served their purpose
// during ingestion and will never be needed again. Never touches raw/ or wiki/.
//
// Usage:
//   bun clean.ts            # dry run: report what would go, and how many bytes
//   bun clean.ts --apply    # actually delete
//
// Only sources with manifest status "ingested" are cleaned - their knowledge
// already lives in wiki/. Three classes go:
//   1. media/skipped/ and pages/skipped/  - junk the extraction gate filtered
//      (skipped.json, the record of WHY, always stays)
//   2. pages/ renders                     - PDF page pictures, viewing aids only
//   3. unreferenced media/                - images no wiki page links to
// Anything a wiki page links to is kept, always. text.md / text.txt stay too:
// they are small and lint re-reads them.
//
// Everything deleted can be regenerated from the untouched raw/ file:
//   bun scripts/ingest.ts --re-extract <raw-rel-path>
import { existsSync, readFileSync, readdirSync, rmdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { loadManifest, markdownLinks, wikiRootOrDie } from "./common";

const apply = process.argv.includes("--apply");
const root = wikiRootOrDie();
const wikiDir = join(root, "wiki");
const derivedDir = join(root, "derived");
const m = loadManifest(root);

// ---- what the wiki still points at -------------------------------------------
function walkMd(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkMd(p, out);
    else if (f.endsWith(".md")) out.push(p);
  }
  return out;
}

const referenced = new Set<string>(); // absolute paths under derived/ that wiki pages link to
for (const page of walkMd(wikiDir)) {
  for (const l of readFileSync(page, "utf8").split("\n")) {
    for (const link of markdownLinks(l)) {
      if (link.external || !link.target) continue;
      const abs = resolve(dirname(page), link.target);
      if (abs.startsWith(derivedDir + "/")) referenced.add(abs);
    }
  }
}

// ---- collect candidates --------------------------------------------------------
interface Candidate {
  abs: string;
  bytes: number;
  cls: "skipped junk" | "page render" | "unreferenced media";
}
const candidates: Candidate[] = [];
const skippedSources: string[] = [];

function filesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile());
}

for (const [rel, e] of Object.entries(m.files)) {
  if (!e.derived) continue;
  const base = join(root, e.derived);
  if (!existsSync(base)) continue;
  if (e.status !== "ingested") {
    skippedSources.push(`${rel} (status ${e.status})`);
    continue;
  }
  for (const sub of ["media", "pages"]) {
    for (const p of filesIn(join(base, sub, "skipped")))
      candidates.push({ abs: p, bytes: statSync(p).size, cls: "skipped junk" });
  }
  for (const p of filesIn(join(base, "pages"))) {
    if (!referenced.has(p)) candidates.push({ abs: p, bytes: statSync(p).size, cls: "page render" });
  }
  for (const p of filesIn(join(base, "media"))) {
    if (!referenced.has(p)) candidates.push({ abs: p, bytes: statSync(p).size, cls: "unreferenced media" });
  }
}

// ---- report / delete ------------------------------------------------------------
const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + " MB";

if (!candidates.length) {
  console.log("Nothing to clean. derived/ holds only referenced or still-pending material.");
  if (skippedSources.length)
    console.log(`Left alone (not ingested yet): ${skippedSources.join(", ")}`);
  process.exit(0);
}

const byClass = new Map<string, Candidate[]>();
for (const c of candidates) {
  const g = byClass.get(c.cls) ?? [];
  g.push(c);
  byClass.set(c.cls, g);
}

const total = candidates.reduce((n, c) => n + c.bytes, 0);
console.log(
  `${apply ? "Deleting" : "Would delete"} ${candidates.length} file(s), ${mb(total)} total:`,
);
for (const [cls, g] of byClass) {
  const bytes = g.reduce((n, c) => n + c.bytes, 0);
  console.log(`\n${cls} - ${g.length} file(s), ${mb(bytes)}:`);
  const shown = g.slice(0, 20);
  for (const c of shown) console.log(`  ${relative(root, c.abs)}`);
  if (g.length > shown.length) console.log(`  ... and ${g.length - shown.length} more`);
}
if (skippedSources.length)
  console.log(`\nLeft alone (not ingested yet): ${skippedSources.join(", ")}`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to delete. skipped.json records always stay.");
  process.exit(0);
}

for (const c of candidates) rmSync(c.abs);
// Drop directories the deletions emptied (skipped/, pages/).
const dirsToTidy = new Set(candidates.map((c) => dirname(c.abs)));
for (const d of [...dirsToTidy].sort((a, b) => b.length - a.length)) {
  if (existsSync(d) && readdirSync(d).length === 0) rmdirSync(d);
}
console.log(
  `\nDeleted. Reclaimed ${mb(total)}. Regenerate any of it with: bun scripts/ingest.ts --re-extract <raw-rel-path>`,
);
