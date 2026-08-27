/**
 * Live contract tests: does the REAL Lolly catalog still offer every image tool
 * we advertise?
 *
 *   LOLLY_LIVE=1 bun test lolly.live.test.ts
 *
 * Skipped by default, because it needs the network and it tests someone else's
 * service. lolly.test.ts is the suite that must always pass offline; this one
 * answers a different question - "has the catalog moved under us?" - and is the
 * thing to run after a Lolly release, or when a tool id stops working.
 *
 * The contract is scripts/image-tools.json: the 63 tools that can produce a
 * picture, which is what `catalog --image` returns and what any other skill
 * picks a visual from. Each gets its own test, so a failure names the tool.
 *
 * When Lolly legitimately adds or removes a tool, regenerate the fixture:
 *   bun scripts/lolly.ts catalog --image --fresh
 * and review the diff - a tool disappearing is a real change to what we can
 * promise, not noise to paper over.
 *
 * No test here launches Chrome or renders anything: it reads catalog JSON only.
 */

import { beforeAll, describe, expect, test } from "bun:test";

import { IMAGE_FORMATS, isImageTool, type Manifest, type Tool } from "./lolly-core.ts";
import fixture from "./image-tools.json";

const LIVE = Boolean(process.env.LOLLY_LIVE);
const HOST = (process.env.LOLLY_CATALOG_HOST ?? "https://lolly.tools").replace(/\/$/, "");

/** bun:test has no runtime "skip whole file", so gate each block on this. */
const suite = LIVE ? describe : describe.skip;

let live: Tool[] = [];
let byId = new Map<string, Tool>();

beforeAll(async () => {
  if (!LIVE) return;
  const res = await fetch(`${HOST}/catalog/tools/index.json`);
  if (!res.ok) throw new Error(`catalog index ${res.status} from ${HOST}`);
  live = ((await res.json()) as { tools: Tool[] }).tools;
  byId = new Map(live.map((t) => [t.id, t]));
});

suite("live catalog: the image-tool contract", () => {
  test("the catalog is reachable and non-trivial", () => {
    expect(live.length).toBeGreaterThan(50);
  });

  test("every tool we advertise is still in the catalog", () => {
    const missing = fixture.tools.filter((t) => !byId.has(t.id)).map((t) => t.id);
    expect(missing).toEqual([]);
  });

  test("the catalog has gained no image tool we fail to advertise", () => {
    const known = new Set(fixture.tools.map((t) => t.id));
    const unlisted = live.filter((t) => isImageTool(t) && !known.has(t.id)).map((t) => t.id);
    // Not a failure of Lolly's - a failure of ours to keep up. Regenerate the
    // fixture and re-read references/catalog.md when this trips.
    expect(unlisted).toEqual([]);
  });

  test("`catalog --image` would return exactly the fixture", () => {
    const derived = live.filter(isImageTool).map((t) => t.id).sort();
    expect(derived).toEqual(fixture.tools.map((t) => t.id).sort());
  });
});

// One test per tool, so a failure names the tool that broke rather than
// reporting "a list changed".
suite("live catalog: each image tool", () => {
  for (const want of fixture.tools) {
    test(`${want.id} (${want.name}) is present and still makes a picture`, async () => {
      const t = byId.get(want.id);
      expect(t, `${want.id} is gone from the catalog`).toBeDefined();

      // Still produces at least one image format.
      const stillImage = t!.formats.filter((f) => IMAGE_FORMATS.has(f));
      expect(stillImage.length, `${want.id} declares no image format any more`).toBeGreaterThan(0);

      // Its manifest is readable and shaped the way describe/render assume.
      const res = await fetch(`${HOST}/tools/${want.id}/tool.json`);
      expect(res.ok, `${want.id} manifest ${res.status}`).toBe(true);
      const m = (await res.json()) as Manifest;
      expect(m.id).toBe(want.id);
      expect(Array.isArray(m.render?.formats)).toBe(true);
      expect(m.render!.formats!.length).toBeGreaterThan(0);
      // Every format the index advertises must really be declared by the tool,
      // or pickFormat would reject a format the catalog just promised.
      for (const f of stillImage) expect(m.render!.formats).toContain(f);
      // inputs may be absent, but when present it must be an array we can walk.
      if (m.inputs !== undefined) expect(Array.isArray(m.inputs)).toBe(true);
    });
  }
});

suite("live catalog: chain slots still exist", () => {
  // The chain examples in SKILL.md and references/composing.md name these
  // slots. If a tool renames one, the documented pipelines break silently.
  const SLOTS: Array<[string, string]> = [
    ["screenshot-frame", "image"],
    ["filter", "image"],
    ["print-sheet", "image"],
    ["link-card", "image"],
    ["finish-preview", "image"],
    ["web-icon", "image"],
    ["quotes", "bgImage"],
    ["growth", "logo"],
    ["qr-code", "logo"],
  ];
  for (const [id, slot] of SLOTS) {
    test(`${id} still takes an asset in "${slot}"`, async () => {
      const res = await fetch(`${HOST}/tools/${id}/tool.json`);
      expect(res.ok).toBe(true);
      const m = (await res.json()) as Manifest;
      const inp = (m.inputs ?? []).find((x) => x.id === slot || x.urlKey === slot);
      expect(inp, `${id} no longer declares "${slot}"`).toBeDefined();
      expect(inp!.type).toBe("asset");
    });
  }
});

suite("live catalog: block slots still exist", () => {
  // A deck tool keeps its visual slots INSIDE its slides, so these are the
  // `<input>[n].<field>` destinations the documented deck pipelines chain into.
  // A renamed field breaks them the same way a renamed asset input would.
  const BLOCK_SLOTS: Array<[string, string, string]> = [
    ["deck-studio", "deck", "visual"],
    ["deck-builder", "deck", "media1"],
  ];
  for (const [id, input, field] of BLOCK_SLOTS) {
    test(`${id} still takes an asset in ${input}[n].${field}`, async () => {
      const m = (await (await fetch(`${HOST}/tools/${id}/tool.json`)).json()) as Manifest;
      const inp = (m.inputs ?? []).find((x) => x.id === input);
      expect(inp, `${id} no longer declares "${input}"`).toBeDefined();
      expect(inp!.type).toBe("blocks");
      const f = (inp!.fields ?? []).find((x) => x.id === field);
      expect(f, `${id}.${input} no longer has a "${field}" field`).toBeDefined();
      expect(f!.type).toBe("asset");
    });
  }
});

suite("live catalog: d3 still supports the chart types we document", () => {
  // references/composing.md tells callers to pick from these.
  const TYPES = [
    "bar", "bar-horizontal", "line", "area", "scatter", "pie", "donut",
    "lollipop", "dumbbell", "slope", "waterfall", "treemap", "heatmap", "wordcloud",
  ];
  test("chartType offers every documented option", async () => {
    const m = (await (await fetch(`${HOST}/tools/d3/tool.json`)).json()) as Manifest;
    const ct = (m.inputs ?? []).find((x) => x.id === "chartType");
    expect(ct).toBeDefined();
    const opts = (ct!.options ?? []).map((o) => (typeof o === "string" ? o : o.value));
    for (const t of TYPES) expect(opts).toContain(t);
  });

  test("the presentation inputs our recipe sets are all real", async () => {
    const m = (await (await fetch(`${HOST}/tools/d3/tool.json`)).json()) as Manifest;
    const keys = new Set((m.inputs ?? []).flatMap((x) => [x.id, x.urlKey].filter(Boolean) as string[]));
    // The recipe in references/composing.md: colour by category, brand palette,
    // sorted, titled, no grid, no legend, capped bar thickness.
    for (const k of ["cb", "pl", "so", "t", "st", "gd", "lg", "bt", "width", "height"]) {
      expect(keys, `d3 no longer accepts "${k}"`).toContain(k);
    }
  });
});
