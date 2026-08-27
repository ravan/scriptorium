/**
 * Tests for the Lolly client.
 *
 *   bun test                       (from skills/lolly/)
 *
 * Two layers:
 *   1. Unit tests over lolly-core.ts - the rules, called directly.
 *   2. CLI tests that spawn lolly.ts against a LOCAL fake catalog/render server.
 *
 * The fake server is what makes this suite honest: it runs offline, in
 * milliseconds, and never touches lolly.tools, so a failure means our code
 * broke rather than someone else's service moved. Nothing here launches Chrome
 * - every CLI test asks for a GET-tier format, and the one browser-tier case
 * asserts the refusal path instead (LOLLY_CHROME is pointed at a nonexistent
 * binary so the fallback is deterministic).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CHAIN_URL_WARN_CHARS, GET_FORMATS, IMAGE_FORMATS, RESERVED, UsageError,
  annotateSvg, cacheKey, embedUrl, exportTimeoutMs, filterTools, findAnchors,
  formatCatalog, formatDescribe, formatProbe, formatToolList, isImageTool, matchesTool,
  padViewBox, parseArgs, parseViewBox, pathBBox, pickChildFormat, pickFormat, planChain,
  query, readGeometry, shareLink, splitChainSegments, validateInputs,
  type ChainStepSpec, type Manifest, type Tool,
  parseSlotRef,
  blockSlotIds,
  exampleValue,
} from "./lolly-core.ts";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A chart-like maker: has width/height, svg-native, one vector input. */
const CHART: Manifest = {
  id: "chart", name: "Chart", status: "official",
  render: { formats: ["svg", "png", "pdf"], width: 1280, height: 800 },
  inputs: [
    { id: "chartType", type: "select", urlKey: "ct", default: "bar" },
    { id: "data", type: "longtext", urlKey: "d" },
    { id: "width", type: "number", default: 1280 },
    { id: "height", type: "number", default: 800 },
  ],
  examples: [{ label: "Trend", values: { chartType: "line", data: "a,1\nb,2" } }],
};

/** A placer: takes an asset, has its own canvas, and a vector framing input. */
const FRAME: Manifest = {
  id: "frame", name: "Frame", status: "community",
  render: { formats: ["png", "svg", "pdf"], width: 1600, height: 1000 },
  inputs: [
    { id: "image", type: "asset" },
    { id: "imageFraming", type: "vector" },
    { id: "title", type: "text" },
  ],
};

/** A tool with no asset input at all - cannot be a chain consumer. */
const LEAF: Manifest = {
  id: "leaf", name: "Leaf", status: "official",
  render: { formats: ["svg"] },
  inputs: [{ id: "text", type: "text" }],
};

/** Browser-tier only: declares no GET-servable format. */
const VIDEO: Manifest = {
  id: "video", name: "Video", status: "experimental",
  render: { formats: ["mp4", "webm"], width: 1920, height: 1080 },
  inputs: [{ id: "clip", type: "asset" }],
};

/**
 * A deck-like tool: its visual slots live INSIDE a `blocks` list, not at the
 * top level. This is the shape deck-studio and deck-builder really have, and
 * the reason a chain needs a record index and a field name.
 */
const DECK: Manifest = {
  id: "deck", name: "Deck", status: "community",
  render: { formats: ["pptx", "pdf"], width: 1280, height: 720 },
  inputs: [
    { id: "size", type: "select", default: "wide" },
    {
      id: "slides", type: "blocks",
      default: [{ layout: "split", heading: "Default slide" }],
      fields: [
        { id: "layout", type: "select", default: "split", options: [{ value: "split" }, { value: "quote" }] },
        { id: "heading", type: "text" },
        { id: "visual", type: "asset", showFor: ["split"] },
        { id: "notes", type: "text" },
      ],
    },
  ],
  examples: [{ label: "Two up", values: { slides: [{ layout: "split", heading: "Hi" }] } }],
};

const TOOLS: Tool[] = [
  { id: "chart", name: "Chart", description: "Charts things", status: "official", formats: ["svg", "png", "pdf"], version: "1.2.0", category: "designer", tags: ["data", "graph"] },
  { id: "frame", name: "Frame", description: "Frames a shot", status: "community", formats: ["png", "svg", "pdf"], version: "0.9.0", category: "everyone", tags: ["screenshot"] },
  { id: "leaf", name: "Leaf", description: "Makes a leaf", status: "official", formats: ["svg"], version: "1.0.0", category: "everyone" },
  { id: "video", name: "Video", description: "Renders video", status: "experimental", formats: ["mp4", "webm"], version: "0.1.0", category: "designer" },
];

const MANIFESTS: Record<string, Manifest> = { chart: CHART, frame: FRAME, leaf: LEAF, video: VIDEO, deck: DECK };

const step = (id: string, inputs: Array<[string, string]> = [], slot?: string): ChainStepSpec =>
  ({ id, slot, inputs, m: MANIFESTS[id]! });

// ── parseArgs ───────────────────────────────────────────────────────────────

describe("parseArgs", () => {
  test("splits flags, inputs and positionals", () => {
    const r = parseArgs(["chart", "ct=bar", "--format=svg", "-o", "out.svg", "extra"]);
    expect(r.positional).toEqual(["chart", "extra"]);
    expect(r.inputs).toEqual([["ct", "bar"]]);
    expect(r.flags).toEqual({ format: "svg", output: "out.svg" });
  });

  test("keeps only the first = so values may contain =", () => {
    const r = parseArgs(["url=https://x.test/?a=1&b=2"]);
    expect(r.inputs).toEqual([["url", "https://x.test/?a=1&b=2"]]);
  });

  test("keeps newlines and commas in a value verbatim", () => {
    const r = parseArgs(["d=A,1\nB,2"]);
    expect(r.inputs).toEqual([["d", "A,1\nB,2"]]);
  });

  test("accepts an empty value", () => {
    expect(parseArgs(["title="]).inputs).toEqual([["title", ""]]);
  });

  test("preserves duplicate keys in order (last wins at encode time)", () => {
    expect(parseArgs(["a=1", "a=2"]).inputs).toEqual([["a", "1"], ["a", "2"]]);
  });

  test("ignores --fresh and --then, which the caller consumes", () => {
    const r = parseArgs(["--fresh", "chart", "--then", "frame"]);
    expect(r.positional).toEqual(["chart", "frame"]);
    expect(r.flags).toEqual({});
  });

  test("rejects a valueless long flag, which is nearly always a typo", () => {
    expect(() => parseArgs(["--format"])).toThrow(UsageError);
  });

  test("accepts the known boolean flags with no value", () => {
    expect(parseArgs(["--image"]).flags).toEqual({ image: "1" });
  });

  test("rejects a trailing -o with no path", () => {
    expect(() => parseArgs(["-o"])).toThrow("-o needs a file path");
  });
});

// ── validateInputs ──────────────────────────────────────────────────────────

describe("validateInputs", () => {
  test("accepts declared ids and urlKey aliases", () => {
    expect(() => validateInputs(CHART, [["chartType", "bar"], ["d", "x,1"]])).not.toThrow();
  });

  test("accepts reserved output params that are not tool inputs", () => {
    expect(() => validateInputs(LEAF, [["format", "svg"], ["_v", "1.0.0"], ["dpi", "300"]])).not.toThrow();
  });

  test("accepts dotted fields of a vector input", () => {
    expect(() => validateInputs(FRAME, [["imageFraming.zoom", "140"], ["imageFraming.x", "30"]])).not.toThrow();
  });

  test("rejects a dotted field whose stem is not an input", () => {
    expect(() => validateInputs(FRAME, [["nope.zoom", "1"]])).toThrow(UsageError);
  });

  test("rejects an unknown input and lists the real ones", () => {
    expect(() => validateInputs(CHART, [["colour", "green"]]))
      .toThrow(/"colour" is not an input of chart\. Declared inputs: .*chartType/);
  });

  test("a tool with no declared inputs rejects everything non-reserved", () => {
    expect(() => validateInputs({ id: "bare", name: "Bare" }, [["x", "1"]])).toThrow(UsageError);
  });
});

// ── query / shareLink / embedUrl ────────────────────────────────────────────

describe("URL building", () => {
  test("encodes commas and newlines, which is what hand-writing gets wrong", () => {
    expect(query([["d", "A,1\nB,2"]])).toBe("d=A%2C1%0AB%2C2");
  });

  test("later duplicate keys overwrite earlier ones", () => {
    expect(query([["a", "1"], ["a", "2"]])).toBe("a=2");
  });

  test("extras are merged and win over inputs", () => {
    expect(query([["format", "svg"]], { format: "png" })).toBe("format=png");
  });

  test("shareLink targets the app's hash route", () => {
    expect(shareLink("https://h.test", "chart", [["ct", "bar"]], "svg"))
      .toBe("https://h.test/#/tool/chart?ct=bar&format=svg");
  });

  test("shareLink omits the query entirely when there are no inputs", () => {
    expect(shareLink("https://h.test", "chart", [])).toBe("https://h.test/#/tool/chart");
  });

  test("embedUrl is the extension-bearing shape the engine matches on", () => {
    expect(embedUrl("https://h.test", "chart", "svg", [["ct", "bar"]]))
      .toBe("https://h.test/tool/chart.svg?ct=bar");
  });

  test("an embed URL nested as a value survives double encoding", () => {
    const child = embedUrl("https://h.test", "chart", "svg", [["d", "A,1"]]);
    const parent = query([["image", child]]);
    const decoded = new URLSearchParams(parent).get("image");
    expect(decoded).toBe(child);
    // and the child's own params still parse out of it
    expect(new URL(decoded!).searchParams.get("d")).toBe("A,1");
  });
});

// ── format selection ────────────────────────────────────────────────────────

describe("pickFormat", () => {
  test("defaults to the first GET-servable format, not merely the first", () => {
    expect(pickFormat(VIDEO_WITH_SVG_LAST)).toBe("svg");
  });

  test("honours an explicit request", () => {
    expect(pickFormat(CHART, "pdf")).toBe("pdf");
  });

  test("rejects a format the tool does not declare", () => {
    expect(() => pickFormat(CHART, "mp4")).toThrow(/does not produce "mp4"\. Declared: svg, png, pdf/);
  });

  test("falls back to a browser-tier format when nothing is GET-servable", () => {
    expect(pickFormat(VIDEO)).toBe("mp4");
  });

  test("pickChildFormat prefers svg so vector survives into the parent", () => {
    expect(pickChildFormat(CHART)).toBe("svg");
  });

  test("pickChildFormat falls back when svg is absent", () => {
    expect(pickChildFormat(VIDEO)).toBe("mp4");
  });
});

/** Declares a browser-tier format first and svg later - order must not decide. */
const VIDEO_WITH_SVG_LAST: Manifest = {
  id: "mixed", name: "Mixed", render: { formats: ["mp4", "svg"] }, inputs: [],
};

// ── chain planning ──────────────────────────────────────────────────────────

describe("splitChainSegments", () => {
  test("splits on --then", () => {
    expect(splitChainSegments(["a", "x=1", "--then", "b:image", "-o", "f.png"]))
      .toEqual([["a", "x=1"], ["b:image", "-o", "f.png"]]);
  });

  test("a single step is one segment", () => {
    expect(splitChainSegments(["a"])).toEqual([["a"]]);
  });
});

describe("planChain", () => {
  test("refuses a chain of fewer than two steps", () => {
    expect(() => planChain([step("chart")], { catalogHost: "https://h.test" }))
      .toThrow(/at least two steps/);
  });

  test("wires the child's embed URL into the named asset input", () => {
    const plan = planChain([step("chart", [["ct", "bar"]]), step("frame", [], "image")],
      { catalogHost: "https://h.test" });
    const parentImage = plan.steps[1]!.inputs.find(([k]) => k === "image")![1];
    expect(parentImage).toBe(plan.steps[0]!.childUrl);
    expect(parentImage).toContain("https://h.test/tool/chart.svg?");
    expect(new URL(parentImage).searchParams.get("ct")).toBe("bar");
  });

  test("fits each step to the NEXT tool's canvas so the child is not cropped", () => {
    const plan = planChain([step("chart"), step("frame", [], "image")],
      { catalogHost: "https://h.test" });
    const inputs = Object.fromEntries(plan.steps[0]!.inputs);
    expect(inputs.width).toBe("1600");
    expect(inputs.height).toBe("1000");
    expect(plan.progress.join("\n")).toContain("fitted chart to 1600x1000");
  });

  test("an explicit size on a step turns fitting off for it", () => {
    const plan = planChain([step("chart", [["width", "800"]]), step("frame", [], "image")],
      { catalogHost: "https://h.test" });
    const widths = plan.steps[0]!.inputs.filter(([k]) => k === "width").map(([, v]) => v);
    expect(widths).toEqual(["800"]);
    expect(plan.progress.join("\n")).not.toContain("fitted");
  });

  test("does not invent width/height on a tool that declares neither", () => {
    const plan = planChain([step("leaf"), step("frame", [], "image")],
      { catalogHost: "https://h.test" });
    expect(plan.steps[0]!.inputs.some(([k]) => k === "width")).toBe(false);
  });

  test("three steps nest, each child landing in the next slot", () => {
    const plan = planChain(
      [step("chart"), step("frame", [], "image"), step("video", [], "clip")],
      { catalogHost: "https://h.test" },
    );
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[1]!.inputs.find(([k]) => k === "image")![1]).toBe(plan.steps[0]!.childUrl);
    expect(plan.steps[2]!.inputs.find(([k]) => k === "clip")![1]).toBe(plan.steps[1]!.childUrl);
    expect(plan.steps[2]!.finalFormat).toBe("mp4");
  });

  test("only the last step carries a final format; the rest carry child URLs", () => {
    const plan = planChain([step("chart"), step("frame", [], "image")],
      { catalogHost: "https://h.test" });
    expect(plan.steps[0]!.finalFormat).toBeUndefined();
    expect(plan.steps[0]!.childUrl).toBeTruthy();
    expect(plan.steps[1]!.childUrl).toBeUndefined();
    expect(plan.steps[1]!.finalFormat).toBe("png");
  });

  test("honours a requested final format", () => {
    const plan = planChain([step("chart"), step("frame", [], "image")],
      { catalogHost: "https://h.test", requestedFormat: "pdf" });
    expect(plan.steps[1]!.finalFormat).toBe("pdf");
  });

  test("a later step without a slot is a usage error that names the real slots", () => {
    expect(() => planChain([step("chart"), step("frame")], { catalogHost: "https://h.test" }))
      .toThrow(/must name the input to feed, as frame:<slot>\. frame offers asset inputs: image/);
  });

  test("says so plainly when the consumer has no asset input at all", () => {
    expect(() => planChain([step("chart"), step("leaf")], { catalogHost: "https://h.test" }))
      .toThrow(/leaf offers no asset inputs - it cannot take another tool's render/);
  });

  test("an unknown slot lists the asset inputs that do exist", () => {
    expect(() => planChain([step("chart"), step("frame", [], "picture")], { catalogHost: "https://h.test" }))
      .toThrow(/"picture" is not an input of frame\. It offers asset inputs: image/);
  });

  test("warns, but proceeds, when the slot is not asset-typed", () => {
    const plan = planChain([step("chart"), step("frame", [], "title")], { catalogHost: "https://h.test" });
    expect(plan.warnings.join()).toMatch(/frame\.title is <text>, not <asset>/);
    expect(plan.steps[1]!.inputs.find(([k]) => k === "title")).toBeTruthy();
  });

  test("validates each step's own inputs", () => {
    expect(() => planChain([step("chart", [["bogus", "1"]]), step("frame", [], "image")],
      { catalogHost: "https://h.test" })).toThrow(/"bogus" is not an input of chart/);
  });

  test("warns when nesting pushes a URL past the safe length", () => {
    const plan = planChain(
      [step("chart", [["d", "x".repeat(CHAIN_URL_WARN_CHARS)]]), step("frame", [], "image")],
      { catalogHost: "https://h.test" },
    );
    expect(plan.warnings.join()).toMatch(/nested encoding grows fast/);
  });

  test("does not mutate the caller's input arrays", () => {
    const s = step("chart", [["ct", "bar"]]);
    const before = s.inputs.length;
    planChain([s, step("frame", [], "image")], { catalogHost: "https://h.test" });
    expect(s.inputs).toHaveLength(before);
  });
});

// ── block slots: chaining INTO one record of a `blocks` list ────────────────
//
// A deck tool keeps its visual slots inside its slides, so without this a chart
// can never land on a slide - the whole point of the feature.

describe("parseSlotRef", () => {
  test("a bare name is a plain top-level slot", () => {
    expect(parseSlotRef("image")).toEqual({ input: "image" });
  });

  test("reads the bracket form", () => {
    expect(parseSlotRef("slides[2].visual")).toEqual({ input: "slides", index: 2, field: "visual" });
  });

  test("reads the dotted form, which survives shell globbing unquoted", () => {
    expect(parseSlotRef("slides.2.visual")).toEqual({ input: "slides", index: 2, field: "visual" });
  });

  test("a non-numeric middle segment stays a plain slot, so vector keys are untouched", () => {
    expect(parseSlotRef("imageFraming.zoom")).toEqual({ input: "imageFraming.zoom" });
  });
});

describe("blockSlotIds", () => {
  test("lists only the asset fields, as the strings a caller may type", () => {
    expect(blockSlotIds(DECK)).toEqual(["slides[n].visual"]);
  });

  test("a tool with no blocks input has none", () => {
    expect(blockSlotIds(FRAME)).toEqual([]);
  });
});

describe("planChain into a block slot", () => {
  const deckJson = (v: unknown) => JSON.stringify(v);

  test("puts the child URL in the named record's field, keeping the other fields", () => {
    const slides = [{ layout: "split", heading: "One" }, { layout: "split", heading: "Two" }];
    const plan = planChain(
      [step("chart"), step("deck", [["slides", deckJson(slides)]], "slides[1].visual")],
      { catalogHost: "https://h.test" },
    );
    const out = JSON.parse(plan.steps[1]!.inputs.find(([k]) => k === "slides")![1]);
    expect(out[1].visual).toBe(plan.steps[0]!.childUrl);
    expect(out[1].heading).toBe("Two");
    expect(out[0].visual).toBeUndefined();
  });

  test("falls back to the manifest's default records when the caller passed none", () => {
    const plan = planChain([step("chart"), step("deck", [], "slides[0].visual")],
      { catalogHost: "https://h.test" });
    const out = JSON.parse(plan.steps[1]!.inputs.find(([k]) => k === "slides")![1]);
    expect(out[0].heading).toBe("Default slide");
    expect(out[0].visual).toContain("https://h.test/tool/chart.svg?");
  });

  test("does NOT fit the child to the canvas - a slot is a fraction of the slide", () => {
    const plan = planChain([step("chart"), step("deck", [], "slides[0].visual")],
      { catalogHost: "https://h.test" });
    expect(plan.steps[0]!.inputs.some(([k]) => k === "width")).toBe(false);
    expect(plan.progress.join("\n")).not.toContain("fitted");
  });

  test("still fits when the destination is a plain top-level asset input", () => {
    const plan = planChain([step("chart"), step("frame", [], "image")],
      { catalogHost: "https://h.test" });
    expect(plan.progress.join("\n")).toContain("fitted");
  });

  test("an out-of-range index is a usage error naming the valid range", () => {
    expect(() => planChain([step("chart"), step("deck", [], "slides[3].visual")],
      { catalogHost: "https://h.test" })).toThrow(/has 1 record\(s\).*index 3.*Valid: 0\.\.0/s);
  });

  test("an unknown field lists the asset fields that do exist", () => {
    expect(() => planChain([step("chart"), step("deck", [], "slides[0].picture")],
      { catalogHost: "https://h.test" })).toThrow(/"picture" is not a field of deck\.slides.*visual/s);
  });

  test("warns when the record's layout does not show that field", () => {
    const plan = planChain(
      [step("chart"), step("deck", [["slides", deckJson([{ layout: "quote" }])]], "slides[0].visual")],
      { catalogHost: "https://h.test" },
    );
    expect(plan.warnings.join()).toMatch(/layout "quote", which does not show visual/);
  });

  test("indexing a non-blocks input says to use the plain form instead", () => {
    expect(() => planChain([step("chart"), step("frame", [], "image[0].x")],
      { catalogHost: "https://h.test" })).toThrow(/is <asset>, not <blocks>.*Feed it as frame:image/s);
  });

  test("naming a blocks input with no index says how to address a record", () => {
    expect(() => planChain([step("chart"), step("deck", [], "slides")],
      { catalogHost: "https://h.test" })).toThrow(/is a <blocks> list.*deck:slides\[0\]\.<field>/s);
  });

  test("unparseable blocks JSON is a usage error, not a crash", () => {
    expect(() => planChain([step("chart"), step("deck", [["slides", "not json"]], "slides[0].visual")],
      { catalogHost: "https://h.test" })).toThrow(/must be a JSON array of records/);
  });

  test("a JSON object where an array belongs is refused", () => {
    expect(() => planChain([step("chart"), step("deck", [["slides", '{"a":1}']], "slides[0].visual")],
      { catalogHost: "https://h.test" })).toThrow(/must be a JSON ARRAY/);
  });

  test("the rewritten value appears once, not alongside the original", () => {
    const plan = planChain(
      [step("chart"), step("deck", [["slides", deckJson([{ layout: "split" }])]], "slides[0].visual")],
      { catalogHost: "https://h.test" },
    );
    expect(plan.steps[1]!.inputs.filter(([k]) => k === "slides")).toHaveLength(1);
  });

  test("does not mutate the caller's blocks JSON string", () => {
    const raw = deckJson([{ layout: "split" }]);
    const s = step("deck", [["slides", raw]], "slides[0].visual");
    planChain([step("chart"), s], { catalogHost: "https://h.test" });
    expect(s.inputs[0]![1]).toBe(raw);
  });
});

// ── small helpers ───────────────────────────────────────────────────────────

describe("helpers", () => {
  test("cacheKey is filesystem-safe and stable", () => {
    expect(cacheKey("https://h.test/catalog/tools/index.json"))
      .toBe("https_h_test_catalog_tools_index_json.json");
    expect(cacheKey("a/b")).not.toContain("/");
  });

  test("different URLs never share a cache key", () => {
    expect(cacheKey("https://a.test/x")).not.toBe(cacheKey("https://b.test/x"));
  });

  test("video gets the longest export timeout, print the middle one", () => {
    expect(exportTimeoutMs("mp4")).toBeGreaterThan(exportTimeoutMs("pdf"));
    expect(exportTimeoutMs("pdf")).toBeGreaterThan(exportTimeoutMs("svg"));
  });

  test("matchesTool searches tags, not just names", () => {
    expect(matchesTool(TOOLS[0]!, "graph")).toBe(true);
    expect(matchesTool(TOOLS[0]!, "zzz")).toBe(false);
    expect(matchesTool(TOOLS[0]!, "")).toBe(true);
  });

  test("isImageTool is true for anything that can produce a picture", () => {
    expect(isImageTool(TOOLS[0]!)).toBe(true); // chart: svg,png,pdf
    expect(isImageTool(TOOLS[2]!)).toBe(true); // leaf: svg only
  });

  test("isImageTool is false for data-only and font-only tools", () => {
    const html: Tool = { id: "h", name: "H", description: "", status: "official", formats: ["html"] };
    const font: Tool = { id: "f", name: "F", description: "", status: "official", formats: ["ttf", "woff"] };
    const vid: Tool = { id: "v", name: "V", description: "", status: "official", formats: ["mp4", "webm"] };
    expect(isImageTool(html)).toBe(false);
    expect(isImageTool(font)).toBe(false);
    expect(isImageTool(vid)).toBe(false);
  });

  test("IMAGE_FORMATS covers vector, raster, print and animation stills", () => {
    for (const f of ["svg", "png", "pdf", "eps", "dxf", "ico", "gif", "apng"]) {
      expect(IMAGE_FORMATS.has(f)).toBe(true);
    }
    for (const f of ["html", "json", "csv", "ics", "vcf", "md", "txt", "ttf", "mp3", "mp4"]) {
      expect(IMAGE_FORMATS.has(f)).toBe(false);
    }
  });

  test("filterTools applies q, image and format together", () => {
    expect(filterTools(TOOLS, {}).map((t) => t.id)).toEqual(["chart", "frame", "leaf", "video"]);
    expect(filterTools(TOOLS, { image: true }).map((t) => t.id)).toEqual(["chart", "frame", "leaf"]);
    expect(filterTools(TOOLS, { format: "pdf" }).map((t) => t.id)).toEqual(["chart", "frame"]);
    expect(filterTools(TOOLS, { image: true, format: "pdf", q: "chart" }).map((t) => t.id))
      .toEqual(["chart"]);
  });

  test("filterTools on an unknown format returns nothing rather than everything", () => {
    expect(filterTools(TOOLS, { format: "nope" })).toEqual([]);
  });

  test("GET_FORMATS and RESERVED hold the load-bearing entries", () => {
    expect(GET_FORMATS.has("svg")).toBe(true);
    expect(GET_FORMATS.has("mp4")).toBe(false);
    expect(RESERVED.has("_v")).toBe(true);
    expect(RESERVED.has("chartType")).toBe(false);
  });
});

// ── the hybrid: geometry, anchors, annotation ───────────────────────────────

/** A chart-shaped render: labelled marks, a background, and glyph paths. */
const CHART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1040" width="1200px" height="1040px">
<rect id="d3-bg" x="0" y="0" width="1200" height="1040" fill="none"/>
<rect x="307" y="203" width="556" height="130" fill="#00bda7" data-recolor="EU stack"/>
<rect x="307" y="454" width="295" height="130" fill="#89cb76" data-recolor="Median EU institution"/>
<g transform="translate(60,80)"><path d="M3 0L1 -90L120 -90L120 0Z"/></g>
</svg>`;

/** A layout-shaped render: content-fitted viewBox, bare paths, no labels. */
const CARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-44 -44 408 488" width="1500px" height="1300px" preserveAspectRatio="xMidYMid meet">
<path d="M14 0L306 0C313 0 320 6 320 14L320 44C320 51 313 58 306 58L14 58C6 58 0 51 0 44L0 14C0 6 6 0 14 0Z"/>
<path d="M14 114L306 114C313 114 320 120 320 128L320 158C320 165 313 172 306 172L14 172C6 172 0 165 0 158L0 128C0 120 6 114 14 114Z"/>
<path d="M160 58L160 114"/>
</svg>`;

describe("readGeometry", () => {
  test("reads the viewBox, which is the space annotations live in", () => {
    expect(readGeometry(CARD_SVG).viewBox).toEqual({ x: -44, y: -44, w: 408, h: 488 });
  });

  test("keeps the outer size separate, because it often disagrees", () => {
    const g = readGeometry(CARD_SVG);
    expect(g.width).toBe("1500px");
    expect(g.preserveAspectRatio).toBe("xMidYMid meet");
  });

  test("survives an SVG with no viewBox", () => {
    expect(readGeometry(`<svg width="10"></svg>`).viewBox).toBeNull();
  });

  test("parseViewBox rejects malformed values instead of guessing", () => {
    expect(parseViewBox("0 0 100")).toBeNull();
    expect(parseViewBox("a b c d")).toBeNull();
    expect(parseViewBox("0,0,10,20")).toEqual({ x: 0, y: 0, w: 10, h: 20 });
  });
});

describe("pathBBox", () => {
  test("bounds a simple path", () => {
    expect(pathBBox("M10 20L110 20L110 70L10 70Z")).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  test("returns null for a path with no usable coordinates", () => {
    expect(pathBBox("Z")).toBeNull();
  });
});

describe("findAnchors", () => {
  test("returns only labelled marks when the tool labels them", () => {
    const a = findAnchors(CHART_SVG);
    expect(a.map((x) => x.label)).toEqual(["EU stack", "Median EU institution"]);
  });

  test("drops the full-canvas background", () => {
    expect(findAnchors(CHART_SVG).some((a) => a.w >= 1200)).toBe(false);
  });

  test("drops shapes whose centre lies outside the canvas (group-local glyphs)", () => {
    // The glyph path sits at negative y inside a translated group.
    expect(findAnchors(CHART_SVG).some((a) => a.cy < 0)).toBe(false);
  });

  test("falls back to geometry when nothing is labelled", () => {
    const a = findAnchors(CARD_SVG, { minSize: 40 });
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ kind: "path", x: 0, y: 0, w: 320, h: 58, cx: 160, cy: 29 });
  });

  test("minSize filters out connectors and other thin shapes", () => {
    // The connector path is 0 wide, so it never qualifies.
    expect(findAnchors(CARD_SVG, { minSize: 40 }).some((a) => a.w === 0)).toBe(false);
  });

  test("orders anchors top to bottom, which is how a caller reads them", () => {
    const ys = findAnchors(CARD_SVG, { minSize: 40 }).map((a) => a.cy);
    expect(ys).toEqual([...ys].sort((p, q) => p - q));
  });

  test("a gradient with no discrete shapes yields no anchors, not junk", () => {
    const grad = `<svg viewBox="0 0 100 100"><defs><linearGradient id="g"/></defs><rect width="100" height="100" fill="url(#g)"/></svg>`;
    expect(findAnchors(grad)).toEqual([]);
  });
});

describe("padViewBox", () => {
  test("grows the box on the named sides", () => {
    expect(padViewBox({ x: 0, y: 0, w: 100, h: 100 }, { right: 50, top: 10 }))
      .toEqual({ x: 0, y: -10, w: 150, h: 110 });
  });

  test("a partial padding object does not produce NaN", () => {
    // Regression: spreading {right} over defaults set the other sides to
    // undefined, which made the whole viewBox NaN.
    const vb = padViewBox({ x: -44, y: -44, w: 408, h: 488 }, { right: 292, top: 60 });
    expect(Object.values(vb).every(Number.isFinite)).toBe(true);
    expect(vb).toEqual({ x: -44, y: -104, w: 700, h: 548 });
  });

  test("empty padding is a no-op", () => {
    const vb = { x: 1, y: 2, w: 3, h: 4 };
    expect(padViewBox(vb, {})).toEqual(vb);
  });
});

describe("annotateSvg", () => {
  test("appends the layer and leaves the base content untouched", () => {
    const out = annotateSvg(CHART_SVG, `<circle cx="1" cy="1" r="1"/>`);
    expect(out).toContain(`data-recolor="EU stack"`);
    expect(out).toContain(`<g id="annotations">`);
    expect(out.indexOf("annotations")).toBeGreaterThan(out.indexOf("EU stack"));
  });

  test("does not double-wrap a layer that is already a group", () => {
    const out = annotateSvg(CHART_SVG, `<g id="mine"><circle r="1"/></g>`);
    expect(out).toContain(`<g id="mine">`);
    expect(out).not.toContain(`<g id="annotations">`);
  });

  test("honours a custom group id", () => {
    expect(annotateSvg(CHART_SVG, `<circle r="1"/>`, { id: "callouts" })).toContain(`<g id="callouts">`);
  });

  test("padding rewrites the viewBox and keeps the outer aspect ratio", () => {
    const out = annotateSvg(CARD_SVG, `<circle r="1"/>`, { pad: { right: 292, top: 60 } });
    expect(out).toContain(`viewBox="-44 -104 700 548"`);
    // 1500 wide at 700x548 must be 1174 tall, or the render distorts.
    expect(out).toContain(`width="1500px"`);
    expect(out).toContain(`height="1174px"`);
  });

  test("no padding leaves the root exactly as it was", () => {
    const out = annotateSvg(CARD_SVG, `<circle r="1"/>`);
    expect(out).toContain(`viewBox="-44 -44 408 488"`);
    expect(out).toContain(`height="1300px"`);
  });

  test("refuses padding when there is no viewBox to grow", () => {
    expect(() => annotateSvg(`<svg width="10"></svg>`, `<circle r="1"/>`, { pad: { right: 10 } }))
      .toThrow(/no viewBox/);
  });

  test("refuses something that is not an SVG document", () => {
    expect(() => annotateSvg(`{"not":"svg"}`, `<circle r="1"/>`)).toThrow(UsageError);
  });

  test("is idempotent enough to layer twice", () => {
    const once = annotateSvg(CHART_SVG, `<circle r="1"/>`, { id: "a" });
    const twice = annotateSvg(once, `<circle r="2"/>`, { id: "b" });
    expect(twice).toContain(`<g id="a">`);
    expect(twice).toContain(`<g id="b">`);
    expect(readGeometry(twice).viewBox).toEqual(readGeometry(CHART_SVG).viewBox);
  });
});

describe("formatProbe", () => {
  test("leads with the coordinate space to annotate in", () => {
    expect(formatProbe(CARD_SVG, findAnchors(CARD_SVG, { minSize: 40 }))[0])
      .toContain("viewBox: -44 -44 408 488");
  });

  test("warns when the outer pixel size disagrees with the viewBox", () => {
    expect(formatProbe(CARD_SVG, []).join("\n")).toContain("content-fitted");
  });

  test("does not read a percentage width as a pixel count", () => {
    const pct = `<svg viewBox="0 0 1600 900" width="100%" height="100%"></svg>`;
    expect(formatProbe(pct, []).join("\n")).not.toContain("content-fitted");
  });

  test("says what to do when there is nothing to anchor to", () => {
    expect(formatProbe(CHART_SVG, []).join("\n")).toContain("Place marks against the viewBox box itself");
  });
});

// ── output formatting ───────────────────────────────────────────────────────

describe("exampleValue", () => {
  test("escapes newlines in a string so an example stays one copyable line", () => {
    expect(exampleValue("a\nb")).toBe("a\\nb");
  });

  test("serialises an object or array as JSON", () => {
    expect(exampleValue([{ a: 1 }])).toBe('[{"a":1}]');
  });

  test("prints numbers and booleans plainly", () => {
    expect(exampleValue(3)).toBe("3");
    expect(exampleValue(true)).toBe("true");
  });
});

describe("formatting", () => {
  test("catalog groups by category and flags experimental tools", () => {
    const out = formatCatalog(TOOLS, {}, "https://h.test").join("\n");
    expect(out).toContain("## designer");
    expect(out).toContain("## everyone");
    expect(out).toContain("chart  _v=1.2.0");
    expect(out).toContain("video  _v=0.1.0 [experimental: watermarked]");
    expect(out).toContain("4 tools on https://h.test.");
  });

  test("catalog reports the filtered count for a query", () => {
    expect(formatCatalog(TOOLS, { q: "graph" }, "https://h.test").join("\n"))
      .toContain('1 tools matching "graph"');
  });

  test("catalog names the image filter in its count line", () => {
    expect(formatCatalog(TOOLS, { image: true }, "https://h.test").join("\n"))
      .toContain("3 tools that make an image");
  });

  test("tool list says so when nothing matches", () => {
    expect(formatToolList(TOOLS, { q: "zzz" }, "https://h.test").join("\n")).toContain("No tool");
  });

  test("tool list explains an empty result from the image filter", () => {
    expect(formatToolList([TOOLS[3]!], { image: true, format: "svg" }, "https://h.test").join("\n"))
      .toContain("producing svg");
  });

  test("describe marks vector inputs with their dotted form", () => {
    expect(formatDescribe(FRAME).join("\n")).toContain("imageFraming  <vector>  (pass fields as imageFraming.<field>=n)");
  });

  test("describe lists a blocks input's fields, which exist nowhere else", () => {
    const out = formatDescribe(DECK).join("\n");
    expect(out).toContain("slides  <blocks>");
    expect(out).toContain(".layout  <select> options: split|quote");
    expect(out).toContain(".visual  <asset>  only on: split  <- chain here: slides[n].visual");
  });

  test("describe prints a blocks example as JSON, not [object Object]", () => {
    const out = formatDescribe(DECK).join("\n");
    expect(out).not.toContain("[object Object]");
    expect(out).toContain('slides=[{"layout":"split","heading":"Hi"}]');
  });

  test("describe shows urlKey aliases and defaults", () => {
    const out = formatDescribe(CHART).join("\n");
    expect(out).toContain("chartType (urlKey: ct)  <select> default: \"bar\"");
  });

  test("describe prints authored examples with newlines escaped to one line", () => {
    const out = formatDescribe(CHART).join("\n");
    expect(out).toContain("authored examples");
    expect(out).toContain("[Trend] chartType=line data=a,1\\nb,2");
  });

  test("describe warns about an experimental tool's watermark", () => {
    expect(formatDescribe(VIDEO).join("\n")).toContain("watermark");
  });

  test("describe flags a non-exporting utility", () => {
    const util: Manifest = { id: "u", name: "U", render: { formats: ["html"], export: false } };
    expect(formatDescribe(util).join("\n")).toContain("non-exporting utility");
  });
});

// ── CLI, against a local fake host ──────────────────────────────────────────

let server: ReturnType<typeof Bun.serve>;
let host: string;
let cacheDir: string;
let renderCalls: string[] = [];

beforeAll(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "lolly-test-cache-"));
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      if (p === "/catalog/tools/index.json") return Response.json({ tools: TOOLS });
      if (p === "/catalog/assets/index.json") {
        return Response.json({ assets: [{ id: "suse/logo", type: "logo", name: "SUSE Logo" }] });
      }
      const m = /^\/tools\/([^/]+)\/tool\.json$/.exec(p);
      if (m) {
        const man = MANIFESTS[m[1]!];
        return man ? Response.json(man) : new Response("no such tool", { status: 404 });
      }
      const r = /^\/tool\/([^/]+)\.([a-z0-9-]+)$/.exec(p);
      if (r) {
        renderCalls.push(req.url);
        if (r[1] === "leaf" && r[2] === "svg" && url.searchParams.get("text") === "empty") {
          return new Response("", { status: 200 });
        }
        if (r[1] === "frame") {
          // Mirrors the real host refusing an HTML-layout tool over GET.
          return new Response("this tool needs the browser tier", { status: 400 });
        }
        return new Response(`<svg data-tool="${r[1]}" data-q="${url.search}"></svg>`, {
          headers: { "content-type": "image/svg+xml" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  host = `http://localhost:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
  rmSync(cacheDir, { recursive: true, force: true });
});

const SCRIPT = join(import.meta.dir, "lolly.ts");

/** Run the CLI hermetically: local hosts, throwaway cache, no reachable Chrome. */
async function cli(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", SCRIPT, ...args, `--catalog=${host}`, `--render-host=${host}`], {
    env: {
      ...process.env,
      LOLLY_CACHE_DIR: cacheDir,
      // Hard-block the browser tier. Pointing LOLLY_CHROME at a bad path is NOT
      // enough - it only prepends a candidate, so the search still finds the
      // real Chrome on a developer machine and launches it. No test may open a
      // browser: it is slow, it can raise an OS keychain prompt, and it makes
      // the browser-tier assertions nondeterministic.
      LOLLY_NO_BROWSER: "1",
      HOME: cacheDir,
      ...env,
    },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode, all: stdout + stderr };
}

describe("cli", () => {
  test("catalog lists the fake catalog, grouped", async () => {
    const r = await cli(["catalog"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("## designer");
    expect(r.stdout).toContain("chart  _v=1.2.0");
  });

  test("catalog filters by query", async () => {
    const r = await cli(["catalog", "graph"]);
    expect(r.stdout).toContain('1 tools matching "graph"');
  });

  test("tools lists formats", async () => {
    const r = await cli(["tools", "chart"]);
    expect(r.stdout).toContain("formats: svg,png,pdf");
  });

  test("catalog --image drops tools that cannot make a picture", async () => {
    const r = await cli(["catalog", "--image"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("3 tools that make an image");
    expect(r.stdout).toContain("chart");
    expect(r.stdout).not.toContain("video  _v="); // mp4/webm only
  });

  test("--image composes with --format", async () => {
    const r = await cli(["tools", "--image", "--format=pdf"]);
    expect(r.stdout).toContain("chart");
    expect(r.stdout).toContain("frame");
    expect(r.stdout).not.toContain("leaf ");
  });

  test("--image composes with a text query", async () => {
    const r = await cli(["catalog", "graph", "--image"]);
    expect(r.stdout).toContain('1 tools that make an image, matching "graph"');
  });

  test("describe prints inputs and authored examples", async () => {
    const r = await cli(["describe", "chart"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("chartType (urlKey: ct)");
    expect(r.stdout).toContain("authored examples");
  });

  test("describe of an unknown tool exits 2", async () => {
    const r = await cli(["describe", "nope"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Cannot read nope");
  });

  test("assets lists catalog assets", async () => {
    const r = await cli(["assets", "suse"]);
    expect(r.stdout).toContain("suse/logo");
  });

  test("url prints the editable link and renders nothing", async () => {
    renderCalls = [];
    const r = await cli(["url", "chart", "ct=bar"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`editable link: ${host}/#/tool/chart?ct=bar`);
    expect(renderCalls).toHaveLength(0);
  });

  test("url flags a browser-tier format", async () => {
    const r = await cli(["url", "video", "--format=mp4"]);
    expect(r.stdout).toContain("browser-tier");
  });

  test("url never advertises a hand-copyable embed URL", async () => {
    const r = await cli(["url", "chart"]);
    expect(r.stdout).toContain("use `chain`");
    expect(r.stdout).not.toContain("/tool/chart.svg?");
  });

  test("render writes the file and a sidecar holding the link", async () => {
    const out = join(cacheDir, "out.svg");
    const r = await cli(["render", "chart", "ct=bar", "--format=svg", "-o", out]);
    expect(r.exitCode).toBe(0);
    expect(await Bun.file(out).text()).toContain('data-tool="chart"');

    const sidecar = await Bun.file(`${out}.lolly.json`).json();
    expect(sidecar.tool).toBe("chart");
    expect(sidecar.format).toBe("svg");
    expect(sidecar.inputs).toEqual({ ct: "bar" });
    expect(sidecar.editableLink).toBe(`${host}/#/tool/chart?ct=bar&format=svg`);
    expect(sidecar.bytes).toBeGreaterThan(0);
  });

  test("stdout hands over a path, not a URL", async () => {
    const out = join(cacheDir, "path-only.svg");
    const r = await cli(["render", "chart", "--format=svg", "-o", out]);
    expect(r.stdout).toContain(`wrote ${out}`);
    expect(r.stdout).toContain(`${out}.lolly.json`);
    expect(r.stdout).not.toContain("?ct=");
  });

  test("render rejects an unknown input before touching the network", async () => {
    renderCalls = [];
    const r = await cli(["render", "chart", "colour=green", "-o", join(cacheDir, "x.svg")]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('"colour" is not an input of chart');
    expect(renderCalls).toHaveLength(0);
  });

  test("render rejects an undeclared format", async () => {
    const r = await cli(["render", "chart", "--format=mp4", "-o", join(cacheDir, "x.mp4")]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('does not produce "mp4"');
  });

  test("render without -o exits 2", async () => {
    const r = await cli(["render", "chart"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("render needs -o");
  });

  test("a browser-tier format with no Chrome exits 3 and asks for a human", async () => {
    const r = await cli(["render", "video", "--format=mp4", "-o", join(cacheDir, "v.mp4")]);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain("No Chrome/Chromium found");
  });

  test("a server refusal falls through to the browser tier, then exits 3", async () => {
    const r = await cli(["render", "frame", "--format=svg", "-o", join(cacheDir, "f.svg")]);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain("browser tier");
  });

  test("an empty render body is an error, not an empty file", async () => {
    const out = join(cacheDir, "empty.svg");
    const r = await cli(["render", "leaf", "text=empty", "--format=svg", "-o", out]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("0 bytes");
  });

  test("an unknown command exits 2 with usage", async () => {
    const r = await cli(["frobnicate"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Usage: lolly.ts catalog|tools|describe|assets|url|render|chain");
  });

  test("chain warns but proceeds when the named slot is not asset-typed", async () => {
    renderCalls = [];
    const out = join(cacheDir, "chained.svg");
    // `leaf` has no asset input, but `text` is a real input, so the chain runs
    // with a warning rather than refusing - and leaf DOES render over GET here.
    const r = await cli(["chain", "chart", "d=A,1", "--then", "leaf:text", "--format=svg", "-o", out]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("leaf.text is <text>, not <asset>");
    expect(await Bun.file(out).text()).toContain('data-tool="leaf"');
    expect(renderCalls).toHaveLength(1);
  });

  test("chain fits the child, encodes it, and renders once", async () => {
    renderCalls = [];
    const out = join(cacheDir, "framed.svg");
    // frame refuses over GET in the fake host, so this exits 3 at the render
    // step - but only AFTER planning, which is what we assert here.
    const r = await cli(["chain", "chart", "d=A,1\nB,2", "--then", "frame:image", "--format=svg", "-o", out]);
    expect(r.stderr).toContain("fitted chart to 1600x1000 (frame's canvas)");
    expect(r.stderr).toContain("step 1/2: chart (svg)");
    expect(r.stderr).toContain("step 2/2: frame (svg)");
    // Exactly one render was attempted: the last step.
    expect(renderCalls).toHaveLength(1);
    const attempted = new URL(renderCalls[0]!);
    expect(attempted.pathname).toBe("/tool/frame.svg");
    // The child rode in as one fully-encoded value that still parses back.
    const child = attempted.searchParams.get("image")!;
    expect(new URL(child).pathname).toBe("/tool/chart.svg");
    expect(new URL(child).searchParams.get("d")).toBe("A,1\nB,2");
    expect(new URL(child).searchParams.get("width")).toBe("1600");
  });

  test("probe reports the coordinate space and the labelled marks", async () => {
    const f = join(cacheDir, "probe-me.svg");
    await Bun.write(f, CHART_SVG);
    const r = await cli(["probe", f]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("viewBox: 0 0 1200 1040");
    expect(r.stdout).toContain("EU stack");
  });

  test("probe on a missing file exits 2", async () => {
    const r = await cli(["probe", join(cacheDir, "nope.svg")]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("No such file");
  });

  test("annotate writes a layered file without touching the base", async () => {
    const base = join(cacheDir, "base.svg");
    const out = join(cacheDir, "layered.svg");
    await Bun.write(base, CHART_SVG);
    const r = await cli(["annotate", base, `--layer=<circle cx="5" cy="5" r="5"/>`, "-o", out]);
    expect(r.exitCode).toBe(0);
    expect(await Bun.file(base).text()).toBe(CHART_SVG); // base untouched on disk
    const got = await Bun.file(out).text();
    expect(got).toContain(`data-recolor="EU stack"`);
    expect(got).toContain(`<g id="annotations">`);
  });

  test("annotate grows the viewBox when asked to make room", async () => {
    const base = join(cacheDir, "card.svg");
    const out = join(cacheDir, "card-padded.svg");
    await Bun.write(base, CARD_SVG);
    await cli(["annotate", base, `--layer=<circle r="1"/>`, "--pad-right=292", "--pad-top=60", "-o", out]);
    expect(await Bun.file(out).text()).toContain(`viewBox="-44 -104 700 548"`);
  });

  test("annotate without a layer exits 2", async () => {
    const base = join(cacheDir, "base2.svg");
    await Bun.write(base, CHART_SVG);
    const r = await cli(["annotate", base, "-o", join(cacheDir, "x.svg")]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("--layer");
  });

  test("chain with one step exits 2", async () => {
    const r = await cli(["chain", "chart", "-o", join(cacheDir, "x.svg")]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("at least two steps");
  });

  test("chain without -o exits 2", async () => {
    const r = await cli(["chain", "chart", "--then", "frame:image"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("chain needs -o");
  });

  test("chain names the real slots when given a wrong one", async () => {
    const r = await cli(["chain", "chart", "--then", "frame:picture", "-o", join(cacheDir, "x.svg")]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("It offers asset inputs: image");
  });

  test("chain accepts a block slot through argv, in the shell-safe dotted form", async () => {
    const r = await cli(["chain", "chart", "--then", "deck:slides.9.visual", "-o", join(cacheDir, "x.pdf")]);
    // Exit 2 on the index, not on the syntax: the slot itself parsed fine.
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("index 9 does not exist");
  });

  test("chain tells a caller who named a blocks input how to address one record", async () => {
    const r = await cli(["chain", "chart", "--then", "deck:slides", "-o", join(cacheDir, "x.pdf")]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("deck:slides[0].<field>");
  });

  test("catalog JSON is cached, so a second call makes no new catalog request", async () => {
    const fresh = mkdtempSync(join(tmpdir(), "lolly-cache2-"));
    try {
      let indexHits = 0;
      const counter = Bun.serve({
        port: 0,
        fetch(req) {
          const p = new URL(req.url).pathname;
          if (p === "/catalog/tools/index.json") { indexHits++; return Response.json({ tools: TOOLS }); }
          return new Response("not found", { status: 404 });
        },
      });
      const chost = `http://localhost:${counter.port}`;
      const run = () => Bun.spawn(["bun", SCRIPT, "tools", `--catalog=${chost}`], {
        env: { ...process.env, LOLLY_CACHE_DIR: fresh }, stdout: "pipe", stderr: "pipe",
      }).exited;
      await run();
      expect(indexHits).toBe(1);
      await run();
      expect(indexHits).toBe(1); // served from cache
      counter.stop(true);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test("--fresh bypasses the cache", async () => {
    const fresh = mkdtempSync(join(tmpdir(), "lolly-cache3-"));
    try {
      let indexHits = 0;
      const counter = Bun.serve({
        port: 0,
        fetch(req) {
          const p = new URL(req.url).pathname;
          if (p === "/catalog/tools/index.json") { indexHits++; return Response.json({ tools: TOOLS }); }
          return new Response("not found", { status: 404 });
        },
      });
      const chost = `http://localhost:${counter.port}`;
      const run = (extra: string[] = []) => Bun.spawn(["bun", SCRIPT, "tools", ...extra, `--catalog=${chost}`], {
        env: { ...process.env, LOLLY_CACHE_DIR: fresh }, stdout: "pipe", stderr: "pipe",
      }).exited;
      await run();
      await run(["--fresh"]);
      expect(indexHits).toBe(2);
      counter.stop(true);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test("an EXPIRED cache is still served when the network is gone", async () => {
    const fresh = mkdtempSync(join(tmpdir(), "lolly-cache4-"));
    try {
      const counter = Bun.serve({ port: 0, fetch: () => Response.json({ tools: TOOLS }) });
      const chost = `http://localhost:${counter.port}`;
      const url = `${chost}/catalog/tools/index.json`;
      await Bun.spawn(["bun", SCRIPT, "tools", `--catalog=${chost}`], {
        env: { ...process.env, LOLLY_CACHE_DIR: fresh }, stdout: "pipe", stderr: "pipe",
      }).exited;
      counter.stop(true); // the host is now unreachable

      // Age the entry past the 24h TTL, so the client is forced to re-fetch,
      // fail, and fall back. Without this it just reads a fresh cache and the
      // offline path is never exercised.
      const entry = join(fresh, cacheKey(url));
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
      utimesSync(entry, old, old);

      const proc = Bun.spawn(["bun", SCRIPT, "tools", `--catalog=${chost}`], {
        env: { ...process.env, LOLLY_CACHE_DIR: fresh }, stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
      ]);
      expect(code).toBe(0);
      expect(stdout).toContain("chart");
      expect(stderr).toContain("serving stale cache");
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test("with no cache and no network, the failure surfaces instead of being swallowed", async () => {
    const empty = mkdtempSync(join(tmpdir(), "lolly-cache5-"));
    try {
      const proc = Bun.spawn(["bun", SCRIPT, "tools", "--catalog=http://localhost:1"], {
        env: { ...process.env, LOLLY_CACHE_DIR: empty }, stdout: "pipe", stderr: "pipe",
      });
      const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
      expect(code).not.toBe(0);
      expect(stderr).not.toContain("serving stale cache");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
