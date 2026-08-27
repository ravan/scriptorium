// Tests for the preview router. Turning a composed artifact into pictures you
// can actually look at involves several external tools, so the decisions about
// which route to take, which pages to make and what to warn about are kept as
// pure functions and tested here. Nothing in this file launches a renderer.
import { describe, expect, test } from "bun:test";
import { chooseDeckConverter, keynoteScript, parsePageSpec, routeFor, sofficeArgs } from "./preview";

describe("routeFor", () => {
  test("a deck goes through a real renderer", () => {
    expect(routeFor("outputs/deck.pptx")).toBe("deck");
    expect(routeFor("outputs/DECK.PPTX")).toBe("deck");
  });

  test("a pdf is rasterised directly", () => {
    expect(routeFor("outputs/paper.pdf")).toBe("pdf");
  });

  test("an svg is rasterised, but by a route that cannot prove a slide", () => {
    expect(routeFor("assets/chart.svg")).toBe("svg");
  });

  test("an animation is sampled frame by frame", () => {
    expect(routeFor("assets/build.gif")).toBe("animation");
    expect(routeFor("assets/build.mp4")).toBe("animation");
  });

  test("a still raster is just copied through", () => {
    expect(routeFor("assets/shot.png")).toBe("raster");
    expect(routeFor("assets/shot.jpeg")).toBe("raster");
  });

  test("an unknown extension is refused rather than guessed at", () => {
    expect(routeFor("notes.txt")).toBe(null);
  });
});

describe("parsePageSpec", () => {
  test("a single page", () => {
    expect(parsePageSpec("3")).toEqual([3]);
  });

  test("a range", () => {
    expect(parsePageSpec("2-5")).toEqual([2, 3, 4, 5]);
  });

  test("a mixed list, sorted and deduplicated", () => {
    expect(parsePageSpec("5,1-3,2")).toEqual([1, 2, 3, 5]);
  });

  test("empty or missing means every page", () => {
    expect(parsePageSpec(undefined)).toEqual([]);
    expect(parsePageSpec("")).toEqual([]);
  });

  test("a reversed range is read forwards rather than dropped", () => {
    expect(parsePageSpec("4-2")).toEqual([2, 3, 4]);
  });

  test("junk is ignored, not crashed on", () => {
    expect(parsePageSpec("1,abc,3")).toEqual([1, 3]);
  });
});

describe("chooseDeckConverter", () => {
  test("prefers LibreOffice because it is headless and scriptable", () => {
    expect(chooseDeckConverter({ soffice: true, keynote: true })).toBe("soffice");
  });

  test("falls back to Keynote when LibreOffice is absent", () => {
    expect(chooseDeckConverter({ soffice: false, keynote: true })).toBe("keynote");
  });

  test("returns null when neither is present, so the caller can say so", () => {
    expect(chooseDeckConverter({ soffice: false, keynote: false })).toBe(null);
  });
});

describe("sofficeArgs", () => {
  test("converts to pdf headlessly into the given directory", () => {
    const a = sofficeArgs("/in/deck.pptx", "/out");
    expect(a).toContain("--headless");
    expect(a).toContain("--convert-to");
    expect(a).toContain("pdf");
    expect(a).toContain("/in/deck.pptx");
    expect(a[a.indexOf("--outdir") + 1]).toBe("/out");
  });
});

describe("keynoteScript", () => {
  const s = keynoteScript("/in/deck.pptx", "/out/deck.pdf");

  test("opens the deck and exports it as PDF", () => {
    expect(s).toContain("/in/deck.pptx");
    expect(s).toContain("/out/deck.pdf");
    expect(s).toContain("as PDF");
  });

  test("closes without saving, so the source file is never modified", () => {
    expect(s).toContain("close");
    expect(s).toContain("saving no");
  });

  test("quotes paths so a space in a filename cannot break the script", () => {
    expect(keynoteScript('/in/my deck.pptx', "/out/x.pdf")).toContain('"/in/my deck.pptx"');
  });
});
