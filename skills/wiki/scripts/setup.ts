#!/usr/bin/env bun
// Creates (or repairs) a wiki folder. Safe to run twice: it never overwrites content.
// Usage: bun setup.ts <wiki-folder> --name "My Wiki" [--brand <brand-skill-name>]
//        [--slide-template <name>] [--bundle-skills lolly,suse-brand] [--voice-profile <name>]
//        [--refresh-templates] [--refresh-schema]
//
// What a re-run does:
//   scripts/            refreshed (skill-owned, never user content)
//   templates/          new files added; a file you edited is KEPT and named in the
//                       output. --refresh-templates overwrites those with the skill's copy.
//   .claude/skills/     bundled skills refreshed as real copies
//   CLAUDE.md           kept. A flag you pass explicitly (--brand, --slide-template,
//                       --voice-profile, --name) updates that one config line.
//                       --refresh-schema rebuilds the whole file from the current
//                       template, keeping your config values (old copy -> CLAUDE.md.prev).
//   git                 commits only what this run created or changed.
//
// Voice: hogwash and idiolect need no config file from us. Hogwash's defaults apply
// when hogwash.json is absent, and both tools resolve a profile in the wiki first
// (profiles/<name>/) and then user-wide under ~/.idiolect/profiles/<name>/.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { MANIFEST_REL, have, run } from "./common";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const has = (flag: string) => process.argv.includes(flag);

const target = process.argv[2];
if (!target || target.startsWith("--")) {
  console.error(
    'Usage: bun setup.ts <wiki-folder> --name "My Wiki" [--brand <brand-skill-name>] [--slide-template <template-name>] [--bundle-skills lolly,suse-brand] [--voice-profile <name>] [--refresh-templates] [--refresh-schema]',
  );
  process.exit(1);
}

const root = resolve(target);
const claudeMdPath = join(root, "CLAUDE.md");
const hadClaudeMd = existsSync(claudeMdPath);

// Config values already in the wiki's CLAUDE.md, so a re-run does not silently
// reset them to defaults. A flag passed on this run wins over the file.
function existingConfig(key: string): string | undefined {
  if (!hadClaudeMd) return undefined;
  const m = readFileSync(claudeMdPath, "utf8").match(new RegExp(`^- \\*\\*${key}\\*\\*: (\\S+)`, "m"));
  return m?.[1];
}

const name = arg("--name") ?? (hadClaudeMd ? readFileSync(claudeMdPath, "utf8").match(/^# (.+?) - Wiki Schema/m)?.[1] : undefined) ?? root.split("/").pop() ?? "wiki";
const brand = arg("--brand") ?? existingConfig("brand_skill") ?? "none";
const voiceProfile = arg("--voice-profile") ?? existingConfig("voice_profile") ?? "none";
const slideTemplate =
  arg("--slide-template") ?? existingConfig("slide_template") ?? (brand.includes("suse") ? "suse-sovereign" : "neutral");
const refreshTemplates = has("--refresh-templates");
const refreshSchema = has("--refresh-schema");

// Where the wiki skill itself lives. Normally this file runs from the skill
// (<skill>/scripts/setup.ts). It also ships into every wiki, and `bun
// scripts/setup.ts .` from inside a wiki used to compare the wiki with itself:
// no script refreshed, no template added, --bundle-skills looked in the wrong
// parent folder. So a run from the skill records where the skill is, and a run
// from the wiki copy reads that back (or finds the user-wide install).
const here = resolve(import.meta.dir, "..");
const isSkill = (dir: string) => existsSync(join(dir, "templates", "wiki-claude.md"));
const originFile = join(import.meta.dir, "skill-origin.json");
function locateSkillRoot(): { root: string; fromWikiCopy: boolean } {
  if (isSkill(here)) return { root: here, fromWikiCopy: false };
  const candidates: string[] = [];
  if (existsSync(originFile)) {
    try {
      candidates.push(JSON.parse(readFileSync(originFile, "utf8")).skillRoot);
    } catch {
      /* unreadable: fall through to the other candidates */
    }
  }
  candidates.push(join(process.env.HOME ?? "", ".claude", "skills", "wiki"));
  const found = candidates.find((c) => c && isSkill(c));
  if (found) return { root: found, fromWikiCopy: false };
  console.warn(
    "warning: running from the wiki's own copy of setup.ts and the wiki skill was not found.\n" +
      "  Scripts and templates cannot be refreshed this way. Run the skill's copy instead:\n" +
      "  bun <skill>/scripts/setup.ts <this wiki folder>",
  );
  return { root: here, fromWikiCopy: true };
}
const located = locateSkillRoot();
const skillRoot = located.root;
// Sibling skills live beside the wiki skill, wherever it is installed.
const skillsRoot = resolve(skillRoot, "..");
const bundleSkills = (arg("--bundle-skills") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const today = new Date().toISOString().slice(0, 10);
const made: string[] = []; // relative paths this run created or changed (git stages exactly these)
const kept: string[] = []; // template files the user edited, left alone

const note = (rel: string, suffix = "") => made.push(rel + suffix);
const pathOf = (entry: string) => entry.replace(/ \((updated|refreshed)\)$/, "");

function ensureDir(rel: string) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    mkdirSync(p, { recursive: true });
    note(rel + "/");
  }
}

function ensureFile(rel: string, content: string) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    writeFileSync(p, content);
    note(rel);
  }
}

// 1. Folders
for (const d of [
  "raw",
  "derived",
  "wiki/sources",
  "wiki/topics",
  "wiki/entities",
  "wiki/syntheses",
  "profiles",
  "outputs",
  "scripts",
]) {
  ensureDir(d);
}

// 2. Manifest
ensureFile(
  MANIFEST_REL,
  JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), files: {} }, null, 2) + "\n",
);

// 3. Seed the log (append-only JSONL; index.json/map.json are generated by links.ts below)
ensureFile(
  "wiki/log.jsonl",
  JSON.stringify({ at: new Date().toISOString(), op: "setup", title: "Wiki created" }) + "\n",
);

// 4. CLAUDE.md schema from template
const templatePath = join(skillRoot, "templates", "wiki-claude.md");
function renderSchema(): string {
  return readFileSync(templatePath, "utf8")
    .replaceAll("{{WIKI_NAME}}", name)
    .replaceAll("{{DATE}}", today)
    .replaceAll("{{BRAND_SKILL}}", brand)
    .replaceAll("{{SLIDE_TEMPLATE}}", slideTemplate)
    .replaceAll("{{VOICE_PROFILE}}", voiceProfile);
}
if (!hadClaudeMd) {
  if (existsSync(templatePath)) ensureFile("CLAUDE.md", renderSchema());
  else console.warn("warning: template wiki-claude.md not found in the wiki skill; CLAUDE.md not created.");
} else if (refreshSchema) {
  if (!existsSync(templatePath)) {
    console.error("--refresh-schema needs the wiki skill's template. Run the skill's copy: bun <skill>/scripts/setup.ts <wiki> --refresh-schema");
    process.exit(1);
  }
  {
    // The template moved on (new conventions, new scripts). Rebuild from it with
    // the config the wiki already has, and keep the old file so nothing the user
    // added by hand is lost without a trace.
    const old = readFileSync(claudeMdPath, "utf8");
    const created = old.match(/created (\d{4}-\d{2}-\d{2})/)?.[1] ?? today;
    writeFileSync(join(root, "CLAUDE.md.prev"), old);
    writeFileSync(claudeMdPath, renderSchema().replace(`created ${today}`, `created ${created}`));
    note("CLAUDE.md", " (updated)");
    note("CLAUDE.md.prev");
    console.log("CLAUDE.md rebuilt from the current template. Anything you had added by hand is in CLAUDE.md.prev - move it back, then delete that file.");
  }
} else {
  // A flag given on this run updates its one line; nothing else in the file moves.
  let text = readFileSync(claudeMdPath, "utf8");
  const setLine = (key: string, value: string) => {
    const re = new RegExp(`^(- \\*\\*${key}\\*\\*: )\\S+`, "m");
    if (re.test(text)) text = text.replace(re, `$1${value}`);
    else console.warn(`warning: CLAUDE.md has no "${key}" line to update; run with --refresh-schema.`);
  };
  if (arg("--brand")) setLine("brand_skill", brand);
  if (arg("--slide-template")) setLine("slide_template", slideTemplate);
  if (arg("--voice-profile")) setLine("voice_profile", voiceProfile);
  if (arg("--name")) text = text.replace(/^# .+? - Wiki Schema$/m, `# ${name} - Wiki Schema`);
  if (text !== readFileSync(claudeMdPath, "utf8")) {
    writeFileSync(claudeMdPath, text);
    note("CLAUDE.md", " (updated)");
  }
}

// 5. Copy scripts into the wiki so it is self-contained.
// These are skill-owned, not user content, so they are refreshed rather than skipped:
// re-running setup on an older wiki is how it picks up new and fixed scripts.
// Every .ts/.json in the skill's scripts/ ships; a new script needs no list edit.
if (!located.fromWikiCopy) {
  for (const f of readdirSync(join(skillRoot, "scripts")).filter((f) => /\.(ts|json)$/.test(f) && f !== "skill-origin.json").sort()) {
    const src = join(skillRoot, "scripts", f);
    const dst = join(root, "scripts", f);
    if (!statSync(src).isFile()) continue;
    const fresh = !existsSync(dst);
    if (fresh || readFileSync(src, "utf8") !== readFileSync(dst, "utf8")) {
      cpSync(src, dst);
      note("scripts/" + f, fresh ? "" : " (updated)");
    }
  }
  // Remember where the skill is, so `bun scripts/setup.ts .` inside the wiki
  // can find it next time. Machine-local (an absolute path), so git-ignored.
  writeFileSync(join(root, "scripts", "skill-origin.json"), JSON.stringify({ skillRoot }, null, 2) + "\n");
}

// 5b. Slide/doc templates and shared brand assets. Skill-owned in origin, but
// the docs invite users to tweak them, so a re-run must not undo a tweak:
//   - a file the wiki does not have is added
//   - a file identical to the skill's copy is left alone
//   - a file that differs is KEPT and reported; --refresh-templates overwrites it
// User-added template folders are never touched (they have no skill counterpart).
function syncTemplates(srcDir: string, dstDir: string) {
  for (const f of readdirSync(srcDir).sort()) {
    const src = join(srcDir, f);
    const dst = join(dstDir, f);
    if (statSync(src).isDirectory()) {
      mkdirSync(dst, { recursive: true });
      syncTemplates(src, dst);
      continue;
    }
    const rel = relative(root, dst);
    if (!existsSync(dst)) {
      cpSync(src, dst);
      note(rel);
      continue;
    }
    const same = Buffer.compare(readFileSync(src), readFileSync(dst)) === 0;
    if (same) continue;
    if (refreshTemplates) {
      cpSync(src, dst);
      note(rel, " (updated)");
    } else {
      kept.push(rel);
    }
  }
}
for (const kind of located.fromWikiCopy ? [] : ["slides", "docs", "shared"]) {
  const srcTpl = join(skillRoot, "templates", kind);
  if (!existsSync(srcTpl)) continue;
  const dstTpl = join(root, "templates", kind);
  mkdirSync(dstTpl, { recursive: true });
  syncTemplates(srcTpl, dstTpl);
}

/**
 * Copy a skill into the wiki as a REAL directory.
 *
 * The source is resolved with realpathSync first, because a skill is very often
 * installed as a symlink to a sibling repo. cpSync would otherwise copy the link
 * itself, leaving the wiki pointing at a path outside itself: it works on the
 * machine that set it up and breaks the moment the wiki is moved or the sibling
 * repo is renamed. Only the top level is dereferenced, so symlinks *inside* a
 * skill keep whatever meaning the skill gave them.
 */
function bundleSkill(src: string, dst: string): void {
  // A dst left as a symlink by an older buggy run must be removed, not copied
  // into: cpSync would follow it and write through into the linked skill repo.
  if (existsSync(dst) && lstatSync(dst).isSymbolicLink()) rmSync(dst, { force: true });
  cpSync(realpathSync(src), dst, {
    recursive: true,
    // Caches and installed dependencies are machine-local and can be large;
    // the skill regenerates both on first use.
    filter: (from) => !/(^|\/)(node_modules|\.cache|\.git)(\/|$)/.test(from),
  });
}

// Where an installed skill may live: beside this skill (a project or repo
// install) or user-wide. One list for every bundled skill, so a visuals skill
// installed with `npx skills add -g` is found the same way the voice skills are.
function findSkill(skill: string): string | undefined {
  const candidates = [join(skillsRoot, skill), join(process.env.HOME ?? "", ".claude", "skills", skill)];
  return candidates.find((c) => existsSync(join(c, "SKILL.md")));
}

// 5c. Bundle the skills this wiki depends on into .claude/skills/, so a Claude
// Code session started INSIDE the wiki folder finds them. Without this the wiki
// references a visuals or brand skill it cannot load, and composing fails with
// "the lolly skill could not be found" - the wiki is only self-contained if its
// skills travel with it. Skill-owned, so refreshed like the scripts.
for (const s of bundleSkills) {
  const src = findSkill(s);
  if (!src) {
    console.warn(`warning: skill "${s}" not found beside the wiki skill (${skillsRoot}) or in ~/.claude/skills; not bundled.`);
    continue;
  }
  const dst = join(root, ".claude", "skills", s);
  const fresh = !existsSync(dst);
  bundleSkill(src, dst);
  note(`.claude/skills/${s}/`, fresh ? "" : " (refreshed)");
}

// 5d. The two voice skills are not optional, so every wiki gets both:
//   idiolect - builds and maintains voice profiles (profiles/<name>/ here, or
//              ~/.idiolect/profiles/<name>/ shared across projects)
//   hogwash  - scans and rewrites prose against those profiles
// Both ship from the same repo, so the official install is the skills CLI
// against ravan/hogwash. A locally installed copy wins when one exists, which
// is what keeps a development machine (where these skills are being edited)
// from being overwritten by a published version; re-running setup is then how
// the wiki picks up the newer local build.
const VOICE_SKILLS: Array<{ name: string; why: string }> = [
  { name: "idiolect", why: "voice profiles" },
  { name: "hogwash", why: "prose scanning and rewriting" },
];

for (const { name: skill, why } of VOICE_SKILLS) {
  const dst = join(root, ".claude", "skills", skill);
  const src = findSkill(skill);
  if (src) {
    const fresh = !existsSync(dst);
    bundleSkill(src, dst);
    note(`.claude/skills/${skill}/`, fresh ? "" : " (refreshed)");
  } else if (!existsSync(join(dst, "SKILL.md"))) {
    console.log(`Installing the ${skill} skill (${why}) from ravan/hogwash...`);
    run(["npx", "-y", "skills", "add", "ravan/hogwash", "--skill", skill], root);
    if (existsSync(join(dst, "SKILL.md"))) {
      note(`.claude/skills/${skill}/`);
    } else {
      console.warn(
        `warning: could not install the ${skill} skill (${why}).\n` +
          `  Install it later from the wiki folder with: npx skills add ravan/hogwash --skill ${skill}`,
      );
    }
  }
}

// No hogwash.json is written. Hogwash's own defaults apply without one, and it
// finds the voice profile the same way idiolect stores it: profiles/<name>/ in
// the wiki, else ~/.idiolect/profiles/<name>/. A wiki that wants its own packs
// or threshold runs `hogwash.ts init` itself.

// The ignore list grows as the wiki gains parts, so append what is missing
// rather than skipping an existing file: an older wiki would otherwise commit a
// bundled skill's node_modules the first time it bundles one.
{
  const rel = ".gitignore";
  const p = join(root, rel);
  const wanted = [
    "scripts/node_modules/",
    "scripts/skill-origin.json",
    ".claude/skills/*/node_modules/",
    ".claude/skills/*/.cache/",
    ".DS_Store",
    // Regenerable extraction output. Page renders are viewing aids and run to
    // tens of MB per regulation; gated junk is junk. `ingest.ts --re-extract`
    // rebuilds both on a fresh clone. Embedded media/ stays tracked because
    // wiki pages link to it.
    "derived/*/pages/",
    "derived/*/*/skipped/",
    // Render intermediates the compose scripts recreate on every run.
    "*.render.png",
    "*.render.html",
    "*.prose.md",
  ];
  const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
  const lines = new Set(existing.split("\n").map((l) => l.trim()));
  const missing = wanted.filter((w) => !lines.has(w));
  if (missing.length) {
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    writeFileSync(p, existing + sep + missing.join("\n") + "\n");
    note(rel, existing ? " (updated)" : "");
  }
}

// 6. Install script dependencies
if (existsSync(join(root, "scripts", "package.json"))) {
  const r = run(["bun", "install"], join(root, "scripts"));
  if (!r.ok) console.warn("warning: bun install failed:\n" + r.stderr);
  if (existsSync(join(root, "scripts", "bun.lock"))) note("scripts/bun.lock");
}

// 6b. Generate wiki/index.json and wiki/map.json so queries work from minute one.
{
  const r = run(["bun", "links.ts", "--quiet"], join(root, "scripts"));
  if (!r.ok && r.stderr) console.warn("warning: links.ts failed:\n" + r.stderr);
  note("wiki/index.json");
  note("wiki/map.json");
}

// 7. Git. A fresh wiki commits everything it starts with. A re-run stages only
// what this run touched: the user's half-written pages are theirs to commit,
// under a message that says what they did, not "wiki: setup".
if (have("git")) {
  const fresh = !existsSync(join(root, ".git"));
  if (fresh) {
    run(["git", "init"], root);
    note(".git/");
    run(["git", "add", "-A"], root);
  } else {
    const paths = [...new Set(made.map(pathOf))].filter((p) => p !== ".git/" && existsSync(join(root, p)));
    if (paths.length) run(["git", "add", "--", ...paths], root);
  }
  const staged = !run(["git", "diff", "--cached", "--quiet"], root).ok; // exit 1 = something staged
  if (staged) run(["git", "commit", "-m", fresh ? "wiki: setup" : "wiki: setup refresh"], root);
} else {
  console.warn("warning: git not found; the wiki will have no version history.");
}

console.log(`Wiki "${name}" is ready at ${root}`);
console.log(made.length ? "Created or updated:\n  " + made.join("\n  ") : "Nothing to create; everything was already there.");
if (kept.length) {
  console.log(
    `\nKept your edited template file(s) (the skill ships a different version; re-run with --refresh-templates to take it):\n  ` +
      kept.join("\n  "),
  );
}
console.log(
  "\nNext steps:\n  1. Put source files into raw/ (subfolders are fine).\n  2. Run: bun scripts/ingest.ts\n  3. Say \"capture my voice\" - the bundled idiolect skill builds a voice profile (profiles/<name>/ here, or ~/.idiolect/profiles/<name>/ to share it across projects). Then set voice_profile in CLAUDE.md to its name.",
);
