#!/usr/bin/env bun
// Maps the structure of extracted text so you can read a large source in exact chunks
// instead of cat-ing it and blowing the output limit.
//
// Usage:
//   bun outline.ts                 # every source still pending ingest (raw .md/.txt included)
//   bun outline.ts <slug|path...>  # named derived slugs, raw-relative paths, or any text file
//   bun outline.ts --all           # every source in the manifest
//
// Prints, per file: size, line count, a read plan, and a heading map with line ranges.
// Copy the printed `sed -n` commands to read one section at a time.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadManifest, slugFor, wikiRootOrDie } from "./common";

// Bash tool output starts truncating well before this; ~12 KB is a safe slice.
// Measured in UTF-8 bytes, which is what the pipe carries (see sliceChars).
const SAFE_BYTES = 12_000;

interface Heading {
  line: number; // 1-indexed
  depth: number;
  text: string;
}

/** Markdown ATX headings, plus the numbered-section headings that PDF text extraction leaves behind. */
export function findHeadings(lines: string[]): Heading[] {
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

/**
 * UTF-8 **byte** cost of lines [from..to], 1-indexed inclusive, counting newlines.
 *
 * Bytes, not `String.length`: the tool output limit is measured in bytes, and
 * extracted legislation is full of curly quotes and en dashes that cost 3 bytes
 * each but count as 1 JS char. Budgeting in chars overshot by up to 1.2% on real
 * EU texts, which is exactly the margin that turns a clean read into a spill.
 */
export function sliceChars(lines: string[], from: number, to: number): number {
  let n = 0;
  for (let i = from - 1; i < to && i < lines.length; i++) {
    n += Buffer.byteLength(lines[i]!, "utf8") + 1;
  }
  return n;
}

/** UTF-8 byte cost of one line plus its newline. */
function lineBytes(line: string): number {
  return Buffer.byteLength(line, "utf8") + 1;
}

/**
 * Even slices, used when a file has no usable headings and to subdivide an
 * oversized span. Cuts *before* the line that would breach the budget, so a
 * chunk never exceeds it. A single line longer than the budget cannot be split,
 * so it becomes its own chunk rather than being dropped.
 */
function evenChunks(lines: string[], chars: number): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  let start = 1;
  let budget = 0;
  for (let i = 0; i < lines.length; i++) {
    const cost = lineBytes(lines[i]!);
    if (budget && budget + cost > chars) {
      chunks.push([start, i]); // close before this line
      start = i + 1;
      budget = 0;
    }
    budget += cost;
  }
  if (start <= lines.length) chunks.push([start, lines.length]);
  return chunks;
}

export interface Slice {
  from: number; // 1-indexed inclusive
  to: number; // 1-indexed inclusive
  label: string;
}

/**
 * Build a read plan where **every slice fits the budget**.
 *
 * Headings are cut points, not the only cut points. That distinction is the whole
 * fix: real extracted legislation puts ~1,800 lines of recitals before the first
 * "CHAPTER I", and grouping only *at* headings emitted that run as one 150 KB
 * slice. The agent then pays for a truncated read and may lose the tail silently.
 *
 * So: split into heading-delimited spans, pack small spans together, and subdivide
 * any span that is over budget on its own. A subdivided span keeps its heading in
 * the label with a "part n/m" suffix, so the agent always knows it is mid-section.
 */
export function planSlices(lines: string[], chars: number): Slice[] {
  if (!lines.length) return [];

  const headings = findHeadings(lines);
  const boundaries = [1, ...headings.map((h) => h.line).filter((l) => l > 1), lines.length + 1];
  const uniq = [...new Set(boundaries)].sort((a, b) => a - b);

  // Span = the text from one boundary up to (not including) the next.
  const spans: Slice[] = [];
  for (let i = 0; i < uniq.length - 1; i++) {
    const from = uniq[i]!;
    const to = uniq[i + 1]! - 1;
    if (to < from) continue;
    const h = headings.find((x) => x.line === from);
    spans.push({ from, to, label: h ? h.text : "(front matter)" });
  }
  if (!spans.length) spans.push({ from: 1, to: lines.length, label: "(whole file)" });

  const out: Slice[] = [];
  let pending: Slice | null = null;

  const flush = () => {
    if (pending) out.push(pending);
    pending = null;
  };

  for (const span of spans) {
    const cost = sliceChars(lines, span.from, span.to);

    if (cost > chars) {
      // Over budget on its own: emit what is pending, then subdivide this span.
      flush();
      const sub = evenChunks(lines.slice(span.from - 1, span.to), chars);
      const total = sub.length;
      sub.forEach(([a, b], idx) => {
        out.push({
          from: span.from + a - 1,
          to: span.from + b - 1,
          label: total > 1 ? `${span.label} (part ${idx + 1}/${total})` : span.label,
        });
      });
      continue;
    }

    if (pending && sliceChars(lines, pending.from, span.to) <= chars) {
      pending = { from: pending.from, to: span.to, label: pending.label };
    } else {
      flush();
      pending = { ...span };
    }
  }
  flush();

  return out;
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

  if (bytes <= SAFE_BYTES) {
    console.log(`  Small enough to read whole:  cat ${rel}`);
    return;
  }

  console.log(`  Too big to cat. Read it in the slices below.`);

  const cuts = planSlices(lines, SAFE_BYTES);

  console.log(`\n  Read plan (${cuts.length} slices, each under ${SAFE_BYTES.toLocaleString()} bytes):`);
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
// Guarded so `import { planSlices } from "./outline"` in tests does not run the CLI.
if (import.meta.main) {
// Source types ingest.ts leaves in raw/ with no extraction step.
const READ_RAW = new Set(["markdown", "text"]);
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
    const before = targets.length;
    const entry = m.files[a];
    if (entry && !entry.derived && READ_RAW.has(entry.type)) {
      // Markdown and text sources have no derived/ copy; the raw file is the text.
      const p = join(root, "raw", a);
      if (existsSync(p)) targets.push(p);
    } else {
      const slug = entry ? slugFor(a) : a;
      const dir = join(root, "derived", slug);
      for (const f of ["text.md", "text.txt"]) {
        if (existsSync(join(dir, f))) targets.push(join(dir, f));
      }
    }
    if (targets.length === before) console.error(`no text found for: ${a}`);
  }
} else {
  for (const [rel, e] of Object.entries(m.files)) {
    if (!wantAll && e.status !== "extracted") continue;
    if (!e.derived) {
      // A raw .md or .txt is read directly, and a long one truncates under
      // `cat` exactly like extracted text does. It gets a read plan too.
      if (READ_RAW.has(e.type) && existsSync(join(root, "raw", rel))) targets.push(join(root, "raw", rel));
      continue;
    }
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

console.log(`Outlining ${targets.length} file(s). Slice budget: ${SAFE_BYTES.toLocaleString()} bytes.`);
for (const t of targets) report(root, t);
console.log("");
}
