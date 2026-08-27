#!/usr/bin/env bun
// Maps the structure of extracted text so you can read a large source in exact chunks
// instead of cat-ing it and blowing the output limit.
//
// Usage:
//   bun outline.ts                 # every source still pending ingest
//   bun outline.ts <slug|path...>  # named derived slugs or any text file
//   bun outline.ts --all           # every source in the manifest
//
// Prints, per file: size, line count, a read plan, and a heading map with line ranges.
// Copy the printed `sed -n` commands to read one section at a time.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadManifest, slugFor, wikiRootOrDie } from "./common";

// Bash tool output starts truncating well before this; ~12k chars is a safe slice.
const SAFE_CHARS = 12_000;

interface Heading {
  line: number; // 1-indexed
  depth: number;
  text: string;
}

/** Markdown ATX headings, plus the numbered-section headings that PDF text extraction leaves behind. */
function findHeadings(lines: string[]): Heading[] {
  const out: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (!line) continue;

    const atx = /^(#{1,6})\s+(.*)$/.exec(line);
    if (atx) {
      out.push({ line: i + 1, depth: atx[1]!.length, text: atx[2]!.trim() });
      continue;
    }

    // "3. Runtime Layers" / "Stage A: Open Build Service" / "Appendix 2: Governance"
    // Only when short, not sentence-like, and followed by a blank line or a paragraph.
    if (line.length > 90 || line.endsWith(".") || line.endsWith(",")) continue;
    const numbered = /^(\d{1,2})[.)]\s+\S/.test(line);
    const labelled = /^(Stage|Layer|Section|Appendix|Phase|Part|Chapter|Figure|Table)\b/i.test(line);
    if (!numbered && !labelled) continue;
    const next = (lines[i + 1] ?? "").trim();
    if (next && next.length < 40 && !next.endsWith(".")) continue; // looks like a list, not a heading
    out.push({ line: i + 1, depth: numbered ? 2 : 3, text: line });
  }
  return out;
}

/** Even slices, used when a file has no usable headings. */
function evenChunks(lines: string[], chars: number): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  let start = 1;
  let budget = 0;
  for (let i = 0; i < lines.length; i++) {
    budget += lines[i]!.length + 1;
    if (budget >= chars) {
      chunks.push([start, i + 1]);
      start = i + 2;
      budget = 0;
    }
  }
  if (start <= lines.length) chunks.push([start, lines.length]);
  return chunks;
}

function report(root: string, absPath: string): void {
  const rel = relative(root, absPath) || absPath;
  if (!existsSync(absPath)) {
    console.log(`\n## ${rel}\n  missing`);
    return;
  }
  const bytes = statSync(absPath).size;
  const lines = readFileSync(absPath, "utf8").split("\n");
  const headings = findHeadings(lines);

  console.log(`\n## ${rel}`);
  console.log(`  ${bytes.toLocaleString()} bytes · ${lines.length} lines`);

  if (bytes <= SAFE_CHARS) {
    console.log(`  Small enough to read whole:  cat ${rel}`);
    return;
  }

  console.log(`  Too big to cat. Read it in the slices below.`);

  // Group headings into slices that each stay under the safe size.
  const cuts: Array<{ from: number; to: number; label: string }> = [];
  if (headings.length >= 2) {
    let from = 1;
    let label = "(front matter)";
    let budget = 0;
    for (const h of headings) {
      const spanChars = lines.slice(from - 1, h.line - 1).reduce((n, l) => n + l.length + 1, 0);
      if (budget + spanChars > SAFE_CHARS && h.line > from) {
        cuts.push({ from, to: h.line - 1, label });
        from = h.line;
        label = h.text;
        budget = 0;
      } else {
        budget += spanChars;
        if (label === "(front matter)" && cuts.length === 0 && from === 1) label = h.text;
      }
    }
    cuts.push({ from, to: lines.length, label });
  } else {
    for (const [from, to] of evenChunks(lines, SAFE_CHARS)) {
      cuts.push({ from, to, label: `lines ${from}-${to}` });
    }
  }

  console.log(`\n  Read plan (${cuts.length} slices):`);
  const cmds = cuts.map((c) => `sed -n '${c.from},${c.to}p' ${rel}`);
  const width = Math.max(...cmds.map((c) => c.length));
  for (let i = 0; i < cuts.length; i++) {
    console.log(`    ${cmds[i]!.padEnd(width)}  # ${cuts[i]!.label}`);
  }

  if (headings.length) {
    console.log(`\n  Headings (${headings.length}):`);
    for (const h of headings) {
      console.log(`    ${String(h.line).padStart(5)}  ${"  ".repeat(Math.max(0, h.depth - 1))}${h.text}`);
    }
  }
}

// ---- resolve what to inspect -------------------------------------------------

const args = process.argv.slice(2).filter((a) => a !== "--all");
const wantAll = process.argv.includes("--all");
const root = wikiRootOrDie();
const m = loadManifest(root);

const targets: string[] = [];

if (args.length) {
  for (const a of args) {
    const direct = resolve(a);
    if (existsSync(direct) && statSync(direct).isFile()) {
      targets.push(direct);
      continue;
    }
    // Treat as a derived slug or a raw-relative path.
    const slug = m.files[a] ? slugFor(a) : a;
    const dir = join(root, "derived", slug);
    for (const f of ["text.md", "text.txt"]) {
      if (existsSync(join(dir, f))) targets.push(join(dir, f));
    }
    if (!targets.length) console.error(`no derived text found for: ${a}`);
  }
} else {
  for (const e of Object.values(m.files)) {
    if (!wantAll && e.status !== "extracted") continue;
    if (!e.derived) continue;
    for (const f of ["text.md", "text.txt"]) {
      const p = join(root, e.derived, f);
      if (existsSync(p)) targets.push(p);
    }
  }
}

if (!targets.length) {
  console.log(
    wantAll || args.length
      ? "Nothing to outline."
      : "Nothing pending. Use --all to outline every source, or name a slug.",
  );
  process.exit(0);
}

console.log(`Outlining ${targets.length} file(s). Slice budget: ${SAFE_CHARS.toLocaleString()} chars.`);
for (const t of targets) report(root, t);
console.log("");
