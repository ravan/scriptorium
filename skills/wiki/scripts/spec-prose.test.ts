// Tests for the deck/doc spec adapter: the prose hogwash would otherwise never
// see, and the shape it has to be written in for hogwash's rules to be right.
//
// Fully offline. Every fixture is an object built in the test, so a failure
// always means the adapter changed and never that a file moved.
import { describe, expect, test } from "bun:test";
import { isBodyCopy, renderProse, textsFromSpec } from "./spec-prose";

describe("textsFromSpec", () => {
  test("labels each slide field with the slide it came from", () => {
    const pieces = textsFromSpec({
      slides: [
        { title: "First up", bullets: ["one", { text: "two" }] },
        { title: "Then this", notes: "spoken script" },
      ],
    });
    expect(pieces).toEqual([
      { where: "slide 1 title", text: "First up" },
      { where: "slide 1 bullet 1", text: "one" },
      { where: "slide 1 bullet 2", text: "two" },
      { where: "slide 2 title", text: "Then this" },
      { where: "slide 2 notes", text: "spoken script" },
    ]);
  });

  test("reads a two-column slide and an image caption", () => {
    const pieces = textsFromSpec({
      slides: [
        {
          left: { heading: "Before", bullets: ["slow"] },
          right: ["after"],
          image: { caption: "the graph" },
        },
      ],
    });
    expect(pieces.map((p) => p.where)).toEqual([
      "slide 1 caption",
      "slide 1 left heading",
      "slide 1 left bullet 1",
      "slide 1 right bullet 1",
    ]);
  });

  test("reads document sections and their paragraphs", () => {
    const pieces = textsFromSpec({
      sections: [{ heading: "Why", body: "Because.", paragraphs: ["More.", "Still more."] }],
    });
    expect(pieces).toEqual([
      { where: "section 1 heading", text: "Why" },
      { where: "section 1 body", text: "Because." },
      { where: "section 1 para 1", text: "More." },
      { where: "section 1 para 2", text: "Still more." },
    ]);
  });

  test("REGRESSION: reads the blocks a compose-doc.ts spec actually uses", () => {
    // The whitepaper in the test wiki carried 1,369 words of body copy in `p`
    // blocks and only its headings ever reached hogwash.
    const pieces = textsFromSpec({
      sections: [
        {
          heading: "The problem",
          blocks: [
            { type: "p", text: "Prose one." },
            { type: "bullets", items: ["a", "b"] },
            { type: "numbered", items: ["first"] },
            { type: "callout", text: "Remember this." },
            { type: "quote", text: "Said so.", attribution: "Someone" },
            { type: "image", path: "x.svg", caption: "a figure" },
            { type: "pagebreak" },
          ],
        },
      ],
    });
    expect(pieces).toEqual([
      { where: "section 1 heading", text: "The problem" },
      { where: "section 1 block 1 body", text: "Prose one." },
      { where: "section 1 block 2 item 1", text: "a" },
      { where: "section 1 block 2 item 2", text: "b" },
      { where: "section 1 block 3 item 1", text: "first" },
      { where: "section 1 block 4 callout", text: "Remember this." },
      { where: "section 1 block 5 quote", text: "Said so." },
      { where: "section 1 block 5 attribution", text: "Someone" },
      { where: "section 1 block 6 caption", text: "a figure" },
    ]);
    // Body copy in a block is measured as a paragraph, like the legacy shape.
    expect(isBodyCopy("section 1 block 1 body")).toBe(true);
    expect(isBodyCopy("section 1 block 2 item 1")).toBe(false);
  });

  test("leaves a bare number alone, because it is not prose", () => {
    expect(textsFromSpec({ slides: [{ title: "42", subtitle: "12.5%" }] })).toEqual([]);
  });

  test("finds nothing in a spec with neither slides nor sections", () => {
    expect(textsFromSpec({ template: "suse-sovereign" })).toEqual([]);
  });
});

describe("isBodyCopy", () => {
  test("counts body fields and document paragraphs", () => {
    expect(isBodyCopy("slide 1 body")).toBe(true);
    expect(isBodyCopy("section 2 para 3")).toBe(true);
  });

  test("leaves one-line fields out, so the paragraph rule never sees them", () => {
    for (const where of ["slide 1 title", "slide 1 bullet 2", "slide 1 caption", "slide 1 notes"]) {
      expect(isBodyCopy(where)).toBe(false);
    }
  });
});

describe("renderProse", () => {
  test("writes body copy as a paragraph and everything else as a list item", () => {
    const { markdown } = renderProse([
      { where: "slide 1 title", text: "First up" },
      { where: "section 1 body", text: "One. Two. Three. Four." },
    ]);
    expect(markdown).toBe("- First up\n\nOne. Two. Three. Four.\n");
  });

  test("maps every piece back to the line its text starts on", () => {
    const { markdown, index } = renderProse([
      { where: "slide 1 title", text: "First up" },
      { where: "slide 1 notes", text: "spoken script" },
      { where: "section 1 body", text: "Because." },
    ]);
    expect(index).toEqual([
      { line: 1, where: "slide 1 title" },
      { line: 3, where: "slide 1 notes" },
      { line: 5, where: "section 1 body" },
    ]);
    expect(markdown.split("\n")[index[2]!.line - 1]).toBe("Because.");
  });

  test("keeps a wrapped list item on one line, so it stays one list item", () => {
    const { markdown } = renderProse([{ where: "slide 1 notes", text: "one\ntwo" }]);
    expect(markdown).toBe("- one two\n");
  });

  test("keeps the line breaks inside body copy", () => {
    const { markdown, index } = renderProse([
      { where: "section 1 body", text: "One.\nTwo." },
      { where: "section 2 body", text: "Three." },
    ]);
    expect(markdown).toBe("One.\nTwo.\n\nThree.\n");
    expect(index).toEqual([
      { line: 1, where: "section 1 body" },
      { line: 4, where: "section 2 body" },
    ]);
  });
});
