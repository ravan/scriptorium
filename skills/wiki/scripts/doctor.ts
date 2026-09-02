#!/usr/bin/env bun
// Checks the tools the wiki needs. Prints plain-language status.
// Usage: bun doctor.ts [--json]
import { have } from "./common";

interface Check {
  cmd: string;
  why: string;
  install: string;
  required: boolean;
}

const checks: Check[] = [
  {
    cmd: "unzip",
    why: "opens PowerPoint (.pptx) and Word (.docx) files",
    install: "comes with macOS; on Linux: sudo apt install unzip",
    required: true,
  },
  {
    cmd: "pdftotext",
    why: "reads the text out of PDF files",
    install: "brew install poppler",
    required: true,
  },
  {
    cmd: "pdfimages",
    why: "pulls the images out of PDF files",
    install: "brew install poppler",
    required: true,
  },
  {
    cmd: "pdftoppm",
    why: "makes a picture of each PDF page",
    install: "brew install poppler",
    required: true,
  },
  {
    cmd: "pdfinfo",
    why: "counts PDF pages",
    install: "brew install poppler",
    required: true,
  },
  {
    cmd: "magick",
    why: "samples animation frames and resizes stills for preview.ts",
    install: "brew install imagemagick",
    required: false,
  },
  {
    cmd: "git",
    why: "keeps version history of the wiki",
    install: "macOS: xcode-select --install",
    required: false,
  },
];

// A deck previewer: LibreOffice is headless and works anywhere; Keynote is the
// macOS fallback. Without one of them a .pptx cannot be looked at, and looking
// at it is the only way to know a slide is readable.
function haveDeckRenderer(): boolean {
  const { existsSync } = require("node:fs");
  return have("soffice") || have("libreoffice") || existsSync("/Applications/Keynote.app");
}

// Chrome/Chromium: only needed to render PDFs (compose-doc.ts); .md/.docx work without it.
function haveChrome(): boolean {
  const { existsSync } = require("node:fs");
  const cands = [
    process.env.WIKI_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean) as string[];
  return cands.some(existsSync) || have("chromium") || have("google-chrome");
}

// Bun itself: 1.4+ is the floor (the scripts use Bun.Image for junk detection).
const bunOk = typeof Bun.Image === "function";
const results = [
  {
    cmd: "deck renderer",
    why: "turns a .pptx into pictures so preview.ts can show you the slides",
    install: "brew install --cask libreoffice, or install Keynote on macOS",
    required: false,
    found: haveDeckRenderer(),
  },
  {
    cmd: "chrome",
    why: "turns documents into PDF files (only needed for .pdf output)",
    install: "install Google Chrome, or set WIKI_CHROME to a Chromium binary",
    required: false,
    found: haveChrome(),
  },
  {
    cmd: `bun ${Bun.version}`,
    why: "runs these scripts; 1.4 or newer is needed",
    install: "bun upgrade",
    required: true,
    found: bunOk,
  },
  ...checks.map((c) => ({ ...c, found: have(c.cmd) })),
];
const missing = results.filter((r) => !r.found);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: missing.filter((m) => m.required).length === 0, results }, null, 2));
  process.exit(0);
}

for (const r of results) {
  const mark = r.found ? "OK " : "MISSING";
  console.log(`${mark}  ${r.cmd}  (${r.why})${r.found ? "" : `\n         install with: ${r.install}`}`);
}

// Voice profiles are not a tool, so they are reported, not scored. Shown
// because hogwash and idiolect resolve "~" through $HOME: a session that runs
// with a different HOME (an agent profile, a container) will not see the
// profiles the user built, and a scan then fails with a missing ban list.
{
  const { existsSync, readdirSync } = require("node:fs");
  const { join } = require("node:path");
  const home = process.env.HOME ?? "";
  const dir = join(home, ".idiolect", "profiles");
  const names: string[] = existsSync(dir)
    ? readdirSync(dir).filter((n: string) => !n.startsWith(".") && existsSync(join(dir, n, "voice.md")))
    : [];
  console.log(
    `\nvoice profiles under ~/.idiolect/profiles (HOME=${home}): ${names.length ? names.join(", ") : "none yet - the idiolect skill builds one"}`,
  );
  // Hogwash reads its profile at `profile/` (project, then ~/.idiolect) when
  // there is no hogwash.json. That is where the owner's voice has to be for
  // every voice check to go through hogwash alone.
  const local = join(process.cwd(), "profile", "ban-list.md");
  const shared = join(home, ".idiolect", "profile", "ban-list.md");
  const at = existsSync(local) ? "profile/ (this folder)" : existsSync(shared) ? "~/.idiolect/profile/" : null;
  console.log(
    at
      ? `hogwash default profile: resolves at ${at}`
      : `hogwash default profile: nothing at profile/ or ~/.idiolect/profile/ - scans run without the owner's bans.` +
          (names.length ? ` Point it at a profile: ln -s ~/.idiolect/profiles/${names[0]} ~/.idiolect/profile` : ""),
  );
}

if (missing.length === 0) {
  console.log("\nAll tools are ready.");
} else {
  console.log(`\n${missing.length} tool(s) missing. Install commands are listed above.`);
  if (missing.some((m) => m.required)) process.exit(2);
}
