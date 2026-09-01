// Tests for the read-plan slicer in outline.ts.
//
// The whole point of outline.ts is that every printed `sed -n` command returns
// an amount of text the agent can actually receive. A slice that overshoots the
// budget silently truncates (or gets spilled to a file), which costs the agent a
// wasted tool call and, worse, can lose the tail of a section without saying so.
//
// So the invariant under test is blunt: NO slice exceeds the budget, ever.
import { describe, expect, test } from "bun:test";
import { findHeadings, planSlices, sliceChars } from "./outline";

/** Build a synthetic text file: `n` lines of `width` chars, with headings injected. */
function makeLines(n: number, width: number, headingsAt: Record<number, string> = {}): string[] {
  const lines: string[] = [];
  for (let i = 1; i <= n; i++) {
    lines.push(headingsAt[i] ?? "x".repeat(width));
  }
  return lines;
}

const BUDGET = 12_000;

describe("planSlices honours the budget", () => {
  test("a file with no headings is chunked under budget", () => {
    const lines = makeLines(4000, 80);
    const cuts = planSlices(lines, BUDGET);
    expect(cuts.length).toBeGreaterThan(1);
    for (const c of cuts) {
      expect(sliceChars(lines, c.from, c.to)).toBeLessThanOrEqual(BUDGET);
    }
  });

  test("REGRESSION: one huge span between two headings is subdivided", () => {
    // This is the exact shape that broke on real EU legislation: ~1,800 lines of
    // recitals before the first "CHAPTER I" heading. The old code emitted that
    // whole run as a single slice because it only ever cut *at* a heading.
    const lines = makeLines(2000, 80, { 1900: "CHAPTER I" });
    const cuts = planSlices(lines, BUDGET);

    for (const c of cuts) {
      expect(sliceChars(lines, c.from, c.to)).toBeLessThanOrEqual(BUDGET);
    }
    // The front matter alone is ~154k chars, so it must become many slices.
    expect(cuts.length).toBeGreaterThan(10);
  });

  test("REGRESSION: every span oversized, as in a 129-page proposal", () => {
    // Headings every 400 lines * 80 chars = ~32k per span, all over budget.
    const headings: Record<number, string> = {};
    for (let i = 1; i <= 4000; i += 400) headings[i] = `Article ${i}`;
    const lines = makeLines(4000, 80, headings);

    const cuts = planSlices(lines, BUDGET);
    for (const c of cuts) {
      expect(sliceChars(lines, c.from, c.to)).toBeLessThanOrEqual(BUDGET);
    }
  });

  test("slices tile the file with no gaps and no overlap", () => {
    const lines = makeLines(2000, 80, { 700: "CHAPTER I", 1500: "CHAPTER II" });
    const cuts = planSlices(lines, BUDGET);

    expect(cuts[0]!.from).toBe(1);
    expect(cuts[cuts.length - 1]!.to).toBe(lines.length);
    for (let i = 1; i < cuts.length; i++) {
      expect(cuts[i]!.from).toBe(cuts[i - 1]!.to + 1);
    }
  });

  test("small files stay a single slice", () => {
    const lines = makeLines(50, 80, { 10: "1. Intro" });
    const cuts = planSlices(lines, BUDGET);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ from: 1, to: 50 });
  });

  test("subdivided spans are labelled as parts so the agent knows it is mid-section", () => {
    const lines = makeLines(1000, 80, { 1: "CHAPTER I" });
    const cuts = planSlices(lines, BUDGET);
    expect(cuts.length).toBeGreaterThan(1);
    // Every part of a subdivided heading names that heading.
    expect(cuts.filter((c) => /CHAPTER I/.test(c.label)).length).toBe(cuts.length);
    expect(cuts.some((c) => /part \d+\/\d+/.test(c.label))).toBe(true);
  });

  test("REGRESSION: multi-byte text is budgeted in bytes, not JS chars", () => {
    // Curly quotes cost 3 UTF-8 bytes but 1 String.length char. Budgeting in
    // chars overshot real EU legislation by up to 1.2%, enough to spill a read.
    const lines = makeLines(3000, 0).map(() => "’".repeat(80));
    const cuts = planSlices(lines, BUDGET);
    for (const c of cuts) {
      let bytes = 0;
      for (let i = c.from - 1; i < c.to; i++) bytes += Buffer.byteLength(lines[i]!, "utf8") + 1;
      expect(bytes).toBeLessThanOrEqual(BUDGET);
    }
  });

  test("a single line longer than the budget still yields a usable slice", () => {
    const lines = makeLines(3, 20_000);
    const cuts = planSlices(lines, BUDGET);
    // Cannot split within a line, but must not silently drop any.
    expect(cuts[0]!.from).toBe(1);
    expect(cuts[cuts.length - 1]!.to).toBe(3);
    for (let i = 1; i < cuts.length; i++) {
      expect(cuts[i]!.from).toBe(cuts[i - 1]!.to + 1);
    }
  });
});

describe("findHeadings", () => {
  test("finds markdown ATX headings with depth", () => {
    const h = findHeadings(["# Top", "text", "### Deep", "more text here to pad it out"]);
    expect(h).toEqual([
      { line: 1, depth: 1, text: "Top" },
      { line: 3, depth: 3, text: "Deep" },
    ]);
  });

  test("finds the CHAPTER/Article headings PDF extraction leaves behind", () => {
    const h = findHeadings([
      "CHAPTER I",
      "This is a sentence of body text that follows the heading.",
    ]);
    expect(h.map((x) => x.text)).toContain("CHAPTER I");
  });

  test("ignores sentence-like lines", () => {
    const h = findHeadings([
      "1. This clause ends in a full stop and is therefore prose.",
      "Some following body text that is long enough to matter.",
    ]);
    expect(h).toHaveLength(0);
  });
});
