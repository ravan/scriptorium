// Tests for the mechanical half of the voice and quality profile.
//
// Only the rules a regex can settle live here: connector dashes, comma count,
// kill-list words, emoji, paragraph length. Judgement calls (does this open with
// a scene? does the close call back?) stay with the agent, so nothing in this
// file pretends to score them.
//
// Fully offline. Every fixture is a string built in the test, so a failure
// always means the linter changed and never that a file moved.
import { describe, expect, test } from "bun:test";
import {
  connectorDashes,
  emojiHits,
  killListHits,
  lintText,
  longParagraphs,
  overCommaed,
  parseKillList,
  prosePolicyFor,
  splitSentences,
  stripCode,
  textsFromSpec,
} from "./voice-lint";

// ── sentence splitting ──────────────────────────────────────────────────────

describe("splitSentences", () => {
  test("splits on terminators", () => {
    expect(splitSentences("One thing. Then another. And a third.")).toEqual([
      "One thing.",
      "Then another.",
      "And a third.",
    ]);
  });

  test("does not split inside a version number or a filename", () => {
    expect(splitSentences("Run scripts/compose-pptx.ts on version 1.5 now.")).toHaveLength(1);
  });

  test("does not split after a common abbreviation", () => {
    expect(splitSentences("Use e.g. the waffle chart here.")).toHaveLength(1);
  });

  test("handles question and exclamation marks", () => {
    expect(splitSentences("Who holds the keys? Nobody knows.")).toHaveLength(2);
  });

  test("ignores trailing whitespace and empty input", () => {
    expect(splitSentences("  ")).toEqual([]);
    expect(splitSentences("No terminator")).toEqual(["No terminator"]);
  });
});

// ── code is out of scope ────────────────────────────────────────────────────

describe("stripCode", () => {
  test("removes fenced blocks", () => {
    const s = stripCode("before\n```bash\nmagick a.gif -fuzz 12% out.gif\n```\nafter");
    expect(s).not.toContain("magick");
    expect(s).toContain("before");
    expect(s).toContain("after");
  });

  test("removes inline spans", () => {
    expect(stripCode("Run `foo --bar -- baz` now.")).not.toContain("--");
  });

  test("keeps the surrounding prose intact", () => {
    expect(stripCode("Set `bg` to Pine.")).toBe("Set  to Pine.");
  });
});

// ── connector dashes ────────────────────────────────────────────────────────

describe("connectorDashes", () => {
  test("catches the em dash", () => {
    expect(connectorDashes("The keys—and the law—sit elsewhere.")).toHaveLength(2);
  });

  test("catches the en dash used as a connector", () => {
    expect(connectorDashes("Two numbers – never one.")).toHaveLength(1);
  });

  test("catches a spaced hyphen", () => {
    expect(connectorDashes("Two numbers - never one.")).toHaveLength(1);
  });

  test("catches a double hyphen", () => {
    expect(connectorDashes("Two numbers -- never one.")).toHaveLength(1);
  });

  test("allows a hyphen inside a real compound word", () => {
    expect(connectorDashes("A well-managed dependency is still a dependency.")).toHaveLength(0);
  });

  test("allows an en dash inside a numeric range", () => {
    expect(connectorDashes("It lands at 63–75 answer units.")).toHaveLength(0);
  });

  test("allows a markdown list bullet at line start", () => {
    expect(connectorDashes("- first item\n- second item")).toHaveLength(0);
  });

  test("allows a markdown table separator row", () => {
    expect(connectorDashes("| a | b |\n| --- | --- |")).toHaveLength(0);
  });

  test("allows a YAML frontmatter fence", () => {
    expect(connectorDashes("---\nname: thing\n---\n")).toHaveLength(0);
  });
});

// ── comma count ─────────────────────────────────────────────────────────────

describe("overCommaed", () => {
  test("one comma is fine", () => {
    expect(overCommaed("It floored at SEAL-0, because the provider held the keys.")).toHaveLength(0);
  });

  test("two commas is a finding", () => {
    expect(overCommaed("It had reports, clauses, and a plan.")).toHaveLength(1);
  });

  test("reports the offending sentence so it can be found", () => {
    const [hit] = overCommaed("Alpha, beta, gamma.");
    expect(hit.text).toContain("Alpha");
    expect(hit.count).toBe(2);
  });

  test("thousands separators do not count", () => {
    expect(overCommaed("It cost 1,000 and then 2,500 and then stopped.")).toHaveLength(0);
  });

  test("commas inside inline code do not count", () => {
    expect(overCommaed("Pass `a,b,c` to the tool.")).toHaveLength(0);
  });
});

// ── kill list ───────────────────────────────────────────────────────────────

describe("parseKillList", () => {
  const voice = `
### The Kill List

HARD RULE: none of these ever appear.

Corporate filler: leverage, synergy, utilize, ecosystem (as a metaphor).

AI-essay tells: delve, landscape, moreover, navigate (metaphorical).

### Loved Words

Plain mechanics words: actually, plumbing.
`;

  test("reads the words out of the profile", () => {
    const list = parseKillList(voice);
    expect(list).toContain("leverage");
    expect(list).toContain("delve");
  });

  test("drops the parenthetical annotation but keeps the word", () => {
    const list = parseKillList(voice);
    expect(list).toContain("ecosystem");
    expect(list).not.toContain("ecosystem (as a metaphor)");
  });

  test("stops at the next heading so loved words are not banned", () => {
    expect(parseKillList(voice)).not.toContain("plumbing");
  });

  test("returns the built-in list when the profile has no kill list", () => {
    expect(parseKillList("# Voice\n\nNothing here.").length).toBeGreaterThan(0);
  });
});

describe("killListHits", () => {
  test("matches a banned word case-insensitively", () => {
    expect(killListHits("We should Leverage this.", ["leverage"])).toHaveLength(1);
  });

  test("matches whole words only", () => {
    expect(killListHits("Alignment of the boxes.", ["align"])).toHaveLength(0);
  });

  test("reports which word was hit", () => {
    expect(killListHits("A robust ecosystem.", ["robust", "ecosystem"]).map((h) => h.word).sort())
      .toEqual(["ecosystem", "robust"]);
  });

  test("multi-word entries match as a phrase", () => {
    expect(killListHits("In today's fast-paced world, we ship.", ["in today's fast-paced world"])).toHaveLength(1);
  });
});

// ── emoji ───────────────────────────────────────────────────────────────────

describe("emojiHits", () => {
  test("catches an emoji", () => {
    expect(emojiHits("Shipped \u{1F680} today.")).toHaveLength(1);
  });

  test("leaves ordinary punctuation alone", () => {
    expect(emojiHits("Two numbers · one floor — fine.")).toHaveLength(0);
  });
});

// ── paragraph length ────────────────────────────────────────────────────────

describe("longParagraphs", () => {
  test("three sentences is fine", () => {
    expect(longParagraphs("One. Two. Three.")).toHaveLength(0);
  });

  test("four sentences is a finding", () => {
    expect(longParagraphs("One. Two. Three. Four.")).toHaveLength(1);
  });

  test("bullet lists are not paragraphs", () => {
    expect(longParagraphs("- One. Two. Three. Four.\n- Five. Six. Seven. Eight.")).toHaveLength(0);
  });

  test("headings and table rows are not paragraphs", () => {
    expect(longParagraphs("| One. Two. Three. Four. | x |")).toHaveLength(0);
    expect(longParagraphs("## One. Two. Three. Four.")).toHaveLength(0);
  });
});

// ── pulling text out of a spec ──────────────────────────────────────────────

describe("textsFromSpec", () => {
  const deck = {
    title: "Deck title",
    slides: [
      {
        layout: "content",
        title: "Slide one",
        bullets: ["First bullet", "Second bullet"],
        image: { path: "a.svg", caption: "A caption" },
        notes: "Spoken narrative.",
      },
      { layout: "big-number", number: "14", label: "out of 100", body: "Body text." },
    ],
  };

  test("finds every prose field with a locating label", () => {
    const got = textsFromSpec(deck);
    const wheres = got.map((t) => t.where);
    expect(wheres).toContain("slide 1 title");
    expect(wheres).toContain("slide 1 bullet 2");
    expect(wheres).toContain("slide 1 caption");
    expect(wheres).toContain("slide 1 notes");
    expect(wheres).toContain("slide 2 body");
  });

  test("skips paths and other non-prose fields", () => {
    expect(textsFromSpec(deck).map((t) => t.text)).not.toContain("a.svg");
  });

  test("skips a bare number so it is not linted as prose", () => {
    expect(textsFromSpec(deck).map((t) => t.text)).not.toContain("14");
  });

  test("handles a document spec with sections", () => {
    const doc = { title: "Doc", sections: [{ heading: "H", body: "Prose here." }] };
    expect(textsFromSpec(doc).map((t) => t.text)).toContain("Prose here.");
  });

  test("returns nothing for an unrecognised shape rather than throwing", () => {
    expect(textsFromSpec({ unrelated: true })).toEqual([]);
  });
});

// ── which fields get the paragraph rule ─────────────────────────────────────

describe("prosePolicyFor", () => {
  test("body copy is prose", () => {
    expect(prosePolicyFor("slide 2 body")).toBe(true);
  });

  test("speaker notes are a spoken script, not published prose", () => {
    expect(prosePolicyFor("slide 2 notes")).toBe(false);
  });

  test("bullets and captions are single lines by design", () => {
    expect(prosePolicyFor("slide 2 bullet 1")).toBe(false);
    expect(prosePolicyFor("slide 2 caption")).toBe(false);
  });
});

// ── the whole check ─────────────────────────────────────────────────────────

describe("lintText", () => {
  const list = ["leverage"];

  test("clean prose produces no findings", () => {
    const f = lintText("The keys sit with the provider. That is the whole finding.", { killList: list });
    expect(f).toHaveLength(0);
  });

  test("hard rules are marked hard", () => {
    const f = lintText("We leverage it — always.", { killList: list });
    expect(f.every((x) => x.severity === "hard")).toBe(true);
    expect(f.map((x) => x.rule).sort()).toEqual(["dash", "kill-list"]);
  });

  test("paragraph length is soft", () => {
    const f = lintText("One. Two. Three. Four.", { killList: list });
    expect(f.map((x) => x.severity)).toEqual(["soft"]);
  });

  test("paragraph length is not checked when prose is off", () => {
    expect(lintText("One. Two. Three. Four.", { killList: list, prose: false })).toHaveLength(0);
  });

  test("every finding carries the text that triggered it", () => {
    for (const f of lintText("We leverage, always, this thing.", { killList: list })) {
      expect(f.text.length).toBeGreaterThan(0);
    }
  });
});
