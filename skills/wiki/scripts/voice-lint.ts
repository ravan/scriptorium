#!/usr/bin/env bun
// Checks a draft against the mechanical half of the wiki's idiolect voice
// profile. Run it before you call a composed piece done.
//
// Usage:
//   bun voice-lint.ts <file.md | spec.json> [more files...] [--json] [--profile <profile-dir | ban-list.md>]
//
// It reads the banned words out of the active idiolect profile's ban-list.md
// (profiles/<name>/, named by the wiki CLAUDE.md voice_profile key), so the
// words it bans are the owner's words and not a list baked in here. A profile
// the wiki does not carry is looked up user-wide under ~/.idiolect/profiles/,
// where idiolect keeps a voice shared across projects; the wiki copy wins.
// Legacy wikis with a profile/voice.md kill list still work.
//
// What it settles: connector dashes, more than one comma in a sentence,
// kill-list words, emoji, paragraphs over three sentences.
//
// What it cannot settle, and deliberately does not try: whether the piece opens
// with a scene, whether the close calls back to it, whether a claim carries its
// evidence, whether it sounds like a person talking. Those stay with you. A
// clean run here is necessary and never sufficient.
//
// Exit codes: 0 clean, 2 hard-rule findings, 1 usage error.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { findWikiRoot } from "./common";

// ── types ───────────────────────────────────────────────────────────────────

export type Severity = "hard" | "soft";
export type Rule = "dash" | "comma" | "kill-list" | "emoji" | "paragraph";

export interface Finding {
  rule: Rule;
  severity: Severity;
  text: string; // the fragment that triggered it, so it can be found in the file
  detail?: string; // the banned word, the comma count, whatever names the cause
  where?: string; // "slide 3 bullet 2" for specs, unset for plain prose
}

export interface SpecText {
  where: string;
  text: string;
}

export interface LintOptions {
  killList: string[];
  /** Prose gets the paragraph-length rule. Slide bullets and captions do not. */
  prose?: boolean;
}

// The fallback when a wiki has no profile yet. The profile always wins when it
// exists, because the kill list belongs to the writer and not to this script.
export const DEFAULT_KILL_LIST = [
  "leverage", "synergy", "utilize", "robust", "seamless", "best-in-class",
  "unlock", "empower", "holistic", "delve", "in today's fast-paced world",
  "landscape", "tapestry", "moreover", "furthermore", "realm",
  "testament to", "at the end of the day", "dive deep", "revolutionary",
  "game-changing", "cutting-edge", "disruptive", "next-generation",
  "paradigm shift", "supercharge", "arguably", "it could be argued",
  "some might say", "relatively speaking",
];

// ── code is out of scope ────────────────────────────────────────────────────

/**
 * Blanks fenced blocks and inline spans. A command line is full of dashes and
 * commas that are not prose, and flagging them would train the reader to ignore
 * this script. Length is preserved for fenced blocks so line numbers survive.
 */
export function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, "");
}

// ── sentences ───────────────────────────────────────────────────────────────

// Splitting on ". " alone tears "compose-pptx.ts on version 1.5" into pieces and
// then reports comma counts for fragments, so the split has to refuse these.
const ABBREVIATIONS = ["e.g", "i.e", "etc", "vs", "cf", "approx", "no", "fig", "dr", "mr", "ms", "st"];

export function splitSentences(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    if (!".!?".includes(t[i]!)) continue;
    const after = t[i + 1];
    if (after !== undefined && !/\s/.test(after)) continue; // "1.5", "compose-pptx.ts"
    if (t[i] === ".") {
      // Dots belong to the word here, so "e.g" is seen whole rather than as "g".
      const lastWord = (t.slice(start, i).match(/[\w'.]+$/) ?? [""])[0]!.toLowerCase();
      if (ABBREVIATIONS.includes(lastWord)) continue;
    }
    const piece = t.slice(start, i + 1).trim();
    if (piece) out.push(piece);
    start = i + 1;
  }
  const tail = t.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

// ── connector dashes ────────────────────────────────────────────────────────

/**
 * An em dash or en dash anywhere, a spaced hyphen, or a double hyphen. A hyphen
 * inside a compound word is fine, and so is an en dash between two numbers,
 * which is a range rather than a pause.
 */
export function connectorDashes(text: string): Finding[] {
  const out: Finding[] = [];
  const lines = stripCode(text).split("\n");
  for (const line of lines) {
    // Markdown structure that legitimately uses hyphens.
    if (/^\s*[-*+]\s/.test(line)) continue; // list bullet
    if (/^\s*\|?[\s|:-]+\|?\s*$/.test(line) && line.includes("-")) continue; // table rule
    if (/^-{3,}\s*$/.test(line)) continue; // frontmatter fence / thematic break

    for (const m of line.matchAll(/[—]/g)) {
      out.push({ rule: "dash", severity: "hard", text: context(line, m.index!), detail: "em dash" });
    }
    for (const m of line.matchAll(/[–]/g)) {
      // 63–75 is a range, not a connector.
      if (/\d\s*$/.test(line.slice(0, m.index!)) && /^\s*\d/.test(line.slice(m.index! + 1))) continue;
      out.push({ rule: "dash", severity: "hard", text: context(line, m.index!), detail: "en dash" });
    }
    for (const m of line.matchAll(/\s--?\s/g)) {
      out.push({ rule: "dash", severity: "hard", text: context(line, m.index!), detail: "spaced hyphen" });
    }
  }
  return out;
}

function context(line: string, at: number, radius = 40): string {
  return line.slice(Math.max(0, at - radius), at + radius).trim();
}

// ── comma count ─────────────────────────────────────────────────────────────

export interface CommaHit extends Finding {
  count: number;
}

/** More than one comma in a sentence. Thousands separators are not commas here. */
export function overCommaed(text: string): CommaHit[] {
  const out: CommaHit[] = [];
  for (const s of splitSentences(stripCode(text))) {
    const commas = s.replace(/(\d),(\d)/g, "$1$2").split(",").length - 1;
    if (commas > 1) {
      out.push({ rule: "comma", severity: "hard", text: s, count: commas, detail: `${commas} commas` });
    }
  }
  return out;
}

// ── kill list ───────────────────────────────────────────────────────────────

/**
 * Reads the words between "The Kill List" heading and the next heading. Falls
 * back to DEFAULT_KILL_LIST when the profile has no such section, so a wiki
 * without a profile still gets the obvious tells caught.
 */
export function parseKillList(voiceMd: string): string[] {
  const start = voiceMd.search(/^#{1,6}\s*The Kill List\s*$/im);
  if (start < 0) return [...DEFAULT_KILL_LIST];
  const rest = voiceMd.slice(start).split("\n").slice(1).join("\n");
  const end = rest.search(/^#{1,6}\s/m);
  const body = end < 0 ? rest : rest.slice(0, end);

  const words = new Set<string>();
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("HARD RULE") || line.startsWith(">")) continue;
    // "Corporate filler: leverage, synergy" -> drop the category label.
    const listPart = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
    for (const piece of listPart.split(",")) {
      const w = piece
        .replace(/\([^)]*\)/g, "") // "ecosystem (as a metaphor)" -> "ecosystem"
        .replace(/[".*_`]/g, "")
        .trim()
        .replace(/\.$/, "")
        .toLowerCase();
      // Sentence fragments and punctuation notes are not single banned terms.
      if (!w || w.split(/\s+/).length > 6) continue;
      if (!/[a-z]/.test(w)) continue;
      words.add(w);
    }
  }
  return words.size ? [...words] : [...DEFAULT_KILL_LIST];
}

/**
 * Reads an idiolect profile's ban-list.md: bullets only, one banned form per
 * bullet, scope note after a spaced dash. Prose outside bullets is ignored, as
 * the idiolect template promises scanners will. Template placeholders in angle
 * brackets are skipped. An empty parse falls back to DEFAULT_KILL_LIST, same
 * as a wiki with no profile at all.
 */
export function parseBanList(banMd: string): string[] {
  const words = new Set<string>();
  for (const rawLine of banMd.split("\n")) {
    const line = rawLine.trim();
    if (!/^[-*+]\s/.test(line)) continue;
    // "- term — reason; replacement" -> "term"
    const entry = line
      .replace(/^[-*+]\s+/, "")
      .split(/\s+(?:—|–|--?)\s+/)[0]!
      .replace(/[".*_`]/g, "")
      .trim()
      .replace(/\.$/, "")
      .toLowerCase();
    if (!entry || entry.includes("<")) continue; // unfilled template placeholder
    if (entry.split(/\s+/).length > 6) continue;
    if (!/[a-z]/.test(entry)) continue;
    words.add(entry);
  }
  return words.size ? [...words] : [...DEFAULT_KILL_LIST];
}

/**
 * Finds the active idiolect profile's ban-list.md: the profile named by the
 * CLAUDE.md voice_profile key, or the only profile there is.
 *
 * Looked up in the wiki first, then user-wide under `~/.idiolect/profiles/`,
 * which is where idiolect keeps a voice several projects share. The project copy
 * always wins, matching how hogwash resolves the same paths. Without the second
 * place, a wiki naming a shared profile falls through to DEFAULT_KILL_LIST and
 * enforces the wrong words while looking like it worked.
 *
 * `home` is injectable so the tests never depend on the real home directory.
 */
export function findBanListPath(root: string, home: string = homedir()): string | null {
  const local = join(root, "profiles");
  const userWide = join(home, ".idiolect", "profiles");

  let name: string | undefined;
  let declaredNone = false;
  const claudeMd = join(root, "CLAUDE.md");
  if (existsSync(claudeMd)) {
    const m = readFileSync(claudeMd, "utf8").match(/\*\*voice_profile\*\*:\s*([\w][\w.-]*)/i);
    if (m) {
      if (m[1]!.toLowerCase() === "none") declaredNone = true;
      else name = m[1];
    }
  }

  // `voice_profile: none` still adopts a profile the wiki itself carries: a
  // stale key should not hide a voice sitting right there. It does stop the
  // search at the wiki boundary though, because reaching into the user-wide
  // profiles would apply another context's voice to a wiki that declined one.
  const dirs = declaredNone ? [local] : [local, userWide];

  // No name given: adopt the single profile, if exactly one exists. Checked per
  // location, so an ambiguous directory never gets guessed at.
  if (!name) {
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      const withBans = readdirSync(dir).filter((d) => existsSync(join(dir, d, "ban-list.md")));
      if (withBans.length === 1) {
        name = withBans[0];
        break;
      }
      if (withBans.length > 1) break; // ambiguous; do not guess
    }
  }
  if (!name) return null;

  for (const dir of dirs) {
    const p = join(dir, name, "ban-list.md");
    if (existsSync(p)) return p;
  }
  return null;
}

export interface KillHit extends Finding {
  word: string;
}

export function killListHits(text: string, list: string[]): KillHit[] {
  const out: KillHit[] = [];
  const hay = stripCode(text);
  for (const word of list) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "gi");
    for (const _ of hay.matchAll(re)) {
      out.push({
        rule: "kill-list",
        severity: "hard",
        text: context(hay.split("\n").find((l) => l.toLowerCase().includes(word)) ?? hay, 0, 80),
        word,
        detail: word,
      });
    }
  }
  return out;
}

// ── emoji ───────────────────────────────────────────────────────────────────

const EMOJI = /(\p{Extended_Pictographic}|\p{Emoji_Presentation})/gu;

export function emojiHits(text: string): Finding[] {
  return [...stripCode(text).matchAll(EMOJI)].map((m) => ({
    rule: "emoji" as const,
    severity: "hard" as const,
    text: m[0],
    detail: "emoji",
  }));
}

// ── paragraph length ────────────────────────────────────────────────────────

/** Prose paragraphs only. Bullets, headings and table rows are not paragraphs. */
export function longParagraphs(text: string): Finding[] {
  const out: Finding[] = [];
  for (const block of stripCode(text).split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.some((l) => /^([-*+]\s|\d+\.\s|#{1,6}\s|>|\|)/.test(l))) continue;
    const n = splitSentences(lines.join(" ")).length;
    if (n > 3) {
      out.push({
        rule: "paragraph",
        severity: "soft",
        text: lines.join(" ").slice(0, 90),
        detail: `${n} sentences`,
      });
    }
  }
  return out;
}

// ── pulling prose out of a spec ─────────────────────────────────────────────

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

/**
 * Which fields get the paragraph-length rule. Speaker notes are a spoken script
 * and run long on purpose, so measuring them against a published-prose rule only
 * produces noise the reader learns to skip. Bullets and captions are one line by
 * design. That leaves body copy.
 */
export function prosePolicyFor(where: string): boolean {
  return where.endsWith("body");
}

// ── the whole check ─────────────────────────────────────────────────────────

export function lintText(text: string, opts: LintOptions): Finding[] {
  const out: Finding[] = [
    ...connectorDashes(text),
    ...overCommaed(text),
    ...killListHits(text, opts.killList),
    ...emojiHits(text),
  ];
  if (opts.prose !== false) out.push(...longParagraphs(text));
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const profileAt = argv.indexOf("--profile");
  const profileArg = profileAt >= 0 ? argv[profileAt + 1] : undefined;
  const files = argv.filter((a, i) =>
    !a.startsWith("--") && i !== profileAt + (profileAt >= 0 ? 1 : -99));

  if (!files.length) {
    console.error("Usage: bun voice-lint.ts <file.md | spec.json> [...] [--json] [--profile <voice.md>]");
    process.exit(1);
  }

  // The ban list comes from the active idiolect profile. --profile takes a
  // profile directory or a ban-list.md; a legacy profile/voice.md kill list
  // still parses; a wiki with neither gets the built-in defaults.
  let profilePath = profileArg;
  if (profilePath && existsSync(profilePath) && statSync(profilePath).isDirectory()) {
    profilePath = join(profilePath, "ban-list.md");
  }
  if (!profilePath) {
    const root = findWikiRoot(process.cwd()) ?? findWikiRoot(files[0]!);
    if (root) {
      profilePath = findBanListPath(root) ??
        (existsSync(join(root, "profile", "voice.md")) ? join(root, "profile", "voice.md") : undefined);
    }
  }
  let killList = [...DEFAULT_KILL_LIST];
  if (profilePath && existsSync(profilePath)) {
    const md = readFileSync(profilePath, "utf8");
    killList = basename(profilePath) === "ban-list.md" ? parseBanList(md) : parseKillList(md);
  }

  const all: Finding[] = [];
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`voice-lint: no such file: ${file}`);
      process.exit(1);
    }
    const raw = readFileSync(file, "utf8");
    if (file.endsWith(".json")) {
      let spec: any;
      try {
        spec = JSON.parse(raw);
      } catch (e) {
        console.error(`voice-lint: ${file} is not valid JSON`);
        process.exit(1);
      }
      const pieces = textsFromSpec(spec);
      if (!pieces.length) console.error(`voice-lint: no prose found in ${file}; is it a deck or doc spec?`);
      for (const p of pieces) {
        for (const f of lintText(p.text, { killList, prose: prosePolicyFor(p.where) })) all.push({ ...f, where: `${file}: ${p.where}` });
      }
    } else {
      for (const f of lintText(raw, { killList })) all.push({ ...f, where: file });
    }
  }

  const hard = all.filter((f) => f.severity === "hard");

  if (asJson) {
    console.log(JSON.stringify({ ok: hard.length === 0, findings: all }, null, 2));
    process.exit(hard.length ? 2 : 0);
  }

  if (!all.length) {
    console.log(`voice-lint: clean (${files.length} file(s)).`);
    console.log("Mechanical rules only. Scene, callback, evidence and rhythm are still yours to judge.");
    process.exit(0);
  }
  for (const f of all) {
    const tag = f.severity === "hard" ? "voice" : "style";
    console.log(`${tag}: ${f.where ?? ""} [${f.rule}${f.detail ? " " + f.detail : ""}] ${f.text}`);
  }
  console.log(`\n${hard.length} hard-rule finding(s), ${all.length - hard.length} style note(s).`);
  console.log("Mechanical rules only. Scene, callback, evidence and rhythm are still yours to judge.");
  process.exit(hard.length ? 2 : 0);
}
