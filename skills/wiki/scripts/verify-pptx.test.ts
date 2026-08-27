// Tests for the deck verifier. The question it answers is the one a clean
// render log cannot: did the media the spec asked for actually land in the file?
//
// The parsers take XML strings and the checker takes plain objects, so the whole
// suite is offline and never needs unzip, a renderer or a real .pptx.
import { describe, expect, test } from "bun:test";
import {
  checkDeck,
  expectedFromSpec,
  parsePlacements,
  parseRels,
  type ActualSlide,
  type MediaFact,
} from "./verify-pptx";

// ── rels ────────────────────────────────────────────────────────────────────

const rels = (targets: string[], notes = false) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="x">` +
  targets.map((t, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${t}"/>`).join("") +
  `<Relationship Id="rIdL" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"/>` +
  (notes ? `<Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>` : "") +
  `</Relationships>`;

describe("parseRels", () => {
  test("finds the media targets", () => {
    expect(parseRels(rels(["a.png", "b.gif"])).media).toEqual(["a.png", "b.gif"]);
  });

  test("ignores the layout relationship", () => {
    expect(parseRels(rels(["a.png"])).media).not.toContain("slideLayout2.xml");
  });

  test("reports whether the slide has speaker notes", () => {
    expect(parseRels(rels(["a.png"], true)).hasNotes).toBe(true);
    expect(parseRels(rels(["a.png"], false)).hasNotes).toBe(false);
  });

  test("a slide with no media at all is not an error", () => {
    expect(parseRels(rels([])).media).toEqual([]);
  });
});

// ── placements ──────────────────────────────────────────────────────────────

const EMU = 914400;
const ext = (xIn: number, yIn: number, wIn: number, hIn: number) =>
  `<a:off x="${xIn * EMU}" y="${yIn * EMU}"/><a:ext cx="${wIn * EMU}" cy="${hIn * EMU}"/>`;

describe("parsePlacements", () => {
  test("converts EMU to inches", () => {
    const [p] = parsePlacements(`<p:pic>${ext(1, 2, 4, 3)}</p:pic>`);
    expect(p).toEqual({ x: 1, y: 2, w: 4, h: 3 });
  });

  test("reads only picture frames, not text boxes", () => {
    const xml = `<p:sp>${ext(0.8, 0.45, 11.7, 0.95)}</p:sp><p:pic>${ext(1, 1, 5, 4)}</p:pic>`;
    expect(parsePlacements(xml)).toEqual([{ x: 1, y: 1, w: 5, h: 4 }]);
  });

  test("returns nothing when there are no pictures", () => {
    expect(parsePlacements("<p:sp>text</p:sp>")).toEqual([]);
  });
});

// ── what the spec asked for ─────────────────────────────────────────────────

describe("expectedFromSpec", () => {
  const spec = {
    slides: [
      { layout: "title", title: "T", background: { path: "bg.png" }, notes: "n" },
      { layout: "big-number", number: "14", label: "l", notes: "n" },
      { layout: "content", title: "C", bullets: ["a"], image: { path: "chart.svg" }, notes: "n" },
      { layout: "image", title: "I", image: { path: "anim.gif" } },
    ],
  };

  test("counts one expected image per image path", () => {
    expect(expectedFromSpec(spec).map((e) => e.images)).toEqual([1, 0, 1, 1]);
  });

  test("records the source path so a missing image can be named", () => {
    expect(expectedFromSpec(spec)[2]!.paths).toEqual(["chart.svg"]);
  });

  test("counts a background as an expected image", () => {
    expect(expectedFromSpec(spec)[0]!.paths).toEqual(["bg.png"]);
  });

  test("records whether the spec supplied notes", () => {
    expect(expectedFromSpec(spec).map((e) => e.wantsNotes)).toEqual([true, true, true, false]);
  });
});

// ── the check ───────────────────────────────────────────────────────────────

const media = (over: Partial<MediaFact> = {}): MediaFact => ({
  name: "chart.png", bytes: 90_000, format: "png", animated: false, ...over,
});

const slide = (over: Partial<ActualSlide> = {}): ActualSlide => ({
  media: ["chart.png"], hasNotes: true, placements: [{ x: 1, y: 1, w: 5, h: 4 }], ...over,
});

describe("checkDeck", () => {
  test("a deck that matches its spec is clean", () => {
    const f = checkDeck([slide()], expectedFromSpec({
      slides: [{ layout: "content", image: { path: "c.svg" }, notes: "n" }],
    }), { "chart.png": media() });
    expect(f).toEqual([]);
  });

  test("catches a slide whose image never landed", () => {
    const f = checkDeck([slide({ media: [] })], expectedFromSpec({
      slides: [{ layout: "content", image: { path: "c.svg" }, notes: "n" }],
    }), {});
    expect(f).toHaveLength(1);
    expect(f[0]!.rule).toBe("missing-media");
    expect(f[0]!.message).toContain("c.svg");
  });

  test("catches a slide count that does not match the spec", () => {
    const f = checkDeck([slide(), slide()], expectedFromSpec({
      slides: [{ layout: "content", image: { path: "c.svg" }, notes: "n" }],
    }), { "chart.png": media() });
    expect(f.some((x) => x.rule === "slide-count")).toBe(true);
  });

  test("catches a truncated or placeholder image", () => {
    const f = checkDeck([slide()], expectedFromSpec({
      slides: [{ layout: "content", image: { path: "c.svg" }, notes: "n" }],
    }), { "chart.png": media({ bytes: 300 }) });
    expect(f.some((x) => x.rule === "tiny-media")).toBe(true);
  });

  test("catches notes promised by the spec but absent from the file", () => {
    const f = checkDeck([slide({ hasNotes: false })], expectedFromSpec({
      slides: [{ layout: "content", image: { path: "c.svg" }, notes: "spoken" }],
    }), { "chart.png": media() });
    expect(f.some((x) => x.rule === "missing-notes")).toBe(true);
  });

  test("reports an animated image with its frame count rather than flagging it", () => {
    const f = checkDeck([slide({ media: ["a.gif"] })], expectedFromSpec({
      slides: [{ layout: "image", image: { path: "a.gif" } }],
    }), { "a.gif": media({ name: "a.gif", format: "gif", animated: true, frames: 75 }) });
    const note = f.find((x) => x.rule === "animated");
    expect(note?.severity).toBe("info");
    expect(note?.message).toContain("75");
  });

  test("reports an animation whose exact frame count was not counted", () => {
    // animationOf short-circuits once it has proof of a second frame, so an
    // undefined count is the normal case and must not read as "still".
    const f = checkDeck([slide({ media: ["a.gif"] })], expectedFromSpec({
      slides: [{ layout: "image", image: { path: "a.gif" } }],
    }), { "a.gif": media({ name: "a.gif", format: "gif", animated: true, frames: undefined }) });
    expect(f.some((x: any) => x.rule === "animated")).toBe(true);
  });

  test("a single-frame gif is not reported as animated", () => {
    const f = checkDeck([slide({ media: ["a.gif"] })], expectedFromSpec({
      slides: [{ layout: "image", image: { path: "a.gif" } }],
    }), { "a.gif": media({ name: "a.gif", format: "gif", animated: false, frames: 1 }) });
    expect(f.some((x) => x.rule === "animated")).toBe(false);
  });

  test("warns when a visual is placed far below the width it was given", () => {
    // A 1.6-ratio image in a 2.22-ratio box only fills 72% of the width, which
    // is exactly how a readable chart becomes an unreadable one.
    const f = checkDeck([slide({ placements: [{ x: 3, y: 1.75, w: 7.28, h: 4.55 }] })], expectedFromSpec({
      slides: [{ layout: "image", image: { path: "c.svg" } }],
    }), { "chart.png": media() });
    expect(f.some((x) => x.rule === "letterboxed")).toBe(true);
  });

  test("a full-bleed background is never called letterboxed", () => {
    const f = checkDeck([slide({ placements: [{ x: 0, y: 0, w: 13.33, h: 7.5 }] })], expectedFromSpec({
      slides: [{ layout: "title", background: { path: "bg.png" } }],
    }), { "chart.png": media() });
    expect(f.some((x) => x.rule === "letterboxed")).toBe(false);
  });

  test("every finding names the slide it is on", () => {
    const f = checkDeck([slide(), slide({ media: [] })], expectedFromSpec({
      slides: [
        { layout: "content", image: { path: "a.svg" }, notes: "n" },
        { layout: "content", image: { path: "b.svg" }, notes: "n" },
      ],
    }), { "chart.png": media() });
    expect(f.every((x) => typeof x.slide === "number")).toBe(true);
    expect(f[0]!.slide).toBe(2);
  });

  test("works with no spec at all, reporting what is in the file", () => {
    const f = checkDeck([slide({ media: [], hasNotes: false, placements: [] })], null, {});
    expect(f).toEqual([]);
  });
});
