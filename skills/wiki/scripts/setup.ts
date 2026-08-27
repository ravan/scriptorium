#!/usr/bin/env bun
// Creates (or repairs) a wiki folder. Safe to run twice: it never overwrites.
// Usage: bun setup.ts <wiki-folder> --name "My Wiki" [--brand <brand-skill-name>]
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MANIFEST_REL, have, run } from "./common";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const target = process.argv[2];
if (!target || target.startsWith("--")) {
  console.error('Usage: bun setup.ts <wiki-folder> --name "My Wiki" [--brand <brand-skill-name>]');
  process.exit(1);
}

const root = resolve(target);
const name = arg("--name") ?? root.split("/").pop() ?? "wiki";
const brand = arg("--brand") ?? "none";
const skillRoot = resolve(import.meta.dir, "..");
const today = new Date().toISOString().slice(0, 10);
const made: string[] = [];

function ensureDir(rel: string) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    mkdirSync(p, { recursive: true });
    made.push(rel + "/");
  }
}

function ensureFile(rel: string, content: string) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    writeFileSync(p, content);
    made.push(rel);
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
  "profile",
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

// 3. Seed wiki files
ensureFile(
  "wiki/index.md",
  `# ${name} - Index\n\nCatalog of every page in this wiki. Updated on every ingest.\n\n## Sources\n\n(none yet)\n\n## Topics\n\n(none yet)\n\n## Entities\n\n(none yet)\n\n## Syntheses\n\n(none yet)\n`,
);
ensureFile(
  "wiki/log.md",
  `# ${name} - Log\n\nAppend-only record. Entry format: \`## [YYYY-MM-DD] <operation> | <title>\`\n\n## [${today}] setup | Wiki created\n`,
);

// 4. CLAUDE.md schema from template
const templatePath = join(skillRoot, "templates", "wiki-claude.md");
if (existsSync(templatePath)) {
  const t = readFileSync(templatePath, "utf8")
    .replaceAll("{{WIKI_NAME}}", name)
    .replaceAll("{{DATE}}", today)
    .replaceAll("{{BRAND_SKILL}}", brand);
  ensureFile("CLAUDE.md", t);
} else if (!existsSync(join(root, "CLAUDE.md"))) {
  console.warn("warning: template wiki-claude.md not found next to this script; CLAUDE.md not created.");
}

// 5. Copy scripts into the wiki so it is self-contained
for (const f of [
  "common.ts",
  "doctor.ts",
  "setup.ts",
  "ingest.ts",
  "manifest.ts",
  "compose-pptx.ts",
  "compose-docx.ts",
  "package.json",
  "tsconfig.json",
]) {
  const src = join(skillRoot, "scripts", f);
  const dst = join(root, "scripts", f);
  if (existsSync(src) && !existsSync(dst)) {
    cpSync(src, dst);
    made.push("scripts/" + f);
  }
}
ensureFile(".gitignore", "scripts/node_modules/\n.DS_Store\n");

// 6. Install script dependencies
if (existsSync(join(root, "scripts", "package.json"))) {
  const r = run(["bun", "install"], join(root, "scripts"));
  if (!r.ok) console.warn("warning: bun install failed:\n" + r.stderr);
}

// 7. Git
if (have("git")) {
  if (!existsSync(join(root, ".git"))) {
    run(["git", "init"], root);
    made.push(".git/");
  }
  run(["git", "add", "-A"], root);
  run(["git", "commit", "-m", "wiki: setup"], root);
} else {
  console.warn("warning: git not found; the wiki will have no version history.");
}

console.log(`Wiki "${name}" is ready at ${root}`);
console.log(made.length ? "Created:\n  " + made.join("\n  ") : "Nothing to create; everything was already there.");
console.log("\nNext steps:\n  1. Put source files into raw/ (subfolders are fine).\n  2. Run: bun scripts/ingest.ts\n  3. Add voice.md and quality-and-style.md to profile/ (the skill can interview you).");
