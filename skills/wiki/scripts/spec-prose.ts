#!/usr/bin/env bun
// Pulls the prose out of a deck or document spec so hogwash can scan it.
//
// Usage:
//   bun spec-prose.ts <spec.json> [-o <out.md>]
//
// hogwash scans markdown files. A deck or doc spec is JSON, and its prose sits
// in nested fields no scanner would find. This writes those fields out as a
// markdown file and prints a line-number index, so a finding at line 12 can be
// read back as "slide 3 bullet 2".
//
// The shape of the written file carries one decision. A field that holds body
// copy becomes a paragraph; everything else becomes a list item. hogwash's
// paragraph-length rule only measures paragraphs, and a bullet, a caption and a
// slide title are one line by design. Speaker notes are a spoken script and run
// long on purpose, so measuring them against a published-prose rule produces
// only noise the reader learns to skip.
//
// Then:
//   bun .claude/skills/hogwash/scripts/hogwash.ts scan --fail-on error <out.md>
//
// Exit codes: 0 written, 1 usage or no prose found.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface SpecText {
  where: string;
  text: string;
}

/**
 * Deck and document specs hide their prose in nested fields. This finds it and
 * labels each piece so a finding points at a slide rather than a byte offset.
 * Paths, numbers and layout names are not prose and are left alone.
 */
export function textsFromSpec(spec: any): SpecText[] {
  const out: SpecText[] = [];
  const push = (where: string, v: unknown) => {
    if (typeof v !== "string") return;
    const t = v.trim();
    if (!t || /^\d+([.,]\d+)?%?$/.test(t)) return; // a bare number is not prose
    out.push({ where, text: t });
  };

  if (Array.isArray(spec?.slides)) {
    spec.slides.forEach((s: any, i: number) => {
      const n = i + 1;
      for (const f of ["title", "subtitle", "kicker", "label", "body", "text", "attribution", "notes"]) {
        push(`slide ${n} ${f}`, s?.[f]);
      }
      (s?.bullets ?? []).forEach((b: any, j: number) =>
        push(`slide ${n} bullet ${j + 1}`, typeof b === "string" ? b : b?.text));
      push(`slide ${n} caption`, s?.image?.caption);
      for (const side of ["left", "right"]) {
        const col = s?.[side];
        if (!col) continue;
        push(`slide ${n} ${side} heading`, col.heading);
        (Array.isArray(col) ? col : col.bullets ?? []).forEach((b: any, j: number) =>
          push(`slide ${n} ${side} bullet ${j + 1}`, typeof b === "string" ? b : b?.text));
      }
    });
  }

  if (Array.isArray(spec?.sections)) {
    spec.sections.forEach((s: any, i: number) => {
      const n = i + 1;
      for (const f of ["heading", "body", "text", "caption"]) push(`section ${n} ${f}`, s?.[f]);
      (s?.paragraphs ?? []).forEach((p: any, j: number) => push(`section ${n} para ${j + 1}`, p));
    });
  }

  return out;
}

/** Which fields are body copy, and so get measured as paragraphs. */
export function isBodyCopy(where: string): boolean {
  return where.endsWith("body") || /\bpara \d+$/.test(where);
}

export interface Rendered {
  markdown: string;
  /** One entry per piece: the 1-based line its text starts on, and its label. */
  index: Array<{ line: number; where: string }>;
}

/**
 * The pieces as a markdown file. Each piece is its own block, separated by a
 * blank line, so hogwash measures them independently and a line number maps
 * back to exactly one piece.
 */
export function renderProse(pieces: readonly SpecText[]): Rendered {
  const lines: string[] = [];
  const index: Array<{ line: number; where: string }> = [];
  for (const piece of pieces) {
    if (lines.length) lines.push("");
    index.push({ line: lines.length + 1, where: piece.where });
    // A list item is one line, so a piece that wraps keeps its marker on the
    // first line only and the rest continues the same item.
    const body = isBodyCopy(piece.where) ? piece.text : `- ${piece.text.replace(/\n+/g, " ")}`;
    lines.push(...body.split("\n"));
  }
  return { markdown: lines.join("\n") + "\n", index };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const outAt = argv.indexOf("-o");
  const outArg = outAt >= 0 ? argv[outAt + 1] : undefined;
  // The index to skip is -o's value, and only when -o was given: without the
  // guard, `outAt + 1` is 0 and the first positional argument disappears.
  const skip = outAt >= 0 ? outAt + 1 : -1;
  const [spec] = argv.filter((a, i) => !a.startsWith("-") && i !== skip);

  if (!spec) {
    console.error("Usage: bun spec-prose.ts <spec.json> [-o <out.md>]");
    process.exit(1);
  }
  if (!existsSync(spec)) {
    console.error(`spec-prose: no such file: ${spec}`);
    process.exit(1);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(spec, "utf8"));
  } catch {
    console.error(`spec-prose: ${spec} is not valid JSON`);
    process.exit(1);
  }

  const pieces = textsFromSpec(parsed);
  if (!pieces.length) {
    console.error(`spec-prose: no prose found in ${spec}; is it a deck or doc spec?`);
    process.exit(1);
  }

  const out = outArg ?? join(dirname(spec), basename(spec).replace(/\.json$/, "") + ".prose.md");
  const { markdown, index } = renderProse(pieces);
  writeFileSync(out, markdown);

  console.log(out);
  for (const entry of index) console.log(`  line ${entry.line}: ${entry.where}`);
  console.log(
    `\nNow scan it:\n  bun .claude/skills/hogwash/scripts/hogwash.ts scan --fail-on error ${out}`,
  );
}
